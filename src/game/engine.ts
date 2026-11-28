import {
  ALIEN_CAP,
  ALIEN_EVERY,
  ALIEN_KEYS,
  ALIENS,
  AP_BOTTOM,
  AP_TOP,
  BOARD_SIZE,
  BROOD_CAP,
  BUILDABLE,
  BUILDINGS,
  HARVEST_YIELD,
  HQ_SIZE,
  MAX_BOARD,
  MIN_BOARD,
  MIN_TURNS,
  PLAYER_COLORS,
  PLAYER_NAMES,
  RESOURCES,
  SCORE_BUILDING,
  SCORE_LAST_HIT,
  SCORE_SPIDER,
  SCORE_UNIT,
  SPIDERLING,
  START_RESOURCES,
  START_TRUCKS,
  UNITS,
  UPGRADE_HP_BONUS,
} from './data';
import { Rng } from './rng';
import {
  BoardIndex,
  DIRS8,
  FACTORY_LOCAL,
  NODE_LAYOUT,
  RALLY_LOCAL,
  SEAT_CORNERS,
  buildingCenter,
  tilesOf,
  cheb,
  cornersOf,
  distToBuilding,
  footprint,
  isFree,
  isMusterLocal,
  isReservedLocal,
  key,
  laneOf,
  moveModeOf,
  reachable,
  ringTiles,
  terrainAt,
  terrainEffect,
  toWorld,
  zoneSize,
} from './board';
import { generateTerrain, plainTerrain } from './terrain';
import type {
  Action,
  AlienDef,
  AlienState,
  AttackStyle,
  Building,
  BuildingDef,
  BuildingKey,
  BuildingLevel,
  CombatStats,
  Cost,
  DiceEntry,
  EntityRef,
  GameConfig,
  GameEvent,
  GameState,
  MoveMode,
  PlayerState,
  Pt,
  ResourceKey,
  ResourceNode,
  Spiderling,
  TargetClass,
  Tone,
  Unit,
  UnitClass,
  UnitKey,
} from './types';

export type Result = { ok: true; events: GameEvent[] } | { ok: false; reason: string };

const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function nodesForCorner(s: Pick<GameState, 'boardSize' | 'corners' | 'waterway'>, corner: number): ResourceNode[] {
  const c = s.corners[corner];
  return (Object.keys(NODE_LAYOUT[s.waterway]) as ResourceKey[]).map((resource) => {
    const local = NODE_LAYOUT[s.waterway][resource];
    return { ...toWorld(c, local.x, local.y), resource, corner, lane: laneOf(local) };
  });
}

export function createGame(cfg: GameConfig): GameState {
  const seats = cfg.seats.slice(0, 4);
  if (seats.length < 2) throw new Error('至少需要 2 名玩家');
  const rng = new Rng(cfg.seed ?? ((Date.now() * 2654435761) >>> 0));
  const totalTurns = Math.max(MIN_TURNS, Math.floor(cfg.totalTurns) || MIN_TURNS);
  const boardSize = Math.min(MAX_BOARD, Math.max(MIN_BOARD, Math.floor(cfg.size ?? BOARD_SIZE) || BOARD_SIZE));
  const corners = cornersOf(boardSize);
  const seatOf = (i: number): number => SEAT_CORNERS[seats.length][i];
  let nextId = 1;

  const players: PlayerState[] = seats.map((kind, i) => {
    const corner = corners[seatOf(i)];
    const mk = (k: BuildingKey, u: number, v: number, w: number, h: number): Building => {
      const d = BUILDINGS[k];
      return {
        id: nextId++,
        key: k,
        level: 1,
        hp: d.hp,
        maxHp: d.hp,
        ...footprint(corner, u, v, w, h),
        powered: true,
        fired: false,
        reacted: false,
      };
    };
    const p: PlayerState = {
      id: i,
      name: cfg.names?.[i]?.trim() || PLAYER_NAMES[i],
      kind,
      color: cfg.colors?.[i] || PLAYER_COLORS[i],
      alive: true,
      corner: seatOf(i),
      resources: { ...START_RESOURCES },
      ap: 0,
      trucks: START_TRUCKS,
      buildings: [mk('hq', 0, 0, HQ_SIZE, HQ_SIZE), mk('factory', FACTORY_LOCAL.u, FACTORY_LOCAL.v, 1, 1)],
      units: [],
      powerCap: 0,
      powerUsed: 0,
      producedThisTurn: {},
      score: 0,
      damageDealt: 0,
      kills: 0,
    };
    recomputePower(p);
    return p;
  });

  const board = { boardSize, corners, waterway: 'vertical' as const };
  // Every map is rolled afresh: which way the waterway runs, where it bends, the woods and hills.
  const map = cfg.terrain === 'plain' ? { terrain: plainTerrain(boardSize), waterway: board.waterway } : generateTerrain(rng, boardSize, players.map((p) => p.corner));

  return {
    rng: rng.state,
    nextId,
    boardSize,
    corners: board.corners,
    terrain: map.terrain,
    waterway: map.waterway,
    totalTurns,
    turn: 1,
    phase: 'roundStart',
    currentPlayer: -1,
    order: [],
    orderIndex: 0,
    alienActed: false,
    dice: [],
    players,
    nodes: players.flatMap((p) => nodesForCorner({ ...board, waterway: map.waterway }, p.corner)),
    aliens: [],
    brood: [],
    // The first alien is due so many rounds in; each one that arrives rolls the date of the next.
    nextAlien: rng.int(ALIEN_EVERY[0], ALIEN_EVERY[1]),
    aliensSeen: 0,
    log: [],
    logId: 1,
    ranking: [],
    gameOverReason: '',
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function addLog(s: GameState, text: string, tone: Tone = 'info', player?: number): void {
  s.log.push({ id: s.logId++, text, tone, player });
  if (s.log.length > 80) s.log.shift();
}

export function hqOf(p: PlayerState): Building | undefined {
  return p.buildings.find((b) => b.key === 'hq');
}

/** The defense net is a force field, not a structure: nothing can shoot at it. */
function targetable(b: Building): boolean {
  return b.key !== 'defenseNet';
}

export function netDefense(p: PlayerState): number {
  let d = 0;
  for (const b of p.buildings) if (b.key === 'defenseNet' && b.powered) d += BUILDINGS.defenseNet.levels[b.level - 1].defense;
  return d;
}

/** Total attack power: every living combat unit plus powered defence structures. */
export function attackPower(p: PlayerState): number {
  let n = 0;
  for (const u of p.units) n += volley(UNITS[u.key]);
  for (const b of p.buildings) {
    if (!b.powered) continue;
    n += volley(BUILDINGS[b.key].levels[b.level - 1]);
  }
  return n;
}

/** What one full attack with these stats comes to, every shot counted: the figure the cards give as a unit's attack. */
export const volley = (st: Pick<CombatStats, 'attack' | 'shots'>): number => st.attack * st.shots;

/** The attack `st` brings to bear on a target of class `cls`: what it keeps for aircraft, if anything, and otherwise its attack. */
export const attackOn = (st: Pick<CombatStats, 'attack' | 'airAttack'>, cls: TargetClass): number => (cls === 'air' && st.airAttack !== undefined ? st.airAttack : st.attack);

export function countBuilding(p: PlayerState, k: BuildingKey): number {
  return p.buildings.filter((b) => b.key === k).length;
}

export function canAfford(p: PlayerState, cost: Cost): boolean {
  return (cost.ore ?? 0) <= p.resources.ore && (cost.oil ?? 0) <= p.resources.oil && (cost.meat ?? 0) <= p.resources.meat;
}

function pay(p: PlayerState, cost: Cost): void {
  p.resources.ore -= cost.ore ?? 0;
  p.resources.oil -= cost.oil ?? 0;
  p.resources.meat -= cost.meat ?? 0;
}

function recomputePower(p: PlayerState): void {
  let cap = 0;
  for (const b of p.buildings) cap += BUILDINGS[b.key].providesPower;
  let used = 0;
  // Power goes to buildings in the order they were built; the rest go dark.
  for (const b of p.buildings) {
    if (!BUILDINGS[b.key].needsPower) {
      b.powered = true;
      continue;
    }
    b.powered = used < cap;
    if (b.powered) used++;
  }
  p.powerCap = cap;
  p.powerUsed = used;
}

/** Picks the spot itself: ordinary buildings tuck in at the back, guns go to the side facing the enemy. */
function findPlacement(s: GameState, p: PlayerState, def: BuildingDef): { x: number; y: number; w: number; h: number } | null {
  if (def.w === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const c = s.corners[p.corner];
  const size = zoneSize(p);
  const cells: Pt[] = [];
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) if (!isReservedLocal(u, v) && !isMusterLocal(u, v)) cells.push({ x: u, y: v });
  // Ordinary buildings tuck in at the back; guns go to the side facing the enemy.
  cells.sort(def.front ? (a, b) => b.x + b.y - (a.x + a.y) : (a, b) => a.x + a.y - (b.x + b.y));
  const idx = new BoardIndex(s);
  for (const cell of cells) {
    if (cell.x + def.w > size || cell.y + def.h > size) continue;
    const fp = footprint(c, cell.x, cell.y, def.w, def.h);
    if (spotError(s, p, idx, def, fp.x, fp.y) === null) return fp;
  }
  return null;
}

/** Why `def` cannot go with its top-left tile on (x, y), looking only at the ground. */
function spotError(s: GameState, p: PlayerState, idx: BoardIndex, def: BuildingDef, x: number, y: number): string | null {
  const c = s.corners[p.corner];
  const size = zoneSize(p);
  for (let i = 0; i < def.w; i++) {
    for (let j = 0; j < def.h; j++) {
      const tx = x + i;
      const ty = y + j;
      const u = (tx - c.ox) * c.dx;
      const v = (ty - c.oy) * c.dy;
      if (u < 0 || v < 0 || u >= size || v >= size) return '只能建在自己的领地内';
      if (isReservedLocal(u, v)) return '这些格子要留给运输车通行';
      if (isMusterLocal(u, v)) return '这里是出兵点，要留空';
      if (terrainAt(s, tx, ty) !== 'plain') return '这种地形上不能建造';
      const k = key(tx, ty);
      if (idx.blocked.has(k)) return '这里已有建筑或资源点';
      if (idx.ground.has(k)) return '有单位停在这里';
    }
  }
  return null;
}

/** The same check the player's chosen spot has to pass: inside their own zone, on clear flat ground. */
export function placementError(s: GameState, p: PlayerState, k: BuildingKey, x: number, y: number): string | null {
  const err = canBuild(s, p, k, { ignoreRoom: true });
  if (err) return err;
  const def = BUILDINGS[k];
  return def.w === 0 ? null : spotError(s, p, new BoardIndex(s), def, x, y);
}

/** Top-left corners the player may put `k` on right now. */
export function buildSpots(s: GameState, p: PlayerState, k: BuildingKey): Pt[] {
  const def = BUILDINGS[k];
  const out: Pt[] = [];
  if (def.w === 0) return out;
  const idx = new BoardIndex(s);
  const c = s.corners[p.corner];
  const size = zoneSize(p);
  const x0 = c.ox + (c.dx > 0 ? 0 : -(size - 1));
  const y0 = c.oy + (c.dy > 0 ? 0 : -(size - 1));
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) if (spotError(s, p, idx, def, x, y) === null) out.push({ x, y });
  return out;
}

function findSpawn(s: GameState, p: PlayerState, cls: UnitClass, producer: Building | null): Pt | null {
  const idx = new BoardIndex(s);
  const corner = s.corners[p.corner];
  const ref = cls === 'air' && producer ? buildingCenter(producer) : toWorld(corner, RALLY_LOCAL.u, RALLY_LOCAL.v);
  // Ground units are always placed on ground a foot soldier could use, so
  // nothing appears to wade out of the factory.
  const mode: MoveMode = cls === 'air' ? 'air' : 'foot';
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let y = 0; y < s.boardSize; y++) {
    for (let x = 0; x < s.boardSize; x++) {
      if (!isFree(idx, s, x, y, mode)) continue;
      // Keep the truck lanes clear unless the base is completely jammed.
      const u = (x - corner.ox) * corner.dx;
      const v = (y - corner.oy) * corner.dy;
      if (u >= 0 && v >= 0 && isReservedLocal(u, v)) continue;
      const d = cheb({ x, y }, ref);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

function producersOf(p: PlayerState, k: BuildingKey): { all: Building[]; on: Building[] } {
  const all = p.buildings.filter((b) => b.key === k);
  return { all, on: all.filter((b) => b.powered) };
}

/** Returns null when allowed, otherwise the reason. */
export function canBuild(s: GameState, p: PlayerState, k: BuildingKey, o: { ignoreRoom?: boolean } = {}): string | null {
  if (!BUILDABLE.includes(k)) return '该建筑不可建造';
  const def = BUILDINGS[k];
  if (def.maxCount && countBuilding(p, k) >= def.maxCount) return `已建有${def.levels[0].name}，可在“建筑”页升级`;
  if (!canAfford(p, def.levels[0].cost)) return '资源不足';
  if (!o.ignoreRoom && def.w > 0 && buildSpots(s, p, k).length === 0) return '基地区域已无空地';
  return null;
}

export function canProduce(s: GameState, p: PlayerState, uk: UnitKey): string | null {
  const ud = UNITS[uk];
  if (!ud.producedBy) return '该单位不能生产';
  const bd = BUILDINGS[ud.producedBy];
  const { all, on } = producersOf(p, ud.producedBy);
  if (!all.length) return `需要先建造${bd.name}`;
  if (!on.length) return `${bd.name}没有电力`;
  if (!canAfford(p, ud.cost)) return '资源不足';
  if (uk === 'truck') {
    if (p.trucks >= bd.capPerBuilding * all.length) return `运输车已满，需要更多${bd.name}`;
    return null;
  }
  if (bd.capPerBuilding && p.units.filter((u) => u.key === uk).length >= bd.capPerBuilding * on.length) {
    return `${bd.name}容量已满，需要更多${bd.name}`;
  }
  if (bd.perTurnCap && (p.producedThisTurn[ud.producedBy] ?? 0) >= bd.perTurnCap * on.length) {
    return `${bd.name}本回合产量已满`;
  }
  if (!findSpawn(s, p, ud.unitClass, on[0])) return '基地附近没有空位';
  return null;
}

/** The rung above the one `b` stands on, or null at the top of its ladder. */
export function nextLevelOf(b: Building): BuildingLevel | null {
  const ladder = BUILDINGS[b.key].levels;
  return b.level < ladder.length ? ladder[b.level] : null;
}

export function canUpgrade(p: PlayerState, id: number): string | null {
  const b = p.buildings.find((x) => x.id === id);
  if (!b) return '建筑不存在';
  const def = BUILDINGS[b.key];
  const next = nextLevelOf(b);
  if (!next) return def.levels.length < 2 ? '该建筑无法升级' : '已是最高等级';
  if (!canAfford(p, next.cost)) return '资源不足';
  return null;
}

/**
 * An upgraded base claims the ring outside it. The ground there is levelled for
 * building on; a resource node is left where it stands.
 */
function expandBase(s: GameState, p: PlayerState, hq: Building, events: GameEvent[]): void {
  const nodes = new Set(s.nodes.filter((n) => n.corner === p.corner).map((n) => key(n.x, n.y)));
  for (const t of ringTiles(s.corners[p.corner])) {
    if (nodes.has(key(t.x, t.y))) continue;
    s.terrain[t.y * s.boardSize + t.x] = 'plain';
  }
  events.push({ type: 'expand', player: p.id, buildingId: hq.id });
  addLog(s, `${p.name} 升级为${BUILDINGS.hq.levels[1].name}，领地扩大了一圈`, 'good', p.id);
}

interface Combatant {
  ref: EntityRef;
  pos: Pt;
  stats: CombatStats;
  fx: AttackStyle;
  unitClass: UnitClass | null;
}

/** Returns the combatant or a string explaining why it cannot act. */
function sourceOf(s: GameState, p: PlayerState, ref: { kind: 'unit' | 'building'; id: number }): Combatant | string {
  if (ref.kind === 'unit') {
    const u = p.units.find((x) => x.id === ref.id);
    if (!u) return '找不到该单位';
    const d = UNITS[u.key];
    if (d.attack <= 0) return '该单位无法攻击';
    if (u.attackUsed) return '该单位本回合已经攻击过';
    return { ref: { kind: 'unit', id: u.id }, pos: { x: u.x, y: u.y }, stats: statsOf(s, u), fx: d.fx, unitClass: d.unitClass };
  }
  const b = p.buildings.find((x) => x.id === ref.id);
  if (!b) return '找不到该建筑';
  const d = BUILDINGS[b.key];
  const lv = d.levels[b.level - 1];
  if (lv.attack <= 0) return '该建筑没有武器';
  if (!b.powered) return `${lv.name}没有电力，无法开火`;
  if (b.fired) return '该建筑本回合已经开火';
  const stats: CombatStats = { attack: lv.attack, shots: lv.shots, defense: 0, range: lv.range, canHit: d.canHit };
  const onlyAir = d.canHit.includes('air') && !d.canHit.includes('ground');
  return { ref: { kind: 'building', id: b.id }, pos: buildingCenter(b), stats, fx: onlyAir ? 'flak' : 'shell', unitClass: null };
}

interface Target {
  ref: EntityRef;
  /** Owning player id, -1 for the alien. */
  owner: number;
  pos: Pt;
  defense: number;
  cls: TargetClass;
  name: string;
  /** Live object so callers can take HP off it. */
  obj: Unit | Building | AlienState | Spiderling;
  isHq: boolean;
}

export function alienById(s: GameState, id: number): AlienState | null {
  return s.aliens.find((a) => a.id === id) ?? null;
}

export function spiderById(s: GameState, id: number): Spiderling | null {
  return s.brood.find((b) => b.id === id) ?? null;
}

export function unitById(s: GameState, id: number): { unit: Unit; owner: PlayerState } | null {
  for (const p of s.players) {
    const unit = p.units.find((x) => x.id === id);
    if (unit) return { unit, owner: p };
  }
  return null;
}

/** Whether a unit still has an order it may take this turn: a move, or a shot it has not fired. */
export function canStillAct(u: Unit): boolean {
  return !u.moveUsed || (UNITS[u.key].attack > 0 && !u.attackUsed);
}

/** A unit's armour plus whatever the ground beneath it adds. Never negative. */
export function defenseOf(s: GameState, u: Unit): number {
  const d = UNITS[u.key];
  return Math.max(0, d.defense + (terrainEffect(s, d.family, u.x, u.y).defense ?? 0));
}

/** A unit type's stats straight off the reference card. */
export function baseStats(k: UnitKey): CombatStats {
  const { attack, shots, defense, range, canHit, pierce, airAttack } = UNITS[k];
  return { attack, shots, defense, range, canHit, pierce, ...(airAttack === undefined ? {} : { airAttack }) };
}

/** A unit's stats as it stands: its own, adjusted by the terrain it is on. */
export function statsOf(s: GameState, u: Unit): CombatStats {
  const d = UNITS[u.key];
  const e = terrainEffect(s, d.family, u.x, u.y);
  const by = e.attack ?? 0;
  return {
    attack: Math.max(0, d.attack + by),
    shots: d.shots,
    // The ground counts for as much against aircraft as against anything else.
    ...(d.airAttack === undefined ? {} : { airAttack: Math.max(0, d.airAttack + by) }),
    defense: defenseOf(s, u),
    // A weapon always reaches the next tile over, whatever woods it is sitting in.
    range: d.range > 0 ? Math.max(1, d.range + (e.range ?? 0)) : 0,
    canHit: d.canHit,
    pierce: d.pierce,
  };
}

export function buildingById(s: GameState, id: number): { building: Building; owner: PlayerState } | null {
  for (const p of s.players) {
    const building = p.buildings.find((x) => x.id === id);
    if (building) return { building, owner: p };
  }
  return null;
}

function targetOf(s: GameState, ref: EntityRef): Target | null {
  if (ref.kind === 'alien') {
    const a = alienById(s, ref.id);
    if (!a) return null;
    const d = ALIENS[a.key];
    return { ref, owner: -1, pos: { x: a.x, y: a.y }, defense: d.defense, cls: 'ground', name: d.name, obj: a, isHq: false };
  }
  if (ref.kind === 'spider') {
    const b = spiderById(s, ref.id);
    if (!b) return null;
    return { ref, owner: -1, pos: { x: b.x, y: b.y }, defense: SPIDERLING.defense, cls: 'ground', name: SPIDERLING.name, obj: b, isHq: false };
  }
  if (ref.kind === 'unit') {
    const hit = unitById(s, ref.id);
    if (!hit) return null;
    const d = UNITS[hit.unit.key];
    return { ref, owner: hit.owner.id, pos: { x: hit.unit.x, y: hit.unit.y }, defense: defenseOf(s, hit.unit), cls: d.unitClass, name: d.name, obj: hit.unit, isHq: false };
  }
  const hit = buildingById(s, ref.id);
  if (!hit || !targetable(hit.building)) return null;
  return {
    ref,
    owner: hit.owner.id,
    pos: buildingCenter(hit.building),
    defense: netDefense(hit.owner),
    cls: 'building',
    name: BUILDINGS[hit.building.key].levels[hit.building.level - 1].name,
    obj: hit.building,
    isHq: hit.building.key === 'hq',
  };
}

/** Range check shared by targeting queries and the ATTACK order. */
function canReach(s: GameState, c: Combatant, t: Target): boolean {
  if (!c.stats.canHit.includes(t.cls)) return false;
  if (t.ref.kind === 'building') {
    // Measured to the nearest tile of the structure, not its centre.
    const hit = buildingById(s, t.ref.id);
    return !!hit && distToBuilding(c.pos, hit.building) <= c.stats.range;
  }
  return cheb(c.pos, t.pos) <= c.stats.range;
}

/** Tiles a unit may still move to this turn. */
export function moveRange(s: GameState, unitId: number): Pt[] {
  const p = s.players[s.currentPlayer];
  const u = p?.units.find((x) => x.id === unitId);
  if (!p || !u || u.moveUsed) return [];
  const idx = new BoardIndex(s);
  return [...reachable(idx, s, u, moveModeOf(u.key), UNITS[u.key].move, u.id).values()].map((path) => path[path.length - 1]);
}

/** Everything a unit or armed building can shoot right now. */
export function attackTargets(s: GameState, source: { kind: 'unit' | 'building'; id: number }): EntityRef[] {
  const p = s.players[s.currentPlayer];
  if (!p) return [];
  const c = sourceOf(s, p, source);
  if (typeof c === 'string') return [];
  const out: EntityRef[] = [];
  for (const q of s.players) {
    if (q.id === p.id) continue;
    for (const u of q.units) {
      const t = targetOf(s, { kind: 'unit', id: u.id });
      if (t && canReach(s, c, t)) out.push(t.ref);
    }
    for (const b of q.buildings) {
      const t = targetOf(s, { kind: 'building', id: b.id });
      if (t && canReach(s, c, t)) out.push(t.ref);
    }
  }
  // Aliens are fair game too: their bounty is the quickest way to riches.
  for (const a of s.aliens) {
    const t = targetOf(s, { kind: 'alien', id: a.id });
    if (t && canReach(s, c, t)) out.push(t.ref);
  }
  for (const b of s.brood) {
    const t = targetOf(s, { kind: 'spider', id: b.id });
    if (t && canReach(s, c, t)) out.push(t.ref);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function rollOff(rng: Rng, initial: DiceEntry[], mode: 'max' | 'min'): DiceEntry {
  let pool = initial;
  for (let i = 0; i < 40 && pool.length > 1; i++) {
    const rolls = pool.map(() => rng.int(1, 6));
    pool.forEach((e, j) => e.rolls.push(rolls[j]));
    const v = mode === 'max' ? Math.max(...rolls) : Math.min(...rolls);
    pool = pool.filter((_, j) => rolls[j] === v);
  }
  return pool[0];
}

/**
 * Everyone rolls at once. The top roller gets AP_TOP, the bottom roller
 * AP_BOTTOM and everyone in between nothing. Ties for either spot are settled
 * by re-rolling only the tied players. The returned list is in play order.
 */
export function rollDice(rng: Rng, ids: number[]): DiceEntry[] {
  const entries: DiceEntry[] = ids.map((player) => ({ player, rolls: [rng.int(1, 6)], ap: 0, rank: 0 }));
  const last = (e: DiceEntry): number => e.rolls[e.rolls.length - 1];
  const byRoll = [...entries].sort((a, b) => last(b) - last(a) || a.player - b.player);
  const hi = last(byRoll[0]);
  const lo = last(byRoll[byRoll.length - 1]);
  const top = byRoll.filter((e) => last(e) === hi);
  const bottom = byRoll.filter((e) => last(e) === lo);

  const first = top.length > 1 ? rollOff(rng, top, 'max') : top[0];
  const rest = byRoll.filter((e) => e !== first);
  let lastE: DiceEntry;
  if (bottom.includes(first)) {
    // Everyone rolled alike: the bottom spot is settled among those left.
    lastE = rest.length > 1 ? rollOff(rng, rest, 'min') : rest[0];
  } else {
    lastE = bottom.length > 1 ? rollOff(rng, bottom, 'min') : bottom[0];
  }
  const order = [first, ...rest.filter((e) => e !== lastE), lastE];
  order.forEach((e, i) => {
    e.rank = i;
    e.ap = i === 0 ? AP_TOP : i === order.length - 1 ? AP_BOTTOM : 0;
  });
  return order;
}

// ---------------------------------------------------------------------------
// Combat resolution
// ---------------------------------------------------------------------------

/** Attack power left after the target's defence has absorbed what it can. */
export function netDamage(attack: number, defense: number, pierce = false): number {
  return Math.max(0, attack - (pierce ? 0 : defense));
}

function strike(s: GameState, attacker: number, t: Target, st: CombatStats, events: GameEvent[]): void {
  // Each shell is worked out on its own, so armour tells twice against a weapon that fires twice.
  const attack = attackOn(st, t.cls);
  let dmg = 0;
  for (let i = 0; i < st.shots; i++) dmg += netDamage(attack, t.defense, st.pierce);
  t.obj.hp -= dmg;
  events.push({ type: 'damage', target: t.ref, amount: dmg, pos: t.pos });
  if (attacker >= 0) {
    const p = s.players[attacker];
    p.damageDealt += dmg;
    // What each player did to an alien is remembered until it goes down and the rewards are shared out.
    const alien = t.ref.kind === 'alien' ? alienById(s, t.ref.id) : null;
    if (alien) alien.hurt[attacker] = (alien.hurt[attacker] ?? 0) + dmg;
  }
  if (t.obj.hp <= 0) destroyTarget(s, t, attacker, events);
}

function whoName(s: GameState, attacker: number): string {
  return attacker < 0 ? '外星人' : s.players[attacker].name;
}

/** Points towards the final result, and a note of them for the scoreboard. */
function award(s: GameState, pid: number, points: number, events: GameEvent[]): void {
  if (pid < 0 || points <= 0) return;
  s.players[pid].score += points;
  events.push({ type: 'score', player: pid, amount: points });
}

/**
 * An alien's bounty and its points go round in proportion to the damage each
 * player did, so whoever hurt it most earns the most; the last blow earns its
 * bonus on top.
 */
function killAlien(s: GameState, id: number, hero: number, events: GameEvent[]): void {
  const alien = alienById(s, id);
  if (!alien) return;
  const def = ALIENS[alien.key];
  s.aliens = s.aliens.filter((a) => a.id !== id);
  // Its spiders do not outlive it.
  for (const b of s.brood.filter((x) => x.owner === id)) events.push({ type: 'destroyed', target: { kind: 'spider', id: b.id }, pos: { x: b.x, y: b.y } });
  s.brood = s.brood.filter((x) => x.owner !== id);
  const total = Object.values(alien.hurt).reduce((n, v) => n + v, 0);
  const rewards: Record<number, Cost> = {};
  const points: Record<number, number> = {};
  const parts: string[] = [];
  for (const p of s.players) {
    const share = total > 0 ? (alien.hurt[p.id] ?? 0) / total : 0;
    const r: Cost = {};
    for (const k of Object.keys(def.reward) as ResourceKey[]) {
      const v = Math.round((def.reward[k] ?? 0) * share);
      if (v > 0) {
        r[k] = v;
        p.resources[k] += v;
      }
    }
    const pts = Math.round(def.bounty * share) + (p.id === hero ? SCORE_LAST_HIT : 0);
    if (!pts && !Object.keys(r).length) continue;
    rewards[p.id] = r;
    points[p.id] = pts;
    award(s, p.id, pts, events);
    const loot = Object.entries(r)
      .map(([k, v]) => `${RESOURCES[k as ResourceKey].name} ${v}`)
      .join(' ');
    parts.push(`${p.name} 积分 +${pts}${loot ? `，${loot}` : ''}`);
  }
  events.push({ type: 'alienKilled', id, key: alien.key, rewards, points });
  addLog(s, `${def.name}被击败！奖励按伤害分配：${parts.join('；') || '无人分得'}`, 'good', hero >= 0 ? hero : undefined);
}

function destroyTarget(s: GameState, t: Target, attacker: number, events: GameEvent[]): void {
  events.push({ type: 'destroyed', target: t.ref, pos: t.pos });
  if (t.ref.kind === 'alien') {
    killAlien(s, t.ref.id, attacker, events);
    return;
  }
  if (t.ref.kind === 'spider') {
    s.brood = s.brood.filter((b) => b.id !== t.ref.id);
    if (attacker >= 0) {
      const p = s.players[attacker];
      for (const k of RES_KEYS) p.resources[k] += SPIDERLING.reward[k] ?? 0;
      award(s, attacker, SCORE_SPIDER, events);
    }
    addLog(s, `${whoName(s, attacker)} 消灭了${SPIDERLING.name}`, 'combat', attacker >= 0 ? attacker : undefined);
    return;
  }
  const owner = s.players[t.owner];
  if (t.ref.kind === 'unit') {
    owner.units = owner.units.filter((u) => u.id !== t.ref.id);
    if (attacker >= 0) {
      s.players[attacker].kills++;
      award(s, attacker, SCORE_UNIT[(t.obj as Unit).key], events);
    }
  } else {
    owner.buildings = owner.buildings.filter((b) => b.id !== t.ref.id);
    if (!t.isHq) recomputePower(owner);
    if (attacker >= 0) award(s, attacker, SCORE_BUILDING[(t.obj as Building).key], events);
  }
  addLog(s, `${whoName(s, attacker)} 摧毁了 ${owner.name} 的${t.name}`, 'combat', attacker >= 0 ? attacker : undefined);
  if (t.isHq) eliminate(s, owner, events);
}

/**
 * Armed buildings each get one free shot at something that attacks one of
 * their base's buildings. A building only reacts once per enemy turn.
 */
function retaliate(s: GameState, defenderId: number, attacker: { ref: EntityRef; pos: Pt; cls: UnitClass }, events: GameEvent[]): void {
  const d = s.players[defenderId];
  if (!d || !d.alive) return;
  for (const b of [...d.buildings]) {
    const bd = BUILDINGS[b.key];
    const lv = bd.levels[b.level - 1];
    if (lv.attack <= 0 || !b.powered || b.reacted || !bd.canHit.includes(attacker.cls)) continue;
    const pos = buildingCenter(b);
    if (cheb(pos, attacker.pos) > lv.range) continue;
    const t = targetOf(s, attacker.ref);
    if (!t) return; // it already went down
    b.reacted = true;
    events.push({
      type: 'attack',
      source: { kind: 'building', id: b.id },
      target: t.ref,
      from: pos,
      to: t.pos,
      shots: lv.shots,
      style: bd.canHit.includes('air') ? 'flak' : 'shell',
    });
    addLog(s, `${d.name} 的${lv.name}反击`, 'combat', d.id);
    strike(s, d.id, t, { attack: lv.attack, shots: lv.shots, defense: 0, range: lv.range, canHit: bd.canHit }, events);
  }
}

export type GameOverReason = 'turns' | 'lastStanding';

export function gameOverText(reason: GameOverReason): string {
  return reason === 'turns' ? '回合结束' : '统一战场';
}

function finishGame(s: GameState, reason: GameOverReason, events: GameEvent[]): void {
  s.phase = 'gameover';
  s.currentPlayer = -1;
  s.gameOverReason = reason;
  const hp = (p: PlayerState): number => hqOf(p)?.hp ?? 0;
  // Points decide it; a base still standing and then raw attack power settle a tie.
  const ranked = [...s.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (hp(a) !== hp(b)) return hp(b) - hp(a);
    const pa = attackPower(a);
    const pb = attackPower(b);
    if (pa !== pb) return pb - pa;
    return a.id - b.id;
  });
  s.ranking = ranked.map((p) => ({ player: p.id, alive: p.alive, score: p.score, baseHp: hp(p), attack: attackPower(p), units: p.units.length }));
  events.push({ type: 'gameOver', reason });
  addLog(s, `游戏结束（${gameOverText(reason)}）：${s.players[s.ranking[0].player].name} 获胜`, 'good', s.ranking[0].player);
}

function eliminate(s: GameState, p: PlayerState, events: GameEvent[]): void {
  p.alive = false;
  for (const u of p.units) events.push({ type: 'destroyed', target: { kind: 'unit', id: u.id }, pos: { x: u.x, y: u.y } });
  for (const b of p.buildings) events.push({ type: 'destroyed', target: { kind: 'building', id: b.id }, pos: buildingCenter(b) });
  p.units = [];
  p.buildings = [];
  p.ap = 0;
  recomputePower(p);
  events.push({ type: 'eliminated', player: p.id });
  addLog(s, `${p.name} 的军事基地被摧毁，出局！`, 'bad', p.id);
  if (s.players.filter((q) => q.alive).length <= 1) finishGame(s, 'lastStanding', events);
}

// ---------------------------------------------------------------------------
// The aliens
// ---------------------------------------------------------------------------

/** What a creature strikes with. */
type Creature = Pick<AlienDef, 'attack' | 'shots' | 'defense' | 'range' | 'fx'>;

/** A free tile in the middle of the board, or anywhere at all if the middle is taken. */
function landingSpot(s: GameState, rng: Rng, idx: BoardIndex, selfId: number): Pt | null {
  const mid = Math.floor(s.boardSize / 2);
  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let y = 0; y < s.boardSize; y++) {
    for (let x = 0; x < s.boardSize; x++) {
      if (!isFree(idx, s, x, y, 'foot', selfId)) continue;
      (Math.abs(x - mid) <= 2 && Math.abs(y - mid) <= 2 ? near : far).push({ x, y });
    }
  }
  const pool = near.length ? near : far;
  return pool.length ? rng.pick(pool) : null;
}

/** One of the aliens that is not on the board already, drawn at random. A board with no room for it goes without. */
function spawnAlien(s: GameState, rng: Rng, events: GameEvent[]): void {
  const at = landingSpot(s, rng, new BoardIndex(s), 0);
  if (!at) return;
  const pool = ALIEN_KEYS.filter((k) => !s.aliens.some((a) => a.key === k));
  const k = rng.pick(pool.length ? pool : ALIEN_KEYS);
  const alien: AlienState = { id: s.nextId++, key: k, x: at.x, y: at.y, hp: ALIENS[k].hp, arrived: s.turn, hurt: {} };
  s.aliens.push(alien);
  s.aliensSeen++;
  events.push({ type: 'alienSpawn', id: alien.id, key: k, x: at.x, y: at.y });
  addLog(s, `警报：外星人${ALIENS[k].name}降临战场！${ALIENS[k].desc}`, 'warn');
}

function nearestAsset(s: GameState, from: Pt): Pt | null {
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const p of s.players) {
    if (!p.alive) continue;
    for (const u of p.units) {
      const d = cheb(from, u);
      if (d < bestD) {
        bestD = d;
        best = { x: u.x, y: u.y };
      }
    }
    for (const b of p.buildings) {
      const c = buildingCenter(b);
      const d = cheb(from, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/** Every tile the players own something on: places a creature can head for or strike from. */
function everyAsset(s: GameState): Pt[] {
  const out: Pt[] = [];
  for (const p of s.players) {
    if (!p.alive) continue;
    for (const u of p.units) out.push({ x: u.x, y: u.y });
    for (const b of p.buildings) if (targetable(b)) out.push(...tilesOf(b));
  }
  return out;
}

/** What the players have within `range` of `at`, the softest first: units before buildings, a base last of all. */
function preyNear(s: GameState, at: Pt, range: number): Target[] {
  const opts: Array<{ t: Target; pri: number }> = [];
  const take = (t: Target | null, pri: number): void => {
    if (t) opts.push({ t, pri });
  };
  for (const p of s.players) {
    if (!p.alive) continue;
    for (const u of p.units) if (cheb(at, u) <= range) take(targetOf(s, { kind: 'unit', id: u.id }), u.hp);
    for (const b of p.buildings) {
      if (targetable(b) && distToBuilding(at, b) <= range) take(targetOf(s, { kind: 'building', id: b.id }), 1000 + (b.key === 'hq' ? 1000 : 0) + b.hp);
    }
  }
  return opts.sort((a, b) => a.pri - b.pri).map((o) => o.t);
}

/**
 * Walks a creature up to `move` tiles: towards `prey` when it has one and the
 * dice agree, otherwise to whichever tile it fancies. Aliens wade straight
 * through water; nothing about them plays by our rules.
 */
function creep(s: GameState, idx: BoardIndex, who: AlienState | Spiderling, move: number, prey: Pt | null, chase: number, rng: Rng, events: GameEvent[]): void {
  const reach = reachable(idx, s, who, 'track', move, who.id);
  let dest: Pt | null = null;
  if (prey && rng.chance(chase)) {
    let bestD = Infinity;
    const cands: Pt[] = [];
    for (const path of reach.values()) {
      const end = path[path.length - 1];
      const d = cheb(end, prey);
      if (d < bestD) {
        bestD = d;
        cands.length = 0;
      }
      if (d === bestD) cands.push(end);
    }
    dest = rng.pick(cands);
  }
  if (!dest && reach.size) {
    const path = rng.pick([...reach.values()]);
    dest = path[path.length - 1];
  }
  if (!dest) return;
  events.push({ type: 'move', unitId: who.id, path: reach.get(key(dest.x, dest.y)) ?? [] });
  who.x = dest.x;
  who.y = dest.y;
}

/** A free tile from which an alien with `range` could strike this very turn. */
function ambushSpot(s: GameState, rng: Rng, idx: BoardIndex, a: AlienState, range: number): Pt | null {
  const spots = new Map<string, Pt>();
  for (const at of everyAsset(s)) {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (isFree(idx, s, x, y, 'foot', a.id)) spots.set(key(x, y), { x, y });
      }
    }
  }
  const all = [...spots.values()];
  return all.length ? rng.pick(all) : null;
}

/** Somewhere well away from where it struck, so the ghost reads as having left rather than sidled off. */
function vanishSpot(s: GameState, rng: Rng, a: AlienState): Pt | null {
  const idx = new BoardIndex(s);
  const far: Pt[] = [];
  const any: Pt[] = [];
  for (let y = 0; y < s.boardSize; y++) {
    for (let x = 0; x < s.boardSize; x++) {
      if (!isFree(idx, s, x, y, 'foot', a.id)) continue;
      any.push({ x, y });
      if (cheb({ x, y }, a) >= 3) far.push({ x, y });
    }
  }
  return rng.pick(far.length ? far : any) ?? null;
}

/** 奎德 lays her eggs: a few small spiders on the free tiles round about, up to the brood she can keep. */
function hatch(s: GameState, rng: Rng, queen: AlienState, range: readonly [number, number], events: GameEvent[]): void {
  const room = BROOD_CAP - s.brood.filter((b) => b.owner === queen.id).length;
  if (room <= 0) return;
  const idx = new BoardIndex(s);
  const around: Pt[] = [];
  for (const [dx, dy] of DIRS8) {
    if (isFree(idx, s, queen.x + dx, queen.y + dy, 'foot', queen.id)) around.push({ x: queen.x + dx, y: queen.y + dy });
  }
  const ids: number[] = [];
  for (let n = Math.min(rng.int(range[0], range[1]), room, around.length); n > 0; n--) {
    const at = around.splice(rng.int(0, around.length - 1), 1)[0];
    const spider: Spiderling = { id: s.nextId++, owner: queen.id, x: at.x, y: at.y, hp: SPIDERLING.hp };
    s.brood.push(spider);
    ids.push(spider.id);
  }
  if (ids.length) {
    events.push({ type: 'hatch', owner: queen.id, ids });
    addLog(s, `${ALIENS[queen.key].name}孵出了 ${ids.length} 只${SPIDERLING.name}`, 'warn');
  }
}

/** Strikes the first thing on the list, and lets the base guns answer if it was one of theirs. */
function bite(s: GameState, ref: EntityRef, prey: Target[], beast: Creature, at: Pt, events: GameEvent[]): void {
  if (!prey.length) return;
  const t = prey[0];
  const from = { x: at.x, y: at.y };
  events.push({ type: 'attack', source: ref, target: t.ref, from, to: t.pos, shots: beast.shots, style: beast.fx });
  strike(s, -1, t, { attack: beast.attack, shots: beast.shots, defense: beast.defense, range: beast.range, canHit: ['ground', 'air', 'building'] }, events);
  // Base guns answer an attack on the base; the alien is not a unit, but they can still see it.
  if (t.ref.kind === 'building' && s.players[t.owner].alive) retaliate(s, t.owner, { ref, pos: from, cls: 'ground' }, events);
}

/** One alien's go. Each kind goes about it in its own way. */
function alienTurn(s: GameState, rng: Rng, a: AlienState, events: GameEvent[]): void {
  if (s.phase === 'gameover') return;
  const def = ALIENS[a.key];
  const ref: EntityRef = { kind: 'alien', id: a.id };
  const idx = new BoardIndex(s);
  const home: Pt = { x: a.x, y: a.y };
  // Anything with a long reach fires from where it stands; something that bites has to walk up first.
  let prey: Target[] = def.range > 1 ? preyNear(s, home, def.range) : [];
  if (def.teleports) {
    // It turns up wherever it can reach something, and nowhere in particular when it cannot.
    const den = ambushSpot(s, rng, idx, a, def.range) ?? landingSpot(s, rng, idx, a.id);
    if (den && (den.x !== a.x || den.y !== a.y)) {
      events.push({ type: 'warp', target: ref, from: home, to: den });
      a.x = den.x;
      a.y = den.y;
    }
    prey = preyNear(s, a, def.range);
  } else if (!prey.length) {
    creep(s, idx, a, def.move, nearestAsset(s, home), 0.7, rng, events);
    prey = preyNear(s, a, def.range);
  }
  if (prey.length) {
    bite(s, ref, prey, def, a, events);
    // Gone again at once, so nothing that could not answer on the spot gets a chance — unless a gun already put it down.
    if (def.teleports && alienById(s, a.id)) {
      const away = vanishSpot(s, rng, a);
      if (away) {
        events.push({ type: 'warp', target: ref, from: { x: a.x, y: a.y }, to: away });
        a.x = away.x;
        a.y = away.y;
      }
    }
  }
  if (def.brood && alienById(s, a.id)) hatch(s, rng, a, def.brood, events);
}

/** A small spider makes for whatever took its fancy, then bites whatever it comes across. */
function spiderTurn(s: GameState, rng: Rng, spider: Spiderling, events: GameEvent[]): void {
  if (s.phase === 'gameover') return;
  const ref: EntityRef = { kind: 'spider', id: spider.id };
  let prey = preyNear(s, spider, SPIDERLING.range);
  if (!prey.length) {
    const goal = rng.pick(everyAsset(s));
    if (goal) creep(s, new BoardIndex(s), spider, SPIDERLING.move, goal, 1, rng, events);
    prey = preyNear(s, spider, SPIDERLING.range);
  }
  // It attacks at random: whatever is in reach, not the softest.
  if (prey.length) bite(s, ref, [rng.pick(prey)], SPIDERLING, spider, events);
}

/** The aliens' go, right after the dice: each in turn, then the spiders. They never turn on one another. */
function aliensTurn(s: GameState, rng: Rng, events: GameEvent[]): void {
  // Each gun answers the aliens once this round, whoever it belongs to and whoever they strike.
  for (const p of s.players) for (const b of p.buildings) b.reacted = false;
  for (const a of [...s.aliens]) alienTurn(s, rng, a, events);
  for (const b of [...s.brood]) spiderTurn(s, rng, b, events);
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function beginTurn(s: GameState, events: GameEvent[]): void {
  for (const p of s.players) for (const b of p.buildings) b.reacted = false;
  while (s.orderIndex < s.order.length && !s.players[s.order[s.orderIndex]].alive) s.orderIndex++;
  if (s.orderIndex >= s.order.length) {
    if (s.turn >= s.totalTurns) {
      finishGame(s, 'turns', events);
      return;
    }
    s.turn++;
    s.phase = 'roundStart';
    s.currentPlayer = -1;
    events.push({ type: 'roundStart', turn: s.turn });
    return;
  }
  const p = s.players[s.order[s.orderIndex]];
  s.phase = 'player';
  s.currentPlayer = p.id;
  for (const u of p.units) {
    u.moveUsed = false;
    u.attackUsed = false;
  }
  for (const b of p.buildings) b.fired = false;
  p.producedThisTurn = {};
  events.push({ type: 'turnStart', player: p.id });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(s: GameState, a: Action): Result {
  const events: GameEvent[] = [];
  const rng = new Rng(s.rng);
  let fail: string | null = null;
  const bad = (reason: string): void => {
    fail = reason;
  };
  const cur = (): PlayerState => s.players[s.currentPlayer];
  const inTurn = s.phase === 'player' && s.currentPlayer >= 0;

  switch (a.type) {
    case 'ROLL_DICE': {
      if (s.phase !== 'roundStart') bad('现在不能掷骰子');
      else {
        const dice = rollDice(rng, s.players.filter((p) => p.alive).map((p) => p.id));
        for (const d of dice) s.players[d.player].ap = d.ap;
        s.dice = dice;
        s.order = dice.map((d) => d.player);
        s.orderIndex = 0;
        s.alienActed = false;
        s.phase = 'dice';
        events.push({ type: 'dice', turn: s.turn, dice });
        const n = (id: number): string => s.players[id].name;
        addLog(
          s,
          `第 ${s.turn} 回合掷骰：${dice.map((d) => `${n(d.player)} ${d.rolls[0]} 点`).join('，')}。${n(dice[0].player)} +3 行动点，${n(dice[dice.length - 1].player)} +1 行动点`,
          'info',
        );
        // A new alien every few rounds, as long as the board is not holding two already.
        if (s.turn >= s.nextAlien) {
          if (s.aliens.length < ALIEN_CAP) spawnAlien(s, rng, events);
          s.nextAlien = s.turn + rng.int(ALIEN_EVERY[0], ALIEN_EVERY[1]);
        }
      }
      break;
    }
    case 'NEXT': {
      // The aliens have their go once the dice are settled, before anybody else moves.
      if (s.phase === 'dice' && !s.alienActed && (s.aliens.length > 0 || s.brood.length > 0)) {
        aliensTurn(s, rng, events);
        s.alienActed = true;
        // Their attack may have been the last word: then the game is over, not theirs.
        if (s.phase === 'dice') s.phase = 'aliens';
      } else if (s.phase === 'dice' || s.phase === 'aliens') beginTurn(s, events);
      else bad('现在不能继续');
      break;
    }
    case 'END_TURN': {
      if (!inTurn) bad('现在不能结束回合');
      else {
        s.orderIndex++;
        beginTurn(s, events);
      }
      break;
    }
    case 'HARVEST': {
      const p = cur();
      if (!inTurn) bad('现在不能采集');
      else if (p.ap < 1) bad('行动点不足');
      else if (p.trucks < 1) bad('没有资源运输车');
      else if (!(a.resource in RESOURCES)) bad('未知的资源');
      else {
        p.ap--;
        const amount = HARVEST_YIELD * p.trucks;
        p.resources[a.resource] += amount;
        events.push({ type: 'harvest', player: p.id, resource: a.resource, amount, trucks: p.trucks });
        addLog(s, `${p.name} 的 ${p.trucks} 台运输车运回${RESOURCES[a.resource].name} +${amount}`, 'good', p.id);
      }
      break;
    }
    case 'BUILD': {
      const p = cur();
      if (!inTurn) bad('现在不能建造');
      else {
        // A player who picked a tile gets exactly that tile; otherwise the
        // building is parked in the tidiest spot left.
        const err = a.x === undefined || a.y === undefined ? canBuild(s, p, a.key) : placementError(s, p, a.key, a.x, a.y);
        if (err) bad(err);
        else {
          const def = BUILDINGS[a.key];
          pay(p, def.levels[0].cost);
          // The net has no footprint: park its centre on the HQ.
          const at =
            def.w === 0
              ? { x: (hqOf(p)?.x ?? 0) + (HQ_SIZE - 1) / 2, y: (hqOf(p)?.y ?? 0) + (HQ_SIZE - 1) / 2, w: 0, h: 0 }
              : a.x === undefined || a.y === undefined
                ? findPlacement(s, p, def)!
                : { x: a.x, y: a.y, w: def.w, h: def.h };
          const b: Building = {
            id: s.nextId++,
            key: a.key,
            level: 1,
            hp: def.hp,
            maxHp: def.hp,
            x: at.x,
            y: at.y,
            w: at.w,
            h: at.h,
            powered: false,
            fired: false,
            reacted: false,
          };
          p.buildings.push(b);
          recomputePower(p);
          events.push({ type: 'build', player: p.id, buildingId: b.id });
          addLog(s, `${p.name} 建造了${def.levels[0].name}`, 'good', p.id);
          if (!b.powered && def.needsPower) addLog(s, `${def.levels[0].name}没有电力，无法工作`, 'warn', p.id);
        }
      }
      break;
    }
    case 'UPGRADE': {
      const p = cur();
      if (!inTurn) bad('现在不能升级');
      else {
        const err = canUpgrade(p, a.buildingId);
        if (err) bad(err);
        else {
          const b = p.buildings.find((x) => x.id === a.buildingId)!;
          const def = BUILDINGS[b.key];
          const next = nextLevelOf(b)!;
          pay(p, next.cost);
          b.level++;
          // A force field has no walls to thicken; everything else is reinforced by its upgrade.
          if (def.hp > 0) {
            b.maxHp += UPGRADE_HP_BONUS;
            b.hp += UPGRADE_HP_BONUS;
          }
          events.push({ type: 'upgrade', player: p.id, buildingId: b.id });
          addLog(s, `${p.name} 升级为${next.name}`, 'good', p.id);
          if (b.key === 'hq') expandBase(s, p, b, events);
        }
      }
      break;
    }
    case 'PRODUCE': {
      const p = cur();
      if (!inTurn) bad('现在不能生产');
      else if (!(a.unit in UNITS)) bad('未知的单位');
      else {
        const err = canProduce(s, p, a.unit);
        if (err) bad(err);
        else {
          const ud = UNITS[a.unit];
          const bk = ud.producedBy!;
          const on = producersOf(p, bk).on;
          pay(p, ud.cost);
          if (a.unit === 'truck') {
            p.trucks++;
            events.push({ type: 'produce', player: p.id, unitId: 0, unitKey: 'truck' });
          } else {
            const spot = findSpawn(s, p, ud.unitClass, on[0])!;
            const u: Unit = { id: s.nextId++, key: a.unit, owner: p.id, x: spot.x, y: spot.y, hp: ud.hp, moveUsed: false, attackUsed: false };
            p.units.push(u);
            p.producedThisTurn[bk] = (p.producedThisTurn[bk] ?? 0) + 1;
            events.push({ type: 'produce', player: p.id, unitId: u.id, unitKey: a.unit });
          }
          addLog(s, `${p.name} 生产了${ud.name}`, 'info', p.id);
        }
      }
      break;
    }
    case 'MOVE': {
      const p = cur();
      if (!inTurn) {
        bad('现在不能移动');
        break;
      }
      const u = p.units.find((x) => x.id === a.unitId);
      if (!u) bad('找不到该单位');
      else if (u.moveUsed) bad('该单位本回合已经移动过');
      else {
        const path = reachable(new BoardIndex(s), s, u, moveModeOf(u.key), UNITS[u.key].move, u.id).get(key(a.x, a.y));
        if (!path) bad('无法到达该位置');
        else {
          u.x = a.x;
          u.y = a.y;
          u.moveUsed = true;
          events.push({ type: 'move', unitId: u.id, path });
        }
      }
      break;
    }
    case 'ATTACK': {
      const p = cur();
      if (!inTurn) {
        bad('现在不能攻击');
        break;
      }
      const src = sourceOf(s, p, a.source);
      if (typeof src === 'string') bad(src);
      else {
        const srcUnit = src.ref.kind === 'unit' ? p.units.find((x) => x.id === src.ref.id) : undefined;
        const t = targetOf(s, a.target);
        if (!t) bad('目标不存在');
        else if (t.owner === p.id) bad('不能攻击自己的目标');
        else if (!canReach(s, src, t)) {
          bad(t.cls === 'air' ? '只有防空武器能攻击空中单位' : '目标超出射程');
        } else {
          if (srcUnit) srcUnit.attackUsed = true;
          else p.buildings.find((x) => x.id === src.ref.id)!.fired = true;
          events.push({ type: 'attack', source: src.ref, target: t.ref, from: src.pos, to: t.pos, shots: src.stats.shots, style: src.fx });
          strike(s, p.id, t, src.stats, events);
          if (t.ref.kind === 'building' && srcUnit) {
            retaliate(s, t.owner, { ref: { kind: 'unit', id: srcUnit.id }, pos: src.pos, cls: UNITS[srcUnit.key].unitClass }, events);
          }
        }
      }
      break;
    }
  }

  if (fail) return { ok: false, reason: fail };
  s.rng = rng.state;
  return { ok: true, events };
}

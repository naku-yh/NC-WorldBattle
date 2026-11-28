import {
  ALIEN_CAP,
  ALIEN_EVERY,
  ALIEN_GROWTH,
  ALIEN_KEYS,
  ALIENS,
  AP_BY_RANK,
  BOARD_SIZE,
  BROOD_CAP,
  BUILDABLE,
  BUILDINGS,
  CITY,
  CITY_CRUSH,
  CITY_RANGE,
  HARVEST_YIELD,
  HIDDEN_CHANCE,
  HIDDEN_KEYS,
  HQ_SIZE,
  MAX_BOARD,
  MIN_BOARD,
  MIN_TURNS,
  MINIONS,
  PLAYER_COLORS,
  PLAYER_NAMES,
  PROMOTE_COST,
  RANKS,
  RESOURCES,
  SCORE_BUILDING,
  SCORE_LAST_HIT,
  SCORE_SPIDER,
  SCORE_UNIT,
  SECOND_FORMS,
  SKELETON,
  SPIDERLING,
  START_RESOURCES,
  START_TRUCKS,
  UNITS,
  UPGRADE_HP_BONUS,
  isHidden,
} from './data';
import { Rng } from './rng';
import {
  BoardIndex,
  DIRS4,
  DIRS8,
  FACTORY_LOCAL,
  NODE_LAYOUT,
  RALLY_LOCAL,
  SEAT_CORNERS,
  buildingCenter,
  tilesOf,
  cheb,
  cityAt,
  cornersOf,
  distToBuilding,
  footprint,
  holderOf,
  inBoard,
  isFree,
  isMusterLocal,
  isReservedLocal,
  key,
  laneOf,
  moveModeOf,
  nearestOpen,
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
  AlienKey,
  AlienState,
  AttackStyle,
  BonusClass,
  Building,
  BuildingDef,
  BuildingKey,
  BuildingLevel,
  CityBuilding,
  CombatStats,
  Cost,
  DiceEntry,
  Difficulty,
  EntityRef,
  GameConfig,
  GameEvent,
  GameState,
  Minion,
  MinionDef,
  MoveMode,
  PlayerState,
  Pt,
  ResourceKey,
  ResourceNode,
  SplashHit,
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
  const difficulty: Difficulty = cfg.difficulty ?? 'high';
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
      resources: { ...START_RESOURCES[difficulty] },
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
  const map =
    cfg.terrain === 'plain'
      ? { terrain: plainTerrain(boardSize), waterway: board.waterway, city: [] as Array<{ kind: CityBuilding['kind']; x: number; y: number }> }
      : generateTerrain(rng, boardSize, players.map((p) => p.corner));

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
    city: map.city.map((c) => ({ id: nextId++, kind: c.kind, x: c.x, y: c.y, hp: CITY[c.kind].hp, occupants: [] })),
    difficulty,
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
  // As each unit stands, rank and all; the ground under it is left out of the count.
  for (const u of p.units) n += rankStats(u.key, rankOf(u)).attack * UNITS[u.key].shots;
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

/** `attackOn`, and twice as much again for whatever the weapon is specially hard on. `vs` is what the target is: a soldier, a tank or an alien. */
export function attackAgainst(st: Pick<CombatStats, 'attack' | 'airAttack' | 'doubleVs'>, cls: TargetClass, vs: BonusClass | null = null): number {
  const attack = attackOn(st, cls);
  return vs && st.doubleVs?.includes(vs) ? attack * 2 : attack;
}

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
      if (idx.blocked.has(k) || idx.city.has(k)) return '这里已有建筑或资源点';
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
  /** What it is, for the weapons that hit some things twice as hard: a soldier, a tank or an alien. */
  vs: BonusClass | null;
  name: string;
  /** Live object so callers can take HP off it. */
  obj: Unit | Building | AlienState | Minion | CityBuilding;
  isHq: boolean;
}

export function alienById(s: GameState, id: number): AlienState | null {
  return s.aliens.find((a) => a.id === id) ?? null;
}

/** Adds `more` into `into`, player by player. */
function addLedger(into: Record<number, number>, more: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = { ...into };
  for (const [k, v] of Object.entries(more)) out[Number(k)] = (out[Number(k)] ?? 0) + v;
  return out;
}

/**
 * An alien's figures as it stands. The first to arrive in a match has the
 * reference card's; every one after is stronger than the last by `ALIEN_GROWTH`
 * of the card's life, attack and defence. How far it reaches and how it gets
 * about are the same for all of a kind, and the hidden ones grow just as the
 * others do.
 *
 * A hidden one that is down stands in its second shape's figures instead
 * (`SECOND_FORMS`), grown by the same share as its first, and worth no more
 * and no less than before.
 */
export function alienStats(a: AlienState): AlienDef {
  const d = ALIENS[a.key];
  // Down is out for a second shape: it does not change or split again, whatever the first one did.
  let card: AlienDef = d;
  if (isHidden(a.key) && a.form === 2 && SECOND_FORMS[a.key]) {
    const { changes, splits, ...first } = d;
    card = { ...first, ...SECOND_FORMS[a.key]! };
  }
  const scale = 1 + ALIEN_GROWTH * ((a.wave ?? 1) - 1);
  if (scale === 1) return card;
  const grown = (n: number): number => Math.round(n * scale);
  return { ...card, hp: grown(card.hp), attack: grown(card.attack), defense: grown(card.defense), ...(card.counter === undefined ? {} : { counter: grown(card.counter) }) };
}

export function minionById(s: GameState, id: number): Minion | null {
  return s.brood.find((b) => b.id === id) ?? null;
}

/** What one of the aliens' small fry can do: a spider's card, unless it says it is a skeleton. */
export const minionDef = (b: Minion): MinionDef => MINIONS[b.kind ?? 'spider'];

export function unitById(s: GameState, id: number): { unit: Unit; owner: PlayerState } | null {
  for (const p of s.players) {
    const unit = p.units.find((x) => x.id === id);
    if (unit) return { unit, owner: p };
  }
  return null;
}

/** Whether a unit still has an order it may take this turn: a move, or a shot it has not fired. Inside a building there is nowhere to move to. */
export function canStillAct(u: Unit): boolean {
  const d = UNITS[u.key];
  if (u.inside !== undefined) return d.attack > 0 && !u.attackUsed;
  return !u.moveUsed || (d.attack > 0 && !u.attackUsed);
}

export function cityById(s: GameState, id: number): CityBuilding | null {
  return s.city.find((c) => c.id === id) ?? null;
}

/** A unit's rank, from 1: the first for anything that does not say (see `RANKS`). */
export const rankOf = (u: Pick<Unit, 'rank'>): number => u.rank ?? 1;

/**
 * A fighting unit's card figures at a rank: attack (what it has for aircraft
 * included) and life by the rank's share of the card's, each rounded to a
 * whole point, and armour by the rank's fixed addition to the card's.
 */
export function rankStats(k: UnitKey, rank = 1): { attack: number; airAttack?: number; hp: number; defense: number } {
  const d = UNITS[k];
  const r = RANKS[Math.min(RANKS.length, Math.max(1, rank)) - 1];
  return {
    attack: Math.round(d.attack * r.power),
    ...(d.airAttack === undefined ? {} : { airAttack: Math.round(d.airAttack * r.power) }),
    hp: Math.round(d.hp * r.power),
    defense: d.defense + r.armor,
  };
}

/** How much life a unit has at full strength: the card's, grown with its rank. */
export const maxHpOf = (u: Pick<Unit, 'key' | 'rank'>): number => rankStats(u.key, rankOf(u)).hp;

/** A unit's armour at its rank plus whatever the ground beneath it adds. Never negative. */
export function defenseOf(s: GameState, u: Unit): number {
  const d = UNITS[u.key];
  return Math.max(0, rankStats(u.key, rankOf(u)).defense + (terrainEffect(s, d.family, u.x, u.y).defense ?? 0));
}

/** A unit type's figures at a rank, straight off the reference card as the rank has grown them. */
export function baseStats(k: UnitKey, rank = 1): CombatStats {
  const { shots, range, canHit, pierce, doubleVs, splash } = UNITS[k];
  const r = rankStats(k, rank);
  return {
    attack: r.attack,
    shots,
    ...(r.airAttack === undefined ? {} : { airAttack: r.airAttack }),
    defense: r.defense,
    range,
    canHit,
    pierce,
    ...(doubleVs ? { doubleVs } : {}),
    ...(splash ? { splash } : {}),
  };
}

/** A unit's stats as it stands: its own at its rank, adjusted by the terrain it is on. */
export function statsOf(s: GameState, u: Unit): CombatStats {
  const d = UNITS[u.key];
  const r = rankStats(u.key, rankOf(u));
  const e = terrainEffect(s, d.family, u.x, u.y);
  const by = e.attack ?? 0;
  // From inside a house or tower a weapon reaches no further than its windows let it.
  const reach = u.inside === undefined ? Infinity : CITY_RANGE;
  return {
    attack: Math.max(0, r.attack + by),
    shots: d.shots,
    // The ground counts for as much against aircraft as against anything else.
    ...(r.airAttack === undefined ? {} : { airAttack: Math.max(0, r.airAttack + by) }),
    defense: defenseOf(s, u),
    // A weapon always reaches the next tile over, whatever woods it is sitting in.
    range: d.range > 0 ? Math.max(1, Math.min(reach, d.range + (e.range ?? 0))) : 0,
    canHit: d.canHit,
    pierce: d.pierce,
    ...(d.doubleVs ? { doubleVs: d.doubleVs } : {}),
    ...(d.splash ? { splash: d.splash } : {}),
  };
}

/** What the promotion from `rank` costs, by resource: a share of the unit's own price (see `PROMOTE_COST`). */
export function promoteCost(k: UnitKey, rank = 1): Cost {
  const out: Cost = {};
  const share = PROMOTE_COST[rank - 1] ?? 0;
  for (const key of RES_KEYS) {
    const v = Math.round((UNITS[k].cost[key] ?? 0) * share);
    if (v) out[key] = v;
  }
  return out;
}

/** Why player `p` cannot raise the unit to its next rank, or null when they can. Whether it is their turn is for the order to say. */
export function canPromote(p: PlayerState, unitId: number): string | null {
  const u = p.units.find((x) => x.id === unitId);
  if (!u) return '找不到该单位';
  if (rankOf(u) >= RANKS.length) return '已是最高军衔';
  if (!canAfford(p, promoteCost(u.key, rankOf(u)))) return '资源不足';
  return null;
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
    const d = alienStats(a);
    return { ref, owner: -1, pos: { x: a.x, y: a.y }, defense: d.defense, cls: d.flies ? 'air' : 'ground', vs: 'alien', name: d.name, obj: a, isHq: false };
  }
  if (ref.kind === 'brood') {
    const b = minionById(s, ref.id);
    if (!b) return null;
    const d = minionDef(b);
    return { ref, owner: -1, pos: { x: b.x, y: b.y }, defense: d.defense, cls: 'ground', vs: 'alien', name: d.name, obj: b, isHq: false };
  }
  if (ref.kind === 'unit') {
    const hit = unitById(s, ref.id);
    // Nobody inside a building can be shot at: only the building can.
    if (!hit || hit.unit.inside !== undefined) return null;
    const d = UNITS[hit.unit.key];
    return {
      ref,
      owner: hit.owner.id,
      pos: { x: hit.unit.x, y: hit.unit.y },
      defense: defenseOf(s, hit.unit),
      cls: d.unitClass,
      vs: d.family === 'soldier' || d.family === 'tank' ? d.family : null,
      name: d.name,
      obj: hit.unit,
      isHq: false,
    };
  }
  if (ref.kind === 'city') {
    const c = cityById(s, ref.id);
    if (!c) return null;
    const holder = holderOf(s, c);
    return { ref, owner: holder ? holder.id : -1, pos: { x: c.x, y: c.y }, defense: CITY[c.kind].defense, cls: 'building', vs: null, name: CITY[c.kind].name, obj: c, isHq: false };
  }
  const hit = buildingById(s, ref.id);
  if (!hit || !targetable(hit.building)) return null;
  return {
    ref,
    owner: hit.owner.id,
    pos: buildingCenter(hit.building),
    defense: netDefense(hit.owner),
    cls: 'building',
    vs: null,
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
  if (!p || !u || u.moveUsed || u.inside !== undefined) return [];
  const idx = new BoardIndex(s);
  // The soldier itself goes in with the question: it is what lets its own kind through a building's door.
  return [...reachable(idx, s, u, moveModeOf(u.key), UNITS[u.key].move, u.id, u).values()].map((path) => path[path.length - 1]);
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
    const t = targetOf(s, { kind: 'brood', id: b.id });
    if (t && canReach(s, c, t)) out.push(t.ref);
  }
  // A house or tower the other side holds is shot at like any building: that is the only way at the soldiers inside it.
  for (const city of s.city) {
    const holder = holderOf(s, city);
    if (!holder || holder.id === p.id) continue;
    const t = targetOf(s, { kind: 'city', id: city.id });
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
 * Everyone rolls at once. The places are worth what `AP_BY_RANK` says: with
 * four players first, second and third all get something, with fewer only the
 * top and the bottom do. Ties are settled by re-rolling only the tied players,
 * for the top spot and the bottom spot, and with four players for second place
 * too. The returned list is in play order.
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
  // Between the two ends everyone is placed by their last roll, lowest last. With four players second place is worth
  // more than third, so two that are still level there throw for it.
  const middle = rest.filter((e) => e !== lastE);
  middle.sort((a, b) => last(b) - last(a) || a.player - b.player);
  if (middle.length === 2 && last(middle[0]) === last(middle[1])) {
    const second = rollOff(rng, middle, 'max');
    middle.sort((a, b) => (b === second ? 1 : 0) - (a === second ? 1 : 0));
  }
  const order = [first, ...middle, lastE];
  const worth = AP_BY_RANK[order.length] ?? AP_BY_RANK[2];
  order.forEach((e, i) => {
    e.rank = i;
    e.ap = worth[i] ?? 0;
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

/** Takes `dmg` off `t`, notes it, and takes the thing itself away should nothing be left of it. */
function applyDamage(s: GameState, attacker: number, t: Target, dmg: number, events: GameEvent[]): void {
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

type AttackEvent = Extract<GameEvent, { type: 'attack' }>;

/**
 * What a splash weapon catches on the four tiles round what it was aimed at,
 * up, down, left and right: whatever of the other side's stands on them, each
 * for half the attack before its own defence. A structure is struck over every
 * tile of it, so the blast reaches round its whole footprint.
 */
function splashAround(s: GameState, attacker: number, t: Target, st: CombatStats): Array<{ hit: Target; dmg: number }> {
  const idx = new BoardIndex(s);
  const seeds = t.ref.kind === 'building' ? tilesOf(t.obj as Building) : [t.pos];
  const half = Math.floor(attackOn(st, 'ground') / 2);
  const done = new Set<string>([`${t.ref.kind}:${t.ref.id}`]);
  const out: Array<{ hit: Target; dmg: number }> = [];
  const take = (ref: EntityRef): void => {
    const k = `${ref.kind}:${ref.id}`;
    if (done.has(k)) return;
    done.add(k);
    const hit = targetOf(s, ref);
    // Never anything of the shooter's own, and nothing this weapon could not have been aimed at in the first place.
    if (!hit || hit.owner === attacker || !st.canHit.includes(hit.cls)) return;
    out.push({ hit, dmg: netDamage(half, hit.defense, st.pierce) });
  };
  for (const q of seeds) {
    for (const [dx, dy] of DIRS4) {
      const x = q.x + dx;
      const y = q.y + dy;
      if (!inBoard(x, y, s.boardSize)) continue;
      const k = key(x, y);
      // Wings are above the blast: only something standing on the ground is caught.
      const u = idx.ground.get(k);
      if (u) {
        take({ kind: 'unit', id: u.id });
        continue;
      }
      const beast = idx.others.get(k);
      if (beast !== undefined) {
        take(alienById(s, beast) ? { kind: 'alien', id: beast } : { kind: 'brood', id: beast });
        continue;
      }
      const house = cityAt(s, x, y);
      if (house) {
        take({ kind: 'city', id: house.id });
        continue;
      }
      const b = s.players.flatMap((pl) => pl.buildings).find((b) => b.w > 0 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
      if (b) take({ kind: 'building', id: b.id });
    }
  }
  return out;
}

/**
 * One full attack from `source` at `t`: the shot on its way, then all it does,
 * splash included. Whatever it catches that hits back (see `counter`) strikes
 * in return, unless this shot is itself such a blow.
 */
function shoot(
  s: GameState,
  attacker: number,
  source: EntityRef,
  from: Pt,
  t: Target,
  st: CombatStats,
  style: AttackStyle,
  events: GameEvent[],
  echo = false,
): AttackEvent {
  const shot: AttackEvent = { type: 'attack', source, target: t.ref, from, to: t.pos, shots: st.shots, style };
  events.push(shot);
  // Who the blast will catch is settled before the shot lands: soldiers thrown out of a collapsing building are not caught by the shell that brought it down.
  const around = st.splash === 'cross' ? splashAround(s, attacker, t, st) : [];
  // Each shell is worked out on its own, so armour tells twice against a weapon that fires twice.
  const attack = attackAgainst(st, t.cls, t.vs);
  let dmg = 0;
  for (let i = 0; i < st.shots; i++) dmg += netDamage(attack, t.defense, st.pierce);
  applyDamage(s, attacker, t, dmg, events);
  if (!echo) counter(s, t.ref, source, events);
  if (around.length) shot.splash = [];
  for (const { hit, dmg: side } of around) {
    applyDamage(s, attacker, hit, side, events);
    if (!echo) counter(s, hit.ref, source, events);
    shot.splash!.push({ target: hit.ref, amount: side, pos: hit.pos });
  }
  return shot;
}

/**
 * 雅千's answer to being struck: the attack set aside for it on her card, at
 * once, at whatever struck her, from however far away it did. A blow that is itself an answer sets off
 * no other (the `echo` on `shoot`), so nothing goes back and forth for ever.
 * Nor do the base guns ever answer one: only a shot of hers that opens the
 * exchange brings them out (see `bite` and the ATTACK order).
 */
function counter(s: GameState, struck: EntityRef, by: EntityRef, events: GameEvent[]): void {
  // Only something of the players' can have struck her: aliens never turn on one another.
  if (struck.kind !== 'alien' || (by.kind !== 'unit' && by.kind !== 'building')) return;
  const a = alienById(s, struck.id);
  // Down, or changed shape under the blow, there is nothing left to answer with.
  if (!a) return;
  const def = alienStats(a);
  const t = targetOf(s, by);
  if (def.counter === undefined || !t) return;
  addLog(s, `${def.name}反击`, 'combat');
  // With the attack set aside for striking back, not the one she attacks with.
  shoot(s, -1, struck, { x: a.x, y: a.y }, t, { ...def, attack: def.counter }, def.fx, events, true);
}

/** Up to `n` tiles round a house or tower that a foot soldier could stand on: its own tile once the building is gone, then the eight about it. */
function roomAround(s: GameState, c: CityBuilding, n: number, idx = new BoardIndex(s)): Pt[] {
  const out: Pt[] = [];
  const take = (x: number, y: number): void => {
    if (out.length >= n || !isFree(idx, s, x, y, 'foot')) return;
    out.push({ x, y });
    // Taken, as far as the next one to look is concerned.
    idx.ground.set(key(x, y), { id: -1 } as Unit);
  };
  if (!cityAt(s, c.x, c.y)) take(c.x, c.y);
  for (const [dx, dy] of DIRS8) take(c.x + dx, c.y + dy);
  return out;
}

/**
 * Brings a house or tower's soldiers out into the open, each `hurt` the worse
 * for it, and says where each came to stand. The building is left empty.
 */
function spill(s: GameState, c: CityBuilding, hurt: number, attacker: number, events: GameEvent[]): Extract<GameEvent, { type: 'leave' }> {
  const idx = new BoardIndex(s);
  const spots = roomAround(s, c, c.occupants.length, idx);
  const out: Array<{ unitId: number; x: number; y: number }> = [];
  c.occupants.forEach((id, i) => {
    const found = unitById(s, id);
    if (!found) return;
    const { unit, owner } = found;
    unit.hp -= hurt;
    if (hurt > 0) events.push({ type: 'damage', target: { kind: 'unit', id }, amount: hurt, pos: { x: c.x, y: c.y } });
    const gone = (): void => {
      owner.units = owner.units.filter((u) => u.id !== id);
    };
    if (unit.hp <= 0) {
      gone();
      if (attacker >= 0) {
        s.players[attacker].kills++;
        award(s, attacker, SCORE_UNIT[unit.key], events);
      }
      return;
    }
    delete unit.inside;
    // Round about, or the nearest clear ground anywhere if the crowd there leaves no room.
    const at = spots[i] ?? nearestOpen(s, c, 'foot', idx);
    if (!at) {
      gone();
      return;
    }
    unit.x = at.x;
    unit.y = at.y;
    idx.ground.set(key(at.x, at.y), unit);
    out.push({ unitId: id, x: at.x, y: at.y });
  });
  c.occupants = [];
  return { type: 'leave', city: c.id, units: out };
}

/** Why `u` cannot move into the house or tower `c`. */
function entryError(s: GameState, u: Unit, c: CityBuilding): string {
  if (!UNITS[u.key].garrison) return '该单位无法进驻建筑';
  const holder = holderOf(s, c);
  if (holder && holder.id !== u.owner) return `建筑里有${holder.name}的士兵，要先把它摧毁`;
  if (c.occupants.length >= CITY[c.kind].room) return '建筑里已经满了';
  return '无法到达该位置';
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
 * bonus on top. What was done to the shapes it came from counts as well
 * (`carried`).
 *
 * A small giant with a brother still standing is not the end of 泽参: nothing
 * is paid out yet, and what was done to it is handed on to whoever is left,
 * to be paid for once the last of them has gone down.
 */
function killAlien(s: GameState, id: number, hero: number, events: GameEvent[]): void {
  const alien = alienById(s, id);
  if (!alien) return;
  const card = ALIENS[alien.key];
  const def = alienStats(alien);
  s.aliens = s.aliens.filter((a) => a.id !== id);
  // Its small fry do not outlive it.
  for (const b of s.brood.filter((x) => x.owner === id)) events.push({ type: 'destroyed', target: { kind: 'brood', id: b.id }, pos: { x: b.x, y: b.y } });
  s.brood = s.brood.filter((x) => x.owner !== id);
  const hurt = addLedger(alien.carried ?? {}, alien.hurt);
  // Pieces of one giant are told apart by the arrival they came with: there is never a second of a kind in the same one.
  const kin = alien.form === 2 && card.splits ? s.aliens.filter((o) => o.key === alien.key && o.form === 2 && o.wave === alien.wave) : [];
  if (kin.length) {
    // Only what was done to this one itself moves across: every piece set out with the giant's toll, and has taken in each brother's as it fell.
    for (const o of kin) o.carried = addLedger(o.carried ?? {}, alien.hurt);
    addLog(s, `${def.name}被击碎，还有 ${kin.length} 只`, 'combat', hero >= 0 ? hero : undefined);
    return;
  }
  const total = Object.values(hurt).reduce((n, v) => n + v, 0);
  const rewards: Record<number, Cost> = {};
  const points: Record<number, number> = {};
  const parts: string[] = [];
  for (const p of s.players) {
    const share = total > 0 ? (hurt[p.id] ?? 0) / total : 0;
    const r: Cost = {};
    for (const k of Object.keys(card.reward) as ResourceKey[]) {
      const v = Math.round((card.reward[k] ?? 0) * share);
      if (v > 0) {
        r[k] = v;
        p.resources[k] += v;
      }
    }
    const pts = Math.round(card.bounty * share) + (p.id === hero ? SCORE_LAST_HIT : 0);
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

/**
 * 拓龙, struck down in its first shape, takes its second one where it stood:
 * whole again, and flying now. What was done to the first shape is carried
 * over, to be paid for once the second has gone down too.
 */
function morph(s: GameState, a: AlienState, events: GameEvent[]): void {
  const first = alienStats(a);
  const next = SECOND_FORMS[a.key]!;
  a.carried = addLedger(a.carried ?? {}, a.hurt);
  a.hurt = {};
  a.form = 2;
  // Whole again, as strong as its arrival makes it.
  a.hp = alienStats(a).hp;
  events.push({ type: 'morph', id: a.id, key: a.key, x: a.x, y: a.y });
  addLog(s, `警报：${first.name}倒下了，却又化作${next.look}腾空而起！`, 'warn');
}

/**
 * 泽参, struck down, breaks into as many small giants as there is room for on
 * the free tiles round it, each carrying what was done to the giant. With
 * nowhere for even one to stand it is simply dead, and false comes back so
 * that the reward goes round at once.
 */
function splitAlien(s: GameState, a: AlienState, events: GameEvent[]): boolean {
  const giant = alienStats(a);
  const small = SECOND_FORMS[a.key]!;
  const idx = new BoardIndex(s);
  // Its own tile is about to be free, but the pieces come to stand round about, not where it stood.
  const room: Pt[] = [];
  for (const [dx, dy] of DIRS8) if (isFree(idx, s, a.x + dx, a.y + dy, 'foot', a.id)) room.push({ x: a.x + dx, y: a.y + dy });
  if (!room.length) return false;
  const at = { x: a.x, y: a.y };
  s.aliens = s.aliens.filter((o) => o.id !== a.id);
  const toll = addLedger(a.carried ?? {}, a.hurt);
  const ids: number[] = [];
  for (const spot of room.slice(0, giant.splits)) {
    const piece: AlienState = { id: s.nextId++, key: a.key, x: spot.x, y: spot.y, hp: 0, arrived: a.arrived, wave: a.wave, hurt: {}, form: 2, carried: { ...toll } };
    // As strong as the giant's arrival makes them.
    piece.hp = alienStats(piece).hp;
    s.aliens.push(piece);
    ids.push(piece.id);
  }
  events.push({ type: 'destroyed', target: { kind: 'alien', id: a.id }, pos: at });
  events.push({ type: 'split', from: a.id, key: a.key, ids });
  addLog(s, `警报：${giant.name}碎成了 ${ids.length} 只${small.name}！`, 'warn');
  return true;
}

function destroyTarget(s: GameState, t: Target, attacker: number, events: GameEvent[]): void {
  if (t.ref.kind === 'alien') {
    // Down is not out for the hidden ones: 拓龙 rises again in its second shape, 泽参 breaks into pieces.
    const def = alienStats(t.obj as AlienState);
    if (def.changes) {
      morph(s, t.obj as AlienState, events);
      return;
    }
    if (def.splits && splitAlien(s, t.obj as AlienState, events)) return;
    events.push({ type: 'destroyed', target: t.ref, pos: t.pos });
    killAlien(s, t.ref.id, attacker, events);
    return;
  }
  events.push({ type: 'destroyed', target: t.ref, pos: t.pos });
  if (t.ref.kind === 'brood') {
    const def = minionDef(t.obj as Minion);
    s.brood = s.brood.filter((b) => b.id !== t.ref.id);
    if (attacker >= 0) {
      const p = s.players[attacker];
      for (const k of RES_KEYS) p.resources[k] += def.reward[k] ?? 0;
      award(s, attacker, SCORE_SPIDER, events);
    }
    addLog(s, `${whoName(s, attacker)} 消灭了${def.name}`, 'combat', attacker >= 0 ? attacker : undefined);
    return;
  }
  if (t.ref.kind === 'city') {
    const fallen = t.obj as CityBuilding;
    const holder = holderOf(s, fallen);
    s.city = s.city.filter((c) => c.id !== fallen.id);
    // Those inside are thrown out into the open, worse for it.
    events.push(spill(s, fallen, CITY_CRUSH, attacker, events));
    addLog(s, `${whoName(s, attacker)} 摧毁了${holder ? ` ${holder.name} 占领的` : ''}${t.name}`, 'combat', attacker >= 0 ? attacker : undefined);
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
    addLog(s, `${d.name} 的${lv.name}反击`, 'combat', d.id);
    shoot(s, d.id, { kind: 'building', id: b.id }, pos, t, { attack: lv.attack, shots: lv.shots, defense: 0, range: lv.range, canHit: bd.canHit }, bd.canHit.includes('air') ? 'flak' : 'shell', events);
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
  for (const c of s.city) c.occupants = c.occupants.filter((id) => !p.units.some((u) => u.id === id));
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

/**
 * What a creature strikes with: its card, with how far it reaches against
 * aircraft when that is shorter than against the ground, and whether it hovers
 * (which tells the base guns which of them may answer it).
 */
type Creature = CombatStats & { move: number; fx: AttackStyle; airRange?: number; flies?: boolean };

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

/**
 * One of the aliens that is not on the board already, drawn at random. A board
 * with no room for it goes without.
 *
 * The hidden ones never open a match, and never come two at once; once the
 * first alien is down from the sky each arrival has `HIDDEN_CHANCE` of being
 * one of them, as strong as its place in the order of arrivals makes it.
 */
function spawnAlien(s: GameState, rng: Rng, events: GameEvent[]): void {
  const at = landingSpot(s, rng, new BoardIndex(s), 0);
  if (!at) return;
  const here = (k: AlienKey): boolean => s.aliens.some((a) => a.key === k);
  const hidden = HIDDEN_KEYS.filter((k) => !here(k));
  const lurking = hidden.length > 0 && s.aliensSeen > 0 && !s.aliens.some((a) => isHidden(a.key)) && rng.chance(HIDDEN_CHANCE);
  const known = ALIEN_KEYS.filter((k) => !here(k));
  const k = lurking ? rng.pick(hidden) : rng.pick(known.length ? known : ALIEN_KEYS);
  // Later arrivals are stronger than earlier ones: this one is the next in the match.
  const alien: AlienState = { id: s.nextId++, key: k, x: at.x, y: at.y, hp: 0, arrived: s.turn, wave: s.aliensSeen + 1, hurt: {} };
  alien.hp = alienStats(alien).hp;
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
  for (const c of s.city) if (holderOf(s, c)) out.push({ x: c.x, y: c.y });
  return out;
}

/**
 * What the players have within reach of `at`, the softest first: units before
 * buildings, a base last of all. Only what the creature can strike at all is
 * on the list, and aircraft only as far as it reaches them.
 */
function preyNear(s: GameState, at: Pt, beast: Creature): Target[] {
  const opts: Array<{ t: Target; pri: number }> = [];
  const reach = (t: Target): number => (t.cls === 'air' ? beast.airRange ?? beast.range : beast.range);
  const take = (t: Target | null, pri: number, d: number): void => {
    if (t && d <= reach(t) && beast.canHit.includes(t.cls)) opts.push({ t, pri });
  };
  for (const p of s.players) {
    if (!p.alive) continue;
    for (const u of p.units) if (cheb(at, u) <= beast.range) take(targetOf(s, { kind: 'unit', id: u.id }), u.hp, cheb(at, u));
    for (const b of p.buildings) {
      if (targetable(b) && distToBuilding(at, b) <= beast.range) take(targetOf(s, { kind: 'building', id: b.id }), 1000 + (b.key === 'hq' ? 1000 : 0) + b.hp, 0);
    }
  }
  // A house or tower someone holds is theirs too, as far as a creature is concerned.
  for (const c of s.city) {
    if (holderOf(s, c) && cheb(at, c) <= beast.range) take(targetOf(s, { kind: 'city', id: c.id }), 1000 + c.hp, 0);
  }
  return opts.sort((a, b) => a.pri - b.pri).map((o) => o.t);
}

/**
 * Walks a creature up to as many tiles as it has steps for: towards `prey`
 * when it has one and the dice agree, otherwise to whichever tile it fancies.
 * Aliens wade straight through water; nothing about them plays by our rules.
 * One that hovers goes over everything, but still comes to rest only where
 * nothing else stands: it holds a tile like any of them.
 */
function creep(s: GameState, idx: BoardIndex, who: AlienState | Minion, beast: Creature, prey: Pt | null, chase: number, rng: Rng, events: GameEvent[]): void {
  const reach = reachable(idx, s, who, beast.flies ? 'air' : 'track', beast.move, who.id);
  if (beast.flies) {
    for (const [k] of reach) if (idx.ground.has(k) || idx.blocked.has(k) || idx.city.has(k)) reach.delete(k);
  }
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
    const spider: Minion = { id: s.nextId++, kind: 'spider', owner: queen.id, x: at.x, y: at.y, hp: SPIDERLING.hp };
    s.brood.push(spider);
    ids.push(spider.id);
  }
  if (ids.length) {
    events.push({ type: 'hatch', owner: queen.id, ids });
    addLog(s, `${ALIENS[queen.key].name}孵出了 ${ids.length} 只${SPIDERLING.name}`, 'warn');
  }
}

/** Strikes the first thing on the list with what the creature has, and lets the base guns answer if it was one of theirs. */
function bite(s: GameState, ref: EntityRef, prey: Target[], beast: Creature, at: Pt, events: GameEvent[]): void {
  if (!prey.length) return;
  const t = prey[0];
  const from = { x: at.x, y: at.y };
  shoot(s, -1, ref, from, t, beast, beast.fx, events);
  // Base guns answer an attack on the base; the alien is not a unit, but they can still see it, and only those that reach its kind.
  if (t.ref.kind === 'building' && s.players[t.owner].alive) retaliate(s, t.owner, { ref, pos: from, cls: beast.flies ? 'air' : 'ground' }, events);
}

/**
 * Whether an alien's energy is due to go this round: every so many rounds
 * from the one after it arrived, so that whatever stands near has a round
 * to get clear.
 */
const burstDue = (s: GameState, a: AlienState, every: number): boolean => s.turn > a.arrived && (s.turn - a.arrived) % every === 0;

/**
 * 雅千 lets her energy go: everything of the players' on the tiles round her,
 * wings included, takes the burst's power before its own defence, and so does
 * every building with a tile in reach. A foot soldier it kills gets up again
 * at once as one of her skeletons, for as long as she has room for more. The
 * guns of a base she has caught answer, as they answer any attack on it.
 */
function burst(s: GameState, a: AlienState, def: AlienDef, events: GameEvent[]): void {
  const ref: EntityRef = { kind: 'alien', id: a.id };
  const idx = new BoardIndex(s);
  const hits: SplashHit[] = [];
  const struck = new Set<number>();
  const raised: number[] = [];
  const strike = (t: Target): void => {
    const dmg = netDamage(def.burst!.power, t.defense);
    const victim = t.obj as Unit;
    // A soldier that falls to it gets up again as hers, on the tile it is leaving this instant.
    const rise = t.ref.kind === 'unit' && dmg >= victim.hp && UNITS[victim.key].family === 'soldier' && s.brood.filter((b) => b.owner === a.id).length < BROOD_CAP;
    applyDamage(s, -1, t, dmg, events);
    hits.push({ target: t.ref, amount: dmg, pos: t.pos });
    if (t.ref.kind === 'building') struck.add(t.owner);
    if (rise) {
      const bone: Minion = { id: s.nextId++, kind: 'skeleton', owner: a.id, x: victim.x, y: victim.y, hp: SKELETON.hp };
      s.brood.push(bone);
      raised.push(bone.id);
    }
  };
  const seen = new Set<number>();
  for (let dy = -def.burst!.reach; dy <= def.burst!.reach; dy++) {
    for (let dx = -def.burst!.reach; dx <= def.burst!.reach; dx++) {
      // Not her own tile: nothing of the players' can be standing under her.
      if ((!dx && !dy) || !inBoard(a.x + dx, a.y + dy, s.boardSize)) continue;
      const x = a.x + dx;
      const y = a.y + dy;
      const k = key(x, y);
      const u = idx.air.get(k) ?? idx.ground.get(k);
      if (u) {
        const t = targetOf(s, { kind: 'unit', id: u.id });
        if (t) strike(t);
        continue;
      }
      const house = idx.city.get(k);
      if (house && holderOf(s, house)) {
        const t = targetOf(s, { kind: 'city', id: house.id });
        if (t) strike(t);
        continue;
      }
      const b = s.players.flatMap((p) => p.buildings).find((q) => q.w > 0 && x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      if (!b || seen.has(b.id)) continue;
      seen.add(b.id);
      const t = targetOf(s, { kind: 'building', id: b.id });
      if (t) strike(t);
    }
  }
  events.push({ type: 'burst', source: ref, at: { x: a.x, y: a.y }, hits });
  if (raised.length) events.push({ type: 'raise', owner: a.id, ids: raised });
  for (const owner of struck) if (s.players[owner].alive) retaliate(s, owner, { ref, pos: { x: a.x, y: a.y }, cls: def.flies ? 'air' : 'ground' }, events);
  addLog(s, `警报：${def.name}释放了能量，周围 ${hits.length} 处目标受到波及${raised.length ? `，${raised.length} 名士兵化作了${SKELETON.name}` : ''}`, 'warn');
}

/** One alien's go. Each kind goes about it in its own way. */
function alienTurn(s: GameState, rng: Rng, a: AlienState, events: GameEvent[]): void {
  // Asked through a function: the guns that answer an alien may end the match half-way through its go.
  const over = (): boolean => s.phase === 'gameover';
  if (over()) return;
  // What it strikes with is its own: a later arrival hits harder and takes more killing, and a shape-changer strikes as the shape it is in.
  const def = alienStats(a);
  const ref: EntityRef = { kind: 'alien', id: a.id };
  const idx = new BoardIndex(s);
  const home: Pt = { x: a.x, y: a.y };
  // Every so many rounds the goddess lets her energy go first of all, from wherever she is.
  if (def.burst && burstDue(s, a, def.burst.every)) burst(s, a, def, events);
  // A gun that answered may have been the end of her, or of somebody's base.
  if (over() || !alienById(s, a.id)) return;
  // Anything with a long reach fires from where it stands; something that bites has to walk up first.
  let prey: Target[] = def.range > 1 ? preyNear(s, home, def) : [];
  if (def.teleports) {
    // It turns up wherever it can reach something, and nowhere in particular when it cannot.
    const den = ambushSpot(s, rng, idx, a, def.range) ?? landingSpot(s, rng, idx, a.id);
    if (den && (den.x !== a.x || den.y !== a.y)) {
      events.push({ type: 'warp', target: ref, from: home, to: den });
      a.x = den.x;
      a.y = den.y;
    }
    prey = preyNear(s, a, def);
  } else if (!prey.length) {
    creep(s, idx, a, def, nearestAsset(s, home), 0.7, rng, events);
    prey = preyNear(s, a, def);
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

/**
 * One of the aliens' small fry makes for whatever took its fancy, then bites
 * whatever it comes across.
 */
function minionTurn(s: GameState, rng: Rng, minion: Minion, events: GameEvent[]): void {
  if (s.phase === 'gameover') return;
  const def = minionDef(minion);
  const ref: EntityRef = { kind: 'brood', id: minion.id };
  let prey = preyNear(s, minion, def);
  if (!prey.length) {
    const goal = rng.pick(everyAsset(s));
    if (goal) creep(s, new BoardIndex(s), minion, def, goal, 1, rng, events);
    prey = preyNear(s, minion, def);
  }
  // It attacks at random: whatever is in reach, not the softest.
  if (prey.length) bite(s, ref, [rng.pick(prey)], def, minion, events);
}

/** The aliens' go, right after the dice: each in turn, then the spiders. They never turn on one another. */
function aliensTurn(s: GameState, rng: Rng, events: GameEvent[]): void {
  // Each gun answers the aliens once this round, whoever it belongs to and whoever they strike.
  for (const p of s.players) for (const b of p.buildings) b.reacted = false;
  for (const a of [...s.aliens]) alienTurn(s, rng, a, events);
  for (const b of [...s.brood]) minionTurn(s, rng, b, events);
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
        addLog(s, `第 ${s.turn} 回合掷骰：${dice.map((d) => `${n(d.player)} ${d.rolls[0]} 点`).join('，')}。${dice.filter((d) => d.ap > 0).map((d) => `${n(d.player)} +${d.ap} 行动点`).join('，')}`, 'info');
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
    case 'PROMOTE': {
      const p = cur();
      if (!inTurn) bad('现在不能升级');
      else {
        const err = canPromote(p, a.unitId);
        if (err) bad(err);
        else {
          const u = p.units.find((x) => x.id === a.unitId)!;
          pay(p, promoteCost(u.key, rankOf(u)));
          u.rank = rankOf(u) + 1;
          // Raised a rank, and whole again at the new one, whatever it had lost before.
          u.hp = maxHpOf(u);
          events.push({ type: 'promote', player: p.id, unitId: u.id, rank: u.rank });
          addLog(s, `${p.name} 的${UNITS[u.key].name}晋升为${RANKS[u.rank - 1].name}`, 'good', p.id);
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
        const house = cityAt(s, a.x, a.y);
        const path = reachable(new BoardIndex(s), s, u, moveModeOf(u.key), UNITS[u.key].move, u.id, u).get(key(a.x, a.y));
        if (!path) bad(house ? entryError(s, u, house) : '无法到达该位置');
        else {
          u.x = a.x;
          u.y = a.y;
          u.moveUsed = true;
          events.push({ type: 'move', unitId: u.id, path });
          // A soldier that walks into a house or tower is inside it from then on: off the board, and shooting no further than its windows allow.
          if (house) {
            u.inside = house.id;
            house.occupants.push(u.id);
            events.push({ type: 'garrison', city: house.id, unitId: u.id });
            addLog(s, `${p.name} 的${UNITS[u.key].name}进驻了${CITY[house.kind].name}`, 'good', p.id);
          }
        }
      }
      break;
    }
    case 'LEAVE': {
      const p = cur();
      const house = inTurn ? cityById(s, a.cityId) : null;
      if (!house) bad('现在不能解散');
      else {
        const mine = house.occupants.map((id) => unitById(s, id)).filter((hit): hit is { unit: Unit; owner: PlayerState } => !!hit && hit.owner.id === p.id);
        if (!mine.length) bad('里面没有你的士兵');
        else if (roomAround(s, house, mine.length).length < mine.length) bad('附近有其他单位无法解散');
        else {
          addLog(s, `${p.name} 解散了${CITY[house.kind].name}里的士兵`, 'info', p.id);
          events.push(spill(s, house, 0, -1, events));
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
          const shot = shoot(s, p.id, src.ref, src.pos, t, src.stats, src.fx, events);
          // Base guns answer a unit that struck one of their base's buildings, by a splash that reached one as much as by a shot aimed at it.
          if (srcUnit) {
            const struck = new Set<number>();
            if (shot.target.kind === 'building') struck.add(t.owner);
            for (const h of shot.splash ?? []) {
              if (h.target.kind !== 'building') continue;
              const b = buildingById(s, h.target.id);
              if (b) struck.add(b.owner.id);
            }
            for (const owner of struck) retaliate(s, owner, { ref: { kind: 'unit', id: srcUnit.id }, pos: src.pos, cls: UNITS[srcUnit.key].unitClass }, events);
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

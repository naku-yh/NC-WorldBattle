import { ALIENS, BUILDINGS, SPIDERLING, TRUCKS_PER_FACTORY, UNITS } from './data';
import { alienById, attackPower, attackTargets, baseStats, buildingById, canAfford, canBuild, canProduce, canUpgrade, countBuilding, defenseOf, hqOf, statsOf, unitById } from './engine';
import { BoardIndex, buildingCenter, cheb, key, moveModeOf, nearestOpen, reachable, route, toWorld, withinRange } from './board';
import type { Action, Building, BuildingKey, CombatStats, Cost, EntityRef, GameState, PlayerState, Pt, ResourceKey, Unit, UnitKey } from './types';

const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

/** An army sets off once its total attack power reaches this. */
const WAVE_STRENGTH = 16;
/**
 * Where units gather before a push, in zone-local coordinates: just outside
 * the zone's corner, on the player's own side of the waterway.
 */
const STAGE = 6;

/** Damage one full attack with these stats does to something with `defense` HP of armour. */
export function damageOf(st: CombatStats, defense: number): number {
  let n = 0;
  for (let i = 0; i < st.shots; i++) n += Math.max(0, st.attack - (st.pierce ? 0 : defense));
  return n;
}

function stagingPoint(s: GameState, p: PlayerState): Pt {
  const want = toWorld(s.corners[p.corner], STAGE, STAGE);
  return nearestOpen(s, want, 'foot') ?? want;
}

function powerDemand(p: PlayerState): number {
  return p.buildings.filter((b) => BUILDINGS[b.key].needsPower).length;
}

function threatened(s: GameState, p: PlayerState): boolean {
  const hq = hqOf(p);
  if (!hq) return false;
  const home = buildingCenter(hq);
  if (s.aliens.some((a) => cheb(home, a) <= 6)) return true;
  return s.players.some(
    (q) => q.alive && q.id !== p.id && q.units.some((u) => cheb(home, u) <= 6),
  );
}

function enemyAir(s: GameState, p: PlayerState): boolean {
  return s.players.some(
    (q) => q.alive && q.id !== p.id && q.units.some((u) => UNITS[u.key].unitClass === 'air'),
  );
}

interface Goal {
  key: BuildingKey;
  /** Worth saving up for instead of buying units. */
  blocking: boolean;
}

/**
 * What the base still needs, most urgent first. Power, the shield and the
 * first barracks are worth saving up for; everything else is bought with
 * what is left after units.
 */
function goals(s: GameState, p: PlayerState): Goal[] {
  const out: Goal[] = [];
  const has = (k: BuildingKey): number => countBuilding(p, k);
  const add = (k: BuildingKey, blocking: boolean): void => {
    if (BUILDINGS[k].needsPower && powerDemand(p) + 1 > p.powerCap) out.push({ key: 'powerPlant', blocking });
    out.push({ key: k, blocking });
  };
  if (p.buildings.some((b) => !b.powered)) out.push({ key: 'powerPlant', blocking: true });
  if (has('defenseNet') === 0) add('defenseNet', true);
  if (has('barracks') === 0) add('barracks', true);
  if (threatened(s, p) && has('turret') < 2) add('turret', true);
  if (enemyAir(s, p) && has('aaGun') < 1) add('aaGun', true);
  if (has('warFactory') === 0) add('warFactory', false);
  if (has('factory') < 2) add('factory', false);
  if (has('turret') < 1) add('turret', false);
  if (s.turn >= 9 && has('airport') < 1) add('airport', false);
  return out;
}

function pickResource(s: GameState, p: PlayerState): ResourceKey {
  // Appetite fades as stockpiles grow, so nothing is ever starved.
  const appetite: Record<ResourceKey, number> = { ore: 0, oil: 0, meat: 0 };
  const base: Record<ResourceKey, number> = { ore: 6, oil: 4, meat: 3 };
  for (const k of RES_KEYS) appetite[k] = (base[k] * 2000) / (600 + p.resources[k]);
  const wants: Cost[] = goals(s, p)
    .slice(0, 2)
    .map((g) => BUILDINGS[g.key].levels[0].cost);
  if (p.trucks < TRUCKS_PER_FACTORY) wants.push(UNITS.truck.cost);
  wants.push({ ore: 400, oil: 300, meat: 200 });
  wants.forEach((w, i) => {
    const weight = i === 0 ? 3 : i === 1 ? 2 : 1;
    for (const k of RES_KEYS) {
      const need = (w[k] ?? 0) - p.resources[k];
      if (need > 0) appetite[k] += (need / 100) * weight;
    }
  });
  let best: ResourceKey = 'ore';
  for (const k of RES_KEYS) if (appetite[k] > appetite[best]) best = k;
  return best;
}

function scale(cost: Cost, n: number): Cost {
  return { ore: (cost.ore ?? 0) * n, oil: (cost.oil ?? 0) * n, meat: (cost.meat ?? 0) * n };
}

function withinBudget(p: PlayerState, cost: Cost, reserve: Cost): boolean {
  return RES_KEYS.every((k) => p.resources[k] - (cost[k] ?? 0) >= (reserve[k] ?? 0));
}

function produceUnit(s: GameState, p: PlayerState, reserve: Cost): Action | null {
  const left = (bk: BuildingKey): number =>
    BUILDINGS[bk].perTurnCap * p.buildings.filter((b) => b.key === bk && b.powered).length -
    (p.producedThisTurn[bk] ?? 0);
  const air = enemyAir(s, p);
  const list: UnitKey[] = [];
  if (left('warFactory') > 0) list.push('tank', 'missileTank', 'twinTank', air ? 'aaTank' : 'laserTank', 'laserTank', 'apocalypse');
  if (left('barracks') > 0) list.push('infantry', 'atSoldier', 'sniper', 'infantry');
  if (s.turn >= 8) list.push('fighter');
  // Rotate the mix so armies don't all look the same.
  const rot = list.length ? (s.turn + p.id * 2) % list.length : 0;
  for (let i = 0; i < list.length; i++) {
    const uk = list[(i + rot) % list.length];
    if (canProduce(s, p, uk) === null && withinBudget(p, UNITS[uk].cost, reserve)) return { type: 'PRODUCE', unit: uk };
  }
  return null;
}

/** Lower is a more attractive target. */
function scoreTarget(s: GameState, hurt: (defense: number) => number, t: EntityRef): number {
  // An alien that this weapon can actually hurt comes before everything.
  if (t.kind === 'alien') return hurt(ALIENS[alienById(s, t.id)?.key ?? 'chloe'].defense) > 0 ? 0 : 9;
  if (t.kind === 'spider') return hurt(SPIDERLING.defense) > 0 ? 0.5 : 9;
  if (t.kind === 'building') {
    const hit = buildingById(s, t.id);
    if (!hit) return 9;
    if (hit.building.key === 'hq') return 2;
    const armed = BUILDINGS[hit.building.key].levels[hit.building.level - 1].attack > 0;
    return armed ? 3.5 : 4;
  }
  const hit = unitById(s, t.id);
  if (!hit) return 9;
  // The ground a unit stands on counts towards its armour.
  return hurt(defenseOf(s, hit.unit)) >= hit.unit.hp ? 1 : 3;
}

function bestTarget(s: GameState, hurt: (defense: number) => number, list: EntityRef[]): EntityRef {
  let best = list[0];
  let bestScore = Infinity;
  for (const t of list) {
    const sc = scoreTarget(s, hurt, t);
    if (sc < bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  return best;
}

function nearestOpponent(s: GameState, p: PlayerState, home: Pt): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const q of s.players) {
    if (!q.alive || q.id === p.id) continue;
    const hq = hqOf(q);
    if (!hq) continue;
    const d = cheb(home, buildingCenter(hq));
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Where a unit is headed. */
interface March {
  pos: Pt;
  /** Set when `pos` is a building's centre, so range is measured to its nearest tile. */
  building?: Building;
  /** Hold on `pos` itself rather than anywhere within weapons range of it. */
  exact?: boolean;
}

/** The tile a unit should head for. */
function pickGoal(s: GameState, p: PlayerState, u: Unit): March | null {
  const d = UNITS[u.key];
  // An alien's bounty is worth a detour, if this unit can actually hurt it.
  for (const a of s.aliens) {
    if (cheb(u, a) <= 7 && damageOf(baseStats(u.key), ALIENS[a.key].defense) > 0) return { pos: { x: a.x, y: a.y } };
  }
  const hq = hqOf(p);
  const home = hq ? buildingCenter(hq) : { x: u.x, y: u.y };
  const canShoot = (e: Unit): boolean => d.canHit.includes(UNITS[e.key].unitClass);

  // Intruders at the gate come first.
  let goal: March | null = null;
  let goalD = Infinity;
  for (const q of s.players) {
    if (!q.alive || q.id === p.id) continue;
    for (const e of q.units) {
      if (!canShoot(e)) continue;
      const dd = cheb(home, e);
      if (dd <= 5 && dd < goalD) {
        goalD = dd;
        goal = { pos: { x: e.x, y: e.y } };
      }
    }
  }
  if (goal) return goal;

  // Otherwise march on the nearest opponent.
  const foe = nearestOpponent(s, p, home);
  if (!foe) return null;
  for (const e of foe.units) {
    if (!canShoot(e)) continue;
    const dd = cheb(u, e);
    if (dd <= 4 && dd < goalD) {
      goalD = dd;
      goal = { pos: { x: e.x, y: e.y } };
    }
  }
  if (goal) return goal;

  // Attack in waves. Units trickle out one or two a turn; sent on alone they
  // just feed the defending guns. Gather at the staging point until the army
  // is strong enough, then the whole group sets off together.
  const stage = stagingPoint(s, p);
  if (attackPower(p) < WAVE_STRENGTH && cheb(u, home) < cheb(stage, home)) return { pos: stage, exact: true };
  const foeHq = hqOf(foe);
  return foeHq ? { pos: buildingCenter(foeHq), building: foeHq } : null;
}

function advance(s: GameState, p: PlayerState, u: Unit): Action | null {
  const goal = pickGoal(s, p, u);
  if (!goal) return null;
  const d = UNITS[u.key];
  const target = goal.exact ? goal.pos : (goal.building ?? goal.pos);
  const range = goal.exact ? 0 : statsOf(s, u).range;
  if (withinRange(u, target, range)) return null; // already in a firing position
  const mode = moveModeOf(u.key);
  // The route only looks at fixed obstacles and terrain (a foot soldier heads
  // for the bridge rather than the river bank); the steps actually taken this
  // turn are checked against the units on the ground right now.
  const path = route(s, u, target, range, mode);
  if (!path?.length) return null;
  const reach = reachable(new BoardIndex(s), s, u, mode, d.move, u.id);
  for (let i = Math.min(d.move, path.length) - 1; i >= 0; i--) {
    const q = path[i];
    if (reach.has(key(q.x, q.y))) return { type: 'MOVE', unitId: u.id, x: q.x, y: q.y };
  }
  return null;
}

function combat(s: GameState, p: PlayerState): Action | null {
  // Shoot first with whatever has something to shoot at.
  for (const u of p.units) {
    if (u.attackUsed) continue;
    const list = attackTargets(s, { kind: 'unit', id: u.id });
    if (list.length) {
      const st = statsOf(s, u);
      return { type: 'ATTACK', source: { kind: 'unit', id: u.id }, target: bestTarget(s, (def) => damageOf(st, def), list) };
    }
  }
  for (const b of p.buildings) {
    if (b.fired || !b.powered) continue;
    const list = attackTargets(s, { kind: 'building', id: b.id });
    if (list.length) {
      const { attack, shots } = BUILDINGS[b.key].levels[b.level - 1];
      return {
        type: 'ATTACK',
        source: { kind: 'building', id: b.id },
        target: bestTarget(s, (def) => Math.max(0, attack - def) * shots, list),
      };
    }
  }
  // Then close the distance.
  for (const u of p.units) {
    if (u.moveUsed) continue;
    const step = advance(s, p, u);
    if (step) return step;
  }
  return null;
}

/**
 * Picks the next order for a computer-controlled player. Returns null when the
 * turn is over. Every returned action changes the state, so repeated calls
 * always make progress.
 */
export function aiDecide(s: GameState, pid: number): Action | null {
  const p = s.players[pid];
  if (!p || !p.alive || s.phase !== 'player' || s.currentPlayer !== pid) return null;

  // 1. Action points are free money: always collect.
  if (p.ap > 0) return { type: 'HARVEST', resource: pickResource(s, p) };

  // 2. Trucks pay for themselves, so grow the fleet while the factory has room.
  const factories = countBuilding(p, 'factory');
  const truckCap = Math.min(factories * TRUCKS_PER_FACTORY, countBuilding(p, 'barracks') > 0 || s.turn >= 6 ? 8 : 4);
  if (p.trucks < truckCap && canProduce(s, p, 'truck') === null) return { type: 'PRODUCE', unit: 'truck' };

  // 3. A standing army comes before any more construction. Without this the
  //    AI would pour every coin into buildings and field nothing until turn 10.
  const armyThisTurn = (p.producedThisTurn.barracks ?? 0) + (p.producedThisTurn.warFactory ?? 0) + (p.producedThisTurn.airport ?? 0);
  const quota = factories >= 2 ? 2 : 1;
  if (countBuilding(p, 'barracks') > 0 && armyThisTurn < quota) {
    const order = produceUnit(s, p, {});
    if (order) return order;
  }

  // 4. Construction, most urgent first.
  const plan = goals(s, p);
  const reserve: Cost = {};
  for (const g of plan) {
    const cost = BUILDINGS[g.key].levels[0].cost;
    if (canBuild(s, p, g.key) === null) return { type: 'BUILD', key: g.key };
    if (!canAfford(p, cost)) {
      // Save up for it rather than frittering the money away on units.
      if (g.blocking) return combat(s, p);
      for (const k of RES_KEYS) reserve[k] = Math.max(reserve[k] ?? 0, Math.ceil((cost[k] ?? 0) / 2));
      continue;
    }
    break; // blocked for another reason (usually no room left)
  }

  // 5. Upgrades once comfortably rich: the guns first, then a bigger base.
  //    The net has a long ladder, so it is climbed one rung at a time.
  for (const [k, cushion] of [['turret', 3], ['defenseNet', 3], ['aaGun', 3], ['hq', 1.5]] as const) {
    const b = p.buildings.find((x) => x.key === k && x.level < BUILDINGS[k].levels.length);
    if (!b) continue;
    if (canAfford(p, scale(BUILDINGS[k].levels[b.level].cost, cushion)) && canUpgrade(p, b.id) === null) {
      return { type: 'UPGRADE', buildingId: b.id };
    }
  }

  // 6. Whatever is left goes into more units, then orders.
  return produceUnit(s, p, reserve) ?? combat(s, p);
}

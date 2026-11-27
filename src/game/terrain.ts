import { ZONE_SIZE } from './data';
import { RALLY_LOCAL, cornersOf, inBoard, key, laneTiles, NODE_LAYOUT, toWorld, zoneTiles } from './board';
import type { Rng } from './rng';
import type { Pt, ResourceKey, Terrain, Waterway } from './types';

export interface MapPlan {
  terrain: Terrain[];
  waterway: Waterway;
}

/** Water tiles kept between the waterway's two bridges ("at least five tiles apart"). */
export const BRIDGE_GAP = 5;

const RESOURCES: ResourceKey[] = ['ore', 'oil', 'meat'];
const cheb = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function plainTerrain(n: number): Terrain[] {
  return new Array<Terrain>(n * n).fill('plain');
}

/** Every tile reachable from `start` without setting foot in water. */
function flood(t: Terrain[], n: number, start: Pt): Set<string> {
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const c = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (!inBoard(x, y, n) || seen.has(key(x, y))) continue;
        const k = t[y * n + x];
        if (k === 'water' || k === 'lake') continue;
        seen.add(key(x, y));
        queue.push({ x, y });
      }
    }
  }
  return seen;
}

/**
 * Lays out a fresh battlefield. One waterway crosses the whole board through
 * the band between the four base zones, with two bridges set well apart; a few
 * lakes, woods and hills fill the open ground. Every tile a base depends on
 * (its zone, the supply lanes and the resource nodes, plus a one-tile margin)
 * is kept dry, so trucks and fresh units always stand on solid ground.
 */
export function generateTerrain(rng: Rng, n: number, seated: number[]): MapPlan {
  const waterway: Waterway = rng.chance(0.5) ? 'vertical' : 'horizontal';
  const t = plainTerrain(n);
  const at = (x: number, y: number): number => y * n + x;
  const corners = cornersOf(n);
  const layout = NODE_LAYOUT[waterway];

  // --- ground that must stay dry -----------------------------------------
  const dry = new Set<string>();
  for (let i = 0; i < 4; i++) for (const q of zoneTiles(i, n)) dry.add(key(q.x, q.y));
  // Nothing scenic where fresh units appear, either.
  for (const i of seated) {
    for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
      const q = toWorld(corners[i], RALLY_LOCAL.u + du, RALLY_LOCAL.v + dv);
      if (inBoard(q.x, q.y, n)) dry.add(key(q.x, q.y));
    }
  }
  for (const i of seated) {
    for (const res of RESOURCES) {
      const local = layout[res];
      const node = toWorld(corners[i], local.x, local.y);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) dry.add(key(node.x + dx, node.y + dy));
      for (const q of laneTiles(local)) {
        const w = toWorld(corners[i], q.x, q.y);
        dry.add(key(w.x, w.y));
      }
    }
  }

  // --- the waterway -------------------------------------------------------
  // It stays inside the band between the zones, so it can never cut one off.
  const lo = ZONE_SIZE + 1;
  const hi = n - ZONE_SIZE - 2;
  const tile = (line: number, pos: number): Pt => (waterway === 'vertical' ? { x: pos, y: line } : { x: line, y: pos });
  // Positions still open on each line, worked backwards so the walk below can
  // never paint itself into a corner.
  const open: number[][] = [];
  for (let line = 0; line < n; line++) open.push([]);
  for (let pos = lo; pos <= hi; pos++) {
    const last = tile(n - 1, pos);
    if (!dry.has(key(last.x, last.y))) open[n - 1].push(pos);
  }
  for (let line = n - 2; line >= 0; line--) {
    for (let pos = lo; pos <= hi; pos++) {
      const q = tile(line, pos);
      if (!dry.has(key(q.x, q.y)) && open[line + 1].some((next) => Math.abs(next - pos) <= 1)) open[line].push(pos);
    }
  }
  const course: Pt[] = [];
  if (open.every((o) => o.length)) {
    let pos = rng.pick(open[0]);
    let drift = 0;
    for (let line = 0; line < n; line++) {
      const q = tile(line, pos);
      t[at(q.x, q.y)] = 'water';
      course.push(q);
      if (line === n - 1) break;
      // Now and then start drifting sideways; whatever is in the way, there is
      // always somewhere legal to go next (see `open` above).
      const can = (p: number): boolean => open[line + 1].includes(p);
      if (rng.chance(0.3)) drift = rng.pick([-1, 0, 1]);
      if (drift !== 0 && !can(pos + drift)) drift = 0;
      if (drift === 0 && !can(pos)) drift = can(pos - 1) ? -1 : 1;
      pos += drift;
    }
    // Two bridges, with at least BRIDGE_GAP water tiles left between them.
    const first = rng.int(1, n - BRIDGE_GAP - 3);
    const second = rng.int(first + BRIDGE_GAP + 1, n - 2);
    for (const line of [first, second]) {
      const q = course[line];
      t[at(q.x, q.y)] = 'bridge';
    }
  }

  const nearCourse = (x: number, y: number, d: number): boolean => course.some((q) => cheb(q, { x, y }) <= d);

  // --- patches of woods, hills and lakes ----------------------------------
  /** Grows a patch out of `seed` until `size` tiles carry `kind`. */
  const blob = (seed: Pt, size: number, ok: (x: number, y: number) => boolean, kind: Terrain): void => {
    const body: Pt[] = [seed];
    t[at(seed.x, seed.y)] = kind;
    for (let guard = 0; body.length < size && guard++ < 200; ) {
      const from = rng.pick(body);
      const dx = rng.int(-1, 1);
      const dy = rng.int(-1, 1);
      const x = from.x + dx;
      const y = from.y + dy;
      if ((dx === 0 && dy === 0) || !inBoard(x, y, n) || t[at(x, y)] !== 'plain' || !ok(x, y)) continue;
      body.push({ x, y });
      t[at(x, y)] = kind;
    }
  };
  const lakeOk = (x: number, y: number): boolean => !dry.has(key(x, y)) && !nearCourse(x, y, 1);

  const lakes: Pt[] = [];
  const wanted = n >= 24 ? 3 : 2;
  for (let tries = 0; lakes.length < wanted && tries < 400; tries++) {
    const x = rng.int(0, n - 1);
    const y = rng.int(0, n - 1);
    // Lakes keep to themselves: never touching another lake.
    if (t[at(x, y)] !== 'plain' || !lakeOk(x, y) || lakes.some((q) => cheb(q, { x, y }) <= 1)) continue;
    blob({ x, y }, rng.int(3, n >= 24 ? 7 : 6), lakeOk, 'lake');
    lakes.push({ x, y });
  }
  // The waterway is bridged and the lakes are kept apart, so dry land should be
  // one piece. Should the water ever close a ring around a base, drain the lakes.
  if (seated.length > 1) {
    const rally = (i: number): Pt => toWorld(corners[i], RALLY_LOCAL.u, RALLY_LOCAL.v);
    const land = flood(t, n, rally(seated[0]));
    if (seated.some((i) => !land.has(key(rally(i).x, rally(i).y)))) {
      for (let i = 0; i < t.length; i++) if (t[i] === 'lake') t[i] = 'plain';
    }
  }

  // --- woods and hills ----------------------------------------------------
  const openGround = (x: number, y: number): boolean => !dry.has(key(x, y));
  const scatter = (count: number, kind: Terrain, min: number, max: number): void => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = rng.int(0, n - 1);
      const y = rng.int(0, n - 1);
      if (t[at(x, y)] !== 'plain' || !openGround(x, y)) continue;
      blob({ x, y }, rng.int(min, max), openGround, kind);
      placed++;
    }
  };
  scatter(Math.round((n * n) / 58), 'forest', 3, 7);
  scatter(Math.round((n * n) / 105), 'hill', 2, 4);

  return { terrain: t, waterway };
}

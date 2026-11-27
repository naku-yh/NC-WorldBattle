import { BOARD_SIZE, TERRAIN, UNITS, ZONE_SIZE } from './data';
import type { Building, Corner, GameState, MoveMode, PlayerState, Pt, ResourceKey, Terrain, TerrainEffect, Unit, UnitFamily, UnitKey, Waterway } from './types';

/** The four corners in board order: south-west, south-east, north-west, north-east. */
export function cornersOf(n: number): Corner[] {
  const far = n - 1;
  return [
    { ox: 0, oy: 0, dx: 1, dy: 1, label: '西南' },
    { ox: far, oy: 0, dx: -1, dy: 1, label: '东南' },
    { ox: 0, oy: far, dx: 1, dy: -1, label: '西北' },
    { ox: far, oy: far, dx: -1, dy: -1, label: '东北' },
  ];
}

/** Seat -> corner index, by player count. Two players always sit on opposite corners. */
export const SEAT_CORNERS: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 3, 1],
  4: [0, 1, 2, 3],
};

// Base-zone layout in "local" coordinates: (0,0) is the outer corner, u runs along
// the x axis, v along the y axis, both towards the middle of the board.
export const HQ_LOCAL = { u: 0, v: 0 };
export const FACTORY_LOCAL = { u: 2, v: 0 };
/** Where resource trucks park (2x2). */
export const DEPOT_LOCAL = { u: 1, v: 2 };
/** Units appear around this tile, just outside the zone. */
export const RALLY_LOCAL = { u: 3, v: ZONE_SIZE };

/** That same tile once the zone has grown round it: it stays clear so new units always have somewhere to stand. */
export const isMusterLocal = (u: number, v: number): boolean => u === RALLY_LOCAL.u && v === RALLY_LOCAL.v && v >= ZONE_SIZE;

/**
 * Resource nodes, in zone-local coordinates. The waterway is kept to the middle
 * columns (or rows) of the board, so a node never ends up cut off from its base
 * as long as it hugs the zone: u <= ZONE_SIZE when the waterway runs north-south,
 * v <= ZONE_SIZE when it runs west-east.
 */
export const NODE_LAYOUT: Record<Waterway, Record<ResourceKey, Pt>> = {
  vertical: { ore: { x: 6, y: 1 }, meat: { x: 1, y: 6 }, oil: { x: 0, y: 8 } },
  horizontal: { ore: { x: 6, y: 1 }, meat: { x: 9, y: 1 }, oil: { x: 1, y: 6 } },
};

/** The supply lane a truck takes to a node: along the zone's top row, or down its outer column. */
export const laneOf = (node: Pt): 'row' | 'col' => (node.y > ZONE_SIZE - 1 ? 'col' : 'row');

/** Tiles a truck drives over from the zone's edge out to a node, the node included. */
export function laneTiles(node: Pt): Pt[] {
  const out: Pt[] = [];
  if (laneOf(node) === 'col') {
    for (let v = ZONE_SIZE; v <= node.y; v++) out.push({ x: 0, y: v });
    if (node.x !== 0) out.push({ x: node.x, y: node.y });
  } else {
    for (let u = ZONE_SIZE; u <= node.x; u++) out.push({ x: u, y: 1 });
  }
  return out;
}

/**
 * The round trip a truck drives to fetch from `node` and back the same way.
 * `from` is where it parks, in zone-local coordinates; the result is in tile
 * coordinates with the node itself as the half-way point.
 */
export function supplyRoute(c: Corner, from: Pt, node: Pt): Pt[] {
  const lane =
    laneOf(node) === 'col'
      ? [toWorld(c, 0, from.y), toWorld(c, 0, node.y - 1), toWorld(c, node.x, node.y)]
      : [toWorld(c, from.x, 1), toWorld(c, node.x - 1, 1), toWorld(c, node.x, node.y)];
  return [...lane, ...lane.slice(0, -1).reverse()];
}

/**
 * Tiles inside the zone that are kept clear for trucks: the depot and the two
 * lanes (the row along the top edge and the column down the outer edge).
 */
export function isReservedLocal(u: number, v: number): boolean {
  if (u >= DEPOT_LOCAL.u && u <= DEPOT_LOCAL.u + 1 && v >= DEPOT_LOCAL.v && v <= DEPOT_LOCAL.v + 1) return true;
  if (v === 1 && u >= 1 && u <= ZONE_SIZE - 1) return true;
  if (u === 0 && v >= 2 && v <= ZONE_SIZE - 1) return true;
  // The ring an upgraded base adds: the same two lanes run on through it, out to the nodes.
  return (u >= ZONE_SIZE && v === 1) || (v >= ZONE_SIZE && u === 0);
}

export function inBoard(x: number, y: number, n = BOARD_SIZE): boolean {
  return x >= 0 && y >= 0 && x < n && y < n;
}

export const key = (x: number, y: number): string => `${x},${y}`;

export const cheb = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Local zone coordinates -> tile coordinates. */
export function toWorld(c: Corner, u: number, v: number): Pt {
  return { x: c.ox + u * c.dx, y: c.oy + v * c.dy };
}

/** Tile coordinates -> local zone coordinates. */
export function toLocal(c: Corner, x: number, y: number): Pt {
  return { x: (x - c.ox) * c.dx, y: (y - c.oy) * c.dy };
}

/** Footprint of a w x h structure whose local origin is (u, v). */
export function footprint(c: Corner, u: number, v: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const a = toWorld(c, u, v);
  const b = toWorld(c, u + w - 1, v + h - 1);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h };
}

/** One player's zone is `ZONE_SIZE` tiles on a side, and a ring wider once their base is upgraded. */
export const zoneSize = (p: PlayerState): number => ((p.buildings.find((b) => b.key === 'hq')?.level) ?? 1) > 1 ? ZONE_SIZE + 1 : ZONE_SIZE;

/** Every tile of a zone `size` tiles on a side that sits in `corner`. */
export function zoneTiles(corner: number, n = BOARD_SIZE, size = ZONE_SIZE): Pt[] {
  const c = cornersOf(n)[corner];
  const out: Pt[] = [];
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) out.push(toWorld(c, u, v));
  return out;
}

/** The ring an upgraded base adds: one tile out along both sides that face the battlefield. */
export function ringTiles(c: Corner, size = ZONE_SIZE + 1): Pt[] {
  const out: Pt[] = [];
  for (let u = 0; u < size; u++) out.push(toWorld(c, u, size - 1));
  for (let v = 0; v < size - 1; v++) out.push(toWorld(c, size - 1, v));
  return out;
}

/** Fractional centre of a structure. The defense net (0x0) stores its centre directly. */
export function buildingCenter(b: Building): Pt {
  if (b.w === 0 || b.h === 0) return { x: b.x, y: b.y };
  return { x: b.x + (b.w - 1) / 2, y: b.y + (b.h - 1) / 2 };
}

/** Distance from a point to the nearest tile of a structure. */
export function distToBuilding(p: Pt, b: Building): number {
  if (b.w === 0 || b.h === 0) return cheb(p, b);
  const dx = p.x < b.x ? b.x - p.x : p.x > b.x + b.w - 1 ? p.x - (b.x + b.w - 1) : 0;
  const dy = p.y < b.y ? b.y - p.y : p.y > b.y + b.h - 1 ? p.y - (b.y + b.h - 1) : 0;
  return Math.max(dx, dy);
}

export function tilesOf(b: Building): Pt[] {
  const out: Pt[] = [];
  for (let x = b.x; x < b.x + b.w; x++) for (let y = b.y; y < b.y + b.h; y++) out.push({ x, y });
  return out;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainAt(s: GameState, x: number, y: number): Terrain {
  return inBoard(x, y, s.boardSize) ? s.terrain[y * s.boardSize + x] : 'plain';
}

/** What the ground under (x, y) does to a unit of `family`. */
export function terrainEffect(s: GameState, family: UnitFamily, x: number, y: number): TerrainEffect {
  return TERRAIN[terrainAt(s, x, y)].effects[family] ?? {};
}

const modeOfFamily = (f: UnitFamily): MoveMode => (f === 'tank' ? 'track' : f === 'air' ? 'air' : 'foot');

export const moveModeOf = (k: UnitKey): MoveMode => modeOfFamily(UNITS[k].family);

/** May something that travels this way stand on the tile, terrain only? */
export function passable(s: GameState, x: number, y: number, mode: MoveMode): boolean {
  if (!inBoard(x, y, s.boardSize)) return false;
  // Wings are stopped by nothing; everyone else is stopped only by ground that bars them.
  return TERRAIN[terrainAt(s, x, y)].blocks.every((f) => modeOfFamily(f) !== mode);
}

// ---------------------------------------------------------------------------
// Occupancy + pathfinding
// ---------------------------------------------------------------------------

export class BoardIndex {
  ground = new Map<string, Unit>();
  air = new Map<string, Unit>();
  /** Aliens and small spiders, by tile: the id of whatever stands there. */
  others = new Map<string, number>();
  /** Buildings and resource nodes. */
  blocked = new Set<string>();

  constructor(s: GameState) {
    for (const p of s.players) {
      for (const b of p.buildings) for (const t of tilesOf(b)) this.blocked.add(key(t.x, t.y));
      for (const u of p.units) {
        (UNITS[u.key].unitClass === 'air' ? this.air : this.ground).set(key(u.x, u.y), u);
      }
    }
    for (const n of s.nodes) this.blocked.add(key(n.x, n.y));
    for (const a of s.aliens) this.others.set(key(a.x, a.y), a.id);
    for (const b of s.brood) this.others.set(key(b.x, b.y), b.id);
  }
}

/** `selfId` is the id of whoever is asking, so that a thing never blocks its own tile. */
export function isFree(idx: BoardIndex, s: GameState, x: number, y: number, mode: MoveMode, selfId = 0): boolean {
  if (!passable(s, x, y, mode)) return false;
  const k = key(x, y);
  if (mode === 'air') {
    const a = idx.air.get(k);
    return !a || a.id === selfId;
  }
  if (idx.blocked.has(k)) return false;
  const g = idx.ground.get(k);
  if (g && g.id !== selfId) return false;
  // Aliens and spiders are not units; they are simply somebody else standing there.
  const other = idx.others.get(k);
  if (other !== undefined && other !== selfId) return false;
  return true;
}

/** The eight neighbouring tiles, as offsets. */
export const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Every tile `start` can reach in `move` steps, mapped to the path leading there
 * (start excluded). Ground units walk around obstacles and may not slip between
 * two diagonally touching blockers; air units fly over everything.
 */
export function reachable(
  idx: BoardIndex,
  s: GameState,
  start: Pt,
  mode: MoveMode,
  move: number,
  selfId: number,
): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  const seen = new Set<string>([key(start.x, start.y)]);
  let frontier: Array<Pt & { path: Pt[] }> = [{ x: start.x, y: start.y, path: [] }];
  for (let step = 0; step < move && frontier.length; step++) {
    const next: Array<Pt & { path: Pt[] }> = [];
    for (const n of frontier) {
      for (const [dx, dy] of DIRS8) {
        const x = n.x + dx;
        const y = n.y + dy;
        const k = key(x, y);
        if (seen.has(k) || !isFree(idx, s, x, y, mode, selfId)) continue;
        if (mode !== 'air' && dx !== 0 && dy !== 0) {
          // No cutting corners: both side tiles must be open too.
          if (!isFree(idx, s, x, n.y, mode, selfId) || !isFree(idx, s, n.x, y, mode, selfId)) continue;
        }
        seen.add(k);
        const path = [...n.path, { x, y }];
        out.set(k, path);
        next.push({ x, y, path });
      }
    }
    frontier = next;
  }
  return out;
}

/** Is `from` close enough to `target` to act on it from `range` tiles away? */
export function withinRange(from: Pt, target: Pt | Building, range: number): boolean {
  return 'w' in target ? distToBuilding(from, target) <= range : cheb(from, target) <= range;
}

/**
 * Shortest route for `mode` from `from` to the nearest tile within `range` of
 * `target`. Units are ignored because they move: the caller checks the first
 * few steps against the live board before committing to them.
 */
export function route(s: GameState, from: Pt, target: Pt | Building, range: number, mode: MoveMode): Pt[] | null {
  const n = s.boardSize;
  const idx = new BoardIndex(s);
  const prev = new Int32Array(n * n).fill(-1);
  const start = from.y * n + from.x;
  prev[start] = start;
  const solid = (x: number, y: number): boolean => !passable(s, x, y, mode) || (mode !== 'air' && idx.blocked.has(key(x, y)));
  let frontier = [start];
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const cx = i % n;
      const cy = (i - cx) / n;
      for (const [dx, dy] of DIRS8) {
        const x = cx + dx;
        const y = cy + dy;
        if (!inBoard(x, y, n)) continue;
        const j = y * n + x;
        if (prev[j] !== -1 || solid(x, y)) continue;
        if (mode !== 'air' && dx !== 0 && dy !== 0 && (solid(x, cy) || solid(cx, y))) continue;
        prev[j] = i;
        if (withinRange({ x, y }, target, range)) {
          const path: Pt[] = [{ x, y }];
          for (let k = i; k !== start; k = prev[k]) path.push({ x: k % n, y: (k - (k % n)) / n });
          return path.reverse();
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

/** The tile nearest to `at` that `mode` can stand on, ignoring units. */
export function nearestOpen(s: GameState, at: Pt, mode: MoveMode, idx = new BoardIndex(s)): Pt | null {
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let y = 0; y < s.boardSize; y++) {
    for (let x = 0; x < s.boardSize; x++) {
      if (!isFree(idx, s, x, y, mode)) continue;
      const d = cheb(at, { x, y });
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

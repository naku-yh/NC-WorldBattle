import { terrainAt } from '../game/board';
import type { GameState } from '../game/types';

/**
 * The water of a map as one body with smooth banks.
 *
 * The rules only know tiles, but water drawn tile by tile is a staircase: it
 * reads as so many squares, and wherever the river steps sideways two tiles
 * touch at a single corner. So the water is drawn as a shape laid over the
 * tiles instead, as wide as one tile all the way. A wet tile keeps its whole
 * tile wherever another wet tile carries the water on, and its outside corners
 * are rounded off. Where two wet tiles touch only at a corner, the water is
 * carried round the bend in a straight diagonal channel as wide as itself,
 * which takes the corner off each of the two dry tiles beside it; and where
 * three wet tiles stand round one dry one, the inside corner is given a small
 * rounded fill. The same pieces serve twice: filled in on the board's texture,
 * and fanned out into the sheet of water that shimmers over it.
 *
 * Points are in board units: tile (tx, ty) spans tx..tx + 1 by ty..ty + 1, y north.
 */

/** A point of the water: where it is, and its depth, meaning how far it lies from the nearest bank. */
export type WaterPoint = readonly [number, number, number];

export interface WaterPiece {
  outline: WaterPoint[];
  /** What the outline is fanned out from: the middle of a tile, or the corner an elbow or a fill is laid at. */
  hub: WaterPoint;
  /** A river on the move, 1; a lake at rest, 0. */
  flow: 0 | 1;
}

/** A straight stretch of bank. */
interface Seg {
  kind: 'seg';
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
/** An arc of bank round (`cx`, `cy`), from the angle `from` round through `sweep`. */
interface Arc {
  kind: 'arc';
  cx: number;
  cy: number;
  r: number;
  from: number;
  sweep: number;
}
type Bank = Seg | Arc;

/** Water laid into a dry tile at one of its corners: a quarter of a disc, or the corner cut off diagonally by the channel round a bend. */
interface Patch {
  qx: number;
  qy: number;
  r: number;
  diagonal: boolean;
}

/** The channel round one bend, where it lays into a dry tile: the lattice point the bend turns at, and which way the dry tile lies from it. */
interface Elbow {
  px: number;
  py: number;
  qx: number;
  qy: number;
}

/** What takes over a corner's two sides, and how far along each: nothing, an arc, or what is laid beyond the corner. */
interface Take {
  in: number;
  out: number;
}

/** Half a tile: the radius of the rounded outside corners, and the most any point of a body one tile wide lies from its bank. */
export const R = 0.5;
/** How far along the tiles the diagonal channel round a bend reaches from the corner it turns at. Half a tile measured across the channel is this far measured along its banks. */
const ELBOW = R * Math.SQRT2;
/** How far an inside corner is filled in. Kept small, so that whatever stands on the dry tile beside it stays clear of the water. */
const FILL = 0.3;
/** Straight pieces to a quarter circle. */
const ARC = 6;
const QUARTER = Math.PI / 2;

/** East, north, west, south: the way from a tile to the neighbour on that side. */
const DIR: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
/** The way the outline is walked along each side: south side eastwards, east side northwards, north side westwards, west side southwards. */
const along = (side: number): readonly [number, number] => DIR[(side + 1) % 4];
/** The side the outline arrives at each corner along, and the one it leaves on. Side `k` runs from corner `k` to corner `k + 1`. */
const ARRIVE = [3, 0, 1, 2] as const;
const LEAVE = [0, 1, 2, 3] as const;
/** Where each corner sits in its tile, in the order the outline reaches them: south-east, north-east, north-west, south-west. */
const CORNER: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];
/** The four tiles round a lattice point, by which way they lie from it: south-west, south-east, north-east, north-west. */
const QUAD: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Tiles that carry water, bridges included: a bridge is a deck laid over the river, not a break in it. */
export const flooded = (s: GameState, x: number, y: number): boolean => {
  const t = terrainAt(s, x, y);
  return t === 'water' || t === 'lake' || t === 'bridge';
};

/** An arc of radius `r` round (`cx`, `cy`), from the angle `from` on round through `sweep`: its points, and the bank it makes. */
function arc(cx: number, cy: number, r: number, from: number, sweep: number): { points: Array<[number, number]>; bank: Arc } {
  const points: Array<[number, number]> = [];
  for (let k = 0; k <= ARC; k++) {
    const a = from + (k / ARC) * sweep;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { points, bank: { kind: 'arc', cx, cy, r, from, sweep } };
}

/** The angle the quarter circle round the origin starts at in the quadrant (`qx`, `qy`) points into. */
const quadrant = (qx: number, qy: number): number => (qx > 0 ? (qy > 0 ? 0 : -QUARTER) : qy > 0 ? QUARTER : Math.PI);

/** How far the point lies from the piece of bank. */
function toBank(b: Bank, x: number, y: number): number {
  if (b.kind === 'seg') {
    const dx = b.bx - b.ax;
    const dy = b.by - b.ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - b.ax) * dx + (y - b.ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(x - b.ax - t * dx, y - b.ay - t * dy);
  }
  let turn = Math.atan2(y - b.cy, x - b.cx) - b.from;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  if (turn >= 0 && turn <= b.sweep) return Math.abs(Math.hypot(x - b.cx, y - b.cy) - b.r);
  // Beyond the ends of the arc the bank turns off elsewhere: only the end itself is left to measure to.
  const end = turn < 0 ? b.from : b.from + b.sweep;
  return Math.hypot(x - b.cx - Math.cos(end) * b.r, y - b.cy - Math.sin(end) * b.r);
}

export class WaterShape {
  readonly pieces: WaterPiece[] = [];
  /** Whether any of it is a river on the move rather than a lake at rest. */
  readonly river: boolean;
  /** The water laid into dry tiles, by tile: the only water to be found on a dry tile. */
  private patches = new Map<string, Patch[]>();
  /** The channels round bends, by the dry tile each lays into. */
  private elbows = new Map<string, Elbow[]>();
  /** Every stretch of bank there is. A point's depth is its distance to the nearest one. */
  private banks: Bank[] = [];
  private readonly wet: (x: number, y: number) => boolean;

  constructor(private readonly s: GameState) {
    const n = s.boardSize;
    // Off the board counts as wet: the river runs right up to the edge and off it, with no bank along the edge.
    const wet = (x: number, y: number): boolean => x < 0 || y < 0 || x >= n || y >= n || flooded(s, x, y);
    this.wet = wet;
    let river = false;
    const jointed = new Set<string>();
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        if (!flooded(s, tx, ty)) continue;
        const flow: 0 | 1 = terrainAt(s, tx, ty) === 'lake' ? 0 : 1;
        river ||= flow === 1;
        // What lies beyond each corner: water or not on the side the outline arrives along, on the side it leaves on, and diagonally.
        const beyond = [0, 1, 2, 3].map((i) => {
          const arriving = ARRIVE[i];
          const leaving = LEAVE[i];
          return {
            a: wet(tx + DIR[arriving][0], ty + DIR[arriving][1]),
            b: wet(tx + DIR[leaving][0], ty + DIR[leaving][1]),
            d: wet(tx + DIR[arriving][0] + DIR[leaving][0], ty + DIR[arriving][1] + DIR[leaving][1]),
          };
        });
        // An outside corner has dry ground beyond on every side. An elbow is a corner with dry tiles on both sides and water beyond
        // the corner itself: the water is carried round it (see `joint`).
        const outside = beyond.map(({ a, b, d }) => !a && !b && !d);
        const elbow = beyond.map(({ a, b, d }) => !a && !b && d);
        // How far along the side it comes in on, and the side it goes out on, each corner takes over from the straight bank.
        const take: Take[] = beyond.map(({ a, b, d }) => {
          // The arc of a rounded corner takes in half a tile of either side; an elbow's channel reaches further.
          if (!a && !b) return { in: d ? ELBOW : R, out: d ? ELBOW : R };
          // An inside corner, three tiles wet round one dry: the fill laid into the dry tile takes over the sides that face it.
          if (a && b) return { in: FILL, out: FILL };
          if (a && d) return { in: 0, out: FILL };
          if (b && d) return { in: FILL, out: 0 };
          return { in: 0, out: 0 };
        });
        const outline: Array<[number, number]> = [];
        for (let i = 0; i < 4; i++) {
          const arriving = ARRIVE[i];
          const leaving = LEAVE[i];
          const px = tx + CORNER[i][0];
          const py = ty + CORNER[i][1];
          const back = along(arriving);
          const forth = along(leaving);
          if (outside[i]) {
            // Rounded off with a quarter of the tile's inscribed circle, from half way back along the side the outline came in on to
            // half way along the side it goes out on. With an elbow round on either side, the diagonal channel takes the bank over
            // where it touches the circle, so the arc stops an eighth of a turn short on that side, and runs straight on from there.
            const from = Math.atan2(CORNER[i][1] - R - R * back[1], CORNER[i][0] - R - R * back[0]);
            const cutBefore = elbow[(i + 3) % 4];
            const cutAfter = elbow[(i + 1) % 4];
            if (cutBefore) outline.push([px - (1 - ELBOW) * back[0], py - (1 - ELBOW) * back[1]]);
            const start = from + (cutBefore ? QUARTER / 2 : 0);
            const sweep = QUARTER - (cutBefore ? QUARTER / 2 : 0) - (cutAfter ? QUARTER / 2 : 0);
            if (sweep > 0) {
              const round = arc(tx + R, ty + R, R, start, sweep);
              outline.push(...round.points);
              this.banks.push(round.bank);
            } else {
              // Cut short on both sides: all that is left of the circle is the one point both channels leave it.
              outline.push([tx + R + R * Math.cos(start), ty + R + R * Math.sin(start)]);
            }
            if (cutAfter) outline.push([px + (1 - ELBOW) * forth[0], py + (1 - ELBOW) * forth[1]]);
          } else {
            // Any other corner is a point of the outline, with either side marked where what is laid beyond takes over from it.
            if (take[i].in) outline.push([px - take[i].in * back[0], py - take[i].in * back[1]]);
            outline.push([px, py]);
            if (take[i].out) outline.push([px + take[i].out * forth[0], py + take[i].out * forth[1]]);
          }
          // From this corner to the next, the side they share: what is left of its bank where the water stops, and a point half way
          // along where it carries on.
          const side = leaving;
          const next = (i + 1) % 4;
          if (!wet(tx + DIR[side][0], ty + DIR[side][1])) {
            const seg: Seg = {
              kind: 'seg',
              ax: px + take[i].out * forth[0],
              ay: py + take[i].out * forth[1],
              bx: tx + CORNER[next][0] - take[next].in * forth[0],
              by: ty + CORNER[next][1] - take[next].in * forth[1],
            };
            // Where both ends are taken over whole, or an elbow's channel runs diagonally instead, no straight bank is left.
            if ((seg.bx - seg.ax) * forth[0] + (seg.by - seg.ay) * forth[1] > 1e-6) this.banks.push(seg);
          } else {
            outline.push([tx + (CORNER[i][0] + CORNER[next][0]) / 2, ty + (CORNER[i][1] + CORNER[next][1]) / 2]);
          }
          const key = `${px},${py}`;
          if (!jointed.has(key)) {
            jointed.add(key);
            this.joint(px, py);
          }
        }
        this.pieces.push({ outline: outline.map(([x, y]) => [x, y, 0]), hub: [tx + R, ty + R, 0], flow });
      }
    }
    this.river = river;
    for (const list of this.elbows.values()) this.layElbows(list);
    if (!this.banks.length) return;
    // The depth of every point is its distance from the nearest bank: never more than half a tile, whatever lies beyond.
    const depth = (x: number, y: number): number => {
      let d = R;
      for (const b of this.banks) d = Math.min(d, toBank(b, x, y));
      return d;
    };
    for (const piece of this.pieces) {
      piece.hub = [piece.hub[0], piece.hub[1], depth(piece.hub[0], piece.hub[1])];
      piece.outline = piece.outline.map(([x, y]) => [x, y, depth(x, y)]);
    }
  }

  /** Is the point, in board units, under water? */
  at(x: number, y: number): boolean {
    const n = this.s.boardSize;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) return false;
    if (flooded(this.s, tx, ty)) {
      const dx = x - tx - R;
      const dy = y - ty - R;
      if (dx * dx + dy * dy <= R * R) return true;
      // Beyond the inscribed circle only the corners can be dry, and only the rounded ones: those with nothing wet beyond either side.
      const ex = tx + (dx > 0 ? 1 : -1);
      const ny = ty + (dy > 0 ? 1 : -1);
      return this.wet(ex, ty) || this.wet(tx, ny) || this.wet(ex, ny);
    }
    for (const p of this.patches.get(`${tx},${ty}`) ?? []) {
      const u = p.qx * (x - tx - (p.qx > 0 ? 1 : 0));
      const v = p.qy * (y - ty - (p.qy > 0 ? 1 : 0));
      if (u < 0 || v < 0) continue;
      if (p.diagonal ? u + v <= p.r : u * u + v * v <= p.r * p.r) return true;
    }
    return false;
  }

  /**
   * What the four tiles round the lattice point (`px`, `py`) call for, on top
   * of the tiles themselves: a fill in the one dry tile at an inside corner, or
   * the channel round the bend in each of the two dry tiles where two wet tiles
   * touch here and nowhere else. The channels are only noted here and laid
   * once the whole map has been seen, because two of them can fall in one dry
   * tile, where the river turns sharply (see `layElbows`).
   */
  private joint(px: number, py: number): void {
    const around = QUAD.map(([qx, qy]) => ({ qx, qy, wet: this.wet(px + (qx > 0 ? 0 : -1), py + (qy > 0 ? 0 : -1)) }));
    const wet = around.filter((t) => t.wet);
    if (wet.length !== 2 && wet.length !== 3) return;
    // Two wet tiles touching at a corner lie either side of the point; side by side they need nothing.
    if (wet.length === 2 && around[0].wet !== around[2].wet) return;
    const flow: 0 | 1 = wet.some((t) => terrainAt(this.s, px + (t.qx > 0 ? 0 : -1), py + (t.qy > 0 ? 0 : -1)) !== 'lake') ? 1 : 0;
    for (const t of around.filter((q) => !q.wet)) {
      const key = `${px + (t.qx > 0 ? 0 : -1)},${py + (t.qy > 0 ? 0 : -1)}`;
      if (wet.length === 3) {
        // An inside corner: a quarter of a disc in the dry tile.
        const round = arc(px, py, FILL, quadrant(t.qx, t.qy), QUARTER);
        this.pieces.push({ outline: round.points.map(([x, y]) => [x, y, 0]), hub: [px, py, FILL], flow });
        this.banks.push(round.bank);
        const list = this.patches.get(key) ?? [];
        list.push({ qx: t.qx, qy: t.qy, r: FILL, diagonal: false });
        this.patches.set(key, list);
      } else {
        const list = this.elbows.get(key) ?? [];
        list.push({ px, py, qx: t.qx, qy: t.qy });
        this.elbows.set(key, list);
        const laid = this.patches.get(key) ?? [];
        laid.push({ qx: t.qx, qy: t.qy, r: ELBOW, diagonal: true });
        this.patches.set(key, laid);
      }
    }
  }

  /**
   * Lays the channels round bends that fall in one dry tile. Each is the
   * corner of the tile cut off by a straight bank. Where the river turns
   * sharply, two of them fall in the same tile at corners along the same side
   * and would lie over each other: they are laid as one piece then, its bank
   * coming down each side to a point, which is the inside of the turn.
   */
  private layElbows(list: Elbow[]): void {
    let rest = list;
    while (rest.length) {
      const [first, ...others] = rest;
      // A neighbour along one side of the tile: the same way off as `first` on one axis, the opposite way on the other.
      const at = others.findIndex((e) => e.px === first.px || e.py === first.py);
      const pair = at >= 0 ? others.splice(at, 1)[0] : null;
      rest = others;
      const flow: 0 | 1 = this.moving(first) || (pair ? this.moving(pair) : false) ? 1 : 0;
      // The two ends of the bank that cuts the corner off: one along the tile's x axis from the lattice point, one along its y axis.
      const alongX = (e: Elbow): [number, number] => [e.px + e.qx * ELBOW, e.py];
      const alongY = (e: Elbow): [number, number] => [e.px, e.py + e.qy * ELBOW];
      if (!pair) {
        const [ax, ay] = alongX(first);
        const [bx, by] = alongY(first);
        this.pieces.push({ outline: [[ax, ay, 0], [bx, by, 0]], hub: [first.px, first.py, ELBOW], flow });
        this.banks.push({ kind: 'seg', ax, ay, bx, by });
        continue;
      }
      // Of each bank, the end that lies on the side the two lattice points share falls inside the water once both channels are
      // laid; the other end is where the bank starts. Between them the two banks cross: the inside of the turn.
      const flat = pair.py === first.py;
      const [i1x, i1y] = flat ? alongX(first) : alongY(first);
      const [o1x, o1y] = flat ? alongY(first) : alongX(first);
      const [i2x, i2y] = flat ? alongX(pair) : alongY(pair);
      const [o2x, o2y] = flat ? alongY(pair) : alongX(pair);
      const cross = meeting(i1x, i1y, o1x, o1y, i2x, i2y, o2x, o2y);
      this.pieces.push({
        outline: [
          [first.px, first.py, 0],
          [o1x, o1y, 0],
          [cross[0], cross[1], 0],
          [o2x, o2y, 0],
          [pair.px, pair.py, 0],
        ],
        hub: [(first.px + pair.px) / 2, (first.py + pair.py) / 2, ELBOW],
        flow,
      });
      this.banks.push({ kind: 'seg', ax: o1x, ay: o1y, bx: cross[0], by: cross[1] });
      this.banks.push({ kind: 'seg', ax: cross[0], ay: cross[1], bx: o2x, by: o2y });
    }
  }

  /** Whether the bend carries a river on the move rather than a lake: whether any of the tiles it joins is one. */
  private moving(e: Elbow): boolean {
    for (const [qx, qy] of QUAD) {
      const x = e.px + (qx > 0 ? 0 : -1);
      const y = e.py + (qy > 0 ? 0 : -1);
      if (this.wet(x, y) && terrainAt(this.s, x, y) !== 'lake') return true;
    }
    return false;
  }
}

/** Where the line from (`a1x`, `a1y`) to (`a2x`, `a2y`) meets the line from (`b1x`, `b1y`) to (`b2x`, `b2y`). */
function meeting(a1x: number, a1y: number, a2x: number, a2y: number, b1x: number, b1y: number, b2x: number, b2y: number): [number, number] {
  const d = (a1x - a2x) * (b1y - b2y) - (a1y - a2y) * (b1x - b2x);
  if (Math.abs(d) < 1e-9) return [a2x, a2y];
  const t = ((a1x - b1x) * (b1y - b2y) - (a1y - b1y) * (b1x - b2x)) / d;
  return [a1x + t * (a2x - a1x), a1y + t * (a2y - a1y)];
}

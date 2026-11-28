import { holderOf, terrainAt, zoneSize } from '../game/board';
import { RESOURCES, UNITS } from '../game/data';
import { alienStats } from '../game/engine';
import type { GameState } from '../game/types';
import { TERRAIN_COLORS } from '../render/palette';

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CSS_SIZE = 176;
const SPIDER = '#e879f9';
const BONE = '#e7e5d8';

/** The terrain of the whole board on a square canvas `side` pixels wide. Returns the size of one tile. */
export function paintGround(g: CanvasRenderingContext2D, s: GameState, side: number): number {
  const px = side / s.boardSize;
  for (let y = 0; y < s.boardSize; y++) {
    for (let x = 0; x < s.boardSize; x++) {
      g.fillStyle = TERRAIN_COLORS[terrainAt(s, x, y)].mini;
      g.fillRect(x * px, (s.boardSize - 1 - y) * px, px + 0.5, px + 0.5);
    }
  }
  return px;
}

/** The base zones, tinted in their owners' colours. Tiles are `px` wide; row 0 is at the bottom. */
export function paintZones(g: CanvasRenderingContext2D, s: GameState, px: number): void {
  const n = s.boardSize;
  for (const p of s.players) {
    if (!p.alive) continue;
    const k = s.corners[p.corner];
    const size = zoneSize(p);
    const x0 = Math.min(k.ox, k.ox + (size - 1) * k.dx);
    const y1 = Math.max(k.oy, k.oy + (size - 1) * k.dy);
    g.fillStyle = p.color;
    g.globalAlpha = 0.3;
    g.fillRect(x0 * px, (n - 1 - y1) * px, size * px, size * px);
    g.globalAlpha = 1;
    g.lineWidth = Math.max(1.5, px * 0.22);
    g.strokeStyle = p.color;
    g.strokeRect(x0 * px + g.lineWidth / 2, (n - 1 - y1) * px + g.lineWidth / 2, size * px - g.lineWidth, size * px - g.lineWidth);
  }
}

/** Resource nodes, buildings, units and the alien, as seen from above. Tiles are `px` wide. */
export function paintForces(g: CanvasRenderingContext2D, s: GameState, px: number): void {
  const n = s.boardSize;
  const X = (x: number): number => x * px;
  const Y = (y: number): number => (n - 1 - y) * px;
  for (const node of s.nodes) {
    g.fillStyle = RESOURCES[node.resource].color;
    g.beginPath();
    g.arc(X(node.x + 0.5), Y(node.y + 0.5), px * 0.36, 0, Math.PI * 2);
    g.fill();
  }
  // The houses and towers of the map: grey while nobody holds them, the holder's colour once someone does.
  for (const c of s.city ?? []) {
    const holder = holderOf(s, c);
    g.fillStyle = holder ? holder.color : '#cbd5e1';
    g.fillRect(X(c.x) + px * 0.22, Y(c.y) + px * 0.22, px * 0.56, px * 0.56);
  }
  // Buildings, then the units parked on top of them.
  for (const p of s.players) {
    for (const b of p.buildings) {
      if (b.w === 0) continue;
      g.fillStyle = p.color;
      g.fillRect(X(b.x), Y(b.y + b.h - 1), b.w * px, b.h * px);
      if (b.key === 'hq') {
        g.strokeStyle = '#ffffff';
        g.lineWidth = Math.max(1, px * 0.14);
        g.strokeRect(X(b.x) + g.lineWidth / 2, Y(b.y + b.h - 1) + g.lineWidth / 2, b.w * px - g.lineWidth, b.h * px - g.lineWidth);
      }
    }
  }
  for (const p of s.players) {
    for (const u of p.units) {
      // A soldier inside a building is part of its square, not a dot of its own.
      if (u.inside !== undefined) continue;
      const air = UNITS[u.key].unitClass === 'air';
      g.beginPath();
      g.arc(X(u.x + 0.5), Y(u.y + 0.5), px * 0.34, 0, Math.PI * 2);
      if (air) {
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(1, px * 0.16);
        g.stroke();
      } else {
        g.fillStyle = '#ffffff';
        g.fill();
      }
    }
  }
  // Aliens in their own colours, ringed in white so they stand out from the players' dots.
  for (const a of s.aliens) {
    g.beginPath();
    g.arc(X(a.x + 0.5), Y(a.y + 0.5), px * 0.62, 0, Math.PI * 2);
    // A dragon that was a dinosaur a moment ago has its own colour.
    g.fillStyle = alienStats(a).color;
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1, px * 0.12);
    g.stroke();
  }
  for (const b of s.brood) {
    g.beginPath();
    g.arc(X(b.x + 0.5), Y(b.y + 0.5), px * 0.24, 0, Math.PI * 2);
    g.fillStyle = b.kind === 'skeleton' ? BONE : SPIDER;
    g.fill();
  }
}

/** A still of a match for a save's slot: the ground, the bases and everything standing on it. */
export function paintThumb(canvas: HTMLCanvasElement, s: GameState, side = 120): void {
  canvas.width = canvas.height = side;
  const g = canvas.getContext('2d');
  if (!g) return;
  const px = paintGround(g, s, side);
  paintZones(g, s, px);
  paintForces(g, s, px);
}

/** A bird's-eye view of the whole board, in the corner of the screen. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  /** Ground and base zones, repainted only when a new map comes up. */
  private ground: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private s: GameState | null = null;
  private seen = '';
  private px = 8;

  constructor(
    private canvas: HTMLCanvasElement,
    onClick: () => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ground = document.createElement('canvas');
    this.g = this.ground.getContext('2d')!;
    canvas.onclick = onClick;
  }

  /** A new match: lay down the terrain and the base zones. */
  load(s: GameState): void {
    this.s = s;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const side = Math.round(CSS_SIZE * dpr);
    this.px = side / s.boardSize;
    for (const c of [this.canvas, this.ground]) {
      c.width = side;
      c.height = side;
    }
    paintGround(this.g, s, side);
    this.seen = '';
    this.draw(null);
  }

  /** Something moved, was built or blew up. */
  update(s: GameState): void {
    this.s = s;
    this.draw(null);
  }

  /** Shows what part of the board the camera is looking at. */
  frame(b: Bounds): void {
    const sig = `${b.x0},${b.y0},${b.x1},${b.y1}`;
    if (sig === this.seen) return;
    this.seen = sig;
    this.draw(b);
  }

  private draw(view: Bounds | null): void {
    const s = this.s;
    if (!s) return;
    const n = s.boardSize;
    const px = this.px;
    const X = (x: number): number => x * px;
    const Y = (y: number): number => (n - 1 - y) * px;
    const c = this.ctx;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(this.ground, 0, 0);
    // Zones are not part of the still: a player who is knocked out loses theirs.
    paintZones(c, s, px);
    paintForces(c, s, px);
    // What the camera can see right now.
    if (view) {
      const w = X(view.x1) - X(view.x0);
      const hgt = Y(view.y0) - Y(view.y1);
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = 1.5;
      c.strokeRect(X(view.x0), Y(view.y1), w, hgt);
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 3;
      c.strokeRect(X(view.x0) + 0.5, Y(view.y1) + 0.5, w, hgt);
    }
  }
}

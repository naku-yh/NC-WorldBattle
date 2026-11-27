import { ALIEN_EVERY, MAP_SIZES, MAX_BOARD, MIN_BOARD } from '../game/data';
import type { GameState, Phase, Terrain } from '../game/types';

/** How many matches can be kept at once. */
export const SAVE_SLOTS = 3;
/** Bumped whenever GameState changes in a way old files cannot survive; such files are then refused. */
const VERSION = 2;
const PREFIX = 'nc-worldbattle.save.';

/** Everything a match needs to pick up where it left off. The state is plain data, so it stores as JSON. */
export interface SaveFile {
  v: number;
  savedAt: number;
  state: GameState;
}

/** One slot as the menus see it. */
export interface Slot {
  slot: number;
  save: SaveFile | null;
  /** A file is there, but this version of the game cannot read it. */
  broken: boolean;
}

/** What the slot list says about a save without opening the match. */
export interface SaveInfo {
  turn: string;
  /** Whose go it was: "玩家1 的回合", "掷骰子", … */
  moment: string;
  /** "2 人 · 中型" */
  setup: string;
  ago: string;
  /** Colour of the player whose go it was. */
  color: string;
}

export type SaveError = 'unavailable' | 'quota';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Null when the browser keeps no storage for this page (private mode, a locked-down frame). */
function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Coding
// ---------------------------------------------------------------------------

export function encodeSave(state: GameState, now = Date.now()): string {
  return JSON.stringify({ v: VERSION, savedAt: now, state } satisfies SaveFile);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isList = (x: unknown): x is unknown[] => Array.isArray(x);
const has = (o: Record<string, unknown>, keys: readonly string[]): boolean => keys.every((k) => k in o);

const TERRAINS: readonly Terrain[] = ['plain', 'hill', 'forest', 'water', 'lake', 'bridge'];
const PHASES: readonly Phase[] = ['roundStart', 'dice', 'aliens', 'player', 'gameover'];
const STATE_KEYS = [
  'rng', 'nextId', 'boardSize', 'corners', 'terrain', 'waterway', 'totalTurns', 'turn', 'phase', 'currentPlayer', 'order', 'orderIndex',
  'alienActed', 'dice', 'players', 'nodes', 'aliens', 'brood', 'nextAlien', 'aliensSeen', 'log', 'logId', 'ranking', 'gameOverReason',
] as const;
const PLAYER_KEYS = [
  'id', 'name', 'kind', 'color', 'alive', 'corner', 'resources', 'ap', 'trucks', 'buildings', 'units', 'powerCap', 'powerUsed',
  'producedThisTurn', 'score', 'damageDealt', 'kills',
] as const;

/** Enough of a look to tell a real save from a truncated file, another app's data or another version's layout. */
function looksLikeSave(x: unknown): x is SaveFile {
  if (!isObj(x) || x.v !== VERSION || typeof x.savedAt !== 'number' || !isObj(x.state)) return false;
  const s = x.state;
  if (!has(s, STATE_KEYS) || !isList(s.aliens) || !isList(s.brood)) return false;
  const n = s.boardSize;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_BOARD || n > MAX_BOARD) return false;
  if (!isList(s.terrain) || s.terrain.length !== n * n || !s.terrain.every((t) => TERRAINS.includes(t as Terrain))) return false;
  if (typeof s.phase !== 'string' || !PHASES.includes(s.phase as Phase)) return false;
  if (!isList(s.players) || s.players.length < 2 || s.players.length > 4) return false;
  return s.players.every((p) => isObj(p) && has(p, PLAYER_KEYS) && isList(p.units) && isList(p.buildings));
}

/** The save in `raw`, or null if it is missing or unreadable. */
export function decodeSave(raw: string | null): SaveFile | null {
  if (!raw) return null;
  try {
    let data: unknown = JSON.parse(raw);
    if (isObj(data) && data.v === 1 && isObj(data.state)) data = fromFirstVersion(data as unknown as { savedAt: number; state: StateV1 });
    return looksLikeSave(data) ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export function readSave(slot: number, from: Store | null = storage()): SaveFile | null {
  const raw = rawOf(slot, from);
  return raw === null ? null : decodeSave(raw);
}

/** Writes the match into `slot`. Returns what went wrong, or null once the file is in place. */
export function writeSave(slot: number, state: GameState, now = Date.now(), to: Store | null = storage()): SaveError | null {
  if (!to) return 'unavailable';
  try {
    to.setItem(PREFIX + slot, encodeSave(state, now));
    return null;
  } catch {
    // Full, or the browser refused the write.
    return 'quota';
  }
}

export function eraseSave(slot: number, from: Store | null = storage()): void {
  try {
    from?.removeItem(PREFIX + slot);
  } catch {
    // Nothing to erase, or not allowed to; either way the slot reads as empty.
  }
}

export function listSlots(from: Store | null = storage()): Slot[] {
  return Array.from({ length: SAVE_SLOTS }, (_, slot) => {
    const raw = rawOf(slot, from);
    const save = raw === null ? null : decodeSave(raw);
    return { slot, save, broken: raw !== null && !save };
  });
}

function rawOf(slot: number, from: Store | null): string | null {
  if (!from) return null;
  try {
    return from.getItem(PREFIX + slot);
  } catch {
    return null;
  }
}

/** What the state looked like before there was more than one alien, and before there were points. */
interface StateV1 {
  nextId: number;
  turn: number;
  phase: string;
  chloeActed: boolean;
  chloe: { alive: boolean; spawned: boolean; spawnTurn: number; x: number; y: number; hp: number };
  players: Array<Record<string, unknown> & { id: number; kills: number; chloeDamage: number }>;
  ranking: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/**
 * Brings a file written by the first version up to date. Nobody counted
 * points back then, so it counts what was kept: units destroyed, and damage
 * done to the one alien there was. Anything missing makes it throw, and the
 * caller then reports the file as unreadable rather than half-loading it.
 */
function fromFirstVersion(file: { savedAt: number; state: StateV1 }): SaveFile {
  const { chloeActed, chloe, players, ranking, ...rest } = file.state;
  const points = (p: { kills: number; chloeDamage: number }): number => p.kills * 30 + p.chloeDamage;
  const upgrade = (p: StateV1['players'][number]): Record<string, unknown> => {
    const { chloeDamage, ...rest } = p;
    return { ...rest, score: points(p) };
  };
  const scores = new Map(players.map((p) => [p.id, points(p)]));
  return {
    v: VERSION,
    savedAt: file.savedAt,
    state: {
      ...rest,
      nextId: rest.nextId + (chloe.alive ? 1 : 0),
      phase: rest.phase === 'chloe' ? 'aliens' : rest.phase,
      players: players.map(upgrade),
      ranking: ranking.map((r) => ({ ...r, score: scores.get(r.player as number) ?? 0 })),
      aliens: chloe.alive
        ? [{ id: rest.nextId, key: 'chloe', x: chloe.x, y: chloe.y, hp: chloe.hp, arrived: chloe.spawnTurn, hurt: Object.fromEntries(players.map((p) => [p.id, p.chloeDamage])) }]
        : [],
      brood: [],
      // Still waiting for the first one? It keeps its date. Otherwise a fresh gap starts from here.
      nextAlien: chloe.spawned ? rest.turn + ALIEN_EVERY[0] : chloe.spawnTurn,
      aliensSeen: chloe.spawned ? 1 : 0,
      alienActed: chloeActed,
    } as unknown as GameState,
  };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export function infoOf(save: SaveFile, now = Date.now()): SaveInfo {
  const s = save.state;
  const size = MAP_SIZES.find((m) => m.size === s.boardSize)?.name ?? `${s.boardSize}×${s.boardSize}`;
  let moment = '回合开始';
  let color = '#e6ecf5';
  if (s.phase === 'player') {
    const p = s.players[s.currentPlayer];
    moment = `${p.name} 的回合`;
    color = p.color;
  } else if (s.phase === 'dice') {
    moment = '掷骰子';
  } else if (s.phase === 'aliens') {
    moment = '外星人行动中';
    color = '#a78bfa';
  } else if (s.phase === 'gameover') {
    moment = '战斗结束';
  }
  return {
    turn: `第 ${Math.min(s.turn, s.totalTurns)} / ${s.totalTurns} 回合`,
    moment,
    setup: `${s.players.length} 人 · ${size}`,
    ago: ago(save.savedAt, now),
    color,
  };
}

/** "刚刚", "5 分钟前", "昨天 21:04", "11月26日 09:30". */
export function ago(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  const at = new Date(ts);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return at.toDateString() === yesterday.toDateString() ? `昨天 ${clock}` : `${at.getMonth() + 1}月${at.getDate()}日 ${clock}`;
}

export const SAVE_ERROR_TEXT: Record<SaveError, string> = {
  unavailable: '无法保存：浏览器没有为本页面开放本地存储',
  quota: '无法保存：本地存储空间已满',
};

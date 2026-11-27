import { ALIENS, SPIDERLING, UNITS } from '../data';
import { createGame, reduce } from '../engine';
import { aiDecide } from '../ai';
import type { Action, AlienKey, AlienState, Building, BuildingKey, GameEvent, GameState, PlayerState, Pt, Spiderling, Terrain, Unit, UnitKey } from '../types';

export interface MapOptions {
  size?: number;
  /** Rule tests run on bare grass so the numbers depend on nothing but the rules. */
  terrain?: 'random' | 'plain';
}

export function newGame(seats: ('human' | 'ai')[] = ['human', 'human'], seed?: number, totalTurns = 20, map: MapOptions = {}): GameState {
  return createGame({ seats, totalTurns, seed, size: map.size, terrain: map.terrain ?? 'plain' });
}

/** Paints one tile, e.g. to put a wood or a river exactly where a test needs it. */
export function setTerrain(s: GameState, x: number, y: number, t: Terrain): void {
  s.terrain[y * s.boardSize + x] = t;
}

export function apply(s: GameState, a: Action): GameEvent[] {
  const r = reduce(s, a);
  if (!r.ok) throw new Error(`unexpected rejection: ${r.reason}`);
  return r.events;
}

/** Returns the rejection reason, or null when the action was accepted. */
export function tryApply(s: GameState, a: Action): string | null {
  const r = reduce(s, a);
  return r.ok ? null : r.reason;
}

/** Rolls the dice and plays on until it is `playerId`'s turn. A no-op if it already is. */
export function toTurn(s: GameState, playerId = 0): PlayerState {
  let guard = 0;
  while (s.phase !== 'player' || s.currentPlayer !== playerId) {
    if (guard++ > 500) throw new Error('toTurn did not converge');
    if (s.phase === 'roundStart') apply(s, { type: 'ROLL_DICE' });
    else if (s.phase === 'dice' || s.phase === 'aliens') apply(s, { type: 'NEXT' });
    else apply(s, { type: 'END_TURN' });
  }
  return s.players[playerId];
}

/** Ends the current turn and plays on to `playerId`'s next one. */
export function nextTurn(s: GameState, playerId = 0): PlayerState {
  apply(s, { type: 'END_TURN' });
  return toTurn(s, playerId);
}

export function rich(p: PlayerState): void {
  p.resources = { ore: 99999, oil: 99999, meat: 99999 };
}

export function spawn(s: GameState, playerId: number, key: UnitKey, x: number, y: number): Unit {
  const u: Unit = { id: s.nextId++, key, owner: playerId, x, y, hp: UNITS[key].hp, moveUsed: false, attackUsed: false };
  s.players[playerId].units.push(u);
  return u;
}

/** Puts an alien of that kind on the board, as if it had just arrived. */
export function dropAlien(s: GameState, key: AlienKey, x: number, y: number): AlienState {
  const a: AlienState = { id: s.nextId++, key, x, y, hp: ALIENS[key].hp, arrived: s.turn, hurt: {} };
  s.aliens.push(a);
  return a;
}

/** One of 奎德's small spiders. */
export function dropSpider(s: GameState, owner: number, x: number, y: number): Spiderling {
  const b: Spiderling = { id: s.nextId++, owner, x, y, hp: SPIDERLING.hp };
  s.brood.push(b);
  return b;
}

/** Builds on the current player's turn; they must be able to pay. */
export function build(s: GameState, key: BuildingKey): Building {
  const p = s.players[s.currentPlayer];
  const before = p.buildings.length;
  apply(s, { type: 'BUILD', key });
  const b = p.buildings[p.buildings.length - 1];
  if (p.buildings.length !== before + 1 || b.key !== key) throw new Error(`build ${key} failed`);
  return b;
}

/** An unarmed building placed by hand, for tests that need a specific layout. */
export function placeBuilding(s: GameState, p: PlayerState, key: BuildingKey, x: number, y: number, w = 1, h = 1): Building {
  const b: Building = {
    id: s.nextId++,
    key,
    level: 1,
    hp: 30,
    maxHp: 30,
    x,
    y,
    w,
    h,
    powered: true,
    fired: false,
    reacted: false,
  };
  p.buildings.push(b);
  return b;
}

/** The path of the single move event in `events`. */
export function pathOf(events: GameEvent[]): Pt[] {
  const e = events.find((x) => x.type === 'move');
  if (!e || e.type !== 'move') throw new Error('no move event');
  return e.path;
}

/**
 * One step of letting the computer play: roll, move on, or give one order.
 * Returns why the rules refused that order, or null if they did not.
 */
export function step(s: GameState): string | null {
  if (s.phase === 'roundStart') apply(s, { type: 'ROLL_DICE' });
  else if (s.phase === 'dice' || s.phase === 'aliens') apply(s, { type: 'NEXT' });
  else {
    const a = aiDecide(s, s.currentPlayer);
    if (!a) apply(s, { type: 'END_TURN' });
    else {
      const r = reduce(s, a);
      if (!r.ok) {
        apply(s, { type: 'END_TURN' });
        return `${a.type}: ${r.reason}`;
      }
    }
  }
  return null;
}

/**
 * Lets the computer play every seat until the game is over. Also reports any
 * order the AI gave that the engine refused, which should always be none.
 */
export function playGame(seats: ('human' | 'ai')[], seed: number, totalTurns = 20, map: MapOptions = { terrain: 'random' }) {
  // The computer players have to cope with whatever map comes up.
  const s = newGame(seats, seed, totalTurns, map);
  const rejects: string[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && steps++ < 400000) {
    const why = step(s);
    if (why) rejects.push(why);
  }
  return { s, rejects, steps };
}

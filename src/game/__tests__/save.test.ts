import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../types';
import { apply, newGame, rich, step, toTurn } from './helpers';

/** What comes back out of a save file. */
const thaw = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/** Plays every seat by computer until the match ends. */
function playOut(s: GameState): void {
  for (let guard = 0; s.phase !== 'gameover'; guard++) {
    if (guard > 400000) throw new Error('the match did not end');
    expect(step(s)).toBeNull();
  }
}

/** The same orders, given to both; their events must match. */
function both(a: GameState, b: GameState, order: Action): void {
  expect(apply(a, order)).toEqual(apply(b, order));
}

describe('保存与读取', () => {
  it('整份状态是纯数据：存成 JSON 再读回来一字不差', () => {
    const s = newGame(['human', 'ai', 'ai'], 17, 25, { size: 25 });
    rich(toTurn(s, 0));
    apply(s, { type: 'HARVEST', resource: 'ore' });
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    apply(s, { type: 'PRODUCE', unit: 'truck' });
    expect(thaw(s)).toEqual(s);
  });

  it.each([2, 3, 4])('%i 名电脑玩家：对局中任意一步存档，读档后打完的结局与不中断时完全一致', (seats) => {
    const s = newGame(Array(seats).fill('ai') as ('human' | 'ai')[], [3, 11, 29][seats - 2]);
    let taken = 0;
    // Dice, the alien's go, half-way through a computer player's turn, later rounds.
    for (const at of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]) {
      while (taken < at && s.phase !== 'gameover') {
        expect(step(s)).toBeNull();
        taken++;
      }
      if (s.phase === 'gameover') break;
      const saved = thaw(s);
      const kept = structuredClone(s);
      playOut(saved);
      playOut(kept);
      expect(JSON.stringify(saved)).toBe(JSON.stringify(kept));
    }
  });

  it('人类下到一半的回合也能原样接着下', () => {
    const s = newGame(['human', 'ai', 'ai'], 42);
    const me = toTurn(s, 0);
    rich(me);
    // Whatever the dice said, there is enough for two harvests.
    me.ap = 3;
    apply(s, { type: 'HARVEST', resource: 'meat' });
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    const copy = thaw(s);
    // The rest of the turn goes the same way in both.
    for (const order of [
      { type: 'BUILD', key: 'barracks' },
      { type: 'PRODUCE', unit: 'infantry' },
      { type: 'PRODUCE', unit: 'infantry' },
      { type: 'HARVEST', resource: 'ore' },
    ] as Action[]) {
      both(copy, s, order);
    }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
    // From here the computer finishes both.
    for (const g of [s, copy]) for (const p of g.players) p.kind = 'ai';
    playOut(s);
    playOut(copy);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
    expect(s.phase).toBe('gameover');
  });

  it('外星人出现之后的存档同样可以接续', () => {
    const s = newGame(['ai', 'ai'], 8);
    for (let i = 0; i < 600 && !s.aliens.length; i++) expect(step(s)).toBeNull();
    expect(s.aliens.length).toBeGreaterThan(0);
    const saved = thaw(s);
    const kept = structuredClone(s);
    playOut(saved);
    playOut(kept);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(kept));
  });
});

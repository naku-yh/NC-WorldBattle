import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { rollDice } from '../engine';
import type { DiceEntry } from '../types';

/** A die that always lands on the scripted values, in order. */
function scripted(values: number[]): Rng {
  let i = 0;
  return { int: () => values[i++] } as unknown as Rng;
}

const apOf = (dice: DiceEntry[], player: number): number => dice.find((d) => d.player === player)!.ap;

describe('掷骰子分配行动点', () => {
  it('两人对局：点数最大 +3，点数最小 +1，大点数先行动', () => {
    const dice = rollDice(scripted([2, 5]), [0, 1]);
    expect(apOf(dice, 1)).toBe(3);
    expect(apOf(dice, 0)).toBe(1);
    expect(dice.map((d) => d.player)).toEqual([1, 0]);
  });

  it('三人：中间点数没有行动点', () => {
    const three = rollDice(scripted([4, 6, 2]), [0, 1, 2]);
    expect([0, 1, 2].map((id) => apOf(three, id))).toEqual([0, 3, 1]);
  });

  it('四人：第一 +3、第二 +2、第三 +1、第四没有；第二、三名并列时加掷', () => {
    const four = rollDice(scripted([4, 6, 5, 2]), [0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((id) => apOf(four, id))).toEqual([1, 3, 2, 0]);
    expect(four.map((d) => d.player)).toEqual([1, 2, 0, 3]);

    // 6, 4, 4, 2: players 1 and 2 are level for second place and throw again, 3 against 5.
    const tied = rollDice(scripted([6, 4, 4, 2, 3, 5]), [0, 1, 2, 3]);
    expect(tied.map((d) => d.player)).toEqual([0, 2, 1, 3]);
    expect([0, 1, 2, 3].map((id) => apOf(tied, id))).toEqual([3, 1, 2, 0]);
    expect(tied.find((d) => d.player === 1)!.rolls).toEqual([4, 3]);
    expect(tied.find((d) => d.player === 2)!.rolls).toEqual([4, 5]);
  });

  it('最大点数并列时只让并列者加掷', () => {
    // Both roll 4, then the re-roll gives player 0 a 2 and player 1 a 6.
    const dice = rollDice(scripted([4, 4, 2, 6]), [0, 1]);
    expect(apOf(dice, 1)).toBe(3);
    expect(apOf(dice, 0)).toBe(1);
    expect(dice.find((d) => d.player === 0)!.rolls).toEqual([4, 2]);
    expect(dice.find((d) => d.player === 1)!.rolls).toEqual([4, 6]);
  });

  it('最小点数并列时只让并列者加掷', () => {
    // 5, 2, 2 then players 1 and 2 re-roll 1 and 3.
    const dice = rollDice(scripted([5, 2, 2, 1, 3]), [0, 1, 2]);
    expect([0, 1, 2].map((id) => apOf(dice, id))).toEqual([3, 1, 0]);
  });

  it('全部同点时分别决出第一和最后一名', () => {
    // 3,3,3 -> re-roll 1,5,2 (player 1 leads) -> players 0 and 2 re-roll 6,4.
    const dice = rollDice(scripted([3, 3, 3, 1, 5, 2, 6, 4]), [0, 1, 2]);
    expect([0, 1, 2].map((id) => apOf(dice, id))).toEqual([0, 3, 1]);
  });

  it('任何情况下行动点的总和都固定：两三人 +3 与 +1，四人 +3、+2、+1、+0', () => {
    for (const n of [2, 3, 4]) {
      for (let seed = 1; seed <= 500; seed++) {
        const ids = Array.from({ length: n }, (_, i) => i);
        const dice = rollDice(new Rng(seed * 7919 + n), ids);
        const aps = ids.map((id) => apOf(dice, id)).sort((a, b) => a - b);
        expect(aps).toEqual(n === 4 ? [0, 1, 2, 3] : [...Array(n - 2).fill(0), 1, 3]);
        // Everyone rolled at least once and re-rolls are recorded in order.
        for (const d of dice) {
          expect(d.rolls.length).toBeGreaterThanOrEqual(1);
          for (const r of d.rolls) expect(r).toBeGreaterThanOrEqual(1);
          for (const r of d.rolls) expect(r).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('加掷确实会发生（随机样本里存在并列）', () => {
    let ties = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const dice = rollDice(new Rng(seed), [0, 1, 2, 3]);
      if (dice.some((d) => d.rolls.length > 1)) ties++;
    }
    expect(ties).toBeGreaterThan(100);
  });
});

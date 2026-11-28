import { describe, expect, it } from 'vitest';
import { RANKS, UNITS } from '../data';
import { baseStats, countBuilding, createGame, rankOf } from '../engine';
import { raiseTroops } from '../ai';
import { newGame, spawn, toTurn } from './helpers';
import { step } from './helpers';
import type { Action, Difficulty, GameState, UnitKey } from '../types';

interface Played {
  s: GameState;
  /** Every aircraft any computer player ordered, with the round it was ordered in. */
  planes: Array<{ turn: number; unit: UnitKey }>;
  /** Every order a computer player gave to raise a unit in rank, with the round. */
  raised: Array<{ turn: number; unitId: number }>;
  /** Whether each player ever stood a war factory up, whatever has since become of it. */
  factories: boolean[];
}

/** Everyone seated by computer, on bare grass, played to the end of round `rounds`. */
function played(seats: number, seed: number, rounds: number, difficulty: Difficulty): Played {
  const s = createGame({ seats: Array(seats).fill('ai') as ('human' | 'ai')[], seed, totalTurns: 20, difficulty, terrain: 'plain' });
  const out: Played = { s, planes: [], raised: [], factories: s.players.map(() => false) };
  const watch = (a: Action): void => {
    if (a.type === 'PRODUCE' && UNITS[a.unit].unitClass === 'air') out.planes.push({ turn: s.turn, unit: a.unit });
    if (a.type === 'PROMOTE') out.raised.push({ turn: s.turn, unitId: a.unitId });
  };
  const built = (): void => s.players.forEach((p, i) => (out.factories[i] ||= countBuilding(p, 'warFactory') > 0));
  built();
  for (let guard = 0; s.turn <= rounds && s.phase !== 'gameover' && guard < 200000; guard++) {
    expect(step(s, watch)).toBeNull();
    built();
  }
  return out;
}

const SEEDS = [3, 5, 7, 11, 13, 29];

describe('电脑玩家的难度', () => {
  it('低难度：13 回合之后才建军工厂，从不建机场、从不造飞机，也从不给单位升级', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const early = played(2, seed, 12, 'low');
      for (const p of early.s.players) {
        expect(countBuilding(p, 'warFactory')).toBe(0);
        expect(countBuilding(p, 'airport')).toBe(0);
      }
      expect(early.planes).toEqual([]);
      expect(early.raised).toEqual([]);
      const late = played(2, seed, 20, 'low');
      expect(late.factories.some(Boolean)).toBe(true);
      for (const p of late.s.players) expect(countBuilding(p, 'airport')).toBe(0);
      expect(late.planes).toEqual([]);
      expect(late.raised).toEqual([]);
      for (const p of late.s.players) for (const u of p.units) expect(rankOf(u)).toBe(1);
    }
  });

  it('高难度：早得多的军工厂（9 回合内），之后建机场、造飞机', () => {
    let airfields = 0;
    let flying = 0;
    for (const seed of SEEDS) {
      const early = played(2, seed, 9, 'high');
      expect(early.factories.some(Boolean)).toBe(true);
      expect(early.planes).toEqual([]);
      const late = played(2, seed, 20, 'high');
      // Both of them stand one up; whether it is still standing at the end is another matter, on a high game that can end with a base in ruins.
      expect(late.factories).toEqual([true, true]);
      if (late.s.players.some((p) => countBuilding(p, 'airport') > 0)) airfields++;
      if (late.planes.length) flying++;
      // The airfield comes first, then its aircraft: a fighter to open with, and later a bomber.
      // What the planes then run into is another matter, so it is the orders that are counted, not what is left flying.
      expect(late.planes.every((x) => x.turn > 9)).toBe(true);
      if (late.planes.length) expect(late.planes[0].unit).toBe('fighter');
    }
    // Most games, from six seeds: whether a game gets that far depends on what the aliens and the other computer do to it.
    expect(airfields).toBeGreaterThanOrEqual(4);
    expect(flying).toBeGreaterThanOrEqual(3);
  });

  it('高难度：打完 20 回合，电脑一定给单位升过级；升过的单位数值确实变强', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const late = played(2, seed, 20, 'high');
      expect(late.raised.length, `seed ${seed}`).toBeGreaterThan(0);
      // Every such order was the computer's own unit on the computer's own turn.
      const raised = late.s.players.flatMap((p) => p.units.filter((u) => rankOf(u) > 1));
      expect(raised.length).toBeGreaterThan(0);
      for (const u of raised) {
        expect(rankOf(u)).toBeLessThanOrEqual(RANKS.length);
        expect(baseStats(u.key, rankOf(u)).defense).toBe(baseStats(u.key, 1).defense + RANKS[rankOf(u) - 1].armor);
        expect(baseStats(u.key, rankOf(u)).attack).toBeGreaterThan(baseStats(u.key, 1).attack);
      }
    }
  });
});

describe('电脑挑哪个单位升级', () => {
  const rich = (ore: number, oil = 99999, meat = 99999): GameState => {
    const s = newGame(['human', 'ai']);
    toTurn(s, 1);
    s.players[1].resources = { ore, oil, meat };
    return s;
  };

  it('先升打得最疼的那种；已是最高的不升', () => {
    const s = rich(99999);
    const p = s.players[1];
    const tank = spawn(s, 1, 'tank', 10, 10);
    const missile = spawn(s, 1, 'missileTank', 10, 11);
    const foot = spawn(s, 1, 'infantry', 10, 12);
    const top = spawn(s, 1, 'apocalypse', 10, 13);
    top.rank = RANKS.length;
    expect(raiseTroops(p, {})).toEqual({ type: 'PROMOTE', unitId: missile.id });
    missile.rank = 2;
    // The tank's first step comes before the missile tank's second: both are within reach, and the first steps cost less.
    expect(raiseTroops(p, {})).toEqual({ type: 'PROMOTE', unitId: tank.id });
    expect(raiseTroops(p, { ore: 99999 })).toBeNull();
    p.units = [foot, top];
    expect(raiseTroops(p, {})).toEqual({ type: 'PROMOTE', unitId: foot.id });
    p.units = [top];
    expect(raiseTroops(p, {})).toBeNull();
  });

  it('钱要留着余地才升：第一次得有造价的 1.5 倍，第二次 2 倍，还得扣掉要攒着盖楼的那部分', () => {
    // A tank's step costs 200 ore and 150 oil.
    const tight = rich(299, 224);
    spawn(tight, 1, 'tank', 10, 10);
    expect(raiseTroops(tight.players[1], {})).toBeNull();
    const just = rich(300, 225);
    const tank = spawn(just, 1, 'tank', 10, 10);
    expect(raiseTroops(just.players[1], {})).toEqual({ type: 'PROMOTE', unitId: tank.id });
    expect(raiseTroops(just.players[1], { ore: 1 })).toBeNull();
    // The second step costs 300 and 225, and waits for twice that.
    tank.rank = 2;
    expect(raiseTroops(just.players[1], {})).toBeNull();
    const deep = rich(600, 450);
    const sergeant = spawn(deep, 1, 'tank', 10, 10);
    sergeant.rank = 2;
    expect(raiseTroops(deep.players[1], {})).toEqual({ type: 'PROMOTE', unitId: sergeant.id });
    expect(raiseTroops(deep.players[1], { oil: 1 })).toBeNull();
  });

});

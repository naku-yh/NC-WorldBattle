import { describe, expect, it } from 'vitest';
import { PROMOTE_COST, RANKS } from '../data';
import { attackPower, baseStats, canPromote, canStillAct, maxHpOf, promoteCost, rankOf, rankStats, statsOf } from '../engine';
import { apply, newGame, setTerrain, spawn as spawnOf, toTurn, tryApply } from './helpers';
import type { GameState, Unit } from '../types';

/** A match where player 0 acts first in the opening round, with all the money in the world. */
function richGame(seed = 1): GameState {
  for (let k = seed; k < seed + 60; k++) {
    const s = newGame(['human', 'human'], k);
    toTurn(s, 0);
    if (s.order[0] === 0) {
      s.players[0].resources = { ore: 99999, oil: 99999, meat: 99999 };
      return s;
    }
  }
  throw new Error('no seed where player 0 goes first');
}

const put = (s: GameState, key: Unit['key'], rank = 1): Unit => {
  const u: Unit = { id: s.nextId++, key, owner: 0, x: 10, y: 10, hp: 0, moveUsed: false, attackUsed: false, ...(rank > 1 ? { rank } : {}) };
  u.hp = maxHpOf(u);
  s.players[0].units.push(u);
  return u;
};

describe('军衔的数值', () => {
  it('三级：下士、中士、上士；新单位都是下士', () => {
    expect(RANKS.map((r) => r.name)).toEqual(['下士', '中士', '上士']);
    expect(rankOf({})).toBe(1);
    expect(rankOf({ rank: 3 })).toBe(3);
  });

  it('中士的攻击、生命是下士的 1.5 倍，上士是 2 倍；防御中士 +4、上士 +10；带小数的四舍五入', () => {
    // 坦克：8 / 15 / 3
    expect(rankStats('tank', 1)).toEqual({ attack: 8, hp: 15, defense: 3 });
    expect(rankStats('tank', 2)).toEqual({ attack: 12, hp: 23, defense: 7 });
    expect(rankStats('tank', 3)).toEqual({ attack: 16, hp: 30, defense: 13 });
    // 步兵的 3：一半是 4.5，进成 5
    expect(rankStats('infantry', 2)).toMatchObject({ attack: 5, hp: 9, defense: 5 });
    expect(rankStats('infantry', 3)).toMatchObject({ attack: 6, hp: 12, defense: 11 });
  });

  it('每一炮分别放大再取整，所以多炮单位的合计偶尔比 1.5 倍多 1 点；对空的攻击力同样放大', () => {
    // 天启：每炮 9 → 14 → 18，两炮合计 18 → 28 → 36；对空每炮 4 → 6 → 8
    expect(rankStats('apocalypse', 1)).toEqual({ attack: 9, airAttack: 4, hp: 40, defense: 5 });
    expect(rankStats('apocalypse', 2)).toEqual({ attack: 14, airAttack: 6, hp: 60, defense: 9 });
    expect(rankStats('apocalypse', 3)).toEqual({ attack: 18, airAttack: 8, hp: 80, defense: 15 });
    expect(rankStats('aaTank', 2)).toEqual({ attack: 8, airAttack: 15, hp: 24, defense: 7 });
  });

  it('地形的加减照旧叠在军衔的数值上', () => {
    const s = newGame();
    setTerrain(s, 10, 10, 'plain');
    const sergeant = put(s, 'tank', 2);
    // 平原上的坦克：攻 +2、防 −2
    expect(statsOf(s, sergeant)).toMatchObject({ attack: 14, defense: 5 });
    expect(baseStats('tank', 2)).toMatchObject({ attack: 12, defense: 7 });
  });

  it('克制照样先翻倍再扣防御：中士狙击手打步兵 8 × 2 − 1', () => {
    const s = newGame();
    const sniper = put(s, 'sniper', 2);
    expect(statsOf(s, sniper).attack).toBe(8);
    expect(statsOf(s, sniper).doubleVs).toEqual(['soldier']);
  });

  it('攻击力（排名用的那个）按军衔算', () => {
    const s = newGame();
    expect(attackPower(s.players[0])).toBe(0);
    put(s, 'tank', 3);
    put(s, 'tank', 1);
    // 16 + 8
    expect(attackPower(s.players[0])).toBe(24);
  });
});

describe('晋升', () => {
  it('花该单位造价的 100% 升中士、150% 升上士；军人要的肉也按比例算', () => {
    expect(PROMOTE_COST).toEqual([1, 1.5]);
    expect(promoteCost('tank', 1)).toEqual({ ore: 200, oil: 150 });
    expect(promoteCost('tank', 2)).toEqual({ ore: 300, oil: 225 });
    expect(promoteCost('infantry', 1)).toEqual({ ore: 100, meat: 100 });
    expect(promoteCost('infantry', 2)).toEqual({ ore: 150, meat: 150 });
    expect(promoteCost('mech', 2)).toEqual({ ore: 3450, oil: 1650, meat: 450 });
  });

  it('只能在自己的回合、给自己的单位、没到顶且付得起的时候升', () => {
    const s = richGame();
    const tank = put(s, 'tank', 3);
    expect(canPromote(s.players[0], tank.id)).toBe('已是最高军衔');
    expect(canPromote(s.players[0], 9999)).toBe('找不到该单位');
    const poor = put(s, 'tank');
    s.players[0].resources = { ore: 199, oil: 999, meat: 999 };
    expect(canPromote(s.players[0], poor.id)).toBe('资源不足');
    expect(canPromote(s.players[1], poor.id)).toBe('找不到该单位');
    s.players[0].resources = { ore: 200, oil: 150, meat: 0 };
    expect(canPromote(s.players[0], poor.id)).toBeNull();
    expect(tryApply(s, { type: 'PROMOTE', unitId: tank.id })).toBe('已是最高军衔');
    // Not their turn: the other player's, or the aliens' go.
    expect(tryApply(s, { type: 'PROMOTE', unitId: poor.id })).toBeNull();
    toTurn(s, 1);
    expect(tryApply(s, { type: 'PROMOTE', unitId: poor.id })).toBe('找不到该单位');
  });

  it('晋升后生命补满；不动它本回合的移动和攻击', () => {
    const s = richGame();
    const tank = put(s, 'tank');
    tank.hp = 9;
    tank.moveUsed = true;
    const events = apply(s, { type: 'PROMOTE', unitId: tank.id });
    expect(tank).toMatchObject({ rank: 2, hp: 23, moveUsed: true, attackUsed: false });
    expect(events).toEqual([{ type: 'promote', player: 0, unitId: tank.id, rank: 2 }]);
    expect(maxHpOf(tank)).toBe(23);
    expect(canStillAct(tank)).toBe(true);
    tank.hp = 4;
    const more = apply(s, { type: 'PROMOTE', unitId: tank.id });
    expect(tank).toMatchObject({ rank: 3, hp: 30 });
    expect(more).toEqual([{ type: 'promote', player: 0, unitId: tank.id, rank: 3 }]);
    expect(s.log.at(-1)?.text).toBe('玩家1 的坦克晋升为上士');
  });

  it('钱是照价扣的，付不起就被拒绝', () => {
    const s = richGame();
    const ops = put(s, 'specOps');
    s.players[0].resources = { ore: 600, oil: 300, meat: 199 };
    expect(tryApply(s, { type: 'PROMOTE', unitId: ops.id })).toBe('资源不足');
    s.players[0].resources.meat = 200;
    expect(tryApply(s, { type: 'PROMOTE', unitId: ops.id })).toBeNull();
    expect(s.players[0].resources).toEqual({ ore: 0, oil: 0, meat: 0 });
    expect(tryApply(s, { type: 'PROMOTE', unitId: ops.id })).toBe('资源不足');
  });

  it('电脑玩家照常打得到晋升过的单位：它估的伤害按对方的军衔算', () => {
    const s = richGame();
    const sergeant = put(s, 'tank', 2);
    // What an infantryman's 3 does to a sergeant tank on grass (armour 7 − 2 = 5): nothing, and the rules agree.
    toTurn(s, 1);
    const foot = spawnOf(s, 1, 'infantry', 10, 11);
    apply(s, { type: 'ATTACK', source: { kind: 'unit', id: foot.id }, target: { kind: 'unit', id: sergeant.id } });
    expect(sergeant.hp).toBe(23);
  });
});

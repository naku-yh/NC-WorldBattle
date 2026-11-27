import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, HQ_SIZE, MIN_TURNS } from '../data';
import { zoneTiles } from '../board';
import { attackPower, hqOf } from '../engine';
import { apply, newGame, nextTurn, playGame, rich, spawn, toTurn, tryApply } from './helpers';
import type { GameState } from '../types';

describe('地图与座位', () => {
  it('正方形地图，每名玩家占一个角', () => {
    const s = newGame(['human', 'human', 'human', 'human']);
    expect(s.boardSize).toBe(BOARD_SIZE);
    const far = BOARD_SIZE - HQ_SIZE;
    const anchors = s.players.map((p) => { const hq = hqOf(p)!; return `${hq.x},${hq.y}`; }).sort();
    expect(anchors).toEqual(['0,0', `0,${far}`, `${far},0`, `${far},${far}`].sort());
  });

  it('两名玩家时坐在对角', () => {
    const s = newGame(['human', 'human']);
    const [a, b] = s.players.map((p) => hqOf(p)!);
    const far = BOARD_SIZE - HQ_SIZE;
    const corners = [a, b].map((h) => `${h.x},${h.y}`).sort();
    expect(corners).toEqual(['0,0', `${far},${far}`].sort());
  });

  it('三名玩家时坐三个角，互不重叠', () => {
    const s = newGame(['human', 'human', 'human']);
    const zones = s.players.map((p) => new Set(zoneTiles(p.corner).map((t) => `${t.x},${t.y}`)));
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const overlap = [...zones[i]].some((t) => zones[j].has(t));
        expect(overlap).toBe(false);
      }
    }
  });

  it('每名玩家都有矿山、油田、牧场各一处', () => {
    const s = newGame(['human', 'human', 'human']);
    for (const p of s.players) {
      const kinds = s.nodes.filter((n) => n.corner === p.corner).map((n) => n.resource).sort();
      expect(kinds).toEqual(['meat', 'oil', 'ore']);
    }
  });
});

describe('回合流程', () => {
  it('掷骰 → 按点数高到低依次行动 → 进入下一回合', () => {
    const s = newGame();
    expect(s.phase).toBe('roundStart');
    apply(s, { type: 'ROLL_DICE' });
    expect(s.phase).toBe('dice');
    apply(s, { type: 'NEXT' });
    expect(s.phase).toBe('player');
    expect(s.currentPlayer).toBe(s.order[0]);
    const first = s.currentPlayer;
    apply(s, { type: 'END_TURN' });
    expect(s.currentPlayer).toBe(s.order[1]);
    expect(s.currentPlayer).not.toBe(first);
    apply(s, { type: 'END_TURN' });
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('roundStart');
    apply(s, { type: 'ROLL_DICE' });
    while (s.phase !== 'player') apply(s, { type: 'NEXT' });
    expect(s.currentPlayer).toBe(s.order[0]);
    // Dice order puts the biggest roll first.
    const aps = s.order.map((id) => s.players[id].ap);
    expect(aps).toEqual(aps.slice().sort((a, b) => b - a));
  });

  it('不在自己回合时不能下令', () => {
    const s = newGame();
    expect(tryApply(s, { type: 'BUILD', key: 'powerPlant' })).toBe('现在不能建造');
    expect(tryApply(s, { type: 'END_TURN' })).toBe('现在不能结束回合');
    apply(s, { type: 'ROLL_DICE' });
    expect(tryApply(s, { type: 'HARVEST', resource: 'ore' })).toBe('现在不能采集');
    expect(tryApply(s, { type: 'ROLL_DICE' })).toBe('现在不能掷骰子');
  });

  it('每名玩家回合开始时刷新移动和攻击次数', () => {
    const s = newGame();
    const p = toTurn(s);
    const u = spawn(s, p.id, 'tank', 9, 9);
    u.moveUsed = true;
    u.attackUsed = true;
    nextTurn(s, p.id);
    expect(s.turn).toBe(2);
    expect(u.moveUsed).toBe(false);
    expect(u.attackUsed).toBe(false);
  });
});

describe('外星人的出现时机', () => {
  it('第一个外星人在第 5–8 回合之间随机到来', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 120; seed++) {
      const t = newGame(['human', 'human'], seed).nextAlien;
      expect(t).toBeGreaterThanOrEqual(5);
      expect(t).toBeLessThanOrEqual(8);
      seen.add(t);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 6, 7, 8]);
  });

  it('在那一回合掷完骰子后降临战场中央的空地，随即行动一次，之后每回合行动一次', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = newGame(['human', 'human'], seed);
      const at = s.nextAlien;
      while (s.turn < at) {
        apply(s, { type: 'ROLL_DICE' });
        while (s.phase !== 'player') apply(s, { type: 'NEXT' });
        apply(s, { type: 'END_TURN' });
        apply(s, { type: 'END_TURN' });
      }
      expect(s.aliens).toHaveLength(0);
      apply(s, { type: 'ROLL_DICE' });
      expect(s.aliens).toHaveLength(1);
      const mid = BOARD_SIZE / 2;
      for (const v of [s.aliens[0].x, s.aliens[0].y]) {
        expect(v).toBeGreaterThanOrEqual(mid - 2);
        expect(v).toBeLessThanOrEqual(mid + 2);
      }
      apply(s, { type: 'NEXT' });
      expect(s.phase).toBe('aliens'); // they act right after the dice, every round
      expect(tryApply(s, { type: 'ROLL_DICE' })).toBe('现在不能掷骰子');
    }
  });
});

describe('胜负判定', () => {
  /** Brings the game to the last order slot of the final round. */
  function toLastTurn(s: GameState): void {
    toTurn(s);
    s.turn = s.totalTurns;
    while (s.phase === 'player' && s.orderIndex < s.order.length - 1) apply(s, { type: 'END_TURN' });
  }

  it('总回合数最少为 20', () => {
    expect(newGame(['human', 'human'], 1, 5).totalTurns).toBe(MIN_TURNS);
    expect(newGame(['human', 'human'], 1, 30).totalTurns).toBe(30);
  });

  it('打满总回合数后结束；积分相同时生命值高者获胜', () => {
    const s = newGame();
    toLastTurn(s);
    hqOf(s.players[0])!.hp = 17;
    hqOf(s.players[1])!.hp = 12;
    apply(s, { type: 'END_TURN' });
    expect(s.phase).toBe('gameover');
    expect(s.gameOverReason).toBe('turns');
    expect(s.ranking.map((r) => r.player)).toEqual([0, 1]);
    expect(s.ranking.map((r) => r.baseHp)).toEqual([17, 12]);
    expect(tryApply(s, { type: 'END_TURN' })).toBe('现在不能结束回合');
  });

  it('生命值相同则攻击力最高者获胜', () => {
    const s = newGame();
    toLastTurn(s);
    spawn(s, 1, 'tank', 10, 10);
    expect(attackPower(s.players[0])).toBe(0);
    expect(attackPower(s.players[1])).toBe(8);
    apply(s, { type: 'END_TURN' });
    expect(s.ranking.map((r) => r.player)).toEqual([1, 0]);

    const t = newGame();
    toLastTurn(t);
    spawn(t, 1, 'apocalypse', 10, 10);
    hqOf(t.players[1])!.hp = 19;
    apply(t, { type: 'END_TURN' });
    expect(t.ranking.map((r) => r.player)).toEqual([0, 1]); // any HP lead beats any army
  });

  it('积分最高者获胜，哪怕基地生命值更低', () => {
    const s = newGame();
    toLastTurn(s);
    hqOf(s.players[0])!.hp = 3;
    hqOf(s.players[1])!.hp = 20;
    s.players[0].score = 500;
    s.players[1].score = 200;
    apply(s, { type: 'END_TURN' });
    expect(s.ranking.map((r) => r.player)).toEqual([0, 1]);
    expect(s.ranking.map((r) => r.score)).toEqual([500, 200]);
  });

  it('攻击力 = 存活战斗单位 + 通电防御建筑的攻击力之和', () => {
    const s = newGame();
    const p = toTurn(s);
    spawn(s, 0, 'infantry', 9, 9);
    spawn(s, 0, 'sniper', 9, 10);
    spawn(s, 0, 'apocalypse', 9, 11);
    expect(attackPower(p)).toBe(3 + 5 + 18);
    rich(p);
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    apply(s, { type: 'BUILD', key: 'turret' });
    expect(attackPower(p)).toBe(26 + 8);
    apply(s, { type: 'BUILD', key: 'defenseNet' });
    apply(s, { type: 'BUILD', key: 'barracks' });
    apply(s, { type: 'BUILD', key: 'aaGun' }); // fourth powered building: no socket left
    expect(attackPower(p)).toBe(26 + 8);
  });
});

describe('电脑玩家打完整局', () => {
  const cases: Array<[number, ('human' | 'ai')[]]> = [
    [2, ['ai', 'ai']],
    [3, ['ai', 'ai', 'ai']],
    [4, ['ai', 'ai', 'ai', 'ai']],
  ];

  for (const [n, seats] of cases) {
    it(`${n} 名电脑玩家：对局正常结束，AI 的指令全部合法`, () => {
      const { s, rejects, steps } = playGame(seats, 42 + n);
      expect(rejects).toEqual([]);
      expect(s.phase).toBe('gameover');
      expect(s.ranking).toHaveLength(n);
      expect(steps).toBeLessThan(400000);
      for (const p of s.players) {
        expect(p.resources.ore).toBeGreaterThanOrEqual(0);
        expect(p.resources.oil).toBeGreaterThanOrEqual(0);
        expect(p.resources.meat).toBeGreaterThanOrEqual(0);
        for (const u of p.units) expect(u.hp).toBeGreaterThan(0);
      }
      console.log(
        `[sim ${n}P] ended on turn ${s.turn} (${s.gameOverReason}): ` +
          s.ranking.map((r) => `P${r.player} score=${r.score} hp=${r.baseHp} atk=${r.attack} units=${r.units}`).join(' | '),
      );
    });
  }

  it('多个随机种子下都能结束，外星人每局都会出现', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { s, rejects } = playGame(['ai', 'ai', 'ai', 'ai'], seed);
      expect(rejects).toEqual([]);
      expect(s.phase).toBe('gameover');
      expect(s.aliensSeen).toBeGreaterThan(0);
    }
  });
});

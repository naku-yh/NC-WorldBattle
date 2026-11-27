import { describe, expect, it } from 'vitest';
import { attackTargets, moveRange, netDefense, netDamage } from '../engine';
import { BoardIndex, cheb, inBoard, key } from '../board';
import { apply, build, dropAlien, newGame, nextTurn, pathOf, placeBuilding, rich, spawn, toTurn, tryApply } from './helpers';
import type { EntityRef, GameState, Unit } from '../types';

const unit = (id: number): { kind: 'unit'; id: number } => ({ kind: 'unit', id });
const building = (id: number): { kind: 'building'; id: number } => ({ kind: 'building', id });

function atk(s: GameState, u: Unit, target: EntityRef) {
  return apply(s, { type: 'ATTACK', source: unit(u.id), target });
}

describe('伤害公式', () => {
  it('伤害 = 攻击力 − 防御值（规则示例：13 − 2 = 11）', () => {
    expect(netDamage(13, 2)).toBe(11);
    expect(netDamage(13, 0)).toBe(13);
    expect(netDamage(3, 3)).toBe(0);
    expect(netDamage(3, 9)).toBe(0);
  });

  it('破甲武器无视防御值', () => {
    expect(netDamage(6, 3, true)).toBe(6);
    const s = newGame();
    toTurn(s);
    const laser = spawn(s, 0, 'laserTank', 9, 9);
    const beast = spawn(s, 1, 'apocalypse', 9, 10);
    atk(s, laser, unit(beast.id));
    expect(beast.hp).toBe(40 - (7 + 2)); // a tank in the open, armour notwithstanding
  });

  it('多管武器每发单独计算', () => {
    const s = newGame();
    toTurn(s);
    const twin = spawn(s, 0, 'twinTank', 9, 9);
    const tank = spawn(s, 1, 'tank', 9, 10);
    atk(s, twin, unit(tank.id));
    // Two shells of (5 + 2) against (3 − 2) armour: tanks in the open hit harder and are thinner.
    expect(tank.hp).toBe(16 - 2 * 6);
  });
});

describe('单位对战', () => {
  it('步兵打不动坦克，反坦克战士可以；每单位每回合只攻击一次', () => {
    const s = newGame();
    toTurn(s);
    const inf = spawn(s, 0, 'infantry', 8, 9);
    const at = spawn(s, 0, 'atSoldier', 9, 8);
    const tank = spawn(s, 1, 'tank', 9, 9);
    atk(s, inf, unit(tank.id));
    expect(tank.hp).toBe(16 - 2); // 3 − (3 − 2)
    atk(s, at, unit(tank.id));
    expect(tank.hp).toBe(16 - 2 - 6);
    expect(tryApply(s, { type: 'ATTACK', source: unit(at.id), target: unit(tank.id) })).toContain('已经攻击');
  });

  it('击毁单位后从场上移除，并计入击杀数', () => {
    const s = newGame();
    const p = toTurn(s);
    const tank = spawn(s, 0, 'tank', 9, 9);
    const inf = spawn(s, 1, 'infantry', 9, 10);
    const events = atk(s, tank, unit(inf.id));
    expect(s.players[1].units).toHaveLength(0);
    expect(p.kills).toBe(1);
    expect(p.damageDealt).toBe(10); // 8 + 2 for fighting in the open
    expect(events.some((e) => e.type === 'destroyed' && e.target.id === inf.id)).toBe(true);
  });

  it('狙击手射程 4，打不到 5 格外的目标', () => {
    const s = newGame();
    toTurn(s);
    const near = spawn(s, 0, 'sniper', 8, 8);
    const far = spawn(s, 0, 'sniper', 7, 8);
    const a = spawn(s, 1, 'infantry', 8, 12);
    const b = spawn(s, 1, 'infantry', 8, 13);
    atk(s, near, unit(a.id));
    expect(a.hp).toBe(1);
    expect(tryApply(s, { type: 'ATTACK', source: unit(far.id), target: unit(b.id) })).toBe('目标超出射程');
  });

  it('不能攻击自己的单位', () => {
    const s = newGame();
    toTurn(s);
    const a = spawn(s, 0, 'infantry', 8, 8);
    const b = spawn(s, 0, 'infantry', 8, 9);
    expect(tryApply(s, { type: 'ATTACK', source: unit(a.id), target: unit(b.id) })).toBe('不能攻击自己的目标');
  });
});

describe('空中单位', () => {
  it('普通单位打不到战斗机；防空坦克和防空炮可以；防空炮只打空中目标', () => {
    const s = newGame();
    toTurn(s);
    const inf = spawn(s, 0, 'infantry', 8, 8);
    const aaTank = spawn(s, 0, 'aaTank', 8, 9);
    const aaGun = placeBuilding(s, s.players[0], 'aaGun', 5, 5);
    const jetA = spawn(s, 1, 'fighter', 8, 7);
    const jetB = spawn(s, 1, 'fighter', 7, 7);
    const foot = spawn(s, 1, 'infantry', 7, 6);

    expect(attackTargets(s, unit(inf.id))).toEqual([]);
    expect(tryApply(s, { type: 'ATTACK', source: unit(inf.id), target: unit(jetA.id) })).toBe('只有防空武器能攻击空中单位');

    expect(attackTargets(s, unit(aaTank.id)).map((t) => t.id).sort()).toEqual([jetA.id, jetB.id, foot.id].sort());
    atk(s, aaTank, unit(jetA.id));
    expect(jetA.hp).toBe(12 - ((7 + 2) - 2));

    const fromGun = attackTargets(s, building(aaGun.id)).map((t) => t.id);
    expect(fromGun).toContain(jetB.id);
    expect(fromGun).not.toContain(foot.id);
    apply(s, { type: 'ATTACK', source: { kind: 'building', id: aaGun.id }, target: unit(jetB.id) });
    expect(jetB.hp).toBe(12 - (9 - 2));
    expect(tryApply(s, { type: 'ATTACK', source: { kind: 'building', id: aaGun.id }, target: unit(jetA.id) })).toContain('已经开火');

    aaGun.powered = false;
    expect(attackTargets(s, building(aaGun.id))).toEqual([]);
  });

  it('战斗机可以攻击地面单位和建筑', () => {
    const s = newGame();
    toTurn(s, 1);
    const jet = spawn(s, 1, 'fighter', 17, 17);
    const foot = spawn(s, 0, 'infantry', 17, 16);
    atk(s, jet, unit(foot.id));
    expect(s.players[0].units).toHaveLength(0);

    toTurn(s, 1);
    const raider = spawn(s, 1, 'fighter', 3, 3); // over player 0's base
    const hq = s.players[0].buildings[0];
    atk(s, raider, building(hq.id));
    expect(hq.hp).toBe(20 - 11);
  });
});

describe('移动', () => {
  it('坦克一回合走 4 格，走完不能再走', () => {
    const s = newGame();
    toTurn(s);
    const tank = spawn(s, 0, 'tank', 9, 9);
    const range = moveRange(s, tank.id);
    expect(range).toContainEqual({ x: 9, y: 13 });
    expect(range).not.toContainEqual({ x: 9, y: 14 });
    expect(range).not.toContainEqual({ x: 2, y: 0 }); // the factory
    const path = pathOf(apply(s, { type: 'MOVE', unitId: tank.id, x: 9, y: 13 }));
    expect(path).toHaveLength(4);
    expect([tank.x, tank.y]).toEqual([9, 13]);
    expect(tryApply(s, { type: 'MOVE', unitId: tank.id, x: 9, y: 14 })).toContain('已经移动');
  });

  it('不能停在建筑或有单位的格子上，也不能贴着建筑抄斜角', () => {
    const s = newGame();
    toTurn(s);
    const slow = spawn(s, 0, 'tank', 8, 9);
    expect(tryApply(s, { type: 'MOVE', unitId: slow.id, x: 8, y: 14 })).toBe('无法到达该位置'); // 5 tiles away
    const other = spawn(s, 0, 'tank', 9, 9);
    expect(tryApply(s, { type: 'MOVE', unitId: other.id, x: 8, y: 9 })).toBe('无法到达该位置'); // occupied
    expect(tryApply(s, { type: 'MOVE', unitId: other.id, x: 2, y: 0 })).toBe('无法到达该位置'); // factory

    placeBuilding(s, s.players[0], 'powerPlant', 10, 9);
    const path = pathOf(apply(s, { type: 'MOVE', unitId: other.id, x: 11, y: 8 }));
    expect(path).toHaveLength(3);
    expect(path.some((p) => p.x === 10 && p.y === 9)).toBe(false);
    // A three-tile-wide wall cannot be slipped through diagonally.
    placeBuilding(s, s.players[0], 'powerPlant', 10, 8);
    placeBuilding(s, s.players[0], 'powerPlant', 10, 10);
    const walled = spawn(s, 0, 'tank', 9, 9);
    expect(tryApply(s, { type: 'MOVE', unitId: walled.id, x: 11, y: 9 })).toBe('无法到达该位置');
  });

  it('战斗机飞越基地，每回合 8 格', () => {
    const s = newGame();
    toTurn(s);
    const jet = spawn(s, 0, 'fighter', 2, 2);
    const path = pathOf(apply(s, { type: 'MOVE', unitId: jet.id, x: 5, y: 5 }));
    expect(path).toHaveLength(3);
    expect([jet.x, jet.y]).toEqual([5, 5]);
    toTurn(s, 0);
    const far = spawn(s, 0, 'fighter', 2, 2);
    expect(tryApply(s, { type: 'MOVE', unitId: far.id, x: 2, y: 11 })).toBe('无法到达该位置'); // 9 tiles
    apply(s, { type: 'MOVE', unitId: far.id, x: 2, y: 10 });
    expect([far.x, far.y]).toEqual([2, 10]);
  });
});

describe('基地防御', () => {
  function armedOpponent(seed = 1) {
    const s = newGame(['human', 'human'], seed);
    const foe = toTurn(s, 1);
    rich(foe);
    build(s, 'powerPlant');
    const turret = build(s, 'turret');
    toTurn(s, 0);
    return { s, foe, turret, factory: foe.buildings.find((b) => b.key === 'factory')! };
  }

  it('炮台放在正面：敌人攻击基地建筑时反击一次', () => {
    const { s, turret, factory } = armedOpponent();
    expect([turret.x, turret.y]).toEqual([14, 14]);
    const first = spawn(s, 0, 'infantry', 17, 18);
    const events = atk(s, first, building(factory.id));
    expect(factory.hp).toBe(27);
    expect(events.filter((e) => e.type === 'attack')).toHaveLength(2);
    expect(s.players[0].units).toHaveLength(0); // 8 damage kills the 6 HP infantry

    // Same enemy turn: the gun has already reacted.
    const second = spawn(s, 0, 'infantry', 16, 18);
    atk(s, second, building(factory.id));
    expect(factory.hp).toBe(24);
    expect(s.players[0].units).toHaveLength(1);
    expect(turret.reacted).toBe(true);

    // Next round it is ready again.
    nextTurn(s, 0);
    atk(s, second, building(factory.id));
    expect(s.players[0].units).toHaveLength(0);
  });

  it('炮台在自己的回合可以主动开火一次', () => {
    const { s, turret } = armedOpponent();
    toTurn(s, 1);
    const foot = spawn(s, 0, 'infantry', 15, 14); // 1 tile in front of the gun
    apply(s, { type: 'ATTACK', source: { kind: 'building', id: turret.id }, target: unit(foot.id) });
    expect(s.players[0].units).toHaveLength(0);
    const next = spawn(s, 0, 'infantry', 15, 14);
    expect(tryApply(s, { type: 'ATTACK', source: { kind: 'building', id: turret.id }, target: unit(next.id) })).toContain('已经开火');
  });

  it('打掉发电站后炮台断电，不再反击', () => {
    const { s, turret, foe } = armedOpponent();
    const plant = foe.buildings.find((b) => b.key === 'powerPlant')!;
    expect([plant.x, plant.y]).toEqual([16, 19]);
    plant.hp = 5;
    const missile = spawn(s, 0, 'missileTank', 16, 15); // range 5
    const events = atk(s, missile, building(plant.id));
    expect(foe.buildings.some((b) => b.key === 'powerPlant')).toBe(false);
    expect(turret.powered).toBe(false);
    expect(missile.hp).toBe(14);
    expect(events.filter((e) => e.type === 'attack')).toHaveLength(1);
  });

  it('防御网让每座基地建筑少受 2 点伤害', () => {
    const s = newGame();
    const foe = toTurn(s, 1);
    rich(foe);
    build(s, 'powerPlant');
    build(s, 'defenseNet');
    expect(netDefense(foe)).toBe(2);
    toTurn(s, 0);
    const tank = spawn(s, 0, 'tank', 17, 17);
    atk(s, tank, building(foe.buildings.find((b) => b.key === 'factory')!.id));
    expect(foe.buildings.find((b) => b.key === 'factory')!.hp).toBe(30 - ((8 + 2) - 2));
  });

  it('大型建筑按最近的一格算射程（查询与实际开火一致）', () => {
    const s = newGame();
    const foe = toTurn(s, 1);
    rich(foe);
    build(s, 'powerPlant');
    build(s, 'powerPlant');
    const yard = build(s, 'warFactory'); // 2x2
    expect([yard.w, yard.h]).toEqual([2, 2]);
    toTurn(s, 0);
    // Touching the yard's corner tile but 1.5 from its centre.
    const edge = { x: yard.x - 1, y: yard.y + yard.h - 1 };
    const foot = spawn(s, 0, 'infantry', edge.x, edge.y);
    expect(attackTargets(s, unit(foot.id)).map((t) => t.id)).toContain(yard.id);
    atk(s, foot, building(yard.id));
    expect(yard.hp).toBe(40 - 3);
  });

  it('摧毁军事基地即出局：其余单位建筑清空，最后存活者获胜', () => {
    const { s, foe } = armedOpponent();
    const hq = foe.buildings[0];
    hq.hp = 3;
    spawn(s, 1, 'infantry', 10, 10);
    const tank = spawn(s, 0, 'tank', 17, 17);
    const events = atk(s, tank, building(hq.id));
    expect(foe.alive).toBe(false);
    expect(foe.units).toHaveLength(0);
    expect(foe.buildings).toHaveLength(0);
    expect(events.some((e) => e.type === 'eliminated' && e.player === 1)).toBe(true);
    expect(s.phase).toBe('gameover');
    expect(s.gameOverReason).toBe('lastStanding');
    expect(s.ranking.map((r) => r.player)).toEqual([0, 1]);
  });
});

describe('外星人克洛伊', () => {
  /** Chloe dropped next to player 1's base with nothing else in reach. */
  function chloeAtBase(netLevel: 0 | 1 | 2) {
    const s = newGame(['human', 'human'], 1);
    const foe = s.players[1];
    const hq = foe.buildings[0];
    foe.buildings = [hq];
    if (netLevel) placeBuilding(s, foe, 'defenseNet', 18.5, 18.5, 0, 0).level = netLevel;
    dropAlien(s, 'chloe', 17, 16);
    apply(s, { type: 'ROLL_DICE' });
    const events = apply(s, { type: 'NEXT' });
    const hit = events.some((e) => e.type === 'attack' && e.target.kind === 'building' && e.target.id === hq.id);
    return { s, hq, hit };
  }

  it('规则示例：攻击力 13，防御网抵扣 2，基地 20 血掉到 9', () => {
    const { s, hq } = chloeAtBase(1);
    expect(hq.hp).toBe(20 - 11);
    // The net itself is a force field and can never be targeted.
    toTurn(s, 0);
    const net = s.players[1].buildings.find((b) => b.key === 'defenseNet')!;
    const tank = spawn(s, 0, 'tank', 17, 17);
    expect(attackTargets(s, unit(tank.id)).map((t) => t.id)).not.toContain(net.id);
    expect(tryApply(s, { type: 'ATTACK', source: unit(tank.id), target: building(net.id) })).toBe('目标不存在');
  });

  it('高级防御网抵扣 5 点；没有防御网则承受全部 13 点', () => {
    expect(chloeAtBase(2).hq.hp).toBe(20 - 8);
    expect(chloeAtBase(0).hq.hp).toBe(20 - 13);
  });

  it('射程 2，够得着就不挪步；始终停在空地上，并优先攻击单位', () => {
    let kills = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(['human', 'human'], seed);
      const chloe = dropAlien(s, 'chloe', 9, 9);
      const foot = spawn(s, 0, 'infantry', 10, 9);
      apply(s, { type: 'ROLL_DICE' });
      apply(s, { type: 'NEXT' });
      expect(s.phase).toBe('aliens');
      expect(inBoard(chloe.x, chloe.y, s.boardSize)).toBe(true);
      expect(cheb({ x: 9, y: 9 }, chloe)).toBeLessThanOrEqual(2);
      expect(new BoardIndex(s).blocked.has(key(chloe.x, chloe.y))).toBe(false);
      if (!s.players[0].units.some((u) => u.id === foot.id)) kills++;
    }
    expect(kills).toBeGreaterThan(20);
  });

  it('奖励按造成的伤害分配；积分也是，最后一击另有加分', () => {
    // Pick a round where player 0 acts first so the whole fight fits in one round.
    let s!: GameState;
    for (let seed = 1; seed < 50; seed++) {
      s = newGame(['human', 'human'], seed);
      toTurn(s, 0);
      if (s.order[0] === 0) break;
    }
    expect(s.order[0]).toBe(0);
    const chloe = dropAlien(s, 'chloe', 9, 9);
    const p0 = s.players[0];
    const p1 = s.players[1];
    const beast: EntityRef = { kind: 'alien', id: chloe.id };

    // Player 0: anti-tank 6 (armour-piercing) + sniper 1 = 7.
    atk(s, spawn(s, 0, 'atSoldier', 9, 10), beast);
    atk(s, spawn(s, 0, 'sniper', 8, 8), beast);
    expect(chloe.hp).toBe(90 - 7);

    // Player 1: laser tank 9 + tank 6 = 15 (both in the open), then the finishing tank shot.
    toTurn(s, 1);
    atk(s, spawn(s, 1, 'laserTank', 10, 10), beast);
    atk(s, spawn(s, 1, 'tank', 10, 9), beast);
    expect(chloe.hp).toBe(90 - 22);
    chloe.hp = 1;
    const ore0 = p0.resources.ore;
    const ore1 = p1.resources.ore;
    const events = atk(s, spawn(s, 1, 'tank', 9, 10), beast);
    expect(s.aliens).toHaveLength(0);
    // 7 / 28 and 21 / 28 of the bounty.
    expect(events).toContainEqual({
      type: 'alienKilled',
      id: chloe.id,
      key: 'chloe',
      rewards: { 0: { ore: 375, oil: 250, meat: 250 }, 1: { ore: 1125, oil: 750, meat: 750 } },
      // A quarter and three quarters of 400 points, and 100 more for the last blow.
      points: { 0: 100, 1: 400 },
    });
    expect(p0.resources.ore).toBe(ore0 + 375);
    expect(p1.resources.ore).toBe(ore1 + 1125);
    expect([p0.score, p1.score]).toEqual([100, 400]);
    expect(events.filter((e) => e.type === 'score')).toEqual([
      { type: 'score', player: 0, amount: 100 },
      { type: 'score', player: 1, amount: 400 },
    ]);
  });
});

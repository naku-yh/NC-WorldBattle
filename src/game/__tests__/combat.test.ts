import { describe, expect, it } from 'vitest';
import { UNITS } from '../data';
import { attackPower, attackTargets, canStillAct, moveRange, netDefense, netDamage, volley } from '../engine';
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
    expect(beast.hp).toBe(40 - (12 + 2)); // a tank in the open, armour notwithstanding
  });

  it('多管武器每发单独计算', () => {
    const s = newGame();
    toTurn(s);
    const twin = spawn(s, 0, 'twinTank', 9, 9);
    const tank = spawn(s, 1, 'tank', 9, 10);
    atk(s, twin, unit(tank.id));
    // Two shells of (5 + 2) against (3 − 2) armour: tanks in the open hit harder and are thinner.
    expect(tank.hp).toBe(15 - 2 * 6);
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
    expect(tank.hp).toBe(15 - 2); // 3 − (3 − 2)
    atk(s, at, unit(tank.id));
    expect(tank.hp).toBe(15 - 2 - 7); // 4, twice over against a tank, less armour of 3 − 2
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
    expect(p.damageDealt).toBe(9); // 8 + 2 for fighting in the open, less the soldier's 1
    expect(events.some((e) => e.type === 'destroyed' && e.target.id === inf.id)).toBe(true);
  });

  it('狙击手射程 6、对步兵双倍伤害，打不到 7 格外的目标', () => {
    const s = newGame();
    toTurn(s);
    const near = spawn(s, 0, 'sniper', 8, 8);
    const far = spawn(s, 0, 'sniper', 7, 8);
    const a = spawn(s, 1, 'infantry', 8, 12);
    const b = spawn(s, 1, 'infantry', 8, 15);
    atk(s, near, unit(a.id));
    expect(a.hp).toBe(6 - (5 * 2 - 1)); // 5 against a soldier's 1, twice over
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

  it('走完又打过的单位本回合不再有指令可下；只做了一样的还能做另一样', () => {
    const s = newGame();
    toTurn(s);
    const tank = spawn(s, 0, 'tank', 9, 9);
    const truck = spawn(s, 0, 'truck', 13, 13);
    expect(canStillAct(tank)).toBe(true);
    apply(s, { type: 'MOVE', unitId: tank.id, x: 9, y: 13 });
    expect(canStillAct(tank)).toBe(true); // it can still shoot
    atk(s, tank, unit(spawn(s, 1, 'infantry', 9, 15).id));
    expect(canStillAct(tank)).toBe(false);
    // Something with no weapon is spent once it has moved.
    truck.moveUsed = true;
    expect(canStillAct(truck)).toBe(false);
    // A shot without a move leaves the move.
    const gunner = spawn(s, 0, 'tank', 9, 9);
    atk(s, gunner, unit(spawn(s, 1, 'infantry', 9, 11).id));
    expect(canStillAct(gunner)).toBe(true);
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
    const foot = spawn(s, 1, 'infantry', 7, 5); // out of the infantry's reach, inside the anti-air tank's

    expect(attackTargets(s, unit(inf.id))).toEqual([]);
    expect(tryApply(s, { type: 'ATTACK', source: unit(inf.id), target: unit(jetA.id) })).toBe('只有防空武器能攻击空中单位');

    expect(attackTargets(s, unit(aaTank.id)).map((t) => t.id).sort()).toEqual([jetA.id, jetB.id, foot.id].sort());
    atk(s, aaTank, unit(jetA.id));
    // Twice its attack of 5 against aircraft, and the open ground's 2 on top: (10 + 2) − 2.
    expect(jetA.hp).toBe(12 - ((10 + 2) - 2));

    const fromGun = attackTargets(s, building(aaGun.id)).map((t) => t.id);
    expect(fromGun).toContain(jetB.id);
    expect(fromGun).not.toContain(foot.id);
    apply(s, { type: 'ATTACK', source: { kind: 'building', id: aaGun.id }, target: unit(jetB.id) });
    expect(jetB.hp).toBe(12 - (9 - 2));
    expect(tryApply(s, { type: 'ATTACK', source: { kind: 'building', id: aaGun.id }, target: unit(jetA.id) })).toContain('已经开火');

    aaGun.powered = false;
    expect(attackTargets(s, building(aaGun.id))).toEqual([]);
  });

  it('防空坦克对空攻击翻倍；天启双塔坦克每回合两炮合计 18，对空合计 8', () => {
    const s = newGame();
    toTurn(s);
    const aaTank = spawn(s, 0, 'aaTank', 8, 9);
    const beast = spawn(s, 0, 'apocalypse', 9, 9);
    const foot = spawn(s, 1, 'infantry', 8, 10);
    const jet = spawn(s, 1, 'fighter', 9, 10);

    // Against the ground the anti-air tank is no stronger than its attack of 5.
    atk(s, aaTank, unit(foot.id));
    expect(foot.hp).toBe(6 - ((5 + 2) - 1));

    // The Apocalypse reaches aircraft too: two shells of 4, so 8 for the turn, against armour of 2.
    atk(s, beast, unit(jet.id));
    expect(jet.hp).toBe(12 - 2 * ((4 + 2) - 2));
  });

  it('卡片上的攻击是每回合每一炮的合计', () => {
    expect(volley(UNITS.tank)).toBe(8);
    expect(volley(UNITS.twinTank)).toBe(10);
    expect(volley(UNITS.apocalypse)).toBe(18);
    const s = newGame();
    toTurn(s);
    for (const k of ['tank', 'twinTank', 'aaTank', 'missileTank', 'laserTank', 'apocalypse'] as const) spawn(s, 0, k, 9, 9);
    expect(attackPower(s.players[0])).toBe(8 + 10 + 5 + 14 + 12 + 18);
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
    expect(missile.hp).toBe(15);
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
  function chloeAtBase(netLevel: number) {
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

  it('防御网每一级都多抵扣一些；没有防御网则承受全部 13 点', () => {
    // Chloe's 13 less what each rung of the net absorbs: 2 / 3 / 4 / 6 / 8.
    for (const [level, absorbed] of [[1, 2], [2, 3], [3, 4], [4, 6], [5, 8]] as const) {
      expect(chloeAtBase(level).hq.hp).toBe(20 - (13 - absorbed));
    }
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

    // Player 0: tank 6 (8 + 2 in the open, against armour of 4) + sniper 1 = 7.
    atk(s, spawn(s, 0, 'tank', 9, 10), beast);
    atk(s, spawn(s, 0, 'sniper', 8, 8), beast);
    expect(chloe.hp).toBe(135 - 7);

    // Player 1: apocalypse 14 (two shells of 9 + 2 against armour of 4) + sniper 1 = 15, then the finishing tank shot.
    toTurn(s, 1);
    atk(s, spawn(s, 1, 'apocalypse', 10, 10), beast);
    atk(s, spawn(s, 1, 'sniper', 10, 9), beast);
    expect(chloe.hp).toBe(135 - 22);
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

describe('十字溅射', () => {
  it('导弹坦克：目标吃满，上下左右四格的敌人各吃一半，斜角和身后的不受影响，自己人不受影响', () => {
    const s = newGame();
    toTurn(s);
    const missile = spawn(s, 0, 'missileTank', 5, 9);
    const centre = spawn(s, 1, 'apocalypse', 9, 9);
    const right = spawn(s, 1, 'apocalypse', 10, 9);
    const up = spawn(s, 1, 'infantry', 9, 8);
    const down = spawn(s, 1, 'apocalypse', 9, 10);
    const corner = spawn(s, 1, 'apocalypse', 10, 10);
    const behind = spawn(s, 1, 'apocalypse', 9, 7);
    const mine = spawn(s, 0, 'apocalypse', 8, 9);
    const jet = spawn(s, 1, 'fighter', 9, 8); // wings are above the blast
    const events = atk(s, missile, unit(centre.id));
    // The missile tank fights from the open: 14 + 2 against armour of 5 − 2; the splash is half of that attack, less armour.
    expect(centre.hp).toBe(40 - (16 - 3));
    expect(right.hp).toBe(40 - (8 - 3));
    expect(down.hp).toBe(40 - (8 - 3));
    expect(s.players[1].units.some((u) => u.id === up.id)).toBe(false); // 6 life against 8 − 1
    expect(corner.hp).toBe(40);
    expect(behind.hp).toBe(40);
    expect(mine.hp).toBe(40);
    expect(jet.hp).toBe(12);
    const shot = events.find((e) => e.type === 'attack');
    expect(shot && shot.type === 'attack' ? shot.splash?.map((h) => h.target.id).sort() : []).toEqual([right.id, down.id, up.id].sort());
    expect(events.filter((e) => e.type === 'damage').map((e) => (e.type === 'damage' ? e.target.id : 0)).sort()).toEqual([centre.id, right.id, down.id, up.id].sort());
  });

  it('轰炸机：空中单位、只对地，十字溅射同样是一半', () => {
    const s = newGame();
    toTurn(s);
    const bomber = spawn(s, 0, 'bomber', 9, 7);
    const centre = spawn(s, 1, 'apocalypse', 9, 8);
    const side = spawn(s, 1, 'apocalypse', 10, 8);
    const jet = spawn(s, 1, 'fighter', 9, 8);
    expect(UNITS.bomber).toMatchObject({ hp: 20, attack: 16, defense: 3, range: 1, move: 4, cost: { ore: 800, oil: 1500 }, unitClass: 'air' });
    // Range 1: both tanks beside it are in reach, the fighter is not.
    expect(attackTargets(s, unit(bomber.id)).map((t) => t.id)).toEqual([centre.id, side.id]);
    expect(tryApply(s, { type: 'ATTACK', source: unit(bomber.id), target: unit(jet.id) })).toBe('只有防空武器能攻击空中单位');
    atk(s, bomber, unit(centre.id));
    expect(centre.hp).toBe(40 - (16 - 3));
    expect(side.hp).toBe(40 - (8 - 3));
    expect(jet.hp).toBe(12);
  });

  it('溅射波及基地建筑时，对方的炮台照样反击', () => {
    const s = newGame();
    toTurn(s);
    const missile = spawn(s, 0, 'missileTank', 9, 9);
    const quarry = spawn(s, 1, 'infantry', 12, 9);
    const gun = placeBuilding(s, s.players[1], 'turret', 13, 9);
    const events = atk(s, missile, unit(quarry.id));
    // The infantry beside the gun takes the shot; the gun takes the splash, and answers.
    expect(gun.hp).toBe(30 - 8);
    expect(missile.hp).toBe(15 - (8 - (2 - 2)));
    expect(events.some((e) => e.type === 'attack' && e.source.kind === 'building')).toBe(true);
  });
});

describe('双倍伤害', () => {
  it('狙击手对步兵类翻倍，对坦克不翻倍', () => {
    const s = newGame();
    toTurn(s);
    const sniper = spawn(s, 0, 'sniper', 8, 8);
    const foot = spawn(s, 1, 'infantry', 8, 11);
    atk(s, sniper, unit(foot.id));
    expect(foot.hp).toBe(6 - (10 - 1));
    toTurn(s, 0);
    const tank = spawn(s, 1, 'tank', 8, 11);
    atk(s, spawn(s, 0, 'sniper', 8, 8), unit(tank.id));
    expect(tank.hp).toBe(15 - (5 - 1));
  });

  it('反坦克战士对坦克类翻倍（人形机甲也算坦克类），对士兵不翻倍', () => {
    const s = newGame();
    toTurn(s);
    const at = spawn(s, 0, 'atSoldier', 8, 8);
    const mech = spawn(s, 1, 'mech', 8, 10);
    atk(s, at, unit(mech.id));
    expect(mech.hp).toBe(30 - (8 - (6 - 2)));
    toTurn(s, 0);
    const foot = spawn(s, 1, 'infantry', 8, 10);
    atk(s, spawn(s, 0, 'atSoldier', 8, 8), unit(foot.id));
    expect(foot.hp).toBe(6 - (4 - 1));
  });

  it('特种部队对外星人翻倍；对普通单位不翻倍', () => {
    const s = newGame();
    toTurn(s);
    const ops = spawn(s, 0, 'specOps', 8, 8);
    const beast = dropAlien(s, 'chloe', 8, 11);
    atk(s, ops, { kind: 'alien', id: beast.id });
    expect(beast.hp).toBe(135 - (16 - 4));
    atk(s, spawn(s, 0, 'specOps', 8, 8), unit(spawn(s, 1, 'tank', 8, 11).id));
    expect(s.players[1].units[0].hp).toBe(15 - (8 - 1));
  });
});

describe('新数值', () => {
  it('运输车 100 矿石 / 50 石油；天启双塔坦克另加 150 肉；双管坦克一回合 10、激光坦克 12、导弹坦克 14', () => {
    expect(UNITS.truck.cost).toEqual({ ore: 100, oil: 50 });
    expect(UNITS.apocalypse.cost).toEqual({ ore: 2200, oil: 1300, meat: 150 });
    expect(UNITS.missileTank).toMatchObject({ attack: 14, shots: 1, splash: 'cross' });
    expect(UNITS.laserTank).toMatchObject({ attack: 12, shots: 1, pierce: true });
    expect(UNITS.twinTank).toMatchObject({ attack: 5, shots: 2 });
    expect(volley(UNITS.twinTank)).toBe(10);
  });

  it('军营的单位与要求一致', () => {
    expect(UNITS.infantry).toMatchObject({ cost: { ore: 100, meat: 100 }, hp: 6, attack: 3, defense: 1, range: 2, move: 3, garrison: true });
    expect(UNITS.sniper).toMatchObject({ cost: { ore: 280, oil: 50, meat: 150 }, hp: 5, attack: 5, doubleVs: ['soldier'], defense: 1, range: 6, move: 3, garrison: true });
    expect(UNITS.atSoldier).toMatchObject({ cost: { ore: 400, oil: 200, meat: 150 }, hp: 6, attack: 4, doubleVs: ['tank'], defense: 1, range: 3, move: 3, garrison: true });
    expect(UNITS.atSoldier.pierce).toBeUndefined();
    expect(UNITS.specOps).toMatchObject({ name: '特种部队', cost: { ore: 600, oil: 300, meat: 200 }, hp: 15, attack: 8, doubleVs: ['alien'], defense: 4, range: 4, move: 4, producedBy: 'barracks' });
    expect(UNITS.specOps.garrison).toBeUndefined();
    expect(UNITS.mech).toMatchObject({ name: '人形机甲', cost: { ore: 2300, oil: 1100, meat: 300 }, hp: 30, attack: 13, defense: 6, range: 3, move: 4, producedBy: 'barracks', canHit: ['ground', 'air', 'building'] });
    expect(UNITS.mech.garrison).toBeUndefined();
    expect(UNITS.bomber.producedBy).toBe('airport');
    expect(UNITS.bomber.canHit).toEqual(['ground', 'building']);
  });
});

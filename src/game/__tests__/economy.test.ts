import { describe, expect, it } from 'vitest';
import { BUILDINGS, HARVEST_YIELD, START_RESOURCES, UNITS } from '../data';
import { canProduce, countBuilding, createGame, netDefense } from '../engine';
import { apply, build, newGame, nextTurn, rich, toTurn, tryApply } from './helpers';

describe('开局', () => {
  it('每名玩家有一座军事基地、一座加工工厂和一台运输车', () => {
    const s = newGame();
    for (const p of s.players) {
      expect(p.buildings.map((b) => b.key)).toEqual(['hq', 'factory']);
      expect(p.buildings[0].hp).toBe(20);
      expect(p.trucks).toBe(1);
      expect(p.resources).toEqual(START_RESOURCES.high);
    }
  });

  it('难度决定开局资源，对电脑玩家一样：低 500/500/500，高 300/250/250', () => {
    expect(START_RESOURCES.low).toEqual({ ore: 500, oil: 500, meat: 500 });
    expect(START_RESOURCES.high).toEqual({ ore: 300, oil: 250, meat: 250 });
    const low = createGame({ seats: ['human', 'ai'], totalTurns: 20, difficulty: 'low' });
    expect(low.difficulty).toBe('low');
    for (const p of low.players) expect(p.resources).toEqual({ ore: 500, oil: 500, meat: 500 });
    const high = createGame({ seats: ['human', 'ai'], totalTurns: 20 });
    expect(high.difficulty).toBe('high');
    for (const p of high.players) expect(p.resources).toEqual({ ore: 300, oil: 250, meat: 250 });
  });

  it('开局工厂没有电力，不能生产运输车', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    expect(p.powerCap).toBe(0);
    expect(canProduce(s, p, 'truck')).toContain('电力');
  });
});

describe('采集（行动点）', () => {
  it('1 个行动点派出全部运输车，每台运回 100 单位', () => {
    const s = newGame();
    const p = toTurn(s);
    p.ap = 3;
    p.trucks = 1;
    apply(s, { type: 'HARVEST', resource: 'ore' });
    expect(p.resources.ore).toBe(START_RESOURCES.high.ore + HARVEST_YIELD);
    expect(p.ap).toBe(2);

    p.trucks = 4;
    apply(s, { type: 'HARVEST', resource: 'oil' });
    expect(p.resources.oil).toBe(START_RESOURCES.high.oil + 4 * HARVEST_YIELD);
    expect(p.ap).toBe(1);
  });

  it('行动点用完就不能再采集', () => {
    const s = newGame();
    const p = toTurn(s);
    p.ap = 1;
    apply(s, { type: 'HARVEST', resource: 'meat' });
    expect(tryApply(s, { type: 'HARVEST', resource: 'meat' })).toBe('行动点不足');
  });

  it('骰子赢家 3 点、输家 1 点，每回合重新掷骰', () => {
    const s = newGame();
    apply(s, { type: 'ROLL_DICE' });
    while (s.phase !== 'player') apply(s, { type: 'NEXT' });
    expect(s.players.map((p) => p.ap).sort((a, b) => b - a)).toEqual([3, 1]);
    expect(s.currentPlayer).toBe(s.players.find((p) => p.ap === 3)!.id);
    // Drain everything, run the round out and roll again.
    apply(s, { type: 'HARVEST', resource: 'ore' });
    apply(s, { type: 'END_TURN' });
    apply(s, { type: 'HARVEST', resource: 'ore' });
    apply(s, { type: 'END_TURN' });
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('roundStart');
    apply(s, { type: 'ROLL_DICE' });
    expect(s.players.reduce((n, p) => n + p.ap, 0)).toBe(4);
  });
});

describe('电力', () => {
  it('一座发电站供 3 座建筑，超出的建筑停机', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    expect(p.powerCap).toBe(3);
    expect(p.powerUsed).toBe(1);
    expect(p.buildings.find((b) => b.key === 'factory')!.powered).toBe(true);

    build(s, 'defenseNet');
    build(s, 'barracks');
    expect(p.powerUsed).toBe(3);
    const turret = build(s, 'turret');
    expect(turret.powered).toBe(false);

    build(s, 'powerPlant');
    expect(turret.powered).toBe(true);
    expect(p.powerCap).toBe(6);
    expect(p.powerUsed).toBe(4);
  });

  it('防御网占一个电力位；断电后不再提供防御值', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    const net = build(s, 'defenseNet');
    expect(net.powered).toBe(true);
    expect(netDefense(p)).toBe(2);
    // Fill the base with buildings that outrank nothing: the net was built first so it stays on.
    build(s, 'barracks');
    build(s, 'warFactory');
    expect(p.buildings.filter((b) => !b.powered).map((b) => b.key)).toEqual(['warFactory']);
    net.powered = false;
    expect(netDefense(p)).toBe(0);
  });
});

describe('建造与升级', () => {
  it('建造扣除资源；资源不足时拒绝且不扣钱', () => {
    const s = newGame();
    const p = toTurn(s);
    p.resources = { ore: 400, oil: 0, meat: 200 };
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    expect(p.resources).toEqual({ ore: 100, oil: 0, meat: 0 });
    expect(tryApply(s, { type: 'BUILD', key: 'barracks' })).toBe('资源不足');
    expect(p.resources).toEqual({ ore: 100, oil: 0, meat: 0 });
    expect(countBuilding(p, 'barracks')).toBe(0);
  });

  it('防御网只能建一座，可升级 4 次：每次消耗是上一次的 150%，抵扣每两级翻倍', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    const net = build(s, 'defenseNet');
    expect(netDefense(p)).toBe(2);
    expect(tryApply(s, { type: 'BUILD', key: 'defenseNet' })).toContain('已建有');
    const ladder = BUILDINGS.defenseNet.levels;
    expect(ladder).toHaveLength(5);
    // One upgrade per rung: each costs exactly what the table says and absorbs what it says.
    const paid = [ladder[0].cost.ore!];
    for (let i = 1; i < ladder.length; i++) {
      const before = p.resources.ore;
      apply(s, { type: 'UPGRADE', buildingId: net.id });
      expect(net.level).toBe(i + 1);
      expect(before - p.resources.ore).toBe(ladder[i].cost.ore);
      expect(netDefense(p)).toBe(ladder[i].defense);
      paid.push(ladder[i].cost.ore!);
    }
    // 150% of the one before it, give or take the rounding to 5.
    for (let i = 1; i < paid.length; i++) expect(paid[i] / paid[i - 1]).toBeCloseTo(1.5, 2);
    expect(paid).toEqual([300, 450, 675, 1015, 1520]);
    // Twice what two rungs down absorbs.
    for (let i = 2; i < ladder.length; i++) expect(ladder[i].defense).toBe(ladder[i - 2].defense * 2);
    expect(ladder.map((l) => l.defense)).toEqual([2, 3, 4, 6, 8]);
    expect(tryApply(s, { type: 'UPGRADE', buildingId: net.id })).toBe('已是最高等级');
    // A force field has no walls to thicken.
    expect([net.hp, net.maxHp]).toEqual([0, 0]);
  });

  it('升级资源不足时拒绝且不扣钱；下次资源够了才能接着升', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    const net = build(s, 'defenseNet');
    p.resources.ore = 449;
    expect(tryApply(s, { type: 'UPGRADE', buildingId: net.id })).toBe('资源不足');
    expect([net.level, p.resources.ore, netDefense(p)]).toEqual([1, 449, 2]);
    p.resources.ore = 450;
    apply(s, { type: 'UPGRADE', buildingId: net.id });
    expect([net.level, p.resources.ore, netDefense(p)]).toEqual([2, 0, 3]);
  });

  it('炮台 → 重型炮台，防空炮 → 毒刺防空炮', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'powerPlant');
    const turret = build(s, 'turret');
    const aa = build(s, 'aaGun');
    expect([BUILDINGS.turret.levels[0].attack, BUILDINGS.turret.levels[1].attack]).toEqual([8, 13]);
    expect([BUILDINGS.aaGun.levels[0].attack, BUILDINGS.aaGun.levels[1].attack]).toEqual([9, 14]);
    apply(s, { type: 'UPGRADE', buildingId: turret.id });
    apply(s, { type: 'UPGRADE', buildingId: aa.id });
    expect(BUILDINGS.turret.levels[turret.level - 1].name).toBe('重型炮台');
    expect(BUILDINGS.aaGun.levels[aa.level - 1].name).toBe('毒刺防空炮');
    // A factory never gets a second level. The base does; that has its own tests.
    expect(tryApply(s, { type: 'UPGRADE', buildingId: p.buildings[1].id })).toBe('该建筑无法升级');
  });

  it('防御建筑放在朝向战场的一侧，普通建筑靠里', () => {
    const s = newGame(['human', 'human']);
    const p = toTurn(s);
    rich(p);
    const plant = build(s, 'powerPlant');
    const turret = build(s, 'turret');
    // 西南角：外角在 (0,0)，战场方向朝右下增大。
    expect(plant.x + plant.y).toBeLessThan(turret.x + turret.y);
    expect([turret.x, turret.y]).toEqual([5, 5]);
  });
});

describe('生产上限', () => {
  it('运输车：每座加工工厂最多 4 台', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    for (let i = 0; i < 3; i++) apply(s, { type: 'PRODUCE', unit: 'truck' });
    expect(p.trucks).toBe(4); // the truck you start with counts towards the 4
    expect(tryApply(s, { type: 'PRODUCE', unit: 'truck' })).toContain('运输车已满');
    build(s, 'factory');
    apply(s, { type: 'PRODUCE', unit: 'truck' });
    expect(p.trucks).toBe(5);
  });

  it('军工厂每回合最多生产 4 辆', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'warFactory');
    for (let i = 0; i < 4; i++) expect(tryApply(s, { type: 'PRODUCE', unit: 'tank' })).toBeNull();
    expect(p.units.filter((u) => u.key === 'tank')).toHaveLength(4);
    expect(tryApply(s, { type: 'PRODUCE', unit: 'tank' })).toContain('本回合产量已满');
    expect(tryApply(s, { type: 'PRODUCE', unit: 'missileTank' })).toContain('本回合产量已满');
  });

  it('军营每回合最多训练 4 名', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'powerPlant');
    build(s, 'barracks');
    for (const u of ['infantry', 'sniper', 'atSoldier', 'infantry'] as const) apply(s, { type: 'PRODUCE', unit: u });
    expect(p.units).toHaveLength(4);
    expect(tryApply(s, { type: 'PRODUCE', unit: 'infantry' })).toContain('本回合产量已满');
  });

  it('军事机场每座生产并停靠 4 架战斗机', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'airport');
    for (let i = 0; i < 4; i++) apply(s, { type: 'PRODUCE', unit: 'fighter' });
    expect(p.units.filter((u) => u.key === 'fighter')).toHaveLength(4);
    expect(tryApply(s, { type: 'PRODUCE', unit: 'fighter' })).toContain('容量已满');
    build(s, 'powerPlant');
    build(s, 'airport');
    apply(s, { type: 'PRODUCE', unit: 'fighter' });
    expect(p.units.filter((u) => u.key === 'fighter')).toHaveLength(5);
  });

  it('产量上限在下一回合重置', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'warFactory');
    for (let i = 0; i < 4; i++) apply(s, { type: 'PRODUCE', unit: 'tank' });
    nextTurn(s, p.id);
    // tryApply carries the order out when it is legal.
    expect(tryApply(s, { type: 'PRODUCE', unit: 'tank' })).toBeNull();
    expect(p.units.filter((u) => u.key === 'tank')).toHaveLength(5);
  });

  it('新单位出现在基地前方，战斗机停在机场上空', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    build(s, 'barracks');
    apply(s, { type: 'PRODUCE', unit: 'infantry' });
    expect([p.units[0].x, p.units[0].y]).toEqual([3, 6]);
    build(s, 'powerPlant');
    build(s, 'airport');
    apply(s, { type: 'PRODUCE', unit: 'fighter' });
    const airport = p.buildings.find((b) => b.key === 'airport')!;
    const f = p.units[1];
    expect(f.x).toBeGreaterThanOrEqual(airport.x);
    expect(f.x).toBeLessThanOrEqual(airport.x + 1);
    expect(f.y).toBeGreaterThanOrEqual(airport.y);
    expect(f.y).toBeLessThanOrEqual(airport.y + 1);
  });

  it('生产扣除资源', () => {
    const s = newGame();
    const p = toTurn(s);
    rich(p);
    build(s, 'powerPlant');
    const before = { ...p.resources };
    apply(s, { type: 'PRODUCE', unit: 'truck' });
    expect(before.ore - p.resources.ore).toBe(UNITS.truck.cost.ore);
  });
});

import { describe, expect, it } from 'vitest';
import { CITY, CITY_CLEAR, CITY_COUNT, HUGE_SIZE, LARGE_SIZE, SCORE_UNIT, ZONE_SIZE } from '../data';
import { attackTargets, canStillAct, cityById, moveRange, statsOf } from '../engine';
import { BoardIndex, cheb, cityAt, holderOf, reachable, route, terrainAt, toLocal } from '../board';
import { apply, dropAlien, dropSpider, newGame, nextTurn, playGame, spawn, toTurn, tryApply } from './helpers';
import type { CityBuilding, GameState, Unit } from '../types';

const unit = (id: number): { kind: 'unit'; id: number } => ({ kind: 'unit', id });
const cityRef = (c: CityBuilding): { kind: 'city'; id: number } => ({ kind: 'city', id: c.id });
const around = (x: number, y: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) out.push([x + dx, y + dy]);
  return out;
};

/** A match on bare grass with a house or tower standing on (10, 10). */
function withCity(kind: 'house' | 'tower' = 'house'): { s: GameState; city: CityBuilding } {
  const s = newGame();
  const city: CityBuilding = { id: s.nextId++, kind, x: 10, y: 10, hp: CITY[kind].hp, occupants: [] };
  s.city.push(city);
  return { s, city };
}

/** Walks a soldier of the current player from beside the building into it. */
const enter = (s: GameState, key: 'infantry' | 'sniper' | 'atSoldier' = 'infantry'): Unit => {
  const u = spawn(s, s.currentPlayer, key, 10, 11);
  expect(tryApply(s, { type: 'MOVE', unitId: u.id, x: 10, y: 10 })).toBeNull();
  return u;
};

describe('地图上的房屋与大厦', () => {
  it('大型和超大型地图才有；中型地图和平原地图没有', () => {
    for (const size of [LARGE_SIZE, HUGE_SIZE]) {
      const s = newGame(['human', 'human'], 5, 20, { size, terrain: 'random' });
      const want = CITY_COUNT[size];
      expect(s.city.filter((c) => c.kind === 'house')).toHaveLength(want.house);
      expect(s.city.filter((c) => c.kind === 'tower')).toHaveLength(want.tower);
      for (const c of s.city) expect(c).toMatchObject({ hp: 10, occupants: [] });
    }
    expect(CITY_COUNT[LARGE_SIZE]).toMatchObject({ house: 5, tower: 3 });
    expect(CITY_COUNT[HUGE_SIZE]).toMatchObject({ house: 10, tower: 6 });
    expect(newGame(['human', 'human'], 5, 20, { terrain: 'random' }).city).toEqual([]);
    expect(newGame(['human', 'human'], 5, 20, { size: LARGE_SIZE }).city).toEqual([]);
  });

  it('每座都在平原上，周围一格没有水，离每个基地至少 3 格，彼此不相邻', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const size of [LARGE_SIZE, HUGE_SIZE]) {
        const s = newGame(['human', 'ai'], seed, 20, { size, terrain: 'random' });
        expect(s.city).toHaveLength(CITY_COUNT[size].house + CITY_COUNT[size].tower);
        for (const c of s.city) {
          expect(terrainAt(s, c.x, c.y)).toBe('plain');
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) expect(['water', 'lake', 'bridge']).not.toContain(terrainAt(s, c.x + dx, c.y + dy));
          for (const corner of s.corners) {
            const l = toLocal(corner, c.x, c.y);
            // How far outside that base's zone it stands, counted on the nearer of the two axes.
            expect(Math.max(l.x - ZONE_SIZE, l.y - ZONE_SIZE)).toBeGreaterThanOrEqual(CITY_CLEAR);
          }
          for (const other of s.city) if (other !== c) expect(cheb(other, c)).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('大型地图上的整局电脑对局照样合法，电脑的士兵不会自己进驻', () => {
    const { rejects, s } = playGame(['ai', 'ai', 'ai', 'ai'], 19, 20, { size: LARGE_SIZE });
    expect(rejects).toEqual([]);
    expect(s.phase).toBe('gameover');
    for (const p of s.players) for (const u of p.units) expect(u.inside).toBeUndefined();
    for (const c of s.city) expect(c.occupants).toEqual([]);
  });
});

describe('进驻建筑', () => {
  it('士兵走得进去，坦克、特种部队和人形机甲进不去；进去后不再占格子，也不能再移动', () => {
    const { s, city } = withCity();
    toTurn(s);
    const foot = enter(s);
    expect(foot).toMatchObject({ inside: city.id, moveUsed: true, x: 10, y: 10 });
    expect(city.occupants).toEqual([foot.id]);
    expect(holderOf(s, city)?.id).toBe(0);
    expect(new BoardIndex(s).ground.has('10,10')).toBe(false);
    expect(cityAt(s, 10, 10)).toBe(city);
    // Only a shot is left this turn; next turn the soldier is still inside and ready again.
    expect(canStillAct(foot)).toBe(true);
    expect(moveRange(s, foot.id)).toEqual([]);
    foot.attackUsed = true;
    expect(canStillAct(foot)).toBe(false);
    nextTurn(s, 0);
    expect(foot.inside).toBe(city.id);
    expect(canStillAct(foot)).toBe(true);

    for (const k of ['tank', 'specOps', 'mech'] as const) {
      const u = spawn(s, 0, k, 10, 11);
      expect(tryApply(s, { type: 'MOVE', unitId: u.id, x: 10, y: 10 })).toBe('该单位无法进驻建筑');
    }
    const truck = spawn(s, 0, 'truck', 10, 11);
    expect(tryApply(s, { type: 'MOVE', unitId: truck.id, x: 10, y: 10 })).toBe('该单位无法进驻建筑');
  });

  it('士兵的路线到建筑门口为止，不会穿堂而过；电脑的路线绕开建筑', () => {
    const s = newGame();
    const house: CityBuilding = { id: s.nextId++, kind: 'house', x: 10, y: 10, hp: 10, occupants: [] };
    s.city.push(house);
    // A river across the whole board, with the house standing on the only gap.
    for (let x = 0; x < s.boardSize; x++) if (x !== 10) s.terrain[10 * s.boardSize + x] = 'water';
    const u = spawn(s, 0, 'infantry', 10, 12);
    const reach = reachable(new BoardIndex(s), s, u, 'foot', 3, u.id, u);
    expect(reach.has('10,10')).toBe(true);
    expect(reach.has('10,9')).toBe(false);
    // The same soldier without being named finds the door shut.
    expect(reachable(new BoardIndex(s), s, u, 'foot', 3, u.id).has('10,10')).toBe(false);
    expect(route(s, u, { x: 10, y: 8 }, 0, 'foot')).toBeNull();
  });

  it('在建筑里射程最多 3：狙击手够得着 3 格内，够不着 4 格外', () => {
    const { s, city } = withCity('tower');
    toTurn(s);
    const sniper = enter(s, 'sniper');
    expect(statsOf(s, sniper).range).toBe(3);
    const near = spawn(s, 1, 'tank', 13, 10);
    spawn(s, 1, 'tank', 14, 10);
    expect(attackTargets(s, unit(sniper.id)).map((t) => t.id)).toEqual([near.id]);
    apply(s, { type: 'ATTACK', source: unit(sniper.id), target: unit(near.id) });
    // 5 against a tank's armour in the open: a sniper's doubling is for soldiers only.
    expect(near.hp).toBe(15 - (5 - 1));
    // An infantryman's 2 is shorter than 3 and stays 2.
    apply(s, { type: 'LEAVE', cityId: city.id });
    nextTurn(s, 0);
    const foot = enter(s, 'infantry');
    expect(statsOf(s, foot).range).toBe(2);
  });

  it('里面的士兵打不到，只能打建筑', () => {
    const { s, city } = withCity('house');
    toTurn(s);
    const foot = enter(s);
    toTurn(s, 1);
    const tank = spawn(s, 1, 'tank', 12, 10);
    const list = attackTargets(s, unit(tank.id));
    expect(list.map((t) => t.id)).not.toContain(foot.id);
    expect(list).toContainEqual(cityRef(city));
    expect(tryApply(s, { type: 'ATTACK', source: unit(tank.id), target: unit(foot.id) })).toBe('目标不存在');
  });

  it('单层房屋住 1 名，高层大厦住 3 名；别人占着的进不去', () => {
    const { s, city } = withCity();
    toTurn(s);
    enter(s);
    const second = spawn(s, 0, 'sniper', 10, 11);
    expect(tryApply(s, { type: 'MOVE', unitId: second.id, x: 10, y: 10 })).toBe('建筑里已经满了');
    toTurn(s, 1);
    const foe = spawn(s, 1, 'infantry', 10, 11);
    expect(tryApply(s, { type: 'MOVE', unitId: foe.id, x: 10, y: 10 })).toBe('建筑里有玩家1的士兵，要先把它摧毁');
    expect(city.occupants).toHaveLength(1);

    const tower = withCity('tower');
    toTurn(tower.s);
    for (let i = 0; i < 3; i++) enter(tower.s);
    expect(tower.city.occupants).toHaveLength(3);
    const fourth = spawn(tower.s, 0, 'infantry', 10, 11);
    expect(tryApply(tower.s, { type: 'MOVE', unitId: fourth.id, x: 10, y: 10 })).toBe('建筑里已经满了');
  });
});

describe('解散', () => {
  it('士兵出来站到周围的空格，行动过的标记不变，建筑回到无人占据', () => {
    const { s, city } = withCity('tower');
    toTurn(s);
    const a = enter(s);
    const b = enter(s, 'sniper');
    const events = apply(s, { type: 'LEAVE', cityId: city.id });
    expect(events).toContainEqual({ type: 'leave', city: city.id, units: expect.any(Array) });
    const leave = events.find((e) => e.type === 'leave');
    expect(leave && leave.type === 'leave' ? leave.units.map((u) => u.unitId).sort() : []).toEqual([a.id, b.id].sort());
    for (const u of [a, b]) {
      expect(u.inside).toBeUndefined();
      expect(u.moveUsed).toBe(true);
      expect(u.attackUsed).toBe(false);
      expect(cheb(u, city)).toBe(1);
    }
    expect(a).not.toMatchObject({ x: b.x, y: b.y });
    expect(city.occupants).toEqual([]);
    expect(holderOf(s, city)).toBeNull();
  });

  it('周围站满了就提示“附近有其他单位无法解散”；别人的回合或没有自己的士兵时不能解散', () => {
    const { s, city } = withCity('house');
    toTurn(s);
    const foot = enter(s);
    for (const [x, y] of around(10, 10)) spawn(s, 1, 'infantry', x, y);
    expect(tryApply(s, { type: 'LEAVE', cityId: city.id })).toBe('附近有其他单位无法解散');
    expect(foot.inside).toBe(city.id);
    // One free tile is all a single soldier needs.
    s.players[1].units.pop();
    expect(tryApply(s, { type: 'LEAVE', cityId: city.id })).toBeNull();
    expect(foot.inside).toBeUndefined();

    toTurn(s, 1);
    enter(s);
    nextTurn(s, 0);
    expect(tryApply(s, { type: 'LEAVE', cityId: city.id })).toBe('里面没有你的士兵');
    expect(tryApply(s, { type: 'LEAVE', cityId: 9999 })).toBe('现在不能解散');
  });
});

describe('建筑被摧毁', () => {
  it('10 点生命、5 点防御；倒塌时里面各扣 3 点并散到周围，不足 3 点的阵亡', () => {
    const { s, city } = withCity('tower');
    toTurn(s);
    const strong = enter(s);
    const weak = enter(s, 'sniper');
    const doomed = enter(s, 'atSoldier');
    weak.hp = 3;
    doomed.hp = 2;
    toTurn(s, 1);
    const tank = spawn(s, 1, 'tank', 12, 10);
    const first = apply(s, { type: 'ATTACK', source: unit(tank.id), target: cityRef(city) });
    expect(first.some((e) => e.type === 'attack' && e.target.kind === 'city')).toBe(true);
    expect(city.hp).toBe(10 - (10 - 5));
    expect([strong.hp, weak.hp, doomed.hp]).toEqual([6, 3, 2]);
    nextTurn(s, 1);
    const last = apply(s, { type: 'ATTACK', source: unit(tank.id), target: cityRef(city) });
    expect(s.city).toEqual([]);
    expect(cityById(s, city.id)).toBeNull();
    expect(s.players[0].units.map((u) => u.id)).toEqual([strong.id]);
    expect(strong.hp).toBe(3);
    expect(strong.inside).toBeUndefined();
    expect(cheb(strong, city)).toBeLessThanOrEqual(1);
    expect(s.players[1].kills).toBe(2);
    expect(s.players[1].score).toBe(SCORE_UNIT.sniper + SCORE_UNIT.atSoldier);
    expect(last.some((e) => e.type === 'destroyed' && e.target.kind === 'city')).toBe(true);
    // The ground it stood on is open ground again.
    expect(cityAt(s, 10, 10)).toBeNull();
    expect(new BoardIndex(s).blocked.has('10,10')).toBe(false);
  });

  it('轰塌建筑的同一发导弹不会再溅射到逃出来的士兵', () => {
    const { s, city } = withCity('house');
    toTurn(s);
    const foot = enter(s);
    toTurn(s, 1);
    city.hp = 1;
    const missile = spawn(s, 1, 'missileTank', 13, 10);
    const events = apply(s, { type: 'ATTACK', source: unit(missile.id), target: cityRef(city) });
    expect(s.city).toEqual([]);
    expect(foot.hp).toBe(6 - 3);
    const shot = events.find((e) => e.type === 'attack');
    expect(shot && shot.type === 'attack' ? shot.splash ?? [] : []).toEqual([]);
  });

  it('玩家出局时，它留在建筑里的士兵一并消失', () => {
    const { s, city } = withCity('house');
    toTurn(s);
    enter(s);
    toTurn(s, 1);
    const hq = s.players[0].buildings[0];
    hq.hp = 1;
    const tank = spawn(s, 1, 'tank', 2, 0);
    apply(s, { type: 'ATTACK', source: unit(tank.id), target: { kind: 'building', id: hq.id } });
    expect(s.players[0].alive).toBe(false);
    expect(city.occupants).toEqual([]);
    expect(holderOf(s, city)).toBeNull();
  });
});

describe('外星人与建筑', () => {
  function alienGo(g: GameState) {
    g.nextAlien = 999;
    // Out of whoever's turn it is, on to the start of the next round.
    while (g.phase === 'player') apply(g, { type: 'END_TURN' });
    if (g.phase !== 'roundStart') throw new Error(`must start a round, not ${g.phase}`);
    apply(g, { type: 'ROLL_DICE' });
    return apply(g, { type: 'NEXT' });
  }

  it('外星人会攻击有人占据的建筑，无人的不理', () => {
    const held = withCity('tower');
    toTurn(held.s);
    const foot = enter(held.s);
    dropAlien(held.s, 'chloe', 11, 10);
    const events = alienGo(held.s);
    expect(events.some((e) => e.type === 'attack' && e.target.kind === 'city')).toBe(true);
    expect(held.city.hp).toBe(10 - (13 - 5));
    expect(foot.hp).toBe(6);

    const empty = withCity('house');
    dropAlien(empty.s, 'chloe', 11, 10);
    alienGo(empty.s);
    expect(empty.city.hp).toBe(10);
  });

  it('特种部队两下就能踩死一只小蜘蛛：8 × 2 对 1 点防御', () => {
    const s = newGame();
    toTurn(s);
    const ops = spawn(s, 0, 'specOps', 10, 10);
    const spider = dropSpider(s, 999, 10, 11);
    apply(s, { type: 'ATTACK', source: unit(ops.id), target: { kind: 'brood', id: spider.id } });
    expect(s.brood).toHaveLength(0);
  });
});

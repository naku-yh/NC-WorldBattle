import { describe, expect, it } from 'vitest';
import { ALIEN_CAP, ALIEN_EVERY, ALIEN_KEYS, ALIENS, BROOD_CAP, SCORE_BUILDING, SCORE_SPIDER, SCORE_UNIT, SPIDERLING, UNITS } from '../data';
import { alienById, attackTargets, buildSpots, canUpgrade, hqOf, placementError, spiderById } from '../engine';
import { cheb, key, ringTiles, terrainAt, toWorld, zoneSize } from '../board';
import { apply, dropAlien, dropSpider, newGame, placeBuilding, rich, setTerrain, spawn, toTurn, tryApply } from './helpers';
import type { AlienKey, AlienState, GameEvent, GameState, Spiderling, Terrain } from '../types';

const unit = (id: number): { kind: 'unit'; id: number } => ({ kind: 'unit', id });

/** From the start of a round: no other alien turns up, the dice are rolled, and the aliens have their go. */
function alienGo(s: GameState): GameEvent[] {
  s.nextAlien = 999;
  if (s.phase !== 'roundStart') throw new Error(`alienGo must start a round, not ${s.phase}`);
  apply(s, { type: 'ROLL_DICE' });
  const events = apply(s, { type: 'NEXT' });
  expect(s.phase).toBe('aliens');
  return events;
}

/** Plays rounds out with nobody lifting a finger until the first alien shows up. */
function playToFirstAlien(s: GameState): void {
  for (let guard = 0; !s.aliens.length && guard < 200; guard++) {
    if (s.phase === 'roundStart') apply(s, { type: 'ROLL_DICE' });
    else if (s.phase === 'player') apply(s, { type: 'END_TURN' });
    else apply(s, { type: 'NEXT' });
  }
}

const movesOf = (events: GameEvent[], id: number): number => events.filter((e) => e.type === 'move' && e.unitId === id).length;
const warps = (events: GameEvent[]): Array<Extract<GameEvent, { type: 'warp' }>> => events.filter((e): e is Extract<GameEvent, { type: 'warp' }> => e.type === 'warp');
const strikes = (events: GameEvent[]): Array<Extract<GameEvent, { type: 'attack' }>> => events.filter((e): e is Extract<GameEvent, { type: 'attack' }> => e.type === 'attack');

describe('五种外星人', () => {
  it('各有名字和本事；克洛伊生命值最高，神坦攻防最高，数值与要求一致', () => {
    expect(ALIEN_KEYS.map((k) => ALIENS[k].name)).toEqual(['克洛伊', '奎德', '牛美菱', '神坦', '鬼魅']);
    for (const k of ALIEN_KEYS) {
      if (k !== 'chloe') expect(ALIENS.chloe.hp).toBeGreaterThan(ALIENS[k].hp);
      expect(ALIENS.shentan.attack).toBeGreaterThanOrEqual(ALIENS[k].attack);
      expect(ALIENS.shentan.defense).toBeGreaterThanOrEqual(ALIENS[k].defense);
    }
    expect(ALIENS.kuide).toMatchObject({ attack: 5, defense: 5, brood: [1, 3] });
    expect(ALIENS.meiling).toMatchObject({ attack: 10, range: 4 });
    expect(ALIENS.shentan).toMatchObject({ attack: 15, defense: 8, range: 3, move: 1 });
    expect(ALIENS.guimei).toMatchObject({ attack: 13, defense: 2, teleports: true });
    expect(SPIDERLING).toMatchObject({ hp: 3, attack: 2, defense: 1 });
  });

  it('奎德每回合孵出 1–3 只小蜘蛛，一窝至多 8 只', () => {
    const broods = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const s = newGame(['human', 'human'], seed);
      const queen = dropAlien(s, 'kuide', 10, 10);
      const events = alienGo(s);
      const hatched = events.find((e) => e.type === 'hatch');
      const mine = s.brood.filter((b) => b.owner === queen.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(3);
      expect(hatched?.type === 'hatch' ? hatched.ids : []).toEqual(mine.map((b) => b.id));
      broods.add(mine.length);
    }
    expect([...broods].sort()).toEqual([1, 2, 3]);

    const s = newGame(['human', 'human']);
    const queen = dropAlien(s, 'kuide', 10, 10);
    // Bases that cannot fall: eight rounds of bites would otherwise end the match first.
    for (const p of s.players) for (const b of p.buildings) b.hp = b.maxHp = 99999;
    for (let round = 0; round < 8; round++) {
      alienGo(s);
      while (s.phase === 'player' || s.phase === 'aliens') apply(s, { type: s.phase === 'player' ? 'END_TURN' : 'NEXT' });
    }
    expect(s.brood.filter((b) => b.owner === queen.id).length).toBe(BROOD_CAP);
  });

  it('奎德倒下时，它的小蜘蛛跟着消失', () => {
    const s = newGame(['human', 'human']);
    toTurn(s, 0);
    const queen = dropAlien(s, 'kuide', 10, 10);
    for (let i = 0; i < 4; i++) dropSpider(s, queen.id, 11 + i, 10);
    queen.hp = 1;
    apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 11, 11).id), target: { kind: 'alien', id: queen.id } });
    expect(alienById(s, queen.id)).toBeNull();
    expect(s.brood).toHaveLength(0);
  });

  it('鬼魅从不走路：出现在够得着的地方，出手，然后立刻消失在别处', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(['human', 'human'], seed);
      // Somewhere next to nothing, so getting into range takes a jump.
      const ghost = dropAlien(s, 'guimei', 3, 12);
      spawn(s, 0, 'infantry', 10, 10);
      const events = alienGo(s);
      expect(movesOf(events, ghost.id)).toBe(0);
      // In, hit, gone.
      const jumps = warps(events);
      const blows = strikes(events);
      expect(blows).toHaveLength(1);
      expect(jumps).toHaveLength(2);
      expect(events.indexOf(jumps[1])).toBeGreaterThan(events.indexOf(blows[0]));
      // It strikes from next to something of the players', and leaves without lingering.
      expect(key(blows[0].from.x, blows[0].from.y)).toBe(key(jumps[0].to.x, jumps[0].to.y));
      expect(cheb(ghost, blows[0].from)).toBeGreaterThanOrEqual(3);
      expect(key(ghost.x, ghost.y)).not.toBe(key(3, 12));
    }
  });

  it('鬼魅一击就能咬死步兵', () => {
    let bitten = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(['human', 'human'], seed);
      dropAlien(s, 'guimei', 3, 12);
      const foot = spawn(s, 0, 'infantry', 10, 10);
      // Where it turns up is up to the dice: next to the infantry, or next to somebody's base.
      const bites = strikes(alienGo(s)).filter((b) => b.target.kind === 'unit');
      for (const blow of bites) expect(blow.target).toEqual(unit(foot.id));
      // 13 against 6 HP: one bite is always enough.
      expect(s.players[0].units.some((u) => u.id === foot.id)).toBe(bites.length === 0);
      bitten += bites.length;
    }
    expect(bitten).toBeGreaterThan(0);
  });

  it('牛美菱隔着 4 格开火，够得着就不走近', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = newGame(['human', 'human'], seed);
      const girl = dropAlien(s, 'meiling', 5, 10);
      const tank = spawn(s, 0, 'tank', 9, 10);
      const events = alienGo(s);
      expect(movesOf(events, girl.id)).toBe(0);
      // A tank in the open: armour 3 − 2.
      expect(tank.hp).toBe(15 - (10 - 1));
    }
    // One tile out of reach, she has to close in first — though, like every alien, she wanders now and then.
    let fired = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(['human', 'human'], seed);
      const girl = dropAlien(s, 'meiling', 4, 10);
      spawn(s, 0, 'tank', 9, 10);
      const events = alienGo(s);
      expect(movesOf(events, girl.id)).toBeLessThanOrEqual(1);
      const shot = strikes(events).some((e) => e.source.kind === 'alien');
      // She fires exactly when she has ended up within her reach.
      expect(shot).toBe(cheb(girl, { x: 9, y: 10 }) <= 4);
      if (shot) fired++;
    }
    expect(fired).toBeGreaterThan(15);
  });

  it('神坦射程 3、每回合只挪 1 格', () => {
    const s = newGame(['human', 'human']);
    const big = dropAlien(s, 'shentan', 6, 10);
    const tank = spawn(s, 0, 'tank', 9, 10);
    const events = alienGo(s);
    expect(movesOf(events, big.id)).toBe(0);
    expect(tank.hp).toBe(15 - (15 - 1));

    const t = newGame(['human', 'human']);
    const slow = dropAlien(t, 'shentan', 5, 10);
    spawn(t, 0, 'tank', 9, 10);
    alienGo(t);
    expect(cheb({ x: 5, y: 10 }, slow)).toBe(1);
  });

  it('外星人互不攻击，只打玩家的东西；小蜘蛛也只咬玩家', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(['human', 'human'], seed);
      ALIEN_KEYS.forEach((k, i) => dropAlien(s, k, 9 + (i % 2), 8 + Math.floor(i / 2)));
      const stray: Spiderling = { id: s.nextId++, owner: 999, x: 12, y: 12, hp: SPIDERLING.hp };
      s.brood.push(stray);
      const events = alienGo(s);
      for (const e of strikes(events)) expect(['unit', 'building']).toContain(e.target.kind);
      expect(s.aliens).toHaveLength(ALIEN_KEYS.length);
      expect(s.brood.length).toBeGreaterThan(0);
    }
  });

  it('小蜘蛛随机攻击够得着的东西', () => {
    const s = newGame(['human', 'human']);
    const stray = dropSpider(s, 999, 10, 10);
    const foot = spawn(s, 0, 'infantry', 11, 10);
    const events = alienGo(s);
    const bites = strikes(events).filter((e) => e.source.kind === 'spider');
    expect(bites).toHaveLength(1);
    expect(bites[0].target).toEqual(unit(foot.id));
    expect(foot.hp).toBe(6 - 2);
    expect(spiderById(s, stray.id)).not.toBeNull();
  });
});

describe('外星人的刷新', () => {
  it('每隔 5–8 回合来一个；场上已有两个时不再刷新，也不会重复同一种', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(['human', 'human'], seed, 40);
      for (const p of s.players) {
        const hq = hqOf(p)!;
        hq.hp = hq.maxHp = 99999;
      }
      const arrivals: number[] = [];
      for (let guard = 0; s.phase !== 'gameover' && guard < 1000; guard++) {
        if (s.phase === 'roundStart') {
          const before = s.aliens.length;
          apply(s, { type: 'ROLL_DICE' });
          if (s.aliens.length > before) arrivals.push(s.turn);
          expect(s.aliens.length).toBeLessThanOrEqual(ALIEN_CAP);
        } else apply(s, { type: s.phase === 'player' ? 'END_TURN' : 'NEXT' });
      }
      expect(s.phase).toBe('gameover');
      expect(arrivals).toHaveLength(2);
      const gaps = arrivals.map((t, i) => t - (arrivals[i - 1] ?? 0));
      for (const g of gaps) {
        expect(g).toBeGreaterThanOrEqual(ALIEN_EVERY[0]);
        expect(g).toBeLessThanOrEqual(ALIEN_EVERY[1]);
      }
      expect(new Set(s.aliens.map((a) => a.key)).size).toBe(2);
    }
  });

  it('出场顺序不固定：第一个来的可能是任何一种', () => {
    const first = new Set<AlienKey>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = newGame(['human', 'human'], seed, 40);
      playToFirstAlien(s);
      first.add(s.aliens[0].key);
    }
    expect([...first].sort()).toEqual([...ALIEN_KEYS].sort());
  });

  it('玩家能打外星人，外星人占着格子', () => {
    const s = newGame(['human', 'human']);
    toTurn(s);
    const beast: AlienState = dropAlien(s, 'chloe', 10, 10);
    dropSpider(s, beast.id, 11, 11);
    const tank = spawn(s, 0, 'tank', 9, 9);
    const targets = attackTargets(s, unit(tank.id)).map((t) => `${t.kind}:${t.id}`);
    expect(targets).toEqual([`spider:${s.brood[0].id}`, `alien:${beast.id}`].sort((a, b) => (a < b ? -1 : 1)));
    // An infantryman standing out in the open, away from every base, has nothing to shoot at.
    expect(attackTargets(s, unit(spawn(s, 0, 'infantry', 3, 12).id))).toEqual([]);
  });
});

describe('积分', () => {
  it('消灭敌方的单位和建筑都有积分', () => {
    const s = newGame();
    toTurn(s);
    const foot = spawn(s, 1, 'infantry', 10, 10);
    const plant = placeBuilding(s, s.players[1], 'powerPlant', 10, 12);
    plant.hp = 1;
    const events = [
      ...apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 10, 11).id), target: unit(foot.id) }),
      ...apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 9, 11).id), target: { kind: 'building', id: plant.id } }),
    ];
    expect(s.players[0].score).toBe(SCORE_UNIT.infantry + SCORE_BUILDING.powerPlant);
    expect(events.filter((e) => e.type === 'score')).toEqual([
      { type: 'score', player: 0, amount: SCORE_UNIT.infantry },
      { type: 'score', player: 0, amount: SCORE_BUILDING.powerPlant },
    ]);
    expect(s.players[1].score).toBe(0);
  });

  it('踩死一只小蜘蛛有积分和一点资源', () => {
    const s = newGame();
    toTurn(s);
    const bug = dropSpider(s, 999, 10, 10);
    const ore = s.players[0].resources.ore;
    // 3 HP behind 1 armour: a tank's 10 − 1 squashes it outright.
    const events = apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 10, 11).id), target: { kind: 'spider', id: bug.id } });
    expect(s.brood).toHaveLength(0);
    expect(s.players[0].score).toBe(SCORE_SPIDER);
    expect(s.players[0].resources.ore).toBe(ore + (SPIDERLING.reward.ore ?? 0));
    expect(events).toContainEqual({ type: 'score', player: 0, amount: SCORE_SPIDER });
  });

  it('补刀的人另得 100 分；积分按伤害分，没出过力的人分不到', () => {
    const s = newGame(['human', 'human', 'human']);
    toTurn(s, 0);
    const beast = dropAlien(s, 'kuide', 10, 10);
    // Player 1 has done 45 of her 50 HP; a tank on grass does 10 − 5 = 5.
    beast.hurt = { 1: 45 };
    beast.hp = 5;
    const events = apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 10, 11).id), target: { kind: 'alien', id: beast.id } });
    // A tenth and nine tenths of 300 by damage, and 100 more for the finishing blow.
    expect(s.players.map((p) => p.score)).toEqual([130, 270, 0]);
    expect(events).toContainEqual({ type: 'score', player: 0, amount: 130 });
    expect(events).toContainEqual({ type: 'score', player: 1, amount: 270 });
    expect(events.filter((e) => e.type === 'score')).toHaveLength(2);
  });
});

describe('数值调整', () => {
  it('坦克更便宜，天启双塔坦克更贵', () => {
    expect(UNITS.tank.cost).toEqual({ ore: 200, oil: 150 });
    expect(UNITS.apocalypse.cost).toEqual({ ore: 2200, oil: 1300 });
    expect(UNITS.tank.cost.ore!).toBeLessThan(UNITS.twinTank.cost.ore!);
    expect(UNITS.apocalypse.cost.ore!).toBeGreaterThan(UNITS.laserTank.cost.ore! + 500);
  });
});

describe('基地升级', () => {
  it('三种资源各花 1000；升级后自己的领地变成 7×7，别人不变', () => {
    const s = newGame(['human', 'human']);
    const p = toTurn(s, 0);
    const hq = hqOf(p)!;
    expect(tryApply(s, { type: 'UPGRADE', buildingId: hq.id })).toBe('资源不足');
    rich(p);
    const ore = p.resources.ore;
    const before = buildSpots(s, p, 'powerPlant');
    apply(s, { type: 'UPGRADE', buildingId: hq.id });
    expect(p.resources).toEqual({ ore: ore - 1000, oil: 99999 - 1000, meat: 99999 - 1000 });
    expect(hq.level).toBe(2);
    expect(hq.maxHp).toBe(30);
    expect(zoneSize(p)).toBe(7);
    expect(zoneSize(s.players[1])).toBe(6);
    expect(tryApply(s, { type: 'UPGRADE', buildingId: hq.id })).toBe('已是最高等级');
    expect(canUpgrade(p, hq.id)).toBe('已是最高等级');

    // The ring outside the old zone is now theirs to build on.
    const ring = ringTiles(s.corners[p.corner]);
    expect(ring).toHaveLength(13);
    const fresh = buildSpots(s, p, 'powerPlant').filter((a) => !before.some((b) => b.x === a.x && b.y === a.y));
    expect(fresh.length).toBeGreaterThan(5);
    expect(fresh.every((a) => ring.some((t) => t.x === a.x && t.y === a.y))).toBe(true);
  });

  it('新一圈里的树林、山地、湖泊会被推平；资源点和运输车道保持原样', () => {
    const s = newGame(['human', 'human', 'human', 'human'], 5, 20, { terrain: 'random' });
    const ring = ringTiles(s.corners[0]);
    const nodes = new Set(s.nodes.filter((n) => n.corner === 0).map((n) => key(n.x, n.y)));
    const open = ring.filter((t) => !nodes.has(key(t.x, t.y)));
    const rough: Terrain[] = ['forest', 'hill', 'lake', 'forest', 'hill', 'lake', 'forest', 'hill'];
    rough.forEach((kind, i) => setTerrain(s, open[i].x, open[i].y, kind));
    const p = toTurn(s, 0);
    rich(p);
    const events = apply(s, { type: 'UPGRADE', buildingId: hqOf(p)!.id });
    expect(events).toContainEqual({ type: 'expand', player: 0, buildingId: hqOf(p)!.id });
    for (const t of open) expect(terrainAt(s, t.x, t.y)).toBe('plain');
    // Elsewhere the map is as it was.
    expect(s.terrain.filter((t) => t !== 'plain').length).toBeGreaterThan(0);
    expect(s.nodes.filter((n) => n.corner === 0)).toHaveLength(3);
  });

  it('新一圈里的运输车道和出兵点要留空，别家的人不能建', () => {
    const s = newGame(['human', 'human']);
    const p = toTurn(s, 0);
    rich(p);
    apply(s, { type: 'UPGRADE', buildingId: hqOf(p)!.id });
    expect(placementError(s, p, 'powerPlant', 6, 1)).toBe('这些格子要留给运输车通行');
    expect(placementError(s, p, 'powerPlant', 0, 6)).toBe('这些格子要留给运输车通行');
    expect(placementError(s, p, 'powerPlant', 3, 6)).toBe('这里是出兵点，要留空');
    expect(placementError(s, p, 'powerPlant', 6, 2)).toBeNull();
    expect(placementError(s, p, 'powerPlant', 7, 2)).toBe('只能建在自己的领地内');
    expect(placementError(s, s.players[1], 'powerPlant', 6, 2)).toBe('只能建在自己的领地内');
  });

  it('升级后的基地照样出新兵，出兵点上方不会被占', () => {
    const s = newGame(['human', 'human']);
    const p = toTurn(s, 0);
    rich(p);
    apply(s, { type: 'UPGRADE', buildingId: hqOf(p)!.id });
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    apply(s, { type: 'BUILD', key: 'barracks' });
    apply(s, { type: 'PRODUCE', unit: 'infantry' });
    const muster = toWorld(s.corners[0], 3, 6);
    expect(p.units[0]).toMatchObject({ key: 'infantry', x: muster.x, y: muster.y });
  });
});

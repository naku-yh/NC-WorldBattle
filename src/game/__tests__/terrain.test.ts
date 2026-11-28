import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, BUILDINGS, LARGE_SIZE, MAP_SIZES, MIN_BOARD, TERRAIN, ZONE_SIZE } from '../data';
import { inBoard, key, laneTiles, moveModeOf, passable, route, supplyRoute, terrainAt, toLocal, toWorld, zoneTiles } from '../board';
import { BRIDGE_GAP, generateTerrain } from '../terrain';
import { Rng } from '../rng';
import { attackTargets, buildSpots, canBuild, createGame, defenseOf, moveRange, placementError, statsOf } from '../engine';
import { apply, newGame, playGame, rich, setTerrain, spawn, toTurn, tryApply } from './helpers';
import type { Corner, GameState, Pt, Terrain, UnitKey } from '../types';

const unit = (id: number): { kind: 'unit'; id: number } => ({ kind: 'unit', id });
const count = (s: GameState, t: Terrain): number => s.terrain.filter((x) => x === t).length;

/** Every tile a foot soldier can walk to from local (u, v) of a corner, looking at terrain only. */
function walkable(s: GameState, corner: number, u: number, v: number): Set<string> {
  const start = toWorld(s.corners[corner], u, v);
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const c = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (!inBoard(x, y, s.boardSize) || seen.has(key(x, y)) || !passable(s, x, y, 'foot')) continue;
        seen.add(key(x, y));
        queue.push({ x, y });
      }
    }
  }
  return seen;
}

describe('随机地图', () => {
  /** The waterway from one edge of the board to the other, one tile per line. */
  function courseOf(s: GameState): Pt[] {
    const vertical = s.waterway === 'vertical';
    const out: Pt[] = [];
    for (let line = 0; line < s.boardSize; line++) {
      const row: Pt[] = [];
      for (let pos = 0; pos < s.boardSize; pos++) {
        const x = vertical ? pos : line;
        const y = vertical ? line : pos;
        if (terrainAt(s, x, y) === 'water' || terrainAt(s, x, y) === 'bridge') row.push({ x, y });
      }
      // One tile wide, and it really does run edge to edge.
      expect(row).toHaveLength(1);
      out.push(row[0]);
    }
    return out;
  }

  const cases: Array<[number, number]> = [
    [2, BOARD_SIZE],
    [3, BOARD_SIZE],
    [4, BOARD_SIZE],
    [2, LARGE_SIZE],
    [4, LARGE_SIZE],
  ];

  for (const [players, size] of cases) {
    it(`${players} 人 · ${size}×${size}：水道贯穿地图且避开基地，两座桥相隔至少 ${BRIDGE_GAP} 格`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const s = newGame(Array.from({ length: players }, () => 'human'), seed, 20, { size, terrain: 'random' });
        const n = s.boardSize;
        expect(s.terrain).toHaveLength(n * n);
        const course = courseOf(s);
        for (let i = 1; i < course.length; i++) {
          expect(Math.max(Math.abs(course[i].x - course[i - 1].x), Math.abs(course[i].y - course[i - 1].y))).toBe(1);
        }
        // It keeps to the band between the four base zones.
        for (const q of course) {
          const pos = s.waterway === 'vertical' ? q.x : q.y;
          expect(pos).toBeGreaterThanOrEqual(ZONE_SIZE + 1);
          expect(pos).toBeLessThanOrEqual(n - ZONE_SIZE - 2);
        }
        const bridges = course.map((q, i) => (terrainAt(s, q.x, q.y) === 'bridge' ? i : -1)).filter((i) => i >= 0);
        expect(bridges).toHaveLength(2);
        expect(bridges[1] - bridges[0] - 1).toBeGreaterThanOrEqual(BRIDGE_GAP);
        // Each bridge joins the two banks.
        const across = s.waterway === 'vertical' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const i of bridges) {
          for (const [dx, dy] of across) expect(passable(s, course[i].x + dx, course[i].y + dy, 'foot')).toBe(true);
        }
      }
    });
  }

  it('基地、运输车道、资源点和出兵位置都是平坦的草地', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const players of [2, 3, 4]) {
        const s = newGame(Array.from({ length: players }, () => 'human'), seed, 20, { terrain: 'random' });
        for (let c = 0; c < 4; c++) for (const t of zoneTiles(c, s.boardSize)) expect(terrainAt(s, t.x, t.y)).toBe('plain');
        for (const p of s.players) {
          const c = s.corners[p.corner];
          for (const node of s.nodes.filter((x) => x.corner === p.corner)) {
            expect(terrainAt(s, node.x, node.y)).toBe('plain');
            // The lane a truck drives along, from the zone's edge out to the node.
            for (const l of laneTiles(toLocal(c, node.x, node.y))) {
              const w = toWorld(c, l.x, l.y);
              expect(terrainAt(s, w.x, w.y)).toBe('plain');
            }
          }
          // Where units walk out of the base.
          for (let du = -1; du <= 1; du++) {
            for (let dv = -1; dv <= 1; dv++) {
              const r = toWorld(c, 3 + du, ZONE_SIZE + dv);
              expect(terrainAt(s, r.x, r.y)).toBe('plain');
            }
          }
        }
      }
    }
  });

  it('所有基地连在同一片陆地上，运输车都能开到资源点旁', () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const players of [2, 3, 4]) {
        const s = newGame(Array.from({ length: players }, () => 'human'), seed, 20, { terrain: 'random' });
        const land = walkable(s, s.players[0].corner, 5, 5);
        for (const p of s.players) {
          const home = toWorld(s.corners[p.corner], 5, 5);
          expect(land.has(key(home.x, home.y))).toBe(true);
          for (const node of s.nodes.filter((x) => x.corner === p.corner)) {
            const beside = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => land.has(key(node.x + dx, node.y + dy)));
            expect(beside).toBe(true);
          }
        }
      }
    }
  });

  it('地图上有树林、山地和水，湖泊最多三片', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = newGame(['human', 'human'], seed, 20, { terrain: 'random' });
      expect(count(s, 'forest')).toBeGreaterThan(0);
      expect(count(s, 'hill')).toBeGreaterThan(0);
      expect(count(s, 'water')).toBeGreaterThan(0);
      expect(count(s, 'lake')).toBeLessThanOrEqual(3 * 6);
    }
  });

  it('每局的地图都不一样', () => {
    const seen = new Set<string>();
    const ways = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = newGame(['human', 'human'], seed, 20, { terrain: 'random' });
      seen.add(s.terrain.join(''));
      ways.add(s.waterway);
    }
    expect(seen.size).toBeGreaterThan(6);
    expect([...ways].sort()).toEqual(['horizontal', 'vertical']);
  });

  it('水道有纵有横，资源点始终贴着基地所在的一侧', () => {
    // Nodes hug the zone (see NODE_LAYOUT), so the waterway in the middle of
    // the board can never come between a base and its resources.
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(['human', 'human', 'human', 'human'], seed, 20, { terrain: 'random' });
      for (const node of s.nodes) {
        const c = s.corners[node.corner];
        const u = Math.abs(node.x - c.ox);
        const v = Math.abs(node.y - c.oy);
        if (s.waterway === 'vertical') expect(u).toBeLessThanOrEqual(ZONE_SIZE);
        else expect(v).toBeLessThanOrEqual(ZONE_SIZE);
      }
    }
  });

  it('同一个种子生成同一张地图；不传种子也能生成', () => {
    const a = newGame(['human', 'human'], 77, 20, { terrain: 'random' }).terrain.join();
    const b = newGame(['human', 'human'], 77, 20, { terrain: 'random' }).terrain.join();
    expect(a).toBe(b);
    expect(count(createGame({ seats: ['human', 'human'], totalTurns: 20 }), 'bridge')).toBe(2);
  });

  it('直接调用生成器也满足规则', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const n of [20, 25]) {
        const plan = generateTerrain(new Rng(seed), n, [0, 3]);
        const line = (i: number): number => (plan.waterway === 'vertical' ? Math.floor(i / n) : i % n);
        const bridges: number[] = [];
        plan.terrain.forEach((t, i) => {
          if (t === 'bridge') bridges.push(i);
        });
        expect(bridges).toHaveLength(2);
        expect(Math.abs(line(bridges[1]) - line(bridges[0])) - 1).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('运输车的往返路线', () => {
  it('每个角落都沿着车道走到资源点再原路返回，不会跑到地图边缘', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const players of [2, 4]) {
        const s = newGame(Array.from({ length: players }, () => 'human'), seed, 20, { terrain: 'random' });
        for (const node of s.nodes) {
          const c: Corner = s.corners[node.corner];
          // Trucks park on the four depot tiles.
          for (const [u, v] of [[1, 2], [2, 2], [1, 3], [2, 3]]) {
            const trip = supplyRoute(c, { x: u + 0.22, y: v + 0.22 }, toLocal(c, node.x, node.y));
            // Out along the lane, the node, then back: an odd number of stops with the node in the middle.
            expect(trip.length % 2).toBe(1);
            const half = (trip.length + 1) / 2;
            expect(trip[half - 1]).toEqual({ x: node.x, y: node.y });
            // There and back along the very same tiles.
            expect(trip.slice(half)).toEqual(trip.slice(0, half - 1).reverse());
            for (const q of trip.slice(0, half)) {
              expect(inBoard(q.x, q.y, s.boardSize)).toBe(true);
              const l = toLocal(c, q.x, q.y);
              // On its lane, or on the node at the end of it.
              const onLane = node.lane === 'row' ? l.y === 1 && l.x >= 1 && l.x <= node.x : l.x === 0 ? l.y >= 2 && l.y <= node.y : q.x === node.x && q.y === node.y;
              expect(onLane).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('地形加成', () => {
  /** `a` on one kind of ground hits `b` on another, once. Returns the damage. */
  function duel(groundA: Terrain, a: UnitKey, groundB: Terrain, b: UnitKey): number {
    const s = newGame();
    toTurn(s);
    setTerrain(s, 9, 9, groundA);
    setTerrain(s, 9, 10, groundB);
    const attacker = spawn(s, 0, a, 9, 9);
    const target = spawn(s, 1, b, 9, 10);
    const events = apply(s, { type: 'ATTACK', source: unit(attacker.id), target: unit(target.id) });
    const hit = events.find((e) => e.type === 'damage');
    return hit && hit.type === 'damage' ? hit.amount : -1;
  }

  it('平原：坦克攻击 +2，防御 −2', () => {
    expect(TERRAIN.plain.effects.tank).toEqual({ attack: 2, defense: -2 });
    // A tank in the open hits a soldier for 8 + 2; plain ground does nothing for the soldier.
    expect(duel('plain', 'tank', 'plain', 'infantry')).toBe(10);
    // Soldiers neither gain nor lose on plain ground: 3 − 0 either way.
    expect(duel('plain', 'infantry', 'plain', 'infantry')).toBe(3);
    // Tank against tank in the open: (8 + 2) − (3 − 2) = 9.
    expect(duel('plain', 'tank', 'plain', 'tank')).toBe(9);
    // The attacker in a wood and the target on a hill: neither changes a tank's attack or defence. 8 − 3.
    expect(duel('forest', 'tank', 'hill', 'tank')).toBe(5);
  });

  it('山地：士兵攻击 +2，防御 +1', () => {
    expect(TERRAIN.hill.effects.soldier).toEqual({ attack: 2, defense: 1 });
    // Infantry on a hill: 3 + 2 against a soldier on flat ground.
    expect(duel('hill', 'infantry', 'plain', 'infantry')).toBe(5);
    // Infantry on a hill is harder to hurt: 8 − (0 + 1).
    expect(duel('forest', 'tank', 'hill', 'infantry')).toBe(7);
  });

  it('树林：士兵防御 +2，坦克类射程 −2', () => {
    expect(TERRAIN.forest.effects.soldier).toEqual({ defense: 2 });
    expect(TERRAIN.forest.effects.tank).toEqual({ range: -2 });
    // A soldier among the trees takes 8 − (0 + 2) from a tank.
    expect(duel('forest', 'tank', 'forest', 'infantry')).toBe(6);
  });

  it('坦克在树林里射程缩短，查询与实际开火一致', () => {
    const s = newGame();
    toTurn(s);
    setTerrain(s, 9, 9, 'forest');
    const missile = spawn(s, 0, 'missileTank', 9, 9);
    const near = spawn(s, 0, 'tank', 8, 8);
    setTerrain(s, 8, 8, 'forest');
    expect(statsOf(s, missile)).toMatchObject({ attack: 15, range: 3, defense: 2 });
    // A weapon always reaches the next tile over, however deep the wood.
    expect(statsOf(s, near).range).toBe(1);
    const far = spawn(s, 1, 'infantry', 9, 13); // 4 tiles away: too far from inside the wood
    expect(attackTargets(s, unit(missile.id)).map((t) => t.id)).not.toContain(far.id);
    expect(tryApply(s, { type: 'ATTACK', source: unit(missile.id), target: unit(far.id) })).toBe('目标超出射程');
    apply(s, { type: 'MOVE', unitId: missile.id, x: 9, y: 12 }); // back out into the open, 1 tile from the target
    expect(statsOf(s, missile).range).toBe(5);
    expect(attackTargets(s, unit(missile.id)).map((t) => t.id)).toContain(far.id);
  });

  it('加成跟着脚下的格子变', () => {
    const s = newGame();
    toTurn(s);
    const tank = spawn(s, 0, 'tank', 9, 9);
    expect(statsOf(s, tank)).toMatchObject({ attack: 10, defense: 1, range: 2 });
    setTerrain(s, 9, 9, 'water');
    expect(statsOf(s, tank)).toMatchObject({ attack: 8, defense: 3 });
    setTerrain(s, 9, 9, 'bridge');
    expect(statsOf(s, tank)).toMatchObject({ attack: 8, defense: 3 });
    const foot = spawn(s, 0, 'infantry', 8, 8);
    expect(defenseOf(s, foot)).toBe(0);
    setTerrain(s, 8, 8, 'hill');
    expect(defenseOf(s, foot)).toBe(1);
    setTerrain(s, 8, 8, 'forest');
    expect(defenseOf(s, foot)).toBe(2);
  });

  it('飞机不受地形影响', () => {
    const s = newGame();
    toTurn(s);
    setTerrain(s, 9, 9, 'forest');
    const jet = spawn(s, 0, 'fighter', 9, 9);
    expect(statsOf(s, jet)).toMatchObject({ attack: 11, defense: 2, range: 3 });
  });
});

describe('地形与移动', () => {
  /** A waterway down column 10 with a bridge on row 9, on an otherwise open map. */
  function river(): GameState {
    const s = newGame(['human', 'human'], 1);
    for (let y = 0; y < 20; y++) setTerrain(s, 10, y, 'water');
    setTerrain(s, 10, 9, 'bridge');
    return s;
  }

  it('士兵和运输车不能进水，坦克可以涉水，飞机直接飞过', () => {
    const s = river();
    expect(passable(s, 10, 9, 'foot')).toBe(true); // the bridge takes everyone
    expect(passable(s, 10, 8, 'foot')).toBe(false);
    expect(passable(s, 10, 8, 'track')).toBe(true);
    expect(passable(s, 10, 8, 'air')).toBe(true);
    expect((['infantry', 'sniper', 'atSoldier', 'truck'] as UnitKey[]).map(moveModeOf)).toEqual(['foot', 'foot', 'foot', 'foot']);
    expect((['tank', 'aaTank', 'apocalypse'] as UnitKey[]).map(moveModeOf)).toEqual(['track', 'track', 'track']);
    expect(moveModeOf('fighter')).toBe('air');
    toTurn(s);
    const inf = spawn(s, 0, 'infantry', 9, 9);
    const range = moveRange(s, inf.id);
    expect(range).toContainEqual({ x: 10, y: 9 });
    expect(range).toContainEqual({ x: 11, y: 8 });
    expect(range).not.toContainEqual({ x: 11, y: 7 }); // only reachable by wading
  });

  it('士兵走桥过河：寻路绕到桥上，实际移动拒绝踩水', () => {
    const s = river();
    toTurn(s);
    const inf = spawn(s, 0, 'infantry', 9, 7);
    // Straight across is one step, but it is water: the route runs down to the bridge instead.
    const path = route(s, inf, { x: 13, y: 7 }, 0, 'foot')!;
    expect(path).toHaveLength(6);
    expect(path.map((p) => key(p.x, p.y))).toContain('10,9');
    for (const p of path) expect(passable(s, p.x, p.y, 'foot')).toBe(true);
    expect(tryApply(s, { type: 'MOVE', unitId: inf.id, x: 11, y: 7 })).toBe('无法到达该位置');
    apply(s, { type: 'MOVE', unitId: inf.id, x: 10, y: 9 });
    expect([inf.x, inf.y]).toEqual([10, 9]);
  });

  it('坦克涉水过河，战斗机的路线无视一切', () => {
    const s = river();
    toTurn(s);
    const tank = spawn(s, 0, 'tank', 9, 9);
    const events = apply(s, { type: 'MOVE', unitId: tank.id, x: 12, y: 9 });
    const move = events.find((e) => e.type === 'move');
    expect(move && move.type === 'move' ? move.path : []).toEqual([
      { x: 10, y: 9 },
      { x: 11, y: 9 },
      { x: 12, y: 9 },
    ]);
    expect([tank.x, tank.y]).toEqual([12, 9]);
    expect(route(s, tank, { x: 4, y: 16 }, 0, 'air')).toHaveLength(8);
  });
});

describe('自选位置建造', () => {
  function ready(seed = 1) {
    const s = newGame(['human', 'human'], seed);
    const p = toTurn(s);
    rich(p);
    return { s, p };
  }

  it('在自己领地的空格上建造，建筑就落在那里', () => {
    const { s, p } = ready();
    const spot = { x: 4, y: 4 };
    expect(buildSpots(s, p, 'turret')).toContainEqual(spot);
    const ore = p.resources.ore;
    apply(s, { type: 'BUILD', key: 'turret', ...spot });
    const turret = p.buildings[p.buildings.length - 1];
    expect([turret.key, turret.x, turret.y]).toEqual(['turret', 4, 4]);
    expect(p.resources.ore).toBe(ore - BUILDINGS.turret.levels[0].cost.ore!); // the gun was paid for
  });

  it('领地外、运输车通道、已有建筑和有单位的格子都不能建', () => {
    const { s, p } = ready();
    const why = (k: 'turret' | 'barracks', x: number, y: number): string | null => placementError(s, p, k, x, y);
    expect(why('turret', 6, 4)).toContain('领地');
    expect(why('turret', 10, 10)).toContain('领地');
    expect(why('turret', 1, 1)).toContain('运输车'); // supply row
    expect(why('turret', 1, 2)).toContain('运输车'); // depot
    expect(why('turret', 2, 0)).toContain('已有建筑'); // the starting factory
    expect(why('turret', 0, 0)).toContain('已有建筑'); // the base itself
    expect(why('barracks', 5, 4)).toContain('领地'); // 2 tiles wide: would stick out of the zone
    expect(why('barracks', 4, 4)).toBeNull();
    spawn(s, 0, 'infantry', 3, 3);
    expect(why('turret', 3, 3)).toContain('单位');
    expect(why('barracks', 3, 3)).toContain('单位');
    // The order is refused and nothing is paid.
    const ore = p.resources.ore;
    expect(tryApply(s, { type: 'BUILD', key: 'turret', x: 6, y: 4 })).toContain('领地');
    expect(p.resources.ore).toBe(ore);
    expect(p.buildings).toHaveLength(2);
  });

  it('对角领地的玩家同样只能建在自己的 6×6 里', () => {
    const { s } = ready();
    const foe = toTurn(s, 1);
    rich(foe);
    expect(placementError(s, foe, 'turret', 15, 15)).toBeNull();
    expect(placementError(s, foe, 'turret', 14, 14)).toBeNull();
    expect(placementError(s, foe, 'turret', 13, 15)).toContain('领地');
    expect(placementError(s, foe, 'turret', 17, 19)).toContain('已有建筑'); // their starting factory
    expect(buildSpots(s, foe, 'warFactory')).toContainEqual({ x: 14, y: 14 });
    apply(s, { type: 'BUILD', key: 'warFactory', x: 14, y: 14 });
    expect(foe.buildings.at(-1)).toMatchObject({ key: 'warFactory', x: 14, y: 14 });
  });

  it('每个可选位置都真的能建；资源不足时仍然拒绝', () => {
    const { s, p } = ready();
    for (const k of ['turret', 'barracks', 'warFactory', 'airport', 'factory', 'powerPlant'] as const) {
      expect(buildSpots(s, p, k).length).toBeGreaterThan(0);
      for (const spot of buildSpots(s, p, k)) expect(placementError(s, p, k, spot.x, spot.y)).toBeNull();
    }
    p.resources = { ore: 0, oil: 0, meat: 0 };
    expect(placementError(s, p, 'turret', 4, 4)).toBe('资源不足');
    expect(canBuild(s, p, 'turret')).toBe('资源不足');
  });

  it('不给位置时仍自动摆放（电脑玩家用的就是这个）', () => {
    const s = newGame(['human', 'human']);
    const p = toTurn(s);
    rich(p);
    apply(s, { type: 'BUILD', key: 'powerPlant' });
    apply(s, { type: 'BUILD', key: 'turret' });
    expect(p.buildings.find((b) => b.key === 'powerPlant')).toMatchObject({ x: 3, y: 0 });
    expect(p.buildings.find((b) => b.key === 'turret')).toMatchObject({ x: 5, y: 5 });
  });

  it('防御网没有占地，建造时不需要选位置', () => {
    const { s, p } = ready();
    apply(s, { type: 'BUILD', key: 'defenseNet' });
    expect(p.buildings.at(-1)).toMatchObject({ key: 'defenseNet', w: 0, h: 0 });
    expect(buildSpots(s, p, 'defenseNet')).toEqual([]);
  });
});

describe('地图大小', () => {
  it('中型 20×20，大型 25×25（格子数 +56%，保持正方形）', () => {
    expect(MAP_SIZES.map((m) => m.size)).toEqual([20, 25]);
    expect((25 * 25) / (20 * 20)).toBeGreaterThan(1.5);
    const s = newGame(['human', 'human'], 1, 20, { size: 25, terrain: 'random' });
    expect(s.boardSize).toBe(25);
    expect(s.terrain).toHaveLength(625);
    expect(s.corners.map((c) => c.ox)).toEqual([0, 24, 0, 24]);
    expect(s.players[1].buildings[0]).toMatchObject({ x: 23, y: 23 });
    for (const node of s.nodes) expect(inBoard(node.x, node.y, 25)).toBe(true);
  });

  it('地图大小有上下限', () => {
    expect(createGame({ seats: ['ai', 'ai'], totalTurns: 20, size: 4 }).boardSize).toBe(MIN_BOARD);
    expect(createGame({ seats: ['ai', 'ai'], totalTurns: 20, size: 999 }).boardSize).toBe(40);
  });

  it('大地图上的完整对局', () => {
    const { s, rejects } = playGame(['ai', 'ai', 'ai', 'ai'], 7, 24, { size: 25 });
    expect(rejects).toEqual([]);
    expect(s.phase).toBe('gameover');
  });
});

describe('电脑玩家在随机地图上打完整局', () => {
  it('AI 的指令全部合法，单位从不会站在它进不去的地形上', () => {
    for (const seed of [3, 11, 29]) {
      const { s, rejects } = playGame(['ai', 'ai'], seed);
      expect(rejects).toEqual([]);
      expect(s.phase).toBe('gameover');
      for (const p of s.players) {
        for (const u of p.units) expect(passable(s, u.x, u.y, moveModeOf(u.key))).toBe(true);
        for (const b of p.buildings) {
          if (b.w === 0) continue;
          // Buildings only ever stand on the dry grass of a base zone.
          for (let x = b.x; x < b.x + b.w; x++) for (let y = b.y; y < b.y + b.h; y++) expect(terrainAt(s, x, y)).toBe('plain');
        }
      }
    }
  });
});

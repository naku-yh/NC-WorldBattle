import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../../game/engine';
import type { AlienState, Building, GameState } from '../../game/types';
import { SAVE_SLOTS, ago, decodeSave, encodeSave, eraseSave, infoOf, listSlots, readSave, writeSave } from '../saves';

const KEY = (slot: number): string => `nc-worldbattle.save.${slot}`;
const NOW = new Date('2026-11-27T15:04:05').getTime();

/** A stand-in for window.localStorage, with an optional refusal to write. */
function fakeStorage(initial: Record<string, string> = {}, refuse = false) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      if (refuse) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string): void => {
      map.delete(k);
    },
  };
}

const game = (): GameState => createGame({ seats: ['human', 'ai', 'ai'], seed: 4, totalTurns: 30, size: 25 });

describe('存档文件', () => {
  it('写进去再读出来，对局一字不差，并记下保存时间', () => {
    const s = game();
    const st = fakeStorage();
    expect(writeSave(1, s, NOW, st)).toBeNull();
    const back = readSave(1, st)!;
    expect(back.state).toEqual(s);
    expect(back.savedAt).toBe(NOW);
    expect(st.map.has(KEY(0))).toBe(false);
  });

  it('三个存档位互不影响，删掉就空了', () => {
    const st = fakeStorage();
    const [a, b] = [game(), game()];
    writeSave(0, a, NOW, st);
    writeSave(2, b, NOW + 1000, st);
    expect(listSlots(st).map((x) => !!x.save)).toEqual([true, false, true]);
    expect(readSave(2, st)!.state).toEqual(b);
    eraseSave(0, st);
    expect(listSlots(st).map((x) => !!x.save)).toEqual([false, false, true]);
    expect(SAVE_SLOTS).toBe(3);
  });

  it.each([
    ['不是 JSON 的内容', '{oops'],
    ['别的程序的数据', JSON.stringify({ theme: 'dark' })],
    ['被截断的文件', JSON.stringify({ v: 1, savedAt: NOW, state: { ...game(), players: [] } })],
    ['地形表与地图大小对不上', JSON.stringify({ v: 1, savedAt: NOW, state: { ...game(), terrain: ['plain'] } })],
    ['不认识的回合阶段', JSON.stringify({ v: 1, savedAt: NOW, state: { ...game(), phase: 'loading' } })],
    ['别的版本的存档', JSON.stringify({ v: 99, savedAt: NOW, state: game() })],
    ['缺少时间的文件', JSON.stringify({ v: 3, state: game() })],
    ['外星人没记下自己是第几个降临的', JSON.stringify({ v: 5, savedAt: NOW, state: { ...game(), aliens: [{ id: 7777, key: 'kuide', x: 10, y: 10, hp: 75, arrived: 8, hurt: {} }] } })],
    ['不认识的外星人', JSON.stringify({ v: 5, savedAt: NOW, state: { ...game(), aliens: [{ id: 7777, key: 'godzilla', x: 10, y: 10, hp: 75, arrived: 8, wave: 1, hurt: {} }] } })],
    ['外星人处在不认识的形态', JSON.stringify({ v: 5, savedAt: NOW, state: { ...game(), aliens: [{ id: 7777, key: 'tuolong', x: 10, y: 10, hp: 45, arrived: 8, wave: 1, hurt: {}, form: 3 }] } })],
    ['不认识的小卒', JSON.stringify({ v: 5, savedAt: NOW, state: { ...game(), brood: [{ id: 7777, kind: 'zombie', owner: 1, x: 10, y: 10, hp: 2 }] } })],
    ['军衔不在三级里', JSON.stringify({ v: 5, savedAt: NOW, state: { ...game(), players: [{ ...game().players[0], units: [{ id: 7777, key: 'tank', owner: 0, x: 1, y: 1, hp: 15, moveUsed: false, attackUsed: false, rank: 9 }] }, ...game().players.slice(1)] } })],
  ])('%s：读不出来，并且标成损坏而不是空的', (_, raw) => {
    const st = fakeStorage({ [KEY(1)]: raw });
    const [slot] = listSlots(st).filter((x) => x.slot === 1);
    expect(slot).toEqual({ slot: 1, save: null, broken: true });
    expect(decodeSave(raw)).toBeNull();
  });

  it('空存档位不是损坏', () => {
    expect(decodeSave(null)).toBeNull();
    expect(listSlots(fakeStorage())[1]).toEqual({ slot: 1, save: null, broken: false });
  });

  it('没有本地存储时：读不到，也写不进，但不报错', () => {
    expect(listSlots(null)).toEqual([0, 1, 2].map((slot) => ({ slot, save: null, broken: false })));
    expect(writeSave(0, game(), NOW, null)).toBe('unavailable');
    expect(() => eraseSave(0, null)).not.toThrow();
  });

  it('浏览器拒绝写入时（空间已满）如实返回', () => {
    expect(writeSave(0, game(), NOW, fakeStorage({}, true))).toBe('quota');
  });

  it('晋升过的单位带着军衔原样存取；没有军衔的旧文件照样能读，军衔不在三级里的标成损坏', () => {
    const s = game();
    s.players[0].units.push({ id: 81, key: 'tank', owner: 0, x: 9, y: 9, hp: 30, moveUsed: false, attackUsed: false, rank: 3 });
    const file = decodeSave(encodeSave(s, NOW))!;
    expect(file.v).toBe(5);
    expect(file.state).toEqual(s);
    const { rank, ...plain } = s.players[0].units[0];
    expect(rank).toBe(3);
    const old = { ...s, players: [{ ...s.players[0], units: [plain] }, ...s.players.slice(1)] };
    expect(decodeSave(JSON.stringify({ v: 5, savedAt: NOW, state: old }))!.state).toEqual(old);
  });

  it('变了形的拓龙、带着账的小岩石巨人和骷髅兵原样存取；早先的第五版文件没有这些字段也照样能读', () => {
    const s = game();
    s.aliens.push({ id: 71, key: 'tuolong', x: 9, y: 9, hp: 20, arrived: 6, wave: 2, hurt: { 0: 25 }, form: 2, carried: { 1: 30 } });
    s.brood.push({ id: 72, kind: 'skeleton', owner: 71, x: 10, y: 9, hp: 2 });
    const file = decodeSave(encodeSave(s, NOW))!;
    expect(file.v).toBe(5);
    expect(file.state).toEqual(s);
    // From before any of this: no shape, no toll, and nothing to say which kind of small fry it is.
    const { form, carried, ...winged } = s.aliens[0];
    const { kind, ...fry } = s.brood[0];
    expect([form, carried, kind]).toEqual([2, { 1: 30 }, 'skeleton']);
    const old = { ...s, aliens: [{ ...winged, key: 'chloe' as const, hp: 90 }], brood: [fry] };
    expect(decodeSave(JSON.stringify({ v: 5, savedAt: NOW, state: old }))!.state).toEqual(old);
  });
});

/** A file as the first version wrote them: one alien at most, and nobody counting points. */
function firstVersionFile(): string {
  const { alienActed, aliens, brood, nextAlien, aliensSeen, city, difficulty, ...rest } = game();
  const state = {
    ...rest,
    turn: 7,
    phase: 'chloe',
    chloeActed: true,
    chloe: { alive: true, spawned: true, spawnTurn: 6, x: 9, y: 9, hp: 15 },
    // Player 2 has destroyed three units and done 45 damage to the alien.
    players: rest.players.map((p) => ({ ...p, score: undefined, kills: p.id === 1 ? 3 : 0, chloeDamage: p.id === 1 ? 45 : 0 })),
  };
  return JSON.stringify({ v: 1, savedAt: NOW, state });
}

describe('旧版本的存档', () => {
  it('第一版写的存档照样能读：克洛伊变成外星人列表，积分按战绩折算，对局能接着下', () => {
    const [slot] = listSlots(fakeStorage({ [KEY(0)]: firstVersionFile() })).filter((x) => x.slot === 0);
    expect(slot.broken).toBe(false);
    const file = slot.save!;
    // Brought all the way up: to the second version, then the third, the fourth, the fifth.
    expect(file.v).toBe(5);
    const s = file.state;
    // There were never any houses on that map, and no difficulty either: it goes on as the gentler game.
    expect(s.city).toEqual([]);
    expect(s.difficulty).toBe('low');
    expect(s.phase).toBe('aliens');
    expect(s.aliens).toHaveLength(1);
    // Her 15 life out of 90 is a sixth of what she had, so it is a sixth of 135 now.
    expect(s.aliens[0]).toMatchObject({ key: 'chloe', x: 9, y: 9, hp: 23, arrived: 6, wave: 1, hurt: { 1: 45 } });
    expect(s.brood).toEqual([]);
    expect(s.alienActed).toBe(true);
    expect(s.aliensSeen).toBe(1);
    // A fresh gap from the round it was saved on.
    expect(s.nextAlien).toBe(12);
    // Three units at 30 points, and one point per point of damage done to the alien.
    expect(s.players.map((p) => p.score)).toEqual([0, 135, 0]);
    expect(s.players.every((p) => !('chloeDamage' in p))).toBe(true);
    expect(file.savedAt).toBe(NOW);
    // The rules can pick the match up from there.
    expect(reduce(structuredClone(s), { type: 'NEXT' }).ok).toBe(true);
  });

  it('克洛伊还没来的旧存档：没有外星人，到来的回合照旧', () => {
    const raw = firstVersionFile();
    const file = JSON.parse(raw) as { state: { chloe: Record<string, unknown>; phase: string } };
    file.state.chloe = { alive: false, spawned: false, spawnTurn: 8, x: -1, y: -1, hp: 0 };
    file.state.phase = 'dice';
    const s = decodeSave(JSON.stringify(file))!.state;
    expect(s.aliens).toEqual([]);
    expect(s.nextAlien).toBe(8);
    expect(s.aliensSeen).toBe(0);
  });

  it('残缺的旧存档不会被读成半截对局，而是标成损坏', () => {
    const file = JSON.parse(firstVersionFile()) as { state: Record<string, unknown> };
    delete file.state.players;
    const [slot] = listSlots(fakeStorage({ [KEY(2)]: JSON.stringify(file) })).filter((x) => x.slot === 2);
    expect(slot).toEqual({ slot: 2, save: null, broken: true });
  });
});

/** A file as the second version wrote them: a defense net with two rungs, the top one absorbing 5. */
function secondVersionFile(netLevel: number): string {
  const s = game();
  const p = s.players[0];
  const net: Building = { id: 9999, key: 'defenseNet', level: netLevel, hp: 0, maxHp: 0, x: p.buildings[0].x + 0.5, y: p.buildings[0].y + 0.5, w: 0, h: 0, powered: true, fired: false, reacted: false };
  p.buildings.push(net);
  s.turn = 9;
  const { city, difficulty, ...old } = s;
  return JSON.stringify({ v: 2, savedAt: NOW, state: old });
}

describe('第二版的存档', () => {
  it('“高级防御网”原来是 2 级，现在是五级里的第 3 级，读档后就落在那里', () => {
    const file = decodeSave(secondVersionFile(2))!;
    expect(file.v).toBe(5);
    expect(file.savedAt).toBe(NOW);
    const net = file.state.players[0].buildings.find((b) => b.key === 'defenseNet')!;
    expect(net.level).toBe(3);
    // Everything else is where it was, and the match carries on from there.
    expect(file.state.turn).toBe(9);
    expect(file.state.players[0].buildings[0]).toMatchObject({ key: 'hq', level: 1 });
    expect(reduce(structuredClone(file.state), { type: 'ROLL_DICE' }).ok).toBe(true);
    // With room above it still: the net can be upgraded twice more.
    file.state.players[0].resources = { ore: 99999, oil: 99999, meat: 99999 };
    file.state.phase = 'player';
    file.state.currentPlayer = 0;
    for (const level of [4, 5]) {
      expect(reduce(file.state, { type: 'UPGRADE', buildingId: net.id }).ok).toBe(true);
      expect(net.level).toBe(level);
    }
  });

  it('才 1 级的防御网原样保留；写出来的存档读回来还是第五版', () => {
    expect(decodeSave(secondVersionFile(1))!.state.players[0].buildings.at(-1)!.level).toBe(1);
    const s = game();
    const file = decodeSave(encodeSave(s, NOW))!;
    expect(file.v).toBe(5);
    expect(file.state).toEqual(s);
  });
});

/** A file as the third version wrote them: no houses or towers on the map, and no difficulty. */
function thirdVersionFile(): string {
  const { city, difficulty, ...old } = game();
  return JSON.stringify({ v: 3, savedAt: NOW, state: old });
}

describe('第三版的存档', () => {
  it('读进来时地图上没有建筑，难度取低难度；保存后写成第五版', () => {
    const file = decodeSave(thirdVersionFile())!;
    expect(file.v).toBe(5);
    expect(file.savedAt).toBe(NOW);
    expect(file.state.city).toEqual([]);
    expect(file.state.difficulty).toBe('low');
    // Whatever else there was is untouched, and the match goes on from there.
    const { city, difficulty, ...old } = game();
    expect(file.state).toEqual({ ...old, city: [], difficulty: 'low' });
    expect(reduce(structuredClone(file.state), { type: 'ROLL_DICE' }).ok).toBe(true);
    const again = decodeSave(encodeSave(file.state, NOW))!;
    expect(again.v).toBe(5);
    expect(again.state.city).toEqual([]);
  });

  it('一个有人进驻的建筑原样存取', () => {
    const s = game();
    s.players[0].units.push({ id: 9998, key: 'infantry', owner: 0, x: 10, y: 10, hp: 3, moveUsed: true, attackUsed: false, inside: 9999 });
    s.city.push({ id: 9999, kind: 'tower', x: 10, y: 10, hp: 4, occupants: [9998] });
    const file = decodeSave(encodeSave(s, NOW))!;
    expect(file.state.city).toEqual(s.city);
    expect(file.state.players[0].units[0].inside).toBe(9999);
  });
});

/** A file as the fourth version wrote them: every alien of a kind as strong as the next, with two thirds of the life. */
function fourthVersionFile(): string {
  const s = game();
  s.turn = 9;
  // As that version knew her, with nothing to say which arrival she was.
  const kuide: Omit<AlienState, 'wave'> = { id: 7777, key: 'kuide', x: 10, y: 10, hp: 50, arrived: 8, hurt: { 1: 25 } };
  return JSON.stringify({ v: 4, savedAt: NOW, state: { ...s, aliens: [kuide] } });
}

describe('第四版的存档', () => {
  it('读进来时外星人都算第一个降临的，剩下的生命多一半；保存后写成第五版', () => {
    const file = decodeSave(fourthVersionFile())!;
    expect(file.v).toBe(5);
    expect(file.savedAt).toBe(NOW);
    // She had all 50 of her old life: that is 75 of the new figures.
    expect(file.state.aliens).toEqual([{ id: 7777, key: 'kuide', x: 10, y: 10, hp: 75, arrived: 8, wave: 1, hurt: { 1: 25 } }]);
    // Nothing else about the match has moved, and it goes on from there.
    const { aliens, ...rest } = file.state;
    const { aliens: none, ...fresh } = game();
    expect(aliens).toHaveLength(1);
    expect(none).toEqual([]);
    expect(rest).toEqual({ ...fresh, turn: 9 });
    expect(reduce(structuredClone(file.state), { type: 'ROLL_DICE' }).ok).toBe(true);
    const again = decodeSave(encodeSave(file.state, NOW))!;
    expect(again.v).toBe(5);
    expect(again.state.aliens).toEqual(file.state.aliens);
  });

  it('受过伤的照比例换算：旧生命的 50 → 75、20 → 30、33 → 50、1 → 2', () => {
    for (const [old, now] of [[50, 75], [20, 30], [33, 50], [1, 2]]) {
      const file = JSON.parse(fourthVersionFile()) as { state: { aliens: Array<{ hp: number }> } };
      file.state.aliens[0].hp = old;
      expect(decodeSave(JSON.stringify(file))!.state.aliens[0].hp).toBe(now);
    }
  });
});

describe('存档摘要', () => {
  it('说出回合、地图和轮到谁', () => {
    const s = game();
    const info = infoOf(decodeSave(encodeSave(s, NOW))!, NOW);
    expect(info).toMatchObject({ turn: '第 1 / 30 回合', moment: '回合开始', setup: '3 人 · 大型', ago: '刚刚' });

    s.phase = 'player';
    s.currentPlayer = 2;
    s.turn = 12;
    const mid = infoOf(decodeSave(encodeSave(s, NOW))!, NOW);
    expect(mid.moment).toBe('玩家3 的回合');
    expect(mid.color).toBe(s.players[2].color);
    expect(mid.turn).toBe('第 12 / 30 回合');
  });

  it('地图不是常规尺寸时直接写出边长', () => {
    const s = game();
    s.boardSize = 18;
    s.terrain = Array(18 * 18).fill('plain');
    expect(infoOf(decodeSave(encodeSave(s, NOW))!, NOW).setup).toBe('3 人 · 18×18');
  });

  it('相对时间按远近换算', () => {
    const min = 60_000;
    const hour = 60 * min;
    expect(ago(NOW, NOW)).toBe('刚刚');
    expect(ago(NOW, NOW + 59_000)).toBe('刚刚');
    expect(ago(NOW, NOW + 5 * min)).toBe('5 分钟前');
    expect(ago(NOW, NOW + 3 * hour)).toBe('3 小时前');
    expect(ago(NOW, NOW + 26 * hour)).toBe('昨天 15:04');
    expect(ago(NOW, NOW + 5 * 24 * hour)).toBe('11月27日 15:04');
    // A clock that runs backwards never shows the future.
    expect(ago(NOW, NOW - 10 * min)).toBe('刚刚');
  });
});

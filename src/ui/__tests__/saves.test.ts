import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../../game/engine';
import type { Building, GameState } from '../../game/types';
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
});

/** A file as the first version wrote them: one alien at most, and nobody counting points. */
function firstVersionFile(): string {
  const { alienActed, aliens, brood, nextAlien, aliensSeen, ...rest } = game();
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
    // Brought all the way up: first to the second version, then to the third.
    expect(file.v).toBe(3);
    const s = file.state;
    expect(s.phase).toBe('aliens');
    expect(s.aliens).toHaveLength(1);
    expect(s.aliens[0]).toMatchObject({ key: 'chloe', x: 9, y: 9, hp: 15, arrived: 6, hurt: { 1: 45 } });
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
  return JSON.stringify({ v: 2, savedAt: NOW, state: s });
}

describe('第二版的存档', () => {
  it('“高级防御网”原来是 2 级，现在是五级里的第 3 级，读档后就落在那里', () => {
    const file = decodeSave(secondVersionFile(2))!;
    expect(file.v).toBe(3);
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

  it('才 1 级的防御网原样保留；写出来的存档读回来还是第三版', () => {
    expect(decodeSave(secondVersionFile(1))!.state.players[0].buildings.at(-1)!.level).toBe(1);
    const s = game();
    const file = decodeSave(encodeSave(s, NOW))!;
    expect(file.v).toBe(3);
    expect(file.state).toEqual(s);
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

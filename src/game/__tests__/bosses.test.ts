import { describe, expect, it } from 'vitest';
import { ALIEN_GROWTH, ALIENS, HIDDEN_KEYS, SCORE_LAST_HIT, SCORE_SPIDER, SECOND_FORMS, UNITS, isHidden } from '../data';
import { alienStats, attackTargets, defenseOf, hqOf, minionDef } from '../engine';
import { BoardIndex, cheb, isFree } from '../board';
import { apply, dropAlien, dropSkeleton, dropSpider, newGame, placeBuilding, spawn, step, toTurn } from './helpers';
import type { AlienKey, AlienState, EntityRef, GameEvent, GameState, Unit } from '../types';

const unit = (id: number): { kind: 'unit'; id: number } => ({ kind: 'unit', id });
const alien = (id: number): EntityRef => ({ kind: 'alien', id });
const beast = (a: AlienState): EntityRef => alien(a.id);
const attacks = (events: GameEvent[]): Array<Extract<GameEvent, { type: 'attack' }>> => events.filter((e): e is Extract<GameEvent, { type: 'attack' }> => e.type === 'attack');
const bursts = (events: GameEvent[]): Array<Extract<GameEvent, { type: 'burst' }>> => events.filter((e): e is Extract<GameEvent, { type: 'burst' }> => e.type === 'burst');

/** A match on grass where player 0 acts before player 1 in the first round, so that both of them can strike in it without the aliens' turn in between. */
function firstRound(seedFrom = 1): GameState {
  for (let seed = seedFrom; seed < seedFrom + 60; seed++) {
    const s = newGame(['human', 'human'], seed);
    toTurn(s, 0);
    if (s.order[0] === 0) return s;
  }
  throw new Error('no seed where player 0 goes first');
}

/**
 * Out of whoever's turn it is, on to the aliens' go of the next round; nothing
 * new turns up meanwhile. Returns what the aliens did.
 */
function nextRound(s: GameState): GameEvent[] {
  for (let guard = 0; s.phase !== 'roundStart'; guard++) {
    if (guard > 12) throw new Error(`nextRound never reached a round start (phase ${s.phase})`);
    apply(s, s.phase === 'player' ? { type: 'END_TURN' } : { type: 'NEXT' });
  }
  s.nextAlien = 999;
  apply(s, { type: 'ROLL_DICE' });
  return apply(s, { type: 'NEXT' });
}

/** A flying dragon, as 拓龙 stands once its first shape has gone down. */
function dragon(s: GameState, x: number, y: number): AlienState {
  const a = dropAlien(s, 'tuolong', x, y);
  a.form = 2;
  a.hp = alienStats(a).hp;
  return a;
}

/** `u`'s go at the alien. */
const strike = (a: AlienState, u: Unit, s: GameState): void => {
  apply(s, { type: 'ATTACK', source: unit(u.id), target: beast(a) });
};


describe('隐藏外星人的降临', () => {
  it('从不当第一个；之后每次降临都可能是它们，每一种都会来；它们照样算一次降临', () => {
    let hidden = 0;
    const seen = new Set<AlienKey>();
    for (let seed = 1; seed <= 24; seed++) {
      const s = newGame(['human', 'human'], seed, 80);
      for (const p of s.players) {
        const hq = hqOf(p)!;
        hq.hp = hq.maxHp = 99999;
      }
      const arrivals: AlienState[] = [];
      for (let guard = 0; s.turn <= 45 && s.phase !== 'gameover' && guard < 3000; guard++) {
        if (s.phase === 'roundStart') {
          const before = new Set(s.aliens.map((a) => a.id));
          apply(s, { type: 'ROLL_DICE' });
          for (const a of s.aliens) if (!before.has(a.id)) arrivals.push({ ...a });
          // Whatever came is written off at once, so that the board never fills up and every arrival has its day.
          s.aliens = [];
          s.brood = [];
        } else apply(s, { type: s.phase === 'player' ? 'END_TURN' : 'NEXT' });
      }
      expect(arrivals.length).toBeGreaterThan(4);
      expect(isHidden(arrivals[0].key)).toBe(false);
      arrivals.forEach((a, i) => {
        expect(a.wave).toBe(i + 1);
        if (isHidden(a.key)) {
          hidden++;
          seen.add(a.key);
        }
        expect(a.hp).toBe(Math.round(ALIENS[a.key].hp * (1 + ALIEN_GROWTH * i)));
      });
    }
    // About a third of all arrivals after the first.
    expect(hidden).toBeGreaterThan(15);
    expect([...seen].sort()).toEqual([...HIDDEN_KEYS].sort());
  });

  it('它们同样随降临次序变强：第三个降临的拓龙生命、攻击、防御都是原参数的 1.4 倍', () => {
    const at = (key: AlienKey, wave: number, form = 1): AlienState => ({ id: 1, key, x: 0, y: 0, hp: 0, arrived: 1, wave, hurt: {}, form });
    for (const k of HIDDEN_KEYS) {
      const d = ALIENS[k];
      expect(alienStats(at(k, 3))).toMatchObject({ hp: Math.round(d.hp * 1.4), attack: Math.round(d.attack * 1.4), defense: Math.round(d.defense * 1.4), range: d.range, move: d.move });
    }
    // The third to arrive: 拓龙 63 / 17 / 14, and once it is a dragon 63 / 25 / 8.
    expect(alienStats(at('tuolong', 3))).toMatchObject({ hp: 63, attack: 17, defense: 14 });
    const dragonCard = SECOND_FORMS.tuolong!;
    expect(alienStats(at('tuolong', 3, 2))).toMatchObject({ hp: Math.round(dragonCard.hp * 1.4), attack: Math.round(dragonCard.attack * 1.4), defense: Math.round(dragonCard.defense * 1.4), flies: true, splash: 'cross' });
    // Still no changing or splitting a second time.
    expect(alienStats(at('tuolong', 3, 2)).changes).toBeUndefined();
    expect(alienStats(at('zecan', 3, 2)).splits).toBeUndefined();
  });

  it('场上已经有一个隐藏外星人时，下一个来的不是隐藏的', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(['human', 'human'], seed);
      const lurking = dropAlien(s, 'tuolong', 10, 10);
      s.aliensSeen = 3;
      s.turn = 9;
      s.nextAlien = 9;
      apply(s, { type: 'ROLL_DICE' });
      expect(s.aliens).toHaveLength(2);
      expect(s.aliens.some((a) => a === lurking)).toBe(true);
      expect(isHidden(s.aliens.find((a) => a !== lurking)!.key)).toBe(false);
    }
  });
});

describe('老外星人的对空规则', () => {
  it('克洛伊、奎德、牛美菱和小蜘蛛只打地面：飞机在够得着的地方也不会被咬', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const [k, gap] of [['chloe', 2], ['kuide', 2], ['meiling', 4]] as const) {
        const s = newGame(['human', 'human'], seed);
        dropAlien(s, k, 10, 10);
        const wing = spawn(s, 0, 'bomber', 10, 10 + gap);
        nextRound(s);
        expect(wing.hp, k).toBe(UNITS.bomber.hp);
      }
      const s = newGame(['human', 'human'], seed);
      dropSpider(s, 999, 10, 10);
      const wing = spawn(s, 0, 'bomber', 10, 11);
      nextRound(s);
      expect(wing.hp).toBe(UNITS.bomber.hp);
    }
  });

  it('神坦对地 3 格、对空 2 格：飞机隔着 2 格会被打到，隔着 3 格不会', () => {
    // Two tiles off: the bomber is the only thing in reach, and it is in reach of the short arm.
    const near = newGame(['human', 'human']);
    dropAlien(near, 'shentan', 10, 10);
    const close = spawn(near, 0, 'bomber', 10, 12);
    nextRound(near);
    expect(close.hp).toBe(UNITS.bomber.hp - (15 - defenseOf(near, close)));
    // Three tiles off, with a tank between: the tank is struck, the bomber is out of reach.
    const far = newGame(['human', 'human']);
    dropAlien(far, 'shentan', 10, 10);
    const tank = spawn(far, 0, 'tank', 10, 11);
    const wing = spawn(far, 0, 'bomber', 10, 13);
    nextRound(far);
    expect(tank.hp).toBe(UNITS.tank.hp - (15 - defenseOf(far, tank)));
    expect(wing.hp).toBe(UNITS.bomber.hp);
  });

  it('鬼魅对空对地', () => {
    const s = newGame(['human', 'human']);
    // Nothing else on the board for her to turn up beside.
    for (const p of s.players) p.buildings = [];
    dropAlien(s, 'guimei', 10, 11);
    const wing = spawn(s, 0, 'bomber', 10, 10);
    nextRound(s);
    expect(wing.hp).toBe(UNITS.bomber.hp - (13 - defenseOf(s, wing)));
  });
});

describe('拓龙', () => {
  it('第一形态是绿色的恐龙：生命 45、攻击 12、防御 10、射程 2、移动 4，只打地面', () => {
    const s = newGame(['human', 'human']);
    const dino = dropAlien(s, 'tuolong', 10, 10);
    expect(alienStats(dino)).toMatchObject({ name: '拓龙', look: '绿色的恐龙', hp: 45, attack: 12, defense: 10, range: 2, move: 4 });
    expect(alienStats(dino).flies).toBeUndefined();
    const tank = spawn(s, 0, 'tank', 10, 12);
    const wing = spawn(s, 0, 'bomber', 10, 11);
    nextRound(s);
    expect(tank.hp).toBe(UNITS.tank.hp - (12 - defenseOf(s, tank)));
    expect(wing.hp).toBe(UNITS.bomber.hp);
  });

  it('被打倒后原地变成黑色的飞龙：生命回到 45，悬在空中，对空对地；这时什么奖励都没有', () => {
    const s = firstRound();
    const dino = dropAlien(s, 'tuolong', 10, 10);
    dino.hp = 1;
    const events = apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'missileTank', 10, 11).id), target: beast(dino) });
    // The same alien in its second shape, standing where it fell.
    expect(s.aliens).toHaveLength(1);
    const winged = s.aliens[0];
    expect(winged).toMatchObject({ id: dino.id, key: 'tuolong', form: 2, hp: 45, x: 10, y: 10, wave: 1 });
    expect(alienStats(winged)).toMatchObject({ look: '黑色的飞龙', hp: 45, attack: 18, defense: 6, range: 3, move: 6, flies: true, splash: 'cross', reward: ALIENS.tuolong.reward, bounty: ALIENS.tuolong.bounty });
    expect(events.some((e) => e.type === 'morph' && e.id === dino.id)).toBe(true);
    expect(events.some((e) => e.type === 'destroyed')).toBe(false);
    expect(events.some((e) => e.type === 'alienKilled')).toBe(false);
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
    // What was done to the first shape is kept back for when the second goes down.
    expect(winged.hurt).toEqual({});
    expect(winged.carried).toEqual({ 0: 6 });
    // Wings: a tank on the ground has nothing to aim at it with; an anti-air tank has.
    const tank = spawn(s, 0, 'tank', 10, 12);
    const aa = spawn(s, 0, 'aaTank', 10, 13);
    expect(attackTargets(s, unit(tank.id))).toEqual([]);
    expect(attackTargets(s, unit(aa.id))).toEqual([alien(winged.id)]);
  });

  it('两个形态都倒下才发奖励；两个形态受到的伤害一起算，最后一击另有加分', () => {
    const s = firstRound();
    const dino = dropAlien(s, 'tuolong', 10, 10);
    const [p0, p1] = s.players;
    const ore = [p0.resources.ore, p1.resources.ore];
    // Player 0's missile tank hurts the dinosaur (14 + 2 on grass, against armour of 10).
    strike(dino, spawn(s, 0, 'missileTank', 10, 11), s);
    expect(dino.hp).toBe(45 - 6);
    // Player 1's special forces finish it (8 × 2 − 10), which only brings the dragon out.
    dino.hp = 1;
    toTurn(s, 1);
    strike(dino, spawn(s, 1, 'specOps', 10, 11), s);
    const winged = s.aliens[0];
    expect(winged.form).toBe(2);
    expect(winged.carried).toEqual({ 0: 6, 1: 6 });
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
    expect([p0.resources.ore, p1.resources.ore]).toEqual(ore);
    // The dragon flies: player 0's anti-air tank (10 + 2 against armour of 6), then player 1's mech with the last blow (13 + 2 − 6).
    toTurn(s, 0);
    strike(winged, spawn(s, 0, 'aaTank', 10, 11), s);
    winged.hp = 1;
    toTurn(s, 1);
    strike(winged, spawn(s, 1, 'mech', 10, 11), s);
    expect(s.aliens).toEqual([]);
    const done = [12, 15];
    const total = done[0] + done[1];
    const share = (i: number): number => done[i] / total;
    const card = ALIENS.tuolong;
    expect(p0.score).toBe(Math.round(card.bounty * share(0)));
    expect(p1.score).toBe(Math.round(card.bounty * share(1)) + SCORE_LAST_HIT);
    expect([p0.resources.ore - ore[0], p1.resources.ore - ore[1]]).toEqual([Math.round(card.reward.ore! * share(0)), Math.round(card.reward.ore! * share(1))]);
  });

  it('飞龙的火球带十字溅射：落点上下左右四格里的东西各受 9 − 防御，空中的和斜角上的不受影响', () => {
    const s = newGame(['human', 'human']);
    const winged = dragon(s, 10, 10);
    // A hurt tank in the middle, so that it is the one picked, with something on three of the tiles round it, a bomber over the fourth and a soldier one tile further out.
    const mark = spawn(s, 0, 'tank', 10, 12);
    mark.hp = 5;
    const foot = spawn(s, 0, 'infantry', 11, 12);
    const side = spawn(s, 0, 'tank', 10, 13);
    const front = spawn(s, 0, 'infantry', 10, 11);
    const wing = spawn(s, 0, 'bomber', 9, 12);
    const off = spawn(s, 0, 'infantry', 12, 12);
    const events = nextRound(s);
    const shot = attacks(events).find((e) => e.source.kind === 'alien')!;
    expect(shot.target).toEqual(unit(mark.id));
    // Half of 18, less each one's own armour.
    expect(shot.splash!.map((h) => ({ target: h.target, amount: h.amount }))).toEqual([
      { target: unit(foot.id), amount: 9 - defenseOf(s, foot) },
      { target: unit(side.id), amount: 9 - defenseOf(s, side) },
      { target: unit(front.id), amount: 9 - defenseOf(s, front) },
    ]);
    expect(s.players[0].units.map((u) => u.id)).toEqual([side.id, wing.id, off.id]);
    expect(side.hp).toBe(UNITS.tank.hp - (9 - defenseOf(s, side)));
    expect(wing.hp).toBe(UNITS.bomber.hp);
    expect(off.hp).toBe(UNITS.infantry.hp);
    expect(winged.hp).toBe(45);
  });
});

describe('泽参', () => {
  it('岩石巨人：生命 100、防御 18、攻击 10、移动 2、射程 2，只打地面；只有破甲的激光坦克伤得到它', () => {
    const s = firstRound();
    const giant = dropAlien(s, 'zecan', 10, 10);
    expect(alienStats(giant)).toMatchObject({ name: '泽参', look: '岩石巨人', hp: 100, attack: 10, defense: 18, range: 2, move: 2 });
    expect(alienStats(giant).flies).toBeUndefined();
    for (const k of ['missileTank', 'apocalypse', 'specOps', 'mech', 'bomber', 'twinTank', 'atSoldier'] as const) {
      strike(giant, spawn(s, 0, k, 10, 11), s);
      expect(giant.hp, k).toBe(100);
    }
    // 12 + 2 on grass, armour or no armour.
    strike(giant, spawn(s, 0, 'laserTank', 10, 11), s);
    expect(giant.hp).toBe(86);
  });

  it('被打倒后碎成两只小岩石巨人，站在它周围的空格上；这时没有奖励', () => {
    const s = firstRound();
    const giant = dropAlien(s, 'zecan', 10, 10);
    giant.hp = 1;
    const laser = spawn(s, 0, 'laserTank', 10, 11);
    const events = apply(s, { type: 'ATTACK', source: unit(laser.id), target: beast(giant) });
    expect(s.aliens).toHaveLength(2);
    for (const piece of s.aliens) {
      expect(piece).toMatchObject({ key: 'zecan', form: 2, hp: 30, wave: 1, hurt: {}, carried: { 0: 14 } });
      expect(cheb(piece, giant)).toBe(1);
      expect(piece).not.toMatchObject({ x: laser.x, y: laser.y });
      expect(alienStats(piece)).toMatchObject({ name: '小岩石巨人', hp: 30, attack: 5, defense: 10, range: 2, move: 2 });
      expect(alienStats(piece).flies).toBeUndefined();
      expect(alienStats(piece).reward).toEqual(ALIENS.zecan.reward);
    }
    expect(s.aliens[0]).not.toMatchObject({ x: s.aliens[1].x, y: s.aliens[1].y });
    const split = events.find((e) => e.type === 'split');
    expect(split).toMatchObject({ from: giant.id, ids: s.aliens.map((a) => a.id) });
    expect(events.some((e) => e.type === 'destroyed' && e.target.id === giant.id)).toBe(true);
    expect(events.some((e) => e.type === 'alienKilled')).toBe(false);
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('全部打完才发奖励：大家对大巨人和小巨人造成的伤害一起算；先碎的那只把账交给还站着的', () => {
    const s = firstRound();
    const giant = dropAlien(s, 'zecan', 10, 10);
    const [p0, p1] = s.players;
    // Each laser tank's shot goes straight through the armour: 12 + 2 on grass.
    const shot = 14;
    strike(giant, spawn(s, 0, 'laserTank', 10, 11), s);
    giant.hp = 1;
    toTurn(s, 1);
    strike(giant, spawn(s, 1, 'laserTank', 10, 11), s);
    const [a, b] = s.aliens;
    expect(b.carried).toEqual({ 0: shot, 1: shot });
    // Player 0 wears one of them down with two tanks, and player 1 finishes it: nothing is paid out for that one.
    toTurn(s, 0);
    for (let i = 0; i < 2; i++) strike(a, spawn(s, 0, 'laserTank', 10 + i, 11), s);
    a.hp = 1;
    toTurn(s, 1);
    strike(a, spawn(s, 1, 'laserTank', 10, 11), s);
    expect(s.aliens).toEqual([b]);
    expect(s.players.map((p) => p.score)).toEqual([0, 0]);
    expect(b.carried).toEqual({ 0: 3 * shot, 1: 2 * shot });
    // The last one goes down to player 0's third shot.
    toTurn(s, 0);
    for (let i = 0; i < 2; i++) strike(b, spawn(s, 0, 'laserTank', 10 + i, 11), s);
    b.hp = 1;
    strike(b, spawn(s, 0, 'laserTank', 12, 11), s);
    expect(s.aliens).toEqual([]);
    const done = [6 * shot, 2 * shot];
    const total = done[0] + done[1];
    const card = ALIENS.zecan;
    expect(p0.score).toBe(Math.round(card.bounty * (done[0] / total)) + SCORE_LAST_HIT);
    expect(p1.score).toBe(Math.round(card.bounty * (done[1] / total)));
    expect(p1.score).toBe(138);
  });

  it('第三个降临的泽参碎出来的小巨人同样是 1.4 倍：生命 42、攻击 7、防御 14', () => {
    const s = firstRound();
    const giant = dropAlien(s, 'zecan', 10, 10);
    giant.wave = 3;
    giant.hp = alienStats(giant).hp;
    expect(giant.hp).toBe(140);
    giant.hp = 1;
    apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'laserTank', 10, 11).id), target: beast(giant) });
    expect(s.aliens).toHaveLength(2);
    for (const piece of s.aliens) {
      expect(piece).toMatchObject({ wave: 3, form: 2, hp: 42 });
      expect(alienStats(piece)).toMatchObject({ attack: 7, defense: 14 });
    }
  });

  it('周围没有空格时它直接被击败，奖励当场发放', () => {
    const s = firstRound();
    const giant = dropAlien(s, 'zecan', 10, 10);
    giant.hp = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) spawn(s, 0, 'infantry', 10 + dx, 10 + dy);
    const laser = spawn(s, 0, 'laserTank', 10, 12);
    expect(cheb(laser, giant)).toBe(2);
    const events = apply(s, { type: 'ATTACK', source: unit(laser.id), target: beast(giant) });
    expect(s.aliens).toEqual([]);
    expect(events.some((e) => e.type === 'split')).toBe(false);
    expect(s.players[0].score).toBe(ALIENS.zecan.bounty + SCORE_LAST_HIT);
  });
});

describe('雅千', () => {
  it('悬在空中的女神：生命 75、防御 12、攻击 15、移动 4、射程 3；地面武器打不到她，防空武器和人形机甲打得到；她对空对地都能打', () => {
    const s = firstRound();
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    expect(alienStats(goddess)).toMatchObject({ name: '雅千', hp: 75, attack: 15, defense: 12, range: 3, move: 4, flies: true, counter: 6, burst: { every: 2, power: 8, reach: 1 } });
    for (const k of ['tank', 'missileTank', 'laserTank', 'specOps', 'infantry', 'sniper', 'bomber', 'fighter'] as const) {
      const u = spawn(s, 0, k, 10, 11);
      expect(attackTargets(s, unit(u.id)), k).toEqual([]);
    }
    for (const k of ['aaTank', 'mech', 'apocalypse'] as const) {
      const u = spawn(s, 0, k, 10, 11);
      expect(attackTargets(s, unit(u.id)), k).toContainEqual(alien(goddess.id));
    }
    const gun = placeBuilding(s, s.players[0], 'aaGun', 10, 13);
    const turret = placeBuilding(s, s.players[0], 'turret', 8, 10);
    expect(attackTargets(s, { kind: 'building', id: gun.id })).toContainEqual(alien(goddess.id));
    expect(attackTargets(s, { kind: 'building', id: turret.id })).toEqual([]);
  });

  it('她对空对地都能打：飞机在她射程里照样挨打', () => {
    const s = newGame(['human', 'human']);
    dropAlien(s, 'yaqian', 10, 10);
    const wing = spawn(s, 0, 'bomber', 10, 12);
    nextRound(s);
    expect(wing.hp).toBe(UNITS.bomber.hp - (15 - defenseOf(s, wing)));
  });

  it('被打就立刻反击：攻击方马上挨 6 − 防御（不是她平时的 15），哪怕在她的射程之外', () => {
    const s = firstRound();
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    // An anti-air tank four tiles off, which is its own reach and beyond hers.
    const aa = spawn(s, 0, 'aaTank', 10, 14);
    const events = apply(s, { type: 'ATTACK', source: unit(aa.id), target: beast(goddess) });
    // 10 + 2 on grass against armour of 12: turned aside.
    expect(goddess.hp).toBe(75);
    expect(aa.hp).toBe(UNITS.aaTank.hp - (6 - defenseOf(s, aa)));
    const shots = attacks(events);
    expect(shots.map((e) => [e.source.kind, e.target.kind])).toEqual([
      ['unit', 'alien'],
      ['alien', 'unit'],
    ]);
  });

  it('防空炮打她也被反击，而基地里别的炮台不会因此跟着开火：反击不算攻击基地', () => {
    const s = firstRound();
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    const gun = placeBuilding(s, s.players[0], 'aaGun', 10, 12);
    const other = placeBuilding(s, s.players[0], 'aaGun', 8, 10);
    const events = apply(s, { type: 'ATTACK', source: { kind: 'building', id: gun.id }, target: beast(goddess) });
    expect(attacks(events).map((e) => [e.source.kind, e.target])).toEqual([
      ['building', alien(goddess.id)],
      ['alien', { kind: 'building', id: gun.id }],
    ]);
    expect(gun.hp).toBe(30 - 6);
    expect(other.hp).toBe(30);
    expect(other.reacted).toBe(false);
    expect(gun.fired).toBe(true);
  });

  it('把她打死的那一击不会被反击', () => {
    const s = firstRound();
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    goddess.hp = 1;
    const mech = spawn(s, 0, 'mech', 10, 11);
    const events = apply(s, { type: 'ATTACK', source: unit(mech.id), target: beast(goddess) });
    expect(s.aliens).toEqual([]);
    expect(attacks(events)).toHaveLength(1);
    expect(mech.hp).toBe(UNITS.mech.hp);
    expect(events.some((e) => e.type === 'alienKilled')).toBe(true);
  });

  it('反击照样要得了残血的命，而且不算谁击杀了谁', () => {
    const s = firstRound();
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    const aa = spawn(s, 0, 'aaTank', 10, 11);
    // Five life on grass (armour 1): the 6 that comes back is one too many.
    aa.hp = 5;
    apply(s, { type: 'ATTACK', source: unit(aa.id), target: beast(goddess) });
    expect(s.players[0].units).toEqual([]);
    expect(s.players.map((p) => [p.score, p.kills])).toEqual([[0, 0], [0, 0]]);
    expect(goddess.hp).toBe(75);
  });

  it('降临后的第二回合第一次释放能量，之后每隔两回合一次；周围 3×3 的单位和建筑各受 8 − 防御', () => {
    const s = newGame(['human', 'human']);
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    // Tough customers round about her, so that her ordinary attacks come to nothing.
    const foot = spawn(s, 0, 'infantry', 9, 9);
    foot.hp = 500;
    const tank = spawn(s, 0, 'tank', 11, 10);
    tank.hp = 500;
    const plant = placeBuilding(s, s.players[0], 'powerPlant', 9, 11);
    const off = spawn(s, 0, 'infantry', 10, 13);
    off.hp = 500;
    // The round she arrives and the one after: nothing.
    expect(bursts(nextRound(s))).toHaveLength(0);
    expect(bursts(nextRound(s))).toHaveLength(0);
    const [first] = bursts(nextRound(s));
    expect(first.source).toEqual(alien(goddess.id));
    expect(first.hits.map((h) => [h.target, h.amount])).toEqual([
      [unit(foot.id), 8 - defenseOf(s, foot)],
      [unit(tank.id), 8 - defenseOf(s, tank)],
      [{ kind: 'building', id: plant.id }, 8],
    ]);
    expect(plant.hp).toBeLessThan(30);
    expect(off.hp).toBe(500);
    expect(bursts(nextRound(s))).toHaveLength(0);
    expect(bursts(nextRound(s))).toHaveLength(1);
  });

  it('被能量打死的士兵原地变成骷髅兵：生命 2、攻击 2、防御 0、移动 1、射程 1；不是士兵的不变', () => {
    const s = newGame(['human', 'human']);
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    const guard = spawn(s, 0, 'mech', 10, 12);
    guard.hp = 500;
    nextRound(s);
    nextRound(s);
    // Soldiers come up to her on the round the energy is due: two of them to fall, the special forces to stand it, and a mech that is no soldier.
    const foot = spawn(s, 0, 'infantry', 9, 9);
    const sniper = spawn(s, 0, 'sniper', 11, 11);
    const ops = spawn(s, 0, 'specOps', 9, 11);
    const mech = spawn(s, 0, 'mech', 11, 9);
    // Something softer still for her ordinary shot afterwards, so that the special forces are left alone.
    const decoy = spawn(s, 0, 'tank', 10, 9);
    decoy.hp = 10;
    const events = nextRound(s);
    expect(s.players[0].units.map((u) => u.id)).toEqual(expect.arrayContaining([ops.id, mech.id, guard.id]));
    expect(s.players[0].units.some((u) => u.id === foot.id || u.id === sniper.id)).toBe(false);
    const bones = s.brood.filter((b) => b.kind === 'skeleton');
    expect(bones).toHaveLength(2);
    for (const bone of bones) {
      expect(bone).toMatchObject({ kind: 'skeleton', owner: goddess.id, hp: 2 });
    }
    // They get up where the soldiers fell, and are off at once like any of the small fry.
    for (const [x, y] of [[9, 9], [11, 11]]) expect(bones.some((b) => cheb(b, { x, y }) <= 1)).toBe(true);
    for (const bone of bones) expect(minionDef(bone)).toMatchObject({ name: '骷髅士兵', hp: 2, attack: 2, defense: 0, range: 1, move: 1 });
    expect(events.some((e) => e.type === 'raise' && e.ids.length === 2)).toBe(true);
    // The special forces stood it (8 − 4) and were not picked afterwards.
    expect(ops.hp).toBe(15 - 4);
  });

  it('她带的小卒至多 8 只，和小蜘蛛一样', () => {
    const s = newGame(['human', 'human']);
    const goddess = dropAlien(s, 'yaqian', 10, 10);
    // Something tough to keep her where she is until the energy is due.
    const guard = spawn(s, 0, 'mech', 10, 11);
    guard.hp = 500;
    dropSkeleton(s, goddess.id, 5, 5);
    dropSpider(s, goddess.id, 5, 6);
    nextRound(s);
    nextRound(s);
    // A soldier on every other tile round her: all seven fall, but there is only room for six more.
    const men: Unit[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) men.push(spawn(s, 0, 'infantry', 10 + dx, 10 + dy));
    const events = nextRound(s);
    expect(men.every((m) => !s.players[0].units.some((u) => u.id === m.id))).toBe(true);
    // The two that were there to begin with, and six of the seven that fell.
    expect(s.brood).toHaveLength(8);
    expect(s.brood.filter((b) => b.kind === 'skeleton')).toHaveLength(7);
    expect(bursts(events)[0].hits).toHaveLength(8);
  });

  it('骷髅兵像小蜘蛛一样扑向够得着的东西，一口 2 − 防御；踩死它得 10 分和一点资源；雅千倒下时它们跟着消失', () => {
    const s = firstRound(1);
    const goddess = dropAlien(s, 'yaqian', 5, 5);
    const bone = dropSkeleton(s, goddess.id, 10, 10);
    const foot = spawn(s, 0, 'infantry', 10, 11);
    const wing = spawn(s, 0, 'bomber', 9, 10);
    const events = nextRound(s);
    expect(foot.hp).toBe(UNITS.infantry.hp - (2 - defenseOf(s, foot)));
    expect(wing.hp).toBe(UNITS.bomber.hp);
    expect(attacks(events).some((e) => e.source.kind === 'brood' && e.source.id === bone.id)).toBe(true);
    toTurn(s, 0);
    const ore = s.players[0].resources.ore;
    apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'tank', 11, 10).id), target: { kind: 'brood', id: bone.id } });
    expect(s.brood).toEqual([]);
    expect(s.players[0].score).toBe(SCORE_SPIDER);
    expect(s.players[0].resources.ore).toBe(ore + 60);
    // Hers go with her, wherever she has got to.
    const second = dropSkeleton(s, goddess.id, 6, 5);
    goddess.hp = 1;
    apply(s, { type: 'ATTACK', source: unit(spawn(s, 0, 'mech', goddess.x, goddess.y + 1).id), target: beast(goddess) });
    expect(s.aliens).toEqual([]);
    expect(s.brood.some((b) => b.id === second.id)).toBe(false);
  });

  it('能量波及基地时，基地里的防空炮会还击，炮台不会', () => {
    const s = newGame(['human', 'human']);
    // Her, right inside a base that has both kinds of gun, on a round her energy is due.
    const goddess = dropAlien(s, 'yaqian', 3, 3);
    goddess.arrived = s.turn - 2;
    const gun = placeBuilding(s, s.players[0], 'aaGun', 4, 4);
    const turret = placeBuilding(s, s.players[0], 'turret', 2, 4);
    const events = nextRound(s);
    expect(bursts(events)).toHaveLength(1);
    // The anti-air gun answers the burst, and is answered in turn; the turret, which cannot reach the air, never stirs.
    expect(attacks(events).slice(0, 2).map((e) => [e.source, e.target])).toEqual([
      [{ kind: 'building', id: gun.id }, alien(goddess.id)],
      [alien(goddess.id), { kind: 'building', id: gun.id }],
    ]);
    expect(gun.reacted).toBe(true);
    expect(turret.reacted).toBe(false);
  });
});

describe('电脑玩家与隐藏外星人', () => {
  it('整局电脑对局里三个隐藏外星人都在场，指令照样全部合法，半路存档读回来结局不变', () => {
    const s = newGame(['ai', 'ai', 'ai'], 5, 20, { terrain: 'random' });
    const half = Math.floor(s.boardSize / 2);
    const idx = new BoardIndex(s);
    const dens: Array<[number, number]> = [];
    for (let r = 1; dens.length < 4 && r < 6; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (dens.length < 4 && isFree(idx, s, half + dx, half + dy, 'foot') && !dens.some(([x, y]) => x === half + dx && y === half + dy)) dens.push([half + dx, half + dy]);
      }
    }
    const dino = dropAlien(s, 'tuolong', ...dens[0]);
    dino.hp = 12;
    dropAlien(s, 'zecan', ...dens[1]);
    const goddess = dropAlien(s, 'yaqian', ...dens[2]);
    dropSkeleton(s, goddess.id, ...dens[3]);
    const rejects: string[] = [];
    const play = (g: GameState, until: number): void => {
      let steps = 0;
      while (g.turn <= until && g.phase !== 'gameover' && steps++ < 60000) {
        const why = step(g);
        if (why) rejects.push(why);
      }
    };
    play(s, 9);
    expect(rejects).toEqual([]);
    const again = structuredClone(s);
    play(s, 99);
    play(again, 99);
    expect(rejects).toEqual([]);
    expect(s.phase).toBe('gameover');
    expect(again).toEqual(s);
  });
});

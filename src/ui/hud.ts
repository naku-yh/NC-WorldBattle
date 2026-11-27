import { ALIENS, BUILDABLE, BUILDINGS, HARVEST_YIELD, PRODUCED_UNITS, RESOURCES, SCORE_LAST_HIT, SCORE_SPIDER, SPIDERLING, TERRAIN, TRUCKS_PER_FACTORY, UNITS } from '../game/data';
import { alienById, attackPower, buildingById, canBuild, canProduce, canUpgrade, countBuilding, hqOf, netDefense, nextLevelOf, spiderById, statsOf, unitById } from '../game/engine';
import { terrainAt, zoneSize } from '../game/board';
import type { BuildingKey, Cost, EntityRef, GameState, PlayerState, Pt, ResourceKey, Resources, TerrainDef, TerrainEffect, UnitFamily, UnitKey } from '../game/types';
import { fmt, h, touchOnly } from './dom';
import { alienIcon, buildingIcon, glyph, icon, iconBox, spiderIcon, terrainIcon, unitIcon, type IconName } from './icons';
import { costText, effectOf } from './rules';

/** The sidebar's pages. Gathering and the rulebook have left it: gathering has a panel of its own, the rules live in the pause menu. */
export type Tab = 'build' | 'produce' | 'structures';
export interface Sel {
  kind: 'unit' | 'building';
  id: number;
}
export interface HudCtx {
  tab: Tab;
  selection: Sel | null;
  /** Something clicked just to look at it. */
  inspect: EntityRef | null;
  /** An empty tile clicked just to look at it. */
  tile: Pt | null;
  /** The building the player is choosing a spot for. */
  placing: BuildingKey | null;
  /** A finger has tapped a tile for the building being placed and is one more tap away from building it there. */
  aimed: boolean;
  /** A producer of the player's own that is being looked at: its line on the "生产" page is lit, and scrolled to the first time. */
  focusProducer: BuildingKey | null;
  /** Only on the render that follows the click: after that the page keeps the place the player scrolled to. */
  scrollProducer: boolean;
  humanTurn: boolean;
  speed: number;
}
export interface HudActions {
  setTab(t: Tab): void;
  harvest(res: ResourceKey): void;
  build(k: BuildingKey): void;
  produce(u: UnitKey): void;
  upgrade(id: number): void;
  endTurn(): void;
  nextUnit(): void;
  deselect(): void;
  showRules(): void;
  menu(): void;
  overview(): void;
  toggleSpeed(): void;
  cancelPlace(): void;
}

const TABS: Array<[Tab, string]> = [
  ['build', '建造'],
  ['produce', '生产'],
  ['structures', '建筑'],
];
const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];
/** The buildings whose units the "生产" page lists, in the data's order. */
const PRODUCERS = Object.keys(PRODUCED_UNITS) as Array<keyof typeof PRODUCED_UNITS>;

const ico = (name: IconName, color?: string): HTMLElement => h('span', { class: 'ico', html: icon(name), style: color ? `color:${color}` : '' });

function costChips(cost: Cost, have: Resources): HTMLElement {
  const w = h('span', { class: 'cost' });
  for (const k of RES_KEYS) {
    const v = cost[k];
    if (!v) continue;
    w.append(h('span', { class: have[k] < v ? 'short' : '', title: RESOURCES[k].name }, ico(k, RESOURCES[k].color), fmt(v)));
  }
  return w;
}

/** "攻 8" style labelled value: for the lists, and for a tile. */
function stat(label: string, text: string): HTMLElement {
  return h('span', { class: 'stat-chip' }, h('i', {}, label), text);
}

/** "+2" or "−2". */
const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** How many cells each figure's row has: the most it reaches on any unit or alien, so that every row of a kind is as long as every other and two cards line up. */
const ROOM = { health: 12, attack: 16, defense: 10, range: 6 };

/** One figure of a card: a row of cells, then the number. */
interface Meter {
  label: string;
  /** The figure off the reference card. */
  base: number;
  /** The figure as it stands. */
  value: number;
  room: number;
  /** The number written after the cells. */
  text: string;
  /** For the pointer: where the difference from the reference card comes from. */
  note?: string;
  /** Health is a share of a whole rather than a count of points: its cells show how full it is. */
  share?: true;
}

/**
 * A figure counted in points. The cells up to the reference card are the unit's own;
 * anything the ground adds on top of that carries on after them in another colour, and
 * anything the ground takes off is left as a gap where it would have been.
 */
function points(label: string, base: number, value: number, room: number, suffix = '', shown?: string): Meter {
  const text = shown ?? `${value}${suffix}${base === value ? '' : `(${signed(value - base)})`}`;
  return { label, base, value, room, text, ...(base === value || shown ? {} : { note: `${label} ${base}，地形 ${signed(value - base)}` }) };
}

/** Health, as a row of cells filled to the share of it that is left. */
function health(hp: number, max: number): Meter {
  return { label: '生命', base: max, value: hp, room: ROOM.health, text: `${hp}/${max}`, share: true };
}

/** A figure as it is drawn: its cells, then its number. */
function meterEl(m: Meter): HTMLElement {
  const cells = h('span', { class: 'cells' });
  // Health has no whole number of cells to show: fill as many as the share left comes to, never none while there is any left.
  const filled = m.share ? Math.max(m.value > 0 ? 1 : 0, Math.round((m.value / m.base) * m.room)) : m.value;
  for (let i = 1; i <= m.room; i++) {
    let kind = 'void';
    if (m.share) kind = i > filled ? 'off' : `hp${m.value / m.base > 0.55 ? '' : m.value / m.base > 0.28 ? ' warn' : ' low'}`;
    else if (i <= m.value) kind = i > m.base ? 'up' : '';
    else if (i <= m.base) kind = 'down';
    cells.append(h('i', { class: kind }));
  }
  return h('div', { class: 'meter', title: m.note ?? '' }, h('span', { class: 'mlabel' }, m.label), cells, h('b', { class: 'mvalue' }, m.text));
}

/** The figures of one card, a row at a time: two to a row, so that life sits over defence and attack over range. */
function metersEl(rows: Meter[][]): HTMLElement {
  const single = rows.length === 1 || rows[0].length === 1;
  return h('div', { class: single ? 'meters one' : 'meters' }, ...rows.flat().map(meterEl));
}

function unitStats(uk: UnitKey): HTMLElement[] {
  const d = UNITS[uk];
  return [
    stat('攻', `${d.attack}${d.shots > 1 ? `×${d.shots}` : ''}`),
    stat('防', String(d.defense)),
    stat('血', String(d.hp)),
    stat('射程', String(d.range)),
    stat('移动', String(d.move)),
  ];
}

function unitTags(uk: UnitKey): HTMLElement[] {
  const d = UNITS[uk];
  const out: HTMLElement[] = [];
  if (d.pierce) out.push(h('span', { class: 'tag' }, '破甲'));
  if (d.unitClass === 'air') out.push(h('span', { class: 'tag' }, '空中单位'));
  else if (d.canHit.includes('air')) out.push(h('span', { class: 'tag' }, '可对空'));
  return out;
}

interface Described {
  color: string;
  title: string;
  art: string;
  /** The small labels after the name: what it is, and what it can still do this turn. */
  tags: HTMLElement[];
  /** Its figures as rows of cells. */
  meters?: Meter[][];
  /** What cannot be counted in cells, in words. */
  stats: HTMLElement[];
  /** The ground a unit stands on and what it does for it. */
  terrain: HTMLElement | null;
  help: string;
}

/** The ground a unit stands on, and what it does for that unit in particular. */
function groundText(ground: TerrainDef, family: UnitFamily): string {
  const e = ground.effects[family];
  return e ? `${ground.name}：${effectText(e)}` : `${ground.name}：无加成`;
}

/** What a kind of ground does to one kind of unit: "攻 +2 · 防 −2". */
function effectText(e: TerrainEffect): string {
  return [
    e.attack !== undefined ? `攻 ${signed(e.attack)}` : null,
    e.defense !== undefined ? `防 ${signed(e.defense)}` : null,
    e.range !== undefined ? `射程 ${signed(e.range)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Whose home zone a tile lies in, if any. */
function zoneOwner(s: GameState, t: Pt): PlayerState | undefined {
  return s.players.find((p) => {
    const c = s.corners[p.corner];
    const size = zoneSize(p);
    return Math.abs(t.x - c.ox) < size && Math.abs(t.y - c.oy) < size;
  });
}

function describeTile(s: GameState, t: Pt): Described {
  const ground = TERRAIN[terrainAt(s, t.x, t.y)];
  const owner = zoneOwner(s, t);
  const tags: HTMLElement[] = [];
  if (owner) tags.push(h('span', { class: 'tag', style: `color:${owner.color}` }, `${owner.name} 的领地`));
  const node = s.nodes.find((n) => n.x === t.x && n.y === t.y);
  if (node) tags.push(h('span', { class: 'tag good' }, `${RESOURCES[node.resource].name}资源点`));
  const stats: HTMLElement[] = [];
  if (ground.effects.soldier) stats.push(stat('士兵', effectText(ground.effects.soldier)));
  if (ground.effects.tank) stats.push(stat('坦克', effectText(ground.effects.tank)));
  stats.push(stat('通行', ground.blocks.length ? '士兵、运输车不能进入，坦克可涉水' : '所有单位可以通过'));
  const here: string[] = [];
  for (const p of s.players) {
    for (const u of p.units) if (u.x === t.x && u.y === t.y) here.push(`${p.name} 的${UNITS[u.key].name}${UNITS[u.key].unitClass === 'air' ? '（空中）' : ''}`);
    for (const b of p.buildings) {
      if (b.w > 0 && t.x >= b.x && t.x < b.x + b.w && t.y >= b.y && t.y < b.y + b.h) here.push(`${p.name} 的${BUILDINGS[b.key].levels[b.level - 1].name}`);
    }
  }
  for (const a of s.aliens) if (a.x === t.x && a.y === t.y) here.push(`外星人${ALIENS[a.key].name}`);
  if (s.brood.some((b) => b.x === t.x && b.y === t.y)) here.push(SPIDERLING.name);
  return {
    color: owner?.color ?? '#cbd5e1',
    title: `地块 (${t.x}, ${t.y}) · ${ground.name}`,
    art: terrainIcon(terrainAt(s, t.x, t.y)),
    tags,
    stats,
    terrain: null,
    help: here.length ? `这里：${here.join('、')}` : '空地',
  };
}

/** One of the aliens, or one of the small spiders. */
function describeBeast(s: GameState, ref: EntityRef): Described | null {
  if (ref.kind === 'spider') {
    if (!spiderById(s, ref.id)) return null;
    return {
      color: '#e879f9',
      title: `外星人 ${SPIDERLING.name}`,
      art: spiderIcon(),
      tags: [h('span', { class: 'tag warn' }, `${ALIENS.kuide.name}孵化的`)],
      meters: [
        [health(SPIDERLING.hp, SPIDERLING.hp), points('攻击', SPIDERLING.attack, SPIDERLING.attack, ROOM.attack)],
        [points('防御', SPIDERLING.defense, SPIDERLING.defense, ROOM.defense)],
      ],
      stats: [],
      terrain: null,
      help: `会随机攻击够得着的目标。踩死它得 ${SCORE_SPIDER} 积分和一点资源。`,
    };
  }
  const a = alienById(s, ref.id);
  if (!a) return null;
  const d = ALIENS[a.key];
  return {
    color: d.color,
    title: `外星人 ${d.name} · ${d.look}`,
    art: alienIcon(a.key),
    tags: [h('span', { class: 'tag warn' }, `第 ${a.arrived} 回合降临`)],
    meters: [
      [health(a.hp, d.hp), points('攻击', d.attack, d.attack, ROOM.attack, d.shots > 1 ? `×${d.shots}` : '')],
      [points('防御', d.defense, d.defense, ROOM.defense), points('射程', d.range, d.range, ROOM.range)],
    ],
    stats: [stat('移动', d.teleports ? '瞬移' : String(d.move))],
    terrain: null,
    help: `${d.desc} 击败可得 ${costText(d.reward)}；积分 ${d.bounty} 按伤害分配，最后一击另加 ${SCORE_LAST_HIT}。`,
  };
}

function describe(s: GameState, ref: EntityRef, mine: boolean): Described | null {
  if (ref.kind === 'alien' || ref.kind === 'spider') return describeBeast(s, ref);
  if (ref.kind === 'unit') {
    const hit = unitById(s, ref.id);
    if (!hit) return null;
    const d = UNITS[hit.unit.key];
    const st = statsOf(s, hit.unit);
    const ground = TERRAIN[terrainAt(s, hit.unit.x, hit.unit.y)];
    const tags: HTMLElement[] = [];
    if (mine) {
      tags.push(h('span', { class: hit.unit.moveUsed ? 'tag' : 'tag good' }, hit.unit.moveUsed ? '已移动' : '可移动'));
      tags.push(h('span', { class: hit.unit.attackUsed ? 'tag' : 'tag good' }, hit.unit.attackUsed ? '已攻击' : '可攻击'));
    }
    return {
      color: hit.owner.color,
      title: `${d.name} · ${hit.owner.name}`,
      art: unitIcon(hit.unit.key),
      // What it can still do this turn comes first; what it is comes after.
      tags: [...tags, ...unitTags(hit.unit.key)],
      meters:
        d.attack > 0
          ? [
              [health(hit.unit.hp, d.hp), points('攻击', d.attack, st.attack, ROOM.attack, d.shots > 1 ? `×${d.shots}` : '')],
              [points('防御', d.defense, st.defense, ROOM.defense), points('射程', d.range, st.range, ROOM.range)],
            ]
          : undefined,
      stats: d.attack > 0 ? [] : [stat('作用', '每台每次采集 100 资源')],
      terrain: h('span', { class: 'terrain', title: ground.rule }, `地形 ${groundText(ground, d.family)}`),
      help: mine ? '点击蓝色格子移动，点击红色目标攻击。' : '',
    };
  }
  const hit = buildingById(s, ref.id);
  if (!hit) return null;
  const d = BUILDINGS[hit.building.key];
  const lv = d.levels[hit.building.level - 1];
  const tags: HTMLElement[] = [];
  if (d.needsPower && !hit.building.powered) tags.push(h('span', { class: 'tag warn' }, '断电'));
  const armed = lv.attack > 0;
  if (mine && armed) tags.push(h('span', { class: hit.building.fired ? 'tag' : 'tag good' }, hit.building.fired ? '本回合已开火' : '可以开火'));
  if (armed) tags.push(h('span', { class: 'tag' }, d.canHit.includes('ground') ? (d.canHit.includes('air') ? '地面与空中都打' : '只打地面') : '只打空中'));
  const net = hit.building.key === 'defenseNet';
  const life = health(hit.building.hp, hit.building.maxHp);
  return {
    color: hit.owner.color,
    title: `${lv.name} · ${hit.owner.name}`,
    art: buildingIcon(hit.building.key, hit.building.level),
    tags,
    meters: net
      ? [[points('基地防御', lv.defense, lv.defense, ROOM.defense, '', `+${lv.defense}`)]]
      : armed
        ? [
            [life, points('攻击', lv.attack, lv.attack, ROOM.attack)],
            [points('射程', lv.range, lv.range, ROOM.range)],
          ]
        : [[life]],
    stats: [],
    terrain: null,
    help: mine && lv.attack > 0 ? '点击射程内的红色目标开火。' : '',
  };
}

/** Everything around the canvas: top bar, sidebar, log and the card of whatever is selected. */
export class Hud {
  constructor(
    private top: HTMLElement,
    private side: HTMLElement,
    private logEl: HTMLElement,
    private cardEl: HTMLElement,
    /** The gathering panel, which stands beside the sidebar only while the player has an action point to spend. */
    private harvestEl: HTMLElement,
    private a: HudActions,
  ) {}

  /** Says whether the gathering panel is up, so the picture can make room for it. */
  render(s: GameState, ctx: HudCtx): boolean {
    this.topbar(s, ctx);
    this.sidebar(s, ctx);
    this.log(s);
    this.card(s, ctx);
    return this.harvest(s, ctx);
  }

  /**
   * Gathering, on its own beside the sidebar: the player reads what a unit
   * costs on one side and picks a resource to fetch on the other. It is only
   * put up for a human player with an action point to spend; nobody else can gather.
   */
  private harvest(s: GameState, ctx: HudCtx): boolean {
    const el = this.harvestEl;
    const p = s.phase === 'player' ? s.players[s.currentPlayer] : null;
    const up = ctx.humanTurn && !!p && p.ap > 0;
    el.classList.toggle('hidden', !up);
    if (!up || !p) return false;
    const per = HARVEST_YIELD * p.trucks;
    const why = p.trucks < 1 ? '没有运输车：先在加工工厂生产一台' : '';
    el.replaceChildren(
      h(
        'div',
        { class: 'hp-head' },
        h('b', {}, '采集'),
        h('span', { class: 'pips', title: `行动点 ${p.ap}` }, ...[0, 1, 2].map((i) => h('i', { class: i < p.ap ? 'on' : '' }))),
        h('small', {}, `行动点 ${p.ap}`),
      ),
      h(
        'div',
        { class: 'harvest' },
        ...RES_KEYS.map((k) => {
          const b = h(
            'button',
            { disabled: p.trucks < 1, title: why || `花 1 行动点采集${RESOURCES[k].name}` },
            h('span', { class: 'ico', style: `color:${RESOURCES[k].color}`, html: icon(k) }),
            h('span', { class: 'lbl' }, h('b', {}, RESOURCES[k].name), h('small', {}, `现有 ${fmt(p.resources[k])}`)),
            h('span', { class: 'gain' }, `+${fmt(per)}`),
          );
          b.onclick = () => this.a.harvest(k);
          return b;
        }),
      ),
      h('p', { class: 'hint' }, why || `每点行动点：${p.trucks} 台运输车全部出动，每台运回 ${HARVEST_YIELD}`),
    );
    return true;
  }

  private topbar(s: GameState, ctx: HudCtx): void {
    const el = this.top;
    el.replaceChildren();
    const phase: Record<GameState['phase'], string> = {
      roundStart: '准备掷骰子',
      dice: '掷骰子',
      aliens: '外星人行动中',
      player: `${s.players[s.currentPlayer]?.name ?? ''} 的回合`,
      gameover: '战斗结束',
    };
    el.append(
      h('div', { class: 'brand' }, h('b', {}, 'NC'), h('i', {}, 'WorldBattle')),
      h('div', { class: 'round' }, h('span', {}, `第 ${Math.min(s.turn, s.totalTurns)} / ${s.totalTurns} 回合`), h('span', { class: 'phase' }, phase[s.phase])),
      h(
        'div',
        { class: 'dice-chips' },
        ...s.dice
          .filter((d) => s.players[d.player].alive)
          .map((d) =>
            h(
              'span',
              { class: 'chip', title: `${s.players[d.player].name}：${d.rolls.map((r) => `${r} 点`).join(' → ')}，行动顺序第 ${d.rank + 1}` },
              h('span', { class: 'dot', style: `--c:${s.players[d.player].color}` }),
              s.players[d.player].name,
              h('span', { class: 'roll', title: '点数' }, String(d.rolls[0])),
              h('b', {}, d.ap > 0 ? `行动点 ${d.ap}` : '无行动点'),
            ),
          ),
      ),
      h('span', { class: 'spacer' }),
    );
    // Tapped with fingers there is no Esc to speak of: the help only names what can be pressed.
    const touch = touchOnly();
    const speed = h('button', { class: 'btn small ghost', title: '电脑玩家行动的速度' }, `速度 ×${ctx.speed}`);
    speed.onclick = this.a.toggleSpeed;
    const home = h('button', { class: 'btn small ghost', title: '把镜头移回能看见整张地图的角度' }, '全局视角');
    home.onclick = this.a.overview;
    const rules = h('button', { class: 'btn small ghost', title: `暂停游戏并打开玩法说明${touch ? '' : '（Esc 菜单里也有）'}` }, '玩法说明');
    rules.onclick = this.a.showRules;
    // Saving, starting over and leaving all live behind this one button.
    const menu = h('button', { class: 'btn small ghost', title: `暂停游戏：保存、重新开始或退出${touch ? '' : '（Esc）'}` }, h('span', { class: 'btn-ico', html: glyph('menu') }), '菜单', touch ? null : h('kbd', {}, 'Esc'));
    menu.onclick = this.a.menu;
    el.append(speed, home, rules, menu);
  }

  private sidebar(s: GameState, ctx: HudCtx): void {
    const el = this.side;
    const prevScroll = el.querySelector('.side-scroll')?.scrollTop ?? 0;
    el.replaceChildren();
    const p = s.phase === 'player' ? s.players[s.currentPlayer] : null;
    if (!p) {
      el.append(h('div', { class: 'side-empty' }, s.phase === 'gameover' ? '对局已结束' : s.phase === 'aliens' ? '外星人正在行动…' : '掷骰子决定行动点…'));
      return;
    }
    const mine = ctx.humanTurn;
    const hq = hqOf(p);
    const dark = p.buildings.filter((b) => !b.powered).length;
    const hp = hq?.hp ?? 0;
    const maxHp = hq?.maxHp ?? 20;
    const net = netDefense(p);
    el.append(
      h(
        'div',
        { class: 'side-head' },
        h('span', { class: 'dot', style: `--c:${p.color}` }),
        h('span', { class: 'who' }, `${p.name} `, h('span', { class: `tag${p.kind === 'human' ? ' good' : ''}` }, p.kind === 'human' ? '人类' : '电脑')),
        h('span', { class: 'pips', title: `行动点 ${p.ap}` }, ...[0, 1, 2].map((i) => h('i', { class: i < p.ap ? 'on' : '' }))),
      ),
      h(
        'div',
        { class: 'side-stats' },
        h(
          'div',
          { class: 'stat' },
          h('label', {}, ico('hp'), '基地生命'),
          h('b', {}, `${hp} / ${maxHp}`),
          h('div', { class: 'hpbar' }, h('i', { class: hp / maxHp < 0.35 ? 'low' : '', style: `width:${Math.max(0, (hp / maxHp) * 100)}%` })),
        ),
        h('div', { class: 'stat', title: '基地内所有建筑每次受击抵扣的攻击力' }, h('label', {}, ico('def'), '防御网'), h('b', {}, net > 0 ? `+${net}` : '无')),
        h('div', { class: 'stat', title: '存活战斗单位与通电防御建筑的攻击力总和，生命值相同时据此决胜' }, h('label', {}, ico('atk'), '攻击力'), h('b', {}, String(attackPower(p)))),
        h(
          'div',
          { class: 'stat', title: dark ? `有 ${dark} 座建筑断电，建造发电站可恢复` : '每座发电站供 3 座建筑，按建造顺序分配' },
          h('label', {}, ico('power', '#facc15'), '电力'),
          h('b', { class: dark ? 'bad' : '' }, `${p.powerUsed}/${p.powerCap}`),
        ),
      ),
      h(
        'div',
        { class: 'res' },
        ...RES_KEYS.map((k) =>
          h('div', { title: RESOURCES[k].hint }, ico(k, RESOURCES[k].color), h('span', {}, fmt(p.resources[k])), h('small', {}, RESOURCES[k].name)),
        ),
      ),
    );
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...TABS.map(([id, label]) => {
        const b = h('button', { class: ctx.tab === id ? 'on' : '' }, label);
        b.onclick = () => this.a.setTab(id);
        return b;
      }),
    );
    const scroll = h('div', { class: 'side-scroll' }, this.panel(s, p, ctx));
    // Reading the rules must not hide the way to end the turn.
    const foot = h('div', { class: 'side-foot' });
    if (p) {
      if (mine) {
        const end = h('button', { class: 'btn primary' }, '结束回合');
        end.onclick = this.a.endTurn;
        foot.append(end);
        if (p.ap > 0) foot.append(h('div', { class: 'note' }, h('div', {}, `剩余行动点 ${p.ap}`), h('div', {}, `可用${touchOnly() ? '“下一个待命”' : 'Tab'}切换单位`)));
      } else {
        foot.append(h('div', { class: 'note', style: 'flex:1' }, p.kind === 'ai' ? '电脑玩家行动中…' : '等待其他玩家…'));
      }
    }
    el.append(tabs, scroll, foot);
    scroll.scrollTop = prevScroll;
    // The producer that was just clicked on the board: bring its line into view.
    if (ctx.focusProducer && ctx.scrollProducer) {
      const line = scroll.querySelector<HTMLElement>('.group.focus');
      if (line) scroll.scrollTop = line.offsetTop - scroll.offsetTop - 8;
    }
  }

  /** The picture of a unit or building that goes at the left of its row. */
  private row(art: string, body: HTMLElement, ...tail: HTMLElement[]): HTMLElement {
    return h('div', { class: 'row' }, iconBox(art), body, ...tail);
  }

  private panel(s: GameState, p: PlayerState, ctx: HudCtx): HTMLElement {
    const mine = ctx.humanTurn;
    switch (ctx.tab) {
      case 'build': {
        const placing = ctx.placing;
        const box = h('div', {});
        if (placing) {
          const cancel = h('button', { class: 'btn small' }, '取消');
          cancel.onclick = this.a.cancelPlace;
          // A mouse sees the footprint before it clicks; a finger has to tap first, so it confirms with a second tap.
          const how = touchOnly()
            ? ctx.aimed
              ? '再点一次这里确认放置；点别的格子换个位置。'
              : '先点一下高亮格子看位置（绿色可行，红色不行），再点一次确认放置。'
            : '点击自己领地里的高亮格子放置（绿色可行，红色不行）。';
          box.append(
            h(
              'div',
              { class: 'placing placing-bar' },
              iconBox(buildingIcon(placing, 1)),
              h('div', { class: 'info' }, h('b', {}, `正在放置：${BUILDINGS[placing].levels[0].name}`), h('div', { class: 'hint' }, how)),
              cancel,
            ),
          );
        } else {
          box.append(h('p', { class: 'hint' }, '选一座建筑，再点击自己领地里的格子放置。建造立即完成；需要电力的建筑按建造顺序分配电力，超出供电数的会停机。'));
        }
        for (const k of BUILDABLE) {
          const d = BUILDINGS[k];
          const err = canBuild(s, p, k);
          const on = placing === k;
          const label = on ? '选择位置…' : d.w === 0 ? '建造' : countBuilding(p, k) > 0 && d.maxCount ? '已建造' : '放置';
          const btn = h('button', { class: `btn small${on ? ' primary' : ''}`, disabled: !mine || (!!err && !on), title: err ?? '' }, label);
          btn.onclick = () => this.a.build(k);
          const body = h(
            'div',
            { class: 'info' },
            h('div', { class: 'name' }, d.levels[0].name, h('span', { class: 'tag' }, effectOf(k))),
            h('div', { class: 'desc' }, d.desc),
            h('div', { class: 'sub' }, costChips(d.levels[0].cost, p.resources)),
          );
          const row = this.row(buildingIcon(k, 1), body, btn);
          if (err && !on) row.classList.add('off');
          if (on) row.classList.add('placing');
          box.append(row);
        }
        return box;
      }
      case 'produce': {
        const box = h('div', {}, h('p', { class: 'hint' }, '只列出已建成的建筑能生产的单位。新单位可以立即行动；产量与停机位按通电的建筑数量计算。'));
        // A building the player has not put up says nothing: its units are not on offer at all.
        const built = PRODUCERS.filter((bk) => countBuilding(p, bk) > 0);
        if (!built.length) box.append(h('p', { class: 'hint' }, '还没有能生产单位的建筑。先在“建造”页建一座加工工厂、军营、军工厂或军事机场。'));
        for (const bk of built) {
          const d = BUILDINGS[bk];
          const total = countBuilding(p, bk);
          const on = p.buildings.filter((b) => b.key === bk && b.powered).length;
          const made = p.producedThisTurn[bk] ?? 0;
          const status = on === 0 ? '全部断电' : d.perTurnCap ? `本回合 ${made}/${d.perTurnCap * on}` : `${total} 座`;
          // The clicked producer's line is lit for as long as it is looked at; it flashes only on the click itself.
          const focus = ctx.focusProducer === bk;
          box.append(h('div', { class: focus ? `group focus${ctx.scrollProducer ? ' flash' : ''}` : 'group' }, iconBox(buildingIcon(bk, 1)), d.levels[0].name, h('small', {}, status)));
          for (const uk of PRODUCED_UNITS[bk]) {
            const ud = UNITS[uk];
            const err = canProduce(s, p, uk);
            let count = '';
            if (uk === 'truck') count = `已有 ${p.trucks}/${TRUCKS_PER_FACTORY * Math.max(1, total)}`;
            else if (d.capPerBuilding) count = `已有 ${p.units.filter((u) => u.key === uk).length}/${d.capPerBuilding * on}`;
            const btn = h('button', { class: 'btn small', disabled: !mine || !!err, title: err ?? '' }, '生产');
            btn.onclick = () => this.a.produce(uk);
            box.append(
              this.row(
                unitIcon(uk),
                h(
                  'div',
                  { class: 'info' },
                  h('div', { class: 'name', title: ud.desc }, ud.name, ...unitTags(uk)),
                  h('div', { class: 'sub' }, ...(uk === 'truck' ? [h('span', {}, '每台每次采集运回 100 资源')] : unitStats(uk))),
                  h('div', { class: 'sub' }, costChips(ud.cost, p.resources), count ? h('span', {}, count) : null),
                ),
                btn,
              ),
            );
          }
        }
        return box;
      }
      case 'structures': {
        const box = h('div', {});
        if (p.buildings.filter((b) => !b.powered).length > 0) box.append(h('p', { class: 'hint', style: 'color:#fca5a5' }, `有 ${p.buildings.filter((b) => !b.powered).length} 座建筑断电。建造发电站（供电 +3）可以恢复。`));
        box.append(h('p', { class: 'hint' }, `电力 ${p.powerUsed}/${p.powerCap}，按建造顺序分配。炮台与防空炮在敌人攻击基地建筑时各反击一次。`));
        for (const b of [...p.buildings].reverse()) {
          const d = BUILDINGS[b.key];
          const lv = d.levels[b.level - 1];
          const net = b.key === 'defenseNet';
          const body = h(
            'div',
            { class: 'info' },
            h(
              'div',
              { class: 'name' },
              lv.name,
              b.level > 1 ? h('span', { class: 'tag good' }, `${b.level} 级`) : null,
              d.needsPower && !b.powered ? h('span', { class: 'tag warn' }, '断电') : null,
              b.key === 'hq' ? h('span', { class: 'tag' }, '被摧毁即战败') : null,
            ),
            h(
              'div',
              { class: 'sub' },
              net
                ? h('span', {}, `基地建筑每次受击抵扣 ${lv.defense} 点攻击力${b.powered ? '' : '（断电，不生效）'}`)
                : h('span', { class: 'cost' }, ico('hp', '#4ade80'), `${b.hp}/${b.maxHp}`),
            ),
          );
          const row = this.row(buildingIcon(b.key, b.level), body);
          // The rung above, for as long as there is one: the net has four, everything else at most one.
          const next = nextLevelOf(b);
          if (next) {
            const err = canUpgrade(p, b.id);
            const gain = net ? `抵扣 ${lv.defense} → ${next.defense} 点` : b.key === 'hq' ? '领地向战场方向扩大一圈' : `攻击 ${lv.attack} → ${next.attack} · 射程 ${lv.range} → ${next.range}`;
            body.append(h('div', { class: 'sub' }, h('span', {}, `升级为${next.name}：${gain}`), costChips(next.cost, p.resources)));
            const btn = h('button', { class: 'btn small', disabled: !mine || !!err, title: err ?? '' }, '升级');
            btn.onclick = () => this.a.upgrade(b.id);
            row.append(btn);
          }
          box.append(row);
        }
        return box;
      }
    }
  }

  private log(s: GameState): void {
    const el = this.logEl;
    el.replaceChildren();
    for (const e of s.log.slice(-5)) {
      const p = e.player !== undefined ? s.players[e.player] : null;
      el.append(h('div', { class: `log-line ${e.tone}`, style: p ? `border-left-color:${p.color}` : '' }, e.text));
    }
  }

  private card(s: GameState, ctx: HudCtx): void {
    const el = this.cardEl;
    el.replaceChildren();
    const ref = ctx.selection ?? ctx.inspect;
    const info = ref ? describe(s, ref, ctx.selection !== null && ctx.humanTurn) : ctx.tile ? describeTile(s, ctx.tile) : null;
    if (!info) return;
    const mine = ctx.selection !== null && ctx.humanTurn;
    const body = h(
      'div',
      { class: 'card-body' },
      h('div', { class: 'head' }, h('div', { class: 'title' }, h('span', { class: 'dot', style: `--c:${info.color}` }), info.title), info.tags.length ? h('div', { class: 'tags' }, ...info.tags) : null),
      info.meters ? metersEl(info.meters) : null,
      info.stats.length ? h('div', { class: 'stats' }, ...info.stats) : null,
    );
    // Under the figures: the ground under its feet, how to command it, and the way out.
    const actions: HTMLElement[] = [];
    if (mine) {
      const touch = touchOnly();
      const next = h('button', { class: 'btn small', title: touch ? '轮到下一个还能行动的单位' : '快捷键 Tab' }, '下一个待命');
      next.onclick = this.a.nextUnit;
      const cancel = h('button', { class: 'btn small ghost' }, '取消');
      cancel.onclick = this.a.deselect;
      actions.push(next, cancel);
    }
    const notes = [info.terrain, info.help ? h('div', { class: 'help' }, info.help) : null];
    if (!mine && !ctx.humanTurn && ref) notes.push(h('div', { class: 'help' }, `点击空地关闭 · ${touchOnly() ? '“菜单”' : 'Esc'}打开暂停菜单`));
    if (notes.some(Boolean) || actions.length) body.append(h('div', { class: 'card-foot' }, h('div', { class: 'notes' }, ...notes), actions.length ? h('div', { class: 'card-actions' }, ...actions) : null));
    el.append(h('div', { class: 'card' }, iconBox(info.art), body));
  }
}

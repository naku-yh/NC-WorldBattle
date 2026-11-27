import { ALIENS, BUILDABLE, BUILDINGS, HARVEST_YIELD, PRODUCED_UNITS, RESOURCES, SCORE_LAST_HIT, SCORE_SPIDER, SPIDERLING, TERRAIN, TRUCKS_PER_FACTORY, UNITS } from '../game/data';
import { alienById, attackPower, buildingById, canBuild, canProduce, canUpgrade, countBuilding, hqOf, netDefense, spiderById, statsOf, unitById } from '../game/engine';
import { terrainAt, zoneSize } from '../game/board';
import type { BuildingKey, Cost, EntityRef, GameState, PlayerState, Pt, ResourceKey, Resources, TerrainDef, TerrainEffect, UnitFamily, UnitKey } from '../game/types';
import { fmt, h } from './dom';
import { alienIcon, buildingIcon, glyph, icon, iconBox, spiderIcon, terrainIcon, unitIcon, type IconName } from './icons';
import { costText, effectOf, rulesPanel } from './rules';

export type Tab = 'harvest' | 'build' | 'produce' | 'structures' | 'rules';
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
  ['harvest', '采集'],
  ['build', '建造'],
  ['produce', '生产'],
  ['structures', '建筑'],
  ['rules', '玩法'],
];
const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

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

/** "攻 8" style labelled value; clearer than a row of tiny icons. */
function stat(label: string, text: string): HTMLElement {
  return h('span', { class: 'stat-chip' }, h('i', {}, label), text);
}

/** A stat as it stands, with the terrain's share spelt out when there is one: "攻 10 (+2)". */
function tuned(label: string, base: number, value: number, suffix = ''): HTMLElement {
  if (base === value) return stat(label, `${value}${suffix}`);
  return stat(label, `${value}${suffix}（${value > base ? '+' : '−'}${Math.abs(value - base)}）`);
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
  tags: HTMLElement[];
  stats: HTMLElement[];
  /** The ground a unit stands on and what it does for it. */
  terrain: HTMLElement | null;
  help: string;
}

/** "+2" or "−2". */
const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

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
      stats: [stat('攻击', String(SPIDERLING.attack)), stat('防御', String(SPIDERLING.defense)), stat('生命', String(SPIDERLING.hp))],
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
    stats: [stat('攻击', String(d.attack)), stat('防御', String(d.defense)), stat('生命', `${a.hp}/${d.hp}`), d.teleports ? stat('移动', '瞬移') : stat('射程', String(d.range))],
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
      tags: [...unitTags(hit.unit.key), ...tags],
      stats: d.attack > 0 ? [stat('生命', `${hit.unit.hp}/${d.hp}`), tuned('攻', d.attack, st.attack, d.shots > 1 ? `×${d.shots}` : ''), tuned('防', d.defense, st.defense), tuned('射程', d.range, st.range)] : [stat('生命', '—'), stat('作用', '每台每次采集 100 资源')],
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
  if (mine && lv.attack > 0) tags.push(h('span', { class: hit.building.fired ? 'tag' : 'tag good' }, hit.building.fired ? '本回合已开火' : '可以开火'));
  const stats = hit.building.key === 'defenseNet' ? [stat('基地防御', `+${lv.defense}`)] : [stat('生命', `${hit.building.hp}/${hit.building.maxHp}`)];
  if (lv.attack > 0) stats.push(stat('攻击', String(lv.attack)), stat('射程', String(lv.range)), stat('目标', d.canHit.includes('air') ? (d.canHit.includes('ground') ? '地面与空中' : '仅空中') : '仅地面'));
  return {
    color: hit.owner.color,
    title: `${lv.name} · ${hit.owner.name}`,
    art: buildingIcon(hit.building.key, hit.building.level),
    tags,
    stats,
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
    private a: HudActions,
  ) {}

  render(s: GameState, ctx: HudCtx): void {
    this.topbar(s, ctx);
    this.sidebar(s, ctx);
    this.log(s);
    this.card(s, ctx);
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
    const speed = h('button', { class: 'btn small ghost', title: '电脑玩家行动的速度' }, `速度 ×${ctx.speed}`);
    speed.onclick = this.a.toggleSpeed;
    const home = h('button', { class: 'btn small ghost', title: '把镜头移回能看见整张地图的角度' }, '全局视角');
    home.onclick = this.a.overview;
    const rules = h('button', { class: 'btn small ghost', title: '右侧栏的“玩法”页' }, '玩法说明');
    rules.onclick = this.a.showRules;
    // Saving, starting over and leaving all live behind this one button.
    const menu = h('button', { class: 'btn small ghost', title: '暂停游戏：保存、重新开始或退出（Esc）' }, h('span', { class: 'btn-ico', html: glyph('menu') }), '菜单', h('kbd', {}, 'Esc'));
    menu.onclick = this.a.menu;
    el.append(speed, home, rules, menu);
  }

  private sidebar(s: GameState, ctx: HudCtx): void {
    const el = this.side;
    const prevScroll = el.querySelector('.side-scroll')?.scrollTop ?? 0;
    el.replaceChildren();
    const rules = ctx.tab === 'rules';
    const p = s.phase === 'player' ? s.players[s.currentPlayer] : null;
    if (!p && !rules) {
      el.append(h('div', { class: 'side-empty' }, s.phase === 'gameover' ? '对局已结束' : s.phase === 'aliens' ? '外星人正在行动…' : '掷骰子决定行动点…'));
      return;
    }
    const mine = ctx.humanTurn;
    if (p) {
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
    } else {
      el.append(h('div', { class: 'side-head' }, h('span', { class: 'who' }, '玩法说明'), h('span', { class: 'summary' }, s.phase === 'gameover' ? '对局已结束' : s.phase === 'aliens' ? '外星人正在行动…' : '掷骰子决定行动点…')));
    }
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...TABS.map(([id, label]) => {
        const b = h('button', { class: ctx.tab === id ? 'on' : '' }, label);
        b.onclick = () => this.a.setTab(id);
        return b;
      }),
    );
    const scroll = h('div', { class: 'side-scroll' }, rules ? rulesPanel() : this.panel(s, p!, ctx));
    // Reading the rules must not hide the way to end the turn.
    const foot = h('div', { class: 'side-foot' });
    if (p) {
      if (mine) {
        const end = h('button', { class: 'btn primary' }, '结束回合');
        end.onclick = this.a.endTurn;
        foot.append(end);
        if (p.ap > 0) foot.append(h('div', { class: 'note' }, h('div', {}, `剩余行动点 ${p.ap}`), h('div', {}, '可用Tab切换单位')));
      } else {
        foot.append(h('div', { class: 'note', style: 'flex:1' }, p.kind === 'ai' ? '电脑玩家行动中…' : '等待其他玩家…'));
      }
    }
    el.append(tabs, scroll, foot);
    scroll.scrollTop = prevScroll;
  }

  /** The picture of a unit or building that goes at the left of its row. */
  private row(art: string, body: HTMLElement, ...tail: HTMLElement[]): HTMLElement {
    return h('div', { class: 'row' }, iconBox(art), body, ...tail);
  }

  private panel(s: GameState, p: PlayerState, ctx: HudCtx): HTMLElement {
    const mine = ctx.humanTurn;
    switch (ctx.tab) {
      case 'rules':
        return rulesPanel();
      case 'harvest': {
        const per = HARVEST_YIELD * p.trucks;
        const can = mine && p.ap > 0 && p.trucks > 0;
        const why = !mine ? '等待你的回合' : p.ap < 1 ? '行动点不足' : p.trucks < 1 ? '没有运输车' : '';
        const box = h('div', { class: 'harvest' });
        for (const k of RES_KEYS) {
          const b = h(
            'button',
            { disabled: !can, title: why },
            h('span', { class: 'ico', style: `color:${RESOURCES[k].color}`, html: icon(k) }),
            h('span', { class: 'lbl' }, h('b', {}, RESOURCES[k].name), h('small', {}, `现有 ${fmt(p.resources[k])}`)),
            h('span', { class: 'gain' }, `+${fmt(per)}`),
          );
          b.onclick = () => this.a.harvest(k);
          box.append(b);
        }
        return h(
          'div',
          {},
          h('p', { class: 'hint' }, '每消耗 1 个行动点，全部运输车出动采集一种资源，每台运回 100。'),
          box,
          h('p', { class: 'hint' }, `行动点 ${p.ap} · 运输车 ${p.trucks} 台（每座加工工厂限 ${TRUCKS_PER_FACTORY} 台）`),
          mine && p.ap === 0 ? h('p', { class: 'hint' }, '行动点已用完。建造、生产和指挥部队不消耗行动点。') : null,
        );
      }
      case 'build': {
        const placing = ctx.placing;
        const box = h('div', {});
        if (placing) {
          const cancel = h('button', { class: 'btn small' }, '取消');
          cancel.onclick = this.a.cancelPlace;
          box.append(
            h(
              'div',
              { class: 'placing placing-bar' },
              iconBox(buildingIcon(placing, 1)),
              h('div', { class: 'info' }, h('b', {}, `正在放置：${BUILDINGS[placing].levels[0].name}`), h('div', { class: 'hint' }, '点击自己领地里的高亮格子放置（绿色可行，红色不行）。')),
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
        const box = h('div', {}, h('p', { class: 'hint' }, '新单位可以立即行动。产量与停机位按通电的建筑数量计算。'));
        for (const bk of ['factory', 'barracks', 'warFactory', 'airport'] as const) {
          const d = BUILDINGS[bk];
          const total = countBuilding(p, bk);
          const on = p.buildings.filter((b) => b.key === bk && b.powered).length;
          const made = p.producedThisTurn[bk] ?? 0;
          const status = total === 0 ? '未建造' : on === 0 ? '全部断电' : d.perTurnCap ? `本回合 ${made}/${d.perTurnCap * on}` : `${total} 座`;
          box.append(h('div', { class: 'group' }, iconBox(buildingIcon(bk, 1)), d.levels[0].name, h('small', {}, status)));
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
            if (total === 0) box.lastElementChild!.classList.add('off');
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
              b.level === 2 ? h('span', { class: 'tag good' }, '2 级') : null,
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
          if (d.levels.length > 1 && b.level === 1) {
            const next = d.levels[1];
            const err = canUpgrade(p, b.id);
            const gain = net ? `防御 ${lv.defense} → ${next.defense}` : b.key === 'hq' ? '领地向战场方向扩大一圈' : `攻击 ${lv.attack} → ${next.attack} · 射程 ${lv.range} → ${next.range}`;
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
    const card = h(
      'div',
      { class: 'card' },
      iconBox(info.art),
      h('div', {}, h('div', { class: 'title' }, h('span', { class: 'dot', style: `--c:${info.color}` }), info.title, ...info.tags), h('div', { class: 'stats' }, ...info.stats), info.terrain),
    );
    if (info.help) card.append(h('div', { class: 'help' }, info.help));
    if (mine) {
      const next = h('button', { class: 'btn small', title: '快捷键 Tab' }, '下一个待命');
      next.onclick = this.a.nextUnit;
      const cancel = h('button', { class: 'btn small ghost' }, '取消');
      cancel.onclick = this.a.deselect;
      card.append(next, cancel);
    } else if (!ctx.humanTurn && ref) {
      card.append(h('div', { class: 'help' }, '点击空地关闭 · Esc 打开暂停菜单'));
    }
    el.append(card);
  }
}

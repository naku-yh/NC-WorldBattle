import { ALIENS, ALIEN_CAP, ALIEN_EVERY, ALIEN_GROWTH, ALIEN_KEYS, BUILDABLE, BUILDINGS, CITY, CITY_RANGE, CITY_CRUSH, DIFFICULTIES, HIDDEN_KEYS, MAP_SIZES, MIN_TURNS, PROMOTE_COST, RANKS, RESOURCES, SCORE_BUILDING, SCORE_LAST_HIT, SPIDERLING, START_RESOURCES, TERRAIN, UNITS } from '../game/data';
import { volley } from '../game/engine';
import type { AlienKey, BonusClass, BuildingDef, Cost, ResourceKey, Terrain, UnitDef, UnitKey } from '../game/types';
import { h } from './dom';
import { alienIcon, buildingIcon, icon, iconBox, spiderIcon, terrainIcon, unitIcon } from './icons';

const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

export const costText = (c: Cost): string => RES_KEYS.filter((k) => c[k]).map((k) => `${RESOURCES[k].name} ${c[k]}`).join(' ');

/** Every rung above the first with its price: "重型炮台（500 矿 300 油）", or the whole ladder for the net. */
const upgradeText = (d: BuildingDef): string => d.levels.slice(1).map((l) => `${l.name}（${costText(l.cost)}）`).join(' → ') || '—';

/** What the attack figure leaves out on its own: how many shells a turn's attack comes in, and what the weapon has for aircraft. */
/** What a weapon hits twice as hard, in words. */
const PREY: Record<BonusClass, string> = { soldier: '对步兵×2', tank: '对坦克×2', alien: '对外星人×2' };

export function attackNotes(d: Pick<UnitDef, 'attack' | 'shots' | 'airAttack' | 'doubleVs' | 'splash'>): string[] {
  const out: string[] = [];
  if (d.shots > 1) out.push(d.shots === 2 ? '两炮' : `${d.shots} 炮`);
  if (d.airAttack !== undefined) out.push(d.airAttack === d.attack * 2 ? '对空×2' : `对空 ${volley({ attack: d.airAttack, shots: d.shots })}`);
  for (const vs of d.doubleVs ?? []) out.push(PREY[vs]);
  if (d.splash === 'cross') out.push('十字溅射');
  return out;
}

/** What everyone starts out with under a difficulty, in words. */
const startText = (level: 'low' | 'high'): string => {
  const r = START_RESOURCES[level];
  return `${r.ore} 矿石 / ${r.oil} 石油 / ${r.meat} 肉`;
};

const DICE_RULE = `每个回合开始时所有存活玩家同时掷骰子：点数最大者获得 <b>3 行动点</b>，最小者 <b>1 行动点</b>，中间的玩家没有行动点；<b>四人对局</b>时按名次依次是 3 / 2 / 1 / 0。并列时只让并列的玩家加掷。按点数从高到低依次行动。`;
const DICE_TEXT = '每回合开始全体掷骰子：点数最大得 3 行动点，最小得 1 行动点，中间的玩家没有；四人对局按名次是 3 / 2 / 1 / 0；并列时加掷。';
const DIFFICULTY_RULE = `难度决定所有玩家的开局资源。${DIFFICULTIES.map((d) => `<b>${d.name}</b>：${startText(d.key)}`).join('；')}。低难度下电脑玩家第 13 回合之后才建军事工厂，从不建机场；高难度下电脑玩家很早就建军事工厂和机场，各种坦克和飞机都会造，进攻时挑更值得打的目标。`;
const DIFFICULTY_TEXT = '难度决定开局资源：低难度 500 矿石 / 500 石油 / 500 肉，电脑玩家第 13 回合之后才建军工厂、不建机场；高难度 300 / 250 / 250，电脑玩家更早建军工厂和机场，坦克飞机都造，进攻更有章法。';
const SPLASH_RULE = `<b>十字溅射</b>：${UNITS.missileTank.name}和${UNITS.bomber.name}打中一个格子后，它上下左右四个格子里的敌方地面单位、外星人和建筑各再受到<b>一半攻击力</b>的伤害（先扣各自的防御）。`;
const DOUBLING_RULE = `<b>克制</b>：${UNITS.sniper.name}对步兵类单位（步兵、狙击手、反坦克战士、特种部队）、${UNITS.atSoldier.name}对坦克类单位（各种坦克和人形机甲）、${UNITS.specOps.name}对外星人（小蜘蛛也算）造成<b>双倍伤害</b>。`;
const CITY_RULE = `大型和超大型地图上散布着<b>${CITY.house.name}</b>和<b>${CITY.tower.name}</b>：生命 ${CITY.house.hp}、防御 ${CITY.house.defense}，房屋可进驻 ${CITY.house.room} 名士兵，大厦最多 ${CITY.tower.room} 名。步兵、狙击手、反坦克战士走进建筑即进驻；${UNITS.specOps.name}和${UNITS.mech.name}无法进驻。建筑里的士兵射程最多 ${CITY_RANGE}，每回合仍可攻击一次；外面的敌人打不到里面的士兵，只能攻击建筑。建筑被摧毁时，里面每名士兵损失 ${CITY_CRUSH} 点生命（不足即阵亡），幸存者散到周围的格子。被占据的建筑屋顶升起该玩家颜色的旗帜；点击自己的建筑可以<b>解散</b>，把士兵放到周围的空格——周围空格不够时无法解散。`;
const CITY_TEXT = `大型和超大型地图上有单层房屋（进驻 1 名士兵）和高层大厦（最多 3 名）：生命 10、防御 5。步兵、狙击手、反坦克战士走进去即进驻，在建筑里射程最多 ${CITY_RANGE}，敌人只能打建筑；建筑被摧毁时里面各扣 ${CITY_CRUSH} 点生命。特种部队和人形机甲不能进驻。占据后屋顶升起旗帜，点自己的建筑可以“解散”。`;
const AIRPORT_RULE = `每座机场每种飞机（${UNITS.fighter.name}、${UNITS.bomber.name}）最多停靠 4 架。`;
const share = (n: number): string => `${Math.round(n * 100)}%`;
const RANK_RULE = `战斗单位有三个军衔：<b>${RANKS.map((r) => r.name).join(' → ')}</b>，新造出来的都是${RANKS[0].name}。在自己的回合点选自己的单位，卡片上有<b>升级</b>按钮：花该单位造价的 <b>${share(PROMOTE_COST[0])}</b> 升${RANKS[1].name}、<b>${share(PROMOTE_COST[1])}</b> 升${RANKS[2].name}。${RANKS[1].name}的攻击力、生命是${RANKS[0].name}的 <b>${RANKS[1].power} 倍</b>，${RANKS[2].name}是 <b>${RANKS[2].power} 倍</b>；防御力${RANKS[1].name} <b>+${RANKS[1].armor}</b>，${RANKS[2].name} <b>+${RANKS[2].armor}</b>。晋升后生命补满；不占用该单位本回合的移动和攻击。多炮单位每一炮分别放大后取整。`;
const RANK_TEXT = `战斗单位有${RANKS.map((r) => r.name).join('、')}三个军衔：在自己的回合点自己的单位，按“升级”，花造价的 ${share(PROMOTE_COST[0])} 升${RANKS[1].name}、${share(PROMOTE_COST[1])} 升${RANKS[2].name}。${RANKS[1].name}攻、血 ×${RANKS[1].power}、防 +${RANKS[1].armor}；${RANKS[2].name}攻、血 ×${RANKS[2].power}、防 +${RANKS[2].armor}。`;

/** The attack figure as the cards give it, every shell of the turn counted, with what it leaves out: "18（两炮 · 对空 8）". */
export function attackText(d: Pick<UnitDef, 'attack' | 'shots' | 'airAttack'>): string {
  const notes = attackNotes(d);
  return `${volley(d)}${notes.length ? `（${notes.join(' · ')}）` : ''}`;
}

/** Everything on the ground that can bring an aircraft down, the anti-air gun aside. */
const AIR_DEFENCE = Object.values(UNITS)
  .filter((d) => d.unitClass === 'ground' && d.canHit.includes('air'))
  .map((d) => d.name)
  .join('、');
/** The units whose attack figure needs a word beside it. */
const VOLLEY_TEXT = [UNITS.twinTank, UNITS.aaTank, UNITS.apocalypse].map((d) => `${d.name} ${attackText(d)}`).join('；');

/** The defense net's ladder: what each rung absorbs, "2 / 3 / 4 / 6 / 8". */
const NET = BUILDINGS.defenseNet.levels;
const NET_ABSORB = NET.map((l) => l.defense).join(' / ');
const NET_RULE = `罩住整个基地（一层半透明的穹顶）：基地内所有建筑每次受击先抵扣它的防御值。共 ${NET.length} 级、可升级 ${NET.length - 1} 次，逐级抵扣 ${NET_ABSORB} 点攻击力；每次升级的花费是上一次的 150%。`;

/** One-line summary of what a building does, shown next to its name. */
export function effectOf(k: keyof typeof BUILDINGS): string {
  const d = BUILDINGS[k];
  const l = d.levels[0];
  switch (k) {
    case 'hq':
      return `生命值 ${d.hp} · 可升级`;
    case 'powerPlant':
      return `供电 +${d.providesPower}`;
    case 'factory':
      return `运输车容量 +${d.capPerBuilding}`;
    case 'defenseNet':
      return `基地防御 +${l.defense}（共 ${d.levels.length} 级）`;
    case 'barracks':
      return `每回合 ${d.perTurnCap} 名`;
    case 'warFactory':
      return `每回合 ${d.perTurnCap} 辆`;
    case 'airport':
      return `每种停靠 ${d.capPerBuilding} 架`;
    default:
      return `攻击 ${l.attack} · 射程 ${l.range} · 只打${d.canHit.includes('air') ? '空中' : '地面'}`;
  }
}

const sizeText = MAP_SIZES.map((m) => `${m.name} ${m.size}×${m.size}`).join(' / ');
const every = ALIEN_EVERY.join('–');
/** How much stronger each alien to arrive is than the one before, on the reference card's figures: "20". */
const growth = Math.round(ALIEN_GROWTH * 100);
/** The rule that later arrivals are tougher, in the same words wherever it is spelled out. */
const GROWTH_TEXT = `表中是第一个降临的外星人的数值；之后每来一个，生命、攻击、防御都比表里多 ${growth}%（第二个 +${growth}%，第三个 +${growth * 2}%……），射程和移动不变。`;
/**
 * The hidden ones as the rulebook tells of them: what each is as it first
 * shows itself, and of the rest no more than a hint. What they turn into once
 * down is in `SECOND_FORMS`, and stays out of every rulebook.
 */
const HIDDEN_INTRO = `还有三种隐藏外星人，从不当第一个到来，来了也没有预兆。下面是它们的基础数值，同样随降临次序变强。至于把它们放倒之后会怎样，亲历过的人都不愿细说。`;

/** One alien's numbers on a line, as the first of its kind to arrive has them: "生命 135 · 攻击 13 · 防御 4 · 射程 2 · 仅对地 · 移动 2". */
const alienStats = (k: AlienKey): string => {
  const d = ALIENS[k];
  // What it can reach from the air side: nothing, everything within range, or less than it reaches along the ground.
  const air = !d.canHit.includes('air') ? ' · 仅对地' : d.airRange !== undefined ? `（对空 ${d.airRange}）` : '';
  const travel = d.teleports ? `移动 瞬移${air}` : `射程 ${d.range}${air} · 移动 ${d.move}`;
  return `生命 ${d.hp} · 攻击 ${volley(d)} · 防御 ${d.defense} · ${travel}`;
};

/** What the winner is decided on, said the same way in both rulebooks. */
const GOAL = `打满所选回合数（至少 ${MIN_TURNS} 回合）后，`;

const GOAL_HTML = `<p>${GOAL}<b>积分最高</b>的玩家获胜；积分相同则依次比较<b>基地生命值</b>、<b>攻击力</b>（存活战斗单位与通电防御建筑的攻击力总和）。基地生命值归零立即出局，只剩一人时直接获胜。</p>
<h3>积分</h3>
<ul>
  <li>消灭敌方的部队、坦克和建筑都能得分，越值钱的分越高；打掉一座军事基地得 ${SCORE_BUILDING.hq} 分。</li>
  <li>外星人被击败时，它的积分按各人造成的<b>伤害</b>分配，伤害最多的拿得最多；补上最后一击的人再加 ${SCORE_LAST_HIT} 分。</li>
  <li>小地图下方的<b>积分榜</b>实时显示排名。</li>
</ul>`;

const ALIENS_HTML = `<h3>外星人</h3>
<p>第 ${every} 回合之间的某一回合来了第一个，之后每隔 ${every} 回合再来一个，种类随机；场上同时最多 ${ALIEN_CAP} 个。外星人只攻击玩家，互不攻击。${GROWTH_TEXT}</p>
<table><tr><th>外星人</th><th>数值</th><th>本事</th></tr>${ALIEN_KEYS.map((k) => `<tr><td>${ALIENS[k].name}</td><td>${alienStats(k)}</td><td>${ALIENS[k].desc}</td></tr>`).join('')}</table>
<p>${ALIENS.kuide.name}孵出的小蜘蛛：生命 ${SPIDERLING.hp} · 攻击 ${SPIDERLING.attack} · 防御 ${SPIDERLING.defense} · 仅对地，随机攻击够得着的目标。击败外星人还能按伤害分得资源奖励。</p>
<h3>隐藏外星人</h3>
<p>${HIDDEN_INTRO}</p>
<table><tr><th>外星人</th><th>数值</th><th>本事</th></tr>${HIDDEN_KEYS.map((k) => `<tr><td>${ALIENS[k].name}</td><td>${alienStats(k)}</td><td>${ALIENS[k].desc}</td></tr>`).join('')}</table>`;

/** The rulebook as plain text with cost tables generated from the data, so they cannot drift. */
function rulesHtml(): string {
  const buildings = [BUILDINGS.hq, ...BUILDABLE.map((k) => BUILDINGS[k])]
    .map((d) => {
      const k = d.key;
      return `<tr><td>${d.levels[0].name}</td><td>${costText(d.levels[0].cost)}</td><td>${effectOf(k)}</td><td>${upgradeText(d)}</td></tr>`;
    })
    .join('');
  const units = (Object.keys(UNITS) as UnitKey[])
    .map((k) => {
      const d = UNITS[k];
      return `<tr><td>${d.name}</td><td>${costText(d.cost)}</td><td>${attackText(d)}</td><td>${d.defense}</td><td>${d.hp}</td><td>${d.range}</td><td>${d.move || '—'}</td></tr>`;
    })
    .join('');
  const ground = (Object.keys(TERRAIN) as (keyof typeof TERRAIN)[]).map((k) => `<tr><td>${TERRAIN[k].name}</td><td>${TERRAIN[k].rule}</td></tr>`).join('');
  return `
<h3>目标</h3>
${GOAL_HTML}
<h3>回合流程</h3>
<ul>
  <li>${DICE_RULE}</li>
  <li>行动点只用于<b>采集</b>：1 点 = 全部运输车出动采集一种资源，每台运回 100。</li>
  <li>建造、生产、移动和攻击<b>不消耗行动点</b>，只受资源和产量上限约束。每个单位每回合可移动一次、攻击一次。</li>
</ul>
<h3>地图与地形</h3>
<p>每局随机生成（${sizeText}）：一条水道横贯战场，上面有两座相隔至少 5 格的桥；另有湖泊、树林和山地。四角是各玩家的领地，领地、运输车道和资源点永远是平地。</p>
<table><tr><th>地形</th><th>规则</th></tr>${ground}</table>
<p>地形只影响站在上面的单位，随移动而变化；射程最多减到 1。建造时在自己领地里选格子放置。</p>
<p>${CITY_RULE}</p>
<h3>难度</h3>
<p>${DIFFICULTY_RULE}</p>
<h3>资源与电力</h3>
<ul>
  <li><b>矿石 / 石油 / 肉</b>：三类资源，用于建造和生产。</li>
  <li>每座<b>发电站</b>供 3 座建筑，按建造顺序分配；断电的建筑不能生产、开火，防御网失效。</li>
  <li>每座加工工厂最多 4 台运输车；军营、军工厂每回合各最多产出 4 个；${AIRPORT_RULE}</li>
</ul>
<h3>战斗</h3>
<ul>
  <li>伤害 = 攻击力 − 防御值（最低 0）。<b>破甲</b>武器无视防御值。</li>
  <li><b>防御网</b>${NET_RULE}</li>
  <li>只有防空武器（${AIR_DEFENCE}、防空炮）能击落战斗机；防空炮只打空中目标。</li>
  <li>攻击力是每回合每一炮的合计：${VOLLEY_TEXT}。</li>
  <li>${SPLASH_RULE}</li>
  <li>${DOUBLING_RULE}</li>
  <li>敌人攻击基地建筑时，每座通电的炮台 / 防空炮会各反击一次。</li>
</ul>
${ALIENS_HTML}
<h3>建筑</h3>
<table><tr><th>建筑</th><th>消耗</th><th>作用</th><th>升级</th></tr>${buildings}</table>
<p>军事基地升级后领地向战场方向扩大一圈，那一圈里的树林、山地和湖泊会被推平，留出更多建造用的格子。</p>
<h3>单位</h3>
<table><tr><th>单位</th><th>消耗</th><th>攻击</th><th>防御</th><th>生命</th><th>射程</th><th>移动</th></tr>${units}</table>
<h3>军衔</h3>
<p>${RANK_RULE}</p>`;
}

export const RULES_HTML = rulesHtml();

/** A fold-out section of the sidebar rulebook. */
function section(title: string, open: boolean, ...body: Array<HTMLElement | string>): HTMLElement {
  return h('details', { class: 'rule', open: open ? true : null }, h('summary', {}, title), h('div', { class: 'rule-body' }, ...body));
}

const li = (...xs: Array<HTMLElement | string>): HTMLElement => h('li', {}, ...xs);
const b = (text: string): HTMLElement => h('b', {}, text);

/** A short version of the rules for the sidebar; the tables live in fold-outs. */
export function rulesPanel(): HTMLElement {
  const buildingRows = [BUILDINGS.hq, ...BUILDABLE.map((k) => BUILDINGS[k])].map((d) => {
    const ups = d.levels.slice(1).map((l) => costText(l.cost));
    return h(
      'div',
      { class: 'rule-row' },
      iconBox(buildingIcon(d.key, 1)),
      h('div', { class: 'info' }, h('div', { class: 'name' }, d.levels[0].name, h('span', { class: 'tag' }, effectOf(d.key))), h('div', { class: 'sub' }, costText(d.levels[0].cost) + (ups.length ? ` · 升级 ${ups.join(' → ')}` : ''))),
    );
  });
  const unitRows = (Object.keys(UNITS) as UnitKey[]).map((k) => {
    const d = UNITS[k];
    const made = d.producedBy ? BUILDINGS[d.producedBy].levels[0].name : '';
    return h(
      'div',
      { class: 'rule-row' },
      iconBox(unitIcon(k)),
      h('div', { class: 'info' }, h('div', { class: 'name' }, d.name, ...attackNotes(d).map((n) => h('span', { class: 'tag' }, n))), h('div', { class: 'sub' }, `${costText(d.cost)}${d.attack ? ` · 攻 ${attackText(d)} 防 ${d.defense} 血 ${d.hp} 射程 ${d.range} 移动 ${d.move}` : ''}${made ? ` · ${made}` : ''}`)),
    );
  });
  const groundRows = (Object.keys(TERRAIN) as Terrain[]).map((k) =>
    h('div', { class: 'rule-row' }, iconBox(terrainIcon(k)), h('div', { class: 'info' }, h('div', { class: 'name' }, TERRAIN[k].name), h('div', { class: 'sub' }, TERRAIN[k].rule))),
  );
  const alienRow = (k: AlienKey): HTMLElement =>
    h('div', { class: 'rule-row' }, iconBox(alienIcon(k)), h('div', { class: 'info' }, h('div', { class: 'name' }, ALIENS[k].name, h('span', { class: 'tag warn' }, ALIENS[k].look)), h('div', { class: 'sub' }, alienStats(k)), h('div', { class: 'sub' }, ALIENS[k].desc)));
  const alienRows = ALIEN_KEYS.map(alienRow);
  const hiddenRows = HIDDEN_KEYS.map(alienRow);
  return h(
    'div',
    { class: 'rules-panel' },
    section(
      '胜负',
      true,
      h('p', {}, GOAL, b('积分最高'), '的玩家获胜；积分相同则依次比较', b('基地生命值'), '、', b('攻击力'), '。基地生命值归零立即出局，只剩一人时直接获胜。'),
    ),
    section(
      '积分',
      true,
      h('ul', {}, li(`消灭敌方的部队、坦克和建筑都能得分，越值钱的分越高；打掉一座军事基地得 ${SCORE_BUILDING.hq} 分。`), li('外星人被击败时，它的积分按各人造成的', b('伤害'), '分配，伤害最多的拿得最多；补上最后一击的人再加 ', b(String(SCORE_LAST_HIT)), ' 分。'), li(b('小地图下方的积分榜'), '实时显示排名。')),
    ),
    section(
      '回合与行动点',
      true,
      h('p', {}, DICE_TEXT),
      h('ul', {}, li('按点数从高到低依次行动，每人回合结束时点“结束回合”。'), li('行动点只用于采集：', b('1 点 = 全部运输车出动'), '采集一种资源，每台运回 100。'), li('建造、生产、移动、攻击', b('不消耗行动点'), '。每个单位每回合可移动一次、攻击一次。')),
    ),
    section(
      '采集与资源',
      true,
      h(
        'ul',
        {},
        ...RES_KEYS.map((k) => li(h('span', { class: 'ico', style: `color:${RESOURCES[k].color}`, html: icon(k) }), `${RESOURCES[k].name}：${RESOURCES[k].hint}`)),
        li('有行动点的回合，右侧栏左边会摆出', b('采集面板'), '：对着右边的消耗，点一种资源就采一种。行动点用完、或轮到别人时，面板自己收起。'),
        li('每座', b('加工工厂'), '最多 4 台运输车；开局有 1 台。'),
        li('每座', b('发电站'), '供 3 座建筑，按建造顺序分配；断电的建筑不能生产、开火，防御网失效。'),
      ),
    ),
    section(
      '建造与生产',
      true,
      h(
        'ul',
        {},
        li('在“建造”页选一座建筑，再', b('点击自己领地里的格子'), '放置（绿色高亮的是可建的位置）。'),
        li('“生产”页', b('只列出已建成的建筑能生产的单位'), '：没建军营，就看不到步兵、狙击手和反坦克战士。'),
        li('在“建筑”页可以把', b('军事基地'), `升级为${BUILDINGS.hq.levels[1].name}（${costText(BUILDINGS.hq.levels[1].cost)}）：领地向战场方向扩大一圈，多出一批可建的格子。`),
        li('军营、军工厂每回合各最多产出 4 个；' + AIRPORT_RULE),
        li('新单位可以立即行动。'),
      ),
    ),
    section('地图上的建筑', false, h('p', {}, CITY_TEXT)),
    section('难度', false, h('p', {}, DIFFICULTY_TEXT)),
    section('地形', true, h('p', {}, '每局随机生成：一条水道横贯战场，上面有两座桥；另有湖泊、树林和山地。加成只作用于站在上面的单位。'), ...groundRows),
    section(
      '战斗',
      false,
      h('ul', {}, li('伤害 = 攻击力 − 防御值（最低 0）；', b('破甲'), '武器无视防御值。'), li(b('防御网'), NET_RULE), li(`只有防空武器（${AIR_DEFENCE}、防空炮）能击落战斗机。`), li('攻击力是每回合每一炮的合计：', VOLLEY_TEXT, '。'), li('十字溅射：导弹坦克和轰炸机打中的格子，上下左右四格里的敌人各受一半攻击力的伤害。'), li('克制：狙击手对步兵类、反坦克战士对坦克类（含人形机甲）、特种部队对外星人双倍伤害。'), li('敌人攻击基地建筑时，每座通电的炮台 / 防空炮会各反击一次。')),
    ),
    section(
      '外星人',
      false,
      h('p', {}, `第 ${every} 回合之间的某一回合来了第一个，之后每隔 ${every} 回合再来一个，种类随机；场上同时最多 ${ALIEN_CAP} 个。外星人只攻击玩家，互不攻击。${GROWTH_TEXT}`),
      ...alienRows,
      h('div', { class: 'rule-row' }, iconBox(spiderIcon()), h('div', { class: 'info' }, h('div', { class: 'name' }, SPIDERLING.name, h('span', { class: 'tag warn' }, `${ALIENS.kuide.name}孵化的`)), h('div', { class: 'sub' }, `生命 ${SPIDERLING.hp} · 攻击 ${SPIDERLING.attack} · 防御 ${SPIDERLING.defense} · 仅对地 · 随机攻击`))),
      // The hidden ones: their first shape's numbers, and a hint at the rest and no more.
      h('h4', {}, '隐藏外星人'),
      h('p', {}, HIDDEN_INTRO),
      ...hiddenRows,
      h('p', {}, '击败外星人还能按伤害分得资源奖励。'),
    ),
    section(
      '操作',
      false,
      h('ul', {}, li('左键：选择单位 / 建筑下达命令；点击空地查看地块。'), li('拖动：旋转视角；滚轮：缩放；', b('按住空格拖动'), '或右键拖动：平移地图。'), li(b('点击左上角小地图'), '：回到全局视角。'), li('右键：取消选择，或放弃放置建筑。'), li('Tab：下一个待命单位；E：结束回合；1 / 2 / 3：切换右侧栏的建造 / 生产 / 建筑页。')),
    ),
    section(
      '暂停与存档',
      false,
      h('ul', {}, li(b('Esc'), '或顶栏的“菜单”：暂停游戏并弹出菜单，再按一次继续。'), li('菜单里可以', b('看玩法'), '（就是这一页）、', b('保存存档'), '、', b('重新开始'), '（同样的设置开一局新地图）和', b('退出到首页'), '。'), li('共 3 个存档位，保存当时的全部进度，包括下到一半的回合和电脑玩家的回合。'), li('首页的“加载存档”可以接着任意一份继续。'), li('存档只保存在这台电脑的这个浏览器里，清除浏览器数据会一并删除。')),
    ),
    section('建筑与消耗', false, ...buildingRows),
    section('单位与消耗', false, ...unitRows),
    section('军衔', false, h('p', {}, RANK_TEXT)),
  );
}

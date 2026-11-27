import { ALIENS, ALIEN_CAP, ALIEN_EVERY, ALIEN_KEYS, BUILDABLE, BUILDINGS, MAP_SIZES, MIN_TURNS, RESOURCES, SCORE_BUILDING, SCORE_LAST_HIT, SPIDERLING, TERRAIN, UNITS } from '../game/data';
import type { AlienKey, Cost, ResourceKey, Terrain, UnitKey } from '../game/types';
import { h } from './dom';
import { alienIcon, buildingIcon, icon, iconBox, spiderIcon, terrainIcon, unitIcon } from './icons';

const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

export const costText = (c: Cost): string => RES_KEYS.filter((k) => c[k]).map((k) => `${RESOURCES[k].name} ${c[k]}`).join(' ');

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
      return `基地防御 +${l.defense}`;
    case 'barracks':
      return `每回合 ${d.perTurnCap} 名`;
    case 'warFactory':
      return `每回合 ${d.perTurnCap} 辆`;
    case 'airport':
      return `停靠 ${d.capPerBuilding} 架`;
    default:
      return `攻击 ${l.attack} · 射程 ${l.range} · 只打${d.canHit.includes('air') ? '空中' : '地面'}`;
  }
}

const sizeText = MAP_SIZES.map((m) => `${m.name} ${m.size}×${m.size}`).join(' / ');
const every = ALIEN_EVERY.join('–');

/** One alien's numbers on a line: "生命 90 · 攻击 13 · 防御 4 · 射程 2 · 移动 2". */
const alienStats = (k: AlienKey): string => {
  const d = ALIENS[k];
  const travel = d.teleports ? '移动 瞬移' : `射程 ${d.range} · 移动 ${d.move}`;
  return `生命 ${d.hp} · 攻击 ${d.attack} · 防御 ${d.defense} · ${travel}`;
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
<p>第 ${every} 回合之间的某一回合来了第一个，之后每隔 ${every} 回合再来一个，种类随机；场上同时最多 ${ALIEN_CAP} 个。外星人只攻击玩家，互不攻击。</p>
<table><tr><th>外星人</th><th>数值</th><th>本事</th></tr>${ALIEN_KEYS.map((k) => `<tr><td>${ALIENS[k].name}</td><td>${alienStats(k)}</td><td>${ALIENS[k].desc}</td></tr>`).join('')}</table>
<p>${ALIENS.kuide.name}孵出的小蜘蛛：生命 ${SPIDERLING.hp} · 攻击 ${SPIDERLING.attack} · 防御 ${SPIDERLING.defense}，随机攻击够得着的目标。击败外星人还能按伤害分得资源奖励。</p>`;

/** The rulebook as plain text with cost tables generated from the data, so they cannot drift. */
function rulesHtml(): string {
  const buildings = [BUILDINGS.hq, ...BUILDABLE.map((k) => BUILDINGS[k])]
    .map((d) => {
      const up = d.levels[1];
      const k = d.key;
      return `<tr><td>${d.levels[0].name}</td><td>${costText(d.levels[0].cost)}</td><td>${effectOf(k)}</td><td>${up ? `${up.name}（${costText(up.cost)}）` : '—'}</td></tr>`;
    })
    .join('');
  const units = (Object.keys(UNITS) as UnitKey[])
    .map((k) => {
      const d = UNITS[k];
      return `<tr><td>${d.name}</td><td>${costText(d.cost)}</td><td>${d.attack}${d.shots > 1 ? `×${d.shots}` : ''}</td><td>${d.defense}</td><td>${d.hp}</td><td>${d.range}</td><td>${d.move || '—'}</td></tr>`;
    })
    .join('');
  const ground = (Object.keys(TERRAIN) as (keyof typeof TERRAIN)[]).map((k) => `<tr><td>${TERRAIN[k].name}</td><td>${TERRAIN[k].rule}</td></tr>`).join('');
  return `
<h3>目标</h3>
${GOAL_HTML}
<h3>回合流程</h3>
<ul>
  <li>每个回合开始时所有存活玩家同时掷骰子：点数最大者获得 <b>3 行动点</b>，最小者 <b>1 行动点</b>，中间的玩家没有行动点。并列时只让并列的玩家加掷。按点数从高到低依次行动。</li>
  <li>行动点只用于<b>采集</b>：1 点 = 全部运输车出动采集一种资源，每台运回 100。</li>
  <li>建造、生产、移动和攻击<b>不消耗行动点</b>，只受资源和产量上限约束。每个单位每回合可移动一次、攻击一次。</li>
</ul>
<h3>地图与地形</h3>
<p>每局随机生成（${sizeText}）：一条水道横贯战场，上面有两座相隔至少 5 格的桥；另有湖泊、树林和山地。四角是各玩家的领地，领地、运输车道和资源点永远是平地。</p>
<table><tr><th>地形</th><th>规则</th></tr>${ground}</table>
<p>地形只影响站在上面的单位，随移动而变化；射程最多减到 1。建造时在自己领地里选格子放置。</p>
<h3>资源与电力</h3>
<ul>
  <li><b>矿石 / 石油 / 肉</b>：三类资源，用于建造和生产。</li>
  <li>每座<b>发电站</b>供 3 座建筑，按建造顺序分配；断电的建筑不能生产、开火，防御网失效。</li>
  <li>每座加工工厂最多 4 台运输车；军营、军工厂每回合各最多产出 4 个；每座机场停靠 4 架战斗机。</li>
</ul>
<h3>战斗</h3>
<ul>
  <li>伤害 = 攻击力 − 防御值（最低 0）。<b>破甲</b>武器无视防御值。</li>
  <li><b>防御网</b>让基地内所有建筑每次受击抵扣 2 点攻击力，高级防御网抵扣 5 点。</li>
  <li>只有防空武器（防空坦克、防空炮）能击落战斗机；防空炮只打空中目标。</li>
  <li>敌人攻击基地建筑时，每座通电的炮台 / 防空炮会各反击一次。</li>
</ul>
${ALIENS_HTML}
<h3>建筑</h3>
<table><tr><th>建筑</th><th>消耗</th><th>作用</th><th>升级</th></tr>${buildings}</table>
<p>军事基地升级后领地向战场方向扩大一圈，那一圈里的树林、山地和湖泊会被推平，留出更多建造用的格子。</p>
<h3>单位</h3>
<table><tr><th>单位</th><th>消耗</th><th>攻击</th><th>防御</th><th>生命</th><th>射程</th><th>移动</th></tr>${units}</table>`;
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
    const up = d.levels[1];
    return h(
      'div',
      { class: 'rule-row' },
      iconBox(buildingIcon(d.key, 1)),
      h('div', { class: 'info' }, h('div', { class: 'name' }, d.levels[0].name, h('span', { class: 'tag' }, effectOf(d.key))), h('div', { class: 'sub' }, costText(d.levels[0].cost) + (up ? ` · 升级 ${costText(up.cost)}` : ''))),
    );
  });
  const unitRows = (Object.keys(UNITS) as UnitKey[]).map((k) => {
    const d = UNITS[k];
    const made = d.producedBy ? BUILDINGS[d.producedBy].levels[0].name : '';
    return h(
      'div',
      { class: 'rule-row' },
      iconBox(unitIcon(k)),
      h('div', { class: 'info' }, h('div', { class: 'name' }, d.name, d.shots > 1 ? h('span', { class: 'tag' }, `×${d.shots}`) : null), h('div', { class: 'sub' }, `${costText(d.cost)}${d.attack ? ` · 攻 ${d.attack}${d.shots > 1 ? `×${d.shots}` : ''} 防 ${d.defense} 血 ${d.hp} 射程 ${d.range}` : ''}${made ? ` · ${made}` : ''}`)),
    );
  });
  const groundRows = (Object.keys(TERRAIN) as Terrain[]).map((k) =>
    h('div', { class: 'rule-row' }, iconBox(terrainIcon(k)), h('div', { class: 'info' }, h('div', { class: 'name' }, TERRAIN[k].name), h('div', { class: 'sub' }, TERRAIN[k].rule))),
  );
  const alienRows = ALIEN_KEYS.map((k) =>
    h('div', { class: 'rule-row' }, iconBox(alienIcon(k)), h('div', { class: 'info' }, h('div', { class: 'name' }, ALIENS[k].name, h('span', { class: 'tag warn' }, ALIENS[k].look)), h('div', { class: 'sub' }, alienStats(k)), h('div', { class: 'sub' }, ALIENS[k].desc))),
  );
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
      h('ul', {}, li('每回合开始全体掷骰子：点数最大得 ', b('3 行动点'), '，最小得 ', b('1 行动点'), '，中间的玩家没有；并列时加掷。'), li('按点数从高到低依次行动，每人回合结束时点“结束回合”。'), li('行动点只用于采集：', b('1 点 = 全部运输车出动'), '采集一种资源，每台运回 100。'), li('建造、生产、移动、攻击', b('不消耗行动点'), '。每个单位每回合可移动一次、攻击一次。')),
    ),
    section(
      '采集与资源',
      true,
      h(
        'ul',
        {},
        ...RES_KEYS.map((k) => li(h('span', { class: 'ico', style: `color:${RESOURCES[k].color}`, html: icon(k) }), `${RESOURCES[k].name}：${RESOURCES[k].hint}`)),
        li('每座', b('加工工厂'), '最多 4 台运输车；开局有 1 台。'),
        li('每座', b('发电站'), '供 3 座建筑，按建造顺序分配；断电的建筑不能生产、开火，防御网失效。'),
      ),
    ),
    section(
      '建造与生产',
      true,
      h('ul', {}, li('在“建造”页选一座建筑，再', b('点击自己领地里的格子'), '放置（绿色高亮的是可建的位置）。'), li(`在“建筑”页可以把${b('军事基地')}升级为${BUILDINGS.hq.levels[1].name}（${costText(BUILDINGS.hq.levels[1].cost)}）：领地向战场方向扩大一圈，多出一批可建的格子。`), li('军营、军工厂每回合各最多产出 4 个；每座机场停靠 4 架战斗机。'), li('新单位可以立即行动。')),
    ),
    section('地形', true, h('p', {}, '每局随机生成：一条水道横贯战场，上面有两座桥；另有湖泊、树林和山地。加成只作用于站在上面的单位。'), ...groundRows),
    section(
      '战斗',
      false,
      h('ul', {}, li('伤害 = 攻击力 − 防御值（最低 0）；', b('破甲'), '武器无视防御值。'), li(b('防御网'), '让基地内所有建筑每次受击抵扣 2 点攻击力，高级防御网抵扣 5 点。'), li('只有防空武器（防空坦克、防空炮）能击落战斗机。'), li('敌人攻击基地建筑时，每座通电的炮台 / 防空炮会各反击一次。')),
    ),
    section(
      '外星人',
      false,
      h('p', {}, `第 ${every} 回合之间的某一回合来了第一个，之后每隔 ${every} 回合再来一个，种类随机；场上同时最多 ${ALIEN_CAP} 个。外星人只攻击玩家，互不攻击。`),
      ...alienRows,
      h('div', { class: 'rule-row' }, iconBox(spiderIcon()), h('div', { class: 'info' }, h('div', { class: 'name' }, SPIDERLING.name, h('span', { class: 'tag warn' }, `${ALIENS.kuide.name}孵化的`)), h('div', { class: 'sub' }, `生命 ${SPIDERLING.hp} · 攻击 ${SPIDERLING.attack} · 防御 ${SPIDERLING.defense} · 随机攻击`))),
      h('p', {}, '击败外星人还能按伤害分得资源奖励。'),
    ),
    section(
      '操作',
      false,
      h('ul', {}, li('左键：选择单位 / 建筑下达命令；点击空地查看地块。'), li('拖动：旋转视角；滚轮：缩放；', b('按住空格拖动'), '或右键拖动：平移地图。'), li(b('点击左上角小地图'), '：回到全局视角。'), li('右键：取消选择，或放弃放置建筑。'), li('Tab：下一个待命单位；E：结束回合；1–5：切换页签。')),
    ),
    section(
      '暂停与存档',
      false,
      h('ul', {}, li(b('Esc'), '或顶栏的“菜单”：暂停游戏并弹出菜单，再按一次继续。'), li('菜单里可以', b('保存存档'), '、', b('重新开始'), '（同样的设置开一局新地图）和', b('退出到首页'), '。'), li('共 3 个存档位，保存当时的全部进度，包括下到一半的回合和电脑玩家的回合。'), li('首页的“加载存档”可以接着任意一份继续。'), li('存档只保存在这台电脑的这个浏览器里，清除浏览器数据会一并删除。')),
    ),
    section('建筑与消耗', false, ...buildingRows),
    section('单位与消耗', false, ...unitRows),
  );
}

import type {
  AlienDef,
  AlienKey,
  BuildingDef,
  BuildingKey,
  Cost,
  ResourceKey,
  SpiderlingDef,
  TargetClass,
  Terrain,
  TerrainDef,
  TerrainEffect,
  UnitDef,
  UnitFamily,
  UnitKey,
} from './types';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/** The medium board is BOARD_SIZE x BOARD_SIZE tiles, one base zone in each corner. */
export const BOARD_SIZE = 20;
/** The large board adds about half again as many tiles and stays square. */
export const LARGE_SIZE = 25;
export const MAP_SIZES = [
  { key: 'medium', name: '中型', size: BOARD_SIZE },
  { key: 'large', name: '大型', size: LARGE_SIZE },
] as const;
export const ZONE_SIZE = 6;
export const HQ_SIZE = 2;
/** Smallest / largest board the corner zones still make sense on. */
export const MIN_BOARD = 16;
export const MAX_BOARD = 40;

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const HARVEST_YIELD = 100;
export const START_TRUCKS = 1;
export const START_RESOURCES: Record<ResourceKey, number> = { ore: 300, oil: 200, meat: 200 };
export const POWER_PER_PLANT = 3;
export const TRUCKS_PER_FACTORY = 4;
export const FIGHTERS_PER_AIRPORT = 4;
/** Per barracks / per war factory. */
export const PER_TURN_CAP = 4;

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export const MIN_TURNS = 20;
export const BASE_HP = 20;
export const AP_TOP = 3;
export const AP_BOTTOM = 1;
/** Rounds between one alien's arrival and the next one's: rolled afresh each time. */
export const ALIEN_EVERY = [5, 8] as const;
/** Never more than this many aliens on the board at once. */
export const ALIEN_CAP = 2;

export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'];
export const PLAYER_NAMES = ['玩家1', '玩家2', '玩家3', '玩家4'];

export const RESOURCES: Record<ResourceKey, { name: string; color: string; hint: string }> = {
  ore: { name: '矿石', color: '#cbd5e1', hint: '建筑与装甲的主要材料' },
  oil: { name: '石油', color: '#f97316', hint: '载具与升级离不开它' },
  meat: { name: '肉', color: '#fb7185', hint: '士兵口粮，发电站也靠它' },
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const UNITS: Record<UnitKey, UnitDef> = {
  truck: {
    key: 'truck',
    name: '资源运输车',
    desc: '每台每次采集运送 100 资源，每个加工工厂最多 4 台。',
    cost: { ore: 150 },
    hp: 0,
    attack: 0,
    shots: 0,
    defense: 0,
    range: 0,
    move: 0,
    unitClass: 'ground',
    family: 'truck',
    canHit: [],
    fx: 'bullet',
    producedBy: 'factory',
  },
  infantry: {
    key: 'infantry',
    name: '步兵',
    desc: '便宜耐用的基础步兵。',
    cost: { ore: 300, meat: 200 },
    hp: 6,
    attack: 3,
    shots: 1,
    defense: 0,
    range: 1,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'bullet',
    producedBy: 'barracks',
  },
  sniper: {
    key: 'sniper',
    name: '狙击手',
    desc: '射程 4，专杀步兵。',
    cost: { ore: 350, oil: 150, meat: 200 },
    hp: 4,
    attack: 5,
    shots: 1,
    defense: 0,
    range: 4,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'bullet',
    producedBy: 'barracks',
  },
  atSoldier: {
    key: 'atSoldier',
    name: '反坦克战士',
    desc: '破甲：无视目标防御值。',
    cost: { ore: 350, oil: 250, meat: 150 },
    hp: 5,
    attack: 6,
    shots: 1,
    defense: 0,
    range: 2,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'missile',
    pierce: true,
    producedBy: 'barracks',
  },
  tank: {
    key: 'tank',
    name: '坦克',
    desc: '装甲主力，步兵打不动它。',
    cost: { ore: 500, oil: 300 },
    hp: 16,
    attack: 8,
    shots: 1,
    defense: 3,
    range: 2,
    move: 4,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'shell',
    producedBy: 'warFactory',
  },
  twinTank: {
    key: 'twinTank',
    name: '双管坦克',
    desc: '每回合开两炮，打薄皮目标特别狠。',
    cost: { ore: 850, oil: 450 },
    hp: 20,
    attack: 5,
    shots: 2,
    defense: 3,
    range: 2,
    move: 4,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'shell',
    producedBy: 'warFactory',
  },
  aaTank: {
    key: 'aaTank',
    name: '防空坦克',
    desc: '可以对空射击，也能打地面。',
    cost: { ore: 700, oil: 450 },
    hp: 16,
    attack: 7,
    shots: 1,
    defense: 3,
    range: 3,
    move: 4,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'air', 'building'],
    fx: 'flak',
    producedBy: 'warFactory',
  },
  missileTank: {
    key: 'missileTank',
    name: '导弹坦克',
    desc: '射程 5，能在炮台射程外开火。',
    cost: { ore: 950, oil: 550 },
    hp: 14,
    attack: 10,
    shots: 1,
    defense: 2,
    range: 5,
    move: 3,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'missile',
    producedBy: 'warFactory',
  },
  laserTank: {
    key: 'laserTank',
    name: '激光坦克',
    desc: '破甲：激光无视目标防御值。',
    cost: { ore: 1000, oil: 650 },
    hp: 18,
    attack: 7,
    shots: 1,
    defense: 3,
    range: 3,
    move: 4,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'laser',
    pierce: true,
    producedBy: 'warFactory',
  },
  apocalypse: {
    key: 'apocalypse',
    name: '天启双塔坦克',
    desc: '双炮塔重装巨兽，攻防俱佳。',
    cost: { ore: 2000, oil: 1300 },
    hp: 40,
    attack: 9,
    shots: 2,
    defense: 5,
    range: 3,
    move: 3,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'shell',
    producedBy: 'warFactory',
  },
  fighter: {
    key: 'fighter',
    name: '战斗机',
    desc: '空中单位，只有防空武器能击落它。',
    cost: { ore: 1000, oil: 700 },
    hp: 12,
    attack: 11,
    shots: 1,
    defense: 2,
    range: 3,
    move: 8,
    unitClass: 'air',
    family: 'air',
    canHit: ['ground', 'building'],
    fx: 'bomb',
    producedBy: 'airport',
  },
};

/** Display order for production lists. */
export const PRODUCED_UNITS: Record<Exclude<BuildingKey, 'hq' | 'powerPlant' | 'defenseNet' | 'turret' | 'aaGun'>, UnitKey[]> = {
  factory: ['truck'],
  barracks: ['infantry', 'sniper', 'atSoldier'],
  warFactory: ['tank', 'twinTank', 'aaTank', 'missileTank', 'laserTank', 'apocalypse'],
  airport: ['fighter'],
};

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

const noCombat = { defense: 0, attack: 0, shots: 0, range: 0 };

export const BUILDINGS: Record<BuildingKey, BuildingDef> = {
  hq: {
    key: 'hq',
    name: '军事基地',
    desc: '生命值归零即战败。升级后领地向战场方向扩大一圈，可以多建建筑。',
    w: HQ_SIZE,
    h: HQ_SIZE,
    hp: BASE_HP,
    needsPower: false,
    providesPower: 0,
    levels: [
      { name: '军事基地', cost: {}, ...noCombat },
      { name: '高级军事基地', cost: { ore: 1000, oil: 1000, meat: 1000 }, ...noCombat },
    ],
    canHit: [],
    produces: [],
    perTurnCap: 0,
    capPerBuilding: 0,
  },
  powerPlant: {
    key: 'powerPlant',
    name: '发电站',
    desc: '为 3 座建筑供电；断电的建筑无法工作。',
    w: 1,
    h: 1,
    hp: 20,
    needsPower: false,
    providesPower: POWER_PER_PLANT,
    levels: [{ name: '发电站', cost: { ore: 300, meat: 200 }, ...noCombat }],
    canHit: [],
    produces: [],
    perTurnCap: 0,
    capPerBuilding: 0,
  },
  factory: {
    key: 'factory',
    name: '加工工厂',
    desc: '生产资源运输车，每座最多容纳 4 台。',
    w: 1,
    h: 1,
    hp: 30,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '加工工厂', cost: { ore: 400, oil: 150, meat: 150 }, ...noCombat }],
    canHit: [],
    produces: ['truck'],
    perTurnCap: 0,
    capPerBuilding: TRUCKS_PER_FACTORY,
  },
  barracks: {
    key: 'barracks',
    name: '军营',
    desc: '训练步兵、狙击手、反坦克战士，每回合最多 4 名。',
    w: 2,
    h: 1,
    hp: 30,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '军营', cost: { ore: 400, oil: 200, meat: 300 }, ...noCombat }],
    canHit: [],
    produces: ['infantry', 'sniper', 'atSoldier'],
    perTurnCap: PER_TURN_CAP,
    capPerBuilding: 0,
  },
  warFactory: {
    key: 'warFactory',
    name: '军工厂',
    desc: '生产各型坦克，每回合最多 4 辆。',
    w: 2,
    h: 2,
    hp: 40,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '军工厂', cost: { ore: 700, oil: 400, meat: 200 }, ...noCombat }],
    canHit: [],
    produces: ['tank', 'twinTank', 'aaTank', 'missileTank', 'laserTank', 'apocalypse'],
    perTurnCap: PER_TURN_CAP,
    capPerBuilding: 0,
  },
  airport: {
    key: 'airport',
    name: '军事机场',
    desc: '生产并停靠战斗机，每座最多 4 架。',
    w: 2,
    h: 2,
    hp: 40,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '军事机场', cost: { ore: 900, oil: 600, meat: 200 }, ...noCombat }],
    canHit: [],
    produces: ['fighter'],
    perTurnCap: 0,
    capPerBuilding: FIGHTERS_PER_AIRPORT,
  },
  defenseNet: {
    key: 'defenseNet',
    name: '防御网',
    desc: '覆盖整个基地：敌方每单位每次攻击先被抵扣 2 点攻击力。',
    w: 0,
    h: 0,
    hp: 0,
    needsPower: true,
    providesPower: 0,
    levels: [
      { name: '防御网', cost: { ore: 300 }, defense: 2, attack: 0, shots: 0, range: 0 },
      { name: '高级防御网', cost: { ore: 500, oil: 300 }, defense: 5, attack: 0, shots: 0, range: 0 },
    ],
    canHit: [],
    produces: [],
    perTurnCap: 0,
    capPerBuilding: 0,
    maxCount: 1,
  },
  turret: {
    key: 'turret',
    name: '炮台',
    desc: '自动警戒：敌方攻击基地建筑时反击一次，也能主动开火。',
    w: 1,
    h: 1,
    hp: 25,
    needsPower: true,
    providesPower: 0,
    levels: [
      { name: '炮台', cost: { ore: 300, oil: 150 }, defense: 0, attack: 8, shots: 1, range: 4 },
      { name: '重型炮台', cost: { ore: 500, oil: 300 }, defense: 0, attack: 13, shots: 1, range: 5 },
    ],
    canHit: ['ground'],
    produces: [],
    perTurnCap: 0,
    capPerBuilding: 0,
    front: true,
  },
  aaGun: {
    key: 'aaGun',
    name: '防空炮',
    desc: '只打空中单位，敌方飞机攻击基地建筑时反击一次。',
    w: 1,
    h: 1,
    hp: 25,
    needsPower: true,
    providesPower: 0,
    levels: [
      { name: '防空炮', cost: { ore: 300, oil: 150 }, defense: 0, attack: 9, shots: 1, range: 4 },
      { name: '毒刺防空炮', cost: { ore: 500, oil: 300 }, defense: 0, attack: 14, shots: 1, range: 5 },
    ],
    canHit: ['air'],
    produces: [],
    perTurnCap: 0,
    capPerBuilding: 0,
    front: true,
  },
};

/** Display order for the build menu. */
export const BUILDABLE: BuildingKey[] = [
  'powerPlant',
  'factory',
  'defenseNet',
  'barracks',
  'warFactory',
  'airport',
  'turret',
  'aaGun',
];

/** Upgrading also reinforces the structure by this many HP. */
export const UPGRADE_HP_BONUS = 10;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

const dry = { blocks: [] as UnitFamily[], effects: {} as Partial<Record<UnitFamily, TerrainEffect>> };

export const TERRAIN: Record<Terrain, TerrainDef> = {
  plain: {
    ...dry,
    name: '平原',
    rule: '坦克攻击 +2，防御 −2',
    effects: { tank: { attack: 2, defense: -2 } },
  },
  hill: {
    ...dry,
    name: '山地',
    rule: '士兵攻击 +2，防御 +1',
    effects: { soldier: { attack: 2, defense: 1 } },
  },
  forest: {
    ...dry,
    name: '树林',
    rule: '士兵防御 +2；坦克射程 −2',
    effects: { soldier: { defense: 2 }, tank: { range: -2 } },
  },
  water: { name: '水道', rule: '士兵和运输车不能进入，坦克可以涉水，所有单位都能走桥', blocks: ['soldier', 'truck'], effects: {} },
  lake: { name: '湖泊', rule: '士兵和运输车不能进入，坦克可以涉水', blocks: ['soldier', 'truck'], effects: {} },
  bridge: { ...dry, name: '桥', rule: '横跨水道的通道，所有地面单位都可以通过' },
};

// ---------------------------------------------------------------------------
// The aliens
// ---------------------------------------------------------------------------

/** Aliens hit anything: nothing about them plays by the terrain rules. */
const alienFoe: TargetClass[] = ['ground', 'air', 'building'];

export const ALIENS: Record<AlienKey, AlienDef> = {
  chloe: {
    key: 'chloe',
    name: '克洛伊',
    look: '紫色的大眼怪物',
    desc: '没有特殊能力，但生命值是外星人里最高的。',
    hp: 90,
    attack: 13,
    shots: 1,
    defense: 4,
    range: 2,
    move: 2,
    canHit: alienFoe,
    reward: { ore: 1500, oil: 1000, meat: 1000 },
    bounty: 400,
    fx: 'alien',
    color: '#a78bfa',
  },
  kuide: {
    key: 'kuide',
    name: '奎德',
    look: '大型蜘蛛',
    desc: '每回合孵出 1–3 只小蜘蛛。小蜘蛛只有 3 点生命，但会四面出击。',
    hp: 50,
    attack: 5,
    shots: 1,
    defense: 5,
    range: 1,
    move: 3,
    canHit: alienFoe,
    reward: { ore: 1200, oil: 800, meat: 800 },
    bounty: 300,
    fx: 'bullet',
    color: '#e879f9',
    brood: [1, 3],
  },
  meiling: {
    key: 'meiling',
    name: '牛美菱',
    look: '双马尾的小女孩',
    desc: '隔着 4 格就能开火，攻击力高，生命值低。',
    hp: 35,
    attack: 10,
    shots: 1,
    defense: 2,
    range: 4,
    move: 3,
    canHit: alienFoe,
    reward: { ore: 1000, oil: 700, meat: 700 },
    bounty: 250,
    fx: 'laser',
    color: '#fb7185',
  },
  shentan: {
    key: 'shentan',
    name: '神坦',
    look: '巨型坦克',
    desc: '3 格射程，也能近战；攻防都是外星人里最高的，但每回合只走 1 格。',
    hp: 60,
    attack: 15,
    shots: 1,
    defense: 8,
    range: 3,
    move: 1,
    canHit: alienFoe,
    reward: { ore: 1800, oil: 1200, meat: 1200 },
    bounty: 450,
    fx: 'shell',
    color: '#f97316',
  },
  guimei: {
    key: 'guimei',
    name: '鬼魅',
    look: '白色的鬼魂',
    desc: '瞬移：每回合出现在不同的地方，攻击之后立刻消失。',
    hp: 30,
    attack: 13,
    shots: 1,
    defense: 2,
    range: 1,
    move: 0,
    canHit: alienFoe,
    reward: { ore: 1000, oil: 700, meat: 700 },
    bounty: 250,
    fx: 'alien',
    color: '#e5e7eb',
    teleports: true,
  },
};

/** The order the aliens do not come in: one is drawn at random each time. */
export const ALIEN_KEYS = Object.keys(ALIENS) as AlienKey[];

/** The small spiders 奎德 hatches. They pick their own targets at random. */
export const SPIDERLING: SpiderlingDef = {
  name: '小蜘蛛',
  hp: 3,
  attack: 2,
  shots: 1,
  defense: 1,
  range: 1,
  move: 3,
  canHit: alienFoe,
  reward: { ore: 60, oil: 40, meat: 40 },
  fx: 'bullet',
};

/** How many small spiders one 奎德 may have walking at once. */
export const BROOD_CAP = 8;

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** Points for destroying one unit of a kind. Trucks never fight, so they are worth nothing. */
export const SCORE_UNIT: Record<UnitKey, number> = {
  truck: 0,
  infantry: 20,
  sniper: 30,
  atSoldier: 30,
  tank: 40,
  twinTank: 60,
  aaTank: 50,
  missileTank: 70,
  laserTank: 80,
  apocalypse: 120,
  fighter: 70,
};

/** Points for destroying one building of a kind. */
export const SCORE_BUILDING: Record<BuildingKey, number> = {
  hq: 300,
  powerPlant: 30,
  factory: 40,
  defenseNet: 0,
  barracks: 40,
  warFactory: 60,
  airport: 60,
  turret: 40,
  aaGun: 40,
};

/** Extra points for the player who lands the blow that finishes an alien. */
export const SCORE_LAST_HIT = 100;
/** Points for squashing one small spider. */
export const SCORE_SPIDER = 10;

export function totalCost(c: Cost): number {
  return (c.ore ?? 0) + (c.oil ?? 0) + (c.meat ?? 0);
}

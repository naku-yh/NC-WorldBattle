import type {
  AlienDef,
  AlienKey,
  AlienShape,
  BuildingDef,
  CityKind,
  Difficulty,
  BuildingKey,
  Cost,
  ResourceKey,
  MinionDef,
  MinionKind,
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
/** The huge board is nearly twice the medium one: room for the houses and towers between the bases. */
export const HUGE_SIZE = 35;
/** From the large board up, houses and towers stand about the battlefield for soldiers to move into. */
export const CITY_MIN_SIZE = LARGE_SIZE;
export const MAP_SIZES = [
  { key: 'medium', name: '中型', size: BOARD_SIZE },
  { key: 'large', name: '大型', size: LARGE_SIZE },
  { key: 'huge', name: '超大型', size: HUGE_SIZE },
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
/** What every player, computer ones included, starts out with under each difficulty. */
export const START_RESOURCES: Record<Difficulty, Record<ResourceKey, number>> = {
  low: { ore: 500, oil: 500, meat: 500 },
  high: { ore: 300, oil: 250, meat: 250 },
};
export const DIFFICULTIES: Array<{ key: Difficulty; name: string }> = [
  { key: 'low', name: '低难度' },
  { key: 'high', name: '高难度' },
];
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
/**
 * Action points by place in the dice, for two, three and four players. With four
 * everyone is placed, so the points run down the list; with fewer, the players
 * between the top and the bottom get nothing.
 */
export const AP_BY_RANK: Record<number, number[]> = {
  2: [AP_TOP, AP_BOTTOM],
  3: [AP_TOP, 0, AP_BOTTOM],
  4: [AP_TOP, 2, 1, 0],
};
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
    cost: { ore: 100, oil: 50 },
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
    desc: '便宜耐用的基础步兵，可以进驻房屋。',
    cost: { ore: 100, meat: 100 },
    hp: 6,
    attack: 3,
    shots: 1,
    defense: 1,
    range: 2,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'bullet',
    producedBy: 'barracks',
    garrison: true,
  },
  sniper: {
    key: 'sniper',
    name: '狙击手',
    desc: '射程 6，对步兵双倍伤害，可以进驻房屋。',
    cost: { ore: 280, oil: 50, meat: 150 },
    hp: 5,
    attack: 5,
    shots: 1,
    defense: 1,
    range: 6,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'bullet',
    // Every foot soldier there is: infantry, snipers, anti-tank soldiers and special forces alike.
    doubleVs: ['soldier'],
    producedBy: 'barracks',
    garrison: true,
  },
  atSoldier: {
    key: 'atSoldier',
    name: '反坦克战士',
    desc: '对坦克双倍伤害，可以进驻房屋。',
    cost: { ore: 400, oil: 200, meat: 150 },
    hp: 6,
    attack: 4,
    shots: 1,
    defense: 1,
    range: 3,
    move: 3,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'missile',
    doubleVs: ['tank'],
    producedBy: 'barracks',
    garrison: true,
  },
  specOps: {
    key: 'specOps',
    name: '特种部队',
    desc: '对外星人双倍伤害；装备太重，无法进驻建筑。',
    cost: { ore: 600, oil: 300, meat: 200 },
    hp: 15,
    attack: 8,
    shots: 1,
    defense: 4,
    range: 4,
    move: 4,
    unitClass: 'ground',
    family: 'soldier',
    canHit: ['ground', 'building'],
    fx: 'bullet',
    doubleVs: ['alien'],
    producedBy: 'barracks',
  },
  mech: {
    key: 'mech',
    name: '人形机甲',
    desc: '对空对地的步行机甲，按坦克规则受地形影响，无法进驻建筑。',
    cost: { ore: 2300, oil: 1100, meat: 300 },
    hp: 30,
    attack: 13,
    shots: 1,
    defense: 6,
    range: 3,
    move: 4,
    // It walks, but it is armoured plate all through: it fords water and takes tank ground like any tank.
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'air', 'building'],
    fx: 'shell',
    producedBy: 'barracks',
  },
  tank: {
    key: 'tank',
    name: '坦克',
    desc: '装甲主力，步兵打不动它。',
    cost: { ore: 200, oil: 150 },
    hp: 15,
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
  // What a unit with more than one shot does in a turn is its attack times its shots: the twin's 5 × 2 and the
  // Apocalypse's 9 × 2 are what the figures "10" and "18" on the cards stand for.
  twinTank: {
    key: 'twinTank',
    name: '双管坦克',
    desc: '每回合开两炮，打薄皮目标特别狠。',
    cost: { ore: 550, oil: 250 },
    hp: 22,
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
    desc: '对空攻击翻倍，也能打地面。',
    cost: { ore: 650, oil: 300 },
    hp: 16,
    attack: 5,
    // Twice the attack against anything in the air.
    airAttack: 10,
    shots: 1,
    defense: 3,
    range: 4,
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
    desc: '射程 5，能在炮台射程外开火；导弹十字溅射，上下左右四格各受一半伤害。',
    cost: { ore: 880, oil: 450 },
    hp: 15,
    attack: 14,
    shots: 1,
    defense: 2,
    range: 5,
    move: 3,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'building'],
    fx: 'missile',
    splash: 'cross',
    producedBy: 'warFactory',
  },
  laserTank: {
    key: 'laserTank',
    name: '激光坦克',
    desc: '破甲：激光无视目标防御值。',
    cost: { ore: 1200, oil: 650 },
    hp: 20,
    attack: 12,
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
    desc: '双炮塔重装巨兽，攻防俱佳，也能对空。',
    cost: { ore: 2200, oil: 1300, meat: 150 },
    hp: 40,
    attack: 9,
    // 4 a shell against aircraft, so 8 for the turn.
    airAttack: 4,
    shots: 2,
    defense: 5,
    range: 3,
    move: 3,
    unitClass: 'ground',
    family: 'tank',
    canHit: ['ground', 'air', 'building'],
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
  bomber: {
    key: 'bomber',
    name: '轰炸机',
    desc: '空中单位，只对地；炸十字：目标上下左右四格各受一半伤害。',
    cost: { ore: 800, oil: 1500 },
    hp: 20,
    attack: 16,
    shots: 1,
    defense: 3,
    range: 1,
    move: 4,
    unitClass: 'air',
    family: 'air',
    canHit: ['ground', 'building'],
    fx: 'bomb',
    splash: 'cross',
    producedBy: 'airport',
  },
};

/** Display order for production lists. */
export const PRODUCED_UNITS: Record<Exclude<BuildingKey, 'hq' | 'powerPlant' | 'defenseNet' | 'turret' | 'aaGun'>, UnitKey[]> = {
  factory: ['truck'],
  barracks: ['infantry', 'sniper', 'atSoldier', 'specOps', 'mech'],
  warFactory: ['tank', 'twinTank', 'aaTank', 'missileTank', 'laserTank', 'apocalypse'],
  airport: ['fighter', 'bomber'],
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
    desc: '训练步兵、狙击手、反坦克战士、特种部队和人形机甲，每回合最多 4 名。',
    w: 2,
    h: 1,
    hp: 30,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '军营', cost: { ore: 400, oil: 200, meat: 300 }, ...noCombat }],
    canHit: [],
    produces: ['infantry', 'sniper', 'atSoldier', 'specOps', 'mech'],
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
    desc: '生产并停靠战斗机与轰炸机，每座每种最多 4 架。',
    w: 2,
    h: 2,
    hp: 40,
    needsPower: true,
    providesPower: 0,
    levels: [{ name: '军事机场', cost: { ore: 900, oil: 600, meat: 200 }, ...noCombat }],
    canHit: [],
    produces: ['fighter', 'bomber'],
    perTurnCap: 0,
    capPerBuilding: FIGHTERS_PER_AIRPORT,
  },
  defenseNet: {
    key: 'defenseNet',
    name: '防御网',
    desc: '覆盖整个基地的力场穹顶：敌方每单位每次攻击先被抵扣 2 点攻击力。可升级 4 次，抵扣逐级提高。',
    w: 0,
    h: 0,
    hp: 0,
    needsPower: true,
    providesPower: 0,
    // Five rungs. Each upgrade costs 150% of the one before it (rounded to 5);
    // what the net absorbs doubles every two rungs.
    levels: [
      { name: '防御网', cost: { ore: 300 }, defense: 2, attack: 0, shots: 0, range: 0 },
      { name: '强化防御网', cost: { ore: 450 }, defense: 3, attack: 0, shots: 0, range: 0 },
      { name: '高级防御网', cost: { ore: 675 }, defense: 4, attack: 0, shots: 0, range: 0 },
      { name: '超级防御网', cost: { ore: 1015 }, defense: 6, attack: 0, shots: 0, range: 0 },
      { name: '终极防御网', cost: { ore: 1520 }, defense: 8, attack: 0, shots: 0, range: 0 },
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
// The houses and towers of the larger maps
// ---------------------------------------------------------------------------

/** The two sorts of building that stand about the large and huge maps. Nobody's, until a soldier moves in. */
export const CITY: Record<CityKind, { name: string; hp: number; defense: number; room: number }> = {
  house: { name: '单层房屋', hp: 10, defense: 5, room: 1 },
  tower: { name: '高层大厦', hp: 10, defense: 5, room: 3 },
};
/** A weapon inside a building reaches no further than this, however long its arm. */
export const CITY_RANGE = 3;
/** What everyone inside loses when the building comes down round them. */
export const CITY_CRUSH = 3;
/** How many tiles clear of every base zone (the ring an upgraded one adds included) the buildings keep. */
export const CITY_CLEAR = 3;
/** How many of each sort a map of `size` tiles on a side is given. */
export const CITY_COUNT: Record<number, { house: number; tower: number }> = {
  [LARGE_SIZE]: { house: 5, tower: 3 },
  [HUGE_SIZE]: { house: 10, tower: 6 },
};

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

/** Aliens that strike at anything: nothing about them plays by the terrain rules. */
const alienFoe: TargetClass[] = ['ground', 'air', 'building'];
/** Aliens that keep to the ground: aircraft are out of their reach, buildings are not. */
const groundFoe: TargetClass[] = ['ground', 'building'];

/**
 * The aliens as they arrive. The first five are the ones everyone knows of.
 * The last three are the hidden ones, each written here as it first shows
 * itself, with what it turns into once it is down in `SECOND_FORMS`.
 */
export const ALIENS: Record<AlienKey, AlienDef> = {
  chloe: {
    key: 'chloe',
    name: '克洛伊',
    look: '紫色的大眼怪物',
    desc: '没有特殊能力，但生命值是外星人里最高的。',
    hp: 135,
    attack: 13,
    shots: 1,
    defense: 4,
    range: 2,
    move: 2,
    canHit: groundFoe,
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
    hp: 75,
    attack: 5,
    shots: 1,
    defense: 5,
    range: 1,
    move: 3,
    canHit: groundFoe,
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
    hp: 53,
    attack: 10,
    shots: 1,
    defense: 2,
    range: 4,
    move: 3,
    canHit: groundFoe,
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
    hp: 90,
    attack: 15,
    shots: 1,
    defense: 8,
    range: 3,
    // Against aircraft its guns reach only two tiles out.
    airRange: 2,
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
    hp: 45,
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
  // The hidden ones. What they say of themselves stops short of all of it: see `SECOND_FORMS`.
  tuolong: {
    key: 'tuolong',
    name: '拓龙',
    look: '绿色的恐龙',
    desc: '只扑地面上的目标，跑得飞快。传说把它放倒的那个人，看到的只是故事的开始。',
    hp: 45,
    attack: 12,
    shots: 1,
    defense: 10,
    range: 2,
    move: 4,
    canHit: groundFoe,
    changes: true,
    reward: { ore: 2000, oil: 1400, meat: 1400 },
    bounty: 600,
    fx: 'alien',
    color: '#22c55e',
  },
  zecan: {
    key: 'zecan',
    name: '泽参',
    look: '岩石巨人',
    desc: '硬得离谱的石头巨人，走得很慢。砸碎过它的那些人，后来都不愿再提那一战。',
    hp: 100,
    attack: 10,
    shots: 1,
    defense: 18,
    range: 2,
    move: 2,
    canHit: groundFoe,
    splits: 2,
    reward: { ore: 1800, oil: 1200, meat: 1200 },
    bounty: 550,
    fx: 'shell',
    color: '#a8a29e',
  },
  yaqian: {
    key: 'yaqian',
    name: '雅千',
    look: '悬在空中的女神',
    desc: '裹在白色的能量护盾里，地面武器够不着她；打她一下，她会立刻还手。护盾里还蓄着什么，每隔两回合，最好离远一点。',
    hp: 75,
    attack: 15,
    shots: 1,
    defense: 12,
    range: 3,
    move: 4,
    canHit: alienFoe,
    flies: true,
    // What she strikes back with, whoever strikes her and from wherever.
    counter: 6,
    // Her energy goes every other round, over the nine tiles round and under her.
    burst: { every: 2, power: 8, reach: 1 },
    reward: { ore: 2200, oil: 1500, meat: 1500 },
    bounty: 650,
    fx: 'laser',
    color: '#fde68a',
  },
};

/** The five aliens that turn up in any order, the first arrival included. */
export const ALIEN_KEYS: readonly AlienKey[] = ['chloe', 'kuide', 'meiling', 'shentan', 'guimei'];
/** The three hidden ones: never the first to arrive, and each with more to it than meets the eye. */
/** The three hidden ones: never the first to arrive, and each with more to it than meets the eye. */
export const HIDDEN_KEYS: readonly AlienKey[] = ['tuolong', 'zecan', 'yaqian'];
export const isHidden = (key: AlienKey): boolean => HIDDEN_KEYS.includes(key);
/**
 * How likely an alien is to be one of the hidden ones, each time one arrives
 * once the first has come: rather more often than not there is one in a match,
 * and hardly ever two at once on the board.
 */
export const HIDDEN_CHANCE = 0.35;

/**
 * What the hidden ones become once they are down. A changer takes its second
 * shape where it stood; a splitter breaks into as many of its second shape as
 * there is room for round about it. Neither has paid anything out by then.
 */
export const SECOND_FORMS: Partial<Record<AlienKey, AlienShape>> = {
  tuolong: {
    name: '拓龙',
    look: '黑色的飞龙',
    desc: '腾空而起，对空对地喷出火球；火球落点上下左右四格里的东西也被波及。',
    hp: 45,
    attack: 18,
    shots: 1,
    defense: 6,
    range: 3,
    move: 6,
    canHit: alienFoe,
    flies: true,
    splash: 'cross',
    fx: 'bomb',
    color: '#f43f5e',
  },
  zecan: {
    name: '小岩石巨人',
    look: '碎裂出来的小个子岩石巨人',
    desc: '泽参碎成的小块，一样只打地面，一样硬得咬不动。',
    hp: 30,
    attack: 5,
    shots: 1,
    defense: 10,
    range: 2,
    move: 2,
    canHit: groundFoe,
    fx: 'shell',
  },
};

/**
 * How much stronger each alien to arrive is than the one before, as a share of
 * its card's life, attack and defence: the first has the figures above, the
 * second a fifth more, the third two fifths, and so on. The hidden ones grow
 * the same way, and so does what they turn into.
 */
export const ALIEN_GROWTH = 0.2;

/** The small spiders 奎德 hatches. They pick their own targets at random. */
export const SPIDERLING: MinionDef = {
  name: '小蜘蛛',
  hp: 3,
  attack: 4,
  shots: 1,
  defense: 1,
  range: 1,
  move: 3,
  canHit: groundFoe,
  reward: { ore: 60, oil: 40, meat: 40 },
  fx: 'bullet',
};

/** The skeletons that get up where foot soldiers fall to 雅千's energy. Like the spiders, they go for whatever is in reach. */
export const SKELETON: MinionDef = {
  name: '骷髅士兵',
  hp: 2,
  attack: 2,
  shots: 1,
  defense: 0,
  range: 1,
  move: 1,
  canHit: groundFoe,
  reward: { ore: 60, oil: 40, meat: 40 },
  fx: 'bullet',
};

/** Every kind of the aliens' small fry, by the `kind` on one of them. */
export const MINIONS: Record<MinionKind, MinionDef> = { spider: SPIDERLING, skeleton: SKELETON };

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

/**
 * The ranks a fighting unit holds, in order, and what each one comes to over
 * the card's figures. Every unit is mustered as the first.
 */
export const RANKS: ReadonlyArray<{ name: string; power: number; armor: number }> = [
  { name: '下士', power: 1, armor: 0 },
  // A half again as much attack and life, and four more points of armour.
  { name: '中士', power: 1.5, armor: 4 },
  // Twice the attack and life, and ten more points of armour.
  { name: '上士', power: 2, armor: 10 },
];

/** What each promotion costs, as a share of the unit's own price: as much again for the first, half as much again for the second. */
export const PROMOTE_COST = [1, 1.5];

/** How much small fry one alien may have on the board at once: 奎德's spiders, 雅千's skeletons. */
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
  bomber: 90,
  specOps: 50,
  mech: 110,
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
/** Points for squashing one small spider or one skeleton. */
export const SCORE_SPIDER = 10;

export function totalCost(c: Cost): number {
  return (c.ore ?? 0) + (c.oil ?? 0) + (c.meat ?? 0);
}

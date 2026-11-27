export type ResourceKey = 'ore' | 'oil' | 'meat';
export type Cost = Partial<Record<ResourceKey, number>>;
export type Resources = Record<ResourceKey, number>;

export type BuildingKey =
  | 'hq'
  | 'powerPlant'
  | 'factory'
  | 'barracks'
  | 'warFactory'
  | 'airport'
  | 'defenseNet'
  | 'turret'
  | 'aaGun';

export type UnitKey =
  | 'truck'
  | 'infantry'
  | 'sniper'
  | 'atSoldier'
  | 'tank'
  | 'twinTank'
  | 'aaTank'
  | 'missileTank'
  | 'laserTank'
  | 'apocalypse'
  | 'fighter';

/** What a weapon is allowed to shoot at. */
export type TargetClass = 'ground' | 'air' | 'building';
export type UnitClass = 'ground' | 'air';
export type AttackStyle = 'bullet' | 'shell' | 'laser' | 'missile' | 'flak' | 'bomb' | 'alien';

/** What a unit is, for terrain rules. */
export type UnitFamily = 'soldier' | 'tank' | 'truck' | 'air';
/** How a unit gets about. Tracks can ford water; feet need a bridge; wings ignore the whole affair. */
export type MoveMode = 'foot' | 'track' | 'air';

export type Terrain = 'plain' | 'hill' | 'forest' | 'water' | 'lake' | 'bridge';
/** How one kind of ground changes the units standing on it. */
export interface TerrainEffect {
  attack?: number;
  defense?: number;
  range?: number;
}
export interface TerrainDef {
  name: string;
  /** The rule in one line, for the UI. */
  rule: string;
  effects: Partial<Record<UnitFamily, TerrainEffect>>;
  /** Families that cannot enter. */
  blocks: UnitFamily[];
}
/** Which way the waterway runs across the board. */
export type Waterway = 'vertical' | 'horizontal';

export interface CombatStats {
  attack: number;
  shots: number;
  defense: number;
  range: number;
  canHit: TargetClass[];
  pierce?: boolean;
}

export interface UnitDef extends CombatStats {
  key: UnitKey;
  name: string;
  desc: string;
  cost: Cost;
  hp: number;
  move: number;
  unitClass: UnitClass;
  family: UnitFamily;
  fx: AttackStyle;
  producedBy?: BuildingKey;
}

export interface BuildingLevel {
  name: string;
  cost: Cost;
  defense: number;
  attack: number;
  shots: number;
  range: number;
}

export interface BuildingDef {
  key: BuildingKey;
  name: string;
  desc: string;
  /** Footprint in tiles. 0x0 means the building takes no tile (defense net). */
  w: number;
  h: number;
  hp: number;
  needsPower: boolean;
  /** Power slots this building provides. */
  providesPower: number;
  /** [level 1, level 2 (upgrade)] */
  levels: BuildingLevel[];
  canHit: TargetClass[];
  produces: UnitKey[];
  /** Max units of each type a single building may produce per turn. */
  perTurnCap: number;
  /** Max living units of each type per building (parking capacity). */
  capPerBuilding: number;
  maxCount?: number;
  /** Placed on the side facing the battlefield rather than tucked in the back. */
  front?: boolean;
}

export interface Building {
  id: number;
  key: BuildingKey;
  level: 1 | 2;
  hp: number;
  maxHp: number;
  /** Anchor = top-left tile in board coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  powered: boolean;
  /** Fired on its owner's turn this turn. */
  fired: boolean;
  /** Already retaliated during the current enemy turn. */
  reacted: boolean;
}

export interface Unit {
  id: number;
  key: UnitKey;
  owner: number;
  x: number;
  y: number;
  hp: number;
  moveUsed: boolean;
  attackUsed: boolean;
}

export interface DiceEntry {
  player: number;
  /** First roll plus any tie-break re-rolls. */
  rolls: number[];
  ap: number;
  rank: number;
}

/** The five aliens that may turn up. */
export type AlienKey = 'chloe' | 'kuide' | 'meiling' | 'shentan' | 'guimei';

export interface AlienDef extends CombatStats {
  key: AlienKey;
  name: string;
  /** What it looks like, for the lists. */
  look: string;
  desc: string;
  hp: number;
  move: number;
  /** Resources handed out when it goes down, split by the damage each player did. */
  reward: Cost;
  /** Points split by damage when it goes down, on top of the points for the last hit. */
  bounty: number;
  /** Colour it is drawn and labelled in. */
  color: string;
  /** How many small spiders it hatches a turn, if any. */
  brood?: [number, number];
  /** Moves by appearing somewhere else instead of walking. */
  teleports?: boolean;
  /** How its shots are drawn. */
  fx: AttackStyle;
}

/** What a small spider can do. */
export interface SpiderlingDef extends CombatStats {
  name: string;
  hp: number;
  move: number;
  /** Resources for whoever squashes it. */
  reward: Cost;
  fx: AttackStyle;
}

/** One alien on the board. */
export interface AlienState {
  id: number;
  key: AlienKey;
  x: number;
  y: number;
  hp: number;
  /** The round it turned up in. */
  arrived: number;
  /** Damage each player has done to it so far, by player id. */
  hurt: Record<number, number>;
}

/** A small spider hatched by 奎德. */
export interface Spiderling {
  id: number;
  /** The alien that hatched it. */
  owner: number;
  x: number;
  y: number;
  hp: number;
}

export interface PlayerState {
  id: number;
  name: string;
  kind: 'human' | 'ai';
  color: string;
  alive: boolean;
  corner: number;
  resources: Resources;
  ap: number;
  trucks: number;
  buildings: Building[];
  units: Unit[];
  powerCap: number;
  powerUsed: number;
  producedThisTurn: Partial<Record<BuildingKey, number>>;
  /** Points towards the final result. */
  score: number;
  damageDealt: number;
  kills: number;
}

export interface ResourceNode {
  x: number;
  y: number;
  resource: ResourceKey;
  corner: number;
  /** The supply lane trucks use to reach it: along the zone's top row or down its outer column. */
  lane: 'row' | 'col';
}

/** One of the four base-zone corners of the board. */
export interface Corner {
  /** Outermost tile of the corner. */
  ox: number;
  oy: number;
  /** Direction pointing into the board. */
  dx: 1 | -1;
  dy: 1 | -1;
  label: string;
}

export type Tone = 'info' | 'combat' | 'good' | 'bad' | 'warn';
export interface LogEntry {
  id: number;
  text: string;
  tone: Tone;
  player?: number;
}

export type Phase = 'roundStart' | 'dice' | 'aliens' | 'player' | 'gameover';

export interface RankingEntry {
  player: number;
  alive: boolean;
  score: number;
  baseHp: number;
  attack: number;
  units: number;
}

export interface GameState {
  rng: number;
  nextId: number;
  boardSize: number;
  /** The four corners, in board order: south-west, south-east, north-west, north-east. */
  corners: Corner[];
  /** Terrain per tile, row by row: `terrain[y * boardSize + x]`. */
  terrain: Terrain[];
  waterway: Waterway;
  totalTurns: number;
  /** Current round number, 1-based. */
  turn: number;
  phase: Phase;
  currentPlayer: number;
  /** Player ids in play order for this round (best roll first). */
  order: number[];
  orderIndex: number;
  /** The aliens have had their go this round. */
  alienActed: boolean;
  dice: DiceEntry[];
  players: PlayerState[];
  nodes: ResourceNode[];
  aliens: AlienState[];
  /** Small spiders on the board. */
  brood: Spiderling[];
  /** The round in which the next alien is due. */
  nextAlien: number;
  /** How many aliens have arrived over the whole match. */
  aliensSeen: number;
  log: LogEntry[];
  logId: number;
  ranking: RankingEntry[];
  gameOverReason: string;
}

export interface Pt {
  x: number;
  y: number;
}

export interface EntityRef {
  kind: 'unit' | 'building' | 'alien' | 'spider';
  id: number;
}

export type GameEvent =
  | { type: 'roundStart'; turn: number }
  | { type: 'dice'; turn: number; dice: DiceEntry[] }
  | { type: 'alienSpawn'; id: number; key: AlienKey; x: number; y: number }
  | { type: 'expand'; player: number; buildingId: number }
  /** A player gained points. */
  | { type: 'score'; player: number; amount: number }
  | { type: 'turnStart'; player: number }
  | { type: 'harvest'; player: number; resource: ResourceKey; amount: number; trucks: number }
  | { type: 'build'; player: number; buildingId: number }
  | { type: 'upgrade'; player: number; buildingId: number }
  | { type: 'produce'; player: number; unitId: number; unitKey: UnitKey }
  | { type: 'hatch'; owner: number; ids: number[] }
  | { type: 'move'; unitId: number; path: Pt[] }
  /** Something vanished from one tile and appeared on another. */
  | { type: 'warp'; target: EntityRef; from: Pt; to: Pt }
  | { type: 'attack'; source: EntityRef; target: EntityRef; from: Pt; to: Pt; shots: number; style: AttackStyle }
  | { type: 'damage'; target: EntityRef; amount: number; pos: Pt }
  | { type: 'destroyed'; target: EntityRef; pos: Pt }
  | { type: 'eliminated'; player: number }
  | { type: 'alienKilled'; id: number; key: AlienKey; rewards: Record<number, Cost>; points: Record<number, number> }
  | { type: 'gameOver'; reason: string };

export type Action =
  | { type: 'ROLL_DICE' }
  | { type: 'NEXT' }
  | { type: 'END_TURN' }
  | { type: 'HARVEST'; resource: ResourceKey }
  /** Without `x`/`y` the building is placed automatically (computer players); with them it is the player's choice. */
  | { type: 'BUILD'; key: BuildingKey; x?: number; y?: number }
  | { type: 'UPGRADE'; buildingId: number }
  | { type: 'PRODUCE'; unit: UnitKey }
  | { type: 'MOVE'; unitId: number; x: number; y: number }
  | { type: 'ATTACK'; source: { kind: 'unit' | 'building'; id: number }; target: EntityRef };

export interface GameConfig {
  /** One entry per player: seat 0 first. 2–4 entries. */
  seats: ('human' | 'ai')[];
  totalTurns: number;
  seed?: number;
  /** Board edge in tiles. Defaults to the medium map. */
  size?: number;
  /** 'random' lays down a waterway with bridges, lakes, woods and hills; 'plain' is bare grass. */
  terrain?: 'random' | 'plain';
}

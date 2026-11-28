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
  | 'specOps'
  | 'mech'
  | 'tank'
  | 'twinTank'
  | 'aaTank'
  | 'missileTank'
  | 'laserTank'
  | 'apocalypse'
  | 'fighter'
  | 'bomber';

/** What a weapon is allowed to shoot at. */
export type TargetClass = 'ground' | 'air' | 'building';
export type UnitClass = 'ground' | 'air';
export type AttackStyle = 'bullet' | 'shell' | 'laser' | 'missile' | 'flak' | 'bomb' | 'alien' | 'spit' | 'fire' | 'light';
/** What some weapons hit twice as hard: the soldiers, the tanks, or the aliens (small spiders included). */
export type BonusClass = 'soldier' | 'tank' | 'alien';

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
  /** Attack against anything but aircraft, per shot. */
  attack: number;
  shots: number;
  /** Attack against aircraft instead of `attack`, per shot. Left out by weapons that have nothing special for them. */
  airAttack?: number;
  defense: number;
  range: number;
  canHit: TargetClass[];
  pierce?: boolean;
  /** Twice the attack against these. */
  doubleVs?: BonusClass[];
  /** The four tiles round the target, up, down, left and right, take half the attack too. */
  splash?: 'cross';
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
  /** May move into one of the map's houses and towers and shoot from inside it. */
  garrison?: boolean;
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
  /** Rung 1 is what gets built; every rung after it is one upgrade. */
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
  /** 1-based rung on the ladder in `BuildingDef.levels`: 1 is what gets built, each one after it an upgrade. */
  level: number;
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
  /** Standing inside this map building (see `CityBuilding`): off the board, safe from anything but the walls coming down. */
  inside?: number;
  /** Its rank, from 1: a fighting unit grows stronger with each one (see `RANKS`). Left out by files from before there were ranks, and so the first. */
  rank?: number;
}

/** The two sorts of building that stand about the larger maps, for soldiers to move into. */
export type CityKind = 'house' | 'tower';

/** A house or tower on the map, belonging to whoever's soldiers hold it. */
export interface CityBuilding {
  id: number;
  kind: CityKind;
  x: number;
  y: number;
  hp: number;
  /** The units inside, in the order they came in. They keep their own entry under their player's units. */
  occupants: number[];
}

export interface DiceEntry {
  player: number;
  /** First roll plus any tie-break re-rolls. */
  rolls: number[];
  ap: number;
  rank: number;
}

/** The eight aliens that may turn up: the five everyone knows of, and three hidden ones (see `HIDDEN_KEYS`). */
export type AlienKey = 'chloe' | 'kuide' | 'meiling' | 'shentan' | 'guimei' | 'tuolong' | 'zecan' | 'yaqian';

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
  /** Hovers in the air: nothing but anti-air weapons can reach it. */
  flies?: boolean;
  /** How far it reaches against aircraft when that is shorter than `range`. */
  airRange?: number;
  /** Down is not out: it rises at once in its second shape (see `SECOND_FORMS`), and is only beaten when that goes down too. */
  changes?: boolean;
  /** Down is not out: it breaks into this many of its second shape, and is only beaten once every one of them has gone down. */
  splits?: number;
/** The attack it strikes back with, at once, at whatever struck it from however far away. Left out by whatever never strikes back. */
  counter?: number;
  /** Every so many rounds it lets its energy go over the tiles round it, for `power` against everything caught, before its own defence. */
  burst?: { every: number; power: number; reach: number };
  /** How its shots are drawn. */
  fx: AttackStyle;
}

/**
 * A hidden alien's second shape: everything about it but what it is worth.
 * The reward and the bounty stay what the first shape's card says, and so does
 * the colour unless the shape brings one of its own.
 */
export type AlienShape = Omit<AlienDef, 'key' | 'color' | 'reward' | 'bounty'> & { color?: string };

/** The aliens' small fry: the spiders 奎德 hatches, and the skeletons that get up where soldiers fall to 雅千's energy. */
export type MinionKind = 'spider' | 'skeleton';

/** What one of the aliens' small fry can do. */
export interface MinionDef extends CombatStats {
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
  /** Which arrival it was in this match, from 1. Every one after the first is stronger than the last (see `alienStats`). */
  wave: number;
  /** Damage each player has done to it so far, by player id. */
  hurt: Record<number, number>;
  /** Which shape it is in: left out or 1 as it arrived, 2 once it has changed shape or been split off one that did. */
  form?: number;
  /**
   * What players did to what it came from, by player id: 拓龙's first shape, or 泽参's first shape and the
   * small giants that have already fallen. It is paid out only once the last of the lot is down.
   */
  carried?: Record<number, number>;
}

/** A small spider hatched by 奎德, or a skeleton 雅千 raised. */
export interface Minion {
  id: number;
  /** The alien it belongs to. */
  owner: number;
  x: number;
  y: number;
  hp: number;
  /** Left out by files from before there were skeletons: that is a spider. */
  kind?: MinionKind;
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

/** How hard the computer players make it, and what everyone starts out with. */
export type Difficulty = 'low' | 'high';

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
  /** The aliens' small fry on the board: small spiders and skeletons. */
  brood: Minion[];
  /** The round in which the next alien is due. */
  nextAlien: number;
  /** How many aliens have arrived over the whole match. */
  aliensSeen: number;
  /** The houses and towers standing about the larger maps; none on a medium or plain one. */
  city: CityBuilding[];
  difficulty: Difficulty;
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
  /** `brood` is any of the aliens' small fry, spiders and skeletons alike. */
  kind: 'unit' | 'building' | 'alien' | 'brood' | 'city';
  id: number;
}

/** One more thing a splash weapon caught beside what it was aimed at. */
export interface SplashHit {
  target: EntityRef;
  amount: number;
  pos: Pt;
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
  /** A unit has been raised to the next rank. */
  | { type: 'promote'; player: number; unitId: number; rank: number }
  | { type: 'hatch'; owner: number; ids: number[] }
  /** Skeletons have got up where soldiers fell. */
  | { type: 'raise'; owner: number; ids: number[] }
  /** An alien has taken its second shape where it stood. */
  | { type: 'morph'; id: number; key: AlienKey; x: number; y: number }
  /** An alien has broken apart into pieces, each of its second shape: `ids` are the new ones. */
  | { type: 'split'; from: number; key: AlienKey; ids: number[] }
  /** An alien let its energy go over the tiles round it: everything `hits` lists took what it says. */
  | { type: 'burst'; source: EntityRef; at: Pt; hits: SplashHit[] }
  | { type: 'move'; unitId: number; path: Pt[] }
  /** A soldier has walked into a house or tower. */
  | { type: 'garrison'; city: number; unitId: number }
  /** Soldiers have come out of a house or tower, on purpose or because it came down round them. */
  | { type: 'leave'; city: number; units: Array<{ unitId: number; x: number; y: number }> }
  /** Something vanished from one tile and appeared on another. */
  | { type: 'warp'; target: EntityRef; from: Pt; to: Pt }
  /** What the weapon caught on the four tiles round its target, once the shot has landed. */
  | { type: 'attack'; source: EntityRef; target: EntityRef; from: Pt; to: Pt; shots: number; style: AttackStyle; splash?: SplashHit[] }
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
  | { type: 'ATTACK'; source: { kind: 'unit' | 'building'; id: number }; target: EntityRef }
  /** The current player's soldiers leave the house or tower they are in, for the free tiles round about it. */
  | { type: 'LEAVE'; cityId: number }
  /** The current player pays to raise one of their fighting units to the next rank. */
  | { type: 'PROMOTE'; unitId: number };

export interface GameConfig {
  /** One entry per player: seat 0 first. 2–4 entries. */
  seats: ('human' | 'ai')[];
  /** What each seat is called, when the player has typed anything in; otherwise the default names. */
  names?: string[];
  /** Each seat's colour, when it has been picked; otherwise the defaults. */
  colors?: string[];
  totalTurns: number;
  seed?: number;
  /** Board edge in tiles. Defaults to the medium map. */
  size?: number;
  /** 'random' lays down a waterway with bridges, lakes, woods and hills; 'plain' is bare grass. */
  terrain?: 'random' | 'plain';
  /** Defaults to the hard game. */
  difficulty?: Difficulty;
}

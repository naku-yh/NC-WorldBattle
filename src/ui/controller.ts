import * as THREE from 'three';
import { aiDecide } from '../game/ai';
import { toWorld } from '../game/board';
import { BOARD_SIZE, BUILDINGS, UNITS } from '../game/data';
import { attackTargets, buildSpots, buildingById, canBuild, createGame, moveRange, placementError, unitById } from '../game/engine';
import type { Action, BuildingKey, EntityRef, GameConfig, GameEvent, GameState, PlayerState, Pt } from '../game/types';
import { HIGHLIGHT, VIEW_DIR, Scene, worldOf } from '../render/scene';
import type { GameView } from '../render/view';
import { wait } from './dom';
import { Home } from './home';
import { Hud, type Sel, type Tab } from './hud';
import { PauseMenu, openLoadPanel } from './menus';
import { Minimap } from './minimap';
import { Overlays, type SetupState } from './overlays';
import { SAVE_ERROR_TEXT, readSave, writeSave } from './saves';
import { Scores } from './scores';
import { diorama } from './showcase';
import { Store } from './store';

export interface Mounts {
  hud: HTMLElement;
  top: HTMLElement;
  side: HTMLElement;
  log: HTMLElement;
  card: HTMLElement;
  overlay: HTMLElement;
  toast: HTMLElement;
  minimap: HTMLCanvasElement;
  /** Where the title screen goes. */
  home: HTMLElement;
  /** Where the standings go, under the minimap. */
  scores: HTMLElement;
}

/** How far the eye sits when it frames one player's home zone (the whole board is about twice as far). */
const ZOOM = 16;

/** The map behind the title screens. A fixed seed, so the picture is the same each time. */
const SHOWCASE_SEED = 7;
/** Whose bases the title screen shows: all four. */
const SHOWCASE_SEATS = 4;

const TAB_KEYS: Tab[] = ['harvest', 'build', 'produce', 'structures', 'rules'];

/** One camera move: where the eye starts and where it ends up. */
interface Glide {
  from: THREE.Vector3;
  to: THREE.Vector3;
  dir0: THREE.Vector3;
  d0: number;
  d1: number;
  t: number;
}

/**
 * Runs the match: moves it through dice -> alien -> each player in turn, plays
 * the computer players, and forwards the human player's clicks to the rules.
 * It also owns the title screen, the pause menu and the saves.
 */
export class Controller {
  private store: Store | null = null;
  private hud: Hud;
  private overlays: Overlays;
  private home: Home;
  private menu: PauseMenu;
  private minimap: Minimap;
  private scores: Scores;
  private tab: Tab = 'harvest';
  private sel: Sel | null = null;
  private inspect: EntityRef | null = null;
  /** An empty tile clicked just to look at. */
  private tile: Pt | null = null;
  /** The building the player is choosing a spot for. */
  private placing: BuildingKey | null = null;
  private speed = 1;
  /** `${phase}:${player}:${round}` of the phase currently being run. */
  private turnKey = '';
  private down = { x: 0, y: 0, on: false };
  /** Space is held: dragging slides the board instead of turning the camera. */
  private space = false;
  private cam: Glide | null = null;
  private setup: SetupState = { count: 2, seats: ['human', 'ai', 'ai', 'ai'], turns: 20, size: BOARD_SIZE };
  /** The match is paused: the picture stands still and no order goes through. */
  private paused = false;
  private pauseAt = 0;
  /** Running time lost to pauses so far, so paced waits carry on from where they stopped. */
  private pausedFor = 0;
  private wake: Array<() => void> = [];
  /** The slot this match was last saved to or loaded from. */
  private slot: number | null = null;
  /** Something has happened in the match since its last save, so a file would not match it. */
  private unsaved = false;

  constructor(
    private scene: Scene,
    private view: GameView,
    private m: Mounts,
  ) {
    this.overlays = new Overlays(m.overlay, m.toast, (ms) => this.nap(ms));
    this.minimap = new Minimap(m.minimap, () => this.goOverview());
    this.scores = new Scores(m.scores);
    this.hud = new Hud(m.top, m.side, m.log, m.card, {
      setTab: (t) => {
        this.tab = t;
        if (t !== 'build') this.cancelPlace();
        this.render();
      },
      harvest: (res) => void this.dispatch({ type: 'HARVEST', resource: res }),
      build: (k) => this.beginPlace(k),
      produce: (u) => void this.dispatch({ type: 'PRODUCE', unit: u }),
      upgrade: (id) => void this.dispatch({ type: 'UPGRADE', buildingId: id }),
      endTurn: () => void this.endTurn(),
      nextUnit: () => this.nextReady(),
      deselect: () => this.select(null),
      showRules: () => {
        this.tab = 'rules';
        this.cancelPlace();
        this.render();
      },
      overview: () => this.goOverview(),
      menu: () => this.openMenu(),
      toggleSpeed: () => {
        this.speed = this.speed === 1 ? 3 : 1;
        this.syncClock();
        this.render();
      },
      cancelPlace: () => this.cancelPlace(),
    });
    this.home = new Home(m.home, { newGame: () => this.showSetup(), load: () => this.showLoads() });
    this.menu = new PauseMenu(this.overlays, {
      state: () => this.state,
      slot: () => this.slot,
      save: (slot) => this.saveTo(slot),
      unsaved: () => this.unsaved,
      resume: () => this.resume(),
      restart: () => this.again(),
      quit: () => this.showHome(),
    });

    const canvas = scene.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, on: e.button === 0 };
    });
    canvas.addEventListener('pointerup', (e) => {
      // Take the press record and clear it in one step: mutating it in place
      // would also change `d`, since both point at the same object.
      const d = this.down;
      this.down = { x: 0, y: 0, on: false };
      if (!d.on || e.button !== 0) return;
      // A drag orbits (or, with Space, slides) the camera; only a stationary press is a click.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (this.space) return;
      this.click(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.store || this.space) return;
      if (this.placing) {
        this.previewPlace(this.scene.tileAt(e.clientX, e.clientY));
        return;
      }
      const { view, tile } = this.view.pick(e.clientX, e.clientY);
      this.view.setHover(tile);
      canvas.style.cursor = view ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => {
      if (this.placing) this.scene.setGhost([], true);
      this.view.setHover(null);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.placing) this.cancelPlace();
      else this.select(null);
    });
    window.addEventListener('keydown', (e) => {
      // With the menu up the keys belong to its buttons (Space presses the focused one); Esc steps back.
      if (this.paused) {
        if (e.key === 'Escape' && !e.repeat) this.overlays.escape();
        return;
      }
      if (e.code === 'Space') {
        // Space pans the board. It must not also press whichever button was clicked last.
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && document.activeElement !== canvas) document.activeElement.blur();
        if (!e.repeat && !this.space) this.setPan(true);
        return;
      }
      if (e.repeat) return;
      if (e.key === 'Escape') {
        // A dialog on top backs out first; otherwise Esc is the pause menu.
        if (!this.overlays.escape()) this.openMenu();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.nextReady();
      } else if (e.key === 'e' || e.key === 'E') void this.endTurn();
      else if (e.key >= '1' && e.key <= '5') {
        this.tab = TAB_KEYS[Number(e.key) - 1];
        if (this.tab !== 'build') this.cancelPlace();
        this.render();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      this.setPan(false);
    });
    window.addEventListener('blur', () => this.setPan(false));
    view.onSelectedGone = () => {
      this.sel = null;
      this.refreshSelection();
      this.render();
    };
    view.onFrame = (dt) => this.tickCamera(dt);
    // Leaving the page with an unsaved match behind asks first. Not while
    // developing, when every saved source file reloads the page.
    if (!import.meta.env.DEV) {
      window.addEventListener('beforeunload', (e) => {
        const s = this.state;
        if (!s || !this.unsaved || s.phase === 'gameover') return;
        e.preventDefault();
        e.returnValue = '';
      });
    }
  }

  private get state(): GameState | null {
    return this.store?.state ?? null;
  }

  private humanTurn(): boolean {
    const s = this.state;
    return !!s && s.phase === 'player' && s.players[s.currentPlayer].kind === 'human';
  }

  // -----------------------------------------------------------------------
  // Title screen & matches
  // -----------------------------------------------------------------------

  /** The title screen: the game's name over a board that turns slowly. */
  showHome(): void {
    this.leaveMatch();
    this.home.show();
    this.showcaseBoard(SHOWCASE_SEATS);
    this.scene.showcase();
  }

  private showSetup(): void {
    this.leaveMatch();
    this.home.hide();
    // The board behind the dialog shows the seating chosen so far.
    this.showcaseBoard(this.setup.count);
    this.scene.showcase();
    this.overlays.setup(
      this.setup,
      (cfg) => this.showcaseBoard(cfg.seats.length),
      (cfg) => this.start(cfg),
      () => this.showHome(),
    );
  }

  private showLoads(): void {
    this.home.hide();
    openLoadPanel(this.overlays, {
      pick: (slot) => this.load(slot),
      back: () => this.showHome(),
    });
  }

  /** A board that is only for looking at, behind the title screens. */
  private showcaseBoard(seats: number): void {
    this.view.load(diorama(SHOWCASE_SEED, Array.from({ length: seats }, () => 'ai' as const)));
  }

  private start(cfg: GameConfig): void {
    this.enterMatch(createGame(cfg), null);
  }

  private load(slot: number): void {
    const save = readSave(slot);
    if (!save) {
      this.overlays.toast('这个存档读不出来', 'bad');
      this.showHome();
      return;
    }
    this.enterMatch(save.state, slot);
  }

  /** Puts a match on screen, fresh or from a file, and hands it to the turn flow. */
  private enterMatch(state: GameState, slot: number | null): void {
    this.home.hide();
    this.leaveMatch();
    this.store = new Store(state);
    this.store.on((events) => this.changed(events));
    this.slot = slot;
    this.setup = {
      count: state.players.length,
      seats: [0, 1, 2, 3].map((i) => state.players[i]?.kind ?? 'ai'),
      turns: state.totalTurns,
      size: state.boardSize,
    };
    this.tab = 'harvest';
    this.turnKey = '';
    // A fresh match is all unsaved; one read from a file is, for now, exactly what the file holds.
    this.unsaved = slot === null;
    this.view.load(state);
    this.minimap.load(state);
    this.scene.setInspect(null);
    this.resetCamera();
    this.m.hud.classList.remove('hidden');
    this.syncClock();
    this.render();
    this.kick();
  }

  /** Drops the match on screen without putting another up. Whatever was waiting on it is let go. */
  private leaveMatch(): void {
    this.menu.close();
    // First, so that whatever was waiting on the old match finds it gone when it wakes.
    this.store = null;
    this.m.hud.inert = false;
    this.setPaused(false);
    this.overlays.clear();
    this.clearPlace();
    this.sel = this.inspect = this.tile = null;
    this.cam = null;
    this.turnKey = '';
    this.m.hud.classList.add('hidden');
  }

  /** A fresh match with the same players, turn count and map size. */
  private again(): void {
    this.start({ seats: this.setup.seats.slice(0, this.setup.count), totalTurns: this.setup.turns, size: this.setup.size });
  }

  private saveTo(slot: number): boolean {
    const s = this.state;
    const err = s ? writeSave(slot, s) : 'unavailable';
    if (err || !s) {
      this.overlays.toast(SAVE_ERROR_TEXT[err ?? 'unavailable'], 'bad');
      return false;
    }
    this.slot = slot;
    this.unsaved = false;
    this.overlays.toast(`已保存到存档 ${slot + 1}`, 'good');
    return true;
  }

  // -----------------------------------------------------------------------
  // Pausing
  // -----------------------------------------------------------------------

  /** Esc during a match: the menu over the frozen board. */
  private openMenu(): void {
    const s = this.state;
    // There is nothing to pause on the title screen, or once the match is decided.
    if (!s || this.paused || s.phase === 'gameover') return;
    this.setPaused(true);
    // The bars around the board are behind the menu now: no clicks, no tab stops.
    this.m.hud.inert = true;
    this.menu.open();
  }

  private resume(): void {
    if (!this.paused) return;
    this.menu.close();
    this.m.hud.inert = false;
    this.setPaused(false);
  }

  /**
   * Freezes or thaws the match. The clock behind every animation stops, the
   * paced waits hold, and `dispatch` lets nothing through until it thaws.
   */
  private setPaused(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (on) this.pauseAt = performance.now();
    else this.pausedFor += performance.now() - this.pauseAt;
    this.syncClock();
    if (!on) {
      const woken = this.wake;
      this.wake = [];
      for (const go of woken) go();
    }
  }

  /** Animations run at the chosen pace, and not at all while paused. */
  private syncClock(): void {
    this.view.timeScale = this.paused ? 0 : this.speed;
  }

  /** Waits until the match is running again. Returns at once when it is. */
  private gate(): Promise<void> {
    return this.paused ? new Promise<void>((resolve) => this.wake.push(resolve)) : Promise.resolve();
  }

  /** Running time: the wall clock without the stretches spent paused. */
  private now(): number {
    return performance.now() - this.pausedFor - (this.paused ? performance.now() - this.pauseAt : 0);
  }

  /** Waits `ms` of running time, holding still through any pause in between. */
  private async nap(ms: number): Promise<void> {
    await this.gate();
    const end = this.now() + ms;
    while (this.now() < end) {
      if (this.paused) await this.gate();
      else await wait(Math.min(100, end - this.now()));
    }
  }

  /**
   * False once the match was replaced or a pause is holding it: for the flows
   * that go on waiting after the picture has already come to rest.
   */
  private async running(store: Store): Promise<boolean> {
    await this.gate();
    return this.store === store && !this.paused;
  }

  // -----------------------------------------------------------------------
  // Turn flow
  // -----------------------------------------------------------------------

  /** Stops any camera glide and frames the whole board at once. */
  private resetCamera(): void {
    this.cam = null;
    this.scene.resetView();
  }

  /** Glides back to the whole board. */
  private goOverview(): void {
    if (!this.store) return;
    this.glideTo(new THREE.Vector3(0, 0, 0), this.scene.overviewDistance);
  }

  private changed(events: GameEvent[]): void {
    const s = this.state;
    if (!s) return;
    this.view.handle(events, s);
    // The camera goes to have a look at whatever has just landed.
    const landed = events.find((e) => e.type === 'alienSpawn');
    if (landed?.type === 'alienSpawn') this.glideTo(worldOf(landed.x, landed.y, s.boardSize));
    this.scores.update(s, events);
    this.refreshSelection();
    this.render();
    this.kick();
  }

  /** Returns false, and changes nothing, while the match is paused. */
  private dispatch(a: Action): boolean {
    if (!this.store || this.paused) return false;
    const r = this.store.dispatch(a);
    if (!r.ok) this.overlays.toast(r.reason, 'bad');
    else this.unsaved = true;
    return r.ok;
  }

  /** Starts whatever the new phase needs. Each phase is entered only once. */
  private kick(): void {
    const s = this.state;
    if (!s || !this.store) return;
    const key = `${s.phase}:${s.currentPlayer}:${s.turn}`;
    if (key === this.turnKey) return;
    this.turnKey = key;
    void this.enter(s, this.store);
  }

  private async enter(s: GameState, store: Store): Promise<void> {
    const fast = this.speed > 1;
    // False once the match this phase belongs to has been replaced.
    const here = async (ms = 0): Promise<boolean> => {
      await this.nap(ms / this.speed);
      return this.store === store && !this.paused;
    };
    switch (s.phase) {
      case 'roundStart':
        if (await here(800)) this.dispatch({ type: 'ROLL_DICE' });
        break;
      case 'dice':
        await this.view.whenIdle();
        if (!(await here())) return;
        await this.overlays.dice(s, fast);
        if (this.store === store) this.dispatch({ type: 'NEXT' });
        break;
      case 'aliens':
        await this.view.whenIdle();
        if (await here(700)) this.dispatch({ type: 'NEXT' });
        break;
      case 'player': {
        const p = s.players[s.currentPlayer];
        // Every turn opens on that player's own ground.
        this.focusZone(p);
        await this.view.whenIdle();
        if (this.store !== store) return;
        if (p.kind === 'human') {
          await this.overlays.banner(p, `${p.name} 的回合`, p.ap > 0 ? `行动点 ${p.ap} · 采集资源，指挥部队` : '本回合没有行动点，仍可建造、生产和指挥部队', fast);
        } else {
          await this.overlays.banner(p, `${p.name} 的回合`, '电脑行动中', fast);
        }
        if (this.store !== store || !this.stillTurnOf(store, p.id)) return;
        if (p.kind === 'ai') await this.runAi(store, p.id);
        else this.render();
        break;
      }
      case 'gameover':
        await this.view.whenIdle();
        if (!(await here())) return;
        this.goOverview();
        this.overlays.gameOver(store.state, () => this.again(), () => this.showHome());
        break;
    }
  }

  /** False once the match was replaced or the turn has moved on (a restart mid-banner). */
  private stillTurnOf(store: Store, pid: number): boolean {
    const s = store.state;
    return s.phase === 'player' && s.currentPlayer === pid;
  }

  /** Plays one computer player's turn, one order at a time, at a watchable pace. */
  private async runAi(store: Store, pid: number): Promise<void> {
    let failures = 0;
    for (let guard = 0; guard < 3000; guard++) {
      const s = store.state;
      if (this.store !== store || s.phase !== 'player' || s.currentPlayer !== pid) return;
      await this.view.whenIdle();
      // The picture may already be still: a pause is then the only thing holding the turn up.
      if (!(await this.running(store))) return;
      const a = aiDecide(store.state, pid);
      if (!a) break;
      if (!this.dispatch(a)) {
        // The rules refused the order; give up on the turn rather than loop.
        if (++failures >= 3) break;
        continue;
      }
      failures = 0;
      await this.nap(this.pace(a) / this.speed);
    }
    if (this.store === store) this.dispatch({ type: 'END_TURN' });
  }

  /** How long to let one order's animation play before the computer gives the next. */
  private pace(a: Action): number {
    switch (a.type) {
      case 'HARVEST':
        return 650;
      case 'BUILD':
      case 'UPGRADE':
      case 'ATTACK':
        return 520;
      case 'PRODUCE':
        return 420;
      case 'MOVE':
        return 260;
      default:
        return 120;
    }
  }

  // -----------------------------------------------------------------------
  // Human input
  // -----------------------------------------------------------------------

  private own(kind: 'unit' | 'building', id: number, p: PlayerState): boolean {
    const s = this.state!;
    return kind === 'unit' ? unitById(s, id)?.owner.id === p.id : buildingById(s, id)?.owner.id === p.id;
  }

  /** Still has a move or a shot left this turn. */
  private commandable(kind: 'unit' | 'building', id: number, p: PlayerState): boolean {
    const s = this.state!;
    if (!this.own(kind, id, p)) return false;
    if (kind === 'unit') {
      const u = unitById(s, id)!.unit;
      return !u.moveUsed || (!u.attackUsed && UNITS[u.key].attack > 0);
    }
    const b = buildingById(s, id)!.building;
    const lv = BUILDINGS[b.key].levels[b.level - 1];
    return lv.attack > 0 && b.powered && !b.fired;
  }

  private click(x: number, y: number): void {
    const s = this.state;
    if (!s || !this.humanTurn() || this.view.busy || this.overlays.blocking) return;
    const p = s.players[s.currentPlayer];
    const { view, tile } = this.view.pick(x, y);
    if (this.placing) {
      if (tile) this.placeAt(tile);
      return;
    }
    if (view) {
      if ((view.kind === 'unit' || view.kind === 'building') && this.commandable(view.kind, view.id, p)) {
        this.select({ kind: view.kind, id: view.id });
        return;
      }
      const target: EntityRef = { kind: view.kind, id: view.id };
      if (this.sel && attackTargets(s, this.sel).some((t) => t.kind === target.kind && t.id === target.id)) {
        this.dispatch({ type: 'ATTACK', source: this.sel, target });
        return;
      }
      // Anything else is only there to be looked at.
      this.inspect = target;
      this.lookAtTile(null);
      this.render();
      return;
    }
    if (this.sel && this.sel.kind === 'unit' && tile && moveRange(s, this.sel.id).some((m) => m.x === tile.x && m.y === tile.y)) {
      this.dispatch({ type: 'MOVE', unitId: this.sel.id, x: tile.x, y: tile.y });
      return;
    }
    // Nothing to command here: show what the ground is like instead.
    this.inspect = null;
    this.select(null);
    this.lookAtTile(tile);
    this.render();
  }

  /** Remembers a tile to describe, and outlines it until something else is picked. */
  private lookAtTile(tile: Pt | null): void {
    this.tile = tile;
    this.scene.setInspect(tile);
  }

  private select(ref: Sel | null): void {
    this.sel = ref;
    if (ref) {
      this.inspect = null;
      this.lookAtTile(null);
    }
    this.refreshSelection();
    this.render();
  }

  /** Keeps the selection only while the thing still exists and can act. */
  private refreshSelection(): void {
    const s = this.state;
    if (s && this.sel) {
      const p = s.players[s.currentPlayer];
      if (s.phase !== 'player' || !p || !this.commandable(this.sel.kind, this.sel.id, p)) this.sel = null;
    }
    if (this.placing && !this.humanTurn()) this.clearPlace();
    this.view.selected = this.sel ? `${this.sel.kind}:${this.sel.id}` : null;
    if (this.sel && s) this.view.highlight(moveRange(s, this.sel.id), attackTargets(s, this.sel));
    else if (this.placing) this.view.highlightTiles(this.placeTiles(), HIGHLIGHT.build);
    else this.view.highlightTiles([], HIGHLIGHT.build);
  }

  // -----------------------------------------------------------------------
  // Choosing where a building goes
  // -----------------------------------------------------------------------

  private beginPlace(k: BuildingKey): void {
    const s = this.state;
    if (!s || !this.humanTurn()) return;
    const err = canBuild(s, s.players[s.currentPlayer], k);
    if (err) {
      this.overlays.toast(err);
      return;
    }
    // The defense net covers the whole base: there is no spot to choose.
    if (BUILDINGS[k].w === 0) {
      this.dispatch({ type: 'BUILD', key: k });
      return;
    }
    this.placing = k;
    this.tab = 'build';
    this.select(null);
    this.previewPlace(null);
  }

  private cancelPlace(): void {
    if (!this.placing) return;
    this.clearPlace();
    this.render();
  }

  /** Drops the placement preview and its highlights, without touching the sidebar. */
  private clearPlace(): void {
    this.placing = null;
    this.scene.setGhost([], true);
    this.view.highlightTiles([], HIGHLIGHT.build);
  }

  /** Every tile that some allowed position of the building would cover. */
  private placeTiles(): Pt[] {
    const s = this.state;
    const def = this.placing ? BUILDINGS[this.placing] : null;
    if (!s || !def) return [];
    const out = new Map<string, Pt>();
    for (const a of buildSpots(s, s.players[s.currentPlayer], this.placing!)) {
      for (const t of footprintOf(def.w, def.h, a)) out.set(`${t.x},${t.y}`, t);
    }
    return [...out.values()];
  }

  /**
   * Where a click on `tile` puts the building: on that tile if it fits there,
   * otherwise on the allowed spot that covers the tile.
   */
  private anchorFor(tile: Pt): Pt | null {
    const s = this.state;
    const def = this.placing ? BUILDINGS[this.placing] : null;
    if (!s || !def) return null;
    const p = s.players[s.currentPlayer];
    if (placementError(s, p, this.placing!, tile.x, tile.y) === null) return tile;
    return buildSpots(s, p, this.placing!).find((a) => tile.x >= a.x && tile.x < a.x + def.w && tile.y >= a.y && tile.y < a.y + def.h) ?? null;
  }

  /** Ghost of the footprint that a click here would create. */
  private previewPlace(tile: Pt | null): void {
    const def = this.placing ? BUILDINGS[this.placing] : null;
    if (!def) return;
    const anchor = tile ? this.anchorFor(tile) : null;
    this.scene.setGhost(anchor ? footprintOf(def.w, def.h, anchor) : tile ? footprintOf(def.w, def.h, tile) : [], !!anchor);
    this.view.setHover(tile);
  }

  private placeAt(tile: Pt): void {
    const k = this.placing!;
    const anchor = this.anchorFor(tile);
    if (!anchor) {
      const s = this.state!;
      this.overlays.toast(placementError(s, s.players[s.currentPlayer], k, tile.x, tile.y) ?? '这里不能建造');
      return;
    }
    // Drop the preview first, so the sidebar redraws straight into its normal state.
    this.clearPlace();
    this.dispatch({ type: 'BUILD', key: k, x: anchor.x, y: anchor.y });
  }

  private nextReady(): void {
    const s = this.state;
    if (!s || !this.humanTurn()) return;
    const p = s.players[s.currentPlayer];
    const pool: Sel[] = [
      ...p.units.filter((u) => !u.moveUsed || (!u.attackUsed && UNITS[u.key].attack > 0)).map((u) => ({ kind: 'unit' as const, id: u.id })),
      ...p.buildings
        .filter((b) => {
          const lv = BUILDINGS[b.key].levels[b.level - 1];
          return lv.attack > 0 && b.powered && !b.fired;
        })
        .map((b) => ({ kind: 'building' as const, id: b.id })),
    ];
    if (!pool.length) {
      this.overlays.toast('所有单位本回合都已行动');
      return;
    }
    const at = this.sel ? pool.findIndex((x) => x.kind === this.sel!.kind && x.id === this.sel!.id) : -1;
    const pick = pool[(at + 1) % pool.length];
    this.select(pick);
    const v = this.view.view(pick);
    if (v) this.glideTo(v.root.position);
  }

  private async endTurn(): Promise<void> {
    const s = this.state;
    if (!s || !this.humanTurn()) return;
    const p = s.players[s.currentPlayer];
    if (p.ap > 0 && !(await this.overlays.confirm('还有行动点未使用', `你还有 ${p.ap} 点行动点没有采集，确定要结束回合吗？`, { yes: '结束回合' }))) return;
    if (!this.humanTurn()) return;
    this.select(null);
    this.clearPlace();
    this.dispatch({ type: 'END_TURN' });
  }

  // -----------------------------------------------------------------------
  // Camera & rendering
  // -----------------------------------------------------------------------

  private render(): void {
    if (!this.store) return;
    this.hud.render(this.store.state, {
      tab: this.tab,
      selection: this.sel,
      inspect: this.inspect,
      tile: this.tile,
      placing: this.placing,
      humanTurn: this.humanTurn(),
      speed: this.speed,
    });
    this.minimap.update(this.store.state);
    this.scores.update(this.store.state, []);
  }

  private glideTo(to: THREE.Vector3, dist?: number): void {
    const c = this.scene.controls;
    const offset = this.scene.camera.position.clone().sub(c.target);
    const d0 = offset.length() || 1;
    this.cam = { from: c.target.clone(), to: new THREE.Vector3(to.x, 0, to.z), dir0: offset.normalize(), d0, d1: dist ?? d0, t: 0 };
  }

  /** Frames a player's home zone. */
  private focusZone(p: PlayerState): void {
    const s = this.state;
    if (!s) return;
    // Dead centre of the zone: the base fills the middle of the picture, clear
    // of the battle log below and the sidebar beside it.
    const at = toWorld(s.corners[p.corner], 2.5, 2.5);
    this.glideTo(worldOf(at.x, at.y, s.boardSize), ZOOM);
  }

  private setPan(on: boolean): void {
    if (this.space === on) return;
    this.space = on;
    this.scene.setPanMode(on);
  }

  /** Glides the camera to the last thing asked for, and keeps the minimap's frame current. */
  private tickCamera(dt: number): void {
    const cam = this.cam;
    if (cam) {
      cam.t = Math.min(1, cam.t + dt * 1.6);
      const t = cam.t;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const target = cam.from.clone().lerp(cam.to, ease);
      const dir = cam.dir0.clone().lerp(VIEW_DIR, ease);
      // Half-way between opposite directions is nowhere in particular.
      if (dir.lengthSq() < 0.05) dir.copy(VIEW_DIR);
      const dist = cam.d0 + (cam.d1 - cam.d0) * ease;
      this.scene.controls.target.copy(target);
      this.scene.camera.position.copy(target).addScaledVector(dir.normalize(), dist);
      if (t >= 1) this.cam = null;
    }
    this.minimap.frame(this.scene.viewBounds());
  }
}

/** The w x h tiles a structure with its top-left tile on `at` would cover. */
function footprintOf(w: number, h: number, at: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push({ x: at.x + i, y: at.y + j });
  return out;
}

import { DIFFICULTIES, MAP_SIZES, MIN_TURNS, PLAYER_NAMES, RANKS, RESOURCES, START_RESOURCES, UNITS } from '../game/data';
import { promoteCost, rankOf, rankStats } from '../game/engine';
import type { Difficulty, GameConfig, GameState, PlayerState, ResourceKey, Unit } from '../game/types';
import { focusInside, fmt, h, sheen } from './dom';
import { die, glyph, icon, iconBox, rankIcon } from './icons';
import { ROOM, meterEl } from './meters';
import { RULES_HTML, costText } from './rules';

/** The colours a seat may take its pick of; the first four are what the seats start on. */
const SEAT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#94a3b8'];

export interface SetupState {
  count: number;
  seats: ('human' | 'ai')[];
  turns: number;
  /** Board edge in tiles. */
  size: number;
  /** What each seat is called, if the player has typed anything in. */
  names: string[];
  /** Each seat's colour. No two seats ever wear the same one. */
  colors: string[];
  difficulty: Difficulty;
}

const toConfig = (st: SetupState): GameConfig => ({
  seats: st.seats.slice(0, st.count),
  totalTurns: st.turns,
  size: st.size,
  names: st.names.slice(0, st.count),
  colors: st.colors.slice(0, st.count),
  difficulty: st.difficulty,
});

/** What each difficulty comes to, under its buttons. */
const stock = (level: Difficulty): string => {
  const r = START_RESOURCES[level];
  return `${RESOURCES.ore.name} ${r.ore} / ${RESOURCES.oil.name} ${r.oil} / ${RESOURCES.meat.name} ${r.meat}`;
};
const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  low: `初始资源：${stock('low')}。电脑玩家第 13 回合之后才建军事工厂，从不建机场。`,
  high: `初始资源：${stock('high')}。电脑玩家更早建起军事工厂和机场，各种坦克和飞机都造，进攻更有章法。`,
};

/** How dialogs pass time. The controller hands in one that stops while the match is paused. */
export type Hold = (ms: number) => Promise<void>;

export interface ConfirmOpts {
  yes?: string;
  no?: string;
  /** The way in is the harmful one (overwrite, quit): it is spelt out and not focused. */
  danger?: boolean;
}

interface Dialog {
  close: () => void;
  /** Settles whatever the dialog is waiting for, so the flow behind it can end. */
  abort: () => void;
}

const RES_KEYS: ResourceKey[] = ['ore', 'oil', 'meat'];

/** The turns stepper's two ends, reading and writing `st.turns` and redrawing the dialog. */
function stepper(st: SetupState, redraw: () => void): Array<HTMLElement | string> {
  const less = h('button', { disabled: st.turns <= MIN_TURNS }, '−');
  less.onclick = () => {
    st.turns = Math.max(MIN_TURNS, st.turns - 5);
    redraw();
  };
  const more = h('button', { disabled: st.turns >= 200 }, '+');
  more.onclick = () => {
    st.turns = Math.min(200, st.turns + 5);
    redraw();
  };
  return [less, h('span', {}, `${st.turns} 回合`), more];
}

/** Dialogs layered over the canvas: setup, dice, banners, results, questions. */
export class Overlays {
  /** Dialogs that are up, oldest first. */
  private live: Dialog[] = [];
  /** Banners go away on their own and block nothing, but they still go when the match is replaced. */
  private passing: Array<() => void> = [];
  /** Escape is answered by the last of these: the dialog on top. */
  private escapes: Array<() => void> = [];

  constructor(
    private root: HTMLElement,
    private toastEl: HTMLElement,
    private hold: Hold,
  ) {}

  /** True while a dialog covers the canvas. */
  get blocking(): boolean {
    return this.live.length > 0;
  }

  /** Puts `veil` up and returns what takes it down (once). `abort` also ends the wait behind it. */
  open(veil: HTMLElement, abort?: () => void): () => void {
    const dialog: Dialog = { close: () => {}, abort: abort ?? (() => {}) };
    let done = false;
    dialog.close = (): void => {
      if (done) return;
      done = true;
      veil.remove();
      this.live = this.live.filter((d) => d !== dialog);
    };
    this.live.push(dialog);
    this.root.append(veil);
    return dialog.close;
  }

  /** Takes every dialog down and lets the flows waiting on them finish, as when the match is replaced. */
  clear(): void {
    for (const gone of this.passing) gone();
    this.passing = [];
    // Abort before closing: an abort settles its own promise, which may try to close the dialog too.
    for (const d of [...this.live]) d.abort();
    for (const d of [...this.live]) d.close();
  }

  /** Escape reaches `fn` while its dialog is up. Returns what stops that. */
  onEscape(fn: () => void): () => void {
    this.escapes.push(fn);
    return () => {
      this.escapes = this.escapes.filter((f) => f !== fn);
    };
  }

  /** Escape was pressed: the dialog on top answers it. Says whether one did. */
  escape(): boolean {
    const top = this.escapes.at(-1);
    if (!top) return false;
    top();
    return true;
  }

  private seg<T>(options: Array<[T, string]>, current: T, pick: (v: T) => void): HTMLElement {
    return h(
      'span',
      { class: 'seg' },
      ...options.map(([v, label]) => {
        const b = h('button', { class: v === current ? 'on' : '' }, label);
        b.onclick = () => pick(v);
        return b;
      }),
    );
  }

  setup(initial: SetupState, onPreview: (cfg: GameConfig) => void, onStart: (cfg: GameConfig) => void, onBack: () => void): void {
    const st: SetupState = {
      count: initial.count,
      turns: initial.turns,
      size: initial.size,
      seats: [0, 1, 2, 3].map((i) => initial.seats[i] ?? 'ai'),
      names: [0, 1, 2, 3].map((i) => initial.names[i] ?? PLAYER_NAMES[i]),
      colors: [0, 1, 2, 3].map((i) => initial.colors[i] ?? SEAT_COLORS[i]),
      difficulty: initial.difficulty ?? 'high',
    };
    const veil = h('div', { class: 'veil' });
    const dialog = h('div', { class: 'dialog' });
    veil.append(dialog);
    // The rulebook on a panel of its own, slid out from the right on demand.
    const drawer = h('aside', { class: 'rules-drawer' }, h('h2', {}, '玩法简介与消耗'), h('div', { class: 'rules', html: RULES_HTML }));
    veil.append(drawer);
    let rulesOpen = false;
    const rulesBtn = h('button', { class: 'btn' }, '玩法简介');
    const shutRules = (): void => {
      rulesOpen = false;
      drawer.classList.remove('open');
      rulesBtn.textContent = '玩法简介';
    };
    rulesBtn.onclick = () => {
      rulesOpen = !rulesOpen;
      drawer.classList.toggle('open', rulesOpen);
      rulesBtn.textContent = rulesOpen ? '关闭简介' : '玩法简介';
    };
    // Esc: the panel first, then out the way the player came.
    const off = this.onEscape(() => {
      if (rulesOpen) shutRules();
      else leave();
    });
    const close = this.open(veil, leave);
    function leave(): void {
      off();
      close();
      onBack();
    }
    const draw = (): void => {
      const seats = [];
      for (let i = 0; i < st.count; i++) {
        // The name is theirs to type; the colour theirs to pick. Neither redraws the dialog on
        // every keystroke, so the typing keeps its focus.
        const name = h('input', { class: 'seat-name', maxlength: '8', value: st.names[i], placeholder: PLAYER_NAMES[i], 'aria-label': `第 ${i + 1} 个座位的名字` }) as HTMLInputElement;
        name.oninput = () => {
          st.names[i] = name.value;
        };
        const swatches = h(
          'span',
          { class: 'swatches', role: 'radiogroup', 'aria-label': `第 ${i + 1} 个座位的颜色` },
          ...SEAT_COLORS.map((c) => {
            // A colour another seat is wearing is marked as taken; picking it all the same swaps the two seats over.
            const worn = st.colors.indexOf(c);
            const taken = worn >= 0 && worn !== i;
            const b = h('button', { class: `sw${st.colors[i] === c ? ' on' : taken ? ' taken' : ''}`, style: `--c:${c}`, title: c, 'aria-label': taken ? `${c}，已被别的座位选用，点一下交换` : c });
            b.onclick = () => {
              if (taken) st.colors[worn] = st.colors[i];
              st.colors[i] = c;
              draw();
            };
            return b;
          }),
        );
        seats.push(
          h(
            'div',
            { class: 'seat' },
            swatches,
            name,
            this.seg(
              [
                ['human', '人类'],
                ['ai', '电脑'],
              ] as Array<['human' | 'ai', string]>,
              st.seats[i],
              (v) => {
                st.seats[i] = v;
                draw();
              },
            ),
          ),
        );
      }
      const start = h('button', { class: 'btn primary' }, '开始游戏');
      start.onclick = () => {
        off();
        close();
        onStart(toConfig(st));
      };
      const back = h('button', { class: 'btn' }, '返回首页');
      back.onclick = leave;
      dialog.replaceChildren(
        h('h1', { class: 'logo' }, h('b', {}, 'NC'), ' ', h('span', {}, 'WORLDBATTLE')),
        h('p', { class: 'sub' }, '回合制 3D 即时战略。掷骰子争夺行动点，建设基地，在终局决出胜负。'),
        h('h3', {}, '玩家数量'),
        this.seg(
          [
            [2, '2 人'],
            [3, '3 人'],
            [4, '4 人'],
          ],
          st.count,
          (v) => {
            st.count = v;
            draw();
          },
        ),
        h('h3', {}, '座位'),
        ...seats,
        // Three maps are too many names for half a row: they get the whole of one.
        h('div', { class: 'setup-row' }, h('div', {}, h('h3', {}, '地图大小'), this.seg(MAP_SIZES.map((m) => [m.size, `${m.name} ${m.size}×${m.size}`] as [number, string]), st.size, (v) => {
          st.size = v;
          draw();
        }))),
        h(
          'div',
          { class: 'setup-row' },
          h('div', {}, h('h3', {}, `总回合数（至少 ${MIN_TURNS}）`), h('span', { class: 'stepper' }, ...stepper(st, draw))),
          h('div', {}, h('h3', {}, '难度'), this.seg(DIFFICULTIES.map((d) => [d.key, d.name] as [Difficulty, string]), st.difficulty, (v) => {
            st.difficulty = v;
            draw();
          })),
        ),
        // What everyone starts out with hangs on the difficulty, so its explanation sits right under it.
        h('p', { class: 'sub setup-note' }, DIFFICULTY_NOTE[st.difficulty]),
        // A line of its own above the buttons: sharing their row, the buttons left it no width to lie down in.
        h('p', { class: 'setup-hint' }, '拖动旋转 · 滚轮缩放 · Esc 返回首页'),
        h('div', { class: 'setup-foot' }, start, rulesBtn, back),
      );
      onPreview(toConfig(st));
    };
    draw();
  }

  /** The dice for this round. Resolves when the player clicks or after a pause. */
  async dice(s: GameState, fast: boolean): Promise<void> {
    const veil = h('div', { class: 'veil soft' });
    const row = h('div', { class: 'dice-row' });
    for (const d of s.dice) {
      const p = s.players[d.player];
      const rerolled = d.rolls.length > 1;
      row.append(
        h(
          'div',
          { class: `dice${d.rank === 0 ? ' winner' : ''}` },
          d.rank === 0 ? h('span', { class: 'verdict' }, '先手') : null,
          h('div', { class: 'who' }, h('span', { class: 'dot', style: `--c:${p.color}` }), p.name),
          die(d.rolls[0], 54),
          h('div', { class: 'reroll', title: rerolled ? '并列后加掷' : '' }, ...(rerolled ? ['加掷 ', ...d.rolls.slice(1).map((r) => die(r, 18))] : [])),
          h('div', { class: `ap ${d.ap >= 3 ? 'top' : d.ap > 0 ? 'low' : 'none'}` }, d.ap > 0 ? `行动点 +${d.ap}` : '本回合无行动点'),
        ),
      );
    }
    // With four players every place is worth something, so the breakdown is spelled out in full.
    const sub = s.dice.length === 4 ? '第 1 名 3 行动点，第 2 名 2 行动点，第 3 名 1 行动点，第 4 名没有行动点' : '点数最大者 3 行动点，最小者 1 行动点，中间的玩家没有行动点';
    const dialog = h('div', { class: 'dialog', style: 'text-align:center' }, h('h2', {}, `第 ${s.turn} 回合 · 掷骰子`), h('p', { class: 'sub' }, sub), row, h('div', { class: 'dice-foot' }, '点击任意处继续'));
    veil.append(dialog);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        close();
        resolve();
      };
      veil.onclick = finish;
      void this.hold(fast ? 1300 : 3800).then(finish);
      const close = this.open(veil, finish);
    });
  }

  async banner(p: PlayerState | null, title: string, sub: string, fast: boolean): Promise<void> {
    const b = h('div', { class: 'banner', style: `--c:${p?.color ?? '#ffffff'};animation-duration:${fast ? 0.45 : 1.4}s` }, h('span', {}, title), h('small', {}, sub));
    const gone = (): void => {
      b.remove();
      this.passing = this.passing.filter((f) => f !== gone);
    };
    this.passing.push(gone);
    this.root.append(b);
    await this.hold(fast ? 450 : 1400);
    gone();
  }

  gameOver(s: GameState, onAgain: () => void, onHome: () => void): void {
    const [top, second] = s.ranking;
    // Points decide it; a base still standing and then raw attack power settle a tie.
    const level = second && top.alive && second.alive && top.score === second.score ? second : null;
    const why =
      s.gameOverReason === 'lastStanding'
        ? '摧毁了所有对手的军事基地'
        : !level
          ? '回合结束，积分最高者获胜'
          : top.baseHp !== level.baseHp
            ? '回合结束，积分相同，生命值更高者获胜'
            : '回合结束，积分与生命值都相同，攻击力更高者获胜';
    const table = h(
      'table',
      { class: 'rank' },
      h('tr', {}, h('th', {}, '名次'), h('th', {}, '玩家'), h('th', {}, '积分'), h('th', {}, '生命值'), h('th', {}, '攻击力'), h('th', {}, '部队')),
      ...s.ranking.map((r, i) =>
        h(
          `tr`,
          { class: i === 0 ? 'first' : '' },
          h('td', { class: 'num' }, String(i + 1)),
          h('td', {}, h('span', { class: 'dot', style: `--c:${s.players[r.player].color}` }), ` ${s.players[r.player].name}${r.alive ? '' : '（出局）'}`),
          h('td', { class: 'num' }, String(r.score)),
          h('td', { class: 'num' }, String(r.baseHp)),
          h('td', { class: 'num' }, String(r.attack)),
          h('td', { class: 'num' }, String(r.units)),
        ),
      ),
    );
    // Two ways out: the same match again, or back to the title screen.
    const again = h('button', { class: 'gbtn amber' }, h('span', { class: 'gbtn-ico', html: glyph('restart') }), '再来一局');
    again.onclick = () => {
      close();
      onAgain();
    };
    const home = h('button', { class: 'gbtn' }, h('span', { class: 'gbtn-ico', html: glyph('home') }), '返回首页');
    home.onclick = () => {
      close();
      onHome();
    };
    const veil = h('div', { class: 'veil' });
    const card = h('div', { class: 'dialog over-dialog', style: 'text-align:center' }, h('h2', {}, '战斗结束'), h('h1', { class: 'winner' }, h('b', { style: `color:${s.players[top.player].color}` }, s.players[top.player].name), ' 获胜'), h('p', { class: 'sub' }, why), table, h('div', { class: 'gbtn-col' }, again, home));
    veil.append(card);
    const close = this.open(veil);
    focusInside(card);
  }

  /**
   * The step from one rank up to the next for a unit: its insignia and the next
   * one, what each of its figures comes to by it, and what the step costs. `pay`
   * is called only if the player goes through with it.
   */
  promotion(s: GameState, u: Unit, pay: () => void): void {
    const p = s.players[s.currentPlayer];
    const rank = rankOf(u);
    const now = rankStats(u.key, rank);
    const then = rankStats(u.key, rank + 1);
    const cost = promoteCost(u.key, rank);
    const lacks = RES_KEYS.filter((k) => cost[k]).some((k) => p.resources[k] < cost[k]!);
    const veil = h('div', { class: 'veil soft' });
    const done = (): void => {
      off();
      close();
    };
    // One press, and the price is on it: each resource as its icon and its number and nothing more, red where the player is short.
    const go = h(
      'button',
      { class: 'rank-go', disabled: lacks, title: lacks ? '资源不足' : `花 ${costText(cost)}，晋升为${RANKS[rank].name}` },
      h('b', {}, '升级'),
      ...RES_KEYS.filter((k) => cost[k]).map((k) => h('span', { class: `rank-cost${p.resources[k] < cost[k]! ? ' short' : ''}`, title: `${RESOURCES[k].name} ${cost[k]}` }, h('span', { class: 'ico', html: icon(k) }), fmt(cost[k]!))),
    );
    go.onclick = () => {
      done();
      pay();
    };
    const no = h('button', { class: 'btn small ghost' }, '取消');
    no.onclick = done;
    const insignia = (r: number): HTMLElement[] => [iconBox(rankIcon(r), 'var(--accent)'), h('span', { class: 'rank-name' }, RANKS[r - 1].name)];
    // Each figure as it stands, with what the rank adds on in another colour, then "[ 15+8 ]". A figure that outgrows its row is drawn in proportion, so that the part the rank adds always shows.
    const shells = UNITS[u.key].shots;
    const gains = (label: string, was: number, will: number, room: number): HTMLElement => {
      const k = will <= room ? 1 : room / will;
      const base = Math.max(1, Math.round(was * k));
      return meterEl({ label, base, value: Math.min(room, Math.max(base + 1, Math.round(will * k))), room, text: `[ ${was}+${will - was} ]` });
    };
    const card = h(
      'div',
      { class: 'glass rank-card' },
      h('h2', {}, '军衔晋升'),
      h('p', { class: 'sub' }, `${UNITS[u.key].name} · ${p.name}`),
      h(
        'div',
        { class: 'rank-body' },
        h(
          'div',
          { class: 'rank-left' },
          h('div', { class: 'rank-steps' }, ...insignia(rank), h('span', { class: 'rank-arrow', html: glyph('next') }), ...insignia(rank + 1)),
          h('div', { class: 'rank-meters' }, gains('生命', now.hp, then.hp, ROOM.health), gains('攻击', now.attack * shells, then.attack * shells, ROOM.attack), gains('防御', now.defense, then.defense, ROOM.defense)),
        ),
        h('div', { class: 'rank-right' }, go, no),
      ),
    );
    veil.append(card);
    // Out the way the player came in: the dark round about, or Escape.
    veil.onclick = (e) => {
      if (e.target === veil) done();
    };
    const off = this.onEscape(done);
    const close = this.open(veil, done);
    sheen(card);
    focusInside(card);
  }

  /** A question with two ways out. Escape and the abort both count as "no". */
  confirm(title: string, text: string, o: ConfirmOpts = {}): Promise<boolean> {
    const veil = h('div', { class: 'veil soft' });
    return new Promise<boolean>((resolve) => {
      const done = (yes: boolean): void => {
        off();
        close();
        resolve(yes);
      };
      const yes = h('button', { class: `gbtn ${o.danger ? 'danger' : 'amber'}` }, h('span', { class: 'gbtn-ico', html: glyph(o.danger ? 'quit' : 'check') }), o.yes ?? '确定');
      yes.onclick = () => done(true);
      const no = h('button', { class: 'gbtn' }, o.no ?? '取消');
      no.onclick = () => done(false);
      const card = h('div', { class: 'glass confirm-card' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'gbtn-row' }, no, yes));
      veil.append(card);
      const off = this.onEscape(() => done(false));
      const close = this.open(veil, () => done(false));
      sheen(card);
      // Enter lands on the way back out, never on the way further in.
      no.focus();
    });
  }

  /** A small note that fades out on its own. */
  toast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
    const el = h('div', { class: `toast ${tone}` }, text);
    this.toastEl.append(el);
    setTimeout(() => el.remove(), 2400);
  }
}

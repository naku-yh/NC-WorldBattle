import { ALIEN_CAP, ALIEN_EVERY, MAP_SIZES, MIN_TURNS, PLAYER_COLORS } from '../game/data';
import type { GameConfig, GameState, PlayerState } from '../game/types';
import { focusInside, h, sheen } from './dom';
import { die, glyph } from './icons';
import { RULES_HTML } from './rules';

export interface SetupState {
  count: number;
  seats: ('human' | 'ai')[];
  turns: number;
  /** Board edge in tiles. */
  size: number;
}

const toConfig = (st: SetupState): GameConfig => ({ seats: st.seats.slice(0, st.count), totalTurns: st.turns, size: st.size });

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
    const st: SetupState = { count: initial.count, turns: initial.turns, size: initial.size, seats: [0, 1, 2, 3].map((i) => initial.seats[i] ?? 'ai') };
    const veil = h('div', { class: 'veil' });
    const dialog = h('div', { class: 'dialog' });
    veil.append(dialog);
    const off = this.onEscape(leave);
    const close = this.open(veil, leave);
    // Out the way the player came: back to the title screen.
    function leave(): void {
      off();
      close();
      onBack();
    }
    const draw = (): void => {
      const seats = [];
      for (let i = 0; i < st.count; i++) {
        seats.push(
          h(
            'div',
            { class: 'seat' },
            h('span', { class: 'dot', style: `--c:${PLAYER_COLORS[i]}` }),
            h('span', { class: 'who' }, `玩家${i + 1}`),
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
      const humans = st.seats.slice(0, st.count).filter((k) => k === 'human').length;
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
        h('h3', {}, '地图大小'),
        this.seg(
          MAP_SIZES.map((m) => [m.size, `${m.name} ${m.size}×${m.size}`] as [number, string]),
          st.size,
          (v) => {
            st.size = v;
            draw();
          },
        ),
        h('p', { class: 'summary' }, '地形每局随机生成：一条水道横贯战场并设有两座桥，另有湖泊、树林和山地。大型地图的格子数比中型多约一半。'),
        h('h3', {}, `总回合数（至少 ${MIN_TURNS} 回合）`),
        h(
          'span',
          { class: 'stepper' },
          (() => {
            const b = h('button', { disabled: st.turns <= MIN_TURNS }, '−');
            b.onclick = () => {
              st.turns = Math.max(MIN_TURNS, st.turns - 5);
              draw();
            };
            return b;
          })(),
          h('span', {}, `${st.turns} 回合`),
          (() => {
            const b = h('button', { disabled: st.turns >= 200 }, '+');
            b.onclick = () => {
              st.turns = Math.min(200, st.turns + 5);
              draw();
            };
            return b;
          })(),
        ),
        h('p', { class: 'summary', style: 'margin-top:14px' }, `${st.count} 名玩家（${humans} 人类 / ${st.count - humans} 电脑）· ${st.count === 2 ? '对角开局' : '各占一角'} · ${st.size}×${st.size} 地图 · 外星人将从第 ${ALIEN_EVERY.join('–')} 回合起陆续到来（场上最多 ${ALIEN_CAP} 个）`),
        h('div', { class: 'setup-foot' }, start, back, h('span', { class: 'summary' }, '拖动旋转 · 滚轮缩放 · Esc 返回首页')),
        h('details', {}, h('summary', {}, '玩法简介与消耗一览'), h('div', { class: 'rules', html: RULES_HTML })),
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
          h('div', { class: `ap ${d.ap === 3 ? 'top' : d.ap === 1 ? 'low' : 'none'}` }, d.ap === 3 ? '行动点 +3' : d.ap === 1 ? '行动点 +1' : '本回合无行动点'),
        ),
      );
    }
    const dialog = h('div', { class: 'dialog', style: 'text-align:center' }, h('h2', {}, `第 ${s.turn} 回合 · 掷骰子`), h('p', { class: 'sub' }, '点数最大者 3 行动点，最小者 1 行动点，中间的玩家没有行动点'), row, h('div', { class: 'dice-foot' }, '点击任意处继续'));
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

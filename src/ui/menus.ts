import type { GameState } from '../game/types';
import { focusInside, h, keepFocusIn, sheen, touchOnly } from './dom';
import { glyph, type Glyph } from './icons';
import type { Overlays } from './overlays';
import { rulesPanel } from './rules';
import { eraseSave, infoOf, listSlots, readSave } from './saves';
import { slotList } from './slots';

/** What the pause menu does to the match. */
export interface PauseActions {
  /** The match on screen, as it stands. */
  state(): GameState | null;
  /** The slot it was last saved to or loaded from, if any. */
  slot(): number | null;
  /** True once anything has happened in the match since that file was written. */
  unsaved(): boolean;
  /** Writes the match into `slot`; says whether it went in. */
  save(slot: number): boolean;
  resume(): void;
  /** A fresh match with the same players, turn count and map size. */
  restart(): void;
  /** Leaves the match for the title screen. */
  quit(): void;
}

/** This match's own save, for the "保存存档" row: "存档 2 · 3 分钟前", and whether the match has moved on since. */
function mySave(a: PauseActions): string {
  const slot = a.slot();
  const file = slot === null ? null : readSave(slot);
  const where = file && slot !== null ? `存档 ${slot + 1} · ${infoOf(file).ago}` : null;
  return [where, a.unsaved() ? '有新进度' : null].filter(Boolean).join(' · ') || '尚未保存';
}

/** A menu button: an icon and a label side by side, with a quiet note under the label (a key cap if `key` is set). */
function item(label: string, icon: Glyph, cls: string, note: { text: string; key?: boolean } | null, run: () => void): HTMLElement {
  const b = h(
    'button',
    { class: `gbtn ${cls}`.trim() },
    h('span', { class: 'gbtn-ico', html: glyph(icon) }),
    // The note sits under the label, so that everything in the row is centred.
    h('span', { class: 'gbtn-label' }, label, note ? (note.key ? h('kbd', { class: 'gbtn-hint' }, note.text) : h('span', { class: 'gbtn-hint' }, note.text)) : null),
  );
  b.onclick = run;
  return b;
}

/**
 * A sheet of glass over the board. What goes on it scrolls on a short screen; the glass stays put.
 * (`menu-card`, not `card`: that one is the little unit card along the bottom, and its flex row
 * would squeeze this sheet to the width of its own buttons.)
 */
function sheetOf(label: string): { veil: HTMLElement; sheet: HTMLElement } {
  const sheet = h('div', { class: 'sheet' });
  const veil = h('div', { class: 'veil pause' }, h('div', { class: 'glass menu-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, sheet));
  return { veil, sheet };
}

/** What the pause menu shows: its own list, the save slots, or the rulebook. */
type Level = 'main' | 'save' | 'rules';

/**
 * Esc during a match: a sheet of glass over the frozen board with the ways
 * out of it. "保存存档" turns the sheet over to the three slots, "玩法" to the rulebook.
 */
export class PauseMenu {
  private veil: HTMLElement | null = null;
  private sheet: HTMLElement | null = null;
  private level: Level = 'main';
  /** The slot just written to, so its row can say so. */
  private justSaved: number | null = null;
  private forget: (() => void) | null = null;
  /** Takes the veil down and tells the overlays it is gone: without it the canvas would stay blocked for the rest of the match. */
  private shut: (() => void) | null = null;

  constructor(
    private o: Overlays,
    private a: PauseActions,
  ) {}

  get up(): boolean {
    return this.veil !== null;
  }

  open(): void {
    if (this.veil) return;
    const { veil, sheet } = sheetOf('暂停菜单');
    veil.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') keepFocusIn(veil, e);
    });
    this.veil = veil;
    this.sheet = sheet;
    this.justSaved = null;
    this.shut = this.o.open(veil, () => this.close());
    this.forget = this.o.onEscape(() => this.back());
    sheen(veil.firstElementChild as HTMLElement);
    this.draw('main');
  }

  /** The rulebook, on the back of the menu. Does nothing while the menu is down. */
  showRules(): void {
    if (this.veil) this.draw('rules');
  }

  /** Esc: one step back, and out of the menu when there is none. */
  back(): void {
    if (!this.veil) return;
    if (this.level !== 'main') this.draw('main');
    else this.a.resume();
  }

  close(): void {
    this.forget?.();
    this.forget = null;
    this.shut?.();
    this.shut = null;
    this.veil = this.sheet = null;
  }

  private draw(level: Level): void {
    const sheet = this.sheet;
    if (!sheet || !this.veil) return;
    this.level = level;
    // The rulebook has tables in it: it gets a wider pane of glass than the list of buttons.
    this.veil.firstElementChild?.classList.toggle('wide', level === 'rules');
    const body = level === 'main' ? this.main() : level === 'save' ? this.saver() : this.book();
    body.classList.add('swap');
    sheet.replaceChildren(body);
    sheet.scrollTop = 0;
    focusInside(sheet);
  }

  private main(): HTMLElement {
    const s = this.a.state();
    const info = s ? infoOf({ v: 1, savedAt: 0, state: s }) : null;
    return h(
      'div',
      { class: 'pause-body' },
      h(
        'div',
        { class: 'pause-head' },
        h('div', { class: 'pause-title' }, '已暂停'),
        info ? h('div', { class: 'pause-sub' }, h('span', { class: 'dot', style: `--c:${info.color}` }), info.turn, h('i', { class: 'sep' }), info.moment) : null,
      ),
      // The key cap only makes sense where there is a key to press.
      item('继续游戏', 'play', 'amber', touchOnly() ? null : { text: 'Esc', key: true }, () => this.a.resume()),
      item('玩法', 'book', '', { text: '规则、操作与消耗一览' }, () => this.draw('rules')),
      item('保存存档', 'save', '', { text: mySave(this.a) }, () => this.draw('save')),
      item('重新开始', 'restart', '', { text: '同一设置，新地图' }, () => void this.restart()),
      item('退出到首页', 'quit', 'danger', null, () => void this.quit()),
    );
  }

  /** The rulebook: the same fold-out sections the sidebar used to carry, on a darker pane so the small print stays legible over the board. */
  private book(): HTMLElement {
    const back = h('button', { class: 'gbtn round', title: touchOnly() ? '返回菜单' : '返回菜单（Esc）', html: glyph('back') });
    back.onclick = () => this.back();
    return h(
      'div',
      { class: 'pause-body' },
      h('div', { class: 'pause-head with-back' }, back, h('div', {}, h('div', { class: 'pause-title' }, '玩法'), h('div', { class: 'pause-sub' }, '对局已暂停，慢慢看'))),
      h('div', { class: 'rules-sheet' }, rulesPanel()),
    );
  }

  private saver(): HTMLElement {
    const back = h('button', { class: 'gbtn round', title: touchOnly() ? '返回菜单' : '返回菜单（Esc）', html: glyph('back') });
    back.onclick = () => this.back();
    return h(
      'div',
      { class: 'pause-body' },
      h('div', { class: 'pause-head with-back' }, back, h('div', {}, h('div', { class: 'pause-title' }, '保存存档'), h('div', { class: 'pause-sub' }, '选一个存档位'))),
      slotList('save', listSlots(), { pick: (slot) => void this.saveTo(slot) }, { current: this.a.slot(), saved: this.justSaved }),
    );
  }

  private async saveTo(slot: number): Promise<void> {
    // Only writing over a different match needs asking; the slot this match lives in is simply updated.
    const taken = listSlots().find((x) => x.slot === slot)?.save;
    if (taken && slot !== this.a.slot()) {
      const info = infoOf(taken);
      const ok = await this.o.confirm(`覆盖存档 ${slot + 1}？`, `里面是${info.turn}的进度（${info.ago}保存），覆盖后找不回来。`, { yes: '覆盖', danger: true });
      if (!ok || !this.veil) return;
    }
    if (!this.a.save(slot)) return;
    this.justSaved = slot;
    this.draw('save');
  }

  private async restart(): Promise<void> {
    const yes = await this.o.confirm('重新开始？', '会用同样的玩家、回合数和地图大小开一局新地图，现在的进度不会保留。', { yes: '重新开始', danger: true });
    if (yes) this.a.restart();
  }

  private async quit(): Promise<void> {
    // Say what is actually at stake: a match that is safely in a file can be left without a warning.
    const slot = this.a.slot();
    const saved = !this.a.unsaved() && slot !== null;
    const yes = await this.o.confirm(
      '退出到首页？',
      saved ? `进度已经保存在存档 ${slot + 1}，下次从首页的“加载存档”接着玩。` : '还没保存的进度会丢失。需要的话先回菜单保存一次。',
      { yes: '退出', danger: !saved },
    );
    if (yes) this.a.quit();
  }
}

/** What the title screen does with a chosen save. */
export interface LoadActions {
  pick(slot: number): void;
  /** Back to the title screen. */
  back(): void;
}

/** "加载存档" on the title screen: the same sheet of glass as the pause menu, with the slots to pick up from. */
export function openLoadPanel(o: Overlays, a: LoadActions): void {
  const { veil, sheet } = sheetOf('加载存档');
  const shut = (): void => {
    off();
    close();
  };
  const leave = (): void => {
    shut();
    a.back();
  };
  const off = o.onEscape(leave);
  const close = o.open(veil, leave);
  const back = h('button', { class: 'gbtn' }, h('span', { class: 'gbtn-ico', html: glyph('back') }), '返回首页');
  back.onclick = leave;
  const draw = (): void => {
    const slots = listSlots();
    const any = slots.some((x) => x.save);
    sheet.replaceChildren(
      h(
        'div',
        { class: 'pause-body' },
        h(
          'div',
          { class: 'pause-head' },
          h('div', { class: 'pause-title' }, '加载存档'),
          h('div', { class: 'pause-sub' }, any ? '选一份存档，接着上次的进度继续' : `开一局游戏，${touchOnly() ? '点顶栏的“菜单”' : '按 Esc 打开菜单'}就能保存`),
        ),
        slotList('load', slots, {
          pick: (slot) => {
            if (!readSave(slot)) return;
            shut();
            a.pick(slot);
          },
          erase: (slot) =>
            void o.confirm(`删除存档 ${slot + 1}？`, '删除后无法恢复。', { yes: '删除', danger: true }).then((yes) => {
              if (!yes) return;
              eraseSave(slot);
              draw();
            }),
        }),
        h('p', { class: 'load-note' }, '存档只保存在这台电脑的这个浏览器里'),
        back,
      ),
    );
    focusInside(sheet);
  };
  sheen(veil.firstElementChild as HTMLElement);
  draw();
}

import { h } from './dom';
import { glyph } from './icons';
import { SAVE_SLOTS, listSlots } from './saves';

export interface HomeActions {
  newGame(): void;
  load(): void;
}

/** What the corner of the title screen says about this build. */
const VERSION = 'Version 0.98 - 20261128';

/** Button wording and picture, by which button it is. */
const LABELS = { new: ['新游戏', 'NEW GAME', 'play'], load: ['加载存档', 'LOAD GAME', 'load'] } as const;

/**
 * The title screen: the game's name over the turning board, and two ways in.
 * It lets pointer events through to the canvas, so the board can still be
 * turned by hand; only the buttons take them.
 */
export class Home {
  private el: HTMLElement;
  private taken: HTMLElement;
  private badge: HTMLElement;

  constructor(
    mount: HTMLElement,
    private a: HomeActions,
  ) {
    this.taken = h('span');
    this.badge = h('span', { class: 'home-count' });
    this.el = h(
      'div',
      { class: 'home-stage' },
      h('div', { class: 'home-fx scan' }),
      h('div', { class: 'home-fx grid' }),
      h('div', { class: 'home-fx shade' }),
      ...(['tl', 'tr', 'bl', 'br'] as const).map((c) => h('i', { class: `home-corner ${c}` })),
      h('i', { class: 'home-ticks top' }),
      h('i', { class: 'home-ticks bottom' }),
      h(
        'header',
        { class: 'home-top' },
        h('div', { class: 'home-mark' }, h('img', { class: 'home-logo', src: '/logo.png', alt: 'NC WorldBattle' }), h('span', { class: 'home-version' }, VERSION)),
        h('div', { class: 'home-status' }, h('i', { class: 'home-pulse' }), '系统就绪', h('i', { class: 'sep' }), this.taken),
      ),
      h(
        'main',
        { class: 'home-main' },
        h('h1', { class: 'home-title' }, h('b', {}, 'NC'), ' ', h('span', {}, 'WORLDBATTLE')),
        h('div', { class: 'home-rule' }),
        h('p', { class: 'home-tagline' }, 'RTS · 回合制 · 战略 · 多人游戏'),
        h('div', { class: 'home-actions' }, this.action('new'), this.action('load')),
        h('p', { class: 'home-note' }, '最多支持 4 名玩家同时对战'),
      ),
      h(
        'footer',
        { class: 'home-foot' },
        h('span', {}, '游戏中按 ', h('kbd', {}, 'Esc'), ' 暂停与保存'),
        h('span', {}, '拖动旋转视角'),
        h('span', {}, '滚轮缩放'),
      ),
    );
    mount.append(this.el);
  }

  show(): void {
    this.refresh();
    // The entrance plays again each time the title screen comes back.
    this.el.classList.remove('hidden', 'enter');
    void this.el.offsetWidth;
    this.el.classList.add('enter');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  /** How many slots hold something, on the status line and on the "加载存档" button. */
  refresh(): void {
    const used = listSlots().filter((x) => x.save || x.broken).length;
    this.taken.textContent = `存档 ${used}/${SAVE_SLOTS}`;
    this.badge.textContent = `${used}/${SAVE_SLOTS}`;
  }

  private action(which: 'new' | 'load'): HTMLElement {
    const [label, en, icon] = LABELS[which];
    const b = h(
      'button',
      { class: `home-btn ${which}`, 'aria-label': label },
      h(
        'span',
        { class: 'home-btn-face' },
        h('span', { class: 'home-btn-ico', html: glyph(icon) }),
        h('span', { class: 'home-btn-text' }, h('b', {}, label), h('small', {}, en)),
        which === 'load' ? this.badge : h('span', { class: 'home-btn-arrow', html: glyph('next') }),
      ),
    );
    b.onclick = which === 'new' ? this.a.newGame : this.a.load;
    return b;
  }
}

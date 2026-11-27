import type { GameEvent, GameState, PlayerState } from '../game/types';
import { fmt, h } from './dom';

/** How far apart the rows sit, in pixels: the same as each row's height. */
const ROW = 28;

interface Row {
  el: HTMLElement;
  rank: HTMLElement;
  points: HTMLElement;
}

/**
 * The standings under the minimap: every player by points. A row slides into
 * place when the order changes, and shows what its player has just earned.
 */
export class Scores {
  private list: HTMLElement;
  private rows = new Map<number, Row>();
  /** What each row shows at the moment, so that a row is only touched when its number changes. */
  private shown = new Map<number, number>();
  private seated = -1;

  constructor(mount: HTMLElement) {
    this.list = h('div', { class: 'scores-list' });
    mount.append(h('div', { class: 'scores' }, h('div', { class: 'scores-head' }, h('span', {}, '积分榜'), h('small', {}, 'SCORE')), this.list));
  }

  update(s: GameState, events: GameEvent[]): void {
    const earned = new Map<number, number>();
    for (const e of events) {
      if (e.type === 'score') earned.set(e.player, (earned.get(e.player) ?? 0) + e.amount);
    }
    // A different crowd (a new match, another number of players): start the list over.
    if (this.seated !== s.players.length) {
      this.list.replaceChildren();
      this.rows.clear();
      this.shown.clear();
      this.seated = s.players.length;
      this.list.style.height = `${s.players.length * ROW}px`;
    }
    // By points; whoever is still in the match ahead of whoever has been knocked out.
    const order = [...s.players].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.id - b.id;
    });
    for (const p of s.players) {
      const row = this.rows.get(p.id) ?? this.addRow(p);
      if (this.shown.get(p.id) !== p.score) {
        this.shown.set(p.id, p.score);
        row.points.textContent = fmt(p.score);
      }
      const place = order.indexOf(p);
      row.rank.textContent = String(place + 1);
      row.el.style.transform = `translateY(${place * ROW}px)`;
      row.el.classList.toggle('out', !p.alive);
      // Whose go it is, so the list can be read at a glance.
      row.el.classList.toggle('now', s.phase === 'player' && s.currentPlayer === p.id);
      const gain = earned.get(p.id);
      if (gain) {
        const tag = h('em', { class: 'gain' }, `+${fmt(gain)}`);
        row.el.append(tag);
        // It has said its piece by then; nothing needs to pile up in the row.
        setTimeout(() => tag.remove(), 2100);
      }
    }
  }

  private addRow(p: PlayerState): Row {
    const rank = h('b', { class: 'rank' });
    const points = h('b', { class: 'pts' }, '0');
    const el = h('div', { class: 'score-row' }, rank, h('span', { class: 'dot', style: `--c:${p.color}` }), h('span', { class: 'name' }, p.name), points);
    this.list.append(el);
    const row = { el, rank, points };
    this.rows.set(p.id, row);
    return row;
  }
}

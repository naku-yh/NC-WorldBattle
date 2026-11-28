import { h } from './dom';

/** "+2" or "−2". */
export const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** How many cells each figure's row has: the most it reaches on any unit or alien, so that every row of a kind is as long as every other and two cards line up. */
export const ROOM = { health: 12, attack: 18, defense: 10, range: 6, move: 8 };

/** One figure of a card: a row of cells, then the number. */
export interface Meter {
  label: string;
  /** The figure off the reference card. */
  base: number;
  /** The figure as it stands. */
  value: number;
  room: number;
  /** The number written after the cells. */
  text: string;
  /** For the pointer: where the difference from the reference card comes from. */
  note?: string;
  /** Health is a share of a whole rather than a count of points: its cells show how full it is. */
  share?: true;
}

/**
 * A figure counted in points. The cells up to the reference card are the unit's own;
 * anything the ground adds on top of that carries on after them in another colour, and
 * anything the ground takes off is left as a gap where it would have been.
 */
export function points(label: string, base: number, value: number, room: number, suffix = '', shown?: string, note?: string): Meter {
  const text = shown ?? `${value}${suffix}${base === value ? '' : `(${signed(value - base)})`}`;
  // For the pointer, where the difference from the card comes from: the ground, unless the caller knows better (a rank, on a ranked unit).
  const why = shown ? undefined : note ?? (base === value ? undefined : `${label} ${base}，地形 ${signed(value - base)}`);
  return { label, base, value, room, text, ...(why === undefined ? {} : { note: why }) };
}

/** Health, as a row of cells filled to the share of it that is left. */
export function health(hp: number, max: number): Meter {
  return { label: '生命', base: max, value: hp, room: ROOM.health, text: `${hp}/${max}`, share: true };
}

/** A figure of a unit's card on the "生产" page, where nothing has happened to the unit yet: its cells, then the figure in square brackets. */
export function cardMeter(label: string, value: number, room: number, share = false): Meter {
  return { label, base: value, value, room, text: `[${value}]`, ...(share ? { share: true } : {}) };
}

/** A figure as it is drawn: its cells, then its number. */
export function meterEl(m: Meter): HTMLElement {
  const cells = h('span', { class: 'cells' });
  // Health has no whole number of cells to show: fill as many as the share left comes to, never none while there is any left.
  const filled = m.share ? Math.max(m.value > 0 ? 1 : 0, Math.round((m.value / m.base) * m.room)) : m.value;
  for (let i = 1; i <= m.room; i++) {
    let kind = 'void';
    if (m.share) kind = i > filled ? 'off' : `hp${m.value / m.base > 0.55 ? '' : m.value / m.base > 0.28 ? ' warn' : ' low'}`;
    else if (i <= m.value) kind = i > m.base ? 'up' : '';
    else if (i <= m.base) kind = 'down';
    cells.append(h('i', { class: kind }));
  }
  return h('div', { class: 'meter', title: m.note ?? '' }, h('span', { class: 'mlabel' }, m.label), cells, h('b', { class: 'mvalue' }, m.text));
}

/** The figures of one card, a row at a time: two to a row, so that life sits over defence and attack over range. */
export function metersEl(rows: Meter[][]): HTMLElement {
  const single = rows.length === 1 || rows[0].length === 1;
  return h('div', { class: single ? 'meters one' : 'meters' }, ...rows.flat().map(meterEl));
}

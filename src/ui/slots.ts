import type { SaveFile, Slot } from './saves';
import { infoOf } from './saves';
import { h } from './dom';
import { glyph } from './icons';
import { paintThumb } from './minimap';

/** Rows are written to when saving and read from when loading. */
export type SlotMode = 'save' | 'load';

export interface SlotActions {
  /** A row was picked. */
  pick(slot: number): void;
  /** Only the load list offers it: throw the file away. */
  erase?(slot: number): void;
}

export interface SlotOpts {
  /** The slot the match on screen was last saved to or loaded from. */
  current?: number | null;
  /** The slot that was just written to, to say so on its row. */
  saved?: number | null;
}

/** The three slots as a list of rows. */
export function slotList(mode: SlotMode, slots: Slot[], a: SlotActions, o: SlotOpts = {}): HTMLElement {
  const list = h('div', { class: 'slots' });
  for (const { slot, save, broken } of slots) list.append(slotRow(mode, slot, save, broken, a, o));
  return list;
}

function slotRow(mode: SlotMode, slot: number, save: SaveFile | null, broken: boolean, a: SlotActions, o: SlotOpts): HTMLElement {
  const info = save ? infoOf(save) : null;
  const vacant = !save && !broken;
  const mine = !!save && o.current === slot;
  const picture = save ? pictureOf(save) : h('span', { class: 'slot-art', html: glyph(mode === 'save' ? 'save' : 'load') });

  const title = h('div', { class: 'slot-title' }, `存档 ${slot + 1}`);
  if (mine) title.append(h('span', { class: 'tag good' }, '本局'));
  if (o.saved === slot) title.append(h('span', { class: 'tag good slot-done' }, h('i', { html: glyph('check') }), '已保存'));

  const [line, sub] = info
    ? [
        // Whose go it was, in that player's colour: the row is too narrow for a dot as well.
        h('div', { class: 'slot-line' }, h('span', { class: 'slot-moment', style: `color:${info.color}` }, info.moment), h('i', { class: 'sep' }), info.turn),
        h('div', { class: 'slot-sub' }, `${info.setup} · ${info.ago}`),
      ]
    : broken
      ? [h('div', { class: 'slot-line bad' }, '无法读取'), h('div', { class: 'slot-sub' }, '可能来自旧版本，可以覆盖或删除')]
      : [h('div', { class: 'slot-line dim' }, '空存档位'), h('div', { class: 'slot-sub' }, mode === 'save' ? '把当前对局保存在这里' : '还没有保存过对局')];

  // Saving over the slot this match already lives in is an update, not an overwrite.
  // A load row offers nothing when there is nothing to load.
  const verb = mode === 'load' ? (info ? '读取' : null) : vacant || broken ? '保存' : mine ? '更新' : '覆盖';
  const row = h(
    'button',
    { class: `slot${vacant ? ' vacant' : ''}${mine ? ' mine' : ''}`, disabled: mode === 'load' && vacant, title: verb ? `${verb}到存档 ${slot + 1}` : '' },
    picture,
    h('div', { class: 'slot-info' }, title, line, sub),
    verb ? h('span', { class: `slot-act${mode === 'load' ? ' on' : ''}` }, verb) : null,
  );
  row.onclick = () => a.pick(slot);
  if (mode === 'load' && !vacant) {
    const del = h('button', { class: 'slot-del', title: `删除存档 ${slot + 1}`, html: glyph('trash') });
    del.onclick = () => a.erase?.(slot);
    return h('div', { class: 'slot-row' }, row, del);
  }
  return h('div', { class: 'slot-row' }, row);
}

function pictureOf(save: SaveFile): HTMLCanvasElement {
  const c = document.createElement('canvas');
  paintThumb(c, save.state);
  return c;
}

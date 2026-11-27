import { reduce } from '../game/engine';
import type { Action, GameEvent, GameState } from '../game/types';

/** Holds the one live game state and tells the view about every change. */
export class Store {
  private listeners: Array<(events: GameEvent[]) => void> = [];

  constructor(public state: GameState) {}

  on(fn: (events: GameEvent[]) => void): void {
    this.listeners.push(fn);
  }

  dispatch(a: Action): ReturnType<typeof reduce> {
    const r = reduce(this.state, a);
    if (r.ok) for (const l of this.listeners) l(r.events);
    return r;
  }
}

/** How far a pointer may wander between going down and coming up and still count as a click. */
const TAP_SLOP = 6;

/**
 * Tells a tap on the board from everything else a pointer does there. One
 * pointer pressed and lifted where it went down is a click; a drag turns the
 * camera, and a second finger joining makes it a pinch or a pan, whichever
 * finger lifts last.
 */
export class Press {
  private x = 0;
  private y = 0;
  /** The primary pointer is down and nothing has happened yet to rule out a click. */
  private held = false;

  /** The primary pointer went down. `button` is the one that was pressed. */
  down(x: number, y: number, button: number): void {
    this.held = button === 0;
    this.x = x;
    this.y = y;
  }

  /** Another pointer went down beside the first: the two of them are a gesture, not a click. */
  join(): void {
    this.held = false;
  }

  /** The primary pointer lifted. Says whether that was a click. */
  up(x: number, y: number, button: number): boolean {
    const tap = this.held && button === 0 && Math.hypot(x - this.x, y - this.y) <= TAP_SLOP;
    this.held = false;
    return tap;
  }

  /** The pointer was taken away without lifting: it left the board, or the system took the gesture over. */
  lose(): void {
    this.held = false;
  }
}

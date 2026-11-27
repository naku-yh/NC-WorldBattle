import { Capacitor } from '@capacitor/core';

/** Running as the iPad app rather than in a browser tab. */
export const inShell = Capacitor.isNativePlatform();

/**
 * What the app's web view needs and a browser tab does not. The page takes
 * the whole screen and is never pinched out of shape (the board is zoomed
 * with two fingers on it, not the page). And the on-screen keyboard's height
 * is kept in `--kb`, so that a dialog rises above the keyboard instead of
 * staying behind it while a name is being typed.
 */
export function fitShell(): void {
  if (!inShell) return;
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = (): void => {
    document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height)}px`);
    // Whatever is being typed into stays in sight above the keyboard.
    const field = document.activeElement;
    if (field instanceof HTMLElement && 'value' in field) field.scrollIntoView({ block: 'nearest' });
  };
  vv.addEventListener('resize', fit);
}

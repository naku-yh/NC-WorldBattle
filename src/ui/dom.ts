type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Tiny element builder: h('div', { class: 'x' }, child, 'text'). */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  // Arrays are flattened, so callers can spread in a list or pass it whole.
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 1234 -> "1,234". */
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Lets a glass panel's highlight follow the pointer across it. */
export function sheen(el: HTMLElement): void {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

/** Keyboard focus goes to the first button in `box`, so Enter and Tab start inside the dialog. */
export function focusInside(box: HTMLElement): void {
  (box.querySelector<HTMLElement>('button:not(:disabled)') ?? box).focus();
}

/** Keeps Tab and Shift+Tab walking around `box` instead of out of it. */
export function keepFocusIn(box: HTMLElement, e: KeyboardEvent): void {
  const items = [...box.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter((el) => el.offsetParent !== null);
  if (!items.length || !box.contains(document.activeElement)) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  // Step past the end in either direction and come back round the other side.
  const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
  if (next !== at) {
    e.preventDefault();
    items[next].focus();
  }
}

import { beforeAll, describe, expect, it } from 'vitest';
import { Overlays } from '../overlays';
import { PauseMenu } from '../menus';

/** The least bit of DOM the menus need: elements that can hold children and be taken away again. */
class FakeNode {}
class FakeEl extends FakeNode {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  className = '';
  innerHTML = '';
  textContent = '';
  onclick: unknown = null;
  style = { setProperty: () => undefined, transform: '', height: '' };
  classList = { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false };
  append(...nodes: Array<FakeNode | string>): void {
    for (const n of nodes) {
      if (!(n instanceof FakeEl)) continue;
      n.parent = this;
      this.children.push(n);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  replaceChildren(...nodes: Array<FakeNode | string>): void {
    this.children = [];
    this.append(...nodes);
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  setAttribute(): void {}
  addEventListener(): void {}
  querySelector(): null {
    return null;
  }
  focus(): void {}
  getContext(): null {
    return null;
  }
}

const fake = (): HTMLElement => new FakeEl() as unknown as HTMLElement;

beforeAll(() => {
  const g = globalThis as unknown as { Node: unknown; document: unknown };
  g.Node = FakeNode;
  g.document = { createElement: () => new FakeEl(), createTextNode: (text: string) => text, activeElement: null };
});

/** The menu, the dialogs under it, and a count of how often it handed back to the game. */
function setup() {
  let resumed = 0;
  const dialogs = new Overlays(fake(), fake(), () => Promise.resolve());
  const menu = new PauseMenu(dialogs, {
    state: () => null,
    slot: () => null,
    unsaved: () => true,
    save: () => true,
    // The controller's `resume` closes the menu; so does the test's.
    resume: () => {
      resumed++;
      menu.close();
    },
    restart: () => undefined,
    quit: () => undefined,
  });
  // The one private step the test needs: turning the sheet over to the slots.
  const slots = (): void => (menu as unknown as { draw(level: 'main' | 'save'): void }).draw('save');
  return { dialogs, menu, slots, resumed: () => resumed };
}

describe('暂停菜单与弹层', () => {
  it('打开时挡住棋盘；关掉之后就不再挡着', () => {
    const { dialogs, menu, resumed } = setup();
    expect(dialogs.blocking).toBe(false);
    menu.open();
    expect(menu.up).toBe(true);
    expect(dialogs.blocking).toBe(true);
    // Esc on the menu's front, like "继续游戏": the game resumes and the menu goes.
    menu.back();
    expect(resumed()).toBe(1);
    expect(menu.up).toBe(false);
    expect(dialogs.blocking).toBe(false);
    // Once more, closed by the controller itself.
    menu.open();
    expect(dialogs.blocking).toBe(true);
    menu.close();
    expect(dialogs.blocking).toBe(false);
  });

  it('Esc 落到开着的菜单上，菜单不在时不会落空', () => {
    const { dialogs, menu, resumed } = setup();
    expect(dialogs.escape()).toBe(false);
    menu.open();
    expect(dialogs.escape()).toBe(true);
    expect(menu.up).toBe(false);
    expect(resumed()).toBe(1);
    expect(dialogs.escape()).toBe(false);
  });

  it('停在存档位列表时，Esc 只退回菜单，不退出游戏', () => {
    const { dialogs, menu, slots, resumed } = setup();
    menu.open();
    slots();
    expect(dialogs.escape()).toBe(true);
    expect(menu.up).toBe(true);
    expect(dialogs.blocking).toBe(true);
    expect(resumed()).toBe(0);
    expect(dialogs.escape()).toBe(true);
    expect(menu.up).toBe(false);
    expect(resumed()).toBe(1);
  });

  it('换一局时，弹层服务会把还开着的菜单一并收掉，之后还能再开', () => {
    const { dialogs, menu } = setup();
    menu.open();
    dialogs.clear();
    expect(menu.up).toBe(false);
    expect(dialogs.blocking).toBe(false);
    menu.open();
    expect(dialogs.blocking).toBe(true);
    menu.close();
    expect(dialogs.blocking).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Press } from '../press';

describe('点按与拖动、捏合的区分', () => {
  it('原地按下再抬起是一次点击', () => {
    const p = new Press();
    p.down(100, 200, 0);
    expect(p.up(100, 200, 0)).toBe(true);
  });

  it('手抖一点也算点击，挪远了就是拖动', () => {
    const p = new Press();
    p.down(100, 200, 0);
    expect(p.up(104, 203, 0)).toBe(true);
    p.down(100, 200, 0);
    // Six pixels is still a tap; seven is not.
    expect(p.up(100, 206, 0)).toBe(true);
    p.down(100, 200, 0);
    expect(p.up(100, 207, 0)).toBe(false);
    p.down(100, 200, 0);
    expect(p.up(105, 207, 0)).toBe(false);
  });

  it('一次点击只算一回：没有按下就抬起来，或者抬起两次，都不是点击', () => {
    const p = new Press();
    expect(p.up(100, 200, 0)).toBe(false);
    p.down(100, 200, 0);
    expect(p.up(100, 200, 0)).toBe(true);
    expect(p.up(100, 200, 0)).toBe(false);
  });

  it('第二根手指按下来，之后不管哪根先抬都不算点击', () => {
    // 捏合缩放：两指都原地不动就抬起来。
    const pinch = new Press();
    pinch.down(300, 300, 0);
    pinch.join();
    expect(pinch.up(300, 300, 0)).toBe(false);
    // 先抬第一根。
    const firstUp = new Press();
    firstUp.down(300, 300, 0);
    firstUp.join();
    expect(firstUp.up(300, 300, 0)).toBe(false);
    expect(firstUp.up(200, 200, 0)).toBe(false);
    // 手势之后，下一次单独的点按照常有效。
    firstUp.down(120, 120, 0);
    expect(firstUp.up(120, 120, 0)).toBe(true);
  });

  it('右键和中键不是点击', () => {
    const p = new Press();
    p.down(100, 200, 2);
    expect(p.up(100, 200, 2)).toBe(false);
    p.down(100, 200, 1);
    expect(p.up(100, 200, 1)).toBe(false);
    p.down(100, 200, 0);
    expect(p.up(100, 200, 2)).toBe(false);
  });

  it('指针没抬起就没了（离开棋盘，或系统接管手势），不算点击', () => {
    const p = new Press();
    p.down(100, 200, 0);
    p.lose();
    expect(p.up(100, 200, 0)).toBe(false);
  });
});

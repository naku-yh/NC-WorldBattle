import { describe, expect, it } from 'vitest';
import { ALIENS, HIDDEN_KEYS, SKELETON, SECOND_FORMS, SPIDERLING } from '../../game/data';
import { volley } from '../../game/engine';
import { RULES_HTML } from '../rules';
import type { AlienKey, AlienShape } from '../../game/types';

const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ');

/** Everything the rulebook gives away about a hidden alien's other side: none of it may be in print. */
const TOLD = ['飞龙', '火球', '碎成', '碎裂', '分裂', '变身', '第二形态', '骷髅', SKELETON.name];

describe('玩法说明里的外星人', () => {
  it('写明哪些打得到空中：克洛伊、奎德、牛美菱和小蜘蛛仅对地，神坦对空只有 2 格，鬼魅对空对地', () => {
    const text = plain(RULES_HTML);
    for (const k of ['chloe', 'kuide', 'meiling'] as const) expect(text).toContain(`生命 ${ALIENS[k].hp} · 攻击 ${volley(ALIENS[k])} · 防御 ${ALIENS[k].defense} · 射程 ${ALIENS[k].range} · 仅对地`);
    expect(text).toContain(`射程 ${ALIENS.shentan.range}（对空 ${ALIENS.shentan.airRange}）`);
    expect(text).not.toContain(`鬼魅 · 白色的鬼魂 生命 ${ALIENS.guimei.hp} · 攻击 13 · 防御 2 · 射程 1 · 仅对地`);
    expect(text).toContain(`生命 ${SPIDERLING.hp} · 攻击 ${SPIDERLING.attack} · 防御 ${SPIDERLING.defense} · 仅对地`);
  });

  it('隐藏外星人：有名字和第一形态的数值，说它们从不当第一个到来，对倒下之后的事只字不提', () => {
    const text = plain(RULES_HTML);
    expect(text).toContain('隐藏外星人');
    expect(text).toContain('从不当第一个到来');
    expect(text).toContain('同样随降临次序变强');
    for (const k of HIDDEN_KEYS) {
      const d = ALIENS[k];
      expect(text).toContain(d.name);
      const air = !d.canHit.includes('air') ? ' · 仅对地' : '';
      expect(text).toContain(`生命 ${d.hp} · 攻击 ${volley(d)} · 防御 ${d.defense} · 射程 ${d.range}${air} · 移动 ${d.move}`);
      expect(d.desc.length).toBeGreaterThan(20);
    }
    for (const told of TOLD) expect(text).not.toContain(told);
  });

  it('第二形态的数值一处都没有', () => {
    const text = plain(RULES_HTML);
    for (const [key, shape] of Object.entries(SECOND_FORMS) as Array<[AlienKey, AlienShape]>) {
      expect(text).not.toContain(`攻击 ${volley(shape)} · 防御 ${shape.defense}`);
      expect(text).not.toContain(shape.look);
      expect(text).not.toContain(shape.desc.slice(0, 8));
      expect(key).toBeTruthy();
    }
  });

  it('写了军衔：三级、各自提高多少、两次晋升各花造价的几成', () => {
    // Every space out: the bold tags leave gaps behind them.
    const text = plain(RULES_HTML).replace(/\s+/g, '');
    expect(text).toContain('下士→中士→上士');
    expect(text).toContain('花该单位造价的100%升中士、150%升上士');
    expect(text).toContain('中士的攻击力、生命是下士的1.5倍，上士是2倍');
    expect(text).toContain('防御力中士+4，上士+10');
    expect(text).toContain('晋升后生命补满');
  });

  it('卡片上的那句话（降临时的介绍）也只点到为止', () => {
    for (const k of HIDDEN_KEYS) for (const told of TOLD) expect(ALIENS[k].desc).not.toContain(told);
  });
});

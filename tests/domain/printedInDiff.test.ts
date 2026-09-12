import { describe, expect, it } from 'vitest';
import { diff } from '@vitest/utils/diff';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { AGENT_YAML } from '../support/agent';

/**
 * 世界へ繋がっている物が、比較の差分へ素のまま渡されたときにどう刷られるか
 * （`WorldObject.toJSON`・`Interaction.toJSON`）。
 *
 * 物も操作も、親・枠・セッションを辿って世界の全部へ繋がっている。**刷る側がそこを辿り始めると、
 * 落ちたことが誰にも届かない**——同梱の定義を積んだ世界では差分が出来上がらず、試験は赤を出す前に
 * 戻ってこなくなる。ここが見るのは、辿り先がその物の名乗りで尽きていること。
 */
describe('世界へ繋がる物の、差分での刷られ方', () => {
  /** 落ちたときに読める印字の上限（文字）。桁だけを見ている——名乗りだけなら数百字で収まる。 */
  const READABLE = 1000;

  const YAML = `
object_defs:
  wood:
    interactions:
      chop:
        trigger: {drag: {tag: axe_tool}}
  axe_tool:
    tags: [axe_tool]
`;

  function open(): { codex: WorldCodex; spawn: (objectName: string) => WorldObject } {
    const codex = new WorldCodexYamlLoader()
      .load('core.yaml', YAML)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    const session = new WorldSession(codex);
    return { codex, spawn: (name) => session.createObject(codex.objectNames.getId(name)) };
  }

  /** 落ちたときにvitestが刷るのと同じもの。 */
  function printedFor(value: unknown): string {
    return diff([], [value]) ?? '';
  }

  it('物は、型の名前と個体の番号だけを名乗る', () => {
    const { spawn } = open();

    const printed = printedFor(spawn('wood'));

    expect(printed, 'どの個体なのかは読める').toContain('"name": "wood"');
    expect(printed, '同じ型の別の個体と見分けが付く').toContain('"instanceId"');
    expect(printed.length, '世界の中身は刷らせない').toBeLessThan(READABLE);
  });

  it('操作は、自分の名前だけを名乗る', () => {
    const { spawn } = open();
    const combinations = spawn('wood').combinationsWith(spawn('axe_tool'), spawn('agent'));

    const printed = diff([], combinations) ?? '';

    expect(printed, '何が成立したのかは読める').toContain('"name": "chop"');
    expect(printed.length, '世界の中身は刷らせない').toBeLessThan(READABLE);
  });
});

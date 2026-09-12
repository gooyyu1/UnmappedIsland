import { describe, expect, it } from 'vitest';
import { diff } from '@vitest/utils/diff';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { AGENT_YAML } from '../support/agent';

/**
 * 世界へ繋がっている物が、比較の差分へ素のまま渡されたときにどう刷られるか
 * （`WorldObject.toJSON`・`Interaction.toJSON`）。
 *
 * 物は親・枠・セッションを辿って世界の全部へ繋がっている。**刷る側がそこを辿り始めると、落ちたことが
 * 誰にも届かない**——同梱の定義を積んだ世界では差分が出来上がらず、試験は赤を出す前に戻ってこなく
 * なる。素のまま渡されうる入口は物と操作の2つで、**それぞれが自分の名乗りで辿り先を断つ**ので、
 * ここも入口ごとに1つずつ見る（片方の名乗りが消えれば、その入口の試験だけが落ちる）。
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

  /** 合成YAMLの世界を1つ開き、そこから物を作る口を返す。 */
  function open(): (objectName: string) => WorldObject {
    const codex = new WorldCodexYamlLoader()
      .load('core.yaml', YAML)
      .load('agent.yaml', AGENT_YAML)
      .buildAndReset();
    const session = new WorldSession(codex);
    return (name) => session.createObject(codex.objectNames.getId(name));
  }

  /** 落ちたときにvitestが刷るのと同じもの。 */
  function printedFor(values: readonly unknown[]): string {
    return diff([], values) ?? '';
  }

  it('物は、型の名前と個体の番号だけを名乗る', () => {
    const spawn = open();

    const printed = printedFor([spawn('wood')]);

    expect(printed, 'どの個体なのかは読める').toContain('"name": "wood"');
    expect(printed, '同じ型の別の個体と見分けが付く').toContain('"instanceId"');
    expect(printed.length, '世界の中身は刷らせない').toBeLessThan(READABLE);
  });

  it('操作は、自分の名前だけを名乗る', () => {
    const spawn = open();

    const printed = printedFor(spawn('wood').combinationsWith(spawn('axe_tool'), spawn('agent')));

    expect(printed, '何が成立したのかは読める').toContain('"name": "chop"');
    expect(printed.length, '抱えている宣言と相手は刷らせない').toBeLessThan(READABLE);
  });
});

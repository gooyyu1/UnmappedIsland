import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

// art_by_stage（段による絵の差し替え、GameElementDefinition.md 6.4節）の実行時の解決
// （WorldObject.artSuffix）に対する自動テスト。YAML文法そのもの（ロード時検証）はyamlLoader.test.tsが持つ。
describe('WorldObject.artSuffix', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('test.yaml', yaml).build();
  }

  function instantiate(codex: WorldCodex, objectDefName: string, session: WorldSession): WorldObject {
    return new WorldObject(1, codex.objects.get(codex.objectNames.getId(objectDefName)), session);
  }

  it('art_by_stageを持たない型は常にundefined', () => {
    const codex = load(`
object_defs:
  rock:
    props:
      weight: {value: 1000}
`);
    const session = new WorldSession(codex);
    const rock = instantiate(codex, 'rock', session);

    expect(rock.artSuffix()).toBeUndefined();
  });

  it('今の段がartを宣言していなければundefined、宣言していればその値', () => {
    const codex = load(`
object_defs:
  campfire:
    art_by_stage: heat
    props:
      heat:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: out}
          - {name: lit, min: 1, art: lit}
`);
    const session = new WorldSession(codex);
    const campfire = instantiate(codex, 'campfire', session);
    const heatId = codex.propertyNames.getId('heat');

    expect(campfire.artSuffix(), 'outの段はartを宣言していない').toBeUndefined();

    campfire.setNumber(heatId, 20);
    expect(campfire.artSuffix(), 'litの段はart: litを宣言している').toBe('lit');

    campfire.setNumber(heatId, 0);
    expect(campfire.artSuffix(), 'outへ戻れば絵も戻る').toBeUndefined();
  });

  it('複数の段が同じartを宣言していれば、どちらの段でも同じ値になる', () => {
    const codex = load(`
object_defs:
  campfire:
    art_by_stage: heat
    props:
      heat:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: out}
          - {name: ember, min: 1, art: lit}
          - {name: blaze, min: 60, art: lit}
`);
    const session = new WorldSession(codex);
    const campfire = instantiate(codex, 'campfire', session);
    const heatId = codex.propertyNames.getId('heat');

    campfire.setNumber(heatId, 1);
    expect(campfire.artSuffix()).toBe('lit');

    campfire.setNumber(heatId, 60);
    expect(campfire.artSuffix()).toBe('lit');
  });
});

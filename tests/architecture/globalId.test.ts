import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * グローバルIDの種類分け（[`GlobalId`](../../src/domain/GlobalId.ts)）が効いていることの検査。
 *
 * **`@ts-expect-error` の行が、この検査の本体。** 受け口が素の `number` へ戻れば、その行は型で
 * 止まらなくなり、`@ts-expect-error` のほうが余ったものとして `npm run typecheck` が赤くなる
 * ——赤が出るのは vitest ではなく型検査のほうで、CIはどちらも常に走らせる。
 *
 * **渡す相手は、どれも実際に配られたIDにする。** 素のnumberとして止まったのでは、名前空間で
 * 分かれていることを確かめたことにならない（`GlobalId<Namespace>` が Namespace を見なくなっても
 * 緑のままになる）。名前空間はどれも0始まりの連番なので、通れば別の名前空間の同じ番号が黙って引かれる。
 *
 * 実行時の主張（IDは素の数のまま）も同じ場所で確かめる。印は型の上にしか無く、実体が
 * `number` でなくなったらMapの鍵も配列の添字も一斉に壊れるため。
 */
describe('グローバルIDの種類分け', () => {
  const codex = new WorldCodexYamlLoader()
    .load(
      'globalId.yaml',
      `
property_tags:
  vitals:

object_defs:
  stone:
    tags: [mineral]
    props:
      weight:
        tags: [vitals]
        value: 100
      mood: {value: calm}
    slots:
      contents: {}
`,
    )
    .buildAndReset();

  const stoneId = codex.objectNames.getId('stone');
  const weightId = codex.propertyNames.getId('weight');
  const contentsSlotId = codex.slotNames.getId('contents');
  const mineralTagId = codex.tagNames.getId('mineral');
  const vitalsPropertyTagId = codex.propertyTagNames.getId('vitals');
  const calmSymbolId = codex.symbolNames.getId('calm');

  const stone = new WorldSession(codex).createObject(stoneId);

  it('IDの実体は素のnumberのまま', () => {
    for (const id of [stoneId, weightId, contentsSlotId, mineralTagId, vitalsPropertyTagId, calmSymbolId])
      expect(typeof id).toBe('number');
    expect(stone.getProperty(weightId).number).toBe(100);
  });

  it('素のnumberは、どの名前空間の受け口にも渡せない', () => {
    // @ts-expect-error NameRegistryを通っていない数は型のIDではない。
    codex.objects.tryGet(stoneId as number);
    // @ts-expect-error 同じくプロパティのIDではない。
    stone.tryGetProperty(weightId as number);
    // @ts-expect-error 同じくスロットのIDではない。
    stone.tryGetSlot(contentsSlotId as number);
    // @ts-expect-error 同じく型のタグのIDではない。
    stone.def.hasTag(mineralTagId as number);
    // @ts-expect-error 同じくプロパティのタグのIDではない。
    stone.propertiesWithTag(vitalsPropertyTagId as number);
    // @ts-expect-error 同じくシンボルのIDではない。
    codex.symbolNames.tryGetName(calmSymbolId as number);

    expect(stone.tryGetProperty(weightId)?.def.name).toBe('weight');
  });

  it('別の名前空間のIDは、受け口に渡せない', () => {
    // @ts-expect-error スロットのIDはプロパティのIDではない。
    stone.tryGetProperty(contentsSlotId);
    // @ts-expect-error プロパティのIDはスロットのIDではない。
    stone.tryGetSlot(weightId);
    // @ts-expect-error 型のIDはプロパティのIDではない。
    stone.tryGetProperty(stoneId);
    // @ts-expect-error シンボルのIDは型のIDではない。
    codex.objects.tryGet(calmSymbolId);

    expect(stone.tryGetSlot(contentsSlotId)?.def.name).toBe('contents');
  });

  it('型のタグとプロパティのタグは、互いの受け口に渡せない', () => {
    // タグは2つの名前空間に分かれている（4.1節と6.7節）。番号だけでは見分けが付かないので、
    // 取り違えると「そのタグを持たない」が静かに返る。
    // @ts-expect-error プロパティのタグのIDは、型のタグのIDではない。
    stone.def.hasTag(vitalsPropertyTagId);
    // @ts-expect-error 型のタグのIDは、プロパティのタグのIDではない。
    stone.propertiesWithTag(mineralTagId);

    expect(stone.def.hasTag(mineralTagId)).toBe(true);
    expect(stone.propertiesWithTag(vitalsPropertyTagId).map((p) => p.def.name)).toEqual(['weight']);
  });

  it('NameRegistryが配ったIDの並びは、その名前空間の受け口へそのまま渡せる', () => {
    // 添字を数える形で並びを作ると、そこが素の数からIDへ変わる場所になる（NameRegistry.ids）。
    expect(codex.slotNames.ids.map((id) => codex.slotNames.getName(id))).toContain('contents');
    expect(codex.propertyTagNames.ids.every((id) => stone.propertiesWithTag(id).length >= 0)).toBe(true);
  });
});

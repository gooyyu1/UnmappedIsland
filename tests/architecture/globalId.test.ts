import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldSession } from '../../src/domain/WorldSession';
import type { GlobalId } from '../../src/domain/GlobalId';

/**
 * グローバルIDの種類分け（[`GlobalId`](../../src/domain/GlobalId.ts)）が効いていることの検査。
 *
 * **`@ts-expect-error` の行が、この検査の本体。** 受け口が素の `number` へ戻れば、その行は型で
 * 止まらなくなり、`@ts-expect-error` のほうが余ったものとして `npm run typecheck` が赤くなる
 * ——赤が出るのは vitest ではなく型検査のほうで、CIはどちらも常に走らせる。
 *
 * 実行時の主張（IDは素の数のまま）も同じ場所で確かめる。印は型の上にしか無く、実体が
 * `number` でなくなったらMapの鍵も配列の添字も一斉に壊れるため。
 */
describe('グローバルIDの種類分け', () => {
  const codex = new WorldCodexYamlLoader()
    .load(
      'globalId.yaml',
      `
object_defs:
  stone:
    props:
      weight: {value: 100}
    slots:
      contents: {}
`,
    )
    .buildAndReset();

  const weightId = codex.propertyNames.getId('weight');
  const contentsSlotId = codex.slotNames.getId('contents');
  const stone = new WorldSession(codex).createObject(codex.objectNames.getId('stone'));

  it('IDの実体は素のnumberのまま', () => {
    expect(typeof weightId).toBe('number');
    expect(stone.getProperty(weightId).number).toBe(100);
  });

  it('素のnumberは、プロパティのIDを受ける宣言へ渡せない', () => {
    // @ts-expect-error NameRegistryを通っていない数はプロパティのIDではない（型で止まる）。
    stone.tryGetProperty(weightId as number);
    expect(stone.tryGetProperty(weightId)?.def.name).toBe('weight');
  });

  it('別の名前空間のIDは、プロパティのIDを受ける宣言へ渡せない', () => {
    // 印はまだプロパティの名前空間にしか付いていないので、**比べる相手をこの検査が自分で作る**
    // ——素のnumberとして止まったのでは、名前空間で分かれていることを確かめたことにならない
    //   （`GlobalId<Namespace>` が Namespace を見なくなっても緑のままになる）。
    const asSlotId = contentsSlotId as unknown as GlobalId<'slot'>;

    // @ts-expect-error スロットの名前空間のIDは、プロパティのIDではない（型で止まる）。どちらも
    //   0始まりの連番なので、通れば別の名前空間の同じ番号が黙って引かれる。
    stone.tryGetProperty(asSlotId);
    expect(typeof asSlotId).toBe('number');
  });
});

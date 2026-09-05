import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 時間のかかる枠（`put_in`、GameElementDefinition.md 7.10節）の見張り。
 *
 * **枠へ入れる操作には「まとめてよいか」の宣言が無い**（combinationの`allow_multiple`は宣言された操作
 * だけのもの、12.4節）。まとめられるかは枠が答える個数がそのまま決めるので、**時間のかかる枠が複数
 * 受け取れるようになった瞬間、止める手段の無いまま何時間も進む操作が生まれる**。
 *
 * 今その2つは重なっていない（唯一時間を宣言している`treatment`は1枠に1つ）。重なったらここで落ちるので、
 * そのとき初めて枠側にも門が要るかを判断する。
 */
describe('時間のかかる枠', () => {
  let codex: WorldCodex;
  let defs: readonly ObjectDef[];

  beforeAll(() => {
    codex = bundledCodex();
    defs = Array.from({ length: codex.objects.count }, (_, globalId) => codex.objects.get(globalId));
  });

  it('入れるのに時間がかかる枠は、まとめて受け取れない', () => {
    const slow = defs.flatMap((def) =>
      def.slotDefs
        .filter((slotDef) => slotDef.hasPutInDuration)
        .map((slotDef) => ({ name: `${def.name}.${slotDef.name}`, atMostOne: slotDef.acceptsAtMostOne })),
    );

    expect(slow.length, '時間を宣言している枠が1つも無いなら、この見張りは意味を失っている').toBeGreaterThan(
      0,
    );
    expect(
      slow.filter((slot) => !slot.atMostOne).map((slot) => slot.name),
      'まとめて入れられる枠に値段を付けるなら、まとめてよいかの宣言が要る',
    ).toEqual([]);
  });
});

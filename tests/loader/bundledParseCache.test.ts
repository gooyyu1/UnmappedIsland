import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/asset-pack/AssetPack';
import { LoadReport } from '../../src/loader/LoadReport';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { zipArchive } from '../support/zipArchive';

/**
 * 同梱ぶんのパース結果は読み込みをまたいで控えられ、控えそのものが配られる（loadWorldCodex）。
 * 配るからには、**前の読み込みでの書き換えが次へ残らない**ことが要る——patch
 * （GameElementDefinition.md 3.4節）は宣言のノードを書き換えるので、書き換える側が自分の複製へ
 * 移らないと、次の読み込みがそれを見る（RawObjectDef.modifyDeclaration）。
 */
async function packPatchingPalmTree(): Promise<AssetPack> {
  return AssetPack.read(
    zipArchive([
      { name: 'pack.yaml', content: "id: patching\nversion: '1'\n" },
      {
        name: 'world-codex/patch.yaml',
        // 書き換えの動詞をすべて通す——複製へ移り損ねる経路が1つでも残っていれば、下の
        // 「次の読み込みには残らない」がその動詞のところで赤くなる。
        content: [
          'patch_object_defs:',
          '  - add: palm_tree.props.patch_added_prop',
          '    value: {value: 1}',
          '  - append: palm_tree.tags',
          '    value: patch_appended_tag',
          '  - set: palm_tree.tags',
          '    where: patch_appended_tag',
          '    value: patch_set_tag',
          '  - remove: palm_tree.interactions.pick_frond',
          '',
        ].join('\n'),
      },
    ]),
  );
}

function palmTreeOf(codex: WorldCodex): ObjectDef {
  return codex.objects.get(codex.objectNames.getId('palm_tree'));
}

describe('同梱ぶんのパース結果の控え', () => {
  it('パックが同梱の宣言を書き換えても、次の読み込みには残らない', async () => {
    const patching = await packPatchingPalmTree();

    const report = new LoadReport();
    const patched = loadWorldCodex([patching], report);
    expect(report.problems, 'どのpatchも行えている').toEqual([]);
    expect(patched.propertyNames.tryGetId('patch_added_prop'), 'addが当たっている').toBeDefined();
    expect(patched.tagNames.tryGetId('patch_set_tag'), 'append+setが当たっている').toBeDefined();
    expect(palmTreeOf(patched).declaresInteraction('pick_frond'), 'removeが当たっている').toBe(false);

    const plain = loadWorldCodex([], new LoadReport());
    expect(plain.propertyNames.tryGetId('patch_added_prop'), '足したpropが残らない').toBeUndefined();
    expect(plain.tagNames.tryGetId('patch_set_tag'), '差し替えたtagが残らない').toBeUndefined();
    expect(palmTreeOf(plain).declaresInteraction('pick_frond'), '落とした操作が戻っている').toBe(true);
  });
});

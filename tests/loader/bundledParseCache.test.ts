import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { AssetPack } from '../../src/asset-pack/AssetPack';
import { LoadReport } from '../../src/loader/LoadReport';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
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

  /**
   * 控えをそのまま配れる根拠は「**読み込みは渡されたDocumentを書き換えない**」で、宣言のノードは
   * その一部でしかない。patchが接ぎ木する値も読み込み元のノードなので、複製せずに挿すと、
   * その先へ降りた後続のpatchが読み込み元を書き換える（RawPatch.value）。
   *
   * 同梱ぶんはまだpatchを1つも持たないので、控えを通しては再現できない。読み込み1回で見る。
   */
  it('接ぎ木した値の先へ降りるpatchがあっても、渡したDocumentは書き換わらない', () => {
    const doc = parseDocument(
      [
        'object_defs:',
        '  thing:',
        '    props:',
        '      weight: {value: 1}',
        'patch_object_defs:',
        '  - add: thing.props.mood',
        '    value: {value: 1}',
        '  - set: thing.props.mood.value',
        '    value: 99',
        '',
      ].join('\n'),
    );
    const before = String(doc);

    new WorldCodexYamlLoader().loadDocument('patched.yaml', doc).buildAndReset();

    expect(String(doc)).toBe(before);
  });
});

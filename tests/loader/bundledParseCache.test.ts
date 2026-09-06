import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/asset-pack/AssetPack';
import { LoadReport } from '../../src/loader/LoadReport';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { zipArchive } from '../support/zipArchive';

/**
 * 同梱ぶんのパース結果は読み込みをまたいで控えられる（loadWorldCodex）。控えを配るからには、
 * **前の読み込みでの書き換えが次へ残らない**ことが要る——patch（GameElementDefinition.md 3.4節）は
 * 宣言のノードそのものを書き換えるので、控えをそのまま配ると2回目以降がそれを見る。
 */
async function packPatchingPalmTree(): Promise<AssetPack> {
  return AssetPack.read(
    zipArchive([
      { name: 'pack.yaml', content: "id: patching\nversion: '1'\n" },
      {
        name: 'world-codex/patch.yaml',
        content: [
          'patch_object_defs:',
          '  - add: palm_tree.props.patch_marker',
          '    value: {value: 1}',
          '',
        ].join('\n'),
      },
    ]),
  );
}

describe('同梱ぶんのパース結果の控え', () => {
  it('パックが同梱の宣言を書き換えても、次の読み込みには残らない', async () => {
    const patching = await packPatchingPalmTree();

    const patched = loadWorldCodex([patching], new LoadReport());
    expect(patched.propertyNames.tryGetId('patch_marker'), 'patchが当たっている').toBeDefined();

    const plain = loadWorldCodex([], new LoadReport());
    expect(plain.propertyNames.tryGetId('patch_marker'), '次の読み込みには残らない').toBeUndefined();
  });
});

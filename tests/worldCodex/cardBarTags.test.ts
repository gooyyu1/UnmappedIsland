import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * カードの状態バー（CardView.md 8節）に関わる宣言が、同梱の定義と食い違っていないかの自動テスト。
 *
 * バーを何本出すかは`gauge`宣言（6.8節）の数がそのまま決めるので、本数に上限は無い。ここで見るのは
 * 「1つの値しか読まない」ことが前提になっている中身の色（fill_colorタグ）だけ。
 */
describe('カードの状態バーの宣言', () => {
  let codex: WorldCodex;
  let defs: readonly ObjectDef[];

  beforeAll(() => {
    // 製作中オブジェクトの自動生成（inProgressObjects.ts）が足すgaugeも含めて見るため、build()を通す。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    defs = Array.from({ length: codex.objects.count }, (_, globalId) => codex.objects.get(globalId));
  });

  it('1つのobject_defにfill_colorタグの付いたプロパティは高々1つ', () => {
    // PlayScreenViewはprops宣言順で最初の1つしか読まない。2つ以上付けても片方が静かに無視される
    // だけでエラーにならないので、付け過ぎをここで捕まえる。
    const tagId = codex.propertyTagNames.getId('fill_color');
    const tooMany = defs
      .filter((def) => def.enumeratePropertyDefs().filter((prop) => prop.hasTag(tagId)).length > 1)
      .map((def) => def.name);

    expect(tooMany).toEqual([]);
  });

  it('gaugeを宣言したプロパティは必ずrangeを持つ（割合が定義できる）', () => {
    // ロード時に弾いている（parseProperties）ことを、同梱の定義の側からも確かめる。これが崩れると
    // readGaugesの返す読み取りにratioが無く、バーが黙って消える。
    const withoutRange = defs.flatMap((def) =>
      def
        .enumeratePropertyDefs()
        .filter((prop) => prop.gauge !== undefined && prop.ratioOf(0) === undefined)
        .map((prop) => `${def.name}.${prop.name}`),
    );

    expect(withoutRange).toEqual([]);
  });
});

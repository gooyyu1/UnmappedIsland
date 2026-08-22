import { describe, expect, it } from 'vitest';
import { DescriptionWriter } from '../../src/codex-viewer/describe/Description';
import { defNamesOf } from '../../src/codex-viewer/describe/codexNames';
import { describeObjectDef } from '../../src/codex-viewer/describe/describeObjectDef';
import { describePassive } from '../../src/codex-viewer/describe/describePassive';
import { describeInteraction } from '../../src/codex-viewer/describe/describeInteraction';
import { describeProperty } from '../../src/codex-viewer/describe/describeProperty';
import { describeRecipe } from '../../src/codex-viewer/describe/describeRecipe';
import { describeAccept } from '../../src/codex-viewer/describe/describeSlot';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { DefNames } from '../../src/codex-viewer/describe/Description';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 同梱の宣言が、1つ残らず読める形へ書き出せるかの検査。
 *
 * **書き出せない宣言はビューアで空行になる**——エラーにはならないので、YAMLに新しい書き方を足した
 * ときの取りこぼしは、ここでしか気付けない。仕組みそのものの試験は
 * tests/codex-viewer/description.test.ts が受け持つ。
 */
/** 型が直に持つ持続効果をすべて書き出す（describe側は宣言1つずつを受け取る）。 */
function describeAllPassives(def: ObjectDef, names: DefNames, out: DescriptionWriter): void {
  for (const effect of def.passives.declarations) describePassive(effect, names, out);
}

describe('同梱のWorldCodex', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  const names = defNamesOf(codex);

  it('すべての型・プロパティ・スロット・操作・レシピが書き出せる', () => {
    const writer = new DescriptionWriter();
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.tryGet(globalId);
      if (def === undefined) continue;
      describeObjectDef(def, names, writer);
      describeAllPassives(def, names, writer);
      for (const propertyDef of def.enumeratePropertyDefs()) describeProperty(propertyDef, names, writer);
      for (const slotDef of def.enumerateSlotDefs()) describeAccept(slotDef, names, writer);
      for (const interaction of [...def.actions, ...def.combinations])
        describeInteraction(interaction, names, writer);
      for (const recipe of def.recipes) describeRecipe(recipe, names, writer);
    }

    // 空行（何も書かれていない行）が混ざっていないこと＝どの宣言も言い表せている。
    expect(writer.toLines().every((line) => line.toPlainText().length > 0)).toBe(true);
    expect(writer.toLines().length).toBeGreaterThan(100);
  });
});

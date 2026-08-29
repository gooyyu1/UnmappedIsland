import { describe, expect, it } from 'vitest';
import { CodexSource } from '../../src/codex-viewer/CodexSource';
import { CodexView } from '../../src/codex-viewer/CodexView';
import { DescriptionWriter } from '../../src/codex-viewer/describe/Description';
import { defNamesOf } from '../../src/codex-viewer/describe/codexNames';
import { conditionTokens } from '../../src/codex-viewer/describe/conditionTokens';
import { describeObjectDef } from '../../src/codex-viewer/describe/describeObjectDef';
import { describePassive } from '../../src/codex-viewer/describe/describePassive';
import { describeInteraction } from '../../src/codex-viewer/describe/describeInteraction';
import { describeProperty } from '../../src/codex-viewer/describe/describeProperty';
import { describeRecipe } from '../../src/codex-viewer/describe/describeRecipe';
import { describeAccept } from '../../src/codex-viewer/describe/describeSlot';
import type { ConditionDeclaration } from '../../src/domain/ConditionReader';
import { conditionWords } from '../../src/domain/conditionWords';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { ReferenceRoot } from '../../src/domain/ReferenceRoot';
import type { DefNames } from '../../src/codex-viewer/describe/Description';
import { bundledLocaleText, LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 同梱の宣言が、1つ残らず読める形へ書き出せるか・その参照が正しい先を指すかの検査。
 *
 * **書き出せない宣言はビューアで空行になり、参照の指し違いは同名のプロパティに紛れる**——どちらも
 * エラーにはならないので、YAMLに新しい書き方を足したときの取りこぼしは、ここでしか気付けない。
 * 仕組みそのものの試験は tests/codex-viewer/description.test.ts が受け持つ。
 */
/** 型が直に持つ持続効果をすべて書き出す（describe側は宣言1つずつを受け取る）。 */
function describeAllPassives(def: ObjectDef, names: DefNames, out: DescriptionWriter): void {
  for (const effect of def.passives.declarations) describePassive(effect, names, out);
}

/**
 * 条件が参照しているプロパティと、その起点。同じプロパティを違う起点から見ることがあるので、
 * 識別子ごとに起点の集合で持つ。
 */
function conditionPropertyRoots(
  condition: ConditionDeclaration,
  names: DefNames,
): ReadonlyMap<string, ReadonlySet<ReferenceRoot>> {
  const roots = new Map<string, Set<ReferenceRoot>>();
  conditionWords<string>(condition, {
    text: () => '',
    property: (globalId, root) => {
      const name = names.propertyName(globalId);
      const seen = roots.get(name) ?? new Set<ReferenceRoot>();
      roots.set(name, seen.add(root));
      return '';
    },
    propertyValue: () => '',
    slot: () => '',
    tag: () => '',
    object: () => '',
    stage: () => '',
  });
  return roots;
}

describe('同梱のWorldCodex', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
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
      for (const trigger of def.triggers) describeInteraction(trigger, names, writer);
      for (const recipe of def.recipesProducingThis) describeRecipe(recipe, names, writer);
    }

    // 空行（何も書かれていない行）が混ざっていないこと＝どの宣言も言い表せている。
    expect(writer.toLines().every((line) => line.toPlainText().length > 0)).toBe(true);
    expect(writer.toLines().length).toBeGreaterThan(100);
  });

  /**
   * 条件の文は主語を語で言う（`使う物のfill = 0`）。その参照のリンクが宣言元の型を指すと、
   * 文とリンクが食い違う——液体の入った容器は相手と同じ`fill`を持つので、宣言元へ向いていても
   * 見た目には気付けない（issue #997）。
   *
   * **生成された変種も見る**——宣言元と相手が同じ型になるのは変種の側なので、一覧に出る型
   * （listedObjectDefs）だけでは現れない。
   */
  it('条件のプロパティ参照は、起点がselfでなければ宣言元の型を指さない', () => {
    const view = new CodexView(
      new CodexSource(codex, parseLocale(LOCALE_FILE, bundledLocaleText()), []),
      'identifier',
    );
    const wrong: string[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.tryGet(globalId);
      if (def === undefined) continue;
      for (const trigger of def.triggers)
        for (const requirement of trigger.interaction.requirementDeclarations) {
          const html = view.tokensHtml(conditionTokens(requirement.condition, names), def.name);
          for (const [propertyName, roots] of conditionPropertyRoots(requirement.condition, names))
            if (!roots.has('self') && html.includes(view.propertyHref(def.name, propertyName)))
              wrong.push(`${def.name}: ${propertyName}（起点: ${[...roots].join('・')}）`);
        }
    }

    expect(wrong).toEqual([]);
  });
});

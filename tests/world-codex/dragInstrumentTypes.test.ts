import { describe, expect, it } from 'vitest';
import type { ConditionDeclaration, ConditionReader } from '../../src/domain/ConditionReader';
import type { ReferenceRoot } from '../../src/domain/ReferenceRoot';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * ドラッグの相手（`instrument`）の型は、きっかけの `{drag: ...}` が**タグかidを1つ**指して決める
 * （`GameElementDefinition.md` 12.1節）。「複数のタグを同時に満たすもの」を書く道は無く、要るように
 * なったかどうかは**条件の側を見れば分かる**——1つでは絞り切れなければ、相手の型を見る判定
 * （`{subject: instrument, matches: ...}`）が条件へ降りてくる。
 *
 * **降りてきた判定のうち、`reason` を持たないものだけが「絞り切れなかった」印。** 理由を書いた判定は
 * 断りをプレイヤーへ届けるための宣言（14.6節）で、きっかけ側で弾くと候補から静かに消えてしまうため、
 * ANDが書けるようになっても条件に残る。
 */
describe('ドラッグの相手の型を、条件が絞っているか', () => {
  /** 条件の木に、`instrument`自身の型を見る判定が在るか。 */
  class InstrumentTypeCheck implements ConditionReader {
    found = false;

    property(): void {}
    propertyStage(): void {}
    slotPosition(): void {}

    /** `{subject: instrument, slot: ..., matches: ...}`は中身を見る判定で、相手自身の型ではない。 */
    slotContent(): void {}

    objectMatches(root: ReferenceRoot): void {
      if (root === 'instrument') this.found = true;
    }

    all(children: readonly ConditionDeclaration[]): void {
      for (const child of children) child.readBy(this);
    }

    any(children: readonly ConditionDeclaration[]): void {
      for (const child of children) child.readBy(this);
    }

    not(child: ConditionDeclaration): void {
      child.readBy(this);
    }
  }

  /** 相手の型を見る判定を持つドラッグの宣言を、理由の有無で分けて`型.操作`の形で集める。 */
  function narrowedByCondition(codex: WorldCodex): { withReason: string[]; withoutReason: string[] } {
    const withReason: string[] = [];
    const withoutReason: string[] = [];
    for (const def of codex.objects)
      for (const trigger of def.dragTriggers)
        for (const requirement of trigger.interaction.requirementDeclarations) {
          const check = new InstrumentTypeCheck();
          requirement.condition.readBy(check);
          if (!check.found) continue;
          const where = `${def.name}.${trigger.interaction.name}`;
          if (requirement.reasonName === undefined) withoutReason.push(where);
          else withReason.push(where);
        }
    return { withReason, withoutReason };
  }

  const PROBE_YAML = `
object_defs:
  blade: {tags: [blade]}
  dull_blade: {tags: [blade, dull]}
  log:
    interactions:
      chop:
        trigger: {drag: {tag: blade}}
        conditions:
          - not: {subject: instrument, matches: {tag: dull}}
        destroy: self
`;

  it('相手の型を見る条件を、理由の有無で拾い分けられる', () => {
    const probe = new WorldCodexYamlLoader().load('probe.yaml', PROBE_YAML).buildAndReset();
    expect(narrowedByCondition(probe)).toEqual({ withReason: [], withoutReason: ['log.chop'] });

    const withReason = PROBE_YAML.replace(
      '          - not:',
      '          - reason: too_dull\n            not:',
    );
    const named = new WorldCodexYamlLoader().load('probe.yaml', withReason).buildAndReset();
    expect(narrowedByCondition(named)).toEqual({ withReason: ['log.chop'], withoutReason: [] });
  });

  it('同梱の宣言に、理由を出さない絞り込みは無い（＝相手はタグかidを1つで書けている）', () => {
    const codex = bundledCodex();
    expect([...codex.objects].flatMap((def) => def.dragTriggers).length).toBeGreaterThan(0);
    expect(narrowedByCondition(codex).withoutReason).toEqual([]);
  });
});

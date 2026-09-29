import { describe, expect, it } from 'vitest';
import { ConsumptionCondition } from '../../src/analysis/balanceTables';
import { tickDeltasOf } from '../../src/analysis/tickDeltas';
import type { ConditionDeclaration } from '../../src/domain/ConditionReader';
import { conditionKey } from '../../src/domain/conditionKey';
import { conditionText } from '../../src/domain/conditionWords';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 同梱の定義が書いている条件（14節）に対する、正準な鍵（`src/domain/conditionKey.ts`）の検査
 * （issue #2252）。
 *
 * 鍵が担うのは**同じ条件かを綴りによらずに答えること**で、消費表の行の同一性・`stats/balance.yaml` の
 * `consumption[].condition`・文書の引用印がこの値で揃っている。何を区別して何を畳むかは
 * `tests/domain/conditionKey.test.ts` が、組み立てた条件で見る。
 */

const codex = bundledCodex();

/** 同梱の定義が書いている条件を全部集める（`resists`・操作の要件・tick毎の増減のゲート）。 */
function declaredConditions(source: WorldCodex): readonly ConditionDeclaration[] {
  const found: ConditionDeclaration[] = [];
  for (const def of source.objects) {
    if (def.resists !== undefined) found.push(def.resists);
    for (const trigger of [...def.menuTriggers, ...def.dragTriggers])
      for (const requirement of trigger.interaction.requirementDeclarations)
        found.push(requirement.condition);
    for (const delta of tickDeltasOf(def))
      if (delta.gate.conditions !== undefined) found.push(delta.gate.conditions);
  }
  return found;
}

describe('条件の正準な鍵（同梱の定義）', () => {
  const conditions = declaredConditions(codex);

  it('条件を1つ以上拾えている', () => {
    // 下の検査は1つも拾えなくても緑になるので、拾えていることを先に言う。
    expect(conditions.length).toBeGreaterThan(0);
  });

  it('日本語が1文字も混じらず、空白も含まない', () => {
    // 空白を含まないことが、引用印のセレクタ値（`condition=...`）を引用符なしで書ける理由。
    const offenders = [...new Set(conditions.map((condition) => conditionKey(codex, condition)))].filter(
      (key) => !/^[!-~]+$/.test(key),
    );

    expect(offenders, 'この鍵が綴りに寄っている').toEqual([]);
  });

  /**
   * 文（`conditionWords`）と鍵の畳み方が揃っていることの検査。**揃わなくなると、どちらかの向きで
   * 必ず破れる**——鍵だけが畳めば同じ鍵の行が2つの文を持ち、文だけが畳めば見分けの付かない行が
   * 2つ並ぶ。
   */
  it('同じ文になる条件は同じ鍵、同じ鍵の条件は同じ文', () => {
    const keysByText = new Map<string, Set<string>>();
    const textsByKey = new Map<string, Set<string>>();
    for (const condition of conditions) {
      const key = conditionKey(codex, condition);
      const text = conditionText(codex, condition);
      (keysByText.get(text) ?? keysByText.set(text, new Set()).get(text)!).add(key);
      (textsByKey.get(key) ?? textsByKey.set(key, new Set()).get(key)!).add(text);
    }

    expect(
      [...keysByText].filter(([, keys]) => keys.size > 1),
      '同じ文の条件に、違う鍵が付いている',
    ).toEqual([]);
    expect(
      [...textsByKey].filter(([, texts]) => texts.size > 1),
      '同じ鍵の条件が、違う文になっている',
    ).toEqual([]);
  });
});

/**
 * 消費表の行を分ける条件（`ConsumptionCondition`）の検査。上の describe が見ているのは条件の木だけで、
 * **行の鍵はそこへ段の宣言（8.2節）と輸送（8.4節）を足したもの**なので、別に見る。
 *
 * 行は鍵で畳まれる。**同じ鍵に違う文が来ると、後から来たほうは表に出ないまま量だけが混ざる**ので、
 * 行になった後ではなく、畳む前の増減1つずつから見る。
 */
describe('消費行を分ける条件（同梱の定義）', () => {
  const conditions = [...codex.objects].flatMap((def) =>
    tickDeltasOf(def)
      .filter((delta) => delta.target === 'self')
      .map((delta) => new ConsumptionCondition(codex, delta.gate, delta.capped)),
  );

  it('増減を1つ以上拾えている', () => {
    expect(conditions.length).toBeGreaterThan(0);
  });

  it('鍵に空白が無い', () => {
    // 引用印（`condition=...`）が引用符なしで書けることが、これに掛かっている。
    const offenders = [...new Set(conditions.map((condition) => condition.key))].filter(
      (key) => !/^[!-~]+$/.test(key),
    );

    expect(offenders, 'この鍵は引用印へそのまま書けない').toEqual([]);
  });

  it('同じ鍵なら同じ文、同じ文なら同じ鍵', () => {
    const textsByKey = new Map<string, Set<string>>();
    const keysByText = new Map<string, Set<string>>();
    for (const condition of conditions) {
      const { key, text } = condition;
      (textsByKey.get(key) ?? textsByKey.set(key, new Set()).get(key)!).add(text);
      (keysByText.get(text) ?? keysByText.set(text, new Set()).get(text)!).add(key);
    }

    expect(
      [...textsByKey].filter(([, texts]) => texts.size > 1),
      '同じ鍵へ畳まれる増減が、違う文になっている',
    ).toEqual([]);
    expect(
      [...keysByText].filter(([, keys]) => keys.size > 1),
      '同じ文になる増減が、別の行へ割れている',
    ).toEqual([]);
  });
});

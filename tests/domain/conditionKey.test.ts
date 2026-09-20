import { describe, expect, it } from 'vitest';
import { ConditionNode } from '../../src/domain/ConditionNode';
import { conditionKey } from '../../src/domain/conditionKey';
import { PropertyPath } from '../../src/domain/ReferenceRoot';
import { TypeMatchRule } from '../../src/domain/TypeMatchRule';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 条件（14節）の正準な鍵（`src/domain/conditionKey.ts`）が、**何を区別して何を畳むか**の検査
 * （issue #2252）。
 *
 * 鍵が担うのは「同じ条件か」を綴りによらずに答えること。**区別しそこねれば違う条件が1行へ混ざり、
 * 畳みそこねれば見分けの付かない行が2つ並ぶ**ので、どちらの向きもここで見る。同梱の定義に対する
 * 検査は `tests/diagnostics/conditionKeys.test.ts`。
 */

const codex = new WorldCodexYamlLoader()
  .load(
    'conditionKey.yaml',
    'object_defs:\n' +
      '  body:\n' +
      '    tags: [creature]\n' +
      '    props:\n' +
      '      warmth: {value: 10}\n' +
      '      pathogen: {value: 0}\n',
  )
  .buildAndReset();

const warmth = codex.propertyNames.getId('warmth');
const pathogen = codex.propertyNames.getId('pathogen');
const creature = codex.tagNames.getId('creature');

/** 比べる相手を1つ決めておく。以下はすべて、ここから1点だけ変えたもの。 */
const above = ConditionNode.property('self', warmth, 'gte', [10]);

const keyOf = (condition: ConditionNode): string => conditionKey(codex, condition);

describe('条件の正準な鍵', () => {
  it('同じ条件を別々に組み立てても、同じ鍵になる', () => {
    expect(keyOf(ConditionNode.property('self', warmth, 'gte', [10]))).toBe(keyOf(above));
  });

  it('比較演算子・主語・相手・プロパティが変われば、鍵が変わる', () => {
    const keys = [
      above,
      ConditionNode.property('self', warmth, 'gt', [10]),
      ConditionNode.property('ancestor', warmth, 'gte', [10]),
      ConditionNode.property('self', warmth, 'gte', [11]),
      ConditionNode.property('self', pathogen, 'gte', [10]),
    ].map(keyOf);

    expect(new Set(keys).size, `区別しない: ${keys.join(' / ')}`).toBe(keys.length);
  });

  it('リテラルとの比較と、別のプロパティを見る比較は別の鍵になる', () => {
    const ref = ConditionNode.property('self', warmth, 'gte', undefined, new PropertyPath('self', pathogen));

    expect(keyOf(ref)).not.toBe(keyOf(ConditionNode.property('self', warmth, 'gte', [0])));
  });

  it('段は、ちょうどその段かその段以上かで鍵が変わる', () => {
    expect(keyOf(ConditionNode.propertyStage('self', pathogen, 'latent', 'exact'))).not.toBe(
      keyOf(ConditionNode.propertyStage('self', pathogen, 'latent', 'or_above')),
    );
  });

  it('型の指定は、当てはまることと当てはまらないことで鍵が変わる', () => {
    const match = TypeMatchRule.ofTag(creature);

    expect(keyOf(ConditionNode.objectMatches('self', match))).not.toBe(
      keyOf(ConditionNode.objectMatches('self', TypeMatchRule.not(match))),
    );
  });

  it('並べた子の順が変われば、鍵が変わる', () => {
    const other = ConditionNode.property('self', pathogen, 'lt', [5]);

    expect(keyOf(ConditionNode.all([above, other]))).not.toBe(keyOf(ConditionNode.all([other, above])));
  });

  it('論理積と論理和は、同じ子を並べても別の鍵になる', () => {
    const other = ConditionNode.property('self', pathogen, 'lt', [5]);

    expect(keyOf(ConditionNode.all([above, other]))).not.toBe(keyOf(ConditionNode.any([above, other])));
  });

  it('否定は葉まで押し下がる（文と同じ）', () => {
    const negated = ConditionNode.not(above);

    expect(keyOf(negated)).toBe(keyOf(ConditionNode.property('self', warmth, 'lt', [10])));
    expect(keyOf(negated)).not.toBe(keyOf(above));
  });

  it('否定の下の論理積は論理和になる（文と同じ）', () => {
    const other = ConditionNode.property('self', pathogen, 'lt', [5]);

    expect(keyOf(ConditionNode.not(ConditionNode.all([above, other])))).toBe(
      keyOf(
        ConditionNode.any([
          ConditionNode.property('self', warmth, 'lt', [10]),
          ConditionNode.property('self', pathogen, 'gte', [5]),
        ]),
      ),
    );
  });

  it('子が1つだけの論理積は、その子そのものと同じ鍵になる（文と同じ）', () => {
    expect(keyOf(ConditionNode.all([above]))).toBe(keyOf(above));
  });
});

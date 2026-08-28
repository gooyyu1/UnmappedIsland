import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { defNamesOf } from '../../src/codex-viewer/describe/codexNames';
import { conditionTokens } from '../../src/codex-viewer/describe/conditionTokens';
import type { ConditionDeclaration } from '../../src/domain/ConditionReader';
import { conditionText } from '../../src/domain/conditionWords';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 待ち生産表（`stats/balance.yaml`の`devices`）の`condition`が、**同梱の定義に対して行どうしを
 * 区別する**ことの検査（issue #961）と、その文が**コーデックスビューアと同じ**ことの検査
 * （issue #987）。
 *
 * この列が「条件つき」の1語しか出せないと、設備の行は全部が同じ姿になる。読み手が知りたいのは
 * そこが違うこと——罠は置けば成立し、ヤケイの繁殖は囲いと飼葉が要る。
 *
 * **読み分けの検査なので、文言そのものは見ない。** 見るのは、条件が名指ししている枠と
 * プロパティの識別子が出ていることと、行どうしが違う語になること。
 */

const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

describe('待ち生産の条件（同梱の定義）', () => {
  const devices = buildBalanceTables(codex, SAMPLE_CHARACTER).places.find(
    (place) => place.name === WHOLE_ISLAND,
  )?.devices;

  /** その設備の行の条件（産物ごとに行が分かれるが、条件は設備の周期のものなので1つ）。 */
  function conditionOf(deviceName: string): string {
    const conditions = [
      ...new Set((devices ?? []).filter((row) => row.deviceName === deviceName).map((row) => row.condition)),
    ];

    expect(conditions, `${deviceName}の行が1つも無い`).toHaveLength(1);
    return conditions[0];
  }

  it('ヤケイの繁殖が、囲いの枠と飼葉を名指しする', () => {
    const condition = conditionOf('junglefowl');

    expect(condition, '囲いの枠に居ることが出ていない').toContain('livestock');
    expect(condition, '飼葉が要ることが出ていない').toContain('fodder');
  });

  it('罠の判定が、地面の枠を名指しする', () => {
    const condition = conditionOf('snare');

    expect(condition, '地面に置いてあることが出ていない').toContain('items');
    expect(condition, '飼葉は罠の条件ではない').not.toContain('fodder');
  });

  it('設備どうしの条件が別の語になる', () => {
    const conditions = ['junglefowl', 'pen', 'snare'].map(conditionOf);

    expect(new Set(conditions).size, `行を区別しない: ${conditions.join(' / ')}`).toBe(conditions.length);
  });
});

/** 宣言元の名前を添えた条件1つ。ずれた行がどの宣言のものか、名前だけで引けるようにする。 */
interface DeclaredCondition {
  readonly owner: string;
  readonly condition: ConditionDeclaration;
}

/** 同梱の定義が書いている条件（`resists`と操作の要件）を全部集める。 */
function declaredConditions(source: WorldCodex): readonly DeclaredCondition[] {
  const found: DeclaredCondition[] = [];
  for (const def of source.objects) {
    if (def.resists !== undefined) found.push({ owner: `${def.name}.resists`, condition: def.resists });
    for (const trigger of [...def.menuTriggers, ...def.dragTriggers])
      for (const requirement of trigger.interaction.requirementDeclarations)
        found.push({
          owner: `${def.name}.${trigger.interaction.name}`,
          condition: requirement.condition,
        });
  }
  return found;
}

/**
 * 収支の表とコーデックスビューアが、**同じ宣言から同じ文**を出すことの検査（issue #987）。
 *
 * 文の形を決めるのはドメイン（`conditionWords`）1箇所で、置き場所ごとに違うのは識別子の姿だけ
 * ——表は識別子そのまま、ビューアはリンクを張れる断片。ここが落ちるときは、どちらかが自前で
 * 文を組み立て直している。
 */
describe('条件の文（表とビューア）', () => {
  const names = defNamesOf(codex);
  const conditions = declaredConditions(codex);

  it('同梱の定義に条件が在る', () => {
    // 集め方が壊れて空になれば、以下の検査は何も見ずに通ってしまう。
    expect(conditions.length).toBeGreaterThan(10);
  });

  it('同じ宣言から同じ文が出る', () => {
    const differing = conditions
      .map(({ owner, condition }) => ({
        owner,
        table: conditionText(codex, condition),
        viewer: conditionTokens(condition, names)
          .map((token) => (token.kind === 'text' ? token.text : token.name))
          .join(''),
      }))
      .filter((entry) => entry.table !== entry.viewer);

    expect(differing, '表とビューアで文が違う').toEqual([]);
  });

  it('ビューアの文では、識別子が参照の断片になっている', () => {
    // 平文へ揃えた結果リンクが消えていないこと。条件は必ず何かの識別子を名指しする。
    const textOnly = conditions
      .filter(({ condition }) => conditionTokens(condition, names).every((token) => token.kind === 'text'))
      .map((entry) => entry.owner);

    expect(textOnly, 'リンクを張れる断片が1つも無い').toEqual([]);
  });
});

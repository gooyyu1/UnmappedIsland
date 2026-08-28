import { describe, expect, it } from 'vitest';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 待ち生産表（`stats/balance.yaml`の`devices`）の`condition`が、**同梱の定義に対して行どうしを
 * 区別する**ことの検査（issue #961）。
 *
 * この列が「条件つき」の1語しか出せないと、設備の行は全部が同じ姿になる。読み手が知りたいのは
 * そこが違うこと——罠は置けば成立し、ヤケイの繁殖は囲いと飼葉が要る。
 *
 * **読み分けの検査なので、文言そのものは見ない。** 見るのは、条件が名指ししている枠と
 * プロパティの識別子が出ていることと、行どうしが違う語になること。
 */
describe('待ち生産の条件（同梱の定義）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
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

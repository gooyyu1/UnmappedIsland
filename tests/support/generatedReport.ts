import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

/**
 * 生成済みのレポート（`docs/diagnostics/*.md`）を、今の定義から作り直して書き出す試験を立てる。
 *
 * 通常のテストスイート（`npm test`）には含めない。合否判定ではなく、数値を触ったときの影響を差分で
 * 読むための再計算で、気候のように数分かかるものもあるため、`regenerateEnvVar` が `1` のときだけ
 * 走る（`npm run stats:*`）。
 *
 * **書き出した後に見るのは、`requiredHeadings` の節が消えていないことだけ。** 定義から解く道具は
 * 読み方が定義とずれても例外を投げずに0行を返し、レポートは0行の節を丸ごと落とすので、壊れたことが
 * 「節が消える」形でしか現れない（issue #765）。値の妥当性は各解析の単体試験と、再生成したレポートの
 * 差分が持つ。
 */
export function describeReportRegeneration(
  reportPath: string,
  regenerateEnvVar: string,
  buildFromDefinitions: () => string,
  requiredHeadings: readonly string[],
): void {
  describe.runIf(process.env[regenerateEnvVar] === '1')(`${basename(reportPath)}の再生成`, () => {
    it('今の定義から作り直して書き出す', () => {
      const report = buildFromDefinitions();
      writeFileSync(reportPath, report, 'utf8');
      console.log(`Report written to: ${reportPath}`);

      const missing = requiredHeadings.filter((heading) => !report.includes(heading));
      expect(missing, '作り直したレポートから節が消えている').toEqual([]);
    }, 600_000);
  });
}

/**
 * 生成済みのレポート（`docs/diagnostics/*.md`）が、今の定義より古くなっていないかを見る試験を立てる。
 *
 * **丸ごと作り直して比べる。** レポートの入力は定義（YAML）だけではなく、気候の実測値のように解析側が
 * 持つ値も含むので、YAMLの指紋では取りこぼす——#776 で気候の定数を直したとき、収支表が3行ずれた。
 *
 * **見るのは古さだけで、値の妥当性は見ない。** 値はそれぞれの単体試験と、再生成したレポートの差分が持つ。
 */
export function describeReportFreshness(
  reportPath: string,
  regenerateCommand: string,
  buildFromDefinitions: () => string,
): void {
  describe(`${basename(reportPath)}の鮮度`, () => {
    it('生成済みのレポートが、今の定義から作り直したものと一致する', () => {
      const stored = readFileSync(reportPath, 'utf8');

      expect(normalizeNewlines(stored), `古い。'${regenerateCommand}'で再生成する`).toBe(
        normalizeNewlines(buildFromDefinitions()),
      );
    }, 600_000);
  });
}

/** CRLFの作業ツリーで生成したレポートが、LFの作業ツリーで食い違わないようにする。 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

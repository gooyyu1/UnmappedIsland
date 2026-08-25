import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

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

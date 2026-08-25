import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 生成するレポート（`stats/*.yaml`・`docs/diagnostics/*.md`）の、書き出し方と見張り方。
 *
 * 数値の読み手はエージェントなので、書き出す先は機械可読な YAML にする（`stats/`）。人が読む散文は
 * 生成物ではなく手書きの文書（`docs/diagnostics/*.md`）が持つ。`.md` へ書き出す形は、まだ移していない
 * レポートのために残してある。
 */

/**
 * 生成済みのレポートを、今の定義から作り直して書き出す試験を立てる。
 *
 * 通常のテストスイート（`npm test`）には含めない。合否判定ではなく、数値を触ったときの影響を差分で
 * 読むための再計算で、気候のように数分かかるものもあるため、`regenerateEnvVar` が `1` のときだけ
 * 走る（`npm run stats:*`）。
 *
 * **書き出した後に見るのは、節が消えていないことだけ。** 定義から解く道具は読み方が定義とずれても
 * 例外を投げずに0行を返し、レポートは0行の節を丸ごと落とすので、壊れたことが「節が消える」形でしか
 * 現れない（issue #765）。値の妥当性は各解析の単体試験と、再生成したレポートの差分が持つ。
 */
export function describeReportRegeneration(
  reportPath: string,
  regenerateEnvVar: string,
  buildFromDefinitions: () => string,
  requiredHeadings: readonly string[],
): void {
  describeRegeneration(reportPath, regenerateEnvVar, buildFromDefinitions, (report) =>
    requiredHeadings.filter((heading) => !report.includes(heading)),
  );
}

/**
 * YAMLのレポート版の {@link describeReportRegeneration}。
 *
 * 節が消えていないことの見方が、見出しの文字列から**構造**へ変わる——キーが在るだけでは足りず、
 * 中身が空（`[]`・`{}`）でないことまで見る。0行の節はキーごと落ちるとは限らないので、字面の照合では
 * 上の穴（issue #765）が塞がらない。
 */
export function describeYamlReportRegeneration(
  reportPath: string,
  regenerateEnvVar: string,
  buildFromDefinitions: () => string,
  requiredSectionKeys: readonly string[],
): void {
  describeRegeneration(reportPath, regenerateEnvVar, buildFromDefinitions, (report) =>
    missingYamlSections(report, requiredSectionKeys),
  );
}

function describeRegeneration(
  reportPath: string,
  regenerateEnvVar: string,
  buildFromDefinitions: () => string,
  missingIn: (report: string) => string[],
): void {
  describe.runIf(process.env[regenerateEnvVar] === '1')(`${basename(reportPath)}の再生成`, () => {
    it('今の定義から作り直して書き出す', () => {
      const report = buildFromDefinitions();
      writeFileSync(reportPath, report, 'utf8');
      console.log(`Report written to: ${reportPath}`);

      expect(missingIn(report), '作り直したレポートから節が消えている').toEqual([]);
    }, 600_000);
  });
}

/**
 * 生成済みのレポートが、今の定義より古くなっていないかを見る試験を立てる。
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

/** レポートのYAMLが持つ節の名前（先頭のキー）。 */
export function yamlSectionKeys(reportYaml: string): string[] {
  return Object.keys(sectionsOf(reportYaml));
}

/** `requiredSectionKeys` のうち、レポートのYAMLで消えている（キーが無い・中身が空の）もの。 */
export function missingYamlSections(reportYaml: string, requiredSectionKeys: readonly string[]): string[] {
  const sections = sectionsOf(reportYaml);
  return requiredSectionKeys.filter((key) => isEmptySection(sections[key]));
}

function sectionsOf(reportYaml: string): Record<string, unknown> {
  const parsed: unknown = parse(reportYaml);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function isEmptySection(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * YAMLへ数として書き出す値。**丸めた桁をそのまま残す**ため、`toFixed`の結果を数へ戻さずに持つ
 * （`0.00`が`0`に、`59.40`が`59.4`に潰れると、丸めの桁が行ごとに揺れて見える）。
 */
export class RoundedNumber {
  private readonly text: string;

  constructor(value: number, decimals: number) {
    this.text = value.toFixed(decimals);
  }

  toString(): string {
    return this.text;
  }
}

export type YamlScalar = string | number | boolean | null | RoundedNumber;
export type YamlRecordValue = YamlScalar | readonly YamlScalar[];

/** YAMLへ1行で書き出す1レコード。 */
export type YamlRecord = Readonly<Record<string, YamlRecordValue>>;

/**
 * レポートのYAMLの1節。**どの節もレコードの並び**で、数が1つでも並びのまま書く——読む側が節ごとに
 * 形を場合分けせずに済む。
 */
export interface YamlReportSection {
  readonly key: string;
  readonly records: readonly YamlRecord[];
}

/**
 * レポートのYAMLを組み立てる。**1レコード1行のフロー形式**で書く——ブロック形式だと`git diff`に
 * `-  mean: 59.40`としか出ず、どのレコードの値かが差分だけでは分からない。
 */
export function formatYamlReport(
  headerLines: readonly string[],
  sections: readonly YamlReportSection[],
): string {
  const lines = headerLines.map((line) => `# ${line}`);
  for (const { key, records } of sections) {
    lines.push('');
    lines.push(records.length === 0 ? `${key}: []` : `${key}:`);
    for (const record of records) lines.push(`  - ${formatRecord(record)}`);
  }
  return lines.join('\n') + '\n';
}

function formatRecord(record: YamlRecord): string {
  const fields = Object.entries(record).map(([key, value]) => `${key}: ${formatValue(value)}`);
  return `{${fields.join(', ')}}`;
}

function formatValue(value: YamlRecordValue): string {
  if (Array.isArray(value)) return `[${value.map(formatScalar).join(', ')}]`;
  return formatScalar(value as YamlScalar);
}

function formatScalar(value: YamlScalar): string {
  if (value === null) return 'null';
  if (value instanceof RoundedNumber) return value.toString();
  if (typeof value === 'string') return needsQuotes(value) ? `'${value.replace(/'/g, "''")}'` : value;
  return String(value);
}

/**
 * フロー形式の中でそのまま書けない文字列か。区切り記号を含むもののほか、**数・真偽・nullとして
 * 読まれてしまうもの**を囲む（型が変わると、読む側の分岐が黙って変わる）。
 */
function needsQuotes(text: string): boolean {
  return (
    text === '' ||
    text !== text.trim() ||
    /[,{}[\]:#&*!|>'"%@`]/.test(text) ||
    /^[-+.?\d]/.test(text) ||
    /^(true|false|null|~)$/i.test(text)
  );
}

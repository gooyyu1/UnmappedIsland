import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Stat } from './Stat';

/**
 * 生成するレポート（`stats/*.yaml`）の、書き出し方と見張り方。
 *
 * 数値の読み手はエージェントなので、書き出す先は機械可読な YAML にする（`stats/`）。人が読む散文は
 * 生成物ではなく手書きの文書（`docs/diagnostics/*.md`）が持ち、両者が食い違っていないことは
 * {@link describeDocumentedSections} が見る。
 */

/**
 * 定義からレポートの中身を作る関数。**数十秒を超えるものは非同期にして、区切りのよいところで
 * {@link yieldToEventLoop} を挟む**（同期のまま回し続けると、成功しても終了コードが1になる）。
 */
export type ReportBuilder = () => string | Promise<string>;

/**
 * 長い計算の途中で、イベントループへ一度返す。
 *
 * vitestのワーカーは、テストの進み具合をRPCで本体へ知らせて返事を待つ。**返事を受け取らないまま
 * 60秒ブロックすると** `Timeout calling "onTaskUpdate"` が未処理エラーとして立ち、テストが全部
 * 成功していても vitest は非ゼロで終わる（issue #828）。60秒はbirpcの既定値で、vitest 3.2.7には
 * これを延ばす設定が無い。
 */
export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * 生成済みのレポートを、今の定義から作り直して書き出す試験を立てる。
 *
 * 通常のテストスイート（`npm test`）には含めない。合否判定ではなく、数値を触ったときの影響を差分で
 * 読むための再計算で、気候のように1分強かかるものもあるため、`regenerateEnvVar` が `1` のときだけ
 * 走る（`npm run stats:*`）。
 *
 * **書き出した後に見るのは、節が消えていないことだけ。** 定義から解く道具は読み方が定義とずれても
 * 例外を投げずに0行を返すので、壊れたことが「節が空になる」形でしか現れない（issue #765）。キーが
 * 在るだけでは足りず、中身が空（`[]`・`{}`）でないことまで見る。値の妥当性は各解析の単体試験と、
 * 再生成したレポートの差分が持つ。
 */
export function describeYamlReportRegeneration(
  reportPath: string,
  regenerateEnvVar: string,
  buildFromDefinitions: ReportBuilder,
  requiredSectionKeys: readonly string[],
): void {
  describe.runIf(process.env[regenerateEnvVar] === '1')(`${basename(reportPath)}の再生成`, () => {
    it('今の定義から作り直して書き出す', async () => {
      const report = await buildFromDefinitions();
      writeFileSync(reportPath, report, 'utf8');
      console.log(`Report written to: ${reportPath}`);

      expect(
        missingYamlSections(report, requiredSectionKeys),
        '作り直したレポートから節が消えている',
      ).toEqual([]);
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
  buildFromDefinitions: ReportBuilder,
): void {
  describe(`${basename(reportPath)}の鮮度`, () => {
    it('生成済みのレポートが、今の定義から作り直したものと一致する', async () => {
      const stored = readFileSync(reportPath, 'utf8');

      expect(normalizeNewlines(stored), `古い。'${regenerateCommand}'で再生成する`).toBe(
        normalizeNewlines(await buildFromDefinitions()),
      );
    }, 600_000);
  });
}

/** 手書きの文書が「YAMLの節」の表で挙げている節。 */
export interface DocumentedSections {
  /** 表が挙げる全部。YAMLに在ってよい節の集合そのもの。 */
  readonly all: readonly string[];

  /** そのうち、空になってはいけないもの。 */
  readonly required: readonly string[];
}

/** 空であることが望ましい節（内容の穴の一覧など）を、表の説明の中で名乗る印。 */
const MAY_BE_EMPTY = '空でもよい';

/**
 * 手書きの文書とYAMLの節が、両方向で一致することの検査を立てる。
 *
 * **生成物から手で書き写した文章は、生成物とずれる**（issue #775）。文書とYAMLを分けた以上、
 * 一致は人の運用ではなく試験が見る。表の1列目のインラインコードを節の名前として拾い、説明に
 * `{@link MAY_BE_EMPTY}` と書かれた節だけを「空でもよい」として扱う。
 */
export function describeDocumentedSections(docPath: string, reportPath: string): DocumentedSections {
  const sections = documentedSections(readFileSync(docPath, 'utf8'));

  describe(`${basename(docPath)}と${basename(reportPath)}`, () => {
    it('文書が挙げる節が、YAMLに在って空でない', () => {
      expect(sections.all.length, `${docPath}の「YAMLの節」の表が読めない`).toBeGreaterThan(0);

      const missing = missingYamlSections(readFileSync(reportPath, 'utf8'), sections.required);
      expect(missing, `${docPath}が、${reportPath}に無い節を語っている`).toEqual([]);
    });

    it('YAMLの節が、すべて文書に挙がっている', () => {
      const undocumented = yamlSectionKeys(readFileSync(reportPath, 'utf8')).filter(
        (key) => !sections.all.includes(key),
      );
      expect(undocumented, `${docPath}の「YAMLの節」の表に足す`).toEqual([]);
    });
  });

  return sections;
}

/**
 * 文書の「YAMLの節」の表を読む。
 *
 * **改行は自分で均す。** 見出しを字面で拾うので、CRLFの作業ツリー——`.prettierrc` の
 * `endOfLine: auto` が想定している状態——では見出しに一致せず、**節が0件になる**。文書とYAMLの
 * 突き合わせはそこで赤くなるが、この結果を要求リストとして受け取る
 * {@link describeYamlReportRegeneration} は**何も要求しないまま緑になる**。呼び手に均させると、
 * 呼び手が増えるたびに同じ穴が空く。
 */
export function documentedSections(markdown: string): DocumentedSections {
  const table = /\n## YAMLの節\n([\s\S]*?)(?=\n## |$)/.exec(normalizeNewlines(markdown));
  if (table === null) return { all: [], required: [] };

  const rows = [...table[1].matchAll(/^\| `([^`]+)` \|([^\n]*)/gm)];
  return {
    all: rows.map((row) => row[1]),
    required: rows.filter((row) => !row[2].includes(MAY_BE_EMPTY)).map((row) => row[1]),
  };
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
export type YamlRecordValue = YamlScalar | readonly YamlScalar[] | readonly YamlRecord[];

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
 * 丸めた数。**決まらない値はnullで書く**——`NaN`や`—`と書くと、読む側では数ではなく文字列になって
 * 型が行ごとに変わる（標本が足りないときの`Stat`はNaNを返す）。`-0.00`は`0.00`へ均す（丸めで符号
 * だけが残った値に意味は無い）。
 *
 * **桁は必ず受け取る**——既定を置くと、桁を書いていない呼び出しの出力が既定の変更で黙って変わる。
 */
export function rounded(value: number | undefined, decimals: number): RoundedNumber | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const zero = (0).toFixed(decimals);
  return new RoundedNumber(value.toFixed(decimals) === `-${zero}` ? 0 : value, decimals);
}

/** 分布の列と割合の桁。**レポート横断で同じ**——別のレポートの同じ列と並べて読むため。 */
const STAT_DECIMALS = 2;

/**
 * 分布のレコードで、`min`と`p95`の間に置く1列。**名前と分位は対応する**——低い側の裾を見る表は
 * `p5`、真ん中の位置を見る表は`median`。
 */
export type StatMiddleColumn = 'p5' | 'median';

const MIDDLE_PERCENTILE: Readonly<Record<StatMiddleColumn, number>> = { p5: 0.05, median: 0.5 };

/**
 * 分布のレコードの作り方を、レポート1つぶん決める。返るのは、鍵（季節・土地・測ったものなど）と分布を
 * 受け取ってレコードを作る関数。
 *
 * **`middle`はレポートの性質**（上の{@link StatMiddleColumn}）であって、レコードごとの選択ではない。
 * レポートの入口でここを1回呼ぶことで、1つの表に`p5`の行と`median`の行が混ざることは書けなくなる。
 *
 * 列の並びはレポート横断の規約なので、ここが1箇所で持つ。
 */
export function statRecordsWith(middle: StatMiddleColumn): (keys: YamlRecord, stat: Stat) => YamlRecord {
  return (keys, stat) => ({
    ...keys,
    mean: rounded(stat.mean, STAT_DECIMALS),
    min: rounded(stat.min, STAT_DECIMALS),
    [middle]: rounded(stat.percentile(MIDDLE_PERCENTILE[middle]), STAT_DECIMALS),
    p95: rounded(stat.percentile(0.95), STAT_DECIMALS),
    max: rounded(stat.max, STAT_DECIMALS),
    sd: rounded(stat.stdDev, STAT_DECIMALS),
    n: stat.count,
  });
}

/** 割合（0〜1）のレコード。百分率へ直して書く。 */
export function shareRecord(keys: YamlRecord, share: number): YamlRecord {
  return { ...keys, unit: 'percent', share: rounded(share * 100, STAT_DECIMALS) };
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
  if (!Array.isArray(value)) return formatScalar(value as YamlScalar);

  const items = value as readonly (YamlScalar | YamlRecord)[];
  return `[${items.map((item) => (isRecord(item) ? formatRecord(item) : formatScalar(item))).join(', ')}]`;
}

/** 入れ子のレコードか。丸めた数を「値を持つオブジェクト」と取り違えないよう、先に除く。 */
function isRecord(value: YamlScalar | YamlRecord): value is YamlRecord {
  return typeof value === 'object' && value !== null && !(value instanceof RoundedNumber);
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

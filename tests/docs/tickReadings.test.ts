import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR, MINUTES_PER_TICK } from '../../src/domain/worldTime';
import { ROOT } from '../support/sourceFiles';

/**
 * tickの数を人の単位へ言い換えた記述が、今の暦と合っているかの検査
 * （[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 11節）。
 *
 * 言い換えは `480 tick（5日）` の形だけを認め、その数を
 * [`src/domain/worldTime.ts`](../../src/domain/worldTime.ts) の暦から計算し直して突き合わせる
 * ——暦（`core.yaml` の `minutes_per_tick` と `hour`・`minute` の range）を変えると、
 * 言い換えた側は一斉に嘘になるが、そこを見ているものが他に無い。
 *
 * **`＝` でつないだ形は、対にできても赤にする。** 語を挟める形を許すと「96tick＝経過時間で1日ぶん」
 * のように書けてしまい、どこまでが言い換えかを機械が決められなくなる。
 *
 * **見えるのは、tickの数と人の単位が直接隣り合っている形だけ。** 文章で説いた換算
 * （「5 tick かかるので、昼を過ぎる」）までは追えない。
 */

/** リポジトリルートからの相対パスを `/` 区切りで持つ（Windowsの `\` を混ぜない）。 */
function repoPath(...segments: string[]): string {
  return join(...segments)
    .split(sep)
    .join('/');
}

/** 例そのものを本文に持つこのファイル。中身が例と一致するので、自分自身は見られない。 */
const SELF = repoPath(relative(ROOT, __filename));

const MINUTES_OF: Record<string, number> = {
  日: MINUTES_PER_DAY,
  時間: MINUTES_PER_HOUR,
  分: 1,
};

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const UNIT = String.raw`日|時間|分`;
/** 幅を持ちうる数量1つ（`480 tick`・`240〜480 tick`・`1時間`）。 */
const QUANTITY = String.raw`(${NUMBER})(?:〜(${NUMBER}))?\s*(tick|${UNIT})`;

/** tickの数が末尾にある（`480 tick` の直後で切れている）。 */
const TICK_AT_END = new RegExp(String.raw`(${NUMBER})(?:〜(${NUMBER}))?\s*tick\s*$`);
/** 丸括弧の中がtickの数そのもの。 */
const TICK_ALONE = new RegExp(String.raw`^\s*(${NUMBER})(?:〜(${NUMBER}))?\s*tick\s*$`);
/** 人の単位の数量が末尾にある（`54時間`・`1時間15分`・`2.5〜5日`）。 */
const HUMAN_AT_END = new RegExp(String.raw`(?:(?:${NUMBER})(?:〜(?:${NUMBER}))?\s*(?:${UNIT})\s*)+$`);
/** `＝` の手前で、間に別の数を挟まずに最も近い数量。 */
const QUANTITY_BEFORE = new RegExp(String.raw`${QUANTITY}[^\d]*$`);
/** `＝` の後ろで、間に別の数を挟まずに最も近い数量。 */
const QUANTITY_AFTER = new RegExp(String.raw`^[^\d]*${QUANTITY}`);

/** 3桁区切りを落として数にする。 */
function valueOf(text: string): number {
  return Number(text.replace(/,/g, ''));
}

/** 書かれている小数点以下の桁数。 */
function decimalsOf(text: string): number {
  return /\.(\d+)$/.exec(text)?.[1].length ?? 0;
}

/** 数量の幅を分へ直す。単位が読めなければundefined。 */
function minutesOf(low: string, high: string | undefined, unit: string): [number, number] {
  const perUnit = unit === 'tick' ? MINUTES_PER_TICK : MINUTES_OF[unit];
  return [valueOf(low) * perUnit, valueOf(high ?? low) * perUnit];
}

/** 人の単位だけで組み立てた文字列（`1時間15分`）を分の幅へ直す。組み立てられなければundefined。 */
function humanMinutes(text: string): [number, number] | undefined {
  const part = new RegExp(String.raw`^\s*(${NUMBER})(?:〜(${NUMBER}))?\s*(${UNIT})`);
  let rest = text.trim();
  let low = 0;
  let high = 0;
  if (rest.length === 0) return undefined;
  while (rest.length > 0) {
    const matched = part.exec(rest);
    if (matched === null) return undefined;
    const [lowMinutes, highMinutes] = minutesOf(matched[1], matched[2], matched[3]);
    low += lowMinutes;
    high += highMinutes;
    rest = rest.slice(matched[0].length).trim();
  }
  return [low, high];
}

/**
 * 全体が単位1つの数量（`3.3 日`・`2.5〜5日`）なら、その書かれ方のまま返す。
 *
 * `high` は幅を書いたときだけ埋まる（`〜` の無い数量では捕まらない）。
 */
function singleQuantity(
  text: string,
): { low: string; high: string | undefined; unit: string } | undefined {
  const matched = new RegExp(String.raw`^\s*(${NUMBER})(?:〜(${NUMBER}))?\s*(${UNIT})\s*$`).exec(text);
  return matched === null ? undefined : { low: matched[1], high: matched[2], unit: matched[3] };
}

/**
 * 片端の数が、暦から計算した長さと合っているか。
 *
 * **割り切れるなら、そのままの数だけを認める。割り切れないときだけ、書いた桁で丸めた数を認める**
 * ——整数へ丸めた言い換え（`86 tick（21 時間）`、実は21.5時間）を通すと、暦が変わって長さがずれても
 * 同じ字面のまま丸め込まれて、この検査が何も言わなくなる。
 */
function endAgrees(actualMinutes: number, written: string, unitMinutes: number): boolean {
  const actual = actualMinutes / unitMinutes;
  if (Number(actual.toFixed(9)) === valueOf(written)) return true;
  const decimals = decimalsOf(written);
  return decimals > 0 && Number(actual.toFixed(decimals)) === valueOf(written);
}

/** tickの数の幅と、人の単位で書いた文字列が指す長さが同じか。 */
function agrees(tick: [number, number], written: string): boolean {
  const exact = humanMinutes(written);
  if (exact !== undefined && exact[0] === tick[0] && exact[1] === tick[1]) return true;
  const single = singleQuantity(written);
  if (single === undefined) return false;
  const unitMinutes = MINUTES_OF[single.unit];
  return (
    endAgrees(tick[0], single.low, unitMinutes) &&
    endAgrees(tick[1], single.high ?? single.low, unitMinutes)
  );
}

function tickMinutes(matched: RegExpExecArray): [number, number] {
  return minutesOf(matched[1], matched[2], 'tick');
}

interface Finding {
  readonly line: number;
  readonly what: string;
}

/** `480 tick（5日）`・`54時間（216 tick）` の対を拾い、暦から計算し直して照合する。 */
function parenthesisFindings(line: string, lineNumber: number): Finding[] {
  const found: Finding[] = [];
  for (const matched of line.matchAll(/（([^（）]*)）/g)) {
    const before = line.slice(0, matched.index);
    const inside = matched[1];

    const tickBefore = TICK_AT_END.exec(before);
    if (tickBefore !== null && humanMinutes(inside) !== undefined) {
      if (!agrees(tickMinutes(tickBefore), inside)) {
        found.push({ line: lineNumber, what: `${tickBefore[0].trim()}（${inside}）` });
      }
      continue;
    }

    const tickInside = TICK_ALONE.exec(inside);
    const humanBefore = HUMAN_AT_END.exec(before);
    if (tickInside !== null && humanBefore !== null && !agrees(tickMinutes(tickInside), humanBefore[0])) {
      found.push({ line: lineNumber, what: `${humanBefore[0].trim()}（${inside}）` });
    }
  }
  return found;
}

/** tickの数と人の単位を `＝` でつないだ行を拾う（括弧の形で書き直させる）。 */
function equalsFindings(line: string, lineNumber: number): Finding[] {
  const found: Finding[] = [];
  for (const matched of line.matchAll(/[=＝]/g)) {
    const before = QUANTITY_BEFORE.exec(line.slice(0, matched.index));
    const after = QUANTITY_AFTER.exec(line.slice(matched.index + 1));
    if (before === null || after === null) continue;
    const kinds = [before[3], after[3]];
    if (kinds.includes('tick') && kinds.some((kind) => kind !== 'tick')) {
      found.push({ line: lineNumber, what: `${before[0].trim()}${matched[0]}${after[0].trim()}` });
    }
  }
  return found;
}

function findingsIn(file: string, collect: (line: string, lineNumber: number) => Finding[]): string[] {
  return readFileSync(join(ROOT, file), 'utf-8')
    .split('\n')
    .flatMap((line, index) =>
      // 定数を埋め込んで組み立てている行は、暦を字で書いていない（src/codex-viewer/balancePage.ts）。
      line.includes('${') ? [] : collect(line, index + 1),
    )
    .map((finding) => `${file}:${finding.line} 「${finding.what}」`);
}

function filesIn(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = repoPath(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(rel);
  }
  return found;
}

const TARGETS = [
  // `.json` はスキーマ（`docs/engine/WorldCodex.schema.json`）のdescriptionが、文書と同じ文を持つため。
  ...filesIn('docs', ['.md', '.json']),
  ...filesIn('src', ['.ts', '.yaml']),
  ...filesIn('tests', ['.ts']),
].filter((file) => file !== SELF);

describe('tickの数の言い換えは、今の暦と合っている', () => {
  it.each(TARGETS)('%s', (file) => {
    expect(findingsIn(file, parenthesisFindings)).toEqual([]);
  });
});

describe('tickの数と人の単位は、`＝` ではなく丸括弧で並べる', () => {
  it.each(TARGETS)('%s', (file) => {
    expect(findingsIn(file, equalsFindings)).toEqual([]);
  });
});

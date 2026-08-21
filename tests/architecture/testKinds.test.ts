import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 試験の種類の分かれ方の検査。
 *
 * 試験は3種類あり、**赤が出た瞬間にどこを見に行くかが決まる**ように分けている。
 *
 * 1. **層の責務の単体試験** — その層のコードだけを、同梱の定義を読まずに動かす。赤＝その層が壊れた。
 * 2. **通し**（`tests/integration`） — 層をまたいだ噛み合わせ。赤＝繋ぎ目が壊れた。
 * 3. **同梱の中身の試験**（下のBUNDLED_CONTENT） — 試験対象がYAML・絵・対応表そのもので、コードは
 *    それを読むための道具。赤＝同梱の中身を直した副作用。
 *
 * ここが見張るのは1と2・3の境目だけ。**単体試験が同梱の定義を読むと、YAMLを直しただけでその層が
 * 赤くなり、赤の読み方が決まらなくなる**——確かめたい形は、その試験の中に宣言を書けばよい
 * （tests/support/miniGame.ts）。
 */

const ROOT = resolve(__dirname, '../..');

/** 同梱の中身そのものが試験対象の置き場（3種類目）。 */
const BUNDLED_CONTENT = [
  'tests/world-codex',
  'tests/art',
  'tests/asset-pack',
  'tests/generation',
  'tests/scenario',
  'tests/diagnostics',
];

/** 層をまたいだ噛み合わせを見る置き場（2種類目）。 */
const INTEGRATION = ['tests/integration'];

/**
 * 同梱の定義・対応表を読む入口。**これを通らずに同梱の中身へ届く道は無い**ので、字面で足りる。
 */
const BUNDLED_DOORS = [
  'support/worldCodexFiles',
  'support/samplePack',
  'bundledLocaleText',
  'loadLocalization',
];

/** そのディレクトリ以下の*.test.tsファイル（リポジトリ相対）。 */
function testsIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...testsIn(rel));
    else if (entry.endsWith('.test.ts')) found.push(rel);
  }
  return found;
}

/** この検査そのもの（入口の名前を字面で持つので、自分自身は数えない）。 */
const SELF = 'tests/architecture';

const allowed = [...BUNDLED_CONTENT, ...INTEGRATION, SELF];
const isUnitTest = (rel: string): boolean => !allowed.some((dir) => rel.startsWith(`${dir}/`));

describe('試験の種類', () => {
  it('層の責務の単体試験は、同梱の定義を読まない', () => {
    const reading = testsIn('tests')
      .filter(isUnitTest)
      .filter((rel) => {
        const source = readFileSync(join(ROOT, rel), 'utf-8');
        return BUNDLED_DOORS.some((door) => source.includes(door));
      });

    expect(reading, '確かめたい形は、その試験の中に宣言を書く（miniGame）').toEqual([]);
  });

  it('検査対象の置き場が実在する', () => {
    // 引っ越しで置き場が消えたときに、検査が黙って空を通さないようにする。
    for (const dir of allowed) expect(testsIn(dir).length, dir).toBeGreaterThan(0);
    expect(testsIn('tests').filter(isUnitTest).length).toBeGreaterThan(50);
  });
});

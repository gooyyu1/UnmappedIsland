import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import * as worldTime from '../../src/domain/worldTime';
import { ROOT } from '../support/sourceFiles';

/**
 * 暦の数を字で書かせない規則（`eslint.config.js`）が、**今の暦の値と名前で**効いているかの見張り。
 *
 * 規則は暦の値の字面と定数の名前を自分で持つ（ESLintの設定は `.ts` を読まずに済ませたいため）。暦を
 * 変えると規則だけが古い数を探し続け、新しい数の直書きが素通りするので、`worldTime.ts` の値と名前を
 * 1つずつ規則へ掛けて確かめる。
 */

const CALENDAR = Object.entries(worldTime);

/**
 * 検査を掛ける先に名乗らせるファイル。型を見る規則が tsconfig に載ったファイルしか読まないので、
 * 在るファイルの名前を借りる（中身は下で渡す文字列に差し替わり、ファイルそのものは読み書きしない）。
 */
const BORROWED_PATH = 'tests/support/worldYaml.ts';

/** 暦の規則が出す指摘だけを、行番号で拾う。 */
async function flaggedLines(lines: readonly string[]): Promise<number[]> {
  const [result] = await new ESLint({ cwd: ROOT }).lintText(lines.join('\n'), { filePath: BORROWED_PATH });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax' && message.message.includes('worldTime'))
    .map((message) => message.line);
}

describe('暦の数を字で書かせない規則', () => {
  it('暦のどの値・どの名前にも効き、暦の定数へ掛ける単位の数には効かない', async () => {
    const header = [
      `import { ${CALENDAR.map(([name]) => name).join(', ')} } from '../../src/domain/worldTime';`,
      'declare const session: { advanceWorldTime(minutes: number): void };',
      'declare const x: number;',
    ];
    const flagged: string[] = [];
    const passed: string[] = [];
    for (const [name, value] of CALENDAR) {
      flagged.push(`export const divided${name} = x / ${value};`);
      flagged.push(`export const below${name} = x < ${value};`);
      flagged.push(`{ const ${name} = ${value}; void ${name}; }`);
      flagged.push(`session.advanceWorldTime(${value});`);
      passed.push(`export const counted${name} = ${value} * ${name};`);
    }
    const firstFlagged = header.length + 1;
    const firstPassed = firstFlagged + flagged.length;

    const lines = await flaggedLines([...header, ...flagged, ...passed]);

    expect(
      [...new Set(lines)].sort((a, b) => a - b),
      '拾うべき行だけを拾う（食い違った行番号が、上の組み立てのどれかを指す）',
    ).toEqual(flagged.map((unused, index) => firstFlagged + index));
    expect(lines.filter((line) => line >= firstPassed)).toEqual([]);
  }, 30_000);
});

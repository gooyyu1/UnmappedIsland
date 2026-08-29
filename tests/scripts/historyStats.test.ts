import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run stats:history`（`scripts/historyStats.mjs`）が空を返していないかの検査。
 *
 * この道具も `countLines.mjs` と同じで、**全部0になっても表の形は保たれる**（issue #867）。
 * 加えてこちらは履歴を遡るので、**浅いクローンでは静かに0になりうる**——CIの
 * `actions/checkout` は既定で深さ1なので、そこで数えたつもりになるのが一番危ない。
 *
 * 見るのは**行数の4列が0でないこと**と、**遡れない日を頼まれたら黙って0を出さずに落ちること**の
 * 2つだけ。行数の4列は1コミットしか無くても数えられるので、浅いクローンでも成立する。
 * PRの列は履歴の深さで変わるため、**浅くないときだけ**見る。
 */

const ROOT = resolve(__dirname, '../..');

function run(args: readonly string[]): { readonly stdout: string; readonly status: number } {
  try {
    return {
      stdout: execFileSync('node', [join(ROOT, 'scripts/historyStats.mjs'), ...args], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
      status: 0,
    };
  } catch (error) {
    return { stdout: '', status: (error as { status?: number }).status ?? 1 };
  }
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

const TODAY = git(['log', '-1', '--format=%ad', '--date=format-local:%Y-%m-%d']);
const IS_SHALLOW = git(['rev-parse', '--is-shallow-repository']) === 'true';

function cellsOf(line: string): string[] {
  return line.split('|').map((cell) => cell.trim());
}

/**
 * 表を見出しで引ける形にしたもの。桁の位置を数え直さずに済むよう、値は列の名前で取る。
 * 日付の行だけを拾う（見出しと区切り線は、先頭の桁が `MM-DD` でないことで落ちる）。
 */
function tableOf(stdout: string): Map<string, string>[] {
  const lines = stdout.split(/\r?\n/);
  const headers = cellsOf(lines[0] ?? '');
  return lines
    .map(cellsOf)
    .filter((cells) => cells.length === headers.length && /^\d{2}-\d{2}$/.test(cells[1]))
    .map((cells) => new Map(headers.map((header, index) => [header, cells[index]])));
}

const NUMBER_COLUMNS = ['実装', '試験', '文書', '定義'];

describe('育ち方の推移', () => {
  const rows = tableOf(run([TODAY]).stdout);
  const value = (header: string) => Number(rows[0]?.get(header)?.replace(/,/g, ''));

  it('最新の日の行が出る', () => {
    expect(rows.length, '表に日付の行が1つも無い').toBe(1);
  });

  it.each(NUMBER_COLUMNS)('%s の列が0でない', (header) => {
    expect(value(header), `${[...(rows[0]?.values() ?? [])].join(' | ')}`).toBeGreaterThan(0);
  });

  it.skipIf(IS_SHALLOW)('PRの累計が0でない', () => {
    expect(value('PR')).toBeGreaterThan(0);
  });

  it('履歴に無い日を頼まれたら、0を出さずに落ちる', () => {
    // リポジトリが始まる前の日。ここで空の表を返すと、遡れなかったことが読む側に伝わらない。
    expect(run(['2020-01-01']).status).not.toBe(0);
  });
});

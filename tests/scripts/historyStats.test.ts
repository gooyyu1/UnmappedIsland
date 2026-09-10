import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run stats:history`（`scripts/historyStats.mjs`）が空を返していないかの検査。
 *
 * この道具も `countLines.mjs` と同じで、**全部0になっても表の形は保たれる**（issue #867）。
 * 加えてこちらは履歴を遡るので、**手元に無いものを0として数えうる。**
 *
 * **浅いクローンかどうかで、確かめられることが入れ替わる。** CIの `actions/checkout` は既定で
 * 深さ1なので、両方を書かないとどちらかの環境で何も見ていないことになる。
 *
 * - 浅い: **表を出さずに落ちること**だけを見る。道具はここで止まる決まり（`requireFullHistory`）。
 * - 深い: 行数の列とPRの累計が0でないこと、図の点が枠の中に散らばっていること。
 *
 * 日付は**JSTで作る**。道具はJSTの 23:59:59 で切るので、UTCの「今日」を渡すと、JSTで日が
 * 変わった後の時間帯（CIの実行時刻がここに入る）にはその日のコミットが1つも無いことになる。
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

/**
 * エポック秒から日本時間の日を出す。
 *
 * **`--date=format-local` にも `TZ=Asia/Tokyo` にも頼らない。** git がその名前を解釈できるかは
 * 環境で違い、解釈できなければ黙って別の日境で切る。ここが道具と独立した基準になるので、
 * 道具と同じ道具立てで作ると、ずれたときに両方が同じだけずれて検査が素通りする。
 */
function jstDay(epochSeconds: string): string {
  return new Date((Number(epochSeconds) + 9 * 60 * 60) * 1000).toISOString().slice(0, 10);
}

const TODAY = jstDay(git(['log', '-1', '--format=%at']));
const IS_SHALLOW = git(['rev-parse', '--is-shallow-repository']) === 'true';

/** リポジトリができた日。**渡さなくても系列の先頭に付く**のが道具の決まり。 */
const FIRST = IS_SHALLOW ? TODAY : jstDay(git(['log', '--reverse', '--format=%at']).split('\n')[0]);

/**
 * 履歴の始まりに近い日。**日境のずれは、ここでしか出ない。**
 *
 * 最新の日で数えると累計が全部入るので、どの日境で切っても同じ本数になり、ずれが消える。
 */
const EARLY_DAYS = 5;
const EARLY = IS_SHALLOW
  ? TODAY
  : jstDay(String(Number(git(['log', '--reverse', '--format=%at']).split('\n')[0]) + EARLY_DAYS * 86400));

/** 表の最後の行。**先頭はリポジトリができた日が入る**ので、頼んだ日は末尾に出る。 */
function latestOf(stdout: string): Map<string, string> | undefined {
  const rows = tableOf(stdout);
  return rows[rows.length - 1];
}

/** その日までに `main` へPRとして入った本数。道具とは別に、明示のオフセットだけで数える。 */
function mergedPullRequestsUntil(day: string): number {
  return git(['log', '--first-parent', '--format=%at@@%s'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('@@'))
    .filter(([at, subject]) => jstDay(at) <= day && /^Merge pull request #\d+|\(#\d+\)$/.test(subject))
    .length;
}

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

const NUMBER_COLUMNS = ['実装', '試験', '文書', '定義', '道具', 'PR', '変更行'];

describe.runIf(IS_SHALLOW)('浅いクローンでの育ち方の推移', () => {
  const { stdout, status } = run([TODAY]);

  it('表を出さずに落ちる', () => {
    // 行数の列だけ出た表は、PRの列が欠けたまま「測れた」形をしているので、貼った先で気づけない。
    expect(status, `落ちずに出力した:\n${stdout}`).not.toBe(0);
    expect(tableOf(stdout).length).toBe(0);
  });
});

describe.skipIf(IS_SHALLOW)('育ち方の推移', () => {
  const stdout = run([TODAY]).stdout;
  const latest = latestOf(stdout);
  const value = (header: string) => Number(latest?.get(header)?.replace(/,/g, ''));

  it('最新の日の行が出る', () => {
    expect(latest?.get('日'), `表に日付の行が1つも無い`).toBe(TODAY.slice(5));
  });

  it('系列の先頭は、渡していなくてもリポジトリができた日', () => {
    // ここを渡す側に任せると、表も図も途中から始まったまま誰も気づかない。
    expect(tableOf(stdout)[0]?.get('日')).toBe(FIRST.slice(5));
  });

  it.each(NUMBER_COLUMNS)('%s の列が0でない', (header) => {
    expect(value(header), `${[...(latest?.values() ?? [])].join(' | ')}`).toBeGreaterThan(0);
  });

  it('履歴に無い日を頼まれたら、0を出さずに落ちる', () => {
    // リポジトリが始まる前の日。ここで空の表を返すと、遡れなかったことが読む側に伝わらない。
    expect(run(['2020-01-01']).status).not.toBe(0);
  });

  it('区切りを古い順でなく渡したら落ちる', () => {
    // 区間が逆さになると、区間の量を置く日が区間の外へ出る（`middleDay`）。表も図も形は保たれる
    // ので、落とさないと「1本も入らなかった区間」として読まれる。
    const { stdout, status } = run([TODAY, EARLY]);
    expect(status, `落ちずに出力した:\n${stdout}`).not.toBe(0);
  });

  it('PRの累計が、日本時間の日境で数えた本数と一致する', () => {
    // **日境がずれても、表は正常な形で出る**ので、貼った先では気づけない（PRの列だけが別の
    // 日境で数えられ、行数の列とは違う日で切られていた）。だからここは形ではなく値を見る。
    const early = latestOf(run([EARLY]).stdout);
    const count = Number(early?.get('PR')?.replace(/,/g, ''));
    expect(count, `${EARLY} の行: ${[...(early?.values() ?? [])].join(' | ')}`).toBe(
      mergedPullRequestsUntil(EARLY),
    );
  });
});

/** SVGの点のx座標。 */
function centersOf(svg: string): number[] {
  return [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map(([, cx]) => Number(cx));
}

describe.skipIf(IS_SHALLOW)('区間の量の置き方', () => {
  const directory = mkdtempSync(join(tmpdir(), 'history-stats-spans-'));
  const stdout = run(['--svg', directory, EARLY, TODAY]).stdout;
  const svg = (name: string) => readFileSync(join(directory, name), 'utf-8');

  it('コストの図は、区切りの日ではなく日ごとの窓から描かれる', () => {
    // 段の区切りは幅が揃わないので、区間の量を段ごとに出すと区切りを1日動かすだけで値が変わる。
    // パネルは横軸を共有するので、点の置き場の種類が表の行を超えなければ段ごとに戻っている。
    const positions = new Set(centersOf(svg('HowWeGotHere_cost.svg')));
    const breaks = tableOf(stdout).length;
    expect(positions.size, `点の置き場 ${positions.size} / 表の行 ${breaks}`).toBeGreaterThan(breaks);
  });

  it('区間の量は、区切りの日ではなく区間の真ん中に置かれる', () => {
    // 行数は時点の量なので最後の区切りの日（＝枠の右端）に乗る。1PRあたりは区間の量なので、
    // 最後の区間の真ん中、つまりそれより左に乗る。
    const stock = Math.max(...centersOf(svg('HowWeGotHere_lines.svg')));
    const span = Math.max(...centersOf(svg('HowWeGotHere_pr_size.svg')));
    expect(span, `時点 ${stock} / 区間 ${span}`).toBeLessThan(stock);
  });
});

describe.skipIf(IS_SHALLOW)('育ち方の推移の図', () => {
  const directory = mkdtempSync(join(tmpdir(), 'history-stats-'));
  run(['--svg', directory, TODAY]);
  const files = readdirSync(directory);

  it('図が書き出される', () => {
    expect(files.filter((name) => name.endsWith('.svg')).length).toBeGreaterThan(0);
  });

  it.each(['HowWeGotHere_lines.svg', 'HowWeGotHere_pr_size.svg', 'HowWeGotHere_cost.svg'])(
    '%s の点が枠の中に在る',
    (name) => {
      const svg = readFileSync(join(directory, name), 'utf-8');
      const height = Number(/height="(\d+)"/.exec(svg)?.[1]);
      const centers = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)];

      expect(centers.length, `点が1つも無い:\n${svg.slice(0, 200)}`).toBeGreaterThan(0);
      for (const [, cx, cy] of centers) {
        expect(
          Number.isFinite(Number(cx)) && Number.isFinite(Number(cy)),
          `座標が数値でない: ${cx},${cy}`,
        ).toBe(true);
        // 枠からはみ出した点は、目盛りの上限が値を覆えていないということ。
        expect(Number(cy)).toBeGreaterThanOrEqual(0);
        expect(Number(cy)).toBeLessThanOrEqual(height);
      }
    },
  );
});

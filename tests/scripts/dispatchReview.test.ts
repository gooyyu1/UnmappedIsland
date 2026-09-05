import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/dispatch-review.sh` が組み立てるタイトルの検査。
 *
 * ここが守るのは**一覧を人が読めること**（`.claude/board-design.md` 2.9）。とくに「何回目の判定に
 * なるはずか」は数えて出す値なので、数え方がずれても**それらしい番号が付いたまま**気づけない。
 *
 * `DRY_RUN=1` で叩くので、セッションは立たない。`gh` は PATH の先頭で差し替える。
 */

// 実プロセス（bash + node + gh のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合
// だけで既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/dispatch-review.sh');

interface World {
  /** PRの `state`。既定は開いている。 */
  readonly state?: string;
  /** PRに付いているコメントの本文。 */
  readonly comments?: readonly string[];
  /** `--bridge` を付けて叩くか。 */
  readonly onBridge?: boolean;
}

interface Args {
  readonly title: string;
  readonly tags: string[];
  readonly prompt: string;
  readonly environment_id: string;
  readonly permission_mode?: string;
}

/** `DRY_RUN=1` で組み立てさせて、`create_session` へ渡るはずの引数を返す。 */
function args(pr: number, world: World = {}): Args {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-dispatch-review-'));
  const dir = work.replace(/\\/g, '/');
  try {
    writeFileSync(
      join(work, 'pr.json'),
      JSON.stringify({
        title: '題',
        state: world.state ?? 'OPEN',
        headRefName: 'claude/x',
        body: 'Closes #1\n',
        comments: (world.comments ?? []).map((body) => ({ body })),
      }),
      'utf-8',
    );

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
case "$1 $2" in
  "repo view") printf '%s' 'gooyyu1/UnmappedIsland' ;;
  "pr view") cat '${dir}/pr.json' ;;
  *) exit 1 ;;
esac
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    const where = world.onBridge === true ? ['--bridge'] : [];
    const stdout = execFileSync('bash', [SCRIPT, String(pr), ...where], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        DRY_RUN: '1',
        CLOUD_ENV: 'env_TEST_CLOUD',
        BRIDGE_ENV: 'env_TEST_BRIDGE',
      },
    });
    return JSON.parse(stdout) as Args;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('dispatch-review.sh', () => {
  it('判定がまだ1つも無ければ、1回目', () => {
    expect(args(1524).title).toBe('レビュー #1524:1 題');
  });

  it('判定の数だけ番号が進む', () => {
    const comments = ['[レビュー] 直しが要る\n…', '[レビュー] 通してよい'];

    expect(args(1524, { comments }).title).toBe('レビュー #1524:3 題');
  });

  // 数えるのは、`board-labels.yml` がラベルにするのと同じ行だけ。緩めると、ラベルが付かなかった
  // コメントで番号だけが進む。
  it('結論の行でないコメントは数えない', () => {
    const comments = [
      '[スメル] 名前が中身と合っていない',
      'ここは意図的です',
      '[レビュー] だいたい良さそう',
      '前置き\n[レビュー] 通してよい',
    ];

    expect(args(1524, { comments }).title).toBe('レビュー #1524:1 題');
  });

  it('タグはPRの番号で付く', () => {
    expect(args(1524).tags).toEqual(['review-1524']);
  });

  // **2周目が読む範囲を、判定コメントが名乗った版から決める**（`review-prompt.md`「読んだ版」の節）。
  // ここを渡さないとレビュアーはPR全体を読み直し、前の周が見送ったものまで新しい指摘として挙がる。
  it('判定が無ければ、前の版は なし', () => {
    expect(args(1524).prompt).toContain('それは `なし` です');
  });

  it('前の周が名乗った版を埋める', () => {
    const comments = ['[レビュー] 直しが要る\n読んだ版: 0a0926de\n\n本文'];

    expect(args(1524, { comments }).prompt).toContain('それは `0a0926de` です');
  });

  // **数と版は同じコメントから出す。** 判定を書かずに落ちた周のぶんだけ版が進むと、次の1本が
  // 読んでいない範囲を「前の周が見た」ことにしてしまう。
  it('版を引くのは最後の判定コメントから', () => {
    const comments = [
      '[レビュー] 直しが要る\n読んだ版: aaaaaaa',
      '[スメル] 読んだ版: bbbbbbb',
      '[レビュー] 直しが要る\n読んだ版: ccccccc',
    ];

    expect(args(1524, { comments }).prompt).toContain('それは `ccccccc` です');
  });

  // 名乗り忘れは、PR全体を読み直す側へ倒す。範囲を狭めた側へ倒すと、誰も読んでいない差分ができる。
  it('前の周が名乗っていなければ なし', () => {
    const comments = ['[レビュー] 直しが要る\n本文だけ'];

    expect(args(1524, { comments }).prompt).toContain('それは `なし` です');
  });

  // **モードは環境が決める**（`board-design.md` 2.16.3）。渡さないと未設定のまま立ち、差分に
  // `.claude/**` が含まれるPRを読もうとした時点で承認を待って止まる（#1567、2026-09-05）。
  it('クラウドへは auto を渡す', () => {
    const built = args(1524);

    expect(built.environment_id).toBe('env_TEST_CLOUD');
    expect(built.permission_mode).toBe('auto');
  });

  // **無指定が `bypassPermissions` になる**（明示すると撥ねられる）ので、`.claude/**` を書き換える
  // 仕事はこれが要る。`auto` へ落とすと、担当の仕事ができないセッションが立つ。
  it('ブリッジへはモードを渡さない', () => {
    const built = args(1524, { onBridge: true });

    expect(built.environment_id).toBe('env_TEST_BRIDGE');
    expect(built).not.toHaveProperty('permission_mode');
  });
});

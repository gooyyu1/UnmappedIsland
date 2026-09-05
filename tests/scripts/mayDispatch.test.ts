import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * `scripts/agent/may-dispatch.sh`（と、その下の `brake.sh` / `occupancy.sh`）の検査。
 *
 * ここが守るのは**安全側へ倒れること**。誤って止めれば投入が遅れるだけだが、誤って通すと同じ仕事へ
 * 2本立ち、同じPRへ食い違う判定が残る（`.claude/board-design.md` 1.5 の PR #1493）。手綱もセッション
 * 一覧も**引けなかったときは止まる**ことを、実際にスクリプトを走らせて見る。
 *
 * `gh` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替える。
 */

// 実プロセス（bash + gh のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/may-dispatch.sh');

/** 手綱の issue の番号。実物の番号は試験に書き写さない。 */
const BRAKE_ISSUE = '9999';

/** 全部チェックが付いた手綱。`## 手綱` 節の外にも書いて、節の中だけを見ていることを確かめる。 */
const ALL_ON = [
  '- [ ] ここは節の外なので見ない',
  '',
  '## 手綱',
  '',
  '- [x] 投入する（これを外すと下は全部止まる）',
  '  - [x] 新しいタスク',
  '  - [x] レビュー',
  '    - [x] task を持たないPRも読む',
  '  - [x] 直しの再開',
  '  - [x] その他のエージェント（棚卸し・傾向分析）',
  '',
  '## 読み方の決まり',
  '',
  '- チェックが付いているときだけ流す。',
].join('\n');

interface Session {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  readonly tags: readonly string[];
}

interface World {
  /** 手綱の issue の本文。既定は全部チェック済み。 */
  readonly brake?: string;
  /** 手綱の issue を引けなくする。 */
  readonly ghFails?: boolean;
  /** 一覧が返すセッション。既定は空。 */
  readonly sessions?: readonly Session[];
  /** セッションの一覧を引けなくする。 */
  readonly ccrFails?: boolean;
}

interface Run {
  readonly code: number;
  readonly stderr: string;
}

function run(kind: string, tag: string | readonly string[], world: World = {}): Run {
  const tags = typeof tag === 'string' ? [tag] : tag;
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-may-dispatch-'));
  try {
    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `#!/bin/bash
${world.ghFails === true ? 'exit 1' : ''}
cat <<'BODY'
${world.brake ?? ALL_ON}
BODY
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    const page = {
      ccr: {
        data: (world.sessions ?? []).map((s) => ({
          id: s.id,
          session_status: s.status,
          status_bucket: s.bucket,
          tags: s.tags,
        })),
        has_more: false,
      },
    };
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `#!/bin/bash
cat > /dev/null
${world.ccrFails === true ? 'exit 1' : ''}
echo '<other-session>'
echo '${JSON.stringify(page)}'
`,
      'utf-8',
    );
    chmodSync(meta, 0o755);

    try {
      execFileSync('bash', [SCRIPT, kind, ...tags], {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          CCR_META: meta,
          BRAKE_ISSUE,
        },
      });
      return { code: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { code: failure.status ?? -1, stderr: failure.stderr ?? '' };
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** チェックの外れた手綱を作る。 */
function off(heading: string): string {
  return ALL_ON.replace(`- [x] ${heading}`, `- [ ] ${heading}`);
}

const working = (tag: string): Session => ({
  id: 'cse_WORKING',
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags: [tag],
});

describe('may-dispatch.sh', () => {
  it('手綱が全部付いていて、同じタグのセッションが無ければ通す', () => {
    expect(run('new-task', 'task-1234')).toEqual({ code: 0, stderr: '' });
  });

  it('親の「投入する」が外れていれば、種類に関わらず止まる', () => {
    const result = run('review', 'review-1500', { brake: off('投入する') });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('手綱');
  });

  it('その種類だけ外れていれば、その種類だけが止まる', () => {
    const brake = off('レビュー');

    expect(run('review', 'review-1500', { brake }).code).toBe(1);
    expect(run('new-task', 'task-1234', { brake }).code).toBe(0);
  });

  // 種類は根から自分までの鎖に対応する（board-design 2.4）。子だけを外して、親のレビューは流す。
  it('子だけ外れていれば、その子の種類だけが止まる', () => {
    const brake = off('task を持たないPRも読む');

    expect(run('review-untasked', 'review-1526', { brake }).code).toBe(1);
    expect(run('review', 'review-1500', { brake }).code).toBe(0);
  });

  it('親のレビューが外れていれば、子の種類も止まる', () => {
    expect(run('review-untasked', 'review-1526', { brake: off('レビュー') }).code).toBe(1);
  });

  // 手綱を読む側と書く側が食い違ったときに、通す側へ倒れないこと。
  it('手綱の issue を引けなければ止まる', () => {
    expect(run('new-task', 'task-1234', { ghFails: true }).code).toBe(1);
  });

  it('手綱に見出しの行が無ければ止まる', () => {
    expect(run('new-task', 'task-1234', { brake: '## 手綱\n\n（空）\n' }).code).toBe(1);
  });

  it('同じタグのセッションが走っていれば止まる', () => {
    const result = run('new-task', 'task-1234', { sessions: [working('task-1234')] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cse_WORKING');
  });

  it('走っているのが別のタグなら通す', () => {
    expect(run('new-task', 'task-1234', { sessions: [working('task-5678')] }).code).toBe(0);
  });

  // 再レビューが止まらないことの確認。手番を終えたセッションは手が動いていない（board-design 1.2）。
  it('レビューでは、手番を終えたセッションは占有していない', () => {
    const done = ['SESSION_STATUS_BUCKET_COMPLETED', 'SESSION_STATUS_BUCKET_FAILED'];
    for (const bucket of done) {
      const sessions = [{ id: 'cse_DONE', status: 'SESSION_STATUS_IDLE', bucket, tags: ['review-1500'] }];

      expect(run('review', 'review-1500', { sessions }).code, bucket).toBe(0);
    }
  });

  // **種類ごとに訊く問いが違う**（1.2）。新しいタスクが訊くのは「もう配ったか」なので、手が空いて
  // いても配り直さない。同じ issue へ2本立つと、別々のPRが出る（1.5）。
  it('新しいタスクでは、手番を終えたセッションも占有している', () => {
    const done = ['SESSION_STATUS_BUCKET_COMPLETED', 'SESSION_STATUS_BUCKET_FAILED'];
    for (const bucket of done) {
      const sessions = [{ id: 'cse_DONE', status: 'SESSION_STATUS_IDLE', bucket, tags: ['task-1234'] }];

      expect(run('new-task', 'task-1234', { sessions }).code, bucket).toBe(1);
    }
  });

  // 2026-09-05 に実測。task-1180 のセッションが `IDLE` のまま `..._WORKING` で1時間半固まり、
  // PR #1524 のレビューが出なくなった。`status_bucket` は手が空いても戻らないことがある。
  it('IDLE なら、status_bucket が WORKING でも占有していない', () => {
    const sessions = [
      {
        id: 'cse_STUCK',
        status: 'SESSION_STATUS_IDLE',
        bucket: 'SESSION_STATUS_BUCKET_WORKING',
        tags: ['review-1500'],
      },
    ];

    expect(run('review', 'review-1500', { sessions }).code).toBe(0);
  });

  // 承認待ちで止まっているセッションは、許可が下りれば書き始めるので手が動いている側。
  // **`IDLE` に落ちるかは未実測**（`occupancy.sh` の仮説の注記）。落ちても止まる形にしてある。
  it('BLOCKED のセッションは、手が動いている側として占有している', () => {
    const sessions = [
      {
        id: 'cse_BLOCKED',
        status: 'SESSION_STATUS_IDLE',
        bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
        tags: ['review-1500'],
      },
    ];

    expect(run('review', 'review-1500', { sessions }).code).toBe(1);
  });

  it('畳まれたセッションは占有していない', () => {
    const sessions = [
      {
        id: 'cse_ARCHIVED',
        status: 'SESSION_STATUS_ARCHIVED',
        bucket: 'SESSION_STATUS_BUCKET_WORKING',
        tags: ['task-1234'],
      },
    ];

    expect(run('new-task', 'task-1234', { sessions }).code).toBe(0);
  });

  // レビューは「前のレビュー」と「そのPRを直しているセッション」の両方を見る（board-design 1.3）。
  // `直し待ち` のラベルからは、直している最中か誰も居ないかが読めない。
  it('タグを複数渡すと、どれか1つでも占有されていれば止まる', () => {
    const result = run('review', ['review-1500', 'task-1415'], { sessions: [working('task-1415')] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('task-1415');
  });

  it('タグを複数渡しても、どれも占有されていなければ通す', () => {
    const sessions = [working('task-9999')];

    expect(run('review', ['review-1500', 'task-1415'], { sessions }).code).toBe(0);
  });

  it('タグを1つも渡さなければ止まる', () => {
    expect(run('review', []).code).toBe(1);
  });

  it('セッションの一覧を引けなければ止まる', () => {
    expect(run('new-task', 'task-1234', { ccrFails: true }).code).toBe(1);
  });

  it('知らない種類は止まる', () => {
    expect(run('bogus', 'task-1234').code).toBe(1);
  });
});

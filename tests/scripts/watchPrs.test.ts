import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/watch-prs.sh` が出す行の検査。
 *
 * この見張りの出力は**受け取った司令塔がそのまま動く指示**になる。作業単位でない issue が `TASK` と
 * して出れば投入する先の無い仕事が無人で始まり、コンフリクトしたPRが `GREEN` として出れば素通しの
 * マージが失敗する。どちらも誤りは見張り自身の出力にしか現れず、GitHub の側は正常なままなので、
 * ここで見ていないと誰も気づけない。
 *
 * `gh` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替えて、実際にスクリプトを走らせる。
 * **セッション一覧も差し替える**——差し替えないと、走らせた人のそのときのセッションが `STALLED`
 * として混ざり、検査の結果が手元の状況で変わる。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/watch-prs.sh');

/** `gh issue list --json number,labels,comments,blockedBy,body` が返す形の1件。 */
function issue(
  number: number,
  labels: string[],
  blockedBy: { number: number; state: string }[] = [],
  body = '',
): unknown {
  return {
    number,
    labels: labels.map((name) => ({ name })),
    comments: [],
    blockedBy: { nodes: blockedBy },
    body,
  };
}

/** `gh pr list --json number,labels,statusCheckRollup,comments,updatedAt,mergeable` が返す形の1件。 */
function pullRequest(
  number: number,
  mergeable: string,
  labels: string[] = [],
  checks: { name: string; status: string; conclusion: string }[] = [
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
  body = '',
): unknown {
  return {
    number,
    labels: labels.map((name) => ({ name })),
    statusCheckRollup: checks,
    comments: [],
    updatedAt: '2000-01-01T00:00:00Z',
    mergeable,
    body,
  };
}

/** `list_sessions` が返す形の1件。既定は「タスクを持ったまま動いていない」。 */
function session(
  id: string,
  title = '題',
  bucket = 'SESSION_STATUS_BUCKET_IDLE',
  tags = ['task-900'],
): unknown {
  return {
    id,
    title,
    tags,
    session_status: 'SESSION_STATUS_RUNNING',
    status_bucket: bucket,
    updated_at: '2000-01-01T00:00:00Z',
  };
}

/**
 * `gh` とセッション一覧を差し替えて見張りを走らせ、出た行を返す。
 *
 * `prRounds`・`issueRounds` は `gh pr list`・`gh issue list` が周ごとに返す一覧で、最後のものは
 * 以降ずっと返る。
 */
function watch(
  prRounds: unknown[][],
  issueRounds: unknown[][],
  watched: number[],
  sessions: unknown[] = [],
): string[] {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-watch-prs-'));
  try {
    const write = (name: string, value: unknown): string => {
      const path = join(work, name);
      writeFileSync(path, JSON.stringify(value), 'utf-8');
      return path.replace(/\\/g, '/');
    };
    prRounds.forEach((round, index) => write(`prs-${index}.json`, round));
    issueRounds.forEach((round, index) => write(`issues-${index}.json`, round));
    // `gh pr list` と `gh issue list` で返し分ける。どちらも呼ばれた回数で切り替える。
    const dir = work.replace(/\\/g, '/');
    const rounds = (kind: string, length: number): string =>
      `round=$(cat '${dir}/${kind}-round' 2>/dev/null || echo 0)\n` +
      `echo $((round + 1)) > '${dir}/${kind}-round'\n` +
      `[ "$round" -lt ${length} ] || round=$((${length} - 1))\n` +
      `cat "${dir}/${kind}s-$round.json"\n`;
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `#!/usr/bin/env bash\n` +
        `if [ "$1" = issue ]; then\n${rounds('issue', issueRounds.length)}exit 0\nfi\n` +
        // 緑のPRに同梱する本文の引き直し。周を進めないよう、一覧より先に返す。
        `if [ "$2" = view ] && [[ "$*" == *title,body,files* ]]; then\n` +
        `  echo "本文 $3"\n  exit 0\nfi\n` +
        rounds('pr', prRounds.length),
      'utf-8',
    );
    chmodSync(stub, 0o755);

    // `ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const list = write('sessions.json', { ccr: { data: sessions } });
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(meta, `#!/usr/bin/env bash\necho '<other-session>'\ncat '${list}'\n`, 'utf-8');

    const args = [SCRIPT, '--timeout-minutes', '1', '--interval', '1', '--no-check-grace', '0'];
    if (watched.length > 0) args.push('--issues', watched.join(','));
    const out = execFileSync('bash', args, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        CCR_META: meta,
      },
    });
    return out.split('\n').filter((line) => line.trim() !== '');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('watch-prs.sh の TASK', () => {
  it('task ラベルが付き、依存も片付いていて、渡されていない issue だけを出す', () => {
    const lines = watch(
      [[]],
      [
        [
          issue(900, ['task']),
          issue(901, ['task'], [{ number: 900, state: 'OPEN' }]),
          issue(902, []),
          issue(903, ['task']),
        ],
      ],
      [903],
    );

    expect(lines).toEqual(['TASK 900']);
  });

  it('依存が閉じた task は出る', () => {
    const lines = watch(
      [[]],
      [[issue(910, ['task'], [{ number: 909, state: 'CLOSED' }]), issue(911, [])]],
      [911],
    );

    expect(lines).toEqual(['TASK 910']);
  });

  it('open なPRが Closes で指している task は出ない', () => {
    // PRの側の行が混じらないよう、判断待ちにして黙らせる。#922 は、何も出ずに時間切れになるのを
    // 避けるための、誰の手元にも無い task。
    const claiming = (body: string): unknown[][] => [[pullRequest(890, 'MERGEABLE', ['判断待ち'], [], body)]];
    const issues = [[issue(920, ['task']), issue(921, ['task']), issue(922, ['task'])]];

    expect(watch(claiming('Closes #920\n\n直した。'), issues, [921])).toEqual(['TASK 922']);
    // 閉じる語は GitHub が認めるものすべて。大文字小文字も問わない。
    expect(watch(claiming('fixes #920'), issues, [921])).toEqual(['TASK 922']);
    // 参照するだけの番号では、着手済みにならない。
    expect(watch(claiming('#920 と同じ形'), issues, [921])).toEqual(['TASK 920', 'TASK 922']);
  });
});

describe('watch-prs.sh のマージ可否', () => {
  it('コンフリクトは `判断待ち` が隠していても出るが、`直し待ち` のPRでは出さない', () => {
    expect(watch([[pullRequest(800, 'CONFLICTING')]], [[]], [])).toEqual(['CONFLICT 800']);
    expect(watch([[pullRequest(801, 'CONFLICTING', ['判断待ち'])]], [[]], [])).toEqual(['CONFLICT 801']);
    // 差し戻し済みのPRで出すと、解消されるまで毎周それが返り、司令塔は同じ差し戻しを繰り返す。
    // 次に知りたいのは解消されたかどうかなので、新しいコミットが載った合図（FIXED）だけを出す。
    // 隣に置いた 803 は、見張りが黙っているのではなく 802 だけを外していることの確かめ。
    const lines = watch(
      [[pullRequest(802, 'CONFLICTING', ['直し待ち']), pullRequest(803, 'CONFLICTING')]],
      [[]],
      [],
    );

    expect(lines).toContain('CONFLICT 803');
    expect(lines).not.toContain('CONFLICT 802');
  });

  it('マージ可否が計算中のPRは決着として出さず、確定した次の周で出す', () => {
    const lines = watch([[pullRequest(810, 'UNKNOWN')], [pullRequest(810, 'CONFLICTING')]], [[]], []);

    expect(lines).toEqual(['CONFLICT 810']);
  });

  it('マージできるPRは従来どおり出る', () => {
    expect(watch([[pullRequest(820, 'MERGEABLE')]], [[]], [])).toEqual([
      'GREEN 820 ',
      '--- PR 820 ---',
      '本文 820',
    ]);
    expect(
      watch(
        [[pullRequest(821, 'MERGEABLE', [], [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }])]],
        [[]],
        [],
      ),
    ).toEqual(['RED 821 test']);
  });

  it('緑でないPRの本文は引かない', () => {
    // 受け取った側が読むのは緑のPRだけ。赤やコンフリクトの本文まで付けると、差し戻す判断には
    // 要らないものが毎回載る。
    expect(watch([[pullRequest(822, 'CONFLICTING')]], [[]], [])).toEqual(['CONFLICT 822']);
  });
});

describe('watch-prs.sh の CHECKED', () => {
  /** 項目を並べて確認の置き場の本文にする。`x ` で始まるものがチェック済み。 */
  const asking = (number: number, ...items: string[]): unknown =>
    issue(
      number,
      [],
      [],
      items.map((item) => `- [${item.startsWith('x ') ? 'x' : ' '}] ${item.replace(/^x /, '')}`).join('\n'),
    );

  it('起動より後に付いたチェックだけを出す', () => {
    const lines = watch(
      [[]],
      [
        [asking(656, 'x 海の色を決める', '島の名前を決める')],
        [asking(656, 'x 海の色を決める', 'x 島の名前を決める')],
      ],
      [656],
    );

    expect(lines).toEqual(['CHECKED 656 島の名前を決める']);
  });

  it('外したチェックは出さない', () => {
    // 何も出ないことは、時間切れと区別が付かない。同じ周に別の項目を付けて、そちらだけが出ることで
    // 「外したほうは出ていない」を見る。
    const lines = watch(
      [[]],
      [
        [asking(656, 'x 海の色を決める', '島の名前を決める')],
        [asking(656, '海の色を決める', 'x 島の名前を決める')],
      ],
      [656],
    );

    expect(lines).toEqual(['CHECKED 656 島の名前を決める']);
  });

  it('見張っていない issue のチェックは出さない', () => {
    const lines = watch(
      [[]],
      [
        [asking(656, '海の色を決める'), asking(657, '別の問い')],
        [asking(656, 'x 海の色を決める'), asking(657, 'x 別の問い')],
      ],
      [656],
    );

    expect(lines).toEqual(['CHECKED 656 海の色を決める']);
  });
});

describe('watch-prs.sh の STALLED', () => {
  it('動いておらず、PRも出していない task のセッションを出す', () => {
    expect(watch([[]], [[]], [], [session('session_01AAA', '風が航路の向きを見ていない')])).toEqual([
      'STALLED session_01AAA 風が航路の向きを見ていない',
    ]);
  });

  it('PRを出していれば、動いていなくても出さない', () => {
    // 判定は「PRを出したか」だけ。PR本文の脚注が、そのPRを書いたセッション。
    const lines = watch(
      [[pullRequest(830, 'CONFLICTING', [], undefined, 'https://claude.ai/code/session_01AAA')]],
      [[]],
      [],
      [session('session_01AAA')],
    );

    expect(lines).toEqual(['CONFLICT 830']);
  });

  it('脚注が落ちたPRでも、Closes とタグで結んで出さない', () => {
    // 本文を書き直すと脚注は消えるが、`Closes` は消せない（消すと issue が閉じない）。
    const lines = watch(
      [[pullRequest(830, 'CONFLICTING', [], undefined, 'Closes #900\n\n脚注の無い本文')]],
      [[]],
      [],
      [session('session_01AAA')],
    );

    expect(lines).toEqual(['CONFLICT 830']);
  });

  it('別の issue を閉じるPRしか無ければ出す', () => {
    const lines = watch(
      [[pullRequest(830, 'CONFLICTING', [], undefined, 'Closes #901')]],
      [[]],
      [],
      [session('session_01AAA', '止まっている')],
    );

    expect(lines).toEqual(['CONFLICT 830', 'STALLED session_01AAA 止まっている']);
  });

  // 何も出ないことは時間切れと区別が付かないので、隣に止まったセッションを置いて、そちらだけが
  // 出ることで見る。
  it('動いているセッションと、task のタグを持たないセッションは出さない', () => {
    const lines = watch(
      [[]],
      [[]],
      [],
      [
        session('session_01WORKING', '動いている', 'SESSION_STATUS_BUCKET_WORKING'),
        session('session_01NOTAG', 'タグが無い', 'SESSION_STATUS_BUCKET_IDLE', ['bridge']),
        session('session_01AAA', '止まっている'),
      ],
    );

    expect(lines).toEqual(['STALLED session_01AAA 止まっている']);
  });
});

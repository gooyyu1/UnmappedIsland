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
 * `gh` を PATH の先頭に差し替えて、実際にスクリプトを走らせる。
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

/**
 * `gh` を差し替えて見張りを走らせ、出た行を返す。
 *
 * `prRounds`・`issueRounds` は `gh pr list`・`gh issue list` が周ごとに返す一覧で、最後のものは
 * 以降ずっと返る。
 */
function watch(prRounds: unknown[][], issueRounds: unknown[][], watched: number[]): string[] {
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
        rounds('pr', prRounds.length),
      'utf-8',
    );
    chmodSync(stub, 0o755);

    const args = [SCRIPT, '--timeout-minutes', '1', '--interval', '1', '--no-check-grace', '0'];
    if (watched.length > 0) args.push('--issues', watched.join(','));
    const out = execFileSync('bash', args, {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH ?? ''}` },
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
    expect(watch([[pullRequest(820, 'MERGEABLE')]], [[]], [])).toEqual(['GREEN 820 ']);
    expect(
      watch(
        [[pullRequest(821, 'MERGEABLE', [], [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }])]],
        [[]],
        [],
      ),
    ).toEqual(['RED 821 test']);
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

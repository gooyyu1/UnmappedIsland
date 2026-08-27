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

/** `gh issue list --json number,labels,comments,blockedBy` が返す形の1件。 */
function issue(
  number: number,
  labels: string[],
  blockedBy: { number: number; state: string }[] = [],
): unknown {
  return {
    number,
    labels: labels.map((name) => ({ name })),
    comments: [],
    blockedBy: { nodes: blockedBy },
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
): unknown {
  return {
    number,
    labels: labels.map((name) => ({ name })),
    statusCheckRollup: checks,
    comments: [],
    updatedAt: '2000-01-01T00:00:00Z',
    mergeable,
  };
}

/**
 * `gh` を差し替えて見張りを走らせ、出た行を返す。
 *
 * `prRounds` は `gh pr list` が周ごとに返す一覧で、最後のものは以降ずっと返る。
 */
function watch(prRounds: unknown[][], issues: unknown[], watched: number[]): string[] {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-watch-prs-'));
  try {
    const write = (name: string, value: unknown): string => {
      const path = join(work, name);
      writeFileSync(path, JSON.stringify(value), 'utf-8');
      return path.replace(/\\/g, '/');
    };
    prRounds.forEach((round, index) => write(`prs-${index}.json`, round));
    // `gh pr list` と `gh issue list` で返し分ける。PRの一覧は呼ばれた回数で切り替える。
    const dir = work.replace(/\\/g, '/');
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `#!/usr/bin/env bash\n` +
        `if [ "$1" = issue ]; then cat '${write('issues.json', issues)}'; exit 0; fi\n` +
        `round=$(cat '${dir}/round' 2>/dev/null || echo 0)\n` +
        `echo $((round + 1)) > '${dir}/round'\n` +
        `[ "$round" -lt ${prRounds.length} ] || round=$((${prRounds.length} - 1))\n` +
        `cat "${dir}/prs-$round.json"\n`,
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
        issue(900, ['task']),
        issue(901, ['task'], [{ number: 900, state: 'OPEN' }]),
        issue(902, []),
        issue(903, ['task']),
      ],
      [903],
    );

    expect(lines).toEqual(['TASK 900']);
  });

  it('依存が閉じた task は出る', () => {
    const lines = watch(
      [[]],
      [issue(910, ['task'], [{ number: 909, state: 'CLOSED' }]), issue(911, [])],
      [911],
    );

    expect(lines).toEqual(['TASK 910']);
  });
});

describe('watch-prs.sh のマージ可否', () => {
  it('コンフリクトしたPRは、ラベルが隠していても CONFLICT として出る', () => {
    expect(watch([[pullRequest(800, 'CONFLICTING')]], [], [])).toEqual(['CONFLICT 800']);
    expect(watch([[pullRequest(801, 'CONFLICTING', ['判断待ち'])]], [], [])).toEqual(['CONFLICT 801']);
    expect(watch([[pullRequest(802, 'CONFLICTING', ['直し待ち'])]], [], [])).toEqual(['CONFLICT 802']);
  });

  it('マージ可否が計算中のPRは決着として出さず、確定した次の周で出す', () => {
    const lines = watch([[pullRequest(810, 'UNKNOWN')], [pullRequest(810, 'CONFLICTING')]], [], []);

    expect(lines).toEqual(['CONFLICT 810']);
  });

  it('マージできるPRは従来どおり出る', () => {
    expect(watch([[pullRequest(820, 'MERGEABLE')]], [], [])).toEqual(['GREEN 820 ']);
    expect(
      watch(
        [[pullRequest(821, 'MERGEABLE', [], [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }])]],
        [],
        [],
      ),
    ).toEqual(['RED 821 test']);
  });
});

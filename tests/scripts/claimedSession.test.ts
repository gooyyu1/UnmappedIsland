import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `.github/workflows/tests.yml` の、PRを出したセッションが名乗っているかを見る段の検査。
 *
 * ここが守るのは**差し戻しの宛先**（`.claude/board-design.md` 2.11）。盤面はコミットの
 * `Claude-Session:` トレーラで相手を引くので、**名乗っていないPRは直しが要るときに誰にも回らない**
 * ——判定は出ているのに動かない、という止まり方をする（#1538）。
 *
 * ワークフローは Actions でしか動かないので、`run:` の中身を YAML から取り出して bash で走らせる。
 * `gh` は PATH の先頭で差し替え、`--jq` は本物の `jq` で評価する（フィルタの誤りを見逃さない）。
 */

// 実プロセス（bash + jq のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const WORKFLOW = resolve(__dirname, '../../.github/workflows/tests.yml');

/** `claimed` ジョブの `run:` を取り出す。 */
function script(): string {
  const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
    jobs: Record<string, { steps: { run?: string }[] }>;
  };
  const step = workflow.jobs.claimed.steps.find((s) => s.run !== undefined);
  if (step?.run === undefined) throw new Error('claimed ジョブに run: が無い');
  return step.run;
}

/** そのPRのコミットの本文を渡して走らせ、通ったかを返す。 */
function passes(bodies: readonly string[]): boolean {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-claimed-'));
  const dir = work.replace(/\\/g, '/');
  try {
    writeFileSync(
      join(work, 'pr.json'),
      JSON.stringify({ commits: bodies.map((messageBody) => ({ messageBody })) }),
      'utf-8',
    );

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
filter=''
while [ $# -gt 0 ]; do
  if [ "$1" = --jq ]; then filter="$2"; fi
  shift
done
jq -r "$filter" '${dir}/pr.json'
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    const step = join(work, 'step.sh');
    writeFileSync(step, script(), 'utf-8');

    try {
      execFileSync('bash', [step], {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          GH_TOKEN: 'x',
          REPO: 'gooyyu1/UnmappedIsland',
          PR: '1538',
        },
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const CLAIM = 'Claude-Session: https://claude.ai/code/session_01TyQngmJGi4rLDAWmfqjG9T';
const SIGN = 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>';

describe('tests.yml の claimed', () => {
  it('名乗っているコミットが1つでもあれば通す', () => {
    expect(passes([`直した理由。\n\n${SIGN}\n${CLAIM}`])).toBe(true);
  });

  // 手で足したコミットが混ざることはある。**PRの全部が名乗る必要は無い**——引きたいのは書き手が
  // 誰かで、1つ分かれば足りる。
  it('名乗っていないコミットが混ざっていても通す', () => {
    expect(passes(['整形だけ。', `直した理由。\n\n${CLAIM}`])).toBe(true);
  });

  it('どのコミットも名乗っていなければ止める', () => {
    expect(passes(['直した理由。', `別の直し。\n\n${SIGN}`])).toBe(false);
  });

  // 本文の脚注は書き直した拍子に落ちる（#1083・#1177）。**コミットに入っていることを見る**ので、
  // 同じURLが本文に在るだけでは通さない。
  it('署名だけで、トレーラの無いコミットは止める', () => {
    expect(passes([`直した理由。\n\n🤖 https://claude.ai/code/session_01TyQngmJGi4rLDAWmfqjG9T`])).toBe(
      false,
    );
  });

  it('コミットが1つも無いPRは止める', () => {
    expect(passes([])).toBe(false);
  });
});

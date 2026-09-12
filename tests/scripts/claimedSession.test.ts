import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { pathForBash, spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `.github/workflows/tests.yml` の、PRを出したセッションが名乗っているかを見る段の検査。
 *
 * ここが守るのは**差し戻しの宛先**（`agent-ops/board-design.md` 2.11）。盤面はコミットの
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

/** そのPRのコミットの本文を渡して走らせ、通ったかと出した注記を返す。 */
function run(bodies: readonly string[]): { ok: boolean; output: string } {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-claimed-'));
  const dir = pathForBash(work);
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

    const call = spawnScript(step, [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        GH_TOKEN: 'x',
        REPO: 'gooyyu1/UnmappedIsland',
        PR: '1538',
      },
    });
    return { ok: call.status === 0, output: call.stdout + call.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** そのPRのコミットの本文を渡して走らせ、通ったかを返す。 */
function passes(bodies: readonly string[]): boolean {
  return run(bodies).ok;
}

const CLAIM = 'Claude-Session: https://claude.ai/code/session_01TyQngmJGi4rLDAWmfqjG9T';
// 作業ツリーの `bridge-cse_<ID>` から落とすのは `bridge-` までではなく `bridge-cse_` まで。
// 落とし損ねたこの形が PR #1922 で通った。
const BROKEN = 'Claude-Session: https://claude.ai/code/session_cse_014cYXoMLEog6HpsE4m2bUn8';
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

  // **在るだけでは足りない。** そこが実在の形でなければ、名乗っていても差し戻しは誰にも回らない
  // ——`bridge-cse_<ID>` から `cse_` を落とし損ねた名乗りが通り抜け、PR #1922 に付いた却下が
  // 作者へ届かないまま盤面が止まった（2026-09-11）。
  it('セッションIDの形になっていない名乗りは止める', () => {
    expect(passes([`直した理由。\n\n${BROKEN}`])).toBe(false);
  });

  // 見るのは**盤面が引くのと同じ1つ**——トレーラを持つ最後のコミット（`board-read.mjs` の
  // `prSessions`）。どれか1つでも形が合えば通す読み方だと、**後から積んだ壊れた名乗りが
  // 引かれる**PRを緑で通してしまう。
  it('最後の名乗りが壊れていれば、前が正しくても止める', () => {
    expect(passes([`直した理由。\n\n${CLAIM}`, `続き。\n\n${BROKEN}`])).toBe(false);
  });

  it('壊れた名乗りの後に名乗り直していれば通す', () => {
    expect(passes([`直した理由。\n\n${BROKEN}`, `名乗り直し。\n\n${CLAIM}`])).toBe(true);
  });

  // 直し方が違う（入れ忘れではなく切り出しの誤り）ので、**同じ案内では直せない。**
  it('形が違うときと、無いときとで、別の注記を出す', () => {
    expect(run([`直した理由。\n\n${BROKEN}`]).output).toContain('形になっていません');
    expect(run(['整形だけ。']).output).toContain('トレーラがありません');
  });
});

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `.github/workflows/board-labels.yml` の、結論をラベルへ変える段の検査。
 *
 * ここが守るのは**レビューの上限**（`.claude/board-design.md` 4.6）。上限をレビュアーへの指示に
 * だけ書いていたときは、書き忘れれば誰も止めず、PR #1527 で4周目が走った。**止めるのは機械の側**
 * になったので、ここが壊れると同じことが黙って起きる。
 *
 * ワークフローは Actions でしか動かないので、`run:` の中身を YAML から取り出して bash で走らせる。
 * `gh` は PATH の先頭で差し替え、`--jq` は本物の `jq` で評価する（フィルタの誤りを見逃さない）。
 */

// 実プロセス（bash + jq のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const WORKFLOW = resolve(__dirname, '../../.github/workflows/board-labels.yml');

const PR = '1527';

interface Comment {
  readonly body: string;
  /** 既定は書き込み権のある投稿者。 */
  readonly association?: string;
}

interface Run {
  /** `gh pr edit` に渡された引数を、打たれた順に。 */
  readonly edits: string[];
}

/** `verdict` ジョブの `run:` を取り出す。 */
function script(): string {
  const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
    jobs: Record<string, { steps: { run?: string }[] }>;
  };
  const step = workflow.jobs.verdict.steps.find((s) => s.run !== undefined);
  if (step?.run === undefined) throw new Error('verdict ジョブに run: が無い');
  return step.run;
}

function run(body: string, comments: readonly Comment[] = []): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-board-labels-'));
  const dir = work.replace(/\\/g, '/');
  try {
    writeFileSync(
      join(work, 'comments.json'),
      JSON.stringify({
        comments: comments.map((c) => ({
          body: c.body,
          authorAssociation: c.association ?? 'OWNER',
        })),
      }),
      'utf-8',
    );

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}
case "$1 $2" in
"pr view")
  filter=''
  while [ $# -gt 0 ]; do
    if [ "$1" = --jq ]; then filter="$2"; fi
    shift
  done
  jq -r "$filter" '${dir}/comments.json'
  ;;
"pr edit")
  shift 2
  echo "$*" >>'${dir}/edits.txt'
  ;;
*) exit 1 ;;
esac
`,
      'utf-8',
    );
    chmodSync(gh, 0o755);
    writeFileSync(join(work, 'edits.txt'), '', 'utf-8');

    const step = join(work, 'step.sh');
    writeFileSync(step, script(), 'utf-8');

    execFileSync('bash', [step], {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        GH_TOKEN: 'x',
        REPO: 'gooyyu1/UnmappedIsland',
        PR,
        BODY: body,
      },
    });

    return {
      edits: readFileSync(join(work, 'edits.txt'), 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const BLOCK = '[レビュー] 直しが要る';
const PASS = '[レビュー] 通してよい';

/** そのPRに既に付いている、結論のコメント。今回の判定もここに載る（Actions が動くのは投稿の後）。 */
const past = (...bodies: string[]): Comment[] => bodies.map((body) => ({ body }));

describe('board-labels.yml の verdict', () => {
  it('「直しが要る」で 直し待ち を付けて 通してよい を外す', () => {
    const result = run(BLOCK, past(BLOCK));

    expect(result.edits).toEqual([
      `${PR} --repo gooyyu1/UnmappedIsland --add-label 直し待ち --remove-label 通してよい`,
    ]);
  });

  it('「通してよい」で 通してよい を付けて 直し待ち を外す', () => {
    const result = run(PASS, past(BLOCK, BLOCK, PASS));

    expect(result.edits).toEqual([
      `${PR} --repo gooyyu1/UnmappedIsland --add-label 通してよい --remove-label 直し待ち`,
    ]);
  });

  it('結論の行でないコメントには何もしない', () => {
    expect(run('[スメル] 名前が中身と合っていない').edits).toEqual([]);
    expect(run('前置き\n[レビュー] 通してよい').edits).toEqual([]);
  });

  // 上限（4.6）。3周目の判定が「直しが要る」なら、そこで人の手番へ移す。
  // **`直し待ち` を一緒に外す。** 残すと盤面が差し戻しを打ち、人が答える前に次の周が走る。
  it('3周目の「直しが要る」で 収束せず を付け、直し待ち を外す', () => {
    const result = run(BLOCK, past(BLOCK, BLOCK, BLOCK));

    expect(result.edits.at(-1)).toBe(
      `${PR} --repo gooyyu1/UnmappedIsland --add-label 収束せず --remove-label 直し待ち`,
    );
  });

  it('2周目までは 収束せず を付けない', () => {
    const result = run(BLOCK, past(BLOCK, BLOCK));

    expect(result.edits.join('\n')).not.toContain('収束せず');
  });

  // 数えるのは**判定として数えたもの**だけ。緩めると、ラベルが付かなかったコメントで数が進み、
  // まだ2周目のPRが人の手番へ落ちる。
  it('結論の行でないコメントは、周回数に数えない', () => {
    const noise = past(BLOCK, BLOCK, '[スメル] 気づき', 'ここは意図的です');

    expect(run(BLOCK, noise).edits.join('\n')).not.toContain('収束せず');
  });

  // 誰でもコメントできる場所なので、周回数もラベルと同じ範囲の投稿者だけで数える。
  it('書き込み権の無い投稿者のコメントは、周回数に数えない', () => {
    const outsider = [...past(BLOCK, BLOCK), { body: BLOCK, association: 'NONE' }];

    expect(run(BLOCK, outsider).edits.join('\n')).not.toContain('収束せず');
  });

  // 「通してよい」で終わった周も1周。3周目に入っていることは変わらない。
  it('通してよい を挟んでいても、3周目なら 収束せず を付ける', () => {
    const mixed = past(BLOCK, PASS, BLOCK);

    expect(run(BLOCK, mixed).edits.join('\n')).toContain('収束せず');
  });

  // 1行目を `head` へ流していたとき、**4KiBを超える本文でステップごと落ちていた**——書き切る前に
  // `head` が終わるので `printf` が SIGPIPE を受け、`pipefail` で失敗になる。**判定は投稿されて
  // いるのにラベルだけが付かない**ので、盤面からは「まだ読まれていないPR」と区別が付かず、
  // PR #1538 がマージへ進めないまま止まった。
  //
  // 長さは上下から挟まれている。**下はパイプの容量（Linux では64KiB）**——それ未満だと `printf` が
  // 全部を書き込み終えてしまえるので、`head` へ流す形へ戻しても落ちず、見張りが効かない。**上は
  // 環境変数1本あたりの上限（同128KiB）**——本文を環境変数で渡すのは Actions と同じなので、
  // そこを超える長さは本番でも渡らない。ここだけ別の渡し方にすると、届かない長さまで守れている
  // ことにしてしまう。
  it('本文が長くても、ラベルを付ける', () => {
    const long = `${PASS}\n${'あ'.repeat(35_000)}`;

    expect(run(long, past(long)).edits).toEqual([
      `${PR} --repo gooyyu1/UnmappedIsland --add-label 通してよい --remove-label 直し待ち`,
    ]);
  });
});

/**
 * push で前の差分の印を落とす段。**人が外す作業を作らないための要**（`board-design.md` 2.13.1）
 * なので、落とす対象が欠けると、人の手番の印が付いたまま残って盤面が止まる。
 */
describe('board-labels.yml の synchronized', () => {
  it('前の差分に付いていた印を、人の手番のぶんまで落とす', () => {
    const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
      jobs: Record<string, { steps: { run?: string }[] }>;
    };
    const step = workflow.jobs.synchronized.steps.find((s) => s.run !== undefined)?.run;

    for (const name of ['直し待ち', '通してよい', '判断待ち', '収束せず', '却下']) {
      expect(step).toContain(`--remove-label ${name}`);
    }
  });
});

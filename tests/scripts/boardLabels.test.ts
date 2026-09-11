import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { pathForBash, runScript, spawnScript } from '../support/runScript';
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
  const dir = pathForBash(work);
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

    runScript(step, [], {
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
const PASS_ASK = '[レビュー] 通してよい（人の判断が要る）';

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

  // 差分を読まないと判定できないものはレビュアーが引き取った（`board-design.md` 2.13.4）。
  // **通したうえで人へ回す**ので、`通してよい` と `判断待ち` の両方が付く。
  it('「通してよい（人の判断が要る）」で 通してよい と 判断待ち を付ける', () => {
    const result = run(PASS_ASK, past(PASS_ASK));

    expect(result.edits).toEqual([
      `${PR} --repo gooyyu1/UnmappedIsland --add-label 通してよい --add-label 判断待ち --remove-label 直し待ち`,
    ]);
  });

  it('結論の行でないコメントには何もしない', () => {
    expect(run('[スメル] 名前が中身と合っていない').edits).toEqual([]);
    expect(run('前置き\n[レビュー] 通してよい').edits).toEqual([]);
    expect(run('[レビュー] 通してよい（人の判断が要る）だと思います').edits).toEqual([]);
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

  // **新しい判定の形も1周**。数え方から漏らすと、3周で人へ上げる勘定（4.6）が狂う。
  it('通してよい（人の判断が要る）の周も、周回数に数える', () => {
    const mixed = past(BLOCK, PASS_ASK, BLOCK);

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
 * セッションの名乗りを盤面へ移す段（`.claude/board-design.md` 2.15.2・2.16.2・2.17.3）。**ここが
 * 動かないと、返したことがラベルにならない**——issue は `kind:task` が付いたままなので、盤面は
 * そのまま次のセッションへ配り直し、返した意味が消える。**順序（`blockedBy`）はここが唯一の
 * 経路**なので、動かなければ張られないまま配られる。
 */
describe('board-labels.yml の declared', () => {
  const ISSUE = '1376';

  /** 通る名乗り用。**落ちたことを結果に混ぜない**ので、落ちれば「何もしない」と区別が付く。 */
  function runDeclared(body: string): string[] {
    const result = spawnDeclared(body);
    if (result.status !== 0) throw new Error(`declared が ${result.status} で終わった: ${body}`);
    return result.edits;
  }

  function spawnDeclared(body: string): { readonly edits: string[]; readonly status: number | null } {
    const work = mkdtempSync(join(tmpdir(), 'unmapped-island-returned-'));
    const dir = pathForBash(work);
    try {
      const gh = join(work, 'gh');
      writeFileSync(
        gh,
        `${STUB_SHEBANG}
case "$1 $2" in
"issue edit")
  shift 2
  echo "$*" >>'${dir}/edits.txt'
  ;;
"api --method")
  shift 3
  echo "api $*" >>'${dir}/edits.txt'
  ;;
# 先に要るほうの数値 ID を引く側。**番号から導ける値を返す**ので、どの issue を引いたかが
# 打たれた行に残る。
"api repos/"*)
  printf '88%s\\n' "\${2##*/}"
  ;;
*) exit 1 ;;
esac
`,
        'utf-8',
      );
      chmodSync(gh, 0o755);
      writeFileSync(join(work, 'edits.txt'), '', 'utf-8');

      const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
        jobs: Record<string, { steps: { run?: string }[] }>;
      };
      const run = workflow.jobs.declared.steps.find((s) => s.run !== undefined)?.run;
      if (run === undefined) throw new Error('declared ジョブに run: が無い');
      const step = join(work, 'step.sh');
      writeFileSync(step, run, 'utf-8');

      const result = spawnScript(step, [], {
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          GH_TOKEN: 'x',
          REPO: 'gooyyu1/UnmappedIsland',
          ISSUE,
          BODY: body,
        },
      });

      return {
        edits: readFileSync(join(work, 'edits.txt'), 'utf-8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        status: result.status,
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  // 名乗る理由は選択肢が閉じていないので、1行目は前方一致で見る（2.15.2）。
  it('1行目が [返却] で始まっていれば、判断待ち を付ける', () => {
    expect(runDeclared('[返却] 仕様が決まっておらず、仮決めもできない\n\n詳細')).toEqual([
      `${ISSUE} --repo gooyyu1/UnmappedIsland --add-label 判断待ち`,
    ]);
  });

  // **名乗らせるのは、なぜブリッジが要るのかがラベルに残らないから**（2.16.2）。
  it('1行目が [ブリッジ] で始まっていれば、env:bridge を付ける', () => {
    expect(runDeclared('[ブリッジ] .claude/parallel-work.md を直す必要がある\n\nここまで調べた')).toEqual([
      `${ISSUE} --repo gooyyu1/UnmappedIsland --add-label env:bridge`,
    ]);
  });

  // **分類（`kind:`）は動かさない**（2.15.2・2.17.1）。軸が違ううえ、外すと人が列へ戻すのに
  // 2タップ要り、外した issue は未整理として棚卸しへ戻る。
  it('分類は動かさない', () => {
    expect(runDeclared('[返却] 決められない').join('\n')).not.toContain('kind:');
  });

  // 棚卸しはクラウドで立つので、依存を張る道具を持たない（2.17.3）。**コメントを置いた issue が
  // 待つ側**で、1行目が挙げる番号が先に要るほう。
  it('1行目が [順序] なら、その issue を、挙がった番号の後ろへ回す', () => {
    expect(runDeclared('[順序] #1234 の後（宣言を読む側がこの issue）')).toEqual([
      `api repos/gooyyu1/UnmappedIsland/issues/${ISSUE}/dependencies/blocked_by -F issue_id=881234`,
    ]);
  });

  // **黙って何もしないと、申告した側は張られたと思ったまま進む。**
  it('[順序] の番号が読めなければ落ちる', () => {
    const result = spawnDeclared('[順序] さっきの issue の後');

    expect(result.status).not.toBe(0);
    expect(result.edits).toEqual([]);
  });

  it('名乗りの行でないコメントには何もしない', () => {
    expect(runDeclared('進捗です。あと少しで出せます。')).toEqual([]);
    expect(runDeclared('前置き\n[返却] 決められない')).toEqual([]);
    expect(runDeclared('前置き\n[ブリッジ] 承認で止まる')).toEqual([]);
    expect(runDeclared('前置き\n[順序] #1234 の後')).toEqual([]);
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

/**
 * 人がPRのラベルを外したことを、差し戻しへ訳す段（`.claude/board-design.md` 2.13.1）。
 *
 * **ここが「外したのは誰か」を取り違えると、盤面が回らなくなる。** 上の `synchronized` は push の
 * たびに同じラベルを外すので、機械のぶんまで差し戻しに読むと、**直して push した本人がその push で
 * 差し戻される**——直すほど差し戻る輪になる。
 */
describe('board-labels.yml の unlabeled_by_hand', () => {
  const PR = '1701';

  /** 外れたラベルと、外した相手の種別を渡して走らせる。 */
  function runUnlabeled(label: string, sender = 'User'): string[] {
    const work = mkdtempSync(join(tmpdir(), 'unmapped-island-unlabeled-'));
    const dir = pathForBash(work);
    try {
      const gh = join(work, 'gh');
      writeFileSync(
        gh,
        `${STUB_SHEBANG}
case "$1 $2" in
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

      const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
        jobs: Record<string, { steps: { run?: string }[] }>;
      };
      const step = workflow.jobs.unlabeled_by_hand.steps.find((s) => s.run !== undefined)?.run;
      if (step === undefined) throw new Error('unlabeled_by_hand ジョブに run: が無い');
      const file = join(work, 'step.sh');
      writeFileSync(file, step, 'utf-8');

      const result = spawnScript(file, [], {
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          GH_TOKEN: 'x',
          REPO: 'gooyyu1/UnmappedIsland',
          PR,
          LABEL: label,
          SENDER: sender,
        },
      });
      if (result.status !== 0) throw new Error(`unlabeled_by_hand が ${result.status} で終わった`);

      return readFileSync(join(work, 'edits.txt'), 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const REJECTED = [`${PR} --repo gooyyu1/UnmappedIsland --add-label 却下`];

  // 人がすることは「外す＝直してもらう」「マージする＝それでよい」の2つだけ（2.13.1）。
  it('PRを止めている印を人が外したら、却下 を付ける', () => {
    expect(runUnlabeled('判断待ち')).toEqual(REJECTED);
    expect(runUnlabeled('収束せず')).toEqual(REJECTED);
    expect(runUnlabeled('通してよい')).toEqual(REJECTED);
  });

  // **push で機械が外したぶんは差し戻しではない。**
  it('機械が外したぶんでは、却下 を付けない', () => {
    expect(runUnlabeled('判断待ち', 'Bot')).toEqual([]);
    expect(runUnlabeled('収束せず', 'Bot')).toEqual([]);
    expect(runUnlabeled('通してよい', 'Bot')).toEqual([]);
  });

  // 既に差し戻し中の印を外しても、打つ手は変わらない。分類（`kind:`）や `急ぎ` も同じ。
  it('PRを止めていない印を外しても、何もしない', () => {
    expect(runUnlabeled('直し待ち')).toEqual([]);
    expect(runUnlabeled('却下')).toEqual([]);
    expect(runUnlabeled('急ぎ')).toEqual([]);
  });
});

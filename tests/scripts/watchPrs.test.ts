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
  comments: { body: string; createdAt: string }[] = [],
): unknown {
  return {
    number,
    labels: labels.map((name) => ({ name })),
    statusCheckRollup: checks,
    comments: comments.map((comment) => ({ ...comment, author: { login: 'gooyyu1' } })),
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
 * レビューを手配済みであることを表すセッション。`dispatch-review.sh` が付けるタグと同じ形で、
 * これが最後のコミットより後に立っていれば `UNREVIEWED` は黙る。
 */
function reviewSession(
  number: number,
  createdAt = '2026-08-29T13:00:00Z',
  status = 'SESSION_STATUS_RUNNING',
): unknown {
  return {
    id: `session_01REVIEW${number}`,
    title: `#${number} のレビュー`,
    tags: [`review-${number}`],
    session_status: status,
    status_bucket: 'SESSION_STATUS_BUCKET_WORKING',
    created_at: createdAt,
    updated_at: '2000-01-01T00:00:00Z',
  };
}

/**
 * `gh` とセッション一覧を差し替えて見張りを走らせ、出た行を返す。
 *
 * `prRounds`・`issueRounds` は `gh pr list`・`gh issue list` が周ごとに返す一覧で、最後のものは
 * 以降ずっと返る。`options.pushed`・`options.sentBack` はPR番号ごとの「最後のコミットの時刻」と
 * 「`直し待ち` を付けた時刻」で、`REVIEWED`・`FIXED` はこの2つと比べて手番を決める。
 * `options.numbers` は見張るPRの番号（渡さなければ全部）。
 */
function watch(
  prRounds: unknown[][],
  issueRounds: unknown[][],
  watched: number[],
  sessions: unknown[] = [],
  options: {
    pushed?: Record<number, string>;
    sentBack?: Record<number, string>;
    numbers?: number[];
    noSessions?: boolean;
  } = {},
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
    // `gh pr view --json commits --jq ...` と `gh api .../timeline --jq ...` は、値を1行で返す。
    const writeLine = (name: string, value: string): void => {
      writeFileSync(join(work, name), `${value}\n`, 'utf-8');
    };
    Object.entries(options.pushed ?? {}).forEach(([number, at]) => writeLine(`commits-${number}`, at));
    Object.entries(options.sentBack ?? {}).forEach(([number, at]) => writeLine(`labeled-${number}`, at));
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
        // ラベルを付けた時刻。無い番号では何も返さない（＝履歴が引けなかった場合）。
        `if [ "$1" = api ]; then\n` +
        `  cat "${dir}/labeled-$(echo "$2" | grep -o '[0-9]\\+')" 2>/dev/null\n  exit 0\nfi\n` +
        `if [ "$1" = issue ]; then\n${rounds('issue', issueRounds.length)}exit 0\nfi\n` +
        // 緑のPRに同梱する本文の引き直し。周を進めないよう、一覧より先に返す。
        `if [ "$2" = view ] && [[ "$*" == *title,body,files* ]]; then\n` +
        `  echo "本文 $3"\n  exit 0\nfi\n` +
        `if [ "$2" = view ] && [[ "$*" == *commits* ]]; then\n` +
        `  cat "${dir}/commits-$3" 2>/dev/null\n  exit 0\nfi\n` +
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
    if (options.noSessions === true) args.push('--no-sessions');
    (options.numbers ?? []).forEach((number) => args.push(String(number)));
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
  // この節で見たいのはマージ可否だけなので、どのPRもレビューは手配済みにして `UNREVIEWED` を
  // 黙らせる。手配していないPRが出ることは、下の `UNREVIEWED` の節で見る。
  it('コンフリクトは `判断待ち` が隠していても出るが、`直し待ち` のPRでは出さない', () => {
    expect(watch([[pullRequest(800, 'CONFLICTING')]], [[]], [], [reviewSession(800)])).toEqual([
      'CONFLICT 800',
    ]);
    expect(watch([[pullRequest(801, 'CONFLICTING', ['判断待ち'])]], [[]], [])).toEqual(['CONFLICT 801']);
    // 差し戻し済みのPRで出すと、解消されるまで毎周それが返り、司令塔は同じ差し戻しを繰り返す。
    // 次に知りたいのは解消されたかどうかなので、新しいコミットが載った合図（FIXED）だけを出す。
    // 隣に置いた 803 は、見張りが黙っているのではなく 802 だけを外していることの確かめ。
    const lines = watch(
      [[pullRequest(802, 'CONFLICTING', ['直し待ち']), pullRequest(803, 'CONFLICTING')]],
      [[]],
      [],
      [reviewSession(803)],
    );

    expect(lines).toEqual(['CONFLICT 803']);
  });

  it('マージ可否が計算中のPRは決着として出さず、確定した次の周で出す', () => {
    const lines = watch(
      [[pullRequest(810, 'UNKNOWN')], [pullRequest(810, 'CONFLICTING')]],
      [[]],
      [],
      [reviewSession(810)],
    );

    expect(lines).toEqual(['CONFLICT 810']);
  });

  it('マージできるPRは従来どおり出る', () => {
    expect(watch([[pullRequest(820, 'MERGEABLE')]], [[]], [], [reviewSession(820)])).toEqual([
      'GREEN 820 ',
      '--- PR 820 ---',
      '本文 820',
    ]);
    expect(
      watch(
        [[pullRequest(821, 'MERGEABLE', [], [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }])]],
        [[]],
        [],
        [reviewSession(821)],
      ),
    ).toEqual(['RED 821 test']);
  });

  it('緑でないPRの本文は引かない', () => {
    // 受け取った側が読むのは緑のPRだけ。赤やコンフリクトの本文まで付けると、差し戻す判断には
    // 要らないものが毎回載る。
    expect(watch([[pullRequest(822, 'CONFLICTING')]], [[]], [], [reviewSession(822)])).toEqual([
      'CONFLICT 822',
    ]);
  });
});

describe('watch-prs.sh の手番（REVIEWED・FIXED）', () => {
  /** レビューの結論のコメント。**見張りの起動より前**の時刻で置く。 */
  const verdict = (
    body: string,
    createdAt = '2026-08-29T12:49:33Z',
  ): { body: string; createdAt: string } => ({
    body,
    createdAt,
  });

  it('見張りの起動より前に付いた結論でも出す', () => {
    // 起動時刻と比べていたとき、立て直した見張りの谷間で出た結論が誰にも届かなかった
    // （2026-08-29 の PR #1183・#1182）。比べる相手はコミットなので、いつ起動しても同じ答えになる。
    const lines = watch(
      [[pullRequest(840, 'CONFLICTING', [], undefined, '', [verdict('[レビュー] 通してよい')])]],
      [[]],
      [],
    );

    expect(lines).toEqual(['CONFLICT 840', 'REVIEWED 840 通してよい']);
  });

  it('結論より後にコミットが載っていれば出さない', () => {
    // 直しが既に入っている＝結論を受け取る手番ではない。次はレビューへ出し直す手番なので、
    // 841 は `UNREVIEWED` のほうへ移る。隣の 842 は、見張りが黙っているのではなく 841 だけを
    // 外していることの確かめ。
    const lines = watch(
      [
        [
          pullRequest(841, 'CONFLICTING', [], undefined, '', [verdict('[レビュー] 直しが要る')]),
          pullRequest(842, 'CONFLICTING', [], undefined, '', [verdict('[レビュー] 直しが要る')]),
        ],
      ],
      [[]],
      [],
      [],
      { pushed: { 841: '2026-08-29T13:00:00Z' } },
    );

    expect(lines).toEqual(['CONFLICT 841', 'CONFLICT 842', 'REVIEWED 842 直しが要る', 'UNREVIEWED 841']);
  });

  it('ラベルの付いたPRは、結論が残っていても出さない', () => {
    // `直し待ち`・`判断待ち` は「既に誰かの手元にある」の印。付いた時点で司令塔の手番は終わっている。
    const lines = watch(
      [
        [
          pullRequest(843, 'MERGEABLE', ['直し待ち'], undefined, '', [verdict('[レビュー] 直しが要る')]),
          pullRequest(844, 'MERGEABLE', ['判断待ち'], undefined, '', [verdict('[レビュー] 通してよい')]),
          pullRequest(845, 'CONFLICTING', [], undefined, '', [verdict('[レビュー] 通してよい')]),
        ],
      ],
      [[]],
      [],
    );

    expect(lines).toEqual(['CONFLICT 845', 'REVIEWED 845 通してよい']);
  });

  it('差し戻した後のコミットで FIXED を出す', () => {
    // 比べる相手は `直し待ち` を付けた時刻。見張りの起動より前に上がった直しでも出る。
    const lines = watch([[pullRequest(850, 'MERGEABLE', ['直し待ち'])]], [[]], [], [], {
      pushed: { 850: '2026-08-29T12:55:00Z' },
      sentBack: { 850: '2026-08-29T12:00:00Z' },
    });

    expect(lines).toEqual(['FIXED 850']);
  });

  it('番号を絞っても、手番の3つ（REVIEWED・UNREVIEWED・FIXED）は絞られない', () => {
    // 絞られると、渡し忘れた番号の直しと結論が出なくなる——取りこぼしを防ぐのがこの3つの役目
    // なので、絞ると役目そのものが消える。853 の `GREEN` が出ていないことで、絞りは効いている。
    const lines = watch(
      [
        [
          pullRequest(853, 'MERGEABLE'),
          pullRequest(854, 'MERGEABLE', ['直し待ち']),
          pullRequest(855, 'MERGEABLE', [], undefined, '', [verdict('[レビュー] 通してよい')]),
        ],
      ],
      [[]],
      [],
      [],
      {
        numbers: [0],
        pushed: { 854: '2026-08-29T12:55:00Z' },
        sentBack: { 854: '2026-08-29T12:00:00Z' },
      },
    );

    expect(lines).toEqual(['FIXED 854', 'REVIEWED 855 通してよい', 'UNREVIEWED 853']);
  });

  it('差し戻す前のコミットしか無ければ FIXED を出さない', () => {
    const lines = watch(
      [[pullRequest(851, 'MERGEABLE', ['直し待ち']), pullRequest(852, 'MERGEABLE', ['直し待ち'])]],
      [[]],
      [],
      [],
      {
        pushed: { 851: '2026-08-29T11:00:00Z', 852: '2026-08-29T12:55:00Z' },
        sentBack: { 851: '2026-08-29T12:00:00Z', 852: '2026-08-29T12:00:00Z' },
      },
    );

    expect(lines).toEqual(['FIXED 852']);
  });
});

describe('watch-prs.sh の UNREVIEWED', () => {
  // どれも `0` を渡して走らせる。司令塔がレビュー中のPRを黙らせるために普段そうしていて、そのとき
  // `GREEN`・`RED`・`CONFLICT` が全部外れることが、この合図を要る理由そのものだから。

  it('結論もレビューのセッションも無いPRを出す', () => {
    const lines = watch([[pullRequest(860, 'MERGEABLE')]], [[]], [], [], { numbers: [0] });

    expect(lines).toEqual(['UNREVIEWED 860']);
  });

  it('レビューのセッションが立っていれば出さない', () => {
    // 手配してもPRの状態は変わらないので、ここを見ていないと結論が付くまで毎周これが返り、
    // 見張りがその場で終わる。隣の 862 は、見張りが黙っているのではないことの確かめ。
    const lines = watch(
      [[pullRequest(861, 'MERGEABLE'), pullRequest(862, 'MERGEABLE')]],
      [[]],
      [],
      [reviewSession(861)],
      { numbers: [0] },
    );

    expect(lines).toEqual(['UNREVIEWED 862']);
  });

  it('最後のコミットより前に立ったセッションでは黙らない', () => {
    // 直しが入った後も前回のレビューのセッションは残る。畳み忘れで黙ると、直した先が
    // レビューされないまま通る。
    const lines = watch(
      [[pullRequest(863, 'MERGEABLE'), pullRequest(864, 'MERGEABLE')]],
      [[]],
      [],
      [reviewSession(863, '2026-08-29T12:00:00Z'), reviewSession(864)],
      { numbers: [0], pushed: { 863: '2026-08-29T12:30:00Z', 864: '2026-08-29T12:30:00Z' } },
    );

    expect(lines).toEqual(['UNREVIEWED 863']);
  });

  it('畳んだセッションは数えない', () => {
    const lines = watch(
      [[pullRequest(865, 'MERGEABLE'), pullRequest(866, 'MERGEABLE')]],
      [[]],
      [],
      [reviewSession(865, '2026-08-29T13:00:00Z', 'SESSION_STATUS_ARCHIVED'), reviewSession(866)],
      { numbers: [0] },
    );

    expect(lines).toEqual(['UNREVIEWED 865']);
  });

  it('結論が最後のコミットより新しいPRと、ラベルの付いたPRは出さない', () => {
    // 前者は `REVIEWED` の手番、後者は既に誰かの手元にある。
    const lines = watch(
      [
        [
          pullRequest(867, 'MERGEABLE', [], undefined, '', [
            { body: '[レビュー] 通してよい', createdAt: '2026-08-29T12:49:33Z' },
          ]),
          pullRequest(868, 'MERGEABLE', ['直し待ち']),
          pullRequest(869, 'MERGEABLE', ['判断待ち']),
          pullRequest(870, 'MERGEABLE'),
        ],
      ],
      [[]],
      [],
      [],
      { numbers: [0] },
    );

    expect(lines).toEqual(['REVIEWED 867 通してよい', 'UNREVIEWED 870']);
  });

  it('セッション一覧を見ない指定では出さない', () => {
    // 手配済みかどうかを判定する材料が無い。出し続けると見張りが毎周その場で終わるので、
    // 出さない側へ倒す。TASK が出ていることで、見張り自体は動いている。
    const lines = watch(
      [[pullRequest(871, 'MERGEABLE')]],
      [[issue(905, ['task']), issue(906, [])]],
      [906],
      [],
      {
        numbers: [0],
        noSessions: true,
      },
    );

    expect(lines).toEqual(['TASK 905']);
  });
});

describe('watch-prs.sh の CHECKED', () => {
  /** 項目を並べて確認の置き場（`meta`）の本文にする。`x ` で始まるものがチェック済み。 */
  const asking = (number: number, ...items: string[]): unknown => checklist(number, ['meta'], ...items);

  /** `asking` と同じ本文を、任意のラベルで作る。 */
  const checklist = (number: number, labels: string[], ...items: string[]): unknown =>
    issue(
      number,
      labels,
      [],
      items.map((item) => `- [${item.startsWith('x ') ? 'x' : ' '}] ${item.replace(/^x /, '')}`).join('\n'),
    );

  it('付いているチェックを毎周出す。起動時に付いていたものも出す', () => {
    // 起動時の状態を基準にすると、見張りを立て直すたびに、その谷間で付いたチェックが飲み込まれる。
    // 隣の未チェックの項目が出ないことで、`[x]` だけを見ていることも見る。
    const lines = watch([[]], [[asking(656, 'x 海の色を決める', '島の名前を決める')]], [656]);

    expect(lines).toEqual(['CHECKED 656 海の色を決める']);
  });

  it('1周目に他の合図があっても、同じ周のチェックを出す', () => {
    // 見張りは合図が1件でもあれば終わるので、増分の基準を1周目で取ると、他の合図が出た周の
    // チェックは一度も出ないまま次の起動の基準に飲み込まれる。忙しい局面ほどそうなる。
    const lines = watch([[pullRequest(871, 'MERGEABLE')]], [[asking(656, 'x 海の色を決める')]], [656], [], {
      numbers: [0],
    });

    expect(lines).toEqual(['CHECKED 656 海の色を決める', 'UNREVIEWED 871']);
  });

  it('見張っていない issue のチェックは出さない', () => {
    const lines = watch([[]], [[asking(656, 'x 海の色を決める'), asking(657, 'x 別の問い')]], [656]);

    expect(lines).toEqual(['CHECKED 656 海の色を決める']);
  });

  it('`meta` でない issue のチェックは出さない', () => {
    // チェックが答えになるのは確定待ちの盤の上だけ。task issue が本文に持つ手順の一覧まで拾うと、
    // 拾いようのない項目で毎周起こされる。
    const lines = watch(
      [[]],
      [[asking(656, 'x 海の色を決める'), checklist(900, ['task'], 'x 手順1')]],
      [656, 900],
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
      [session('session_01AAA'), reviewSession(830)],
    );

    expect(lines).toEqual(['CONFLICT 830']);
  });

  it('脚注が落ちたPRでも、Closes とタグで結んで出さない', () => {
    // 本文を書き直すと脚注は消えるが、`Closes` は消せない（消すと issue が閉じない）。
    const lines = watch(
      [[pullRequest(830, 'CONFLICTING', [], undefined, 'Closes #900\n\n脚注の無い本文')]],
      [[]],
      [],
      [session('session_01AAA'), reviewSession(830)],
    );

    expect(lines).toEqual(['CONFLICT 830']);
  });

  it('別の issue を閉じるPRしか無ければ出す', () => {
    const lines = watch(
      [[pullRequest(830, 'CONFLICTING', [], undefined, 'Closes #901')]],
      [[]],
      [],
      [session('session_01AAA', '止まっている'), reviewSession(830)],
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

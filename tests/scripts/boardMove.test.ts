import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { moves as decide } from '../../scripts/agent/board-move.mjs';
// 打った手の覚えを消す側（`trackIdle`）。**盤面が選ぶ指紋が、あちらの消去に当たらないこと**を
// 下で留める。
import { trackIdle } from '../../scripts/agent/board-round.mjs';

/**
 * `scripts/agent/board-move.mjs` の検査。
 *
 * ここが守るのは**盤面から出る手が1つに決まること**。デーモンは出た手をそのまま打つので
 * （`.claude/board-design.md` 2.3）、判定を間違えると走っているセッションへ二重に投げるか、
 * 直しを待つPRが誰にも渡らないまま止まる。同じ盤面へ同じ手を二度出さないことも見る。
 */

const NOW = '2026-09-05T02:00:00Z';
/** これより前に更新が止まっているPRは、チェックが0本でも緑と読む。 */
const SETTLED = '2026-09-05T01:00:00Z';

interface Board {
  settledBefore?: string;
  /** `main` の先頭のCI。省くと緑（既存の盤面はどれも `main` が緑のときの話）。 */
  mainChecks?: readonly unknown[];
  prs?: readonly unknown[];
  /**
   * マージ済みPRとそのコメント。**後片付けの相手**（`board-move.mjs` の `TIDY`）と、スメルを拾う係の
   * `due`（同 `CYCLES`）が読む。
   */
  mergedPrs?: readonly { number: number }[];
  /** 後片付けをまだ打っていない形にするか。既定は打った後（下の `TIDIED_ALREADY`）。 */
  untidied?: boolean;
  /** `archive/` に入っていない判断の履歴の数。価値観を畳む係の `due` が読む。 */
  pendingDecisions?: number;
  /** 二次がまだ読んでいない、一次の分析の記録の数。回をまたぐ形を見る係の `due` が読む。 */
  unsummarizedAnalyses?: number;
  issues?: readonly unknown[];
  sessions?: readonly {
    id: string;
    status: string;
    bucket: string;
    /** どこで走っているか（`cloud` / `bridge`、引けなければ `-`）。省いた盤面は環境を見ない。 */
    env?: string;
    tags: readonly string[];
  }[];
  /** 生きたワーカーの担当 issue のうち、開いている一覧に載っていなかったものの `state`。 */
  issueStates?: Record<number, string>;
  /** PRごとの、そのPRを書いたセッション（コミットの `Claude-Session:` トレーラ）。 */
  prSessions?: Record<number, string>;
  taken?: Record<string, string>;
}

/**
 * 手が空いているセッションは、既定で**十分に空いたまま**として渡す（`board-move.mjs` の
 * `STALL_MINUTES`）。停滞を入口にする手はどれもそこを通るので、**盤面ごとに書くと、書き忘れた
 * 盤面だけが黙って手を出さなくなる。** 空いたばかりの形を見たい検査は、`taken` で上書きする。
 */
const LONG_IDLE = '2026-09-04T02:00:00Z';

/**
 * 掘り起こす係（`board-move.mjs` の `CYCLES` の `dig`）は、既定で**たった今立てた**ことにする。
 * あの係の `due` は**配れる「完成へ近づける仕事」が無いこと**（2.18.1）なので、**そういう task を
 * 置かなかった盤面には全部当たる**——既定のままだと、掘り起こしと関わりのない検査の期待値へ一律に
 * 1手増え、**その検査が何を見ているのかが読めなくなる。** 立つところを見る検査は、`taken` の
 * `cycle:dig` を古い時刻で上書きする。
 */
const DUG_JUST_NOW = { 'cycle:dig': NOW };

/**
 * 棚卸しの係も、**たった今立てた**ことにできる足場。あの係の `due` には**`kind:task` なのに
 * `goal:` が無いこと**が入った（2.17.1）ので、**取りこぼしを置いた盤面には必ず当たる**
 * ——向かう先そのものを見る検査の期待値へ、棚卸しを立てる手が1つ混ざる。
 */
const TRIAGED_JUST_NOW = { 'cycle:triage': NOW };

/** 掘り起こす係を立てる手。**上の既定を外した盤面はどれもこれを出す**ので、ここで名前を持つ。 */
const DIG = `CHORE dig .claude/dig-prompt.md ${NOW}`;

/**
 * 盤面を見回る係（`board-move.mjs` の `CYCLES` の `patrol`）も、既定で**たった今立てた**ことにする。
 * あの係の `due` は**常に真**（2.21.2）なので、**どの盤面にも当たる**——既定のままだと、見回りと
 * 関わりのない検査の期待値へ一律に1手増える。立つところを見る検査は `taken` で上書きする。
 */
const PATROLLED_JUST_NOW = { 'cycle:patrol': NOW };

/**
 * マージ済みPRの後片付け（`board-move.mjs` の `TIDY`）は、既定で**もう打った**ことにする。窓に載って
 * いるPRには全部当たるので、**既定のままだと、後片付けと関わりのない検査の期待値へ1手ずつ増える。**
 * 打つところを見る検査は `untidied` を立てる。
 */
function tidiedAlready(mergedPrs: readonly { number: number }[]): Record<string, string> {
  return Object.fromEntries(mergedPrs.map((merged) => [`tidy:${merged.number}`, NOW]));
}

function moves(board: Board): string[] {
  const idled: Record<string, string> = {};
  for (const session of board.sessions ?? []) {
    if (session.status !== 'SESSION_STATUS_RUNNING') idled[`idle:${session.id}`] = LONG_IDLE;
  }
  const tidied = board.untidied === true ? {} : tidiedAlready(board.mergedPrs ?? []);
  return decide({
    now: NOW,
    settledBefore: SETTLED,
    prs: [],
    issues: [],
    sessions: [],
    ...board,
    taken: { ...idled, ...tidied, ...DUG_JUST_NOW, ...PATROLLED_JUST_NOW, ...board.taken },
  });
}

/** 緑のPR。チェックが1本通っている形で作る（無検査のPRとは別の道を通るため）。 */
function pr(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    isDraft: false,
    labels: [],
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: NOW,
    headRefOid: 'aaa1111',
    body: `Closes #${number - 1}\n`,
    ...over,
  };
}

/**
 * ラベルの一覧。**`kind:task` を渡したら `goal:` も足す**——**配られる issue は必ず向かう先を持つ**
 * （`.claude/board-design.md` 2.17.1 の、棚卸しが出す結論）ので、持たない盤面のほうが例外。
 * 足さないと、向かう先と関わりのない検査の期待値へ一律に `NOTE` が1行増える（2.18.1）。
 *
 * **その例外を見る検査は、自分で `labels` を組む**（下の `unnamedTask`）。
 */
const label = (...names: string[]) => {
  const goalless = names.includes('kind:task') && !names.some((name) => name.startsWith('goal:'));
  return { labels: (goalless ? [...names, 'goal:upkeep'] : names).map((name) => ({ name })) };
};

/** 棚卸しの取りこぼし——配れる形なのに向かう先を名乗っていない issue（2.18.1）。 */
const unnamedTask = (number: number, ...extra: string[]) => ({
  number,
  labels: ['kind:task', ...extra].map((name) => ({ name })),
  blockedBy: { nodes: [] },
});
/**
 * 同じ番号の issue を閉じる、人のマージ待ちのPR（`通してよい` と `判断待ち` が並んだ形）。**盤面に
 * 打つ手は残っていない**——マージは `判断待ち` が止め（2.13）、書いた本人を起こす理由も無い。
 * 書いたセッションが枠を握ったまま止まる形は、これで作る。
 */
const pending = (number: number) =>
  pr(number, { body: `Closes #${number}\n`, ...label('通してよい', '判断待ち') });
/** レビューが書いた判定のコメント（`review-prompt.md` の書き方）。名乗る版を変えられる形で持つ。 */
const verdict = (version: string) => ({
  comments: [{ body: `[レビュー] 通してよい\n読んだ版: ${version}\n\n直しは要らない。\n` }],
});
/** 通したうえで人へ回す形の判定（2.13.4）。 */
const asked = (version: string) => ({
  comments: [
    {
      body: `[レビュー] 通してよい（人の判断が要る）\n読んだ版: ${version}\n\n倍率を足している。\n`,
    },
  ],
});
const working = (id: string, ...tags: string[]) => ({
  id,
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});
// **手が空いても `status_bucket` は `..._WORKING` のまま固まることがある**（board-design 1.6）ので、
// 手が空いている側はそちらを `..._WORKING` にして作る。ここを `..._COMPLETED` にすると、判定が
// bucket を見ていても試験が通ってしまう。
const idle = (id: string, ...tags: string[]) => ({
  id,
  status: 'SESSION_STATUS_IDLE',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});

describe('board-move.mjs', () => {
  it('結論のラベルが無い緑のPRは、レビューへ出す', () => {
    expect(moves({ prs: [pr(10)] })).toEqual(['REVIEW 10 aaa1111']);
  });

  it('通してよいが付いた緑のPRは、マージする', () => {
    expect(moves({ prs: [pr(10, label('通してよい'))] })).toEqual(['MERGE 10']);
  });

  it('マージはレビューより先に打つ', () => {
    expect(moves({ prs: [pr(10), pr(20, label('通してよい'))] })).toEqual(['MERGE 20', 'REVIEW 10 aaa1111']);
  });

  // ## マージ済みのPRの後片付け（2.10.4）
  //
  // **マージした手からは切り離してある。** 盤面はマージ済みのPRを見つけて打つので、**ユーザーが
  // 画面から入れたPRも同じ1回を通る。**
  it('マージ済みのPRは、誰が入れたかに関わらず後片付けする', () => {
    expect(moves({ untidied: true, mergedPrs: [{ number: 9 }] })).toEqual([`TIDY 9 ${NOW}`]);
  });

  // 窓（`MERGED_WINDOW_HOURS`）の幅ぶん同じPRが一覧に載り続けるので、覚えが無いと毎周打ち直す。
  it('後片付けを打ったPRには、二度打たない', () => {
    expect(moves({ mergedPrs: [{ number: 9 }] })).toEqual([]);
  });

  // 本体のチェックアウトは作業ツリー全部の共有先なので、片付けを後ろへ回すと**入る本数だけ古いまま**
  // になる（マージできるPRが並んでいる周は、片付く前に次が入る）。
  it('後片付けはマージより先に打つ', () => {
    const board = { untidied: true, mergedPrs: [{ number: 9 }], prs: [pr(10, label('通してよい'))] };
    expect(moves(board)).toEqual([`TIDY 9 ${NOW}`, 'MERGE 10']);
  });

  it('コンフリクトしていれば、通してよいが付いていてもマージしない', () => {
    const board = {
      prs: [pr(10, { ...label('通してよい'), mergeable: 'CONFLICTING' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:conflict:10:aaa1111']);
  });

  // まだ計算中。次の周には決まるので、何も打たずに待つ。
  it('mergeable が引けていない周は、マージしない', () => {
    expect(moves({ prs: [pr(10, { ...label('通してよい'), mergeable: 'UNKNOWN' })] })).toEqual([]);
  });

  // `main` が動くたびに全部のPRがここへ落ちる。`CONFLICTING` だけを弾く形にすると、その隙間の周が
  // コンフリクトしたままレビューへ出す（#1538 で実際に出た。board-design 2.12.2）。
  it('mergeable が引けていない周は、レビューへも出さない', () => {
    expect(moves({ prs: [pr(10, { mergeable: 'UNKNOWN' })] })).toEqual([]);
  });

  // **`mend` ではなく `look`。** 撮って貼る作業は差分を直す作業と違うので、渡す文面を分ける（1.3）。
  it('画面が変わるのに 見た目 が無ければ、レビューへ出さずに書いた本人へ差し戻す', () => {
    const board = {
      prs: [pr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa1111']);
  });

  it('画面が変わらないPRには、見た目 を求めない', () => {
    expect(moves({ prs: [pr(10, { files: [{ path: 'src/domain/Slot.ts' }] })] })).toEqual([
      'REVIEW 10 aaa1111',
    ]);
  });

  it('見た目 が書いてあればレビューへ出す', () => {
    const board = {
      prs: [
        pr(10, {
          files: [{ path: 'src/assets/cards/axe.webp' }],
          body: 'Closes #9\n\n## 見た目\n\n不要（絵の差し替えだけ）\n',
        }),
      ],
    };
    expect(moves(board)).toEqual(['REVIEW 10 aaa1111']);
  });

  // 節だけ置いて中身を書かない形。画像も「不要」＋理由も無いので、後から補えるものが差分に残らない。
  it('見た目 の節が空なら、無いのと同じに扱う', () => {
    const board = {
      prs: [
        pr(10, {
          files: [{ path: 'src/game/ui/Card.ts' }],
          body: 'Closes #9\n\n## 見た目\n\n## 自己点検\n\n0件。\n',
        }),
      ],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa1111']);
  });

  // 人の手番の印は、効き目を1つずつ持つ（2.13.2）。**どちらの下でも差し戻しは出る。**
  it('判断待ちのPRは、マージしない', () => {
    expect(moves({ prs: [pr(10, label('通してよい', '判断待ち'))] })).toEqual([]);
  });

  /**
   * **人が外してから `却下` が付くまでの窓**（2.13.5）。ラベルだけを見ると、この周は「止める印が
   * 何も無い緑のPR」に見える——**差し戻すつもりで外した操作が、そのまま取り消せないマージになる。**
   * 判定はコメントに残っていて、読んだ版も名乗ってあるので、そちらから読む。
   */
  it('判断待ちが外れていても、今の版の判定が人の判断を求めていればマージしない', () => {
    expect(moves({ prs: [pr(10, { ...label('通してよい'), ...asked('aaa1111') })] })).toEqual([]);
  });

  // **前の差分への判定は、今の差分を止めない**（2.13.4。周ごとに判定は変わりうる）。
  it('前の版で人の判断を求めていても、今の版の判定が通してよいならマージする', () => {
    const comments = [...asked('9990000').comments, ...verdict('aaa1111').comments];
    expect(moves({ prs: [pr(10, { ...label('通してよい'), comments })] })).toEqual(['MERGE 10']);
  });

  // **読んだ版の名乗りは書き忘れうる**（`review-prompt.md`）。どの版のものか言えない判定を数え
  // ないと、**その周だけ人へ回した判定が消えて、取り消せないマージになる**（2.13.5）。ラベルを
  // 付ける側（`board-labels.yml`）は1行目しか見ないので、名乗りが無くても `判断待ち` は付く。
  it('版を名乗っていなくても、人の判断を求める判定はマージを止める', () => {
    const comments = [{ body: '[レビュー] 通してよい（人の判断が要る）\n\n倍率を足している。\n' }];
    expect(moves({ prs: [pr(10, { ...label('通してよい'), comments })] })).toEqual([]);
  });

  // **逆に、読まれたかを見る側は数えない。** どの版を読んだのか言えないものを数えると、押した後の
  // 差分が二度と読まれない（2.13.5）。
  it('版を名乗っていない判定は、読まれた証拠にはしない', () => {
    const comments = [{ body: '[レビュー] 通してよい\n\n直しは要らない。\n' }];
    expect(moves({ prs: [pr(10, { comments })] })).toEqual(['REVIEW 10 aaa1111']);
  });

  it('判断待ちでも、コンフリクトは差し戻す', () => {
    const board = {
      prs: [pr(10, { ...label('判断待ち'), mergeable: 'CONFLICTING' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:conflict:10:aaa1111']);
  });

  it('収束せずのPRは、レビューへ出さない', () => {
    expect(moves({ prs: [pr(10, label('収束せず'))] })).toEqual([]);
  });

  it('収束せずでも、CIが赤ければ差し戻す', () => {
    const board = {
      prs: [
        pr(10, {
          ...label('収束せず'),
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
        }),
      ],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:red:10:aaa1111']);
  });

  // **`mend` ではなく `reject`。** レビューの指摘に答えるのではなく、ユーザーが何を通さなかったのかを
  // 読みに行く作業（`resume-prompt.md` の `## reject`）。
  it('却下のPRは、ユーザーの差し戻しとして起こす', () => {
    const board = {
      prs: [pr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa1111']);
  });

  // **人が外すのは1つずつ。** `判断待ち` と `収束せず` が並んだPRで片方だけ外せば、残ったほうは
  // 付いたまま `却下` が付く（2.13.1）。止めるのはマージとレビューで、差し戻しは止めない（2.13.2）。
  it('判断待ちが付いたままでも、却下は差し戻す', () => {
    const board = {
      prs: [pr(10, label('判断待ち', '却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa1111']);
  });

  // 枠は1つしか無いので、種類を指紋に入れないと後から来たほうが黙って落ちる。
  it('同じ差分でも、直しの後の却下は落とさない', () => {
    const board = {
      prs: [pr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:returned:10:aaa1111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa1111']);
  });

  // 差し戻す相手は、そのPRを書いたセッション（2.11）。**`Closes` では引かない**——あれは
  // どの issue が閉じるかの印であって、誰が書いたかを指していない。
  it('直し待ちのPRは、トレーラが指すセッションを起こす', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      // `task-9` を持つほうは `Closes #9` の相手。書いたのが誰かとは別なので、選ばれない。
      sessions: [idle('session_a'), idle('session_holder', 'task-9')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:returned:10:aaa1111']);
  });

  // **畳む合図を、他の手が起きることに繋がない。** マージのついでに掃いていたときは、人が画面から
  // マージしたPRのレビューが誰にも掃かれず残った（#1549）。
  it('走り終わったレビューのセッションを畳む', () => {
    expect(moves({ sessions: [idle('session_r', 'review-1549')] })).toEqual([
      'ARCHIVE session_r done:review-1549',
    ]);
  });

  // レビューは使い回さないので、判定を書いた時点で「もう誰も起こさない」。**そのPRがこの後どう
  // 流れるかは見ない**——見ると、閉じないPR（`収束せず`・`直し待ち` のまま）のぶんが永久に残る。
  it('PRが開いていても、判定を書き終えたレビューは畳む', () => {
    const board = {
      prs: [pr(1549, verdict('aaa1111'))],
      sessions: [idle('session_r', 'review-1549')],
      taken: { 'review:1549': 'aaa1111' },
    };

    expect(moves(board)).toContain('ARCHIVE session_r done:review-1549');
  });

  // **「走り終わった」と「道具の承認を待っている」は同じ形に見える**（1.6）。30秒で畳んだ盤面は、
  // 承認を求めて止まったレビューを判定を書く前に消し、そのPRを永久に止めた（PR #1573・issue #1569）。
  it('判定がまだ無いレビューは、手が止まったばかりなら畳まない', () => {
    const board = {
      prs: [pr(10)],
      sessions: [idle('session_a', 'review-10')],
      taken: { 'idle:session_a': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual(['REVIEW 10 aaa1111']);
  });

  // **窓が要るのは、終わったかを他に訊けないときだけ。** 判定を書いたかはPRのコメントに出る
  // （2.10.3）ので、在れば空いた直後でも畳んでよい——待たせるぶん、次の仕事の枠が空かない。
  it('判定を書き終えたレビューは、空いたばかりでも畳む', () => {
    const board = {
      prs: [pr(10, verdict('aaa1111'))],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': 'aaa1111', 'idle:session_r': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toContain('ARCHIVE session_r done:review-10');
  });

  // 開いている一覧から消えたPRのレビューは、判定を書いても置く先が無い。
  it('PRが閉じたレビューは、空いたばかりでも畳む', () => {
    const board = {
      sessions: [idle('session_r', 'review-10')],
      taken: { 'idle:session_r': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual(['ARCHIVE session_r done:review-10']);
  });

  // **判定は在るが、この周に投入したものではない。** 前の差分へ書かれた判定を今の差分の判定と
  // 読むと、押した直後のレビューを読み終わったことにして畳む。
  it('前の差分へ書かれた判定では、今のレビューを畳まない', () => {
    const board = {
      prs: [pr(10, verdict('9990000'))],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': 'aaa1111', 'idle:session_r': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).not.toContain('ARCHIVE session_r done:review-10');
  });

  // 結論のラベルを付けるのは `board-labels.yml` で、判定が書かれてから遅れて付く。その隙間で
  // 読み手だけが先に畳まれると、盤面には「読み手が居ないのにラベルも無い」と見える。
  it('判定を書き終えたPRへは、読み手がもう居なくてもレビューを立て直さない', () => {
    const board = { prs: [pr(10, verdict('aaa1111'))], taken: { 'review:10': 'aaa1111' } };
    expect(moves(board)).toEqual([
      'NOTE PR #10 は今の版の判定が書かれている（結論のラベルが付くのを待っている）',
    ]);
  });

  // **判定はコメントに残る。** 台帳が消えていても、人が結論のラベルを外していても同じで、
  // 読み終えた差分へもう1本立てる理由にはならない（2.13.5）。
  it('台帳に無くても、今の版の判定が書かれていればレビューを立てない', () => {
    expect(moves({ prs: [pr(10, verdict('aaa1111'))] })).toEqual([
      'NOTE PR #10 は今の版の判定が書かれている（結論のラベルが付くのを待っている）',
    ]);
  });

  /**
   * **畳む前に1回だけ起こす**（2.10.3）。畳めば次の周に新しい1本が立つ（2.12.4）が、読んだ
   * ところは畳んだ時点で消えるので、その1本は差分を読み直すところから始まる。
   */
  describe('判定を書かずに止まったレビューは、畳む前に起こす', () => {
    const stalling = (over: Record<string, string>) => ({
      prs: [pr(10)],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': 'aaa1111', ...over },
    });
    const READING = 'NOTE PR #10 はレビューが読んでいる最中で、結論のラベルはまだ無い';

    it('空いたままが続いたレビューを、1回だけ起こす', () => {
      expect(moves(stalling({}))).toEqual(['RESUME session_r review-stall 10 review-stall:10', READING]);
    });

    // **起こした合図が効くには時間が要る**（2.15.3 と同じ）。次の周（既定30秒）で畳むと、届く前に
    // 必ず消すことになり、起こした意味が無くなる。
    it('起こした直後は、まだ畳まない', () => {
      // 起こしたのは空いてから15分の時点。まだ20分しか経っていない。
      const board = stalling({
        'idle:session_r': '2026-09-05T01:40:00Z',
        'resume:session_r': 'review-stall:10',
      });
      expect(moves(board)).toEqual([READING]);
    });

    // 起こしても判定が出てこなければ、そこで畳む。**返す先は無い**ので（2.13.2）、次の周に
    // 新しい1本が立つ（2.12.4）。
    it('起こしても判定が出てこなければ、畳む', () => {
      const board = stalling({ 'resume:session_r': 'review-stall:10' });
      expect(moves(board)).toEqual(['ARCHIVE session_r done:review-10', READING]);
    });

    // **読んだ差分が動いていたら起こさない。** 書けるのは前の差分への判定で、`board-labels.yml` は
    // 判定の1行目しか読まないので、それが今の頭へ `通してよい` として付く——押された後のコミットを
    // 誰も読まないままマージされうる。畳めば、次の周に今の差分の1本が立つ。
    it('読んだ差分がもう頭でなければ、起こさずに畳む', () => {
      const board = stalling({ 'review:10': '9990000' });
      expect(moves(board)).toEqual(['ARCHIVE session_r done:review-10', 'REVIEW 10 aaa1111']);
    });

    /**
     * **指紋を `stall:` で始めない。** `trackIdle` は `stall:` で始まる覚えを動き出した時点で
     * 捨てる（ワーカーは再び空けばもう一度起こす側）ので、始めるとレビューも起こし直しになり、
     * 書けないレビューを毎周叩き続ける。2箇所が暗黙に一致すべき規約なので、ここで留める。
     */
    it('起こしたレビューの覚えは、動き出しても消えない', () => {
      const woke = 'review-stall:10';
      expect(moves(stalling({}))).toContain(`RESUME session_r review-stall 10 ${woke}`);

      const sessions = [working('session_r', 'review-10')];
      const kept = trackIdle({ 'resume:session_r': woke }, { sessions }, NOW);

      expect(kept['resume:session_r']).toBe(woke);
    });
  });

  // 周期の係には渡す文面が無い（`resume-prompt.md`）ので、起こさずに畳む。
  it('判定の書きようが無い周期の係は、起こさずに畳む', () => {
    expect(moves({ sessions: [idle('session_c', 'chore-triage')] })).toEqual([
      'ARCHIVE session_c done:chore-triage',
    ]);
  });

  it('走っているレビューは畳まない', () => {
    expect(moves({ sessions: [working('session_r', 'review-1549')] })).toEqual([]);
  });

  it('一度畳もうとして残されたレビューは、二度打たない', () => {
    const board = {
      sessions: [idle('session_r', 'review-1549')],
      taken: { 'archive:session_r': 'done:review-1549' },
    };

    expect(moves(board)).toEqual([]);
  });

  it('CIが赤いPRも、書いたセッションを起こす', () => {
    const board = {
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:red:10:aaa1111']);
  });

  const RED_MAIN = [{ status: 'COMPLETED', conclusion: 'FAILURE' }];
  const redPr = (number: number, over: Record<string, unknown> = {}) =>
    pr(number, { statusCheckRollup: RED_MAIN, ...over });

  // **`main` が赤いと、それを取り込んだPRは作業者が何をしても緑にならない**（2.14）。指紋は push の
  // たびに変わるので、止めないと押し返されるたびに新しい手として通り、差し戻しが終わらない。
  // 2026-09-05 に `main` の試験が Linux でだけ落ち、開いていたPRがこれで回りかけた。
  it('main が赤い間は、直しを頼まない', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10)],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['NOTE PR #10 はCIが赤いが、`main` が赤いので直しを頼まない']);
  });

  // 止めるのは `mend` だけ。**人の差し戻しも画面の証跡も、出た理由が `main` の色と関わらない**ので、
  // ここまで止めると `main` の赤が長引いた分だけ関係の無い手が遅れる。
  it('main が赤くても、却下は差し戻す', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa1111']);
  });

  it('main が赤くても、見た目 の欠けは差し戻す', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa1111']);
  });

  // **止めるのは赤と分かったときだけ。** 走っている最中を赤に含めると、`main` へ push が入るたびに
  // 差し戻しが数分止まる。
  it('main のCIが走っている間は、直しを頼む', () => {
    const board = {
      mainChecks: [{ status: 'IN_PROGRESS', conclusion: '' }],
      prs: [redPr(10)],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:red:10:aaa1111']);
  });

  // 起こしたセッションが何もせずに止まると、盤面は前の周と同じまま残る。
  it('同じ差分で一度起こした相手は、二度起こさない', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:returned:10:aaa1111' },
    };
    expect(moves(board)).toEqual([]);
  });

  // **コンフリクトとCIの赤は、PRの版が変わらないまま `main` が動いて生まれる。** `mend` の3つを
  // 1つの指紋へ束ねていたときは、先に別の理由で1回起こした版が二度と差し戻せず、**誰の手番でも
  // ないまま止まった**（2026-09-11、PR #1982。直し待ちで起こした後にコンフリクトした）。
  it('同じ版でも、直しの後に生まれたコンフリクトは差し戻す', () => {
    const board = {
      prs: [pr(10, { ...label('判断待ち'), mergeable: 'CONFLICTING' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:returned:10:aaa1111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:conflict:10:aaa1111']);
  });

  it('直しが push されたら、また起こす', () => {
    const board = {
      prs: [pr(10, { ...label('直し待ち'), headRefOid: 'bbb2222' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:returned:10:aaa1111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:returned:10:bbb2222']);
  });

  it('直している最中のセッションは起こさない', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      sessions: [working('session_a')],
    };
    expect(moves(board)).toEqual([]);
  });

  it('トレーラの指すセッションが畳まれていたら、打つ手が無いことを書き残す', () => {
    const board = { prs: [pr(10, label('直し待ち'))], prSessions: { 10: 'session_writer' } };
    expect(moves(board)).toEqual(['NOTE PR #10 は差し戻されたが、直す相手が畳まれている']);
  });

  // **名乗っていないPRは差し戻せない。** 規則の破れなので、直すのは人（2.11.2）。畳まれていた
  // ときと同じ文面にすると、人が手を入れるべき側が読めない。
  it('名乗っていないPRは、そうと分かる形で書き残す', () => {
    expect(moves({ prs: [pr(10, label('直し待ち'))] })).toEqual([
      'NOTE PR #10 は差し戻されたが、書いたセッションが名乗っていない',
    ]);
  });

  // `..._BLOCKED` は手番を終えて人へ問いを返した状態で、手は空いている（board-design 1.6 の実測）。
  // busy と読むと、その著者のPRのレビューが永久に出ない（#1541 が2時間止まった）。
  it('著者が人へ問いを返して止まっていても、レビューへ出す', () => {
    const board = {
      prs: [pr(10)],
      sessions: [
        {
          id: 'session_a',
          status: 'SESSION_STATUS_IDLE',
          bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
          tags: ['task-9'],
        },
      ],
    };
    expect(moves(board)).toEqual(['REVIEW 10 aaa1111']);
  });

  it('レビューが走っているPRは、二重に出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_r', 'review-10')] };
    expect(moves(board)).toEqual([]);
  });

  // 判定を書き終えたレビューが占有し続けると、次の差分のレビューが永久に止まる（1.2）。
  // 畳む手が先に出るので、次の1本は次の周（打つのは1周に1手）。
  it('前のレビューが書き終えていれば、畳んでから次のレビューを出す', () => {
    const board = {
      prs: [pr(10, verdict('9990000'))],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': '9990000' },
    };
    expect(moves(board)).toEqual(['ARCHIVE session_r done:review-10', 'REVIEW 10 aaa1111']);
  });

  it('著者が書いている最中のPRは、レビューへ出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_a', 'task-9')] };
    expect(moves(board)).toEqual([]);
  });

  // 読み手が手を止めているだけの間（道具の承認待ちなど）は、まだ読んでいる最中。
  it('出した差分を読み手がまだ持っているなら、二度出さない', () => {
    const board = {
      prs: [pr(10)],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': 'aaa1111', 'idle:session_r': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual(['NOTE PR #10 はレビューが読んでいる最中で、結論のラベルはまだ無い']);
  });

  // 指紋だけを見て「出した＝読まれた」と読むと、判定を書かずに終わったレビューがそのPRを永久に
  // 止める（issue #1569）。読み手が居なくなっていることが、その読みが終わった印。
  it('出した差分の読み手が居なくなっていれば、もう一度出す', () => {
    const board = { prs: [pr(10)], taken: { 'review:10': 'aaa1111' } };
    expect(moves(board)).toEqual([
      'REVIEW 10 aaa1111',
      'NOTE PR #10 のレビューは判定を書かずに終わったので、もう一度出す',
    ]);
  });

  it('チェックが1つも登録されていないPRは、落ち着くまで緑と読まない', () => {
    expect(moves({ prs: [pr(10, { statusCheckRollup: [], updatedAt: NOW })] })).toEqual([]);
    const still = '2026-09-05T00:30:00Z';
    expect(moves({ prs: [pr(10, { statusCheckRollup: [], updatedAt: still })] })).toEqual([
      'REVIEW 10 aaa1111',
    ]);
  });

  it('走っているチェックが残っていれば、まだ読まない', () => {
    const board = { prs: [pr(10, { statusCheckRollup: [{ status: 'IN_PROGRESS' }] })] };
    expect(moves(board)).toEqual([]);
  });

  // 積まれたPRのCIは古い base の上で緑になり、レビューの差分にも下のPRの変更が混ざる。下が入れば
  // GitHub が base を `main` へ張り替え、`tidy-merged-pr.sh` が書いた本人へ差し戻す。
  it('他のPRの上に積まれたPRは、緑でも触らない', () => {
    const board = { prs: [pr(10, { ...label('通してよい'), baseRefName: 'claude/issue-9' })] };
    expect(moves(board)).toEqual([
      'NOTE PR #10 は claude/issue-9 の上に積まれている（下が入るまで触らない）',
    ]);
  });

  it('下書きのPRには手を出さない', () => {
    expect(moves({ prs: [pr(10, { isDraft: true })] })).toEqual([]);
  });

  it('準備のできた issue を投入する', () => {
    const board = { issues: [{ number: 9, ...label('kind:task'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // 打つのは1周に1手なので、新しい順のまま回すと後から出たPRが毎周先に拾われる。
  it('捌く順は、古いPRから', () => {
    expect(moves({ prs: [pr(30), pr(9), pr(20)] })).toEqual([
      'REVIEW 9 aaa1111',
      'REVIEW 20 aaa1111',
      'REVIEW 30 aaa1111',
    ]);
  });

  // 一覧は新しい順に返る。そのまま使うと、古い issue が永久に後回しになる。
  it('投入する順は、古い issue から', () => {
    const ready = (number: number) => ({ number, ...label('kind:task'), blockedBy: { nodes: [] } });
    expect(moves({ issues: [ready(30), ready(9), ready(20)] })).toEqual(['TASK 9', 'TASK 20', 'TASK 30']);
  });

  // **`急ぎ` の効き目は順だけ**（2.18）。新しくても先に出る。
  it('急ぎ の付いた issue は、古いものより先に投入する', () => {
    const ready = (number: number) => ({ number, ...label('kind:task'), blockedBy: { nodes: [] } });
    const board = {
      issues: [ready(9), { number: 30, ...label('kind:task', '急ぎ'), blockedBy: { nodes: [] } }],
    };
    expect(moves(board)).toEqual(['TASK 30', 'TASK 9']);
  });

  // 全部に付けば「古いものから」に戻るだけ。**壊れる先が安全側に限られる**のが、順位を数で
  // 持たずに印1つで表す理由。
  it('急ぎ が全部に付いていれば、古い issue から', () => {
    const rush = (number: number) => ({
      number,
      ...label('kind:task', '急ぎ'),
      blockedBy: { nodes: [] },
    });
    expect(moves({ issues: [rush(30), rush(9), rush(20)] })).toEqual(['TASK 9', 'TASK 20', 'TASK 30']);
  });

  // ## 向かう先（2.18.1）
  //
  // **完成へ近づける仕事が、古い順より前に出る。** 掘り起こしたものは必ず最新なので、古い順だけで
  // 並べると、掘り起こした先から整備の在庫の最後尾へ回る。
  const upkeep = (number: number) => ({
    number,
    ...label('kind:task', 'origin:agent', 'goal:upkeep'),
    blockedBy: { nodes: [] },
  });
  const game = (number: number) => ({
    number,
    ...label('kind:task', 'origin:agent', 'goal:game'),
    blockedBy: { nodes: [] },
  });

  it('goal:game の issue は、それより古い goal:upkeep より先に投入する', () => {
    expect(moves({ issues: [upkeep(9), upkeep(20), game(30)] })).toEqual(['TASK 30', 'TASK 9', 'TASK 20']);
  });

  // **`急ぎ` は向かう先より強い**（2.18 の「効き目は配る順だけ」を、この軸の上でも保つ）。盤面
  // そのものが止まる整備は、これで越える。
  it('急ぎ の付いた goal:upkeep は、goal:game より先に投入する', () => {
    const rush = {
      number: 40,
      ...label('kind:task', 'origin:agent', 'goal:upkeep', '急ぎ'),
      blockedBy: { nodes: [] },
    };
    expect(moves({ issues: [game(9), rush] })).toEqual(['TASK 40', 'TASK 9']);
  });

  // **既定は無い**（2.18.1）。`goal:game` を名乗るものだけが先に出る——**立てた側の印
  // （`origin:agent`）からは推し量らない。** あれは誰が書き込んだかしか答えられず、棚卸しの分解で
  // 立つ子には必ず付くので、既定に使うと**人の仕事が分解された瞬間に整備へ落ちる。**
  it('goal: を名乗らない issue は、人が立てたものでも整備として並ぶ', () => {
    const board = { issues: [unnamedTask(9), game(30)], taken: TRIAGED_JUST_NOW };
    expect(moves(board)).toEqual([
      'TASK 30',
      'TASK 9',
      'NOTE 向かう先(`goal:`)の無い kind:task がある。整備として並ぶ: #9',
    ]);
  });

  // **配るのは止めない**（2.18.1）。止めると、取りこぼし1件で盤面が静かに詰まる。
  it('向かう先を名乗らない kind:task は、配ったうえで覚え書きに挙げる', () => {
    const board = {
      issues: [unnamedTask(9), unnamedTask(20, 'origin:agent')],
      taken: TRIAGED_JUST_NOW,
    };
    expect(moves(board)).toEqual([
      'TASK 9',
      'TASK 20',
      'NOTE 向かう先(`goal:`)の無い kind:task がある。整備として並ぶ: #9 #20',
    ]);
  });

  // **取りこぼしを直す者を呼ぶ**（2.17.1）。`kind:` の有無だけを入口にしていたら、`kind:` が付いた
  // 時点で issue が棚卸しの視界から消え、後から足した `goal:` の取りこぼしを拾う者が居なくなる。
  it('向かう先を名乗らない kind:task があれば、棚卸しの係を立てる', () => {
    expect(moves({ issues: [unnamedTask(9)] })).toContain(`CHORE triage .claude/triage-prompt.md ${NOW}`);
  });

  // 順を変えるだけで、配ってよいかは変えない（1.3）。
  it('急ぎ でも、判断待ちなら配らない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', '急ぎ', '判断待ち'), blockedBy: { nodes: [] } }],
    };
    expect(moves(board)).toEqual([]);
  });

  it('開いている issue に塞がれている間は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task'), blockedBy: { nodes: [{ state: 'OPEN' }] } }],
    };
    expect(moves(board)).toEqual([]);
  });

  it('PRの出ている issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task'), blockedBy: { nodes: [] } }],
      // レビューへ出る側の手は別の試験で見ているので、ここでは投入が出ないことだけを見る。
      prs: [pr(10, label('収束せず'))],
    };
    expect(moves(board)).toEqual([]);
  });

  // **並べてよいかは、錠と本数で決める**（3.1・`parallel-work.md` 2節）。**同じファイルを書くことは
  // 止めない**——ぶつかったら `mend` で直させ、実績は `board-round.mjs` が控える。
  it('錠を持たない issue は、隣が走っていても並べて投入する', () => {
    const board = {
      issues: [
        { number: 9, ...label('kind:task'), blockedBy: { nodes: [] } },
        { number: 8, ...label('kind:task'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // **錠が指すのは、同時に1本しか動かせない資源**（`parallel-work.md` 2節）。触るファイルが
  // 分かれていても、GPUやデーモンの実体は1本しか使えない。
  //
  // **黙って止めない。** `stall` は指紋で1回しか出ないので、起こしても動かないセッションが1本
  // 残ると TASK が永久に出ない。ログに何も出ないと「やることが無い周」と見分けが付かない。
  it('同じ area: の錠を取り合う issue は投入せず、何を取り合うかを書く', () => {
    const board = {
      issues: [
        { number: 9, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } },
        { number: 8, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual([
      'NOTE 1件の task が待っている。先頭は #9 と #8 が `area:daemon` を取り合う',
    ]);
  });

  it('錠が違えば、走っている隣へ並べて投入する', () => {
    const board = {
      issues: [
        { number: 9, ...label('kind:task', 'area:art'), blockedBy: { nodes: [] } },
        { number: 8, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // 掴んでいる issue が開いている一覧に無ければ、錠が読めない。**知らないことを「取り合わない」
  // として読まない。**
  it('走っているセッションの担当が読めなければ、錠を持つ issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'area:art'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'OPEN' },
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が待っている。先頭は session_a の担当（#8）が読めない']);
  });

  // **担当が閉じていても、走っている限り資源は掴んだまま。** 本数の勘定からは外すが（走行中は
  // 畳めないので、待つと枠が空かない）、錠の側で外すと**同じ資源を2本が取り合う**。
  it('担当の閉じたセッションが走っている間も、錠を持つ issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'area:art'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が待っている。先頭は session_a の担当（#8）が読めない']);
  });

  // **上限は錠とは別の手綱**（3.1）。錠を持たない issue はいくらでも並ぶので、ここでしか止まらない。
  it('手の動いている作業者が上限まで居れば、錠が無くても投入しない', () => {
    const board = {
      issues: [6, 7, 8, 9].map((number) => ({
        number,
        ...label('kind:task'),
        blockedBy: { nodes: [] },
      })),
      sessions: [
        working('session_a', 'task-6'),
        working('session_b', 'task-7'),
        working('session_c', 'task-8'),
      ],
    };
    expect(moves(board)).toEqual([
      'NOTE 1件の task が、手の動いている作業者の枠（session_a session_b session_c）の空きを待っている',
    ]);
  });

  // **立てた直後のセッションも、手が動いている側で数える**（`stillWorking`）。走り出すまでは
  // `SESSION_STATUS_RUNNING` にならないので、走っているかだけで数えると**枠が空いて見えた周に
  // もう1本立ち、動く数が上限を越える。**
  it('立てた直後でまだ走り出していないセッションも、動いている側に数える', () => {
    const board = {
      issues: [6, 7, 8, 9].map((number) => ({
        number,
        ...label('kind:task'),
        blockedBy: { nodes: [] },
      })),
      sessions: [working('session_a', 'task-6'), working('session_b', 'task-7'), idle('session_c', 'task-8')],
      // この周に空いたばかり（`board-round.mjs` の `trackIdle` が、初めて見た周の時刻を書く）。
      taken: { 'idle:session_c': NOW },
    };
    expect(moves(board)).toEqual([
      'NOTE 1件の task が、手の動いている作業者の枠（session_a session_b session_c）の空きを待っている',
    ]);
  });

  // **抱えている数と、手が動いている数は別の量**（3.1）。人の判断を待って止まっているセッションは
  // 前者だけを埋めるので、**1つの数で兼ねると、待っているPRが溜まった時点で手が1本も動いていなくても
  // 投入が止まる**（issue #1750）。
  it('判断待ちのPRを抱えたセッションが動く数の上限を越えて居ても、手が空いていれば投入する', () => {
    const holders = [5, 6, 7, 8];
    const board = {
      issues: [...holders, 9].map((number) => ({
        number,
        ...label('kind:task'),
        blockedBy: { nodes: [] },
      })),
      prs: holders.map((number) => pending(number)),
      sessions: holders.map((number) => idle(`session_${number}`, `task-${number}`)),
    };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // 抱えている側の上限。**手が動いていなくても、ここに達したら投入は止まる**——起こす相手も畳む
  // 相手も居ないまま、担当だけが際限なく増えるのを止める。
  it('抱えているタスクが上限まで溜まったら、手が空いていても投入しない', () => {
    const holders = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const board = {
      issues: [...holders, 9].map((number) => ({
        number,
        ...label('kind:task'),
        blockedBy: { nodes: [] },
      })),
      prs: holders.map((number) => pending(number)),
      sessions: holders.map((number) => idle(`session_${number}`, `task-${number}`)),
    };
    const who = holders.map((number) => `session_${number}`).join(' ');
    expect(moves(board)).toEqual([`NOTE 1件の task が、抱えているタスクの枠（${who}）の空きを待っている`]);
  });

  // 走らせる先は issue のラベルにある（2.16）。盤面は投入先を引数の形で寄越し、`board-round.mjs`
  // はそれをそのまま `dispatch-task.sh` へ渡す。
  it('env:bridge の issue は、ブリッジへ投入する', () => {
    const board = { issues: [{ number: 9, ...label('kind:task', 'env:bridge'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['TASK 9 --bridge']);
  });

  // **既定へ落とさない。** 落とすと、そこでしかできないから宛先を書いた仕事が黙って別の場所で
  // 走り、指定が無視されたことが誰にも残らない（2.16.1）。
  it('知らない env: の issue は配らず、覚え書きを出す', () => {
    const board = { issues: [{ number: 9, ...label('kind:task', 'env:mars'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['NOTE issue #9 の `env:mars` は知らない宛先']);
  });

  it('env: が重ねて付いた issue も配らない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:bridge', 'env:cloud'), blockedBy: { nodes: [] } }],
    };
    expect(moves(board)).toEqual(['NOTE issue #9 に `env:` が重ねて付いている']);
  });

  // クラウドで走り出した後に `env:bridge` が付いたら、そこはもうこの仕事の場所ではない（2.16.2）。
  // 畳めば枠が空き、次の周が正しい先で立て直す。
  it('走らせる先が食い違ったワーカーは畳む', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a moved:9']);
  });

  it('走らせる先が合っているワーカーは畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'bridge' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **知らないことを「違う」として読まない。** 引けなかった環境を食い違いと読むと、正しく走って
  // いるセッションが落ちる。
  it('環境を引けなかったワーカーは畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: '-' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **回すのはクラウドのセッションだけ。** `env:` の付かない issue をブリッジで走らせる形は実在
  // する（手元からの投入）ので、既定の `cloud` との食い違いがそのまま当たり、手元で
  // 走っているワーカーが片端から畳まれてクラウドへ立て直される。
  it('ブリッジのワーカーは、走らせる先が食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'bridge' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **PRを出した後は動かさない**（2.16.2）。畳むと、そのPRの直しを頼む相手が居なくなる。
  it('PRを出した後のワーカーは、走らせる先が食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:bridge'), blockedBy: { nodes: [] } }],
      prs: [pr(10, label('収束せず'))],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual([]);
  });

  // 畳んでも次の周は投入で止まるので、枠を空ける意味が無い（2.16.2）。
  it('配り直す先が無ければ、食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'env:mars'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // 走っているセッションが持っている issue は「投入済み」なので、待ちにも数えない（1.2）。
  it('走っているセッションが持つ issue しか無ければ、黙る', () => {
    const board = {
      issues: [{ number: 8, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual([]);
  });

  it('PRを出さないまま手が空いたセッションを、1回だけ起こす', () => {
    const board = {
      issues: [{ number: 8, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 8 stall:8']);
  });

  // 起こしても何も出てこなければ、そこで人へ返す（2.15.3）。返した後は、同じセッションへも
  // その issue へも手を出さない——指紋の枠は1つなので、`stall:` を `returned:` が上書きする。
  it('起こしても動かないセッションの仕事を、人へ返す', () => {
    const board = {
      issues: [{ number: 8, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      taken: { 'idle:session_a': LONG_IDLE, 'resume:session_a': 'stall:8' },
    };
    expect(moves(board)).toEqual(['RETURN 8 session_a returned:8']);
    expect(
      moves({ ...board, taken: { 'idle:session_a': LONG_IDLE, 'resume:session_a': 'returned:8' } }),
    ).toEqual([]);
  });

  /**
   * **「手が空いている」ことそのものは停滞ではない。** ワーカーは手番の切れ目ごとに空き、下請けの
   * レビューを待つ間も空いて見える（1.6）。1度見ただけで停滞と読んだ盤面は、押し切る寸前の作業を
   * 人へ返して畳んだ（2026-09-06、issue #1506。`staging ready to push` のまま返却された）。
   */
  describe('空いていることではなく、空いたままであることを見る', () => {
    const stalling = (over: Record<string, string>) => ({
      issues: [{ number: 8, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      taken: over,
    });

    it('空いたばかりのワーカーは起こさない', () => {
      // NOW の1分前。
      expect(moves(stalling({ 'idle:session_a': '2026-09-05T01:59:00Z' }))).toEqual([]);
    });

    // **覚えが無いのは「ずっと空いている」ではない。** 台帳が消えた直後もここへ来るので、
    // 動かない側へ倒す（打つ手はどちらも取り返しが付かない）。上の既定を通さずに直に渡すので、
    // **読んで数えるだけの係は立つ**——覚えが無いのは「まだ一度も立てていない」でもあり、
    // 取り返しの付く手なので倒す先が逆になる。
    it('空いてからの長さが分からなければ、停滞の手は打たない', () => {
      const board = stalling({});
      expect(decide({ now: NOW, settledBefore: SETTLED, prs: [], ...board })).toEqual([PATROL, DIG]);
    });

    // **起こした合図が効くには時間が要る。** 次の周（既定30秒）で見限ると、届く前に必ず返す。
    it('起こした直後は、まだ人へ返さない', () => {
      // 起こしたのは空いてから15分の時点。まだ20分しか経っていない。
      const board = stalling({
        'idle:session_a': '2026-09-05T01:40:00Z',
        'resume:session_a': 'stall:8',
      });
      expect(moves(board)).toEqual([]);
    });
  });

  // 返ってきた issue は、人が `判断待ち` を外すまで誰にも配らない（2.15.2）。**`kind:task` は
  // 付いたまま**なので、この判定が抜けると次の周にそのまま投入し直される。
  it('`判断待ち` の付いた `kind:task` の issue は配らない', () => {
    expect(
      moves({ issues: [{ number: 8, ...label('kind:task', '判断待ち'), blockedBy: { nodes: [] } }] }),
    ).toEqual([]);
  });

  // 返した issue を担当していたワーカーは、畳んでよい（2.10）。閉じたときと指紋を分けるのは、
  // ログから畳んだ理由が読めるようにするため。
  it('返された issue を担当していたワーカーを畳む', () => {
    const board = {
      issues: [{ number: 8, ...label('kind:task', '判断待ち'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a returned:8']);
    expect(moves({ ...board, taken: { 'archive:session_a': 'returned:8' } })).toEqual([]);
  });

  it('issue が閉じていれば、手が空いていても起こさない', () => {
    expect(moves({ sessions: [idle('session_a', 'task-8')] })).toEqual([]);
  });

  // 畳む条件は担当の issue が閉じたことで、PRがマージされたかとは別（2.10）。畳まなかったという
  // 答えは issue が閉じているかぎり変わらないので、指紋を打った後は出さない。
  it('担当の issue が閉じたワーカーを畳む', () => {
    const board = {
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a closed:8']);
    expect(moves({ ...board, taken: { 'archive:session_a': 'closed:8' } })).toEqual([]);
  });

  it('まだ手が動いているワーカーは、issue が閉じていても畳まない', () => {
    const board = {
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual([]);
  });

  // 畳むのはマージの次。後ろへ回すと、終わったワーカーが枠を握ったまま TASK が出ない周が続く。
  it('畳む手は、マージの次・投入の前に打つ', () => {
    const board = {
      prs: [pr(10, label('通してよい'))],
      issues: [{ number: 20, ...label('kind:task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['MERGE 10', 'ARCHIVE session_a closed:8', 'TASK 20']);
  });

  // **盤面が出す語が、そのまま起こす文面の節名になる**（`resume-session.sh`）。2箇所が暗黙に
  // 一致すべき規約なので、片方だけ足したときにここで落とす——足りないと `resume-session.sh` が
  // 「ひな形に節が無い」で失敗し、**起こす手だけが毎周打てないまま残る。**
  it('起こす手の種類には、渡す文面の節がある', () => {
    const boards: Board[] = [
      { prs: [pr(10, label('直し待ち'))], prSessions: { 10: 'a' }, sessions: [idle('a')] },
      { prs: [pr(10, label('却下'))], prSessions: { 10: 'a' }, sessions: [idle('a')] },
      {
        prs: [pr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
        prSessions: { 10: 'a' },
        sessions: [idle('a')],
      },
      {
        issues: [{ number: 9, ...label('kind:task'), blockedBy: { nodes: [] } }],
        sessions: [idle('a', 'task-9')],
      },
      { prs: [pr(10)], sessions: [idle('a', 'review-10')], taken: { 'review:10': 'aaa1111' } },
    ];
    const kinds = boards
      .flatMap(moves)
      .filter((move) => move.startsWith('RESUME '))
      .map((move) => move.split(' ')[2]);
    expect(kinds).toEqual(['mend', 'reject', 'look', 'stall', 'review-stall']);

    const template = readFileSync(resolve(__dirname, '../../.claude/resume-prompt.md'), 'utf-8');
    for (const kind of kinds) expect(template).toContain(`\n## ${kind} `);
  });

  // ## 周期で起きる係（2.17）
  //
  // 未整理は `kind:` を1つも持たないことで表す（2.17.1）。**分類の綴りを増やしても、ここは
  // 書き換わらない**——「`task` でも `meta` でも無い」で書いていたときは、出口が増えるたびに
  // 条件を足す必要があった。
  const unsorted = (number: number) => ({ number, labels: [], blockedBy: { nodes: [] } });
  const TRIAGE = `CHORE triage .claude/triage-prompt.md ${NOW}`;
  const ANALYSIS = `CHORE analysis .claude/analysis-prompt.md ${NOW}`;
  const POLICY = `CHORE policy .claude/policy-cycle-prompt.md ${NOW}`;
  const TREND = `CHORE trend .claude/analysis-trend-prompt.md ${NOW}`;
  /** 盤面を見回る係（2.21）。**このPCでしか調べられない**ので、宛先が付く。 */
  const PATROL = `CHORE patrol .claude/patrol-prompt.md ${NOW} --bridge`;

  /** レビュアーがスメルを残した判定コメント（`review-criteria.md`「挙げ方」）。読んだ印を変えられる形で持つ。 */
  const smell = (number: number, read = false) => ({
    number,
    comments: [
      {
        body: `[レビュー] 通してよい\n読んだ版: aaa1111\n\n[スメル] 名前が中身とずれている。\n`,
        reactionGroups: read ? [{ content: 'EYES', users: { totalCount: 1 } }] : [],
      },
    ],
  });

  it('未整理の issue があれば、棚卸しを立てる', () => {
    expect(moves({ issues: [unsorted(9)] })).toEqual([TRIAGE]);
  });

  it('分類の付いた issue しかなければ、棚卸しは立てない', () => {
    const board = { issues: [{ number: 9, ...label('kind:board'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual([]);
  });

  it('棚卸しが走っている間は、もう1本立てない', () => {
    const board = { issues: [unsorted(9)], sessions: [working('session_c', 'chore-triage')] };
    expect(moves(board)).toEqual([]);
  });

  // 手が止まったばかりは「終わった」ではない（1.6）。畳む側と同じ窓を使う。
  it('手が止まったばかりの棚卸しも、終わったとは読まない', () => {
    const board = {
      issues: [unsorted(9)],
      sessions: [idle('session_c', 'chore-triage')],
      taken: { 'idle:session_c': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual([]);
  });

  // 畳む手は次の周まで出ないので、「生きているか」で見ていると、終わった1本が畳まれるまでの
  // あいだ次の周期を塞ぐ。
  it('走り終わった棚卸しが畳まれずに残っていても、次の周期は立つ', () => {
    const board = { issues: [unsorted(9)], sessions: [idle('session_c', 'chore-triage')] };
    expect(moves(board)).toContain(TRIAGE);
  });

  // 引き金は件数ではなく時間（2.17）。**件数のしきい値は「そこまでは残ってよい」の宣言になる。**
  it('前に立ててから間隔が空くまで、棚卸しは立てない', () => {
    const board = { issues: [unsorted(9)], taken: { 'cycle:triage': '2026-09-04T15:00:00Z' } };
    expect(moves(board)).toEqual([]);
  });

  // 前に立ててから11時間では立たず、13時間で立つ。**この2件で間隔そのものを留めている**ので、
  // `CYCLES` の `hours` を動かすと落ちる。
  it('間隔が空いたら、棚卸しをもう一度立てる', () => {
    const board = { issues: [unsorted(9)], taken: { 'cycle:triage': '2026-09-04T13:00:00Z' } };
    expect(moves(board)).toEqual([TRIAGE]);
  });

  // 急ぐ仕事ではないうえ、間隔が満ちている限り次の周でも同じ手が出る。先に置くと、待っている
  // 直しやレビューを1周ぶん押しのけるだけになる。
  it('周期の係は、投入より後に打つ', () => {
    const board = {
      issues: [unsorted(9), { number: 10, ...label('kind:task'), blockedBy: { nodes: [] } }],
    };
    expect(moves(board)).toEqual(['TASK 10', TRIAGE]);
  });

  // PRを出さないので、マージの列には並ばない。数えると書く側の並列度が黙って下がる。
  it('周期の係は、書くセッションの枠を待たない', () => {
    const held = (number: number) => ({ number, ...label('kind:task'), blockedBy: { nodes: [] } });
    const board = {
      issues: [unsorted(9), held(1), held(2), held(3)],
      sessions: [working('a', 'task-1'), working('b', 'task-2'), working('c', 'task-3')],
    };
    expect(moves(board)).toContain(TRIAGE);
  });

  it('手が空いたままの周期の係は、レビューと同じく畳む', () => {
    expect(moves({ sessions: [idle('session_c', 'chore-triage')] })).toEqual([
      'ARCHIVE session_c done:chore-triage',
    ]);
  });

  it('走っている周期の係は畳まない', () => {
    expect(moves({ sessions: [working('session_c', 'chore-triage')] })).toEqual([]);
  });

  // 手に載る綴りは上の試験が押さえるので、ここが見るのは**その先にファイルがあり、
  // `dispatch-chore.sh` が要る2つを持っていること**。片方でも欠けると、係は毎周立とうとして
  // 毎周失敗する（時刻を残さないので、間隔で黙りもしない）。
  it('周期の係のプロンプトは、題と囲みを持つ', () => {
    for (const move of [TRIAGE, ANALYSIS, POLICY, DIG, PATROL]) {
      const text = readFileSync(resolve(__dirname, '../..', move.split(' ')[2]), 'utf-8');
      expect(text).toMatch(/^題: \S/m);
      expect(text).toMatch(/^````$/m);
    }
  });

  // ## 盤面を見回る係（2.21）
  //
  // **立てるのはデーモン自身**なので、この手が出たこと自体が「デーモンは生きている」の証拠になる
  // ——落ちた跡から起こす係（2.19）とは、立つ条件が背反。二重に手を出す形は、錠ではなくここで消える。
  //
  // **印で絞らない**（2.21.2）。絞る条件は既に知っている壊れ方の一覧でしかなく、**手が1つも出ない
  // 周**はどの印にも掛からなかった（#1939 で2時間11分）。**盤面がどう見えていようと立つ**ことを、
  // 次の3つが留める——健全な盤面・打つ手が在る盤面・手が1つも出ない盤面。
  it('健全な盤面でも、間隔が空いていれば見回る係を立てる', () => {
    expect(moves({ taken: { 'cycle:patrol': '2026-09-05T00:30:00Z' } })).toEqual([PATROL]);
  });

  it('前に立ててから間隔が空くまで、見回る係は立てない', () => {
    expect(moves({ taken: { 'cycle:patrol': '2026-09-05T01:30:00Z' } })).toEqual([]);
  });

  // **手が1つも出ない周**（錠で全部の task が待たされ、差し戻す相手も居ない）。**転んだ手が無いので
  // 印には掛からない**形で、これが 2026-09-11 に2時間11分止まった形（#1939）。
  it('手が1つも出ない周でも、見回る係は立つ', () => {
    const board = {
      issues: [
        { number: 9, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } },
        { number: 10, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-9')],
      taken: { 'cycle:patrol': '2026-09-05T00:30:00Z' },
    };

    expect(moves(board)).toEqual([
      PATROL,
      'NOTE 1件の task が待っている。先頭は #10 と #9 が `area:daemon` を取り合う',
    ]);
  });

  // **並びの先頭に置く**（2.21.3）。1周1手で切り上げるので、他の周期の係と同じ最後尾に置くと、
  // **転ばずに打てる手が毎周1つでも在るかぎり手番が回らない**——投入だけが通らない盤面で、
  // 片付けやマージは通り続ける形がまさにそれ。
  it('他に打てる手が在っても、見回る係を先に置く', () => {
    const board = {
      untidied: true,
      mergedPrs: [{ number: 9 }],
      prs: [pr(10, label('通してよい'))],
      taken: { 'cycle:patrol': '2026-09-05T00:30:00Z' },
    };

    expect(moves(board)).toEqual([PATROL, `TIDY 9 ${NOW}`, 'MERGE 10']);
  });

  // **錠を取らない**（2.21.3）。`area:daemon` を握ったまま止まっているセッションが在ることは
  // 詰まりの典型なので、要求すると**詰まっているときほど立てない**。上の「手が1つも出ない周」が
  // まさにその盤面で、あそこで立つことがこの決めごとの現物。**逆向きも留める**——毎回立つ係が錠を
  // 持つと、間隔ごとに `area:daemon` の task が投入されなくなる。
  it('見回る係が走っていても、`area:daemon` の task は投入できる', () => {
    const board = {
      issues: [{ number: 9, ...label('kind:task', 'area:daemon'), blockedBy: { nodes: [] } }],
      sessions: [working('session_c', 'chore-patrol')],
    };

    expect(moves(board)).toEqual(['TASK 9']);
  });

  // ## スメルを拾う係（4.4）
  //
  // 仕事の在り処が issue ではなく**マージ済みPRのコメント**にある係。読んだ印はコメントに付いた
  // リアクションで、自前の台帳は持たない。
  it('読まれていないスメルがあれば、分析係を立てる', () => {
    expect(moves({ mergedPrs: [smell(9)] })).toEqual([ANALYSIS]);
  });

  it('印の付いたコメントのスメルでは、分析係を立てない', () => {
    expect(moves({ mergedPrs: [smell(9, true)] })).toEqual([]);
  });

  // GraphQL は**誰も押していない種類も組として返す**。種類の一致だけで読むと、どのコメントも
  // 「読んだ」になり、この係は一度も立たない（失敗の出方が「何も起きない」なので気づけない）。
  it('印の組はあっても、押した人が居なければ読まれていない', () => {
    const merged = [
      {
        number: 9,
        comments: [
          {
            body: '[スメル] 名前が中身とずれている。\n',
            reactionGroups: [{ content: 'EYES', users: { totalCount: 0 } }],
          },
        ],
      },
    ];
    expect(moves({ mergedPrs: merged })).toEqual([ANALYSIS]);
  });

  // 判定だけのコメントは拾う対象ではない。**`[スメル] ` の行を持つものだけ**が仕事になる。
  it('スメルの行が無いコメントでは、分析係を立てない', () => {
    const merged = [{ number: 9, comments: [{ body: '[レビュー] 通してよい\n読んだ版: aaa1111\n' }] }];
    expect(moves({ mergedPrs: merged })).toEqual([]);
  });

  // 開いているPRのスメルは、次の周のレビューや直しで消えることがある。拾うと二重になる。
  // **同じコメントをマージ済みの側へ置けば立つ**ことを並べて見る——並べないと、`mergedPrs` を
  // 渡していないだけの盤面になり、`prs` に何を入れても通ってしまう。
  it('開いているPRにスメルがあっても、分析係は立てない', () => {
    expect(moves({ mergedPrs: [smell(9)] })).toContain(ANALYSIS);

    const open = { prs: [pr(9, { ...label('直し待ち'), ...smell(9) })], prSessions: { 9: 'session_a' } };
    expect(moves(open)).not.toContain(ANALYSIS);
  });

  // PRを出す係が居る（記録を残すのがこの係の成果）。畳むと、指摘やコンフリクトを直す相手が消える
  // ——差し戻す先はコミットのトレーラで引く1本だけ（2.11）。
  it('自分のPRが開いている間は、周期の係を畳まない', () => {
    const board = {
      prs: [pr(10)],
      prSessions: { 10: 'session_c' },
      sessions: [idle('session_c', 'chore-analysis')],
    };
    expect(moves(board)).not.toContain('ARCHIVE session_c done:chore-analysis');
  });

  // 引くのは**自分が書いたPR**（トレーラ。2.11）で、開いているPRがあることではない。
  it('開いているPRが他人のものなら、周期の係は畳む', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_c', 'chore-analysis'), working('session_a')],
    };
    expect(moves(board)).toContain('ARCHIVE session_c done:chore-analysis');
  });

  // ## 価値観を畳む係（2.17.2）
  //
  // 仕事の在り処が issue でもPRでもなく**リポジトリの中**（`.claude/decisions/`）にある係。盤面が
  // GitHub と CCR の外を見るのはここだけで、数えるのは `board-read.mjs`。
  it('棚卸しを通っていない履歴があれば、価値観を畳む係を立てる', () => {
    expect(moves({ pendingDecisions: 1 })).toEqual([POLICY]);
  });

  it('履歴が全部 archive へ入っていれば、価値観を畳む係は立てない', () => {
    expect(moves({ pendingDecisions: 0 })).toEqual([]);
  });

  // **間隔は週1回**（2.17。履歴が増えるのはユーザーと直接話したときだけで、束ねるには溜まって
  // いる必要がある）。**他の係と同じ一日では立たない**ことまで見る——2日空いた盤面を渡すので、
  // 間隔を一日に縮めるとここが赤くなる。
  it('前に立ててから週が明けるまで、価値観を畳む係は立てない', () => {
    const board = { pendingDecisions: 3, taken: { 'cycle:policy': '2026-09-03T02:00:00Z' } };
    expect(moves(board)).toEqual([]);
  });

  it('週が明けたら、価値観を畳む係をもう一度立てる', () => {
    const board = { pendingDecisions: 3, taken: { 'cycle:policy': '2026-08-29T01:00:00Z' } };
    expect(moves(board)).toEqual([POLICY]);
  });

  // ## 回をまたぐ形を見る係（2.17.4）
  //
  // 一次の分析係が回ごとに書いた記録を横断して読む二次の係。仕事の在り処は価値観を畳む係と同じく
  // **リポジトリの中**（`.claude/analysis/`）で、数えるのは `board-read.mjs`。
  it('二次がまだ読んでいない分析の記録があれば、回をまたぐ形を見る係を立てる', () => {
    expect(moves({ unsummarizedAnalyses: 1 })).toEqual([TREND]);
  });

  it('分析の記録を二次が全部読んでいれば、回をまたぐ形を見る係は立てない', () => {
    expect(moves({ unsummarizedAnalyses: 0 })).toEqual([]);
  });

  // **間隔は週1回**（2.17.4。一次は1日1回なので、1本で7回ぶんが読める）。**他の係と同じ一日では
  // 立たない**ことまで見る——2日空いた盤面を渡すので、間隔を一日に縮めるとここが赤くなる。
  it('前に立ててから週が明けるまで、回をまたぐ形を見る係は立てない', () => {
    const board = { unsummarizedAnalyses: 3, taken: { 'cycle:trend': '2026-09-03T02:00:00Z' } };
    expect(moves(board)).toEqual([]);
  });

  it('週が明けたら、回をまたぐ形を見る係をもう一度立てる', () => {
    const board = { unsummarizedAnalyses: 3, taken: { 'cycle:trend': '2026-08-29T01:00:00Z' } };
    expect(moves(board)).toEqual([TREND]);
  });

  // ## 掘り起こす係（2.17）
  //
  // 仕事の在り処が**盤面の空きそのもの**にある係。配れる「完成へ近づける仕事」が尽きた周に立ち
  // （2.18.1）、完成の定義に照らして残りを数える。**上の既定（`DUG_JUST_NOW`）を外した盤面だけが
  // 立てる**ので、ここは `cycle:dig` を古い時刻で上書きして見る。
  const DUG_YESTERDAY = { 'cycle:dig': '2026-09-04T01:00:00Z' };
  it('配れる kind:task が無ければ、掘り起こす係を立てる', () => {
    expect(moves({ taken: DUG_YESTERDAY })).toEqual([DIG]);
  });

  // **配れないだけの周は出番ではない。** 枠が満ちているのも錠を取り合っているのも、配る先が
  // 空くまでの話で、掘り起こしても盤面は動かない（`ready` が空であることだけを見る理由）。
  it('枠が満ちて配れないだけなら、掘り起こす係は立てない', () => {
    const board = {
      issues: [game(1), game(2), game(3), game(10)],
      sessions: [working('a', 'task-1'), working('b', 'task-2'), working('c', 'task-3')],
      taken: DUG_YESTERDAY,
    };
    expect(moves(board)).not.toContain(DIG);
  });

  // 人へ返した task は配られないので、**残っていても「配れる task」ではない**（2.15）。
  it('返された task しか無ければ、掘り起こす係を立てる', () => {
    const returned = { number: 10, ...label('kind:task', 'goal:game', '判断待ち'), blockedBy: { nodes: [] } };
    expect(moves({ issues: [returned], taken: DUG_YESTERDAY })).toEqual([DIG]);
  });

  // **数えるのは在庫の数ではなく組成**（2.18.1）。ここが在庫の数を見ていた間、スメルを拾う係が毎日
  // 整備の issue を積んだので、**この係は立てられなくなっていた**——2026-09-11 に配れた46件のうち、
  // 完成の定義へ向かうものは7件で、残る39件が「配れる task が在る」を成立させ続けていた。
  it('配れるのが整備の仕事だけなら、掘り起こす係を立てる', () => {
    const chores = [1, 2, 3, 4, 5].map(upkeep);
    expect(moves({ issues: chores, taken: DUG_YESTERDAY })).toContain(DIG);
  });

  it('配れる goal:game が1件でもあれば、掘り起こす係は立てない', () => {
    expect(moves({ issues: [upkeep(1), game(2)], taken: DUG_YESTERDAY })).not.toContain(DIG);
  });

  // 印が無いときの既定（2.18.1）。**名乗らない機械の仕事は整備として読む**ので、付け忘れが
  // 「完成へ近づける仕事が在る」を成立させることはない。
  it('goal: を名乗らない origin:agent の issue しか無ければ、掘り起こす係を立てる', () => {
    const unnamed = { number: 1, ...label('kind:task', 'origin:agent'), blockedBy: { nodes: [] } };
    expect(moves({ issues: [unnamed], taken: DUG_YESTERDAY })).toContain(DIG);
  });

  it('前に立ててから一日が経つまで、掘り起こす係は立てない', () => {
    expect(moves({ taken: { 'cycle:dig': '2026-09-04T03:00:00Z' } })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { HEAD, PUSHED, REFUSALS, RETARGETED, run } from '../support/tidyMergedPrWorld';

/**
 * マージ済みのPR1本の後片付け——上に積まれていたPRの差し戻しと、本体のチェックアウトの追随。
 *
 * **誰がマージしたかを見ない**ので、ユーザーが画面から入れたPRも同じ道を通る
 * （`.claude/board-design.md` 2.10.4）。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/tidyMergedPrWorld.ts`。
 */

describe('tidy-merged-pr.sh', () => {
  // GitHub が張り替えても、squash マージでは差分に下のぶんが混ざったままで、CIも古い base で得た
  // 緑のまま。base が `main` になったぶん盤面は普通に捌きにかかるので、**書いた本人へ差し戻す**。
  // 差し戻す理由はPRを見ても分からない（コンフリクトもCIの赤もレビューの指摘も無い）ので、文面を
  // 一緒に残す。
  it('GitHub が base を張り替えたPRを、理由を残して書いた本人へ差し戻す', () => {
    const result = run({
      open: [
        { number: 1001, oldBase: HEAD },
        { number: 1002, oldBase: HEAD },
      ],
    });

    expect(result.lines.slice(0, 2)).toEqual(['MENDED 1001', 'MENDED 1002']);
    expect(result.labels).toEqual(['--add-label 直し待ち', '--add-label 直し待ち']);
    expect(result.comments).toContain('base を張り替えました');
    expect(result.status).toBe(0);
  });

  // 張り替えの記録は他のPRにも残っている。**このPRのブランチを指しているものだけ**が相手。
  it('別のブランチから張り替えられたPRには触らない', () => {
    const result = run({ open: [{ number: 1001, oldBase: 'claude/issue-111' }, { number: 1002 }] });

    expect(result.lines.some((line) => line.startsWith('MENDED '))).toBe(false);
    expect(result.labels).toEqual([]);
  });

  // 記録は載せ直しても消えないので、**張り替えより後に押された先頭コミットが在るなら、もう本人が
  // 動いた後**。ここで差し戻すと、押し返すたびに同じ依頼が返ってくる。
  it('張り替えの後に押し返されたPRには、もう差し戻さない', () => {
    const result = run({
      open: [{ number: 1001, oldBase: HEAD, retargetedAt: RETARGETED, pushedAt: '2026-09-10T13:00:00Z' }],
    });

    expect(result.lines.some((line) => line.startsWith('MENDED '))).toBe(false);
    expect(result.labels).toEqual([]);
  });

  // 二度目のコメントは何も足さない。**二度打っても同じ結果になる**ので、覚えを失った周に打ち直しても
  // 荒れない（`board-move.mjs` の `TIDY`）。
  it('既に差し戻されているPRには、二度目のコメントを置かない', () => {
    const result = run({
      open: [{ number: 1001, oldBase: HEAD, pushedAt: PUSHED, labels: ['直し待ち'] }],
    });

    expect(result.lines.some((line) => line.startsWith('MENDED '))).toBe(false);
    expect(result.comments).toBe('');
  });

  // 理由を残せなければラベルも付けない（`UNMENDED` は「`直し待ち` が付いていない」と同じ意味）。
  it('差し戻す理由を残せなければ、ラベルを付けずに理由ごと出す', () => {
    const result = run({ open: [{ number: 1001, oldBase: HEAD }], noteFails: true });

    expect(result.lines).toContain(`UNMENDED 1001: ${REFUSALS.note}`);
    expect(result.labels).toEqual([]);
    expect(result.comments).toBe('');
    expect(result.status).toBe(2);
  });

  it('ラベルを付けられなければ、理由ごと後片付けの残りとして出す', () => {
    const result = run({ open: [{ number: 1001, oldBase: HEAD }], sendBackFails: true });

    expect(result.lines).toContain(`UNMENDED 1001: ${REFUSALS.sendBack}`);
    expect(result.lines.some((line) => line.startsWith('MENDED '))).toBe(false);
    expect(result.status).toBe(2);
  });

  // 引けなかったことも、打った `gh` の理由ごと出す。理由が複数行でも**出力は1行1件**——畳めて
  // いなければ、理由の続きが次の行として現れて落ちる（issue #1698）。
  it('張り替えられたPRを引けなければ、理由ごと1行で後片付けの残りとして出す', () => {
    const result = run({ stackedUnknown: true });

    expect(result.lines).toContain(`UNSTACKED 1000: ${REFUSALS.stacked.replace(/\n/g, ' ')}`);
    expect(result.status).toBe(2);
  });

  // ブランチを消すのも張り替えるのもGitHub自身（スクリプトの「GitHub が肩代わりするもの」）。
  // 打ち直す手をここへ戻すと、消す手・張り替える手が2つになる。
  it('ブランチを消す手も、base を張り替える手も持たない', () => {
    const result = run({ open: [{ number: 1001, oldBase: HEAD }] });

    expect(result.labels).toEqual(['--add-label 直し待ち']);
    expect(result.lines.some((line) => line.startsWith('UNDELETED ') || line.startsWith('RETARGETED '))).toBe(
      false,
    );
  });

  // 開いているPRに後片付けを打つと、上のPRを差し戻しながら本体を進めることになる。
  it('マージされていないPRには何もしない', () => {
    const result = run({ state: 'OPEN', open: [{ number: 1001, oldBase: HEAD }] });

    expect(result.lines).toEqual([]);
    expect(result.git.some((call) => call.includes('checkout'))).toBe(false);
    expect(result.status).toBe(1);
  });

  // 作業ツリーは本体の `node_modules` を共有するので、本体が古いままだと版が食い違う。
  it('本体のチェックアウトを、ブランチを持たせずに新しい main へ進める', () => {
    const result = run({});

    expect(result.git.some((call) => call.includes('fetch --quiet origin main'))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout --quiet --detach origin/main'))).toBe(true);
    expect(result.lines).toContain('SYNCED deadbee');
    expect(result.installed).toBe(false);
    expect(result.status).toBe(0);
  });

  it('依存が変わったときだけ、本体で npm install する', () => {
    expect(run({ lockChanged: true }).installed).toBe(true);
    expect(run({ lockChanged: true }).lines).toContain('INSTALLED');
    expect(run({ lockChanged: false }).installed).toBe(false);
  });

  it('本体に依存が入っていなければ、変わっていなくても入れる', () => {
    expect(run({ mainInstalled: false }).installed).toBe(true);
  });

  // パスだけでは、触らなかったことしか運ばない。**何が汚れているか**まで同じ行へ載せる（本体は
  // 誰も作業しない場所なので、読んだ側は何が残っているのか見当が付かない）。
  it('本体に未コミットの変更があれば触らず、何が汚れているかごと1行で報せる', () => {
    const result = run({ mainDirty: true });

    expect(result.lines.find((line) => line.startsWith('DIRTY '))).toMatch(/: +M docs\/x\.md +M src\/y\.ts$/);
    expect(result.git.some((call) => call.includes('checkout'))).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(2);
  });

  // 未追跡のものが妨げになるかは `checkout` 自身が判定するので、その失敗も後片付けの残りとして
  // 受ける。`set -e` へ落とすと、既に済んだ `MENDED`・`CLOSED` ごと「打てなかった」の一語になり、
  // 盤面は覚えを残さず毎周同じところまで打ち直す（`board-move.mjs` の `TIDY`）。
  it('本体を進められなければ、済んだぶんを残したまま、理由ごと1行で後片付けの残りとして出す', () => {
    const result = run({ open: [{ number: 1001, oldBase: HEAD }], checkoutFails: true });

    expect(result.lines).toContain('MENDED 1001');
    const dirty = result.lines.find((line) => line.startsWith('DIRTY '));
    expect(dirty?.endsWith(REFUSALS.checkout.replace(/\n/g, ' '))).toBe(true);
    expect(result.lines.some((line) => line.startsWith('SYNCED '))).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(2);
  });
});

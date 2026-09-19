import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAKE_ALL_ON, BRAKE_ISSUE, brakeOff, writeBrakeGh } from '../support/brakeIssue';
import { FakeMetaServer, wrappedMetaReply, writeFakeCredentials } from '../support/fakeMetaServer';
import { spawnScriptAsync } from '../support/runScript';
import { writeUsageCache, writeUsagePolled } from '../support/usageCache';

/**
 * `scripts/daemon/may-dispatch.sh`（と、その下の `may-spend.sh` / `brake.sh` / `headroom.sh` /
 * `occupancy.sh`）の検査。
 *
 * ここが守るのは**安全側へ倒れること**。誤って止めれば投入が遅れるだけだが、誤って通すと同じ仕事へ
 * 2本立ち、同じPRへ食い違う判定が残る（`agent-ops/board-design.md` 1.5節 の PR #1493）。手綱も使用量も
 * セッション一覧も**引けなかったときは止まる**ことを、実際にスクリプトを走らせて見る。
 *
 * **止まった理由が終了コードで見分けられること**も、ここが守る（2.5.2）——人が止めた3と、余力で
 * 止まった4は、**打つ手が違う**（前者は人が外すまで戻らず、後者は枠が明ければひとりでに戻る）。
 *
 * `gh` を PATH の先頭に、使用量の控えを `BOARD_STATE` で、セッションの一覧を
 * **身代わりのMCPサーバ**（`CCR_META_ENDPOINT`）で差し替える。一覧は `live-sessions.mjs` が
 * `.claude/ccr-meta.mjs` を直に呼んで引くので、**差し替え口はシェルではなく通信先**にある。
 *
 * **身代わりは試験と同じプロセスに居る**ので、叩く側は `spawnScriptAsync` で待つ——同期で待つと
 * イベントループごと止まり、子の要求に誰も応えないまま両方が待ち続ける。
 */

// 実プロセス（bash + gh のスタブ）を起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/daemon/may-dispatch.sh');

interface Session {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  readonly tags: readonly string[];
}

interface World {
  /** 手綱の issue の本文。既定は全部チェック済み。 */
  readonly brake?: string;
  /** 手綱の issue を引けなくする。 */
  readonly ghFails?: boolean;
  /** 一覧が返すセッション。既定は空。 */
  readonly sessions?: readonly Session[];
  /** セッションの一覧を引けなくする。 */
  readonly ccrFails?: boolean;
  /** 控えてある `five_hour` の `utilization`。既定は余力たっぷり。 */
  readonly fiveHour?: number;
  /** 控えてある `seven_day` の `utilization`。既定は余力たっぷり。 */
  readonly sevenDay?: number;
  /** 使用量の控えを置かない（一度も引けていない周）。 */
  readonly noUsage?: boolean;
}

interface Run {
  readonly code: number;
  readonly stderr: string;
}

/**
 * 手綱を引けなかったときに `gh` が言うこと。**身代わりにも標準エラーを言わせる**——黙って転ぶ
 * 身代わりを相手にすると、理由を捨てる実装がそのまま緑で通る。
 */
const GH_EXCUSE = 'gh: Bad credentials (HTTP 401)';

/** 一覧を引けなかったときに、身代わりのMCPサーバが返す状態。理由はこの数字で追う。 */
const CCR_EXCUSE = 'HTTP 500';

let server: FakeMetaServer;
let endpoint: string;

beforeEach(async () => {
  server = new FakeMetaServer();
  endpoint = await server.listen();
});

afterEach(async () => {
  await server.close();
});

async function run(kind: string, tag: string | readonly string[], world: World = {}): Promise<Run> {
  const tags = typeof tag === 'string' ? [tag] : tag;
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-may-dispatch-'));
  try {
    writeBrakeGh(work, world.brake ?? BRAKE_ALL_ON, world.ghFails === true ? GH_EXCUSE : undefined);

    // **引けなかったことは、道具の側の失敗で作る**（`callMeta` が `MetaError` を投げる形）。
    server.status = world.ccrFails === true ? 500 : 200;
    server.reply = wrappedMetaReply({
      ccr: {
        data: (world.sessions ?? []).map((s) => ({
          id: s.id,
          session_status: s.status,
          status_bucket: s.bucket,
          tags: s.tags,
        })),
        has_more: false,
      },
    });
    writeFakeCredentials(work);

    if (world.noUsage !== true) {
      writeUsageCache(work, { fiveHour: world.fiveHour, sevenDay: world.sevenDay });
    }
    // **控えが無いときは口を叩きに行く**（`headroom.sh`）。叩いた印をたった今のことにして、間隔の番で
    // 追い返させる——**本物の網に触らせない**。資格情報は身代わりのMCP用に置いてあるので、
    // 「読めなくて落ちる」には頼れない。**間隔は下で名指しで渡す**（既定に任せると、環境から短い値が
    // 渡った回だけ本物の口へ出る）。
    writeUsagePolled(work);

    const result = await spawnScriptAsync(SCRIPT, [kind, ...tags], {
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        CCR_META_ENDPOINT: endpoint,
        BOARD_STATE: work,
        HOME: work,
        USERPROFILE: work,
        BRAKE_ISSUE,
        USAGE_MIN_SECONDS: '3600',
      },
    });
    return { code: result.code, stderr: result.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const working = (tag: string): Session => ({
  id: 'cse_WORKING',
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags: [tag],
});

describe('may-dispatch.sh', () => {
  it('手綱が全部付いていて、同じタグのセッションが無ければ通す', async () => {
    expect(await run('new-task', 'task-1234')).toEqual({ code: 0, stderr: '' });
  });

  // **人が止めている周は3で名乗る**（`brake.sh`。`agent-ops/board-design.md` 2.21.2節）——1周のログを
  // 読む側（盤面を見回る係）が、人の意思で止まっている周を調べに行かないために要る区別。
  it('親の「投入する」が外れていれば、種類に関わらず止まる', async () => {
    const result = await run('review', 'review-1500', { brake: brakeOff('投入する') });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('手綱');
  });

  it('その種類だけ外れていれば、その種類だけが止まる', async () => {
    const brake = brakeOff('レビュー');

    expect((await run('review', 'review-1500', { brake })).code).toBe(3);
    expect((await run('new-task', 'task-1234', { brake })).code).toBe(0);
  });

  // 種類は根から自分までの鎖に対応する（board-design 2.4）。子だけを外して、親のレビューは流す。
  it('子だけ外れていれば、その子の種類だけが止まる', async () => {
    const brake = brakeOff('task を持たないPRも読む');

    expect((await run('review-untasked', 'review-1526', { brake })).code).toBe(3);
    expect((await run('review', 'review-1500', { brake })).code).toBe(0);
  });

  it('親のレビューが外れていれば、子の種類も止まる', async () => {
    expect((await run('review-untasked', 'review-1526', { brake: brakeOff('レビュー') })).code).toBe(3);
  });

  // 手綱を読む側と書く側が食い違ったときに、通す側へ倒れないこと。
  it('手綱の issue を引けなければ止まる', async () => {
    expect((await run('new-task', 'task-1234', { ghFails: true })).code).toBe(1);
  });

  // **止まった行が、打った `gh` の言い分を運ぶこと**（issue #1864）。「引けなかった」だけでは、
  // 資格情報なのか相手が居ないのかへ辿り着けず、読んだ側は同じコマンドを手で打ち直す。
  it('手綱を引けなかった行に、`gh` が言った理由が載る', async () => {
    const result = await run('new-task', 'task-1234', { ghFails: true });

    expect(result.stderr).toContain(GH_EXCUSE);
  });

  it('手綱に見出しの行が無ければ止まる', async () => {
    expect((await run('new-task', 'task-1234', { brake: '## 手綱\n\n（空）\n' })).code).toBe(1);
  });

  it('同じタグのセッションが走っていれば止まる', async () => {
    const result = await run('new-task', 'task-1234', { sessions: [working('task-1234')] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cse_WORKING');
  });

  it('走っているのが別のタグなら通す', async () => {
    expect((await run('new-task', 'task-1234', { sessions: [working('task-5678')] })).code).toBe(0);
  });

  // 再レビューが止まらないことの確認。手番を終えたセッションは手が動いていない（board-design 1.2）。
  it('レビューでは、手番を終えたセッションは占有していない', async () => {
    const done = ['SESSION_STATUS_BUCKET_COMPLETED', 'SESSION_STATUS_BUCKET_FAILED'];
    for (const bucket of done) {
      const sessions = [{ id: 'cse_DONE', status: 'SESSION_STATUS_IDLE', bucket, tags: ['review-1500'] }];

      expect((await run('review', 'review-1500', { sessions })).code, bucket).toBe(0);
    }
  });

  // **種類ごとに訊く問いが違う**（1.2）。新しいタスクが訊くのは「もう配ったか」なので、手が空いて
  // いても配り直さない。同じ issue へ2本立つと、別々のPRが出る（1.5）。
  it('新しいタスクでは、手番を終えたセッションも占有している', async () => {
    const done = ['SESSION_STATUS_BUCKET_COMPLETED', 'SESSION_STATUS_BUCKET_FAILED'];
    for (const bucket of done) {
      const sessions = [{ id: 'cse_DONE', status: 'SESSION_STATUS_IDLE', bucket, tags: ['task-1234'] }];

      expect((await run('new-task', 'task-1234', { sessions })).code, bucket).toBe(1);
    }
  });

  // 2026-09-05 に実測。task-1180 のセッションが `IDLE` のまま `..._WORKING` で1時間半固まり、
  // PR #1524 のレビューが出なくなった。`status_bucket` は手が空いても戻らないことがある。
  it('IDLE なら、status_bucket が WORKING でも占有していない', async () => {
    const sessions = [
      {
        id: 'cse_STUCK',
        status: 'SESSION_STATUS_IDLE',
        bucket: 'SESSION_STATUS_BUCKET_WORKING',
        tags: ['review-1500'],
      },
    ];

    expect((await run('review', 'review-1500', { sessions })).code).toBe(0);
  });

  // `..._BLOCKED` は手番が終わって人へ問いを返した状態（board-design 1.6 の実測）。手は空いている。
  it('BLOCKED のセッションは、手が空いている側として数える', async () => {
    const sessions = [
      {
        id: 'cse_BLOCKED',
        status: 'SESSION_STATUS_IDLE',
        bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
        tags: ['review-1500'],
      },
    ];

    expect((await run('review', 'review-1500', { sessions })).code).toBe(0);
  });

  it('畳まれたセッションは占有していない', async () => {
    const sessions = [
      {
        id: 'cse_ARCHIVED',
        status: 'SESSION_STATUS_ARCHIVED',
        bucket: 'SESSION_STATUS_BUCKET_WORKING',
        tags: ['task-1234'],
      },
    ];

    expect((await run('new-task', 'task-1234', { sessions })).code).toBe(0);
  });

  // レビューは「前のレビュー」と「そのPRを直しているセッション」の両方を見る（board-design 1.3）。
  // `直し待ち` のラベルからは、直している最中か誰も居ないかが読めない。
  it('タグを複数渡すと、どれか1つでも占有されていれば止まる', async () => {
    const result = await run('review', ['review-1500', 'task-1415'], { sessions: [working('task-1415')] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('task-1415');
  });

  it('タグを複数渡しても、どれも占有されていなければ通す', async () => {
    const sessions = [working('task-9999')];

    expect((await run('review', ['review-1500', 'task-1415'], { sessions })).code).toBe(0);
  });

  it('タグを1つも渡さなければ止まる', async () => {
    expect((await run('review', [])).code).toBe(1);
  });

  it('セッションの一覧を引けなければ止まる', async () => {
    expect((await run('new-task', 'task-1234', { ccrFails: true })).code).toBe(1);
  });

  // 手綱と同じく、占有を見に行けなかった行も理由を運ぶ（issue #1864）。
  it('一覧を引けなかった行に、一覧が言った理由が載る', async () => {
    const result = await run('new-task', 'task-1234', { ccrFails: true });

    expect(result.stderr).toContain(CCR_EXCUSE);
  });

  // **当たったのは週次の枠**（issue #2209。5時間の枠には余力が在った）。片方しか見ないと、
  // そのときと同じ形で通り続ける。
  it('週次の余力が足りなければ止まる', async () => {
    const result = await run('new-task', 'task-1234', { sevenDay: 99 });

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('seven_day');
  });

  it('5時間の余力が足りなければ止まる', async () => {
    expect((await run('new-task', 'task-1234', { fiveHour: 95 })).code).toBe(4);
  });

  // **「制限中だった」という状態を持たない**（board-design 2.5.1）。毎回引いて比べるだけなので、
  // 止まった次の呼び出しでも、値が戻っていればそのまま通る。
  it('枠が明けた周は、何もしなくても投入が戻る', async () => {
    expect((await run('new-task', 'task-1234', { sevenDay: 99 })).code).toBe(4);
    expect((await run('new-task', 'task-1234', { sevenDay: 20 })).code).toBe(0);
  });

  // **見回る係は終了コードで打つ手を選ぶ**（2.21.2）。同じ3にすると、枠が明ければ戻るものを
  // 「人が止めている」と読む。
  it('余力で止まった周は、人が手綱で止めた周と終了コードが違う', async () => {
    const held = await run('new-task', 'task-1234', { sevenDay: 99 });
    const braked = await run('new-task', 'task-1234', { brake: brakeOff('新しいタスク') });

    expect(held.code).toBe(4);
    expect(braked.code).toBe(3);
    expect(held.stderr).not.toContain('手綱で止まっている');
  });

  // 手綱（人間）と余力（自動）の AND（2.5.2）。人が止めている周は、余力の話をする前に止まる。
  it('手綱が外れていれば、余力が在っても止まる', async () => {
    const result = await run('new-task', 'task-1234', { brake: brakeOff('新しいタスク'), fiveHour: 0 });

    expect(result.code).toBe(3);
  });

  it('使用量を一度も引けていなければ止まる', async () => {
    expect((await run('new-task', 'task-1234', { noUsage: true })).code).toBe(1);
  });

  it('知らない種類は止まる', async () => {
    expect((await run('bogus', 'task-1234')).code).toBe(1);
  });
});

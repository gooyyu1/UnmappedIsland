import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatLive, liveSessions } from '../../scripts/agent/live-sessions.mjs';

/**
 * `scripts/agent/live-sessions.mjs` の検査。
 *
 * ここが守るのは**「畳まれていない」の定義が1箇所に留まること**と、**どこで走っているかを
 * 取り違えないこと**（`.claude/board-design.md` 2.16.2）。後者を誤ると、盤面が正しく走っている
 * ワーカーを「場所が違う」と読んで畳む。
 *
 * 環境IDの既定値を持つのは [`ccr-env.sh`](../../scripts/agent/ccr-env.sh) なので、**そこを叩いて
 * 読めること自体も見る**——書き写せば済む話にしてあると、あちらを直したときにここが黙って古いIDを
 * 見続ける。
 */

const CLOUD = 'env_cloud_test';
const BRIDGE = 'env_bridge_test';

/** `list_sessions` の1ページ。**環境の対応表は差し替える**ので、`ccr-env.sh` は起きない。 */
function page(...sessions: Record<string, unknown>[]) {
  return () => ({ ccr: { data: sessions, has_more: false } });
}

const envs = () => ({ [CLOUD]: 'cloud', [BRIDGE]: 'bridge' });

describe('live-sessions.mjs', () => {
  it('畳まれたセッションは落とす', () => {
    const live = liveSessions({
      page: page(
        { id: 'session_a', session_status: 'SESSION_STATUS_IDLE', environment_id: CLOUD, tags: ['task-1'] },
        { id: 'session_b', session_status: 'SESSION_STATUS_ARCHIVED', environment_id: CLOUD, tags: [] },
      ),
      envs,
    });

    expect(live.map((session) => session.id)).toEqual(['session_a']);
  });

  it('どこで走っているかを、環境IDから訳して載せる', () => {
    const live = liveSessions({
      page: page(
        { id: 'session_a', session_status: 'SESSION_STATUS_IDLE', environment_id: CLOUD, tags: [] },
        { id: 'session_b', session_status: 'SESSION_STATUS_IDLE', environment_id: BRIDGE, tags: [] },
      ),
      envs,
    });

    expect(live.map((session) => session.env)).toEqual(['cloud', 'bridge']);
  });

  // **知らない環境をクラウドへ寄せない**（2.16.2）。寄せると、盤面が正しく走っているセッションを
  // 「場所が違う」と読んで畳む。
  it('知らない環境は - として出す', () => {
    const live = liveSessions({
      page: page({
        id: 'session_a',
        session_status: 'SESSION_STATUS_IDLE',
        environment_id: 'env_x',
        tags: [],
      }),
      envs,
    });

    expect(live[0]?.env).toBe('-');
  });

  it('環境IDを持たないセッションも - として出す', () => {
    const live = liveSessions({
      page: page({ id: 'session_a', session_status: 'SESSION_STATUS_IDLE', tags: [] }),
      envs,
    });

    expect(live[0]?.env).toBe('-');
  });

  // 対応表の実物。**`ccr-env.sh` を叩いて読む**ので、あちらの印字の口が壊れればここが赤くなる
  // ——既定値を書き写す形にしてあると、あちらを直したときに黙って古いIDを見続ける。
  // 値そのものは環境変数で差し替える（`ccr-env.sh` の「試験は環境変数で差し替える」）。
  it('環境の対応表を ccr-env.sh から読める', () => {
    process.env.CLOUD_ENV = CLOUD;
    process.env.BRIDGE_ENV = BRIDGE;
    try {
      const live = liveSessions({
        page: page(
          { id: 'session_a', session_status: 'SESSION_STATUS_IDLE', environment_id: BRIDGE, tags: [] },
          { id: 'session_b', session_status: 'SESSION_STATUS_IDLE', environment_id: CLOUD, tags: [] },
        ),
      });

      expect(live.map((session) => session.env)).toEqual(['bridge', 'cloud']);
    } finally {
      delete process.env.CLOUD_ENV;
      delete process.env.BRIDGE_ENV;
    }
  });

  // **黙って空の対応表を返させない。** 全セッションが `-`（＝食い違いを見ない側）へ落ちるだけなので、
  // 配り直しの仕組みが赤くも遅くもならずに死ぬ。
  it('ccr-env.sh を起こせなければ止まる', () => {
    process.env.CCR_ENV = resolve(__dirname, 'no-such-ccr-env.sh');
    try {
      expect(() => liveSessions({ page: page() })).toThrow(/ccr-env\.sh/);
    } finally {
      delete process.env.CCR_ENV;
    }
  });

  /**
   * **繰る回数が履歴の長さに比例して増えないこと**（`.claude/board-design.md` 1.7）。
   * `list_sessions` は1000回/時で頭打ちになるので、末尾まで繰ると**セッションを作るほど盤面が
   * 止まりやすくなる**。上限に当たった周は一覧が引けず、レビューも投入も1件も出ない。
   */
  describe('繰るのは、生きたセッションが尽きるまで', () => {
    /** 各ページの中身を順に返す。**何ページ目まで求められたか**も返す。 */
    function pages(...ofPage: Record<string, unknown>[][]) {
      const asked: unknown[] = [];
      const fetch = (request: unknown) => {
        asked.push(request);
        const data = ofPage[asked.length - 1] ?? [];
        return { ccr: { data, has_more: asked.length < ofPage.length, last_id: `page_${asked.length}` } };
      };
      return { fetch, asked };
    }

    const alive = (id: string) => ({
      id,
      session_status: 'SESSION_STATUS_IDLE',
      environment_id: CLOUD,
      tags: [],
    });
    const archived = (id: string) => ({
      id,
      session_status: 'SESSION_STATUS_ARCHIVED',
      environment_id: CLOUD,
      tags: [],
    });

    it('生きたセッションが1件も無いページが続いたら、そこで止める', () => {
      const { fetch, asked } = pages(
        [alive('session_a')],
        [archived('session_b')],
        [archived('session_c')],
        [alive('session_d')],
      );

      const live = liveSessions({ page: fetch, envs, taken: '' });

      expect(live.map((session) => session.id)).toEqual(['session_a']);
      expect(asked).toHaveLength(3);
    });

    // **途切れ1枚では諦めない。** 生きたセッションは新しい側に固まるが、間に畳まれたものが挟まる。
    it('畳まれたページが1枚だけなら、越えて拾う', () => {
      const { fetch, asked } = pages([alive('session_a')], [archived('session_b')], [alive('session_c')]);

      const live = liveSessions({ page: fetch, envs, taken: '' });

      expect(live.map((session) => session.id)).toEqual(['session_a', 'session_c']);
      expect(asked).toHaveLength(3);
    });
  });

  /**
   * **1周に何度も引かない**（1.7）。盤面が引いたものをファイルで渡したら、そちらを読むだけで
   * `list_sessions` を叩かない。
   */
  describe('この周のぶんが渡されたら、それを読む', () => {
    it('渡されたファイルを読み、一覧は叩かない', () => {
      const path = join(mkdtempSync(join(tmpdir(), 'live-sessions-')), 'live.tsv');
      writeFileSync(
        path,
        `${formatLive({ id: 'session_a', status: 'SESSION_STATUS_RUNNING', bucket: 'B', env: 'cloud', tags: ['task-1', 'review-2'] })}\n`,
      );

      const live = liveSessions({
        page: () => {
          throw new Error('叩いてはいけない');
        },
        envs,
        taken: path,
      });

      expect(live).toEqual([
        {
          id: 'session_a',
          status: 'SESSION_STATUS_RUNNING',
          bucket: 'B',
          env: 'cloud',
          tags: ['task-1', 'review-2'],
        },
      ]);
    });

    // **読めなかったら止まる側へ倒す**——黙って引き直すと「同じ周の答え」でなくなる。
    it('渡されたファイルが読めなければ止まる', () => {
      expect(() =>
        liveSessions({ page: page(), envs, taken: resolve(__dirname, 'no-such-live.tsv') }),
      ).toThrow(/セッションの一覧/);
    });
  });
});

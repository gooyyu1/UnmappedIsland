import { describe, expect, it } from 'vitest';

import { liveSessions } from '../../scripts/agent/live-sessions.mjs';

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
});

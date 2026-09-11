/** 畳まれていないセッション1件。値の意味は [`live-sessions.mjs`](live-sessions.mjs) の冒頭が持つ。 */
export interface LiveSession {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  /** どこで走っているか（`cloud` / `bridge`。引けなければ `-`）。 */
  readonly env: string;
  readonly tags: readonly string[];
}

/** 外を触る手。省いたものは本物が入る。 */
export interface LiveSessionsDeps {
  page?: (request: unknown) => { ccr?: Record<string, unknown> } | undefined;
  envs?: () => Record<string, string>;
  /** この周のぶんを既に引いてあるファイル。空なら自分で引く。 */
  taken?: string;
}

export function liveSessions(deps?: LiveSessionsDeps): LiveSession[];

/** `ccr-env.sh` が出した環境ID1つ。名前はあちらが出す綴りのまま（`CLOUD_ENV` / `BRIDGE_ENV`）。 */
export interface EnvironmentId {
  readonly name: string;
  readonly id: string;
}

/** 今の環境ID。**決まらなかった側は並びに居ない**（[`live-sessions.mjs`](live-sessions.mjs)）。 */
export function environmentIds(): EnvironmentId[];

/** TSVの1行へ。列の並びを持つのは [`live-sessions.mjs`](live-sessions.mjs)。 */
export function formatLive(session: LiveSession): string;

/** `formatLive` の逆。 */
export function parseLive(text: string): LiveSession[];

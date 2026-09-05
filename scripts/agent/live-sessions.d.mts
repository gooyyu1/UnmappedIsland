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
}

export function liveSessions(deps?: LiveSessionsDeps): LiveSession[];

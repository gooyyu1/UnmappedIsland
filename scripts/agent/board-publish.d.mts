/** 外を触る手と、並べる形。省いたものは本物が入る。 */
export interface BoardPublishDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  body?: (deps: {
    gh?: unknown;
    warn?: (line: string) => void;
    unreadableSince?: string;
    patrol?: { at: string; verdict: string; summary: string };
  }) => string | undefined;
  /** 書き込む先の issue 番号。既定は [`board-publish.mjs`](board-publish.mjs) の定数。 */
  issue?: string;
  warn?: (line: string) => void;
  /**
   * 盤面を引けなくなった時刻（`board-state.mjs` の `UNREADABLE`）。省くとデーモンの台帳から引く。
   */
  unreadableSince?: string;
  /** 最後の見回り（`board-state.mjs` の `readLastPatrol`）。省くとデーモンの記録から引く。 */
  patrol?: { at: string; verdict: string; summary: string };
}

export function publish(deps?: BoardPublishDeps): boolean;

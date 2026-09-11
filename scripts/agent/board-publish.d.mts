/** 外を触る手と、並べる形。省いたものは本物が入る。 */
export interface BoardPublishDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  body?: (deps: { gh?: unknown; warn?: (line: string) => void; stuckSince?: string }) => string | undefined;
  /** 書き込む先の issue 番号。既定は [`board-publish.mjs`](board-publish.mjs) の定数。 */
  issue?: string;
  warn?: (line: string) => void;
  /**
   * 盤面が進んでいないと見え始めた時刻（`.claude/board-state.mjs` の `STUCK`）。
   * 省くとデーモンの台帳から引く。
   */
  stuckSince?: string;
}

export function publish(deps?: BoardPublishDeps): boolean;

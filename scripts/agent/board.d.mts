/** 外を触る手と、断りの出し先。省いたものは本物が入る。 */
export interface BoardDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  page?: (request: unknown) => { ccr?: { data?: readonly Record<string, unknown>[] } } | undefined;
  checkedItems?: (issuesJson: string) => string;
  warn: (line: string) => void;
}

export function board(deps: BoardDeps): string[] | undefined;

/** 常設の issue の本文（`.claude/board-design.md` 2.20）。`now` は最終更新として本文に出る。 */
export function issueBody(deps: BoardDeps & { now?: Date }): string | undefined;

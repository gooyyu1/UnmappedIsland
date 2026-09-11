import type { LiveSession } from './live-sessions.d.mts';

/** 外を触る手と、断りの出し先。省いたものは本物が入る。 */
export interface BoardDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  /** 畳んでいないセッション。引けなければ投げる（[`live-sessions.mjs`](live-sessions.mjs)）。 */
  sessions?: () => readonly LiveSession[];
  warn: (line: string) => void;
}

export function board(
  deps: BoardDeps & { checkedItems?: (issuesJson: string) => string },
): string[] | undefined;

/**
 * 常設の issue の本文（`.claude/board-design.md` 2.20）。`now` は最終更新として本文に出る。
 * `unreadableSince` は、盤面を引けなくなった時刻（2.21。引けていれば渡らない）。`patrol` は
 * 最後の見回り（2.21.4。走っていなければ渡らない）。
 */
export function issueBody(
  deps: BoardDeps & {
    now?: Date;
    unreadableSince?: string;
    patrol?: { at: string; verdict: string; summary: string };
  },
): string | undefined;

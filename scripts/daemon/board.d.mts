import type { LiveSession } from './live-sessions.d.mts';

/** 外を触る手と、断りの出し先。省いたものは本物が入る。 */
export interface BoardDeps {
  gh?: (args: readonly string[], options?: { sayWhyNot?: (line: string) => void }) => string | undefined;
  /** 畳んでいないセッション。引けなければ投げる（[`live-sessions.mjs`](live-sessions.mjs)）。 */
  sessions?: () => readonly LiveSession[] | Promise<readonly LiveSession[]>;
  warn: (line: string) => void;
}

export function board(
  deps: BoardDeps & { checkedItems?: (issuesJson: string) => string },
): Promise<string[] | undefined>;

/** 盤面を引けていない区間（`board-state.mjs` の `readUnreadable`）。引けていれば渡らない。 */
export interface Unreadable {
  since: string;
  until: string;
  rounds: number;
  reason: string;
}

/** 周の出来事（`board-state.mjs` の `readRounds`）。打った手と、閉じた「引けなかった区間」。 */
export type RoundEvent = Record<string, unknown>;

/**
 * 手の結果を、人へ見せる語にする表。鍵は `board-round.mjs` の `PLAYED`・`FAILED`・`SETTLED`
 * （`agent-ops/board-design.md` 2.20.3）。
 */
export const MOVE_RESULTS: Record<string, string>;

/**
 * 常設の issue の本文（`agent-ops/board-design.md` 2.20）。`now` は最終更新として本文に出る。
 * `unreadable` は盤面を引けていない区間（2.21）、`patrol` は最後の見回り（2.21.4。走っていなければ
 * 渡らない）、`blockedNotes`・`partialNotes`・`events` は周の出来事（2.20.3）。
 */
export function issueBody(
  deps: BoardDeps & {
    now?: Date;
    unreadable?: Unreadable;
    patrol?: { at: string; verdict: string; summary: string };
    blockedNotes?: readonly { text: string; since: string }[];
    partialNotes?: readonly string[];
    events?: readonly RoundEvent[];
  },
): Promise<string | undefined>;

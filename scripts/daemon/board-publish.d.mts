import type { RoundEvent, Unreadable } from './board.d.mts';

/** 外を触る手と、並べる形。省いたものは本物が入る。 */
export interface BoardPublishDeps {
  gh?: (args: readonly string[], options?: { sayWhyNot?: (line: string) => void }) => string | undefined;
  body?: (deps: {
    gh?: unknown;
    warn?: (line: string) => void;
    unreadable?: Unreadable;
    patrol?: { at: string; verdict: string; summary: string };
    blockedNotes?: readonly { text: string; since: string }[];
    partialNotes?: readonly string[];
    events?: readonly RoundEvent[];
  }) => string | undefined | Promise<string | undefined>;
  /** 書き込む先の issue 番号。既定は [`board-publish.mjs`](board-publish.mjs) の定数。 */
  issue?: string;
  warn?: (line: string) => void;
  /**
   * 盤面を引けていない区間（`board-state.mjs` の `readUnreadable`）。省くとデーモンの台帳から引く。
   */
  unreadable?: Unreadable;
  /** 最後の見回り（`board-state.mjs` の `readLastPatrol`）。省くとデーモンの記録から引く。 */
  patrol?: { at: string; verdict: string; summary: string };
  /** 配れない理由と、それが出始めた時刻（`board-state.mjs` の `readNotes`）。省くと台帳から引く。 */
  blockedNotes?: readonly { text: string; since: string }[];
  /** この周の盤面が欠けている理由（`board-state.mjs` の `readPartialNotes`）。省くと台帳から引く。 */
  partialNotes?: readonly string[];
  /** 周の出来事（`board-state.mjs` の `readRounds`）。省くとデーモンの帳面から引く。 */
  events?: readonly RoundEvent[];
}

export function publish(deps?: BoardPublishDeps): Promise<boolean>;

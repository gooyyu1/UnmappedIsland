/** 盤面を引けなくなった時刻を置く、台帳の鍵（`.claude/board-design.md` 2.21）。 */
export const UNREADABLE: string;

/** 台帳と心拍の置き場（`daemon.sh` の `STATE_DIR` と同じ既定）。 */
export function boardState(): string;

export function readLedger(stateDir: string): Record<string, string>;

export function writeLedger(stateDir: string, taken: Readonly<Record<string, string>>): void;

/** 見回りの記録の在り処（`.claude/board-design.md` 2.21.4）。書くのは係のセッション。 */
export function patrolPath(stateDir: string): string;

/** 最後の見回り。走っていない周も、記録が読めない周も `undefined`。 */
export function readLastPatrol(
  stateDir: string,
): { at: string; verdict: string; summary: string } | undefined;

/** 盤面を引けなくなった時刻を置く、台帳の鍵（`agent-ops/board-design.md` 2.21）。 */
export const UNREADABLE: string;

/** その区間で最後に引けなかった周の時刻を置く、台帳の鍵。 */
export const UNREADABLE_UNTIL: string;

/** その区間で引けなかった周の数を置く、台帳の鍵。 */
export const UNREADABLE_ROUNDS: string;

/** その区間で道具が最後に言った理由を置く、台帳の鍵。 */
export const UNREADABLE_REASON: string;

/** 配れない理由が出始めた時刻を置く、台帳の鍵の頭（`agent-ops/board-design.md` 2.20.3）。 */
export const NOTE_PREFIX: string;

/** この周の盤面が欠けている理由を置く、台帳の鍵の頭（`agent-ops/board-design.md` 2.20.3）。 */
export const PARTIAL_PREFIX: string;

/** 台帳と心拍の置き場（`daemon.sh` の `STATE_DIR` と同じ既定）。 */
export function boardState(): string;

export function readLedger(stateDir: string): Record<string, string>;

export function writeLedger(stateDir: string, taken: Readonly<Record<string, string>>): void;

/** 見回りの記録の在り処（`agent-ops/board-design.md` 2.21.4）。書くのは係のセッション。 */
export function patrolPath(stateDir: string): string;

/** 最後の見回り。走っていない周も、記録が読めない周も `undefined`。 */
export function readLastPatrol(
  stateDir: string,
): { at: string; verdict: string; summary: string } | undefined;

/** 今その周に出ている、配れない理由と、それが出始めた時刻（古い順）。 */
export function readNotes(stateDir: string): { text: string; since: string }[];

/** 今その周の盤面が欠けている理由（古い順）。続いた長さは持たない。 */
export function readPartialNotes(stateDir: string): string[];

/** 今まさに盤面を引けていないことと、その区間の姿。引けていれば `undefined`。 */
export function readUnreadable(
  stateDir: string,
): { since: string; until: string; rounds: number; reason: string } | undefined;

/** 帳面の末尾から読む量。窓（`board.mjs` の `EVENT_WINDOW_HOURS`）のぶんが入る大きさ。 */
export const JOURNAL_TAIL_BYTES: number;

/** 周の出来事の帳面の在り処（`agent-ops/board-design.md` 2.20.3）。書くのは1周を回す側。 */
export function journalPath(stateDir: string): string;

/** 周の出来事を1件書く。 */
export function appendRound(stateDir: string, record: Readonly<Record<string, unknown>>): void;

/** 帳面の末尾を読む。読めなければ空（`agent-ops/board-design.md` 2.20.3）。 */
export function readRounds(stateDir: string): Record<string, unknown>[];

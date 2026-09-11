/** 盤面が進んでいないと見え始めた時刻を置く、台帳の鍵（`.claude/board-design.md` 2.21）。 */
export const STUCK: string;

/** 台帳と心拍の置き場（`daemon.sh` の `STATE_DIR` と同じ既定）。 */
export function boardState(): string;

export function readLedger(stateDir: string): Record<string, string>;

export function writeLedger(stateDir: string, taken: Readonly<Record<string, string>>): void;

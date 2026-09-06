// 盤面の形は [`board-move.mjs`](board-move.mjs) の冒頭が持つ。ここで写すと定義が2つになるので、
// 受け口は `unknown` のままにする。
export function moves(board: unknown): string[];

/** 今その差分へ手が動いているか（`.claude/board-design.md` 1.6）。 */
export function busySession(session: { status: string }): boolean;

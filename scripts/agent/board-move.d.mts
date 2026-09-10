// 盤面の形は [`board-move.mjs`](board-move.mjs) の冒頭が持つ。ここで写すと定義が2つになるので、
// 受け口は `unknown` のままにする。
export function moves(board: unknown): string[];

/** 今その差分へ手が動いているか（`.claude/board-design.md` 1.6）。 */
export function busySession(session: { status: string }): boolean;

/** 周期の係を前に立ててから空ける間隔（時間）。知らない名前には `undefined`。 */
export function cycleHours(name: string): number | undefined;

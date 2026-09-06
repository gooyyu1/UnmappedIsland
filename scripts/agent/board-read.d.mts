// 盤面の形は [`board-move.mjs`](board-move.mjs) の冒頭が持つ。ここで写すと定義が2つになるので、
// 返す形は名前で引けるだけにする。

/** 外を触る手。省いたものは本物が入る（`log`・`now` 以下は呼び手が必ず渡す）。 */
export interface ReadDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  sessions?: () => readonly unknown[];
  /** `archive/` に入っていない判断の履歴の数。省くと本物のリポジトリを数える。 */
  pendingDecisions?: () => number;
  log: (line: string) => void;
  now: Date;
  settleMinutes: number;
  taken: Readonly<Record<string, string>>;
}

/** 盤面を1つ組み立てる。`gh` が引けなければ `undefined`、一覧が引けなければ投げる。 */
export function readBoard(deps: ReadDeps): Record<string, unknown> | undefined;

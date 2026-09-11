// 盤面の形は [`board-move.mjs`](board-move.mjs) の冒頭が持つ。ここで写すと定義が2つになるので、
// 返す形は名前で引けるだけにする。

/** 外を触る手。省いたものは本物が入る（`log`・`now` 以下は呼び手が必ず渡す）。 */
export interface ReadDeps {
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  sessions?: () => readonly unknown[];
  /** `archive/` に入っていない判断の履歴の数。省くと本物のリポジトリを数える。 */
  pendingDecisions?: () => number;
  /** 二次がまだ読んでいない、一次の分析の記録の数。省くと本物のリポジトリを数える。 */
  unsummarizedAnalyses?: () => number;
  log: (line: string) => void;
  now: Date;
  settleMinutes: number;
  taken: Readonly<Record<string, string>>;
}

/** 数える置き場。省くと本物のリポジトリを見る（渡せるのは、実物を起こさずに検査するため）。 */
export interface AnalysisDirs {
  analyses?: URL;
  summaries?: URL;
}

/** 盤面を1つ組み立てる。`gh` が引けなければ `undefined`、一覧が引けなければ投げる。 */
export function readBoard(deps: ReadDeps): Record<string, unknown> | undefined;

/**
 * さかのぼるマージ済みPRの幅（時間）。後片付けが追える幅であり、スメルを拾う係が読む窓でもある
 * （係の間隔より広い。`.claude/board-design.md` 4.4.2）。
 */
export const MERGED_WINDOW_HOURS: number;

/** 1周で引くマージ済みPRの上限。窓の幅ではなく、引きすぎを止める栓。 */
export const MERGED_CAP: number;

/**
 * まだ二次が読んでいない、一次の分析の記録の件数（`.claude/board-design.md` 2.17.4）。
 * 読めなかったときは0。
 */
export function countUnsummarizedAnalyses(log: (line: string) => void, dirs?: AnalysisDirs): number;

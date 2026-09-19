/** 隣のスクリプトを1本叩いた結果。 */
export interface ScriptResult {
  status: number;
  stdout: string;
}

/** 外を触る手と、出す先。省いたものは本物が入る。 */
export interface RoundDeps {
  runScript?: (
    name: string,
    args: readonly string[],
    options?: { input?: string; capture?: boolean; env?: Record<string, string> },
  ) => ScriptResult;
  gh?: (args: readonly string[], options?: { sayWhyNot?: (line: string) => void }) => string | undefined;
  sessions?: () => readonly unknown[] | Promise<readonly unknown[]>;
  /** `archive/` に入っていない判断の履歴の数（`board-read.mjs`）。省くと本物のリポジトリを数える。 */
  pendingDecisions?: () => number;
  /** 二次がまだ読んでいない、一次の分析の記録の数（`board-read.mjs`）。省くと本物のリポジトリを数える。 */
  unsummarizedAnalyses?: () => number;
  /** 節番号の参照に、この周に読むものが在るか（`board-read.mjs`）。省くと本物のリポジトリを見る。 */
  pendingRefAudit?: () => boolean;
  log?: (line: string) => void;
  echo?: (text: string) => void;
  warn?: (line: string) => void;
  now?: () => Date;
  stateDir?: string;
  settleMinutes?: number;
  dryRun?: boolean;
}

export function round(deps?: RoundDeps): Promise<boolean>;

/**
 * **前の差分の札を落としてほしい**とPRへ頼む1行目。読んで札を動かすのは `board-labels.yml` の
 * `swept` で、綴りの突き合わせは検査が持つ。
 */
export const SWEEP_LINE: string;

/** 1手の結果。**「打てなかった」を、直す相手が要る分と答えが返っている分に割る**（2.21.2）。 */
export const PLAYED: 'played';
export const FAILED: 'failed';
export const SETTLED: 'settled';

export function play(
  kind: string,
  args: readonly string[],
  deps: {
    runScript: NonNullable<RoundDeps['runScript']>;
    remember: (key: string, mark: string) => void;
    log: NonNullable<RoundDeps['log']>;
    echo: NonNullable<RoundDeps['echo']>;
  },
): typeof PLAYED | typeof FAILED | typeof SETTLED;

export function pruneTaken(
  taken: Readonly<Record<string, string>>,
  board: { sessions: readonly { id: string }[]; prs: readonly { number: number }[]; now: string },
): Record<string, string>;

export function trackIdle(
  taken: Readonly<Record<string, string>>,
  board: { sessions: readonly { id: string; status: string }[] },
  now: string,
): Record<string, string>;

/**
 * その周に出ていた断りを、出始めた時刻とともに台帳へ写す（`agent-ops/board-design.md` 2.20.3節）。
 * 頭は `board-state.mjs` の `NOTE_PREFIX`（配れない理由）か `PARTIAL_PREFIX`（盤面の欠け）。
 * 消えた断りは落ち、続いている断りの時刻は動かない。
 */
export function trackNotes(
  taken: Readonly<Record<string, string>>,
  prefix: string,
  notes: readonly string[],
  now: string,
): Record<string, string>;

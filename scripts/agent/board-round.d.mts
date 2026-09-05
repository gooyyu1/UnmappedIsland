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
    options?: { input?: string; capture?: boolean },
  ) => ScriptResult;
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  sessions?: () => readonly unknown[];
  log?: (line: string) => void;
  echo?: (text: string) => void;
  warn?: (line: string) => void;
  now?: () => Date;
  stateDir?: string;
  settleMinutes?: number;
  dryRun?: boolean;
}

export function round(deps?: RoundDeps): boolean;

export function play(
  kind: string,
  args: readonly string[],
  deps: {
    runScript: NonNullable<RoundDeps['runScript']>;
    remember: (key: string, mark: string) => void;
    log: NonNullable<RoundDeps['log']>;
    echo: NonNullable<RoundDeps['echo']>;
  },
): boolean;

export function pruneTaken(
  taken: Readonly<Record<string, string>>,
  board: { sessions: readonly { id: string }[]; prs: readonly { number: number }[] },
): Record<string, string>;

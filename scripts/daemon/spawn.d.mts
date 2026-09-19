/** シェルへ渡すパス（区切りを `/` へ直す）。 */
export function posix(path: string): string;

/**
 * `gh` を1回叩いて標準出力を返す。引けなければ `undefined` で、**そのとき道具が言った理由は
 * `sayWhyNot` へ渡る**（`agent-ops/board-design.md` 1.7）。渡さなければ標準エラーへ流れる。
 */
export function gh(
  args: readonly string[],
  options?: { sayWhyNot?: (line: string) => void },
): string | undefined;

/** bash のスクリプトを1本叩く。 */
export function runBash(
  path: string,
  args: readonly string[],
  options?: { input?: string; capture?: boolean; env?: Record<string, string> },
): { status: number; stdout: string };

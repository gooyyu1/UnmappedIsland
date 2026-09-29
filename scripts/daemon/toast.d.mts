/** 出す中身と、外を触る手。省いたものは本物が入る。 */
export interface ToastDeps {
  title?: string;
  body?: string;
  /** PowerShell を起こす手。差し替えられるのは、**検査が本物を撃たないため**。 */
  run?: (
    command: string,
    args: readonly string[],
    options?: { encoding?: string },
  ) => { status: number | null };
  /** 走っている土台。Windows 以外では撃たずに `false` を返す。 */
  platform?: string;
}

export const escapeXml: (text: unknown) => string;

export function toastScript(title: string, body: string): string;

export function toast(deps?: ToastDeps): boolean;

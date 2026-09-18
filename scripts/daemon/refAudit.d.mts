/** 台帳が持つ、前の周の到達点。まだ無いものは `null`。 */
export interface RefAuditLedger {
  /** 掃く分をここまで読んだ、という参照元のパス（`/` 区切り）。 */
  through: string | null;
  /** その周に見ていたコミットの指紋。 */
  commit: string | null;
}

/** この周に読む参照元1つ。 */
export interface RefAuditEntry {
  /** 参照元のパス（`/` 区切り）。 */
  file: string;
  /** そのファイルが持つ節番号の参照の数。 */
  refs: number;
  /** なぜこの周に読むか。 */
  why: string;
  /** そのファイルのどこを見ればよいかの手がかり（行・節・すべて）。**範囲の指定ではない。** */
  where: string;
}

/** この周に読む範囲。 */
export interface RefAuditBatch {
  ledger: RefAuditLedger;
  /** 今の `HEAD` の指紋。 */
  head: string;
  /** 前の周の指紋をこの檻から引けなかったか（浅いクローン）。 */
  lostWindow: boolean;
  /** 変わった分。**予算は掛からない。** */
  changed: RefAuditEntry[];
  /** 掃く分。予算まで。 */
  sweep: RefAuditEntry[];
  /** 掃く分が末尾まで届いたか。 */
  swept: boolean;
}

/** どこまで読んだかを持つ台帳のパス（根からの相対、`/` 区切り）。 */
export const LEDGER: string;

/** 台帳の値が「まだ無い」ことを表す綴り。 */
export const UNSET: string;

/** 1周で読む参照の数（掃く分に掛かる）。 */
export const BUDGET: number;

/** 台帳の中身。読めなければ投げる。 */
export function readLedger(root: string): RefAuditLedger;

/** 今の `HEAD` の指紋。 */
export function head(root: string): string;

/** この周に読む参照の範囲。`ledger` を渡せるのは、台帳を書き換えずに検めるため。 */
export function refAuditBatch(
  root: string,
  options?: { budget?: number; ledger?: RefAuditLedger },
): RefAuditBatch;

/** この周に読むものが在るか（係の `due`）。**中身は1つも開かない。** */
export function hasRefAuditWork(root: string, options?: { ledger?: RefAuditLedger }): boolean;

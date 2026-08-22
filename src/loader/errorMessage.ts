/**
 * 例外から人へ出す文言。**Errorでない値が飛んでくることもある**（yamlパッケージやJSONの投げるもの）
 * ので、文字列へ直してから載せる。
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

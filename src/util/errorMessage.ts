/**
 * 例外から人へ出す文言。**Errorでない値が飛んでくることもある**（yamlパッケージやJSONの投げるもの、
 * `unhandledrejection`のreason）ので、文字列へ直してから載せる。
 *
 * fallbackは、Errorでも文字列でもない値に代わりに出す文言（渡さなければ値そのものを文字列化する）。
 * 読める文言を持たない値（`{}`は`[object Object]`、undefinedは`undefined`にしかならない）のとき、
 * 受け取った側が別に持っている文脈——`window.onerror`のmessageなど——のほうが読めるので渡す。
 *
 * 返すのは例外が名乗っている文言だけで、**種類（`YamlLoadError`）は添えない**。主な行き先は
 * 読み手への日本語の文の中（「読み込めないので、このパックを外しました: 〜」）で、そこに実装の
 * クラス名が挟まっても読み手には何も伝わらない。種類が要る側（errorReport）が、自分の都合として
 * 前に置く。
 */
export function messageOf(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback ?? String(error);
}

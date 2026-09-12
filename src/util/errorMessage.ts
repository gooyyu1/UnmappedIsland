/**
 * 例外から人へ出す文言。**Errorでない値が飛んでくることもある**（yamlパッケージやJSONの投げるもの、
 * `unhandledrejection`のreason）ので、文字列へ直してから載せる。
 *
 * fallbackは、Errorでも文字列でもない値に代わりに出す文言（渡さなければ値そのものを文字列化する）。
 * 読める文言を持たない値（`{}`は`[object Object]`、undefinedは`undefined`にしかならない）のとき、
 * 受け取った側が別に持っている文脈——`window.onerror`のmessageなど——のほうが読めるので渡す。
 *
 * **種類の名前（`TypeError`）は添えない。** 定義の誤りを読み手へ見せる文（loadDefinitionsほか）が
 * 主な行き先で、そこへ出る例外は素のErrorなので`Error: `としか名乗らない。実行時エラーの報告で
 * 種類が要るぶんは、同じ報告に並ぶスタックの1行目が言う（errorReport）。
 */
export function messageOf(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback ?? String(error);
}

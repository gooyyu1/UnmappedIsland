/**
 * パックのものであることを名前に添える書き方（`<パックのid>:<名前>`、AssetPack.md 3.2節）。
 *
 * 定義の出所の表示にも、絵の在庫表の鍵にも同じ形を使う。**同梱ぶんの名前には`:`が入らない**ので、
 * 付いているかどうかで「パックのものか」が読め、外せば同梱ぶんの名前になる（同5節の落とし先）。
 */

const SEPARATOR = ':';

/** パックの名前を添えた名前。 */
export function packQualifiedName(packName: string, name: string): string {
  return `${packName}${SEPARATOR}${name}`;
}

/** パックの名前を外した名前（付いていなければそのまま）。 */
export function nameWithoutPack(name: string): string {
  const separator = name.indexOf(SEPARATOR);
  return separator === -1 ? name : name.slice(separator + 1);
}

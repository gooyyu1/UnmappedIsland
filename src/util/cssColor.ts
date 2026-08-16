/** Phaserのテキストスタイルは色を文字列で受け取るため、16進数値をCSS色へ直す。 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

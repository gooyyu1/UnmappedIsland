/** Phaserのテキストスタイルは色を文字列で受け取るため、16進数値をCSS色へ直す。 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * 濃さを添えたCSS色へ直す。**色と濃さを別々に受け取る**ので、同じ色を違う濃さで敷く側
 * （落ち影）が、色のほうを意匠から引いたまま濃さだけを決められる。
 */
export function cssColorWithAlpha(color: number, alpha: number): string {
  const [red, green, blue] = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  return `rgba(${red},${green},${blue},${alpha})`;
}

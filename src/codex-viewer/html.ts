import { ART_BY_OBJECT_NAME } from '../art/objectArt';

/** 中身が1つも無いことを表すHTML。節ごと省くかの判断（pages.tsのsection）もこれを目印にする。 */
export const EMPTY_HTML = '<p class="muted">（なし）</p>';

/** HTMLへ文字列を埋め込む前の実体参照化。 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

/** 参照の行頭へ添える小さな絵。絵を持たない型では空文字を返す。 */
export function inlineArtHtml(objectName: string): string {
  const url = ART_BY_OBJECT_NAME.get(objectName);
  return url === undefined ? '' : `<img class="ref-art" src="${url}" alt="">`;
}

import { ART_BY_NAME } from '../art/objectArt';

/** 中身が1つも無いことを表すHTML。節ごと省くかの判断（pages.tsのsection）もこれを目印にする。 */
export const EMPTY_HTML = '<p class="muted">（なし）</p>';

/** HTMLへ文字列を埋め込む前の実体参照化。 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );
}

/**
 * 参照の行頭へ添える小さな絵。絵を持たない型では空文字を返す。
 *
 * 受け取るのは**絵の名前**（`CodexView.artNameOf`）であって型の識別子ではない。1枚を共有する型
 * （`art`、4.3節）は識別子で引くと絵を持たない扱いになる。
 */
export function inlineArtHtml(artName: string): string {
  const url = ART_BY_NAME.get(artName);
  return url === undefined ? '' : `<img class="ref-art" src="${url}" alt="">`;
}

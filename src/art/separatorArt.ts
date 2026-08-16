import separatorUrl from '../assets/ui/separator.png';

/**
 * エリアの境目に敷く木の帯のテクスチャキー。
 *
 * 絵は中央半分だけが区切りそのもので、上下1/4ずつは隣のエリアへかぶせる前提で描かれている
 * （PlayScreenLayout.buildLaneSeparators参照）。レーンの区切りと、縦型のオプションバーの下の
 * 両方で同じ絵を使う。
 */
export const SEPARATOR_TEXTURE = 'separator';

/** テクスチャキー → 画像のURL。 */
export const SEPARATOR_ART: ReadonlyMap<string, string> = new Map([[SEPARATOR_TEXTURE, separatorUrl]]);

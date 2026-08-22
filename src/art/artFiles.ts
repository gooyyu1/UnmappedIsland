import type { WorldCodex } from '../domain/WorldCodex';
import { BACKGROUND_ART, backgroundTexturesOf } from './backgroundArt';
import { ART_BY_OBJECT_NAME, objectTexture } from './objectArt';

/**
 * 土地の絵の遅延ロードの単位分け。
 *
 * 絵の大半（容量比で約9割）は土地ごとの絵——土地カードの絵1枚と背景（backgroundArt）最大3枚——で、
 * 要不要も土地単位で決まる（現在地と道の行き先だけが要る）。そこで起動時（BootScene）は
 * 土地の絵を除いた残り（commonArtFiles）だけを読み、土地の絵はプレイ中に必要になった土地から
 * ロードする（LocationArtLoader）。
 */

/** ロードすべき絵1枚（Phaserのテクスチャキーと画像URL）。 */
export interface ArtFile {
  readonly key: string;
  readonly url: string;
}

/**
 * 土地カードの絵（1枚。用意されていなければ空）。道のカードが行き先の絵としても使うため、
 * 未発見の道の行き先ぶんはこれだけを先に読む（LocationArtLoader.requestCardArt）。
 */
export function locationCardArtFiles(location: string): readonly ArtFile[] {
  const url = ART_BY_OBJECT_NAME.get(location);
  return url === undefined ? [] : [{ key: objectTexture(location), url }];
}

/** 1つの土地に紐づく絵（用意されているものだけ。絵が1枚も無い土地では空）。 */
export function locationArtFiles(location: string): readonly ArtFile[] {
  const files: ArtFile[] = [...locationCardArtFiles(location)];
  for (const key of backgroundTexturesOf(location)) {
    const backgroundUrl = BACKGROUND_ART.get(key);
    if (backgroundUrl !== undefined) files.push({ key, url: backgroundUrl });
  }
  return files;
}

/** どの土地にも紐づかない、起動時に読み切る絵（キャラクター・アイテム・共通の背景）。 */
export function commonArtFiles(locations: readonly string[]): readonly ArtFile[] {
  const locationKeys = new Set(locations.flatMap((l) => locationArtFiles(l).map((file) => file.key)));
  const files: ArtFile[] = [];
  for (const [name, url] of ART_BY_OBJECT_NAME) {
    const key = objectTexture(name);
    if (!locationKeys.has(key)) files.push({ key, url });
  }
  for (const [key, url] of BACKGROUND_ART) if (!locationKeys.has(key)) files.push({ key, url });
  return files;
}

/**
 * 絵を遅延ロードする土地の識別子。
 *
 * **locationタグを持つだけでは足りない。** 筏（voyage.yaml）は場所でありながら設置物でもあり、
 * 岸に置かれた札として、そこへ入る前から画面に出る。土地と一括りにすると、その札の絵だけが
 * 読まれないまま絵文字で出る（実際に出た）。
 *
 * 遅延にする理由は常駐量——1つの土地が背景を何枚も持ち、それが土地の数だけ在ることにある。
 * **背景を持たない場所は遅らせる意味が無い**ので、そこで線を引く。
 */
export function locationDefNames(codex: WorldCodex): readonly string[] {
  return codex
    .objectDefNamesWithTag(codex.vocabulary.world.locationTagId)
    .filter((name) => backgroundTexturesOf(name).length > 0);
}

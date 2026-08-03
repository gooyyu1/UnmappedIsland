import type { WorldCodex } from '../../domain/defs/WorldCodex';
import { BACKGROUND_ART, locationBackgroundTextures } from './backgroundArt';
import { OBJECT_ART, objectTexture } from './objectArt';

/**
 * 土地の絵の遅延ロードの単位分け。
 *
 * 絵の大半（容量比で約9割）は土地ごとの絵——土地カードの絵1枚と背景（backgroundArt）最大3枚——で、
 * 要不要も土地単位で決まる（現在地と、発見済みの道の行き先だけが要る）。そこで起動時（BootScene）は
 * 土地の絵を除いた残り（commonArtFiles）だけを読み、土地の絵はプレイ中に必要になった土地から
 * ロードする（LocationArtLoader）。
 */

/** ロードすべき絵1枚（Phaserのテクスチャキーと画像URL）。 */
export interface ArtFile {
  readonly key: string;
  readonly url: string;
}

/** 1つの土地に紐づく絵（用意されているものだけ。絵が1枚も無い土地では空）。 */
export function locationArtFiles(location: string): readonly ArtFile[] {
  const files: ArtFile[] = [];
  const url = OBJECT_ART.get(location);
  if (url !== undefined) files.push({ key: objectTexture(location), url });
  for (const key of locationBackgroundTextures(location)) {
    const backgroundUrl = BACKGROUND_ART.get(key);
    if (backgroundUrl !== undefined) files.push({ key, url: backgroundUrl });
  }
  return files;
}

/** どの土地にも紐づかない、起動時に読み切る絵（キャラクター・アイテム・共通の背景）。 */
export function commonArtFiles(locations: readonly string[]): readonly ArtFile[] {
  const locationKeys = new Set(locations.flatMap((l) => locationArtFiles(l).map((file) => file.key)));
  const files: ArtFile[] = [];
  for (const [name, url] of OBJECT_ART) {
    const key = objectTexture(name);
    if (!locationKeys.has(key)) files.push({ key, url });
  }
  for (const [key, url] of BACKGROUND_ART) if (!locationKeys.has(key)) files.push({ key, url });
  return files;
}

/** locationタグを持つobject_defの識別子（＝絵を遅延ロードする土地）の一覧。 */
export function locationDefNames(codex: WorldCodex): readonly string[] {
  const tagId = codex.tagNames.tryGetId('location');
  if (tagId === undefined) return [];

  const names: string[] = [];
  for (let id = 0; id < codex.objects.count; id++) {
    const def = codex.objects.get(id);
    if (def.tags.includes(tagId)) names.push(def.name);
  }
  return names;
}

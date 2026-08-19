import type { WorldObject } from '../../domain/WorldObject';
import type { Location } from '../../domain/views/Location';
import type { PlayerCharacter } from '../../domain/views/PlayerCharacter';

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * カードが並ぶ場所＝ワールド上の1つのスロット。**指し方はこれ1つだけ**——同じスロットを2通りに
 * 指せると、行き先の比較（samePlace）が食い違い、端の行き先も落とし先も別物として扱われる。
 *
 * 画面の区画（レーン・装備/怪我のボタン）はスロットではなく**入口**なので、場所そのものではなく
 * 名前（ScreenPlace）で持ち、映す先はここへ解決する。
 */
export interface CardPlace {
  readonly container: WorldObject;
  readonly slotGlobalId: number;
}

/** 2つの場所が同じか。同じ型のコンテナが複数あっても中身は別なので、持ち主はインスタンスで見分ける。 */
export function samePlace(a: CardPlace, b: CardPlace): boolean {
  return a.container === b.container && a.slotGlobalId === b.slotGlobalId;
}

/**
 * 画面が自分で名指しする入口——**常に見えている3つのレーン**（ScreenLayout.md）だけ。
 *
 * **物から辿り着く場所はここに要らない。** 装備も怪我も、入れ物の中身も現在地の構造も、その物が
 * 名乗る`visible_slots`から場所として出てくる（GameElementDefinition.md 7.11節）——装備・怪我の
 * ボタンが開く先も、キャラクタの窓が並べるスロットそのもの。
 */
export type ScreenPlace = 'fixtures' | 'items' | 'hand';

/**
 * 画面の区画が今映しているスロット。**現在地とプレイヤーで解決するので、土地を移れば別のスロットを
 * 指す**——移動をまたいで持ち越した場所は、移った先の同じ名前のスロットではなく、元のスロットを
 * 指し続ける（cardPlacesOfを作り直しても、前の土地のインスタンスを掴んだ場所は変わらない）。
 */
export type ScreenPlaces = (screen: ScreenPlace) => CardPlace;

/** 今のプレイヤーと現在地について、画面の区画が映す先を解決できるようにする。 */
export function cardPlacesOf(player: PlayerCharacter, location: Location): ScreenPlaces {
  return (screen) => {
    switch (screen) {
      case 'items':
        return { container: location.instance, slotGlobalId: location.itemsSlotId };
      case 'fixtures':
        return { container: location.instance, slotGlobalId: location.fixturesSlotId };
      case 'hand':
        return { container: player.instance, slotGlobalId: player.handSlotId };
    }
  };
}

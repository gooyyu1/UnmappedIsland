import type { Slot } from '../../domain/Slot';
import type { SlotPosition } from '../../domain/SlotPosition';
import type { Location } from '../../domain/wrappers/Location';
import type { PlayerCharacter } from '../../domain/wrappers/PlayerCharacter';

/**
 * レーンの中でカードを置く場所。**ワールド側の位置の指し方そのもの**（SlotPosition）で、
 * CardLaneのドロップ先（LaneDropTarget）と同じ形。gapとcellのどちらが効くかは枠が決めるので、
 * 画面は指で示した位置をそのまま渡すだけでよい。
 */
export type CardPlacement = SlotPosition;

/**
 * カードが並ぶ場所＝ワールド上の1つのスロット（Slotそのもの）。**指し方はこれ1つだけ**——同じスロットを
 * 2通りに指せると、行き先の比較が食い違い、端の行き先も落とし先も別物として扱われる。
 *
 * 画面の区画（レーン・装備/怪我のボタン）はスロットではなく**入口**なので、場所そのものではなく
 * 名前（ScreenPlace）で持ち、映す先はここへ解決する。
 */
export type CardPlace = Slot;

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
export type ScreenPlaceResolver = (screen: ScreenPlace) => CardPlace;

/** 今のプレイヤーと現在地について、画面の区画が映す先を解決できるようにする。 */
export function cardPlacesOf(player: PlayerCharacter, location: Location): ScreenPlaceResolver {
  return (screen) => {
    switch (screen) {
      case 'items':
        return location.instance.getSlot(location.itemsSlotId);
      case 'fixtures':
        return location.instance.getSlot(location.fixturesSlotId);
      case 'hand':
        return player.instance.getSlot(player.handSlotId);
    }
  };
}

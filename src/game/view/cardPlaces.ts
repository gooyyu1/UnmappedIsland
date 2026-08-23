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
 *
 * **設置物レーンが映しているのは現在地とは限らない**（nestedFixturePlacesOf、ScreenLayout.md
 * 7.1.1節）。ここが答えるのは現在地のぶんだけなので、今どこを映しているかは画面が持つ。
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

/**
 * 現在地の設置物スロットと、**現在地を内側に含む場所**の設置物スロットを外側へ順に（先頭が現在地で、
 * 必ず1つ以上）。設置物レーンはこのどれか1つを映す（ScreenLayout.md 7.1.1節）。
 *
 * **場所であることの証は設置物の枠を持つこと**で、型の名前は見ない——筏で海に出ている間も、住居や
 * 避難所の中に居る間も同じ形になる。枠を持たない親（世界そのもの）に当たったところで打ち切る。
 */
export function nestedFixturePlacesOf(location: Location): readonly CardPlace[] {
  const fixturesSlotId = location.fixturesSlotId;
  const places = [location.instance.getSlot(fixturesSlotId)];
  for (let outer = location.instance.parent; outer !== undefined; outer = outer.parent) {
    const fixtures = outer.tryGetSlot(fixturesSlotId);
    if (fixtures === undefined) break;
    places.push(fixtures);
  }
  return places;
}

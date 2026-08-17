import type { WorldCodex } from '../../domain/defs/WorldCodex';
import type { WorldObject } from '../../domain/runtime/WorldObject';
import type { Location } from '../../domain/runtime/views/Location';
import type { PlayerCharacter } from '../../domain/runtime/views/PlayerCharacter';

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * カードが並ぶ場所（＝ワールド上の1つのスロット）。画面に定位置を持つ6つは名前で、それ以外は
 * 持ち主のインスタンスとスロットで指す。
 *
 * 移動の宛先はすべてこの形で指す（moveTo）ので、「どのレーンの隣か」という暗黙の対応は持たない。
 */
export type CardPlace =
  | 'fixtures'
  | 'items'
  | 'structure'
  | 'hand'
  | 'equipment'
  | 'injuries'
  | { readonly container: WorldObject; readonly slotGlobalId: number };

/**
 * 2つの場所が同じか。コンテナの場所は映しているインスタンスで見分ける（同じ型のコンテナが複数あっても
 * 中身は別なので、型では一意に決まらない）。
 */
export function samePlace(a: CardPlace, b: CardPlace): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.container === b.container && a.slotGlobalId === b.slotGlobalId;
}

/** 場所が指している、ワールド上の実際のスロット1つ。 */
export interface SlotOfPlace {
  readonly owner: WorldObject;
  readonly slotId: number;
}

/**
 * 組み込んだ部品を並べるスロットの名前（voyage.yamlの筏、Dwellings.md 1節の住居）。
 *
 * **場所の種類がまだ無いので、探索（EXPLORE_ACTION）と同じく名前で決め打つ。** 探索できる土地と、
 * 中に入る筏・住居を型として分けたうえで、どちらのスロットを開くかをワールド側に名乗らせるのが
 * 本来の形（visible_slotsと同じ形にできる）。場所の種類を入れるときに一緒に直す。
 */
const STRUCTURE_SLOT = 'structure';

/** 画面に定位置を持つ場所。ここに挙げたものだけが名前で指される。 */
const NAMED_PLACES = ['hand', 'equipment', 'injuries', 'items', 'fixtures', 'structure'] as const;

/**
 * 場所とワールド上のスロットの対応（Windows.md 1節）。**両方向をここだけが決める**——場所からスロットを
 * 引くのも、スロットを指す場所を選ぶのも同じ1つの表を見る。
 *
 * カードの移動はすべてこの表を引いたスロット移動（WorldObject.moveToSlot*）で、場所ごとの特別扱いは
 * 持たない。コンテナ（箱・かご）を足すときも、この表に1行増やすだけで移動もドラッグも動く。
 *
 * **どこへ移せるかはこの表では決めない。** それはワールド側の宣言（枠の型・bound_to_owner）から引く
 * （cardOperationsのmoveInto参照）。設置物のかごを持ち歩けるようにしたら、画面を直さずに外せる。
 */
export interface CardPlaces {
  /** その場所が指すスロット。語彙を持たないCodex（structureの無い最小フィクスチャ等）ではundefined。 */
  readonly slotOf: (place: CardPlace) => SlotOfPlace | undefined;

  /**
   * そのスロットを指す場所。**同じスロットを2通りの場所で指さない**ため——指し方が割れると、
   * 行き先の比較（samePlace）が食い違い、端の行き先も落とし先も別物として扱われる。
   *
   * 名前で指すのは、今のプレイヤー・現在地そのもののスロットだけ。**名前の場所は「今どこに居るか」で
   * 行き先が変わる**ので、別の土地に在る同名のスロット（地面に据えた筏の`structure`）まで名前で
   * 指すと、現在地のスロットへ化ける。
   */
  readonly placeOf: (owner: WorldObject, slotGlobalId: number) => CardPlace;
}

/** 今のプレイヤーと現在地について、場所の対応を引けるようにする。土地を移れば作り直す。 */
export function cardPlacesOf(player: PlayerCharacter, location: Location, codex: WorldCodex): CardPlaces {
  const structureSlotId = codex.slotNames.tryGetId(STRUCTURE_SLOT);

  const slotOf = (place: CardPlace): SlotOfPlace | undefined => {
    if (typeof place !== 'string') return { owner: place.container, slotId: place.slotGlobalId };
    switch (place) {
      case 'items':
        return { owner: location.instance, slotId: location.itemsSlotId };
      case 'fixtures':
        return { owner: location.instance, slotId: location.fixturesSlotId };
      // 現在地に組み込まれている部品（筏の帆、住居の壁）。itemsと同じく現在地のスロットだが、
      // レーンには出ず、現在地の札から開くウィンドウだけが映す。
      case 'structure':
        return structureSlotId === undefined
          ? undefined
          : { owner: location.instance, slotId: structureSlotId };
      case 'hand':
        return { owner: player.instance, slotId: player.handSlotId };
      case 'equipment':
        return { owner: player.instance, slotId: player.equipmentSlotId };
      case 'injuries':
        return { owner: player.instance, slotId: player.injuriesSlotId };
    }
  };

  return {
    slotOf,
    // 逆向きもslotOfから引く。対応を2つ書くと、片方だけ直したときに指し方が割れる。
    placeOf: (owner, slotGlobalId) =>
      NAMED_PLACES.find((place) => {
        const slot = slotOf(place);
        return slot?.owner === owner && slot.slotId === slotGlobalId;
      }) ?? { container: owner, slotGlobalId },
  };
}

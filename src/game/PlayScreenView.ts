import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { Localization } from '../locale/Localization';
import type { CardContent } from './ui/Card';

/** ステータスエリアに出す1件。ratioは0〜1。 */
export interface StatusEntry {
  readonly name: string;
  readonly ratio: number;
}

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * カードが並ぶ場所（＝ワールド上の1つのスロット）の名前。レーンと子ウィンドウの対応付けに使う。
 *
 * 今後コンテナ（箱・かご）の中身も同じ子ウィンドウで見せるため、ここに置き場所を足していけるよう
 * 移動の宛先は名前で指す（moveTo）。「どのレーンの隣か」という暗黙の対応は持たない。
 */
export type CardPlace = 'field' | 'hand' | 'equipment' | 'injuries' | { readonly container: WorldObject };

/**
 * 2つの場所が同じか。コンテナの場所は映しているインスタンスで見分ける（同じ型のコンテナが複数あっても
 * 中身は別なので、型では一意に決まらない）。
 */
export function samePlace(a: CardPlace, b: CardPlace): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.container === b.container;
}

/**
 * アイテムのカード1枚。moveTo・reorder・combinationOfが返す操作はワールドを変えるだけで、画面への
 * 反映（表示内容の作り直し）は呼び出し側の責務。
 *
 * moveToとreorderは「そこへ落とせるか」を、操作を返すか否かで答える。落とせない場所（設置物の間、
 * 前詰めの場所の空き枠、出し入れできない怪我など）ではundefinedになるので、呼び出し側は落とし先の枠を
 * 出す前に問い合わせられる。
 */
export interface ItemCard extends CardContent {
  /**
   * このカードが映しているワールド上のオブジェクト（スタックなら全部、先頭が代表）。
   * PlayScreenViewの操作（combinationOf）へ渡すためだけのもので、画面の組み立て側は中身を見ない。
   */
  readonly objects: readonly WorldObject[];

  /** このカードが今いる場所。 */
  readonly place: CardPlace;

  /**
   * このカードがコンテナ（containerタグ、containers.yaml）なら、その中身を映す場所。
   * 画面側はこれを持つカードをタップで開けるようにする。
   */
  readonly contents?: CardPlace;

  /**
   * 別の場所へ移す操作。atは移した先での置き場所で、省略すると空いている場所へ入る。
   * 動かせないカード（設置物・怪我）にはない。移せなかった場合（手持ちが埋まっている等）は何も起きない。
   */
  readonly moveTo?: (place: CardPlace, at?: CardPlacement) => (() => void) | undefined;

  /**
   * 同じ場所の中で位置を変える操作。1枚が複数のインスタンスを表している場合はスタックごと動かす
   * （1個ずつでは元のスタックへ合流して戻ってしまうため、SlotSystem.md 3節）。
   */
  readonly reorder?: (at: CardPlacement) => (() => void) | undefined;
}

/**
 * プレイ中の画面が表示する内容。画面の組み立て（PlayScene）とゲーム状態の間を仕切る。
 *
 * 天候・条件・装備・怪我のように、ドメイン側にまだ表示できる形が無い項目はモック
 * （ScreenLayout_Mock.html）と同じ固定値を返す（fromGameSession参照）。
 */
export interface PlayScreenView {
  readonly characterName: string;
  /** 条件アイコン。複数同時に付き得るので件数は可変。 */
  readonly conditions: readonly string[];
  readonly equipmentIcon: string;
  readonly injuryIcon: string;
  /** 表示対象のステータスだけを並べた可変長リスト（ScreenLayout.md ステータスエリア節）。 */
  readonly statuses: readonly StatusEntry[];
  readonly elapsedDays: number;
  readonly hour: number;
  readonly minute: number;
  readonly weather: string;
  readonly currentLocation: CardContent;
  /** 現在地の探索率（0〜1）。100%に達しても探索は続けられる（ExplorationSystem.md 2節）。 */
  readonly explorationRatio: number;
  readonly destinations: readonly CardContent[];
  readonly fieldItems: readonly ItemCard[];
  /** 手持ちは固定枠スロットなので、空きセルはundefined（プレースホルダー）として並ぶ。 */
  readonly hand: readonly (ItemCard | undefined)[];

  /**
   * 子ウィンドウに並べる、その場所の中身（装備・怪我・コンテナの中身）。前詰めスロットなので
   * 空きセルは無い。レーンで常に見えているfield/handはこちらでは扱わない。
   */
  readonly cardsIn: (place: CardPlace) => readonly ItemCard[];

  /** 子ウィンドウのタイトルに出す、その場所の名前。 */
  readonly nameOf: (place: CardPlace) => string;

  /**
   * その場所がカードを受け入れるか（怪我のような読み取り専用の場所はfalse）。中身が空でも
   * 「落とせる場所かどうか」を見せるために、画面側が受け皿の空枠を出すかの判断に使う。
   */
  readonly acceptsCards: (place: CardPlace) => boolean;

  /**
   * draggedをtargetへ重ねたときに実行できるcombination（GameElementDefinition.md 12節）。
   * 実行できる組み合わせが無ければundefined。draggedとtargetが同じカード（スタックの上の1枚を
   * 元の位置へ重ねた）なら、そのスタックの中の2つを組み合わせる。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、ここでは宣言順の先頭を採る。マッチはwithタグだけで判定するので、
   * conditionsを満たさず実行が空振りすることはある。
   */
  readonly combinationOf: (dragged: ItemCard, target: ItemCard) => (() => void) | undefined;
}

/** アイテムの画像がまだ無いため、種別ごとの絵文字を仮のアイコンとして使う。 */
const LOCATION_ICON = '🗺️';
const ITEM_ICON = '📦';
const FIXTURE_ICON = '🌳';
const INJURY_ICON = '🩹';

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/**
 * 子ウィンドウのタイトルに出す場所の名前。子ウィンドウになるのはキャラクター自身のスロットだけで、
 * レーンで常に見えているfield/handは対象外。コンテナはその中身のオブジェクトの表示名を使う。
 */
const PLACE_NAMES: Partial<Record<CardPlace & string, string>> = {
  equipment: '装備',
  injuries: '怪我',
};

/** スロットの中身を、積み重なっているまとまりごとに分けたもの。 */
function stacksIn(
  dest: { owner: WorldObject; slotId: number } | undefined,
): readonly (readonly WorldObject[])[] {
  const slot = dest?.owner.tryGetSlot(dest.slotId);
  return slot === undefined ? [] : slot.cells.flatMap((cell) => (cell === undefined ? [] : [cell.members]));
}

/** targetがitem自身か、itemの中に入っているか。入れ物を自分自身の中へ入れる操作を弾くために使う。 */
function isSelfOrDescendant(item: WorldObject, target: WorldObject): boolean {
  for (let node: WorldObject | undefined = target; node !== undefined; node = node.parent) {
    if (node === item) return true;
  }
  return false;
}

/**
 * 生成済みのゲーム一式から画面の表示内容を作る。ロケーションレーン・フィールドアイテムレーン・
 * ハンドレーンは現在地とキャラクターのスロットの中身をそのまま映す。
 *
 * ワールドの状態を写し取るだけなので、アクションでワールドが変わったら作り直す（PlayScene参照）。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;
  const containerTagId = codex.tagNames.tryGetId('container');
  const contentsSlotId = codex.slotNames.tryGetId('contents');
  /** そのカードがコンテナなら、中身を映す場所。中身を持てるスロットが無いcodexではundefined。 */
  const contentsOf = (object: WorldObject): CardPlace | undefined =>
    containerTagId !== undefined && contentsSlotId !== undefined && object.def.tags.includes(containerTagId)
      ? { container: object }
      : undefined;

  // 1枚のカードが複数のインスタンス（スタック）を表すことがあるため、識別子は先頭を代表とする集合で持つ。
  const cardOf = (instances: readonly WorldObject[], icon: string, place: CardPlace): ItemCard => ({
    icon,
    name: locale.object(instances[0].def.name).displayName,
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    art: instances[0].def.name,
    objects: instances,
    place,
    contents: contentsOf(instances[0]),
  });

  // フィールドアイテムレーンは土地のitemsスロットの後ろへ設置物を並べたもの。設置物は別のスロットに
  // 居て動かせないため、アイテムの並びに関わる位置指定はここまでしか受け付けられない。
  const itemStacks = location.itemStacks;
  const gapInItems = (at: CardPlacement): number | undefined =>
    at.kind === 'cell' || at.index > itemStacks.length ? undefined : at.index;

  /**
   * 場所ごとの「どのオブジェクトのどのスロットか」。カードの移動はすべてこの表を引いた
   * スロット移動（WorldObject.moveToSlot*）で、場所ごとの特別扱いは持たない。コンテナ（箱・かご）
   * を足すときも、この表に1行増やすだけで移動もドラッグも動く。
   *
   * 怪我だけundefinedなのは「移動の宛先にならない」ことを表す（ワールド側の効果だけが付け外しする）。
   */
  const slotOf = (place: CardPlace): { owner: WorldObject; slotId: number } | undefined => {
    if (typeof place !== 'string') {
      return contentsSlotId === undefined ? undefined : { owner: place.container, slotId: contentsSlotId };
    }
    switch (place) {
      case 'field':
        return { owner: location.instance, slotId: location.itemsSlotId };
      case 'hand':
        return { owner: game.player.instance, slotId: game.player.handSlotId };
      case 'equipment':
        return { owner: game.player.instance, slotId: game.player.equipmentSlotId };
      case 'injuries':
        return undefined;
    }
  };

  /** itemを場所placeへ入れる操作（そこへは入れられないならundefined）。 */
  const moveInto =
    (item: WorldObject, from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement): (() => void) | undefined => {
      const dest = slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;
      // 自分の中へは入れられない（籠を籠自身へ、また自分の子孫の中へ）。
      if (typeof place !== 'string' && isSelfOrDescendant(item, place.container)) return undefined;

      const wellKnown = game.session.codex.wellKnown;
      if (at === undefined) {
        return () => {
          item.moveToSlot(dest.owner, dest.slotId, wellKnown);
        };
      }

      if (at.kind === 'cell') {
        // 空き枠を指せるのは固定枠スロットだけ（前詰めスロットに空き枠は無い）。
        const fixed = dest.owner.tryGetSlot(dest.slotId)?.def.fixedPositions === true;
        return fixed
          ? () => {
              item.moveToSlotAtCell(dest.owner, dest.slotId, at.index, wellKnown);
            }
          : undefined;
      }

      // フィールドのレーンだけは設置物（別スロット）を後ろに連ねているため、その範囲へは入れられない。
      const gapIndex = place === 'field' ? gapInItems(at) : at.index;
      if (gapIndex === undefined) return undefined;
      return () => {
        item.moveToSlotAtGap(dest.owner, dest.slotId, gapIndex, wellKnown);
      };
    };

  /** itemを同じ場所の中で動かす操作（動かせない位置ならundefined）。今いるスロットの中だけで完結する。 */
  const reorderIn =
    (item: WorldObject, place: CardPlace) =>
    (at: CardPlacement): (() => void) | undefined => {
      if (at.kind === 'cell') {
        return () => {
          item.moveToCellInParentSlot(at.index);
        };
      }
      if (place === 'field' && gapInItems(at) === undefined) return undefined;
      return () => {
        item.reorderInParentSlot(at.index);
      };
    };

  return {
    characterName: locale.object(game.player.instance.def.name).displayName,
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '🪑',
    injuryIcon: '🩹',
    statuses: [
      { name: 'HP', ratio: 0.8 },
      { name: 'スタミナ', ratio: 0.65 },
      { name: '食料', ratio: 0.3 },
      { name: '精神', ratio: 0.55 },
    ],
    // dayは1始まり（GameElementDefinition.md 17節）なので、生存日数は0始まりへ直す。
    elapsedDays: game.world.day - 1,
    hour: game.world.hour,
    minute: game.world.minute,
    weather: '☀️ 灼熱の快晴',
    currentLocation: {
      icon: LOCATION_ICON,
      name: game.map.nameOfInstance(location.instance.instanceId) ?? UNNAMED_LOCATION,
    },
    // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
    explorationRatio:
      location.explorationProgressMax === 0
        ? 0
        : location.explorationProgress / location.explorationProgressMax,
    destinations: location.paths.map((path) => ({
      icon: LOCATION_ICON,
      name:
        game.map.nameOfInstance(new Path(path, codex.propertyNames).destinationInstanceId) ??
        UNNAMED_LOCATION,
      identity: [path.instanceId],
    })),
    fieldItems: [
      ...itemStacks.map((stack) => ({
        ...cardOf(stack, ITEM_ICON, 'field'),
        moveTo: moveInto(stack[0], 'field'),
        reorder: reorderIn(stack[0], 'field'),
      })),
      // 設置物は動かせないので、移動も並び替えも持たない（combinationの相手にはなれる）。
      ...location.fixtureStacks.map((stack) => cardOf(stack, FIXTURE_ICON, 'field')),
    ],
    hand: game.player.handStacks.map((stack) =>
      stack.length === 0
        ? undefined
        : {
            ...cardOf(stack, ITEM_ICON, 'hand'),
            moveTo: moveInto(stack[0], 'hand'),
            reorder: reorderIn(stack[0], 'hand'),
          },
    ),
    cardsIn: (place) => {
      // 怪我はワールド側の効果だけが付け外しするため、moveTo/reorderを持たせない。
      if (place === 'injuries')
        return game.player.injuryStacks.map((stack) => cardOf(stack, INJURY_ICON, 'injuries'));

      const stacks = place === 'equipment' ? game.player.equipmentStacks : stacksIn(slotOf(place));
      return stacks.map((stack) => ({
        ...cardOf(stack, ITEM_ICON, place),
        moveTo: moveInto(stack[0], place),
        reorder: reorderIn(stack[0], place),
      }));
    },
    nameOf: (place) =>
      typeof place === 'string'
        ? (PLACE_NAMES[place] ?? place)
        : locale.object(place.container.def.name).displayName,
    acceptsCards: (place) => slotOf(place) !== undefined,
    combinationOf: (dragged, target) => {
      // ドラッグが動かすのはスタックのうち1つなので、同じカードへ重ねたときはスタックの中の2つを
      // 組み合わせる（石と石のように、自分自身とcombinationできる場合）。
      const [first, second] = target.objects;
      const source = dragged === target ? second : dragged.objects[0];
      if (source === undefined) return undefined;

      const [combination] = first.findMatchingCombinations(source);
      if (combination === undefined) return undefined;
      return () => {
        first.tryExecuteCombination(source, game.player.instance, combination.name, game.session);
      };
    },
  };
}

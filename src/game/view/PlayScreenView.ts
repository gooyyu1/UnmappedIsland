import type { ObjectDef } from '../../domain/defs/ObjectDef';
import type { WorldCodex } from '../../domain/defs/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import { Location } from '../../domain/runtime/views/Location';
import { Path } from '../../domain/runtime/views/Path';
import type { PropertyInfluence } from '../../domain/runtime/PropertyInfluence';
import type { PropertyReading } from '../../domain/runtime/PropertyValue';
import type { WorldObject } from '../../domain/runtime/WorldObject';
import { putIntoSlot } from '../../domain/runtime/slotEntry';
import type { Localization } from '../../locale/Localization';
import type { CraftingMaterial } from './craftingView';
import { craftingActions, craftingMaterials } from './craftingView';
import { characterCardContent } from './characterCard';
import { cardLooksOf } from './cardLooks';
import type { CardPlace, CardPlacement } from './cardPlaces';
import { cardPlacesOf, samePlace } from './cardPlaces';
import type { SlotRef } from '../../art/backgroundArt';
import type { CardContent } from '../ui/Card';
import type { CardKind } from '../looks/theme';
import type { PropertyCategory as PropertyTab } from '../ui/PropertiesPane';
import type { StatusContent, StatusDetail, StatusInfluence } from '../ui/StatusBar';

/**
 * 積み重なったカードの束（ドメインのObjectStackに対応する画面側の1まとまり）。
 *
 * スタックのメンバーはobjectsに全部入っていて、束ねているだけの表示上の都合で1枚に見えている
 * （CardContent.identityも全メンバーのID）。1枚しか無い束もこの形で表す。
 *
 * moveTo・reorder・combinationOfが返す操作はワールドを変えるだけで、画面への反映（表示内容の
 * 作り直し）は呼び出し側の責務。moveToとreorderは「そこへ落とせるか」を、操作を返すか否かで答える。
 * 落とせない場所（持ち歩けない設置物、前詰めの場所の空き枠、出し入れできない怪我など）ではundefinedに
 * なるので、呼び出し側は落とし先の枠を出す前に問い合わせられる。
 */
export interface ObjectCardStack extends CardContent {
  /**
   * この束が映しているワールド上のオブジェクト（先頭が代表）。表示に使う名前・絵は代表から採るが、
   * これは同じ束に入れる条件が「代表ObjectDef列の一致」（ObjectStack）だからで、個体ごとに違い得る
   * 値（プロパティ）を見るときはメンバーを1つずつ読む。
   */
  readonly objects: readonly WorldObject[];

  /** この束が映している物の型（object_defのグローバルID）。要求されている型と突き合わせるのに使う。 */
  readonly objectGlobalId: number;

  /** カードを押して開く子ウィンドウに出す説明文。localeに書かれていなければundefined。 */
  readonly description?: string;

  /** このカードで実行できるアクション（宣言順）。持たないオブジェクトでは空。 */
  readonly actions: readonly CardAction[];

  /** この束が今いる場所。 */
  readonly place: CardPlace;

  /**
   * このカードへdraggedを重ねたときの行き先（受け取れるスロットが無ければundefined、
   * GameElementDefinition.md 7.8節）。**行き先は重ねる物で変わる**ので、カードごとの値ではなく問い合わせ。
   */
  readonly contentsFor: (dragged: ObjectCardStack) => CardPlace | undefined;

  /**
   * 子ウィンドウにタブとして並ぶスロット（`visible_slots`、GameElementDefinition.md 7.11節）。宣言順。
   * **重ねて入れられるかとは別**——中が見えなくても入れられるスロットはある（筏の積荷）。
   */
  readonly visibleSlots: readonly CardPlace[];

  /**
   * 束のうち先頭のcount個を別の場所へ移す操作。atは移した先での置き場所（1つ目にだけ効く）で、
   * 省略すると空いている場所へ入る。動かせない束（設置物・怪我）にはない。移せなかった場合
   * （手持ちが埋まっている等）は何も起きない。
   */
  readonly moveTo?: (place: CardPlace, at?: CardPlacement, count?: number) => (() => void) | undefined;

  /**
   * countを渡した操作（moveTo・putInto）が動かすインスタンスのID。先頭は束の代表＝掴まれていた1つ。
   * どの個体が動くのかの選び方はビューが1箇所で決め（carriedOf）、画面の移動アニメーション
   * （MotionContext.released）はこれに合わせる——ワールドが動かすものと画面が飛ばすものを
   * 食い違わせないため。
   */
  readonly movedIds: (count: number) => readonly number[];

  /**
   * そこへまとめて入れられる最大個数（入れられない場所では0）。**ドラッグ中に何枚ついてくるかを
   * 決める**のに使う（CardDragController）。
   */
  readonly acceptedCountAt?: (place: CardPlace) => number;

  /**
   * そこへcount個入れる操作の見せ方（枠が文言も時間も宣言していなければundefined）。moveToが
   * 「入れられるか」を答えるのに対し、こちらは「入れると何が起きるか」を答える——ドラッグ中の吹き出し。
   */
  readonly putInto?: (place: CardPlace, count?: number) => CardPutIn | undefined;

  /**
   * 同じ場所の中で位置を変える操作。こちらは束ごと動かす（1つずつでは元の束へ合流して戻ってしまうため、
   * SlotSystem.md 3節）。
   */
  readonly reorder?: (at: CardPlacement) => (() => void) | undefined;
}

/**
 * カード1枚だけで完結する操作（ActionSystem.md 1節のactions）。子ウィンドウにボタンとして並べるため、
 * 実行する手段だけでなく表示文字列も持つ（locale/ja.yamlのactions節、Localization.md）。
 */
export interface CardAction {
  /**
   * 宣言の識別子（`actions`のキー）。画面が特定の操作を見分けるためのもので、表示には使わない
   * ——探索だけは、見つかったものを見せる手順が要るので画面側が実行を引き受ける（PlayScene）。
   * 画面の都合で足した操作（製作中オブジェクトのもの、craftingView）は持たない。
   */
  readonly key?: string;

  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。時間を消費しない操作は0。 */
  readonly minutes: number;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;

  /** 今この操作の要件（14節）を満たしているか。falseならボタンを押せなくする。 */
  readonly enabled: boolean;

  /** 満たしていない要件が宣言している理由の文言（14.6節）。宣言が無ければundefined。 */
  readonly reason: string | undefined;
}

/**
 * カードを重ねたときに実行できるcombination。何が起きるかをドラッグ中に見せるため、実行する手段だけで
 * なく表示文字列も持つ（locale/ja.yamlのcombinations節、Localization.md）。
 */
export interface CardCombination {
  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。時間を消費しない組み合わせは0。 */
  readonly minutes: number;
  /**
   * 指が掴んでいたインスタンス。同じ束へ重ねたときは束の2つ目になるため、束の代表とは限らない。
   * 画面側は「掴んでいたカード」の行方を追う（CardTable.MotionContext.released）のに使う。
   *
   * combinationを宣言している側（`self`）とは限らない——逆向きに成立した組み合わせでは、掴んだ札の
   * ほうが宣言している側になる（combinationOf参照）。
   */
  readonly held: WorldObject;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;
}

/**
 * 物を枠へ入れる操作の見せ方（SlotDef.putInDuration・slot_textsのput_in）。かごへしまうのも怪我へ
 * 治療具を当てるのも同じこの1つの操作で、値段と呼び名は枠が決める。
 */
export interface CardPutIn {
  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 入れるのにかかるゲーム内時間（分）。一瞬で入る枠は0。 */
  readonly minutes: number;
}

/**
 * 地図ウィンドウに出す、既知の土地1件。siteは地形生成のサイトindex（IslandMap.sites）で、
 * セーブデータのカード位置（MapCardPosition）と対応付ける恒久キー。
 */
export interface MapLandView {
  readonly site: number;
  readonly card: CardContent;

  /** 今プレイヤーが居る土地か。地図ではこのカードだけを太い枠で強調する。 */
  readonly current: boolean;
}

/** 地図ウィンドウに出す、発見済みの道1本（無向辺）。両端のサイトは必ずmapLandsに含まれる。 */
export interface MapRoadView {
  readonly a: number;
  readonly b: number;
}

/**
 * 子ウィンドウ1つに出るもの一式（Windows.md 1節）。**1つの窓に要るものを1つのまとまりで答える**
 * ——ばらばらのメンバーから呼び出し側が組み立てると、窓を足すたびに組み立ての手順も増える。
 *
 * **画面が覚えているものはここに含めません。** 発見物の枠（直前の探索で何が出たか）と固定表示の印は
 * ワールドではなく画面の記憶なので、呼び出し側が重ねます——explorationRatioが探索率だけを答え、
 * 発見物を答えないのはそのためです。
 */
export interface ObjectWindowView {
  /** 説明のタブに出す札。カードの窓では、借りてきた1枚そのもの（Windows.md 1.1節）。 */
  readonly card: CardContent;
  readonly description: string | undefined;

  /** 最下段に並べる操作。 */
  readonly actions: readonly CardAction[];

  /** タブに並ぶスロット（`visible_slots`の宣言順、GameElementDefinition.md 7.11節）。 */
  readonly slots: readonly CardPlace[];

  /** プロパティのタブに出すカテゴリ（空ならタブを出さない）。 */
  readonly properties: readonly PropertyTab[];

  /** 探索率（探索できない対象ではundefined＝探索のタブを出さない）。 */
  readonly explorationRatio: number | undefined;
}

/**
 * プレイ中の画面が表示する内容。画面の組み立て（PlayScene）とゲーム状態の間を仕切る。
 *
 * 天候・条件・装備・怪我のように、ドメイン側にまだ表示できる形が無い項目はモック
 * （ScreenLayout_Mock.html）と同じ固定値を返す（fromGameSession参照）。
 */
export interface PlayScreenView {
  readonly characterName: string;
  /** キャラクターのobject_defの識別子（表示名ではない）。ポートレートカードの絵を選ぶ（objectArt参照）。 */
  readonly characterArt: string;
  /**
   * ポートレートカードに出す印。動物のカードと同じ規約で、血が流れている傷を負っていれば出る
   * （CardView.md 9節）。負っていなければundefined。
   */
  readonly characterMark: string | undefined;
  /** キャラクタ自身を映す札。ポートレイトの枠と、キャラクタの子ウィンドウが同じ姿で出す1枚。 */
  readonly characterCard: CardContent;

  /** キャラクタ自身の子ウィンドウ（ポートレイト・日時・装備/怪我のボタンから開く）。 */
  readonly characterWindow: ObjectWindowView;

  /** 現在地そのものの子ウィンドウ（現在地の札から開く）。 */
  readonly currentLocationWindow: ObjectWindowView;

  /** その札の子ウィンドウ。**札ごとに変わる**ので、値ではなく問い合わせで答える。 */
  readonly windowOfCard: (stack: ObjectCardStack) => ObjectWindowView;

  /**
   * ステータスエリアに出す候補（statusタグが付いたもの、StatusArea.md）。
   * このうち実際に出すのは、安全域を外れたものと固定表示にされたものだけ（statusRows参照）。
   */
  readonly statuses: readonly StatusContent[];

  /**
   * キャラクタのプロパティのカテゴリ（property_tagsの宣言順）。ステータスエリアの固定表示の
   * 引き当て（ShownStatuses）が読む。子ウィンドウへ出るぶんはcharacterWindow.propertiesが持つ。
   */
  readonly propertyCategories: readonly PropertyTab[];
  /** 条件アイコン。複数同時に付き得るので件数は可変。 */
  readonly conditions: readonly string[];
  readonly equipmentIcon: string;
  readonly injuryIcon: string;
  readonly elapsedDays: number;
  readonly hour: number;
  readonly minute: number;
  /**
   * 空の演出（ScreenLayout.md 7.5節）が読む、今の天気と日射。いずれも語彙を持たないCodexではundefined。
   * 天気は識別子（`light_rain`など、ClimateSystem.md 4.2節）、日射は時間帯と天気を畳んだ実効値。
   */
  readonly weather: string | undefined;
  readonly sunlight: number | undefined;
  /** 陽炎が立つかを決める気温（ClimateSystem.md）。語彙を持たないCodexではundefined。 */
  readonly ambientTemperature: number | undefined;
  /**
   * 状況エリアの窓に出す天気の名前（Localizationのsymbol_texts節）。絵だけでは晴天どうしを
   * 区別できないため、名前は必ず出す（ScreenLayout.md 5節）。天気の語彙を持たないCodexではundefined。
   */
  readonly weatherLabel: string | undefined;
  readonly currentLocation: CardContent;
  /** 現在地のobject_defの識別子（表示名ではない）。土地の絵の遅延ロードの単位（artFiles参照）。 */
  readonly locationArt: string;
  /**
   * そのレーンが映しているスロット。レーンの全面に敷く絵を引くのに使う（backgroundArt参照）——
   * どのスロットにどの絵を敷くかは、画面側ではなく絵のファイル名が決める。
   */
  readonly laneSlot: (place: CardPlace) => SlotRef | undefined;
  /** 現在地の設置物（道・木・建物など、持ち歩けないもの）。 */
  readonly fixtures: readonly ObjectCardStack[];
  /** 現在地に落ちているアイテム（持ち歩けるもの）。 */
  readonly items: readonly ObjectCardStack[];
  /** 手持ちは固定枠スロットなので、空きセルはundefined（プレースホルダー）として並ぶ。 */
  readonly hand: readonly (ObjectCardStack | undefined)[];

  /** 地図ウィンドウに出す既知の土地（現在地と、発見済みの道の両端）。 */
  readonly mapLands: readonly MapLandView[];

  /** 地図ウィンドウに出す発見済みの道。 */
  readonly mapRoads: readonly MapRoadView[];

  /**
   * 子ウィンドウに並べる、その場所の中身（装備・怪我・コンテナの中身）。前詰めスロットなので
   * 空きセルは無い。レーンで常に見えているfixtures/items/handはこちらでは扱わない。
   */
  readonly cardsIn: (place: CardPlace) => readonly ObjectCardStack[];

  /**
   * その型（object_defのグローバルID）そのものを表すカード。インスタンスを持たないので、まだ在るとは
   * 限らない物——枠が受け入れる素材（LaneCell.accepts）——を見せるのに使う。
   */
  readonly cardOfType: (objectGlobalId: number) => CardContent;

  /**
   * その場所が製作中オブジェクトの材料スロットなら、要求している型ごとの枠（そうでなければundefined）。
   * 並びは要求の順で、**もう要求されない型は挙げません**（craftingMaterials）。
   */
  readonly materialsOf: (place: CardPlace) => readonly CraftingMaterial[] | undefined;

  /**
   * 挙げた個体だけを映すカード。**束は割れる**——子ウィンドウは束のうち1個だけを借りるので
   * （Windows.md 1.1節）、借りた1個と枠に残る残りが、それぞれ自分の個体だけを動かすカードになる。
   * 表示も操作も先頭を代表とする点は、スロットの中身から作る束（cardsIn）と同じ。
   */
  readonly cardOfObjects: (objects: readonly WorldObject[], place: CardPlace) => ObjectCardStack;

  /** 子ウィンドウのタイトルに出す、その場所の名前。 */
  /**
   * その場所を映す子ウィンドウの見出し。**スロットの名前を持ち主込みで言う**（「マルコの装備」
   * 「編み籠の中身」）。スロットは必ず持ち主のものなので、名前だけでは何のスロットか分からない。
   */
  /**
   * その場所が映しているスロットの名前（子ウィンドウのタブのラベル）。**持ち主は込めません**
   * ——持ち主の名前はウィンドウの見出しに既に出ているので、タブにまで繰り返す場所が無い。
   */
  readonly slotLabelOf: (place: CardPlace) => string;

  /**
   * その場所が映しているスロットの識別子（スロット名）。**表示名ではなく識別子**で、子ウィンドウの
   * タブの記憶（Settings.openedTab）の鍵になる——言語で変わる表示名を鍵にはできない。
   */
  readonly slotKeyOf: (place: CardPlace) => string;

  /**
   * その場所がカードを受け入れるか（怪我のような読み取り専用の場所はfalse）。中身が空でも
   * 「落とせる場所かどうか」を見せるために、画面側が受け皿の空枠を出すかの判断に使う。
   */
  readonly acceptsCards: (place: CardPlace) => boolean;

  /**
   * その場所が持つ枠の数（`cell_count`、SlotSystem.md 2節。決まっていなければundefined）。
   * 子ウィンドウが空けておく枠の数を決めるのに使う——1枠しか無い場所に4枠空けると「4つ入る」と
   * 誤って伝わる。中身のかさの合計の上限（`capacity`）とは別物。
   */
  readonly cellCountOf: (place: CardPlace) => number | undefined;

  /**
   * draggedをtargetへ重ねたときに実行できるcombination（GameElementDefinition.md 12節）。
   * 実行できる組み合わせが無ければundefined。draggedとtargetが同じ束（その束の上の1枚を元の位置へ
   * 重ねた）なら、束の中の2つを組み合わせる。
   *
   * **落とされた側が受け入れる組み合わせを先に、無ければ掴んだ側が受け入れる組み合わせを探す**
   * （CardInteraction.md 2節）。どちらも宣言順の先頭を採る。マッチはwithタグだけで判定するので、
   * conditionsを満たさず実行が空振りすることはある。
   */
  readonly combinationOf: (dragged: ObjectCardStack, target: ObjectCardStack) => CardCombination | undefined;
}

/**
 * cardsInの答えをこの時点のものに固定したviewを返す（placeを開いていなければそのまま）。
 *
 * cardsInだけは呼んだ時点の生きたワールドを読むため、控えておいたviewをあとから表示すると、その部分に
 * 限って「今」の状態が出てしまう。過去の時点を映す用途（時間経過の再現、PlayScene参照）で使う。
 */
export function withFrozenCards(view: PlayScreenView, place: CardPlace | undefined): PlayScreenView {
  if (place === undefined) return view;

  const frozen = view.cardsIn(place);
  return { ...view, cardsIn: (asked) => (samePlace(asked, place) ? frozen : view.cardsIn(asked)) };
}

/** 場所を映す札の仮のアイコン。土地は種別を持たない（物ではない）ので、種別ごとの表とは別に置く。 */
const LOCATION_ICON = '🗺️';

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/** 探索アクションの名前（locations.yaml）。持っているかどうかで、現在地を探索できるかが決まる。 */
export const EXPLORE_ACTION = 'explore';

/**
 * ステータスエリアへ出す候補になるプロパティに付けるタグ（GameElementDefinition.md 6.7節）。
 * 健康・栄養といったカテゴリのタグと重ねて付ける（満腹度はstatusでありnutritionでもある）。
 */
const STATUS_TAG = 'status';

/**
 * そのスロットの枠の位置が安定しているか（`cell_count`、SlotSystem.md 3節）。空き枠を指した
 * ドロップを、枠そのものへ入れる操作として扱ってよいのはこちらだけ。
 */
function hasFixedCells(owner: WorldObject, slotGlobalId: number): boolean {
  return owner.tryGetSlot(slotGlobalId)?.def.cellCount !== undefined;
}

/**
 * 束のうち、まとめての操作が動かす先頭のcount個。**どの個体が動くのかはここだけが決める**——
 * 実際に動かす側（moveTo・putInto）と、動きを見せる側（movedIds）の両方がここを通る。
 */
function carriedOf<T>(stack: readonly T[], count: number): readonly T[] {
  return stack.slice(0, Math.max(1, count));
}

/** スロットの中身を、積み重なっているまとまりごとに分けたもの。 */
function stacksIn(
  dest: { owner: WorldObject; slotId: number } | undefined,
): readonly (readonly WorldObject[])[] {
  const slot = dest?.owner.tryGetSlot(dest.slotId);
  return slot === undefined ? [] : slot.cells.flatMap((cell) => (cell === undefined ? [] : [cell.members]));
}

/**
 * 生成済みのゲーム一式から画面の表示内容を作る。設置物レーン・アイテムレーン・ハンドレーンは
 * 現在地とキャラクターのスロットの中身をそのまま映す。
 *
 * ワールドの状態を写し取るだけなので、アクションでワールドが変わったら作り直す（PlayScene参照）。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;
  const places = cardPlacesOf(game.player, location, codex);
  const looks = cardLooksOf(codex, locale, game.world.minutesPerTick);

  const characterTexts = locale.object(game.player.instance.def.name);

  /**
   * そのカードへ重ねたdraggedの行き先（受け取れるスロットが無ければundefined、
   * GameElementDefinition.md 7.8節）。
   *
   * **スロットがあるなら入れられる**が既定で、入れられて困るスロットが自分で断る（`placement`、
   * 同 7.7節）。複数が受け入れるときは**宣言順で最初のもの**——編み籠は item でも fixture でもあるので、
   * 筏へ重ねれば積荷（items）に入り、設置物の枠には落ちない。
   */
  const contentsOf = (object: WorldObject, dragged: ObjectDef): CardPlace | undefined => {
    const slotDef = object.def.slotDefs.find(
      (candidate) => candidate.manualPlacement && candidate.acceptsAnywhere(dragged),
    );
    return slotDef === undefined ? undefined : { container: object, slotGlobalId: slotDef.globalId };
  };

  /**
   * その物の子ウィンドウにタブとして並ぶスロット（`visible_slots`、GameElementDefinition.md
   * 7.11節）。宣言順がそのまま並び順で、名乗らない物では空。
   */
  const visiblePlacesOf = (object: WorldObject): readonly CardPlace[] =>
    object.def.visibleSlotGlobalIds.map((slotGlobalId) => places.placeOf(object, slotGlobalId));

  /**
   * そのカードで実行できるアクション。宣言を読むのは操作対象の代表（represented_by、ActionSystem.md
   * 1節）で、実行はカードが映しているオブジェクト自身へ頼む（代表の解決はエンジン側が行う）。
   * 水筒のカードに、中身の水のdrinkがボタンとして出る。
   *
   * `showMenu: never`のアクションはボタンにしない（GameElementDefinition.md 11.1節）。プレイヤーが
   * 押す機会が無い操作——動物の1手のように時間の側が起こすもの——のための宣言。
   *
   * 製作中オブジェクトの操作（craftingView）も同じ並びに入る。**宣言から来たものと画面の都合で
   * 足したものを分けない**——ボタンにする側は、どちらも同じ1つの並びとして受け取る。
   */
  const actionsOf = (instance: WorldObject): readonly CardAction[] => {
    const target = instance.resolveInteractionTarget();
    const texts = locale.object(target.def.name);
    const fromDefinition = target.def.actions
      .filter((action) => action.showMenu === 'always')
      .map((action) => {
        const declared = texts.action(action.name);
        const unmet = instance.actionUnmetRequirement(action.name, game.player.instance);
        return {
          key: action.name,
          name: declared.displayName,
          description: declared.description,
          minutes: instance.actionMinutes(action.name, game.player.instance),
          execute: () => {
            instance.tryExecuteAction(action.name, game.player.instance, game.session);
          },
          enabled: unmet === undefined,
          reason: unmet?.reasonName === undefined ? undefined : locale.reason(unmet.reasonName),
        };
      });
    return [...craftingActions(instance, codex, game), ...fromDefinition];
  };

  /**
   * プロパティを相手として指すときの表示（対応表の表示名と絵文字。プロパティは絵を持たない）。
   * 相手のプロパティは**同じ物のプロパティ**なので、名前はその物の対応表から引く。
   */
  const propertyLabelOf = (
    object: WorldObject,
    propertyGlobalId: number,
  ): { key: string | undefined; name: string; icon: string | undefined; art: string | undefined } => {
    const name = codex.propertyNames.getName(propertyGlobalId);
    const texts = locale.object(object.def.name).prop(name);
    return { key: name, name: texts.displayName, icon: texts.icon, art: undefined };
  };

  /**
   * 影響1件（ステータス詳細ウィンドウ、Windows.md 8節）。相手はobject自身の別のプロパティか、
   * 影響を宣言しているオブジェクト（怪我・治療具）そのもの。
   *
   * movedはその増減で動く側のプロパティで、記号の色（良し悪し）だけがこれを見る。読めない相手
   * （プロパティを持たないオブジェクト）は悪化としない。
   */
  const influenceOf = (
    object: WorldObject,
    influence: PropertyInfluence,
    moved: PropertyReading | undefined,
  ): StatusInfluence => {
    const counterpart = influence.counterpart;
    const shown =
      counterpart.kind === 'object'
        ? {
            key: undefined,
            name: looks.nameOf(counterpart.object),
            icon: looks.iconOf(counterpart.object.def),
            art: looks.artOf(counterpart.object.def, counterpart.object),
          }
        : propertyLabelOf(object, counterpart.propertyGlobalId);

    return {
      key: shown.key,
      name: shown.name,
      icon: shown.icon,
      art: shown.art,
      reversible: influence.reversible,
      increases: influence.increases,
      worsens: influence.increases === (moved?.worsensUpward ?? false),
      active: influence.active,
    };
  };

  /**
   * そのプロパティ1件の詳細（意味・今いる段・影響の出入り）。**持ち主から読む**——同じ名前の
   * プロパティを別の物が持っていても、値も影響もその物のもの。
   */
  const detailOf = (object: WorldObject, reading: PropertyReading): StatusDetail => {
    const influences = object.readInfluences(codex.propertyNames.getId(reading.name));
    return {
      description: locale.object(object.def.name).prop(reading.name).description,
      stage:
        reading.stage === undefined
          ? undefined
          : {
              name: locale.stage(reading.stage.name),
              span: reading.stage.span,
              boundaries: reading.stage.boundaries,
            },
      // 与えている影響で動くのは相手、受けている影響で動くのは自分（influenceOfのmoved）。
      given: influences.given.map((influence) =>
        influenceOf(object, influence, movedByGiven(object, influence)),
      ),
      received: influences.received.map((influence) => influenceOf(object, influence, reading)),
    };
  };

  /** 与えている影響で動く側＝相手のプロパティ。相手がオブジェクトなら読める値が無い。 */
  const movedByGiven = (object: WorldObject, influence: PropertyInfluence): PropertyReading | undefined =>
    influence.counterpart.kind === 'property'
      ? object.readProperty(influence.counterpart.propertyGlobalId)
      : undefined;

  /** タグが付いたそのオブジェクトのプロパティを、表示名に直して並べる。未宣言のタグでは空。 */
  const entriesWithTag = (object: WorldObject, tagGlobalId: number | undefined): readonly StatusContent[] =>
    tagGlobalId === undefined
      ? []
      : object.readPropertiesWithTag(tagGlobalId).map((reading) => {
          const texts = locale.object(object.def.name).prop(reading.name);
          return {
            key: reading.name,
            name: texts.displayName,
            icon: texts.icon,
            value: reading.value,
            ratio: reading.ratio,
            alert: reading.alert,
            worsensUpward: reading.worsensUpward,
            detail: detailOf(object, reading),
          };
        });

  /**
   * そのオブジェクトのプロパティを、カテゴリ（`property_tags`、GameElementDefinition.md 6.7節）ごとに
   * 並べる。子ウィンドウのプロパティのタブになる（Windows.md 6節）。
   *
   * **タグの付いたプロパティだけを出す。** 見せるかどうかは型ごとの真偽値ではなく、プロパティ1つ
   * ずつが「人に見せる値か」を名乗ることで決まる——今タグを持つのはキャラクタだけなので、他の型では
   * 空になりタブそのものが出ない。
   */
  const propertiesOf = (object: WorldObject): readonly PropertyTab[] => {
    // タグのIDは宣言順に振られる（WorldCodex.propertyTagNames）ため、昇順に見ればタブの並び順になる。
    const categories: PropertyTab[] = [];
    for (let tagGlobalId = 0; tagGlobalId < codex.propertyTagNames.count; tagGlobalId++) {
      const entries = entriesWithTag(object, tagGlobalId);
      if (entries.length > 0)
        categories.push({
          name: locale.propertyTag(codex.propertyTagNames.getName(tagGlobalId)).displayName,
          entries,
        });
    }
    return categories;
  };

  const propertyCategories = propertiesOf(game.player.instance);

  const stackOf = (instances: readonly WorldObject[], place: CardPlace): ObjectCardStack => ({
    // 見た目は代表のものを出す。個体ごとに違い得る値（状態のバー）を持つが、名前も絵も操作も代表の
    // ものなので、1枚に束ねたカードが映すのは代表の姿で揃える。
    ...looks.contentOf(instances[0]),
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    // スタックが渡してくる並びは中身が入れ替わり続ける実体（ObjectStack.members）なので、写し取る。
    objects: [...instances],
    objectGlobalId: instances[0].def.globalId,
    movedIds: (count) => carriedOf(instances, count).map((instance) => instance.instanceId),
    description: locale.object(instances[0].def.name).description,
    actions: actionsOf(instances[0]),
    place,
    contentsFor: (dragged) => contentsOf(instances[0], dragged.objects[0].def),
    visibleSlots: visiblePlacesOf(instances[0]),
  });

  /**
   * 実体化された土地の表示名。生成側（IslandMap）が持つのは識別子の組み合わせだけなので、
   * 表示文字列はここで対応表から組み立てる（Localization.md）。
   */
  const locationNameOf = (instanceId: number, defName?: string): string => {
    const name = game.map.nameOfInstance(instanceId);
    if (name !== undefined) return locale.locationName(name);

    // 名前を付けるのは地形生成だけ（IslandMap）なので、島の外の場所——筏・外洋・本土
    // （voyage.yaml）——はそこに載っていない。そういう場所は型の表示名がそのまま名前になる。
    const displayName = defName === undefined ? undefined : locale.object(defName).displayName;
    return displayName === undefined || displayName === defName ? UNNAMED_LOCATION : displayName;
  };

  const pathTagId = codex.tagNames.tryGetId('path');
  /**
   * 道の設置物がカードに映すもの（道以外はundefinedで、設置物そのものの名前と絵をそのまま使う）。
   * 道は「どこへ繋がっているか」だけが意味を持つため、行き先の土地の名前と絵を出す。
   */
  const destinationOf = (
    fixture: WorldObject,
  ): { icon: string; name: string; art: string | undefined; kind: CardKind; road: true } | undefined => {
    if (pathTagId === undefined || !fixture.def.tags.includes(pathTagId)) return undefined;

    const path = new Path(fixture, codex.propertyNames);
    return {
      icon: LOCATION_ICON,
      name: locationNameOf(path.destinationInstanceId, path.destination?.def.name),
      art: path.destination?.def.name,
      // 名前も絵も行き先のものなので、道であることは桟の矢印だけが示す（枠の色は現在地と同じ、
      // どちらも場所を映す札のため）。
      kind: 'location',
      road: true,
    };
  };

  /**
   * 地図ウィンドウに出す既知の土地と発見済みの道。発見は「pathオブジェクトがfixturesスロットに
   * 出ているか」で表される（ExplorationSystem.md 3節）ため、フラグではなく全土地の公開済みの道から
   * 導出する。道は両端で対になっている（発見も対で起きる）ので、無向辺として1本にまとめる。
   */
  const discoveredMap = (): { lands: readonly MapLandView[]; roads: readonly MapRoadView[] } => {
    const siteOf = new Map<number, number>();
    game.map.siteInstanceIds.forEach((instanceId, site) => {
      if (instanceId !== 0) siteOf.set(instanceId, site);
    });

    const root = location.instance.findRoot();
    const known = new Set<number>();
    const currentSite = siteOf.get(location.instance.instanceId);
    if (currentSite !== undefined) known.add(currentSite);

    const roads = new Map<string, MapRoadView>();
    for (const [instanceId, site] of siteOf) {
      const land = root.findDescendantByInstanceId(instanceId);
      if (land === undefined) continue;
      for (const fixture of new Location(land, codex).fixtures) {
        if (pathTagId === undefined || !fixture.def.tags.includes(pathTagId)) continue;
        const destination = siteOf.get(new Path(fixture, codex.propertyNames).destinationInstanceId);
        if (destination === undefined) continue;
        known.add(site);
        known.add(destination);
        const [a, b] = site < destination ? [site, destination] : [destination, site];
        roads.set(`${a}/${b}`, { a, b });
      }
    }

    const lands: MapLandView[] = [...known]
      .sort((a, b) => a - b)
      .map((site) => {
        const instanceId = game.map.siteInstanceIds[site];
        return {
          site,
          card: {
            icon: LOCATION_ICON,
            name: locationNameOf(instanceId),
            art: root.findDescendantByInstanceId(instanceId)?.def.name,
            kind: 'location',
          },
          current: site === currentSite,
        };
      });
    return { lands, roads: [...roads.values()] };
  };
  const discovered = discoveredMap();

  /**
   * itemを場所placeへ入れる操作（そこへは入れられないならundefined）。入れられるかの判断はすべて
   * ドメインに任せる（WorldObject.rejectionForMoveTo）——捻挫が身体から剥がれないのも、ヤシの木が
   * 手に持てないのも、画面が場所ごとに覚えている決まりではなくワールド側の宣言の帰結。
   */
  const moveInto =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement, count = 1): (() => void) | undefined => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;
      if (stack[0].rejectionForMoveTo(dest.owner, dest.slotId) !== undefined) return undefined;

      // まとめて運んできたぶんも、1つずつ入れるのと同じことをする（時間も個数ぶんかかる）。
      // 入る個数を超えて頼まれても、超えたぶんは枠が断るだけ。
      const carried = carriedOf(stack, count);
      const put = (item: WorldObject, first: boolean): void => {
        // 位置の指定が効くのは1つ目だけ。残りは同じ束へ合流するか、空いている枠へ入る。
        if (at === undefined || !first) {
          item.moveToSlot(dest.owner, dest.slotId);
        } else if (at.kind === 'cell' && hasFixedCells(dest.owner, dest.slotId)) {
          item.moveToSlotAtCell(dest.owner, dest.slotId, at.index);
        } else {
          // 前詰めスロットの空き枠は末尾の受け皿だけなので、その位置の隙間へ落としたものとして扱う
          // （枠の位置がそのまま並びの終わりを指す）。
          item.moveToSlotAtGap(dest.owner, dest.slotId, at.index);
        }
      };

      // 時間のかかる枠（手当てなど）はここで時間を進める。どの経路で入れても同じ値段になる。
      return () => {
        carried.forEach((item, index) =>
          putIntoSlot(item, dest.owner, dest.slotId, game.player.instance, game.session, () =>
            put(item, index === 0),
          ),
        );
      };
    };

  /** stackのうち、placeへまとめて入れられる個数（入れられない場所では0）。 */
  const acceptedCountIn =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace): number => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return 0;

      return stack[0].acceptedCountForMoveTo(stack.slice(1), dest.owner, dest.slotId);
    };

  /**
   * itemをplaceへ入れるとどうなるか（吹き出しに出す文言と時間）。入れられない場所と、文言も時間も
   * 宣言していない枠ではundefined——ただ位置が変わるだけの移動には説明が要らない。
   */
  const putIntoTexts =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, count = 1): CardPutIn | undefined => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;

      const slotDef = dest.owner.def.getSlotDef(dest.slotId);
      if (slotDef === undefined) return undefined;

      const texts = locale.slot(slotDef.name).putIn;
      // まとめて入れるなら時間も個数ぶん。1つずつ入れるのと同じことをするため（moveInto参照）。
      const minutes = carriedOf(stack, count).reduce(
        (total, item) => total + slotDef.putInMinutes(dest.owner, item, game.player.instance),
        0,
      );
      if (texts === undefined && minutes === 0) return undefined;
      return {
        name: texts?.displayName ?? locale.slot(slotDef.name).displayName,
        description: texts?.description,
        minutes,
      };
    };

  /**
   * 束のカード1枚ぶん（表示内容と操作の一そろい）。
   *
   * **ワールドが渡してくる並びは、中身が入れ替わり続ける実体（ObjectStack.members）なので、
   * ここで写し取る。** 操作の閉包（moveTo・movedIds等）まで写した並びを見ないと、経過の途中経過
   * （RecordedView）を再生する頃には実体が空になっていて、端の表示の試し打ち（PlayScene.cardEdges）
   * が先頭の無い束を踏む。
   */
  const cardOfStack = (live: readonly WorldObject[], place: CardPlace): ObjectCardStack => {
    const stack = [...live];
    return {
      ...stackOf(stack, place),
      moveTo: moveInto(stack, place),
      acceptedCountAt: acceptedCountIn(stack, place),
      putInto: putIntoTexts(stack, place),
      reorder: reorderIn(stack[0]),
    };
  };

  /**
   * selfが宣言しているcombinationsのうち、draggedにマッチする先頭を実行する手段（無ければundefined）。
   * heldは指が掴んでいたインスタンスで、self・draggedのどちらの役でもありうる（CardCombination.held参照）。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、宣言順の先頭を採る。
   */
  const combinationWith = (
    self: WorldObject,
    dragged: WorldObject,
    held: WorldObject,
  ): CardCombination | undefined => {
    const [combination] = self.findMatchingCombinations(dragged);
    if (combination === undefined) return undefined;

    const texts = locale.object(self.def.name).combination(combination.name);
    return {
      name: texts.displayName,
      description: texts.description,
      minutes: self.combinationMinutes(dragged, game.player.instance, combination.name),
      held,
      execute: () => {
        self.tryExecuteCombination(dragged, game.player.instance, combination.name, game.session);
      },
    };
  };

  /** itemを同じ場所の中で動かす操作（動かせない位置ならundefined）。今いるスロットの中だけで完結する。 */
  const reorderIn =
    (item: WorldObject) =>
    (at: CardPlacement): (() => void) | undefined => {
      const parent = item.parent;
      const fixed =
        parent !== undefined && parent.getSlotByLocalId(item.parentSlotLocalId).def.cellCount !== undefined;
      if (at.kind === 'cell' && fixed) {
        return () => {
          item.moveToCellInParentSlot(at.index);
        };
      }
      return () => {
        item.reorderInParentSlot(at.index);
      };
    };

  /**
   * キャラクタ自身を映す札。**自分のインスタンスを識別子として名乗る**——レーンに並ぶ他の札と同じく、
   * 差し替えで同じ札だと分かり、子ウィンドウへ貸し出したときに元の枠が分かるようにするため。
   */
  const characterCard: CardContent = {
    ...characterCardContent(game.player.instance.def.name, locale),
    name: characterTexts.displayName,
    mark: looks.markOf(game.player.instance),
    identity: [game.player.instance.instanceId],
  };

  const currentLocationCard: CardContent = {
    icon: LOCATION_ICON,
    name: locationNameOf(location.instance.instanceId, location.instance.def.name),
    art: location.instance.def.name,
    kind: 'location',
    // 現在地の札も、その場所が宣言したバーを出す（航海の進み、docs/world/Voyage.md 4節）。
    gauges: looks.gaugesOf(location.instance),
  };

  return {
    characterName: characterTexts.displayName,
    characterArt: game.player.instance.def.name,
    characterMark: looks.markOf(game.player.instance),
    characterCard,
    characterWindow: {
      card: characterCard,
      description: characterTexts.description,
      actions: actionsOf(game.player.instance),
      slots: visiblePlacesOf(game.player.instance),
      properties: propertyCategories,
      explorationRatio: undefined,
    },
    currentLocationWindow: {
      card: currentLocationCard,
      description: locale.object(location.instance.def.name).description,
      actions: actionsOf(location.instance),
      slots: visiblePlacesOf(location.instance),
      properties: propertiesOf(location.instance),
      // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
      explorationRatio: location.instance.def.actions.some((action) => action.name === EXPLORE_ACTION)
        ? location.explorationProgressMax === 0
          ? 0
          : location.explorationProgress / location.explorationProgressMax
        : undefined,
    },
    windowOfCard: (stack) => ({
      card: stack,
      description: stack.description,
      actions: stack.actions,
      slots: stack.visibleSlots,
      properties: propertiesOf(stack.objects[0]),
      explorationRatio: undefined,
    }),
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '👕',
    injuryIcon: '🩹',
    statuses: entriesWithTag(game.player.instance, codex.propertyTagNames.tryGetId(STATUS_TAG)),
    propertyCategories,
    // dayは1始まり（GameElementDefinition.md 17節）なので、生存日数は0始まりへ直す。
    elapsedDays: game.world.day - 1,
    hour: game.world.hour,
    minute: game.world.minute,
    weather: game.world.weather,
    sunlight: game.world.sunlight,
    ambientTemperature: game.world.ambientTemperature,
    weatherLabel:
      game.world.weather === undefined ? undefined : locale.symbol(game.world.weather).displayName,
    currentLocation: currentLocationCard,
    locationArt: location.instance.def.name,
    laneSlot: (place) => {
      const found = places.slotOf(place);
      if (found === undefined) return undefined;
      const slot = found.owner.def.getSlotDef(found.slotId);
      return slot === undefined ? undefined : { owner: found.owner.def.name, slot: slot.name };
    },
    // 並び方はプレイヤーが地形をどう捉えているかで変わるため、同じスロットの中での並び替えを許す。
    // ヤシの木を持ち歩けないのはmoveIntoが弾くからで、このレーンが読み取り専用だからではない。
    fixtures: location.fixtureStacks.map((stack) => ({
      ...cardOfStack(stack, 'fixtures'),
      // 道だけは名前と絵が行き先のものに差し替わる（destinationOf参照）。
      ...destinationOf(stack[0]),
    })),
    items: location.itemStacks.map((stack) => cardOfStack(stack, 'items')),
    hand: game.player.handStacks.map((stack) =>
      stack.length === 0 ? undefined : cardOfStack(stack, 'hand'),
    ),
    mapLands: discovered.lands,
    mapRoads: discovered.roads,
    cardsIn: (place) => {
      const stacks =
        place === 'equipment'
          ? game.player.equipmentStacks
          : place === 'injuries'
            ? game.player.injuryStacks
            : stacksIn(places.slotOf(place));
      return stacks.map((stack) => cardOfStack(stack, place));
    },
    cardOfType: looks.typeContentOf,
    materialsOf: (place) =>
      typeof place === 'object' && 'container' in place
        ? craftingMaterials(place.container, codex)
        : undefined,
    // 道の差し替え（destinationOf）も通す。設置物レーンの束を割ったときに、行き先ではなく道そのものの
    // 名前が出てしまわないようにするため。
    cardOfObjects: (objects, place) => ({ ...cardOfStack(objects, place), ...destinationOf(objects[0]) }),
    slotLabelOf: (place) => {
      const slot = places.slotOf(place);
      if (slot === undefined) return typeof place === 'string' ? place : looks.nameOf(place.container);
      return locale.slot(codex.slotNames.getName(slot.slotId)).displayName;
    },
    slotKeyOf: (place) => {
      const slot = places.slotOf(place);
      return slot === undefined
        ? typeof place === 'string'
          ? place
          : String(place.container.instanceId)
        : codex.slotNames.getName(slot.slotId);
    },
    acceptsCards: (place) => {
      const slot = places.slotOf(place);
      const slotDef = slot === undefined ? undefined : slot.owner.def.getSlotDef(slot.slotId);
      return slotDef !== undefined && codex.admitsBroughtObjects(slotDef);
    },
    cellCountOf: (place) => {
      const slot = places.slotOf(place);
      return slot === undefined ? undefined : slot.owner.def.getSlotDef(slot.slotId)?.cellCount;
    },
    combinationOf: (dragged, target) => {
      // ドラッグが動かすのはスタックのうち1つなので、同じカードへ重ねたときはスタックの中の2つを
      // 組み合わせる（石と石のように、自分自身とcombinationできる場合）。
      const [first, second] = target.objects;
      const held = dragged === target ? second : dragged.objects[0];
      if (held === undefined) return undefined;

      // 落とされた側を先に、次に掴んだ側を見る（CardInteraction.md 2節）。素材側に1つ書けば、
      // 道具を素材へ運んでも素材を道具へ運んでも同じ組み合わせが成立する。
      return combinationWith(first, held, held) ?? combinationWith(held, first, held);
    },
  };
}

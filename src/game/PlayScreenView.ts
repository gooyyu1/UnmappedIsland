import type { AlertLevel } from '../domain/defs/AlertLevel';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Location } from '../domain/runtime/views/Location';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import { putIntoSlot } from '../domain/runtime/slotEntry';
import { currentStep, finishedStepRatio, stepSupplyRatio } from '../domain/runtime/crafting';
import { IN_PROGRESS_TAG, MATERIALS_SLOT, PROGRESS_PROPERTY } from '../loader/inProgressObjects';
import type { Localization } from '../locale/Localization';
import { recipeOf } from './recipeList';
import type { SlotRef } from './ui/backgroundArt';
import type { CardAlertBar, CardContent, CardFill } from './ui/Card';
import type { CardKind } from './ui/theme';
import type { PropertyTab } from './ui/PropertyWindow';
import type { StatusContent } from './ui/StatusBar';

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * カードが並ぶ場所（＝ワールド上の1つのスロット）の名前。名前はスロット名そのもので、レーンと
 * 子ウィンドウの対応付けに使う。
 *
 * 今後コンテナ（箱・かご）の中身も同じ子ウィンドウで見せるため、ここに置き場所を足していけるよう
 * 移動の宛先は名前で指す（moveTo）。「どのレーンの隣か」という暗黙の対応は持たない。
 */
export type CardPlace =
  'fixtures' | 'items' | 'hand' | 'equipment' | 'injuries' | { readonly container: WorldObject };

/**
 * 2つの場所が同じか。コンテナの場所は映しているインスタンスで見分ける（同じ型のコンテナが複数あっても
 * 中身は別なので、型では一意に決まらない）。
 */
export function samePlace(a: CardPlace, b: CardPlace): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.container === b.container;
}

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

  /** カードを押して開く子ウィンドウに出す説明文。localeに書かれていなければundefined。 */
  readonly description?: string;

  /** このカードで実行できるアクション（宣言順）。持たないオブジェクトでは空。 */
  readonly actions: readonly CardAction[];

  /** この束が今いる場所。 */
  readonly place: CardPlace;

  /**
   * 代表がコンテナ（containerタグ、containers.yaml）なら、その中身を映す場所。
   * 画面側はこれを持つカードをタップで開けるようにする。
   */
  readonly contents?: CardPlace;

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
   * 画面側は「掴んでいたカード」の行方を追う（CardMotion.MotionContext.released）のに使う。
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
  /** 条件アイコン。複数同時に付き得るので件数は可変。 */
  readonly conditions: readonly string[];
  readonly equipmentIcon: string;
  readonly injuryIcon: string;
  /**
   * ステータスエリアに出す候補（statusタグが付いたもの、StatusArea.md）。
   * このうち実際に出すのは、安全域を外れたものと固定表示にされたものだけ（statusRows参照）。
   */
  readonly statuses: readonly StatusContent[];

  /**
   * プロパティウィンドウのタブ一式（property_tagsの宣言順）。キャラクターが1つも持たないタグは
   * 空のタブになるだけなので落とす。
   */
  readonly propertyCategories: readonly PropertyTab[];
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
  /** 現在地のobject_defの識別子（表示名ではない）。土地の絵の遅延ロードの単位（locationArt参照）。 */
  readonly locationArt: string;
  /**
   * そのレーンが映しているスロット。レーンの全面に敷く絵を引くのに使う（backgroundArt参照）——
   * どのスロットにどの絵を敷くかは、画面側ではなく絵のファイル名が決める。
   */
  readonly laneSlot: (place: CardPlace) => SlotRef | undefined;
  /** 現在地の探索率（0〜1）。100%に達しても探索は続けられる（ExplorationSystem.md 2節）。 */
  readonly explorationRatio: number;
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

  /** 子ウィンドウのタイトルに出す、その場所の名前。 */
  /**
   * その場所を映す子ウィンドウの見出し。**スロットの名前を持ち主込みで言う**（「マルコの装備」
   * 「編み籠の中身」）。スロットは必ず持ち主のものなので、名前だけでは何のスロットか分からない。
   */
  readonly nameOf: (place: CardPlace) => string;

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

/** 絵がまだ無いオブジェクトの、種別ごとの仮のアイコン（iconOf参照）。 */
const LOCATION_ICON = '🗺️';
const KIND_ICONS: Readonly<Record<ObjectKind, string>> = {
  item: '📦',
  food: '🍎',
  container: '🧺',
  tool: '🔨',
  fixture: '🌳',
  injury: '🩹',
  animal: '🐾',
};

/**
 * 物そのものの型が決める種別（kindOf）。カードの枠の色にも仮のアイコンにもこれを使う。
 * 道とキャラクタはカードの見せ方であって物の型ではないので、ここには入らない。
 */
type ObjectKind = Extract<CardKind, 'item' | 'food' | 'container' | 'tool' | 'fixture' | 'injury' | 'animal'>;

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/**
 * ステータスエリアへ出す候補になるプロパティに付けるタグ（GameElementDefinition.md 6.7節）。
 * 健康・栄養といったカテゴリのタグと重ねて付ける（満腹度はstatusでありnutritionでもある）。
 */
const STATUS_TAG = 'status';

/**
 * カードの下端に汎用の値バー（緑から赤へ寄る、CardView.md 8.1節）として出すプロパティに付けるタグ
 * （GameElementDefinition.md 6.7節）。耐久度・炉の残り薪など、意味は物ごとに違うが見せ方は同じ量に付ける。
 *
 * UI側は「gaugeタグを持つ物がこのバーを出す」とだけ知っていて、どの名前のプロパティかは知らない。
 * 後から足された物も、既存のプロパティ（例えば独自の耐久度）にこのタグを付けるだけで同じバーに出せる。
 */
const GAUGE_TAG = 'gauge';

/**
 * カードの下端に、域（alert）から色を引くバー（CardView.md 8.2節）として出すプロパティに付けるタグ
 * （GameElementDefinition.md 6.7節）。残っている傷・意識のように、**塗りの長さだけでは良し悪しが
 * 読めない量**——増えるほど悪い物と減るほど悪い物が混ざる——に付ける。gaugeタグ（値そのものから
 * 色を引く）とは色の引き方が異なるため別のタグにする。
 *
 * UI側は「alert_gaugeタグを持つ物がこのバーを出す」とだけ知っていて、色の向き（worsensUpward）は
 * タグ付けされたプロパティ自身のstagesから自動的に決まる（PropertyDef.alertDirection）。
 */
const ALERT_GAUGE_TAG = 'alert_gauge';

/**
 * 中身のバー（液体の残量、CardView.md 8.3節）の塗り色を宣言するプロパティに付けるタグ
 * （GameElementDefinition.md 6.7節、LiquidContainerSystem.md 2節・4.1節）。
 *
 * UI側は「fill_colorタグを持つプロパティの値が塗りの色」とだけ知っていて、液体の種類も
 * プロパティの名前も知らない。宣言していない液体は灰色で出る。
 */
const FILL_COLOR_TAG = 'fill_color';

/**
 * 気を失っていることを言う覆い（overlayOf、CardView.md 9.1節・VitalsSystem.md 6節）を判定するために
 * 読むプロパティの名前。意識のバー自体はalert_gaugeタグ経由で汎用に出すが、覆いを出すかどうかは
 * `unconscious`という段の名前（UNCONSCIOUS_STAGE）と対で決まる仕組みなので、こちらは名前を直読みする。
 */
const CONSCIOUSNESS_PROPERTY = 'consciousness';

/**
 * カードの輪郭を明滅させるかを決めるプロパティの名前（animals.yaml・CardView.md 3節）。安全域を外れている間だけ明滅する。
 *
 * UI側は「この名前のプロパティが安全域を外れたら明滅する」とだけ知っていて、何がどれだけ危ないかは
 * 一切知らない（段のしきい値はワールド側の宣言）。
 */
const WARINESS_PROPERTY = 'wariness';

/**
 * 治療具を当てておくスロットの名前と、当たっているカードへ出す印
 * （injuries.yaml・CardView.md 9節 カードの印）。
 *
 * **手当ての有無で絵を差し替えない。** 差し替えると、怪我の部位 × 治療具の数だけ絵が要る。
 */
const TREATMENT_SLOT = 'treatment';
const TREATED_MARK = '🩹';

/**
 * 血が流れていることを言う印と、それを決めるプロパティの名前
 * （injuries.yaml・VitalsSystem.md 9節）。
 *
 * **負っている本人にも出す。** 傷のカードは開かないと見えないので、そこだけに出していると、
 * レーンを流し見しているあいだに失血が進む。手当てが要ることは、傷を開く前に分かる必要がある。
 *
 * 手当て済みの印より優先する。手当てをしてもまだ流れているなら、伝えるべきは「当ててある」ではなく
 * 「まだ止まっていない」のほう。
 */
const BLEEDING_PROPERTY = 'bleeding';
const BLEEDING_MARK = '🩸';

/**
 * 気を失っていることを言う覆いと、それを決める段の名前（VitalsSystem.md 6節）。
 *
 * UI側は「意識がこの名前の段に居たら覆いを出す」とだけ知っていて、何がどれだけ意識を奪ったかは
 * 知らない。段の名前を宣言しているのはワールドの側だけ（`load`の`too_heavy`と同じ分担）。
 */
const UNCONSCIOUS_STAGE = 'unconscious';

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

  const characterTexts = locale.object(game.player.instance.def.name);
  /** タグが付いたキャラクターのプロパティを、表示名に直して並べる。未宣言のタグでは空。 */
  const entriesWithTag = (tagGlobalId: number | undefined): readonly StatusContent[] =>
    tagGlobalId === undefined
      ? []
      : game.player.instance.readPropertiesWithTag(tagGlobalId).map((reading) => ({
          key: reading.name,
          name: characterTexts.prop(reading.name).displayName,
          value: reading.value,
          ratio: reading.ratio,
          alert: reading.alert,
          worsensUpward: reading.worsensUpward,
        }));

  // タグのIDは宣言順に振られる（WorldCodex.propertyTagNames）ため、昇順に見ればタブの並び順になる。
  const propertyCategories: PropertyTab[] = [];
  for (let tagGlobalId = 0; tagGlobalId < codex.propertyTagNames.count; tagGlobalId++) {
    const entries = entriesWithTag(tagGlobalId);
    if (entries.length > 0)
      propertyCategories.push({
        name: locale.propertyTag(codex.propertyTagNames.getName(tagGlobalId)).displayName,
        entries,
      });
  }

  const gaugeTagId = codex.propertyTagNames.tryGetId(GAUGE_TAG);
  /**
   * カードの下端に出す値バー（0〜1、耐久度・炉の残り薪など）。gaugeタグを持つプロパティが無い物、
   * 持っていても上下限（range）が無く割合を定義できない物はundefined。
   *
   * 複数付いていれば、propsの宣言順で最初の1つ（WorldObject.exhaustedStageと同じ規約）。
   * 1つの物には1つしか付けない前提で、2つ以上付くと片方が静かに出なくなる
   * （`tests/worldCodex/cardBarTags.test.ts` がこの前提を検査する）。
   */
  const gaugeOf = (object: WorldObject): number | undefined =>
    gaugeTagId === undefined ? undefined : object.readPropertiesWithTag(gaugeTagId).at(0)?.ratio;

  const alertGaugeTagId = codex.propertyTagNames.tryGetId(ALERT_GAUGE_TAG);
  /**
   * カードの下端に出す、域から色を引くバー（怪我の残っている傷・動物や意識のバーなど、
   * docs/engine/InjurySystem.md・VitalsSystem.md 9節）。alert_gaugeタグを持つプロパティが無い物、
   * 持っていても上下限（range）が無く割合を定義できない物はundefined。**バーはこれ1本だけ**——
   * 痛み・衝撃・失血はいずれも意識へ合流するので、あと何手で倒れるかはここが答える（意識の場合）。
   *
   * 複数付いていれば、propsの宣言順で最初の1つ（WorldObject.exhaustedStageと同じ規約）。
   * 1つの物には1つしか付けない前提で、2つ以上付くと片方が静かに出なくなる
   * （`tests/worldCodex/cardBarTags.test.ts` がこの前提を検査する）。
   */
  const alertGaugeOf = (object: WorldObject): CardAlertBar | undefined => {
    if (alertGaugeTagId === undefined) return undefined;
    const reading = object.readPropertiesWithTag(alertGaugeTagId).at(0);
    return reading?.ratio === undefined
      ? undefined
      : { ratio: reading.ratio, alert: reading.alert, worsensUpward: reading.worsensUpward };
  };

  const consciousnessPropertyId = codex.propertyNames.tryGetId(CONSCIOUSNESS_PROPERTY);
  /** 気を失っているカードへ出す覆い（CardView.md 9.1節）。意識を持たない物・起きている物はundefined。 */
  const overlayOf = (object: WorldObject): string | undefined =>
    consciousnessPropertyId !== undefined && object.isInStage(consciousnessPropertyId, UNCONSCIOUS_STAGE)
      ? locale.stage(UNCONSCIOUS_STAGE)
      : undefined;

  const warinessPropertyId = codex.propertyNames.tryGetId(WARINESS_PROPERTY);
  /** 輪郭を明滅させる域。warinessを持たない物はundefined（明滅しない）。 */
  const alertOf = (object: WorldObject): AlertLevel | undefined =>
    warinessPropertyId === undefined ? undefined : object.readProperty(warinessPropertyId)?.alert;

  const treatmentSlotId = codex.slotNames.tryGetId(TREATMENT_SLOT);
  const bleedingPropertyId = codex.propertyNames.tryGetId(BLEEDING_PROPERTY);
  /** その物自身から血が流れているか。持たない物・止まった物はfalse。 */
  const isBleeding = (object: WorldObject): boolean =>
    bleedingPropertyId !== undefined && (object.readProperty(bleedingPropertyId)?.value ?? 0) >= 1;

  /**
   * カードに出す印。血が流れていれば🩸、そうでなく治療具が当たっていれば🩹、どちらでもなければundefined。
   *
   * 出血は**負っている本人まで届く**——傷そのものと、血が流れている傷を抱えている物の両方に出る。
   * UI側は怪我がどのスロットに入るかを知らず、「中に流れている物がいるか」だけを見る。
   */
  const markOf = (object: WorldObject): string | undefined => {
    if (isBleeding(object) || [...object.children()].some(isBleeding)) return BLEEDING_MARK;
    return treatmentSlotId !== undefined && (object.tryGetSlot(treatmentSlotId)?.contents.length ?? 0) > 0
      ? TREATED_MARK
      : undefined;
  };

  const fillColorTagId = codex.propertyTagNames.tryGetId(FILL_COLOR_TAG);
  /**
   * 量として存在する中身（水・茶・油）の割合と、その中身が宣言している色
   * （LiquidContainerSystem.md 2節・4.1節）。
   *
   * バーの割合は中身自身の状態なので、代表（represented_by、7.6節）が量的オブジェクトかどうかだけで
   * 決まる。空の容器は代表が自分自身になるため、バーは出ない——映す中身がいない。UI側は容器の
   * スロット名を知らない。色はfill_colorタグを持つプロパティの値で、複数付いていれば最初の1つ
   * （gaugeタグと同じ規約、tests/worldCodex/cardBarTags.test.ts参照）。
   */
  const fillOf = (object: WorldObject): CardFill | undefined => {
    const content = object.tryGetRepresentative();
    if (content === undefined || !content.def.isQuantitative) return undefined;

    const ratio = content.fillRatioInParentSlot();
    if (ratio === undefined) return undefined;

    const color =
      fillColorTagId === undefined ? undefined : content.readPropertiesWithTag(fillColorTagId).at(0)?.value;
    return { ratio, color };
  };

  /**
   * 入れ物のカードに出す、中身が容量をどれだけ占めているか（ContainerSystem.md 1節）。上限
   * （capacity）を持たない入れ物と、そもそも中身を持たない物ではundefined——あとどれだけ入るかが
   * 決まっていないものに、満たされ具合は無い。
   *
   * 液体の容器はこのバーを持たない。上限は同じcapacityでも、量を持つのは中身の液体自身なので、
   * 中身のバー（fillOf）が中身の色で映す側になる（LiquidContainerSystem.md 2節）。
   */
  const capacityRatioOf = (object: WorldObject): number | undefined => object.mainSlotFillRatio();

  const progressPropertyId = codex.propertyNames.tryGetId(PROGRESS_PROPERTY);
  const materialsSlotId = codex.slotNames.tryGetId(MATERIALS_SLOT);
  /**
   * 製作中オブジェクトのカードに出す2本（RecipeSystem.md、CardView.md 10.1節）。製作中でない物ではどちらもundefined。
   *
   * - 材料の充足率は**今の工程が要求する分**。「作業する」が押せるかと一致させるため、残りの工程まで
   *   数えない（残りを数えると、揃っているのに満たないバーが出る）。
   * - 工程の進捗は**工程が2つ以上のレシピにだけ**出す。1つしか無いレシピでは、最初の作業でそのまま
   *   完成してカードが入れ替わるので、この値は常に0のままになる（finishedStepRatio参照）。
   */
  const craftingOf = (object: WorldObject): { materialRatio?: number; stepRatio?: number } | undefined => {
    if (progressPropertyId === undefined || materialsSlotId === undefined) return undefined;
    const recipe = recipeOf(object, codex);
    if (recipe === undefined) return undefined;

    const progress = object.getNumber(progressPropertyId);
    const step = currentStep(recipe, progress);
    return {
      materialRatio: step === undefined ? undefined : stepSupplyRatio(object, materialsSlotId, step),
      stepRatio: recipe.steps.length < 2 ? undefined : finishedStepRatio(recipe, progress),
    };
  };

  /**
   * カードを押したときに開く、そのオブジェクトの主要なスロット（持たなければundefined）。
   *
   * **どのスロットかはワールド側が名指しする**（`main_item_slot`、GameElementDefinition.md 7.8節）。
   * UIがスロット名で決めていた頃は、液体の容器のスロット（`content`）が入れ物のスロット（`contents`）と
   * 1文字違いだったおかげで開かれずに済んでいただけで、名前が揃えば水を取り出せてしまう。
   */
  const openableSlotOf = (object: WorldObject): number | undefined => object.def.mainItemSlotGlobalId;

  /** そのカードが中身を持つなら、それを映す場所。持たなければundefined（押しても中身は開かない）。 */
  const contentsOf = (object: WorldObject): CardPlace | undefined =>
    openableSlotOf(object) === undefined ? undefined : { container: object };

  /**
   * そのカードで実行できるアクション。宣言を読むのは操作対象の代表（represented_by、ActionSystem.md
   * 1節）で、実行はカードが映しているオブジェクト自身へ頼む（代表の解決はエンジン側が行う）。
   * 水筒のカードに、中身の水のdrinkがボタンとして出る。
   */
  const actionsOf = (instance: WorldObject): readonly CardAction[] => {
    const target = instance.resolveInteractionTarget();
    const texts = locale.object(target.def.name);
    return target.def.actions.map((action) => {
      const declared = texts.action(action.name);
      const unmet = instance.actionUnmetRequirement(action.name, game.player.instance);
      return {
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
  };

  const itemTagId = codex.tagNames.tryGetId('item');
  const fixtureTagId = codex.tagNames.tryGetId('fixture');
  const injuryTagId = codex.tagNames.tryGetId('injury');
  const animalTagId = codex.tagNames.tryGetId('animal');
  const foodTagId = codex.tagNames.tryGetId('food');
  const containerTagId = codex.tagNames.tryGetId('container');
  const liquidContainerTagId = codex.tagNames.tryGetId('liquid_container');
  const toolTagId = codex.tagNames.tryGetId('tool');
  const wipTagId = codex.tagNames.tryGetId(IN_PROGRESS_TAG);

  /** その型の表示名。インスタンスを見ないので、中身による差し替え（水入りの水筒）は含まない。 */
  const typeNameOf = (def: ObjectDef): string => {
    const texts = locale.object(def.name);
    // 製作中オブジェクトは自動生成なので対応表に載らない。完成品の名前から組み立てる。
    const product = codex.productOf(def);
    return product === undefined
      ? texts.displayName
      : texts.displayNameInProgress(locale.object(product.name).displayName);
  };

  /**
   * そのオブジェクトの表示名。中身を代表にしているもの（水入りの水筒）は、中身の名前を差し込んだ
   * 名前になる（Localization.md）。代表がさらに中身を持つ入れ子は、内側から順に畳まれる。
   */
  const nameOf = (object: WorldObject): string => {
    // 製作中オブジェクトも中身（材料）を持つが、名前は型のものをそのまま使う。
    if (codex.productOf(object.def) !== undefined) return typeNameOf(object.def);

    const content = object.tryGetRepresentative();
    return content === undefined
      ? typeNameOf(object.def)
      : locale.object(object.def.name).displayNameWithContent(nameOf(content));
  };

  /**
   * 絵がまだ無いオブジェクトの代替アイコン。**並ぶレーンではなく、その物の型から選ぶ**——
   * itemとfixtureを兼ねる編み籠は、地面へ据えてもアイテムのまま持ち歩けるので、レーンを移った
   * だけで別の物に見えては困る。持ち歩けるかどうかを先に見るのはそのため。
   */
  const kindOf = (def: ObjectDef): ObjectKind => {
    const has = (tagId: number | undefined): boolean => tagId !== undefined && def.tags.includes(tagId);
    if (has(injuryTagId)) return 'injury';
    // 動物はitemも兼ねる（HuntingSystem.md 1.1節）ので、itemより先に見る。
    if (has(animalTagId)) return 'animal';
    // アイテムの用途（CardView.md 2節）。**兼ねる物は、生存の時計に近いほうを先に見る**——中に水を
    // 抱えた青いヤシの実は入れ物ではなく食事で、水があることは中身のバーが青で言う。
    if (has(foodTagId)) return 'food';
    if (has(containerTagId) || has(liquidContainerTagId)) return 'container';
    if (has(toolTagId)) return 'tool';
    if (has(itemTagId)) return 'item';
    if (has(fixtureTagId)) return 'fixture';
    return 'item';
  };

  /**
   * 作りかけの物か（RecipeSystem.md 5節のwipタグ）。**完成品のタグを引き継ぐ型なので、種別の判定より
   * 後から覆う**——作りかけの籠は入れ物の枠ではなく青写真の枠になる（CardView.md 10節）。
   */
  const inProgressDef = (def: ObjectDef): boolean => wipTagId !== undefined && def.tags.includes(wipTagId);

  const iconOf = (def: ObjectDef): string => KIND_ICONS[kindOf(def)];

  /**
   * カードに映す絵の出所。製作中オブジェクトは完成品の絵を映す——作りかけであることは青の覆いが
   * 示すので、絵は何が出来つつあるのかを出せばよい（CardView.md 10節 製作中オブジェクトのカード）。
   * 自動生成される型（RecipeSystem.md）に絵を用意する道は無いため、これが唯一の出所でもある。
   */
  const artOf = (def: ObjectDef): string => (codex.productOf(def) ?? def).name;

  /**
   * そのオブジェクトが今在るスロット（カードの地を引く先。CardView.md 7節）。
   *
   * **地はスロットだけで決まる。** 設置物なら土地の`fixtures`、怪我なら負った本人の`injuries`で、
   * どのスロットに何を敷くかは絵のファイル名が言う。ここに種別ごとの分岐は要らない。
   */
  const slotOfObject = (object: WorldObject): SlotRef | undefined => {
    const parent = object.parent;
    if (parent === undefined) return undefined;
    const slot = parent.getSlotByLocalId(object.parentSlotLocalId).def.name;
    return { owner: parent.def.name, slot };
  };

  /**
   * 型そのものを表すカード。インスタンスが1つも無くても作れるので、まだ在るとは限らない物
   * （枠が受け入れる素材）を見せるのに使う。個体ごとに違い得る値は持たない。
   */
  const cardOfType = (objectGlobalId: number): CardContent => {
    const def = codex.objects.get(objectGlobalId);
    return {
      icon: iconOf(def),
      name: typeNameOf(def),
      art: artOf(def),
      kind: kindOf(def),
      inProgress: inProgressDef(def),
    };
  };

  const stackOf = (instances: readonly WorldObject[], place: CardPlace): ObjectCardStack => ({
    icon: iconOf(instances[0].def),
    name: nameOf(instances[0]),
    kind: kindOf(instances[0].def),
    // 作りかけかどうかは物の型が決める。設置物として地面に据わっていても手に持っていても、
    // 同じ「まだ物になっていない」カードとして出す。
    inProgress: inProgressDef(instances[0].def),
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    art: artOf(instances[0].def),
    background: slotOfObject(instances[0]),
    // 状態のバーは代表のものを出す。個体ごとに違い得る値だが、名前も絵も操作も代表のものなので、
    // 1枚に束ねたカードが映すのは代表の状態で揃える。
    gauge: gaugeOf(instances[0]),
    fill: fillOf(instances[0]),
    capacityRatio: capacityRatioOf(instances[0]),
    alertGauge: alertGaugeOf(instances[0]),
    overlay: overlayOf(instances[0]),
    alert: alertOf(instances[0]),
    ...craftingOf(instances[0]),
    mark: markOf(instances[0]),
    // スタックが渡してくる並びは中身が入れ替わり続ける実体（ObjectStack.members）なので、写し取る。
    objects: [...instances],
    movedIds: (count) => carriedOf(instances, count).map((instance) => instance.instanceId),
    description: locale.object(instances[0].def.name).description,
    actions: actionsOf(instances[0]),
    place,
    contents: contentsOf(instances[0]),
  });

  /**
   * 実体化された土地の表示名。生成側（IslandMap）が持つのは識別子の組み合わせだけなので、
   * 表示文字列はここで対応表から組み立てる（Localization.md）。
   */
  const locationNameOf = (instanceId: number): string => {
    const name = game.map.nameOfInstance(instanceId);
    return name === undefined ? UNNAMED_LOCATION : locale.locationName(name);
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
      name: locationNameOf(path.destinationInstanceId),
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
   * 場所ごとの「どのオブジェクトのどのスロットか」。カードの移動はすべてこの表を引いた
   * スロット移動（WorldObject.moveToSlot*）で、場所ごとの特別扱いは持たない。コンテナ（箱・かご）
   * を足すときも、この表に1行増やすだけで移動もドラッグも動く。
   *
   * **どこへ移せるかはこの表では決めない。** それはワールド側の宣言（枠の型・bound_to_owner）から
   * 引く（moveInto参照）。設置物のかごを持ち歩けるようにしたら、画面を直さずに外せるようになる。
   */
  const slotOf = (place: CardPlace): { owner: WorldObject; slotId: number } | undefined => {
    if (typeof place !== 'string') {
      const slotId = openableSlotOf(place.container);
      return slotId === undefined ? undefined : { owner: place.container, slotId };
    }
    switch (place) {
      case 'items':
        return { owner: location.instance, slotId: location.itemsSlotId };
      case 'fixtures':
        return { owner: location.instance, slotId: location.fixturesSlotId };
      case 'hand':
        return { owner: game.player.instance, slotId: game.player.handSlotId };
      case 'equipment':
        return { owner: game.player.instance, slotId: game.player.equipmentSlotId };
      case 'injuries':
        return { owner: game.player.instance, slotId: game.player.injuriesSlotId };
    }
  };

  /**
   * itemを場所placeへ入れる操作（そこへは入れられないならundefined）。入れられるかの判断はすべて
   * ドメインに任せる（WorldObject.rejectionForMoveTo）——捻挫が身体から剥がれないのも、ヤシの木が
   * 手に持てないのも、画面が場所ごとに覚えている決まりではなくワールド側の宣言の帰結。
   */
  const moveInto =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement, count = 1): (() => void) | undefined => {
      const dest = slotOf(place);
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
      const dest = slotOf(place);
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
      const dest = slotOf(place);
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

  return {
    characterName: characterTexts.displayName,
    characterArt: game.player.instance.def.name,
    characterMark: markOf(game.player.instance),
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '👕',
    injuryIcon: '🩹',
    statuses: entriesWithTag(codex.propertyTagNames.tryGetId(STATUS_TAG)),
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
    currentLocation: {
      icon: LOCATION_ICON,
      name: locationNameOf(location.instance.instanceId),
      art: location.instance.def.name,
      kind: 'location',
    },
    locationArt: location.instance.def.name,
    laneSlot: (place) => {
      const found = slotOf(place);
      if (found === undefined) return undefined;
      const slot = found.owner.def.getSlotDef(found.slotId);
      return slot === undefined ? undefined : { owner: found.owner.def.name, slot: slot.name };
    },
    // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
    explorationRatio:
      location.explorationProgressMax === 0
        ? 0
        : location.explorationProgress / location.explorationProgressMax,
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
            : stacksIn(slotOf(place));
      return stacks.map((stack) => cardOfStack(stack, place));
    },
    cardOfType,
    nameOf: (place) => {
      const slot = slotOf(place);
      if (slot === undefined) return typeof place === 'string' ? place : nameOf(place.container);
      const slotName = codex.slotNames.getName(slot.slotId);
      const owner = slot.owner === game.player.instance ? characterTexts.displayName : nameOf(slot.owner);
      return locale.slot(slotName).displayNameWithOwner(owner);
    },
    acceptsCards: (place) => {
      const slot = slotOf(place);
      const slotDef = slot === undefined ? undefined : slot.owner.def.getSlotDef(slot.slotId);
      return slotDef !== undefined && codex.admitsBroughtObjects(slotDef);
    },
    cellCountOf: (place) => {
      const slot = slotOf(place);
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

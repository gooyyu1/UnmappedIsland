import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Location } from '../domain/runtime/views/Location';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import { putIntoSlot } from '../domain/runtime/slotEntry';
import type { Localization } from '../locale/Localization';
import type { CardContent, CardFill, CardSeverity } from './ui/Card';
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
   * ドラッグされた側として使われるインスタンス。同じ束へ重ねたときは束の2つ目になるため、束の代表とは
   * 限らない。画面側は「掴んでいたカード」の行方を追う（CardMotion.MotionContext.released）のに使う。
   */
  readonly source: WorldObject;
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
  /** 条件アイコン。複数同時に付き得るので件数は可変。 */
  readonly conditions: readonly string[];
  readonly equipmentIcon: string;
  readonly injuryIcon: string;
  /**
   * ステータスエリアに出す候補（statusタグが付いたもの、ScreenLayout.md ステータスエリア節）。
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
   * 空の演出（ScreenLayout.md）が読む、今の天気と日射。いずれも語彙を持たないCodexではundefined。
   * 天気は識別子（`light_rain`など、ClimateSystem.md 4.2節）、日射は時間帯と天気を畳んだ実効値。
   */
  readonly weather: string | undefined;
  readonly sunlight: number | undefined;
  /** 陽炎が立つかを決める気温（ClimateSystem.md）。語彙を持たないCodexではundefined。 */
  readonly ambientTemperature: number | undefined;
  /**
   * 状況エリアの窓に出す天気の名前（Localizationのsymbol_texts節）。絵だけでは晴天どうしを
   * 区別できないため、名前は必ず出す（ScreenLayout.md）。天気の語彙を持たないCodexではundefined。
   */
  readonly weatherLabel: string | undefined;
  readonly currentLocation: CardContent;
  /** 現在地のobject_defの識別子（表示名ではない）。土地ごとに変わるレーンの背景を選ぶ（backgroundArt参照）。 */
  readonly locationArt: string;
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
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、ここでは宣言順の先頭を採る。マッチはwithタグだけで判定するので、
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

/** 絵がまだ無いオブジェクトの、型ごとの仮のアイコン（iconOf参照）。 */
const LOCATION_ICON = '🗺️';
const ITEM_ICON = '📦';
const FIXTURE_ICON = '🌳';
const INJURY_ICON = '🩹';

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/**
 * ステータスエリアへ出す候補になるプロパティに付けるタグ（GameElementDefinition.md 6.7節）。
 * 健康・栄養といったカテゴリのタグと重ねて付ける（満腹度はstatusでありnutritionでもある）。
 */
const STATUS_TAG = 'status';

/**
 * カードの状態バーが映すプロパティの名前（ScreenLayout.md カードの状態バー節）。
 * いずれもGameElementDefinition.md・LiquidContainerSystem.mdが名前ごと決めている語彙で、UI側は
 * 「その名前を持つ物が状態バーを出す」「バーの色はその名前のプロパティが決める」とだけ知っている。
 * 後から足された物——MODの液体——も、同じ名前で宣言するだけで同じように出る。
 */
const DURABILITY_PROPERTY = 'durability';
const SEVERITY_PROPERTY = 'severity';
const COLOR_PROPERTY = 'color';

/**
 * 治療具を当てておくスロットの名前と、当たっているカードへ出す印
 * （injuries.yaml・ScreenLayout.md カードの印 節）。
 *
 * **手当ての有無で絵を差し替えない。** 差し替えると、怪我の部位 × 治療具の数だけ絵が要る。
 */
const TREATMENT_SLOT = 'treatment';
const TREATED_MARK = '🩹';

/**
 * そのスロットの枠の位置が安定しているか（`cell_count`、SlotSystem.md 3節）。空き枠を指した
 * ドロップを、枠そのものへ入れる操作として扱ってよいのはこちらだけ。
 */
function hasFixedCells(owner: WorldObject, slotGlobalId: number): boolean {
  return owner.tryGetSlot(slotGlobalId)?.def.cellCount !== undefined;
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

  const durabilityPropertyId = codex.propertyNames.tryGetId(DURABILITY_PROPERTY);
  /**
   * カードの下端に出す耐久度（0〜1）。durabilityを持たない物と、持っていても上下限（range）が無く
   * 割合を定義できない物はundefined。
   */
  const durabilityOf = (object: WorldObject): number | undefined =>
    durabilityPropertyId === undefined ? undefined : object.readProperty(durabilityPropertyId)?.ratio;

  const severityPropertyId = codex.propertyNames.tryGetId(SEVERITY_PROPERTY);
  /** 怪我のカードに出す、残っている傷（docs/world/Injuries.md）。severityを持たない物はundefined。 */
  const severityOf = (object: WorldObject): CardSeverity | undefined => {
    if (severityPropertyId === undefined) return undefined;
    const reading = object.readProperty(severityPropertyId);
    return reading?.ratio === undefined ? undefined : { ratio: reading.ratio, alert: reading.alert };
  };

  const treatmentSlotId = codex.slotNames.tryGetId(TREATMENT_SLOT);
  /** 治療具が当たっているカードに出す印。当たっていなければundefined（印そのものを出さない）。 */
  const markOf = (object: WorldObject): string | undefined =>
    treatmentSlotId !== undefined && (object.tryGetSlot(treatmentSlotId)?.contents.length ?? 0) > 0
      ? TREATED_MARK
      : undefined;

  const colorPropertyId = codex.propertyNames.tryGetId(COLOR_PROPERTY);
  /**
   * 量として存在する中身（水・茶・油）の割合と、その中身が宣言している色
   * （LiquidContainerSystem.md 2節・4.1節）。
   *
   * バーは中身自身の状態なので、代表（represented_by、7.6節）が量的オブジェクトかどうかだけで決まる。
   * 空の容器は代表が自分自身になるため、バーは出ない——映す中身がいない。UI側は容器のスロット名を
   * 知らない。
   */
  const fillOf = (object: WorldObject): CardFill | undefined => {
    const content = object.tryGetRepresentative();
    if (content === undefined || !content.def.isQuantitative) return undefined;

    const ratio = content.fillRatioInParentSlot();
    if (ratio === undefined) return undefined;

    const color = colorPropertyId === undefined ? undefined : content.readProperty(colorPropertyId)?.value;
    return { ratio, color };
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
  const iconOf = (def: ObjectDef): string => {
    const tags = def.tags;
    if (injuryTagId !== undefined && tags.includes(injuryTagId)) return INJURY_ICON;
    if (itemTagId !== undefined && tags.includes(itemTagId)) return ITEM_ICON;
    if (fixtureTagId !== undefined && tags.includes(fixtureTagId)) return FIXTURE_ICON;
    return ITEM_ICON;
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
      art: def.name,
      inProgress: codex.productOf(def) !== undefined,
    };
  };

  const stackOf = (instances: readonly WorldObject[], place: CardPlace): ObjectCardStack => ({
    icon: iconOf(instances[0].def),
    name: nameOf(instances[0]),
    // 作りかけかどうかは物の型が決める。設置物として地面に据わっていても手に持っていても、
    // 同じ「まだ物になっていない」カードとして出す。
    inProgress: codex.productOf(instances[0].def) !== undefined,
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    art: instances[0].def.name,
    // 状態のバーは代表のものを出す。個体ごとに違い得る値だが、名前も絵も操作も代表のものなので、
    // 1枚に束ねたカードが映すのは代表の状態で揃える。
    durability: durabilityOf(instances[0]),
    fill: fillOf(instances[0]),
    severity: severityOf(instances[0]),
    mark: markOf(instances[0]),
    // スタックが渡してくる並びは中身が入れ替わり続ける実体（ObjectStack.members）なので、写し取る。
    objects: [...instances],
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
  ): { icon: string; name: string; art: string | undefined; road: true } | undefined => {
    if (pathTagId === undefined || !fixture.def.tags.includes(pathTagId)) return undefined;

    const path = new Path(fixture, codex.propertyNames);
    return {
      icon: LOCATION_ICON,
      name: locationNameOf(path.destinationInstanceId),
      art: path.destination?.def.name,
      // 名前も絵も行き先のものなので、道であることはカード側の矢印だけが示す。
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

    const lands = [...known]
      .sort((a, b) => a - b)
      .map((site) => {
        const instanceId = game.map.siteInstanceIds[site];
        return {
          site,
          card: {
            icon: LOCATION_ICON,
            name: locationNameOf(instanceId),
            art: root.findDescendantByInstanceId(instanceId)?.def.name,
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

      const wellKnown = game.session.codex.wellKnown;
      if (stack[0].rejectionForMoveTo(dest.owner, dest.slotId, wellKnown) !== undefined) return undefined;

      // まとめて運んできたぶんも、1つずつ入れるのと同じことをする（時間も個数ぶんかかる）。
      // 入る個数を超えて頼まれても、超えたぶんは枠が断るだけ。
      const carried = stack.slice(0, Math.max(1, count));
      const put = (item: WorldObject, first: boolean): void => {
        // 位置の指定が効くのは1つ目だけ。残りは同じ束へ合流するか、空いている枠へ入る。
        if (at === undefined || !first) {
          item.moveToSlot(dest.owner, dest.slotId, wellKnown);
        } else if (at.kind === 'cell' && hasFixedCells(dest.owner, dest.slotId)) {
          item.moveToSlotAtCell(dest.owner, dest.slotId, at.index, wellKnown);
        } else {
          // 前詰めスロットの空き枠は末尾の受け皿だけなので、その位置の隙間へ落としたものとして扱う
          // （枠の位置がそのまま並びの終わりを指す）。
          item.moveToSlotAtGap(dest.owner, dest.slotId, at.index, wellKnown);
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

      return stack[0].acceptedCountForMoveTo(
        stack.slice(1),
        dest.owner,
        dest.slotId,
        game.session.codex.wellKnown,
      );
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
      const minutes = stack
        .slice(0, Math.max(1, count))
        .reduce((total, item) => total + slotDef.putInMinutes(dest.owner, item, game.player.instance), 0);
      if (texts === undefined && minutes === 0) return undefined;
      return {
        name: texts?.displayName ?? locale.slot(slotDef.name).displayName,
        description: texts?.description,
        minutes,
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
    },
    locationArt: location.instance.def.name,
    // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
    explorationRatio:
      location.explorationProgressMax === 0
        ? 0
        : location.explorationProgress / location.explorationProgressMax,
    // 並び方はプレイヤーが地形をどう捉えているかで変わるため、同じスロットの中での並び替えを許す。
    // ヤシの木を持ち歩けないのはmoveIntoが弾くからで、このレーンが読み取り専用だからではない。
    // このレーンに並ぶカードだけが、その土地の景色を地に敷く（backgroundArt参照）。オブジェクトの
    // 種類ではなくここに並ぶかどうかで決まる——背景が表すのは「今その土地に在るもの」だから。
    fixtures: location.fixtureStacks.map((stack) => ({
      ...stackOf(stack, 'fixtures'),
      background: location.instance.def.name,
      // 道だけは名前と絵が行き先のものに差し替わる（destinationOf参照）。
      ...destinationOf(stack[0]),
      moveTo: moveInto(stack, 'fixtures'),
      acceptedCountAt: acceptedCountIn(stack, 'fixtures'),
      putInto: putIntoTexts(stack, 'fixtures'),
      reorder: reorderIn(stack[0]),
    })),
    items: location.itemStacks.map((stack) => ({
      ...stackOf(stack, 'items'),
      moveTo: moveInto(stack, 'items'),
      acceptedCountAt: acceptedCountIn(stack, 'items'),
      putInto: putIntoTexts(stack, 'items'),
      reorder: reorderIn(stack[0]),
    })),
    hand: game.player.handStacks.map((stack) =>
      stack.length === 0
        ? undefined
        : {
            ...stackOf(stack, 'hand'),
            moveTo: moveInto(stack, 'hand'),
            acceptedCountAt: acceptedCountIn(stack, 'hand'),
            putInto: putIntoTexts(stack, 'hand'),
            reorder: reorderIn(stack[0]),
          },
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
      return stacks.map((stack) => ({
        ...stackOf(stack, place),
        moveTo: moveInto(stack, place),
        acceptedCountAt: acceptedCountIn(stack, place),
        putInto: putIntoTexts(stack, place),
        reorder: reorderIn(stack[0]),
      }));
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
      const source = dragged === target ? second : dragged.objects[0];
      if (source === undefined) return undefined;

      const [combination] = first.findMatchingCombinations(source);
      if (combination === undefined) return undefined;

      const texts = locale.object(first.def.name).combination(combination.name);
      return {
        name: texts.displayName,
        description: texts.description,
        minutes: first.combinationMinutes(source, game.player.instance, combination.name),
        source,
        execute: () => {
          first.tryExecuteCombination(source, game.player.instance, combination.name, game.session);
        },
      };
    },
  };
}

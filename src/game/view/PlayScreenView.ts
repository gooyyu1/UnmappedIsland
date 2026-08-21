import type { WorldCodex } from '../../domain/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import { Location } from '../../domain/views/Location';
import { Path } from '../../domain/views/Path';
import type { PropertyInfluence } from '../../domain/PropertyInfluence';
import type { PropertyValue } from '../../domain/PropertyValue';
import type { WorldObject } from '../../domain/WorldObject';
import type { Localization } from '../../locale/Localization';
import type { CraftingMaterial } from './craftingView';
import { craftingMaterials } from './craftingView';
import { cardLooksOf } from './cardLooks';
import type { CardAction, CardCombination, CardDrop, CardOperations } from './cardOperations';
import { cardOperationsOf } from './cardOperations';
import type { CardPlace, CardPlacement, ScreenPlaces } from './cardPlaces';
import { cardPlacesOf } from './cardPlaces';
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
 * dropInto・reorder・combinationOfが返す操作はワールドを変えるだけで、画面への反映（表示内容の
 * 作り直し）は呼び出し側の責務。dropIntoとreorderは「そこへ落とせるか」を、答えを返すか否かで示す。
 * 落とせない場所（持ち歩けない設置物、出し入れできない怪我など）ではundefinedになるので、呼び出し側は
 * 落とし先の枠を出す前に問い合わせられる。
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
   * 束のうち先頭のcount個をその場所へ落としたときに起きること（落とせないならundefined）。atは落とした
   * 先での置き場所（1つ目にだけ効く）で、省略すると空いている場所へ入る。動かせない束（設置物・怪我）
   * にはない。
   */
  readonly dropInto?: (place: CardPlace, at?: CardPlacement, count?: number) => CardDrop | undefined;

  /**
   * countを渡した操作（dropInto）が動かすインスタンスのID。先頭は束の代表＝掴まれていた1つ。
   * どの個体が動くのかの選び方は操作の側が1箇所で決め（cardOperationsのcarriedOf）、画面の移動
   * アニメーション（MotionContext.released）はこれに合わせる——ワールドが動かすものと画面が飛ばす
   * ものを食い違わせないため。
   */
  readonly movedIds: (count: number) => readonly number[];

  /**
   * 同じ場所の中で位置を変える操作。こちらは束ごと動かす（1つずつでは元の束へ合流して戻ってしまうため、
   * SlotSystem.md 3節）。
   */
  readonly reorder?: (at: CardPlacement) => (() => void) | undefined;
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
  /**
   * 説明のタブに出す札。**その物1個ぶん**の姿で、子ウィンドウはこれをそのまま借りて出す
   * （Windows.md 1.1節）。
   */
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
 * その場所を1つの並び（レーン・子ウィンドウのタブ）として見せるのに要るもの一式。**1つの場所に
 * ついて知りたいことは1つの問い合わせで揃う**——ばらばらに訊くと、場所を映す先を足すたびに
 * 訊く手順も増える（Windows.md 1節、ObjectWindowViewと同じ形）。
 *
 * **並ぶ札は含めません。** 画面に出る札は、貸し出している1枚を引き算した後のもの（ShownCards）で、
 * ワールドがそう持っている並び（cardsIn）をそのまま描くことは無い。
 */
export interface SlotView {
  /**
   * その場所が映しているスロットの識別子（スロット名）。**表示名ではなく識別子**で、子ウィンドウの
   * タブの記憶（Settings.openedTab）の鍵になる——言語で変わる表示名を鍵にはできない。
   */
  readonly key: string;

  /**
   * タブの見出しに出す、そのスロットの表示名。**持ち主は込めません**——持ち主の名前はウィンドウの
   * 見出しに既に出ているので、タブにまで繰り返す場所が無い。
   */
  readonly label: string;

  /**
   * そのスロットが空けておく枠（`cell_count`、SlotSystem.md 3節）。1枠しか無い場所に4枠空けると
   * 「4つ入る」と誤って伝わるので、数を宣言しているならその数。
   *
   * **枠数を宣言していないスロットは`'grows'`**——カードを落とすたびに枠が1つ増えるので、空けておく
   * のは増える先の1つだけ（plainCells）で、レーンの幅も増える前提で取る（ObjectWindow.laneWidthFor）。
   * 中身のかさの合計の上限（`capacity`）とは別物。
   */
  readonly cells: number | 'grows';

  /**
   * カードを受け入れるか（怪我のような読み取り専用の場所はfalse）。中身が空でも「落とせる場所か
   * どうか」を見せるために、受け皿の空枠を出すかの判断に使う。
   */
  readonly acceptsCards: boolean;

  /**
   * レーンの全面に敷く絵を引く先（backgroundArt参照）。どのスロットにどの絵を敷くかは、画面側では
   * なく絵のファイル名が決める。
   */
  readonly background: SlotRef | undefined;

  /**
   * 製作中オブジェクトの材料スロットなら、要求している型ごとの枠（そうでなければundefined）。
   * 並びは要求の順で、**もう要求されない型は挙げません**（craftingMaterials）。
   */
  readonly materials: readonly CraftingMaterial[] | undefined;
}

/**
 * プレイ中の画面が表示する内容。画面の組み立て（PlayScene）とゲーム状態の間を仕切る。
 *
 * 条件のように、ドメイン側にまだ表示できる形が無い項目はモック（ScreenLayout_Mock.html）と同じ
 * 固定値を返す（fromGameSession参照）。**画面の意匠でしかないもの——ボタンの代役アイコンなど——は
 * ここに置かない。** ワールドを映していないものは、ワールドが変わっても変わらない。
 */
export interface PlayScreenView {
  /**
   * キャラクタ自身を映す札。ポートレイトの枠と、キャラクタの子ウィンドウが同じ姿で出す1枚。
   *
   * **名前も絵も印もこの札が持つ。** 血が流れている傷を負っていれば印が付くのも、動物のカードと
   * 同じ規約（CardView.md 9節）。
   */
  readonly characterCard: CardContent;

  /** キャラクタ自身の子ウィンドウ（ポートレイト・日時・装備/怪我のボタンから開く）。 */
  readonly characterWindow: ObjectWindowView;

  /** 現在地そのものの子ウィンドウ（現在地の札から開く）。 */
  readonly currentLocationWindow: ObjectWindowView;

  /**
   * その物の子ウィンドウ。**物ごとに変わる**ので、値ではなく問い合わせで答える。キャラクタと現在地は
   * 画面から名前で開く入口なので、同じ答えを上の2つが持つ。
   */
  readonly windowOf: (object: WorldObject) => ObjectWindowView;

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
  /** 現在地を映す札。設置物レーンの左端にピン留めされる1枚と、現在地の子ウィンドウが同じ姿で出す。 */
  readonly currentLocationCard: CardContent;
  /**
   * 画面の区画（レーン・装備/怪我のボタン）が今映しているスロット。**画面が名前で指せるのはこの5つ
   * だけ**で、それ以外の場所はカードや現在地が名乗る`visible_slots`から来る（cardPlaces参照）。
   */
  readonly places: ScreenPlaces;

  /** その場所を並びとして見せるのに要るもの。**場所ごとに変わる**ので、値ではなく問い合わせ。 */
  readonly slotViewOf: (place: CardPlace) => SlotView;

  /** 地図ウィンドウに出す既知の土地（現在地と、発見済みの道の両端）。 */
  readonly mapLands: readonly MapLandView[];

  /** 地図ウィンドウに出す発見済みの道。 */
  readonly mapRoads: readonly MapRoadView[];

  /**
   * その場所の枠の並び（空き枠はundefined）。**枠の位置がそのまま並びになる**ので、枠数の決まった
   * スロット（手持ち・入れ物の中身）で抜けた枠は詰まらない——世界が枠の位置を保つ以上、画面もそこを
   * 動かさない（SlotSystem.md 3節）。
   */
  readonly cardsIn: (place: CardPlace) => readonly (ObjectCardStack | undefined)[];

  /**
   * その型（object_defのグローバルID）そのものを表すカード。インスタンスを持たないので、まだ在るとは
   * 限らない物——枠が受け入れる素材（LaneCell.accepts）——を見せるのに使う。
   */
  readonly cardOfType: (objectGlobalId: number) => CardContent;

  /**
   * 挙げた個体だけを映すカード。**束は割れる**——子ウィンドウは束のうち1個だけを借りるので
   * （Windows.md 1.1節）、借りた1個と枠に残る残りが、それぞれ自分の個体だけを動かすカードになる。
   * 表示も操作も先頭を代表とする点は、スロットの中身から作る束（cardsIn）と同じ。
   *
   * **どこの札かは言い添えません。** その物が今いる場所は世界が答えるので、呼び出し側の思い違いが
   * 札に載ることは無い。
   */
  readonly cardOfObjects: (objects: readonly WorldObject[]) => ObjectCardStack;

  /**
   * draggedをtargetへ重ねたときに実行できるcombination（GameElementDefinition.md 12節）。
   * 実行できる組み合わせが無ければundefined。draggedとtargetが同じ束（その束の上の1枚を元の位置へ
   * 重ねた）なら、束の中の2つを組み合わせる。
   *
   * **落とされた側が受け入れる組み合わせを先に、無ければ掴んだ側が受け入れる組み合わせを探す**
   * （CardInteraction.md 2節）。どちらも宣言順の先頭を採る。マッチはwithタグだけで判定するので、
   * conditionsを満たさず実行が空振りすることはある。
   */
  readonly combinationOf: (
    dragged: ObjectCardStack,
    target: ObjectCardStack,
    count?: number,
  ) => CardCombination | undefined;
}

/**
 * 挙げた場所について、cardsInの答えをこの時点のものに焼き付けたviewを返す。
 *
 * **cardsInは呼んだ時点の生きたワールドを読む。** 控えておいたviewをあとから表示する用途
 * （時間経過の再現、PlayScene.passTime）では、それだと控えた時点ではなく「今」の並びが出てしまう
 * ——45分の行動の結果が、経過を見せている途中の画面に先に現れる。
 *
 * **画面が引きうる場所を漏らさず渡すこと。** 焼き付けていない場所は生きたワールドのままなので、
 * 渡し忘れた場所だけが未来を映す（recordChange参照）。
 */
export function withFrozenCards(
  view: PlayScreenView,
  places: readonly (CardPlace | undefined)[],
): PlayScreenView {
  const frozen = new Map<CardPlace, readonly (ObjectCardStack | undefined)[]>();
  for (const place of places) if (place !== undefined) frozen.set(place, view.cardsIn(place));
  if (frozen.size === 0) return view;

  return { ...view, cardsIn: (asked) => frozen.get(asked) ?? view.cardsIn(asked) };
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
 * スロットの枠の並び（空き枠はundefined）。持たないスロットを指していれば空。
 *
 * **空き枠が出るのは枠数が決まっているスロットだけ**（Slot.cells、SlotSystem.md 3節）。前詰めの
 * スロットは詰まっているので、undefinedは現れない。
 */
function stacksIn(place: CardPlace): readonly (readonly WorldObject[] | undefined)[] {
  const slot = place.owner.tryGetSlot(place.def.globalId);
  return slot === undefined ? [] : slot.cells.map((cell) => cell?.members);
}

/**
 * 生成済みのゲーム一式から画面の表示内容を作る。設置物レーン・アイテムレーン・ハンドレーンは
 * 現在地とキャラクターのスロットの中身をそのまま映す。
 *
 * ワールドの状態を写し取るだけなので、アクションでワールドが変わったら作り直す（PlayScene参照）。
 * **写し取るのは一度に全部**——ここが作るものは同じ時点のワールドを映す。
 *
 * カードの語彙は3つに分かれている。場所とスロットの対応（cardPlaces）・札の見た目（cardLooks）・
 * 札の上の操作（cardOperations）で、ここはそれを束ねて画面の区画へ配る。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;
  const places = cardPlacesOf(game.player, location);

  /** ワールドが個体に付けた名前（土地の命名、IslandMap）。付いていない個体ではundefined。 */
  const instanceName = (instanceId: number): string | undefined => {
    const name = game.map.nameOfInstance(instanceId);
    return name === undefined ? undefined : locale.locationName(name);
  };

  const looks = cardLooksOf(codex, locale, game.world.minutesPerTick, instanceName);
  const operations = cardOperationsOf(game, codex, locale);

  /**
   * その場所を並びとして見せるのに要るもの（SlotView）。**スロットの宣言を1度だけ引く**——
   * 見出しも枠の数も受け入れの可否も、同じ1つの宣言から出る。
   *
   * 持ち主がそのスロットを持たない場合（語彙を持たないCodex）は、名前の代わりに持ち主の名前を出し、
   * 枠は無いものとして扱う。
   */
  const slotViewOf = (place: CardPlace): SlotView => {
    const slotDef = place.owner.def.getSlotDef(place.def.globalId);
    const name = slotDef === undefined ? undefined : codex.slotNames.getName(place.def.globalId);
    return {
      key: name ?? String(place.owner.instanceId),
      label: name === undefined ? looks.nameOf(place.owner) : locale.slot(name).displayName,
      cells: slotDef?.cellCount ?? 'grows',
      acceptsCards: slotDef !== undefined && codex.admitsBroughtObjects(slotDef),
      background: slotDef === undefined ? undefined : { owner: place.owner.def.name, slot: slotDef.name },
      materials: craftingMaterials(place.owner, codex),
    };
  };

  /**
   * そのカードへ重ねたdraggedの行き先（受け取れるスロットが無ければundefined）。**どの枠かを決めるのは
   * ワールドの側**（WorldObject.putInSlotFor、GameElementDefinition.md 7.8節）で、画面は場所へ直すだけ。
   */
  const contentsOf = (object: WorldObject, dragged: WorldObject): CardPlace | undefined =>
    object.putInSlotFor(dragged);

  /**
   * その物の子ウィンドウにタブとして並ぶスロット（`visible_slots`、GameElementDefinition.md
   * 7.11節）。宣言順がそのまま並び順で、名乗らない物では空。
   */
  const visiblePlacesOf = (object: WorldObject): readonly CardPlace[] =>
    object.def.visibleSlotGlobalIds.map((slotGlobalId) => object.getSlot(slotGlobalId));

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
    moved: PropertyValue | undefined,
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
      worsens: influence.increases === (moved?.def.worsensUpward ?? false),
      active: influence.active,
    };
  };

  /**
   * そのプロパティ1件の詳細（意味・今いる段・影響の出入り）。**持ち主から読む**——同じ名前の
   * プロパティを別の物が持っていても、値も影響もその物のもの。
   */
  const detailOf = (object: WorldObject, property: PropertyValue): StatusDetail => {
    const influences = object.readInfluences(codex.propertyNames.getId(property.def.name));
    return {
      description: locale.object(object.def.name).prop(property.def.name).description,
      stage:
        property.stage === undefined
          ? undefined
          : {
              name: locale.stage(property.stage.name),
              span: property.stage.span,
              boundaries: property.stage.boundaries,
            },
      // 与えている影響で動くのは相手、受けている影響で動くのは自分（influenceOfのmoved）。
      given: influences.given.map((influence) =>
        influenceOf(object, influence, movedByGiven(object, influence)),
      ),
      received: influences.received.map((influence) => influenceOf(object, influence, property)),
    };
  };

  /** 与えている影響で動く側＝相手のプロパティ。相手がオブジェクトなら読める値が無い。 */
  const movedByGiven = (object: WorldObject, influence: PropertyInfluence): PropertyValue | undefined =>
    influence.counterpart.kind === 'property'
      ? object.tryGetProperty(influence.counterpart.propertyGlobalId)
      : undefined;

  /** タグが付いたそのオブジェクトのプロパティを、表示名に直して並べる。未宣言のタグでは空。 */
  const entriesWithTag = (object: WorldObject, tagGlobalId: number | undefined): readonly StatusContent[] =>
    tagGlobalId === undefined
      ? []
      : object.propertiesWithTag(tagGlobalId).map((property) => {
          const texts = locale.object(object.def.name).prop(property.def.name);
          return {
            key: property.def.name,
            name: texts.displayName,
            icon: texts.icon,
            value: property.getEffectiveValue(),
            ratio: property.ratio,
            alert: property.alert,
            worsensUpward: property.def.worsensUpward,
            detail: detailOf(object, property),
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

  /** 束が映すもの（操作は持たない。それはcardOperationsが足す）。 */
  /**
   * その物が今いる場所。**世界が答える**ので、札を作る側が「どこの札か」を言い添える必要は無い
   * ——言い添えられると、実際に居る場所と食い違った札を作れてしまう。
   *
   * 親を持たない物（どのスロットにも入っていない）はカードにならないので、ここへは来ない。
   */
  const placeOfObject = (object: WorldObject): CardPlace => {
    const slot = object.parentSlot;
    if (slot === undefined) throw new Error(`親スロットに居ない物の札は作れない: ${object.def.name}`);
    return slot;
  };

  const stackOf = (
    instances: readonly WorldObject[],
    place: CardPlace,
  ): Omit<ObjectCardStack, keyof CardOperations> => ({
    // 見た目は代表のものを出す。個体ごとに違い得る値（状態のバー）を持つが、名前も絵も操作も代表の
    // ものなので、1枚に束ねたカードが映すのは代表の姿で揃える。
    ...looks.contentOf(instances[0]),
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    // スタックが渡してくる並びは中身が入れ替わり続ける実体（ObjectStack.members）なので、写し取る。
    objects: [...instances],
    objectGlobalId: instances[0].def.globalId,
    description: locale.object(instances[0].def.name).description,
    place,
    contentsFor: (dragged) => contentsOf(instances[0], dragged.objects[0]),
    visibleSlots: visiblePlacesOf(instances[0]),
  });

  /**
   * 実体化された土地の表示名。生成側（IslandMap）が持つのは識別子の組み合わせだけなので、
   * 表示文字列はここで対応表から組み立てる（Localization.md）。
   */
  const locationNameOf = (instanceId: number, defName?: string): string => {
    const named = instanceName(instanceId);
    if (named !== undefined) return named;

    // 名前を付けるのは地形生成だけ（IslandMap）なので、島の外の場所——筏・外洋・本土
    // （voyage.yaml）——はそこに載っていない。そういう場所は型の表示名がそのまま名前になる。
    const displayName = defName === undefined ? undefined : locale.object(defName).displayName;
    return displayName === undefined || displayName === defName ? UNNAMED_LOCATION : displayName;
  };

  const pathTagId = codex.vocabulary.world.pathTagId;
  /**
   * 道の設置物がカードに映すもの（道以外はundefinedで、設置物そのものの名前と絵をそのまま使う）。
   * 道は「どこへ繋がっているか」だけが意味を持つため、行き先の土地の名前と絵を出す。
   */
  const destinationOf = (
    fixture: WorldObject,
  ): { icon: string; name: string; art: string | undefined; kind: CardKind; road: true } | undefined => {
    if (!fixture.def.tags.includes(pathTagId)) return undefined;

    const path = new Path(fixture, codex);
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
        if (!fixture.def.tags.includes(pathTagId)) continue;
        const destination = siteOf.get(new Path(fixture, codex).destinationInstanceId);
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
   * 束のカード1枚ぶん（表示内容と操作の一そろい）。
   *
   * **ワールドが渡してくる並びは、中身が入れ替わり続ける実体（ObjectStack.members）なので、
   * ここで写し取る。** 操作の閉包（dropInto・movedIds等）まで写した並びを見ないと、経過の途中経過
   * （RecordedView）を再生する頃には実体が空になっていて、端の表示の試し打ち（PlayScene.cardEdges）
   * が先頭の無い束を踏む。
   */
  const cardOfStack = (live: readonly WorldObject[]): ObjectCardStack => {
    const stack = [...live];
    const place = placeOfObject(stack[0]);
    return {
      ...stackOf(stack, place),
      ...operations.forStack(stack, place),
      // 道だけは名前と絵が行き先のものに差し替わる（destinationOf参照）。**札を作る道は1本**なので、
      // どこから作った札でも同じ姿になる——束を割った1枚が、行き先ではなく道そのものの名前で出ない。
      ...destinationOf(stack[0]),
    };
  };
  /**
   * その物の探索率（探索できない物ではundefined＝探索のタブを出さない）。
   *
   * 探索できるかは**その物がexploreを宣言しているか**で決まる（ExplorationSystem.md）。探索の語彙を
   * 持たないCodexでは上限が0になるため、0除算を避けて0%にする。
   */
  const explorationRatioOf = (object: WorldObject): number | undefined => {
    if (!object.def.actions.some((action) => action.name === EXPLORE_ACTION)) return undefined;

    const explorable = new Location(object, codex);
    return explorable.explorationProgressMax === 0
      ? 0
      : explorable.explorationProgress / explorable.explorationProgressMax;
  };

  /**
   * その物の子ウィンドウに出るもの一式（Windows.md 1節）。**窓が映すのは1個ぶん**なので、束かどうかも、
   * どの枠に居るかも要らない——キャラクタも現在地も、押した札が映す物も同じこの1本を通る。
   */
  const windowOf = (object: WorldObject): ObjectWindowView => ({
    card: looks.contentOf(object),
    description: locale.object(object.def.name).description,
    actions: operations.actionsOf(object),
    slots: visiblePlacesOf(object),
    properties: propertiesOf(object),
    explorationRatio: explorationRatioOf(object),
  });

  const characterWindow = windowOf(game.player.instance);
  const currentLocationWindow = windowOf(location.instance);

  return {
    characterCard: characterWindow.card,
    characterWindow,
    currentLocationWindow,
    windowOf,
    conditions: ['💭', '🥶', '😪', '🍽️'],
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
    currentLocationCard: currentLocationWindow.card,
    places,
    slotViewOf,
    mapLands: discovered.lands,
    mapRoads: discovered.roads,
    cardsIn: (place) =>
      stacksIn(place).map((stack) => (stack === undefined ? undefined : cardOfStack(stack))),
    cardOfType: looks.typeContentOf,
    cardOfObjects: cardOfStack,
    combinationOf: (dragged, target, count = 1) => {
      // ドラッグが動かすのはスタックのうち1つなので、同じカードへ重ねたときはスタックの中の2つを
      // 組み合わせる（石と石のように、自分自身とcombinationできる場合）。
      const [first] = target.objects;
      const carried = dragged === target ? target.objects.slice(1) : dragged.objects;
      const held = carried[0];
      if (held === undefined) return undefined;

      // 落とされた側を先に、次に掴んだ側を見る（CardInteraction.md 2節）。素材側に1つ書けば、
      // 道具を素材へ運んでも素材を道具へ運んでも同じ組み合わせが成立する。
      //
      // **まとめられるのは、落とされた側が宣言している向きだけ。** 逆向きでは運んできた札の1枚ずつが
      // 別々のselfになるので、1つの器で数を決められない。
      return (
        operations.combinationWith(first, carried, carried, count) ??
        operations.combinationWith(held, [first], [held])
      );
    },
  };
}

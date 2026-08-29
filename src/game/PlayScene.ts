import Phaser from 'phaser';
import type { Rect } from '../ui/Rect';
import type { BarIconRow } from './looks/PlayScreenLayout';
import { CHARACTER_DISPLAY_PADDING, PlayScreenLayout } from './looks/PlayScreenLayout';
import { ScreenMetrics } from './looks/ScreenMetrics';
import { isAlive } from '../ui/lifetime';
import { SCREEN_DEPTH } from './looks/screenDepth';
import { causeOfDeathSentence } from './looks/deathTexts';
import { ResponsiveScene } from './ResponsiveScene';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import type { CardFilter } from '../domain/CardFilter';
import type { WorldCodex } from '../domain/WorldCodex';
import type { StartedGame } from '../domain/generation/NewGame';
import { resolveCharacterDefNameOrFirst, startNewGame } from '../domain/generation/NewGame';
import { seededRng } from '../domain/Rng';
import type { Localization } from '../locale/Localization';
import type { UiTextName } from '../locale/uiTexts';
import type { SaveData } from '../save/SaveData';
import { SAVE_SCHEMA_VERSION } from '../save/SaveData';
import { SaveSlots } from '../save/SaveSlots';
import { Settings } from '../save/Settings';
import { Shelf } from '../save/Shelf';
import { currentAssetPacks } from '../save/savedAssetPacks';
import type { Scenario } from '../scenario/Scenario';
import { applyScenario } from '../scenario/Scenario';
import { Path } from '../domain/wrappers/Path';
import type { InteractionGains } from '../domain/PropertyGain';
import type { WorldChange } from '../domain/WorldChange';
import type { WorldSignal } from '../domain/WorldSignal';
import type { WorldObject } from '../domain/WorldObject';
import type {
  NestedLocationView,
  ObjectCardStack,
  ObjectWindowView,
  PlayScreenView,
} from './view/PlayScreenView';
import type { CardAction } from './view/cardOperations';
import { EXPLORE_ACTION, fromGameSession } from './view/PlayScreenView';
import type { CardPlace, ScreenPlace } from './view/cardPlaces';
import type { CardSpot, ShownDrop } from './view/ShownCards';
import { ShownCards } from './view/ShownCards';
import type { RecordedView, Recording } from './view/recording';
import { runAndRecordChange } from './view/recording';
import { slotCells } from './view/slotCells';
import { noteOperation, setStateReporter } from './errorReport';
import { ShownStatuses } from './view/ShownStatuses';
import type { ElapseFrame } from './view/elapsePlayback';
import { ElapsePlayback } from './view/elapsePlayback';
import type { DaylightMoment } from './view/daylight';
import { SunlightHours } from './view/daylight';
import type { Activity } from './view/operationSteps';
import { playbackSteps, afterPlaybackSteps, isMidAction, acceptsOperation } from './view/operationSteps';
import { Button } from './ui/Button';
import { SLOT_BUTTON_PAPER_TEXTURE } from '../art/slotButtonArt';
import { EDGE_DIRECTIONS } from './ui/Card';
import type { CardContent, CardEdgeAction } from './ui/Card';
import { borrowedFace } from './ui/cardFace';
import type { CardDrop, CardDropInfo } from './ui/CardDragController';
import { CardDragController } from './ui/CardDragController';
import { CardLane } from './ui/CardLane';
import type { LaneCell } from './ui/laneCells';
import { foundCells, hiddenCountCells } from './ui/laneCells';
import { Curtain } from './ui/Curtain';
import { LocationArtLoader } from './ui/LocationArtLoader';
import { INFORMATION_BACKGROUND, INFORMATION_BORDER_PX, INFORMATION_OVERLAP_PX } from '../art/informationArt';
import { addNineSlice } from '../ui/nineSlice';
import { laneBackgroundTexture } from '../art/backgroundArt';
import { SEPARATOR_TEXTURE } from '../art/separatorArt';
import type { MotionContext } from './ui/CardTable';
import { CardTable } from './ui/CardTable';
import { bornInstances, originInstanceByInstance, vanishedInstances } from './view/changedInstances';
import { floatSignalLabel } from './ui/signalLabel';
import type { MapPlacement } from './ui/MapWindow';
import { MapWindow } from './ui/MapWindow';
import { ModalDialog } from './ui/ModalDialog';
import type { ObjectWindowAction } from './ui/ObjectWindow';
import { DESCRIPTION_TAB, EXPLORATION_TAB, ObjectWindow } from './ui/ObjectWindow';
import { RecipeWindow } from './ui/RecipeWindow';
import { recipeCategories } from './view/recipeList';
import { spawnInProgressObject } from '../domain/crafting';
import { emitGainParticles } from './ui/GainParticles';
import { ProgressRing } from './ui/ProgressRing';
import type { PropertyCategory as PropertyTab } from './ui/PropertiesPane';
import { ScreenAlertFrame } from './ui/ScreenAlertFrame';
import { ScrollArea } from '../ui/scrollArea';
import { ScrollIndicator } from './ui/ScrollIndicator';
import type { StatusContent } from './ui/StatusBar';
import { StatusBar } from './ui/StatusBar';
import { StatusDetailWindow } from './ui/StatusDetailWindow';
import type { IconName } from '../art/iconArt';
import { iconTexture } from '../art/iconArt';
import { WeatherPanel } from './ui/WeatherPanel';
import { WeatherOverlay } from './ui/WeatherOverlay';
import { ScreenSkyTint } from './ui/ScreenSkyTint';
import { DaybreakOverlay } from './ui/DaybreakOverlay';
import { LaneHaze } from './ui/LaneHaze';
import { heatHazeFor } from './looks/heatHaze';
import { clockParts } from './looks/timeTexts';
import { interactionTooltip } from './ui/Tooltip';
import { addLabel } from '../ui/labels';
import type { BoxStyle } from '../ui/shapes';
import { addInputBlockingPanel, addTiledImage, addTiledImageVertical, drawBox } from '../ui/shapes';
import { COLOR, SIZE } from './looks/theme';

/** 紙として置かれるボタン（スロットボタン・バーのアイコンボタン）が落とす影のずらし幅（u単位）。 */
const PAPER_BUTTON_SHADOW = 1.5;

/**
 * バーのアイコンボタンに載せる絵文字の大きさ（88u角のボタンに対して）。**ボタンの余白より絵が
 * 目に入る大きさにする**——小さいと、押せる物ではなく白い四角の方が先に見える。
 */
const ICON_BUTTON_GLYPH_SIZE = 58;

/**
 * ゲーム内時間の経過を実時間で見せる速さ（ゲーム内15分＝現実0.5秒）。durationを持つアクションは、
 * この速さで時間が経ち切るまで結果を見せない。
 */
const REAL_MS_PER_GAME_MINUTE = 500 / 15;

/**
 * 1回の経過に使う実時間の上限（CardInteraction.md 7節）。**これを超える長さの行動は、この時間に
 * 収まるよう早送りする**——半日眠るのを等速で見せると十数秒待たされ、待つこと自体が休息の値段に
 * なってしまう。刻み方（tick境界で一拍置く）は変わらず、目盛りの間隔だけが詰まる。
 *
 * 上限はこれまでで最も長い行動（90分の「編む」）の実時間に合わせてあるので、そこまでの行動の
 * 見え方は変わらない。
 */
const REAL_MS_MAX = 90 * REAL_MS_PER_GAME_MINUTE;

/** minutes 分のゲーム内時間を見せるのにかける実時間。 */
function realMsFor(minutes: number): number {
  return Math.min(minutes * REAL_MS_PER_GAME_MINUTE, REAL_MS_MAX);
}

/**
 * タグで書かれた要求の空き枠に、当てはまる型を出し替える間隔（ms）。
 *
 * **速すぎると読めず、遅すぎると1つの型に見える。** 1秒は、札の名前を読み終えて次が来る間隔。
 */
const MATERIAL_CYCLE_MS = 1000;

/**
 * 満タンぶんの増加を何粒で表すか（CardInteraction.md 10.2節）。**比例ではなく平方根**なので、
 * 粒がn個なら満タンのn²パーセントにあたる。粒数はceilなので、どれだけ小さい増加でも必ず1粒は出る
 * ——安全域で見えないままの変化を知らせるのがこの演出の役目。
 */
const PARTICLES_PER_FULL = 10;

/** 時間を消費しない操作には経過を見せる間が無いので、この短い間に粒を散らす。 */
const INSTANT_GAIN_SPREAD_MS = 600;

/** 場面転換の明転にかける時間（ミリ秒）。 */
const BRIGHTEN_MS = 320;

/**
 * 場面転換の暗転にかける時間（ミリ秒）。時間経過を待たずに素早く落とし、あとは暗いまま経過を見せる
 * （時計とドーナツグラフは暗幕より手前に出る）。明転より長く取るのは、場面が変わる合図として
 * 落ちていく途中を見せたいため。移動にかかる時間がこれより短ければ、その分だけで落とし切る。
 */
const DARKEN_MS = BRIGHTEN_MS * 2;

/** エラー報告に載せる、演出中の呼び名（errorReport参照）。 */
const ACTIVITY_TEXT_NAMES: Readonly<Record<Activity, UiTextName>> = {
  idle: 'activity_idle',
  exploring: 'activity_exploring',
  elapsing: 'activity_elapsing',
  transiting: 'activity_transiting',
};

/**
 * バーのアイコンボタン1つ。絵があればそれを、無ければ絵文字を置く（iconArt参照）。
 *
 * **絵の名前は画面が名指しするとは限らない**——フィルターのボタンはワールドの宣言が名乗る
 * （`card_filters`の`id`、ScreenLayout.md 8.1.3節）。
 */
interface BarIcon {
  readonly art?: string;
  readonly icon: string;
}

/** メニューだけは押したときの行き先があるため、判別できるよう切り出す。 */
const MENU_ICON: BarIcon = { icon: '☰' };

/**
 * スロットボタンの代役アイコン。**絵（art）が届くまでの繋ぎ**で、押した先の中身とは関係が無い
 * ——ボタンの姿は画面の意匠なので、ワールドを映すPlayScreenViewには置かない。
 *
 * レシピだけ道具の絵を避けているのは、下のフィルターバーが道具の絞り込みに🔨を使っているため。
 */
const SLOT_BUTTON_ICONS = { map: '🗺️', equipment: '👕', injuries: '🩹', recipe: '📜' } as const;

/**
 * 状況アイコンの代役。**絵（art）が届くまでの繋ぎ**で、スロットボタンと同じ扱い。
 *
 * ここに識別子が並んでいても、**何をいつ出すかを決めているのは世界の側の宣言**（段の`situation`、
 * ScreenLayout.md 4.1.1節）で、ここが決めているのは絵が届くまでの見た目だけ。だから知らない識別子が
 * 来ても落とさず、UNKNOWN_SITUATION_ICONを出す——出すと決めたものが黙って消えるほうが悪い。
 */
const SITUATION_ICONS: Readonly<Record<string, string>> = {
  too_dark_for_handwork: '🕯️',
  too_dark_outside: '🌘',
  no_road: '🌑',
  sheltered: '🛖',
};

/** 絵も代役も無い識別子の代役。 */
const UNKNOWN_SITUATION_ICON = '❔';

/** 状況アイコンに載せる絵のキャンバスと絵文字の大きさ（48uの枠の内側。オプションバーと同じ比）。 */
const CONDITION_ICON_ART = 44;
const CONDITION_GLYPH_SIZE = 28;

/**
 * キャラクタの見えるスロット（`visible_slots`）1つにつき1つ並ぶボタンの姿。**どのスロットが並ぶかを
 * 決めるのはワールド**（characterWindow.slots）で、ここが持つのは姿だけ。
 *
 * 姿を用意していないスロットにはボタンを出さない——染めは絵に焼いてあり（COLOR参照）、絵と色の
 * 両方を用意して初めてこの列に並べられる。ボタンが無くても、キャラクタの窓のタブからは開ける。
 */
const CHARACTER_SLOT_BUTTONS: Readonly<
  Partial<Record<string, { art: IconName; icon: string; fill: number }>>
> = {
  equipment: { art: 'equipment', icon: SLOT_BUTTON_ICONS.equipment, fill: COLOR.equipmentButton },
  injuries: { art: 'injury', icon: SLOT_BUTTON_ICONS.injuries, fill: COLOR.injuryButton },
};

const OPTION_ICONS: readonly BarIcon[] = [
  { art: 'settings', icon: '⚙️' },
  { art: 'codex', icon: '📖' },
  { art: 'diary', icon: '📓' },
  MENU_ICON,
];
/**
 * 絞り込みを解除するボタン（ScreenLayout.md 8.1.1節）。**ワールドのフィルターの一覧には入れず、
 * 画面が常に先頭へ置く**——アセットパックが解除の手段を消せてしまうため。
 */
const FILTER_ALL_ICON: BarIcon = { art: 'filter_all', icon: '🗂️' };

/** プレイ中の画面を開くときに渡す、対象のセーブデータ。 */
export interface PlaySceneData {
  readonly save: SaveData;
  /** セーブスロットの番号。シナリオからの起動（BootScene）はセーブへ書き戻さないため-1。 */
  readonly slotIndex: number;
  /** テスト用シナリオ。渡すと、シードから作り直した世界へ開始状態を置いてから始める。 */
  readonly scenario?: Scenario;
}

/**
 * 今画面に出ているレーン1本と、それが映しているもの。**レーンは表示物、場所は映しの語彙**で、
 * その対を持てるのは両方を知っているこの画面だけ（PlayScene.shownLanes）。
 */
interface ShownLane {
  readonly lane: CardLane;
  /** 映している場所。ワールドの場所を映さない枠（ポートレイト・発見物）は持たない。 */
  readonly spot: CardSpot | undefined;
  /**
   * そこへ並べる枠。**引くのは差し替えのときだけ**——どの場所を映しているかを訊くだけの呼び出し
   * （ドラッグ中は指が動くたびに来る）で、全レーンぶんの札を組み立てないため。
   */
  readonly cells: () => readonly LaneCell[];
}

/** シナリオで動かすキャラクタ。開始状態の見え方を確かめるのが目的なので、基準どおりの体に固定する。 */
const SCENARIO_CHARACTER = 'medic';

/**
 * テスト用シナリオでプレイ画面を開くためのデータ。
 *
 * シナリオはセーブスロットを使わない（書き戻しもしない）ため、島の名前と生存日数は表示用の仮値になる。
 */
export function scenarioPlayData(scenario: Scenario): PlaySceneData {
  return {
    save: {
      schemaVersion: SAVE_SCHEMA_VERSION,
      islandName: scenario.title,
      seed: scenario.seed,
      characterId: SCENARIO_CHARACTER,
      createdAt: 0,
      elapsedDays: 0,
      pinnedStatuses: [],
      mapCardPositions: [],
      assetPacks: currentAssetPacks(),
    },
    slotIndex: -1,
    scenario,
  };
}

/**
 * プレイ中の画面（ScreenLayout.md）。
 *
 * カードはレーンからはみ出しても切り抜かず、後から描く隣接エリアの背景板で隠す。そのため
 * 組み立ての順序（フィールドエリア → ダッシュボード列 → オプション／フィルターバー）に意味がある。
 * フィールドエリアの表示物だけは、順序ではなくFIELD_DEPTHの層で奥へ置く（そこだけを作り直すため）。
 */
export class PlayScene extends ResponsiveScene {
  /** いずれもinitで必ず設定される（Phaserはinit→createの順に呼ぶ）。 */
  private codex!: WorldCodex;
  private locale!: Localization;
  private gameSession!: StartedGame;
  private view!: PlayScreenView;

  /** カードを並べるレーンと、その内容の差し替えを動きとして見せる層。buildのたびに作り直される。 */
  private fixtureLane!: CardLane;
  private itemLane!: CardLane;
  private handLane!: CardLane;
  /**
   * ポートレイトを置く枠1つのレーン（CardLaneOptions.bare）。キャラクタ自身の札も他と同じレーンの
   * 札なので、子ウィンドウへ貸し出すのも、そこから帰ってくるのも他のカードとまったく同じ経路を通る。
   */
  private portraitLane!: CardLane;
  private cardTable!: CardTable;
  private situationPanel!: WeatherPanel;

  /** フィールドエリアの背景板。レーンと合わせて、フィールドエリアだけを作り直すときに捨てる。 */
  private fieldPanel!: Phaser.GameObjects.Rectangle;

  /** 天気に応じてフィールドエリアへ降らせる雨。現在地には依らないので、作り直しの対象外。 */
  private weatherOverlay!: WeatherOverlay;

  /** 明るさに応じて画面全体へかぶせる翳り・輝き。雨と同じく作り直しの対象外。 */
  private skyTint!: ScreenSkyTint;

  /**
   * 太陽の光だけで手元の細かい作業ができる時刻（SunlightHours）。世界の宣言から決まるので、
   * このプレイの間は変わらない。
   */
  private sunlight!: SunlightHours;

  /**
   * 今この画面が映している日付と時刻。**次に映すものと比べて、日の出・日の入りの境目をまたいだかを
   * 訊く**（showDaybreak）ので、またいだかを憶えるのではなく、映しているものだけを憶える。
   */
  private shownDaylight!: DaylightMoment;

  /** 出ている最中の日の出・日の入りの演出。次のがすぐ来る（夜を通して眠る）ときは差し替える。 */
  private daybreakOverlay: DaybreakOverlay | undefined;

  /** アイテムレーンに立てる陽炎。掛ける対象はフィールドエリアの作り直しで入れ替わる。 */
  private haze!: LaneHaze;

  /** 各エリアの位置・大きさ。画面寸法から決まるので、buildのたびに作り直される。 */
  private layout!: PlayScreenLayout;

  private drag!: CardDragController;

  /**
   * 選んでいる絞り込みのボタンの位置（0は「すべて」＝絞り込まない、ScreenLayout.md 8.1.6節）。
   * **場所を移っても時間が経っても続く**ので、画面の作り直しでは捨てない。
   */
  private selectedFilter = 0;
  private filterButtons: Button[] = [];

  /**
   * 開いている子ウィンドウ（ObjectWindow）と、それが映しているもの。**画面の作り直しをまたいで
   * 開いたままにするために持つ。**
   *
   * `childWindowPlace`は**今開いているタブが映している場所**（説明のタブではundefined）。中身を
   * 映している間は、その場所が手持ちの「隣」になる（laneCardsWithEdgeActions・stacksOf参照）。
   */
  private childWindow: ObjectWindow | undefined;
  private childWindowPlace: CardPlace | undefined;

  /** タブに並べているスロットと、その識別子（説明のタブは並びの外なので持たない）。 */
  private childWindowTabs: readonly { readonly key: string; readonly place: CardPlace }[] = [];

  /** 開いているタブを覚える型の名前（覚えない相手ではundefined、Windows.md 1.2節）。 */
  private childWindowDef: string | undefined;

  /** タブの記憶の置き場所。セーブ枠ではなくプレイヤーの好みなので、設定と同じところに置く。 */
  private readonly settings = new Settings(localStorage);

  /**
   * 画面に出ている札の並び（ShownCards）。**表示もタップもドラッグもここを通す**——見えている札と
   * 操作が動かすインスタンスを別々に数えないため。
   *
   * 読む先は呼び出しで渡す。viewは行動のたびに作り直され、借り出しも開閉のたびに変わるので、
   * 控えを持たせると古い並びを答えることになる。
   */
  private readonly shown = new ShownCards({
    stacksIn: (...asked) => this.view.cardsIn(...asked),
    cardOfObjects: (...asked) => this.view.cardOfObjects(...asked),
    combinationOf: (...asked) => this.view.combinationOf(...asked),
    visible: (...asked) => this.view.visible(...asked),
    windowPlace: () => this.childWindowPlace,
    places: (...asked) => this.placeOfScreen(...asked),
    filter: () => this.cardFilter,
  });

  /** 今選ばれている絞り込み（「すべて」を選んでいる間はundefined）。 */
  private get cardFilter(): CardFilter | undefined {
    return this.codex.cardFilters[this.selectedFilter - 1];
  }

  /**
   * 設置物レーンが映している場所を、現在地から外側へ数えた段（0が現在地。ScreenLayout.md 7.1.1節）。
   * **覚えるのは段であって場所そのものではない**——外側が無くなれば（筏から降りれば）自動的に
   * 現在地へ戻り、外側を見ていたという記憶がどこにも残らない。
   */
  private shownLocationDepth = 0;

  /**
   * ステータスエリアに出ている行と、その見え方（ShownStatuses）。**行の選び方・増減・固定表示を
   * 混ぜた結果はここが答える**——画面はバーを並べる位置だけを決める。
   */
  private readonly status = new ShownStatuses({
    statuses: () => this.view.statuses,
    categories: () => this.view.propertyCategories,
    midAction: () => this.midAction,
    onPinned: () => {
      this.savePinnedStatuses();
      this.showStatuses();
      // 子ウィンドウのプロパティのタブを開いたまま切り替えられるため、そちらの印も引き直す。
      this.childWindow?.setProperties(this.status.tabs());
      // 付け外しを頼んできた詳細ウィンドウにも、切り替わった結果を返す。
      const key = this.statusDetailKey;
      if (key !== undefined) {
        this.statusDetailWindow?.setPinned(this.status.contentOf(key)?.pinned === true);
      }
    },
    onOpenDetail: (key) => this.openStatusDetail(key),
  });

  /** 開いている地図ウィンドウ。探索の子ウィンドウと同じく、画面の作り直しをまたいで開いたままにする。 */
  private mapWindow: MapWindow | undefined;

  /** 開いているレシピ一覧（RecipeWindow）。開いていなければundefined。 */
  private recipeWindow: RecipeWindow | undefined;

  /**
   * 開いているステータス詳細ウィンドウと、それが映しているステータスの識別子。画面の作り直しを
   * またいで開いたままにするため、どのステータスを映していたかを憶える（値は引き直す）。
   */
  private statusDetailWindow: StatusDetailWindow | undefined;
  private statusDetailKey: string | undefined;

  /**
   * ステータスエリアに出しうるバー（プロパティの識別子で引く）。出す行と並び順は行動のたびに変わるが、
   * バー自体は画面の組み立て時に全プロパティ分を作っておく（showStatuses参照）。
   */
  private statusBars: ReadonlyMap<string, StatusBar> = new Map();

  /** ポートレイトカードの枠。キャラクタ自身を映す札なので、回復の粒の行き先になる（showGains）。 */
  private portraitRect: Rect | undefined;

  /**
   * 状況アイコンの行。**中身は行動のたびに入れ替わる**（showConditions）ので、画面の組み立て時に器を
   * 作っておき、以後はこの中だけを作り直す——あとから作った表示物は、開いている子ウィンドウの覆いより
   * 手前へ出てしまう（buildStatusAreaと同じ理由）。
   */
  private conditionRow!: Phaser.GameObjects.Container;

  /** ステータスエリアの行の間隔（どのバーをどの行へ置くかは行動のたびに引き直す）。 */
  private statusRowGap = 0;

  /** 致命的域のステータスがある間、画面全体の枠を明滅させる。 */
  private alertFrame!: ScreenAlertFrame;

  /**
   * 開いているセーブデータとそのスロット番号。固定表示の書き戻し先として持つ（savePinnedStatuses）。
   * シナリオからの起動はスロットを使わないため-1。
   */
  private save!: SaveData;
  private slotIndex = -1;

  /**
   * ユーザが地図に置いたカードの位置（サイトindex→正規化座標）。セーブデータが持つ値の
   * 作業用の複製で、カードを置くたびにスロットへ書き戻す（placeMapCard）。
   */
  private mapPositions = new Map<number, MapPlacement>();

  /**
   * 今この画面が見せている最中のこと。**立てるのは始める側、降ろすのは終わらせる側の1箇所ずつ**
   * ——別々のbooleanで持つと、片方だけ降ろし忘れて操作を受け付けないまま固まる。
   *
   * - `exploring`: 探索の結果待ち（経過も見せている。次の探索は始められない）
   * - `elapsing`: 行動の経過を見せている（passTime参照）
   * - `transiting`: 場面転換の暗転 → フィールドエリアの作り直し → 明転（transit参照）
   */
  private activity: Activity = 'idle';

  /** 土地の絵の遅延ロード。initで必ず設定される。 */
  private artLoader!: LocationArtLoader;

  /**
   * 絵待ちの世代番号。画面の作り直し（rebuild）は張っていた暗幕ごと表示物を捨てるため、
   * 捨てられた幕を明転させようとする古い待ちをこの番号の不一致で無効にする
   * （revealWhenLocationArtLoaded参照）。
   */
  private artWaitGeneration = 0;

  /** 演出を見せている最中か。この間はワールドを変える操作を受け付けない（acceptsOperation）。 */
  private get busy(): boolean {
    return !acceptsOperation(this.activity);
  }

  /** 行動の途中の値を見せているか（isMidAction）。 */
  private get midAction(): boolean {
    return isMidAction(this.activity);
  }

  /** タグの要求の空き枠に出している型の番号（materialCells）。1秒ごとに1つ進む。 */
  private materialCycle = 0;

  /**
   * 演出中は何もしないようにした操作を返す。演出中の画面は、経過中の過去の時点を再現していたり
   * （record）作り直しを暗幕で隠していたり（transit）するため、そこから今のワールドを覗く子ウィンドウを
   * 開かせない——並んでいるカードは既に古い対象を指しており、そのアクションを実行させるわけにいかない。
   */
  private whileIdle(onTap: () => void): () => void {
    return () => {
      if (!this.busy) onTap();
    };
  }

  constructor() {
    super('play');
  }

  /**
   * セーブデータのシードから世界を作り直す。ワールド状態そのものの保存はまだ無いため
   * （SaveDataManagement.md）、新規作成でも既存スロットを開いた場合でも、同じシードから
   * 同じ開始状態を組み立てて表示する。
   */
  init(data: PlaySceneData): void {
    this.codex = this.registry.get(WORLD_CODEX_KEY) as WorldCodex;
    this.locale = this.registry.get(LOCALIZATION_KEY) as Localization;
    // Phaserはシーンのインスタンスを使い回すため、前のプレイの状態は必ずここで入れ替える。
    this.save = data.save;
    this.slotIndex = data.slotIndex;
    this.status.reset(data.save.pinnedStatuses);
    this.mapPositions = new Map(
      data.save.mapCardPositions.map((position) => [position.site, { x: position.x, y: position.y }]),
    );
    const character = resolveCharacterDefNameOrFirst(this.codex, data.save.characterId);
    this.gameSession = startNewGame(this.codex, character, data.save.seed, seededRng(data.save.seed));
    if (data.scenario !== undefined) applyScenario(this.gameSession, data.scenario, this.codex);
    this.view = this.viewOfGame();
    this.sunlight = SunlightHours.of(this.codex, this.gameSession.player.instance.def);
    // 開いた時点の空を基準にする。開いた瞬間にまたいだことにはならない。
    this.shownDaylight = { elapsedDays: this.view.elapsedDays, hour: this.view.hour };
    this.artLoader = new LocationArtLoader(this, this.codex);
    this.requestLocationArt();
    this.resetForNewVisit();

    // エラー報告に載せる状態を、このシーンが居る間だけ答える（errorReport参照）。
    const from =
      data.scenario !== undefined
        ? this.locale.uiText('log_from_scenario', { title: data.scenario.title })
        : this.locale.uiText('log_from_slot', { index: String(this.slotIndex + 1) });
    noteOperation(this.locale.uiText('log_play_opened', { from, seed: String(data.save.seed) }));
    setStateReporter(() => this.stateLines());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => setStateReporter(undefined));
  }

  /**
   * 画面の作り直し（build）をまたいで持つものを、このプレイのぶんとして構え直す。
   *
   * Phaserはシーンのインスタンスを使い回すが、シーンを出るときにinput・eventsの購読をすべて外す
   * （InputPlugin.shutdown）。作り直しのたびに作らないもの——購読を持つ受け口も、開いている
   * ウィンドウや演出の途中も——は、ここで作り直さない限り前のプレイのものが居座る。
   */
  private resetForNewVisit(): void {
    this.drag = new CardDragController(this, () => this.metrics, {
      describeDrop: (drop) => this.describeDrop(drop),
      onDrop: (drop, releasedRect) => this.applyDrop(drop, releasedRect),
      grab: (card, home) => this.cardTable.grab(card, home),
    });
    this.haze = new LaneHaze(this);

    // 開いていたウィンドウは前のプレイの世界を映している。入り直したら何も開いていない状態から始める。
    this.childWindow = undefined;
    this.childWindowPlace = undefined;
    this.shown.reset();
    this.mapWindow = undefined;
    this.statusDetailWindow = undefined;
    this.statusDetailKey = undefined;
    this.recipeWindow = undefined;

    // 見せている最中だった演出は、それを終わらせるtweenごと消えている（終わったものとして始める）。
    this.daybreakOverlay = undefined;
    this.activity = 'idle';
    this.selectedFilter = 0;
    this.shownLocationDepth = 0;
  }

  /**
   * 設置物レーンが今映している段。**映せる段が減っていたら内側へ引き戻す**ので、筏から降りた後に
   * 「もう無い外側」を指し続けることがない。
   */
  private get shownDepth(): number {
    return Math.min(this.shownLocationDepth, this.view.nestedLocations.length - 1);
  }

  /** 設置物レーンが今映している場所（PlayScreenView.nestedLocations）。 */
  private get shownLocation(): NestedLocationView {
    return this.view.nestedLocations[this.shownDepth];
  }

  /**
   * 常に見えている3つのレーンが今映している場所。**土地を移れば別の場所を指す**ので、その都度
   * ビューへ訊く（cardPlaces）。
   *
   * **設置物レーンだけは現在地の外側を映せる**（ScreenLayout.md 7.1.1節）。アイテムレーンと
   * ハンドレーンは現在地とプレイヤーのものから動かない。
   */
  private placeOfScreen(screen: ScreenPlace): CardPlace {
    return screen === 'fixtures' ? this.shownLocation.fixtures : this.view.places(screen);
  }

  /** エラー報告に載せる、場所1つ。同じ型の入れ物が複数あっても見分けられるよう、持ち主も出す。 */
  private placeText(place: CardPlace): string {
    return this.locale.uiText('state_place', {
      owner: place.owner.def.name,
      id: String(place.owner.instanceId),
      slot: this.view.slotViewOf(place).key,
    });
  }

  /** エラー報告に載せる、今の画面の状態（errorReport.setStateReporter）。 */
  private stateLines(): readonly string[] {
    return [
      this.locale.uiText('state_world_time', { clock: this.clockText() }),
      this.locale.uiText('state_location', { name: this.view.currentLocationCard.name }),
      this.locale.uiText('state_activity', {
        activity: this.locale.uiText(ACTIVITY_TEXT_NAMES[this.activity]),
      }),
      this.locale.uiText('state_child_window', {
        place:
          this.childWindowPlace === undefined
            ? this.locale.uiText('state_no_child_window')
            : this.placeText(this.childWindowPlace),
      }),
      this.locale.uiText('state_hand', {
        cards: this.view
          .cardsIn(this.placeOfScreen('hand'))
          .map((card) => card?.name ?? this.locale.uiText('state_empty_cell'))
          .join(' / '),
      }),
      this.locale.uiText('state_items', {
        cards: this.view
          .cardsIn(this.placeOfScreen('items'))
          .map((card) => card?.name)
          .join(' / '),
      }),
    ];
  }

  /**
   * 今の世界で絵が要る土地——現在地と、道の行き先——のロードを始める（冪等）。
   * 道が見つかった瞬間・移動が確定した瞬間（ワールドを変えた直後）に呼ぶことで、その絵が大きく映る
   * 場面（行き先の土地カード・移動後のフィールド）までにロードを済ませておく。間に合わなかった絵は、
   * カードなら届いた時点で貼り替わり（Card）、移動なら暗転のまま待つ（transit）。
   */
  private requestLocationArt(): void {
    this.artLoader.request(this.currentLandArtKey);

    const location = this.gameSession.player.location;
    if (location === undefined) return;

    // 発見済みの道の行き先は、移動に備えて絵を全部読む。
    for (const name of this.pathDestinationNames(location.fixtures)) this.artLoader.request(name);
    // 未発見の道の行き先は、土地カードの絵1枚だけ読んでおく。道は発見と同時に行き先の絵のカードと
    // して現れるため、発見してからでは間に合わない。残りの背景は発見後（上のrequest）が受け持つ。
    for (const name of this.pathDestinationNames(location.undiscoveredFixtures)) {
      this.artLoader.requestCardArt(name);
    }
  }

  /** 設置物の並びに含まれる道の、行き先の土地のobject_defの識別子。 */
  private pathDestinationNames(fixtures: readonly WorldObject[]): readonly string[] {
    const pathTagId = this.codex.vocabulary.world.pathTagId;

    const names: string[] = [];
    for (const fixture of fixtures) {
      if (!fixture.def.hasTag(pathTagId)) continue;
      const destination = new Path(fixture, this.codex).destination;
      if (destination !== undefined) names.push(destination.def.name);
    }
    return names;
  }

  protected build(): void {
    const layout = new PlayScreenLayout(this.metrics);
    this.layout = layout;
    // 開いていた子ウィンドウは、画面を作り直したあと同じものを開き直す（表示物は捨てられているため）。
    const openedPlace = this.childWindowPlace;
    const wasShowingMap = this.mapWindow !== undefined;
    const openedStatus = this.statusDetailKey;
    const openedCard = this.shown.windowStack;
    // 運んでいる途中だった札は、表示物ごと捨てられている（着いたものとして作り直す）。
    this.childWindow = undefined;
    this.shown.returnBorrowed();
    this.childWindowPlace = undefined;
    this.mapWindow = undefined;
    this.statusDetailWindow = undefined;
    this.statusDetailKey = undefined;

    // 手前から奥への重なりに合わせて組み立てる。レーンからはみ出したカードは切り抜かず、
    // 後から描く背景板で隠す設計のため、順序そのものに意味がある。
    this.buildFieldArea(layout);
    // 雨は自前の層（SCREEN_DEPTH.weather）に居るので、順序ではなく深度でカードの手前・背景板の奥に入る。
    this.weatherOverlay = new WeatherOverlay(
      this,
      this.metrics,
      layout.fieldArea,
      this.view.weather,
    ).setDepth(SCREEN_DEPTH.weather);
    // 翳り・輝きは画面全体にかぶるので、組み立ての順序ではなく深度で最前面近くへ出す。
    this.skyTint = new ScreenSkyTint(this, this.metrics, this.view.ambientBrightness).setDepth(
      SCREEN_DEPTH.skyTint,
    );
    // 飛んでいるカードの層はフィールドエリアの作り直しでは捨てないので、そちらには含めない。
    this.cardTable = new CardTable(this, this.metrics);
    // タグで書かれた要求の空き枠に、当てはまる型を順に出すための拍（materialCells）。
    this.time.addEvent({
      delay: MATERIAL_CYCLE_MS,
      loop: true,
      callback: () => this.advanceMaterialCycle(),
    });
    this.buildFilterBar(layout.filterBar);
    // 横型のオプションバーはフィールドエリアの隣（右サイドバー）なので、フィルターバーと同じく
    // レーンのはみ出しを隠す背景板を兼ねる。縦型は情報エリアの中なので、ページを敷いた後に置く。
    if (this.metrics.isLandscape) this.buildOptionsBar(layout.optionsBar);
    // 区切りの帯は隣接エリアへもかぶるため、それらの背景板を描き終えてから敷く。
    for (const rect of layout.laneSeparators) addTiledImage(this, rect, SEPARATOR_TEXTURE);
    // フィールドエリアの左右の境目は、同じ絵を90度回して縦向きに敷く（横型のみ）。左の帯が本の縁で
    // 終わって見えるのは、この後に置くページが手前から覆うため。
    if (layout.fieldLeftSeparator !== undefined) {
      addTiledImageVertical(this, layout.fieldLeftSeparator, SEPARATOR_TEXTURE);
    }
    if (layout.sidebarSeparator !== undefined) {
      addTiledImageVertical(this, layout.sidebarSeparator, SEPARATOR_TEXTURE);
    }
    // 情報エリアのページはフィールドエリアへ食い込むので、帯より後（＝手前）に置く。
    this.buildInformationArea(layout);
    this.buildDashboard(layout);
    if (!this.metrics.isLandscape) this.buildOptionsBar(layout.optionsBar);
    // 本の外の帯どうしの境目は、バーの上に重ねるので最後に敷く（縦型のみ）。
    if (layout.optionsBarSeparator !== undefined) {
      addTiledImage(this, layout.optionsBarSeparator, SEPARATOR_TEXTURE);
    }
    // 状況エリアと本の境目も同じ層（縦型のみ）。
    if (layout.situationSeparator !== undefined) {
      addTiledImage(this, layout.situationSeparator, SEPARATOR_TEXTURE);
    }
    // 子ウィンドウは最初の差し替えより先に開き直す。**借りた1枚はウィンドウの枠に並ぶ**ので、
    // 開いてから出せば、既にそこに在ったものとしてその場に現れる（運んで見せない）。
    if (openedCard !== undefined) this.openObjectWindow(openedCard);
    else if (openedPlace !== undefined) this.openCharacterWindow(openedPlace);
    // レーンはカードを作らない（CardTable参照）ので、組み上がったところで最初の差し替えを通して
    // 札を出す。作り直しの直後は出どころが無いので、飛ばずその場に現れる。
    this.showView();
    // 地図は全画面を覆うので、さらにその上へ開き直す。
    if (wasShowingMap) this.openMapWindow();
    // ステータスの詳細は、子ウィンドウの上からも開けるので最後に開き直す。
    if (openedStatus !== undefined) this.openStatusDetail(openedStatus);
    this.coverUntilLocationArtLoaded();
    // 死も到達も取り消せないので、リサイズで表示物ごと捨てられたダイアログは出し直す（ResponsiveScene）。
    const ending = this.gameSession.player.ending.kind;
    if (ending === 'death') this.showDeath();
    else if (ending === 'escape') this.showEscape();
  }

  /**
   * 現在地の絵がまだ届いていなければ（プレイ開始直後・絵待ち中の作り直し）、届くまでフィールド
   * エリアを暗幕で覆う。届いた時点で作り直して明転する——組み立て済みの表示に絵だけを後から
   * 差し込む経路は無いため。
   */
  private coverUntilLocationArtLoaded(): void {
    // 作り直し前の幕を明転させようとする待ちが残っていれば無効にする（幕は作り直しで消えている）。
    this.artWaitGeneration += 1;
    if (this.locationArtLoaded) {
      // 場面転換の途中で作り直された場合、その転換の明転はもう起きない。busyのまま固まらないよう戻す。
      this.activity = 'idle';
    } else {
      this.activity = 'transiting';
      const curtain = new Curtain(this, this.layout.fieldArea);
      curtain.darken(0);
      this.revealWhenLocationArtLoaded(curtain);
    }
  }

  private buildFieldArea(layout: PlayScreenLayout): void {
    this.fieldPanel = addInputBlockingPanel(this, layout.fieldArea, COLOR.fieldArea).setDepth(
      SCREEN_DEPTH.field,
    );
    const [, items, hand] = layout.lanes;

    this.fixtureLane = this.buildFixtureLane(layout);
    this.itemLane = new CardLane(
      this,
      this.metrics,
      items,
      COLOR.itemLane,
      this.cellsAt(this.placeOfScreen('items')),
      {
        art: this.laneArt(this.placeOfScreen('items')),
        depth: SCREEN_DEPTH.field,
      },
    );
    this.handLane = new CardLane(
      this,
      this.metrics,
      hand,
      COLOR.handLane,
      this.cellsAt(this.placeOfScreen('hand')),
      {
        art: this.laneArt(this.placeOfScreen('hand')),
        depth: SCREEN_DEPTH.field,
      },
    );

    this.showHaze();
    this.setDragLanes();
  }

  /**
   * 設置物レーン。**ピン留めの札も敷く絵も、映している場所のもの**（ScreenLayout.md 7.1.1節）なので、
   * 映す先が変われば作り直す相手はこのレーンだけになる（rebuildFixtureLane）。
   */
  private buildFixtureLane(layout: PlayScreenLayout): CardLane {
    const place = this.placeOfScreen('fixtures');
    return new CardLane(this, this.metrics, layout.lanes[0], COLOR.fixtureLane, this.cellsAt(place), {
      pinned: {
        ...this.shownLocation.window.card,
        // 映している場所そのものの子ウィンドウ。**中に入ると外の並びから札が消える**ので、探索する・
        // 降りる・出航する・部品を差し替えるはここからしか辿れない。
        onTap: this.whileIdle(() => this.openLocationWindow()),
        edges: this.locationEdges(),
      },
      art: this.laneArt(place),
      depth: SCREEN_DEPTH.field,
    });
  }

  /** 陽炎はフィールドエリアの3レーンすべてに立てる（LaneHaze参照）。レーンを作り直したら張り直す。 */
  private showHaze(): void {
    this.haze.setSurfaces([
      this.fixtureLane.hazeSurface,
      this.itemLane.hazeSurface,
      this.handLane.hazeSurface,
    ]);
    this.haze.setHaze(heatHazeFor(this.view.ambientTemperature));
  }

  /** 今の空を画面へ映し直す（ScreenLayout.md 7.5節 空の演出）。 */
  private showSky(): void {
    this.weatherOverlay.setWeather(this.view.weather);
    this.skyTint.setAmbientBrightness(this.view.ambientBrightness);
    this.showDaybreak();
  }

  /**
   * 前に映した時刻から日の出・日の入りの境目をまたいでいれば、その演出を出す
   * （ScreenLayout.md 7.5.6節）。経過の再生は控えを1つずつここへ通す（showRecorded）ので、
   * **またいだtickのところで出る**——経過し切ってからまとめて出ることはない。
   */
  private showDaybreak(): void {
    const shown = this.shownDaylight;
    this.shownDaylight = { elapsedDays: this.view.elapsedDays, hour: this.view.hour };
    const daybreak = this.sunlight.daybreakBetween(shown, this.shownDaylight);
    if (daybreak === undefined) return;

    // 夜を通して眠れば日の入りと日の出が続けて来る。前のが醒め切るのを待たずに差し替える。
    this.daybreakOverlay?.destroy();
    this.daybreakOverlay = new DaybreakOverlay(this, this.metrics, this.layout.fieldArea, daybreak).setDepth(
      SCREEN_DEPTH.daybreak,
    );
  }

  /**
   * フィールドエリアだけを作り直す。移動で現在地が変わると、レーンの中身だけでなく現在地カードも
   * 背景の絵も総取り替えになるので、差し替え（showView）では追いつかない。
   *
   * 他のエリアは現在地に依らないため触らない（時計とステータスの反映はshowInformationが行う）。
   */
  private rebuildFieldArea(): void {
    this.cardTable.destroyLooseCards();
    this.fieldPanel.destroy();
    for (const lane of [this.fixtureLane, this.itemLane, this.handLane]) lane.destroy();
    this.buildFieldArea(this.layout);
    // レーンはカードを作らない（CardTable参照）。作り直した並びへ札を出し直す。
    this.showView();
  }

  /**
   * 設置物レーンだけを、今映している場所のものへ作り直す（ScreenLayout.md 7.1.1節）。
   *
   * **他の2レーンは作り直さない。** 映す先を切り替えても現在地から見える範囲は変わらないので、
   * アイテムと手持ちに出ている札はそのまま同じ実体が残る（CardLane.reconcile）——3レーンとも
   * 建て直すと、変わっていない札まで一度消えて出直すことになる。
   */
  private rebuildFixtureLane(): void {
    this.fixtureLane.destroy();
    this.fixtureLane = this.buildFixtureLane(this.layout);
    this.showHaze();
    this.setDragLanes();
    // レーンはカードを作らない（CardTable参照）。作り直した並びへ札を出し直す。
    this.showView();
  }

  /** ドラッグの対象になるレーン。設置物レーンも含める——持ち出せはしないが、同じレーンの中でなら並び替えられるため。 */
  private setDragLanes(): void {
    this.drag.setLanes(this.draggableLanes);
  }

  /**
   * カードに、隣の場所への操作（端を押しての移動と、掴んでのドラッグ）を付ける。
   *
   * 移せないカードにもドラッグは付ける。他のカードへ重ねるcombinationのドラッグ元にはなれるため。
   *
   * カードを押すと、そのオブジェクトの子ウィンドウが開く。コンテナのカードだけは中身の子ウィンドウを
   * 直接開く（中身を見る・出し入れするのがそのカードの主な用途のため）。端の操作エリアは中央より
   * 手前に居るので、端を押しての移動とは競合しない（Card参照）。
   */
  private laneCardsWithEdgeActions(
    cards: readonly (ObjectCardStack | undefined)[],
  ): readonly (CardContent | undefined)[] {
    return cards.map((card) => {
      if (card === undefined) return undefined;

      return {
        ...card,
        draggable: true,
        onTap: this.whileIdle(() => this.openObjectWindow(card)),
        edges: this.cardEdges(card),
        // 経過を見せている間は行動の途中の値。状態バーは減った分の帯を縮めずに溜める（statusContentと同じ）。
        midAction: this.midAction,
      };
    });
  }

  /**
   * レーンの全面に敷く絵（用意されていなければundefinedで、レーンは単色になる）。
   * どのスロットにどの絵を敷くかは画面側では決めず、絵のファイル名が名乗る（backgroundArt参照）。
   */
  private laneArt(place: CardPlace): string | undefined {
    const background = this.view.slotViewOf(place).background;
    return background === undefined ? undefined : laneBackgroundTexture(background);
  }

  /**
   * その場所を映すレーンに並べる枠（slotCells）。絞り込みが札を隠しているレーンには、隠れている
   * 枚数の印が付く（hiddenCountCells）——**どこに絞り込みが効くかを知っているのはShownCards**なので、
   * 絞り込みの効かない場所（手持ち・子ウィンドウ）では隠れている枚数が0になり、印も付かない。
   */
  private cellsAt(place: CardPlace): readonly LaneCell[] {
    const stacks = this.shown.stacksAt(place);
    const slot = this.view.slotViewOf(place);
    const cells = slotCells(
      slot,
      stacks,
      this.laneCardsWithEdgeActions(stacks),
      this.materialCycle,
      (objectGlobalId) => this.view.cardOfType(objectGlobalId),
    );
    return hiddenCountCells(cells, this.shown.hiddenAt(place));
  }

  /**
   * そのカードが出す端の操作。**そこへ移せるカードだけが矢印を出す**ので、置ける設置物（設置もできる
   * かご）を足せば、画面を直さずに設置物レーンとアイテムレーンの間を行き来できるようになる。
   */
  private cardEdges(card: ObjectCardStack): readonly CardEdgeAction[] {
    const edges: CardEdgeAction[] = [];
    for (const direction of EDGE_DIRECTIONS) {
      const move = this.shown.edgeMoveAction(card, direction);
      if (move !== undefined) {
        const label = this.locale.uiText('log_card_edge_tapped', {
          name: card.name,
          place: this.placeText(card.place),
          direction,
        });
        edges.push({ direction, onTap: () => this.applyToWorld(label, move) });
      }
    }
    return edges;
  }

  /**
   * ピン留めした場所の札が出す端の操作——**上で1段外側の場所へ、下で内側へ**（ScreenLayout.md
   * 7.1.1節）。外側の場所を持たない土地に居る間はどちらも出ないので、陸では札の見え方が変わらない。
   */
  private locationEdges(): readonly CardEdgeAction[] {
    const edges: CardEdgeAction[] = [];
    const depth = this.shownDepth;
    if (depth + 1 < this.view.nestedLocations.length)
      edges.push({ direction: 'up', onTap: () => this.showLocationAt(depth + 1) });
    if (depth > 0) edges.push({ direction: 'down', onTap: () => this.showLocationAt(depth - 1) });
    return edges;
  }

  /**
   * 設置物レーンが映す場所を切り替える。**変わるのはそのレーンだけ**——現在地から見える範囲は
   * 切り替えても変わらないので、他のレーンに出ている札も開いている子ウィンドウもそのまま残る
   * （rebuildFixtureLane）。**ワールドは何も変わらない**ので、時間は経たない。
   *
   * 端の操作は押し続けている間くり返し届く（Card.addEdge）ので、**既に映している段なら何もしない**
   * ——同じ場所のまま設置物レーンを作り直し続けることになる。
   */
  private showLocationAt(depth: number): void {
    if (this.busy || depth === this.shownDepth) return;

    this.shownLocationDepth = depth;
    noteOperation(this.locale.uiText('log_fixtures_switched', { name: this.shownLocation.window.card.name }));
    this.rebuildFixtureLane();
  }

  /**
   * ドロップを、レーンを場所（CardSpot）に直した形へ（判断はShownCardsが行う）。どちらかの
   * レーンがワールドの場所を映していなければ、落とし先の決まらない操作なのでundefined。
   */
  private dropOf(drop: CardDrop): ShownDrop | undefined {
    const from = this.spotOf(drop.from);
    const to = this.spotOf(drop.to);
    if (from === undefined || to === undefined) return undefined;

    return { from, fromIndex: drop.fromIndex, to, target: drop.target, count: drop.count };
  }

  /**
   * そのドロップで何が起きるか（何も起きないならundefined）。何が起きるかの判断はShownCards、
   * ここは吹き出しの文字列に直すだけ。ただ位置を変えるだけの移動には説明が要らないので中身は空。
   */
  private describeDrop(drop: CardDrop): CardDropInfo | undefined {
    const dropped = this.dropOf(drop);
    const told = dropped === undefined ? undefined : this.shown.dropEffect(dropped);
    if (dropped === undefined || told === undefined) return undefined;

    const maxCount = this.shown.multiDropLimit(dropped);
    if (told.name === undefined) return { maxCount, enabled: told.enabled };
    return {
      maxCount,
      enabled: told.enabled,
      tooltip: interactionTooltip({ label: told.name, ...told }),
    };
  }

  /** そのレーンに出ている束（ShownCards）。掴める札もタップできる札も、この並びの中にしかない。 */
  private stacksOf(lane: CardLane): readonly (ObjectCardStack | undefined)[] {
    const spot = this.spotOf(lane);
    return spot === undefined ? [] : this.shown.stacksAt(spot);
  }

  /** レーンが映している場所（ワールドの場所を映さない枠ならundefined）。 */
  private spotOf(lane: CardLane): CardSpot | undefined {
    return this.shownLanes.find((shown) => shown.lane === lane)?.spot;
  }

  /**
   * 今カードが並んでいるレーンと、それが映しているもの。**レーンと場所の対を書くのはここだけ**
   * ——別々に書くと、レーンがどこを映しているかの答えが場所ごとに食い違う。
   *
   * ポートレイトも枠1つのレーンで、子ウィンドウを開いている間は**借りた札の枠も中身の並びも同じ
   * 差し替えに乗る**——手持ちとの間でカードが行き来するため、外していると出ていったカードが現れない。
   */
  private get shownLanes(): readonly ShownLane[] {
    const fixtures = this.placeOfScreen('fixtures');
    const items = this.placeOfScreen('items');
    const hand = this.placeOfScreen('hand');
    const lanes: ShownLane[] = [
      { lane: this.fixtureLane, spot: fixtures, cells: () => this.cellsAt(fixtures) },
      { lane: this.itemLane, spot: items, cells: () => this.cellsAt(items) },
      { lane: this.handLane, spot: hand, cells: () => this.cellsAt(hand) },
      { lane: this.portraitLane, spot: undefined, cells: () => this.portraitCells() },
    ];

    const window = this.childWindow;
    const card = window?.laneOf('card');
    const borrowed = this.shown.windowCard;
    if (card !== undefined && borrowed !== undefined) {
      lanes.push({ lane: card, spot: 'windowCard', cells: () => [{ card: borrowedFace(borrowed) }] });
    }
    const content = window?.laneOf('content');
    const place = this.childWindowPlace;
    if (content !== undefined && place !== undefined) {
      lanes.push({ lane: content, spot: place, cells: () => this.cellsAt(place) });
    }
    // 発見物のレーン。借りている札はここに並び、返すと元の場所のレーンへ戻る（Windows.md 5.1節）。
    const found = window?.laneOf('found');
    if (found !== undefined) {
      lanes.push({ lane: found, spot: undefined, cells: () => foundCells(this.shown.found) });
    }
    return lanes;
  }

  /** 今画面に出ているレーン。札を探すため（rectOfInstance）のもので、並びは引き直さない。 */
  private get openLanes(): readonly CardLane[] {
    return this.shownLanes.map(({ lane }) => lane);
  }

  /**
   * 今ドラッグの相手にできるレーンを、**画面で手前に重なっているものから**。
   *
   * 子ウィンドウは設置物とアイテムのレーンを覆っているので、開いている間その2つは外す。残すと
   * ドロップ先の判定（重なりを見ず「最初に当たったレーン」、CardDragController.dropCandidateAt）で
   * 覆われている側が先に当たり、ウィンドウの中のカードへ落とせないうえ、隠れているはずの枠に
   * 「ここへ落とせる」という印が出る。手持ちはウィンドウの外なので残る（slotWindowArea）。
   *
   * openLanes自体は並べ替えられない——差し替えの中身と位置で対応付けている（showView）。
   *
   * **ポートレイトは落とし先にしない。** キャラクタ自身の札はワールドの場所を映す枠ではないので、
   * そこへ落としても行き先が決まらない。
   */
  private get draggableLanes(): readonly CardLane[] {
    const field = [this.fixtureLane, this.itemLane, this.handLane];
    if (this.childWindow === undefined) return field;

    // 借りた札の枠も落とし先に含める。石を打ち割るには、手持ちからウィンドウの中の石へ重ねられる
    // 必要がある（借りた1枚はもうレーンには居ない、Windows.md 1.1節）。
    return [this.childWindow.laneOf('card'), this.childWindow.laneOf('content'), this.handLane].filter(
      (lane): lane is CardLane => lane !== undefined,
    );
  }

  /**
   * 起きた変化を、カードの動きの文脈へ直す（MotionContext）。**呼ぶのはレーンを差し替える前**
   * ——出どころの札は差し替えで消えることも動くこともあるが、その時点の画面にはまだ居る。
   */
  private motionOf(changes: readonly WorldChange[]): MotionContext {
    return {
      origins: this.originRectsOf(changes),
      vanished: vanishedInstances(changes),
      born: bornInstances(changes),
    };
  }

  /**
   * 起きた変化を、新しく現れるインスタンスごとの出発点へ直す（MotionContext.origins）。
   *
   * 壊された物や使い切った道具の枠も引ける（motionOfの呼ぶ時点による）。
   */
  private originRectsOf(changes: readonly WorldChange[]): ReadonlyMap<number, Rect> {
    const rects = new Map<number, Rect>();
    for (const [id, originId] of originInstanceByInstance(changes)) {
      const rect = this.rectOfInstance(originId);
      if (rect !== undefined) rects.set(id, rect);
    }
    return rects;
  }

  /**
   * そのインスタンスを今映しているカードの枠。どのレーンにも出ていなければundefined。
   *
   * 設置物レーンが映している場所だけはレーンに並ぶカードを持たない（ピン留めの枠）ので、そこで
   * 答える。**映しているのは現在地とは限らない**（外側の段を映していればそちら、shownLocation）。
   * 探索で見つかった物がその場所から飛んでくるのも、子ウィンドウへ札が移るのもこの1行による。
   */
  private rectOfInstance(instanceId: number): Rect | undefined {
    for (const lane of this.openLanes) {
      const shown = lane.placements.find(({ card }) => card.identity.includes(instanceId));
      if (shown !== undefined) return shown.rect;
    }

    return this.shownLocation.window.card.identity?.includes(instanceId) === true
      ? this.fixtureLane.pinnedRect
      : undefined;
  }

  /**
   * その物の姿が今出ている札の枠。**自分の札を持たない物は、それを抱えている親の札が代表している**
   * ——見えないスロットの中身には札が無いので、外側へ順に見る。
   */
  private rectOfNearestShownOwner(chain: readonly WorldObject[]): Rect | undefined {
    for (const object of chain) {
      const rect = this.rectOfInstance(object.instanceId);
      if (rect !== undefined) return rect;
    }
    return undefined;
  }

  /**
   * ドロップで手から放したもの（releasedBy）は手を離した場所に居るので、そこから動き出す。
   *
   * combinationの成果物がどこから出るかは渡さない。効果を宣言している側の札（重ねた相手か、
   * 逆向きに成立したなら掴んだ札）を、世界の変化が出どころとして答える（originRectsOf）。
   */
  private applyDrop(drop: CardDrop, releasedRect: Rect): void {
    const dropped = this.dropOf(drop);
    const action = dropped === undefined ? undefined : this.shown.dropEffect(dropped)?.execute;
    this.applyToWorld(this.dropLabel(drop), action, this.releasedBy(drop, releasedRect));
  }

  /** そのドロップを、再現手順として読める言葉にする（errorReport参照）。 */
  private dropLabel(drop: CardDrop): string {
    const name = this.stacksOf(drop.from)[drop.fromIndex]?.name ?? '?';
    const count = drop.count > 1 ? ` ×${drop.count}` : '';
    const dragged = `${name}${count}`;
    const dropped = this.dropOf(drop);
    const to = dropped === undefined || dropped.to === 'windowCard' ? '?' : this.placeText(dropped.to);
    if (drop.target.kind !== 'combine') return this.locale.uiText('log_card_dropped', { dragged, to });

    const onto = this.stacksOf(drop.to)[drop.target.index]?.name ?? '?';
    const combination = dropped === undefined ? undefined : this.shown.dropCombination(dropped);
    return combination !== undefined
      ? this.locale.uiText('log_card_combined', { dragged: name, onto, combination: combination.name })
      : this.locale.uiText('log_card_put_in', { dragged, onto });
  }

  /**
   * そのドロップで手から放したもの（MotionContext.released）。どの個体が動くのかはビューが答える
   * （movedIds）。重ねて実行するcombinationに加わるのは掴んでいた1つだけで、それは束の代表とは
   * 限らない（CardCombination.held参照）。
   */
  private releasedBy(drop: CardDrop, rect: Rect): MotionContext['released'] {
    const dropped = this.dropOf(drop);
    const moved = dropped === undefined ? undefined : this.shown.releasedBy(dropped);
    return moved === undefined ? undefined : { grabbed: moved.grabbed, followers: moved.followers, rect };
  }

  /**
   * 日時とポートレイトを押すと開く、キャラクタ自身の子ウィンドウ（Windows.md 4節）。休息のアクション
   * （Characters.md 休息節）が並ぶ。**カードのウィンドウと同じ経路**——映しているのは自分の札で、
   * ボタンはそのオブジェクトが宣言しているアクションそのもの。
   *
   * **装備・怪我のボタンから開くときはopensPlaceを渡す。渡すのは最初に開くタブがどれかだけ**で
   * （記憶より優先する、Windows.md 1.2節）、窓の中身はどの入口から来ても同じ。
   */
  private openCharacterWindow(opensPlace?: CardPlace): void {
    const origins = this.closeChildWindowReturningOrigins();
    this.openChildWindow(this.view.characterWindow, origins, {
      opensPlace,
      properties: this.status.tabs(),
    });
  }

  /**
   * ポートレイトのレーンの枠。押すとキャラクタ自身の子ウィンドウが開く（ScreenLayout.md 4.1節）。
   * キャラクタ自身の札も他の札と同じで、子ウィンドウへ出ている間はここに印だけが残る。
   */
  private portraitCells(): readonly LaneCell[] {
    const portrait = { ...this.view.characterCard, onTap: this.whileIdle(() => this.openCharacterWindow()) };
    return [{ card: this.shown.shownCard(portrait) }];
  }

  /**
   * カードを押すと開く子ウィンドウ。そのカードで実行できるアクション（ActionSystem.md 1節）を
   * ボタンとして並べ、中身のスロットを持つカード（コンテナ・怪我）ならその並びも一緒に出す。
   *
   * **ボタンでは閉じない。閉じるのは映しているものが世界から消えたとき**（refreshChildWindowReturningOrigins）。
   * 押した後に何が起きたかは、開いたままのウィンドウがそのまま見せる。
   *
   * アクションで生まれたものは、このカードを出どころとして飛ぶ（ヤシの木から採った実は木から手元へ）。
   * それを決めるのはこのウィンドウではなく世界の変化——アクションを宣言しているのがこのカードの
   * オブジェクトだから、主体としてそれが付く（originRectsOf）。
   */
  private openObjectWindow(card: ObjectCardStack, from?: Rect, opensFirstSlot = false): void {
    // 前のウィンドウが映していた札を先に手放してから借りる（同じ1枚が2箇所に出ないため）。
    const origins = new Map(this.closeChildWindowReturningOrigins());
    const borrowed = this.shown.firstOf(card);
    // レシピ一覧から作り始めたときだけ、出どころが世界ではなく画面の事実（閉じた一覧の中で選んだ札の
    // 位置）なので呼び出し側が渡す。並びに出ている札は、差し替えがその枠から飛ばす。
    if (from !== undefined) for (const id of borrowed.identity ?? []) origins.set(id, from);
    this.openChildWindow(this.view.windowOf(borrowed.objects[0]), origins, {
      stack: borrowed,
      opensPlace: opensFirstSlot ? borrowed.visibleSlots[0] : undefined,
    });
  }

  /**
   * タグの要求の空き枠に出す型を1つ進める（1秒ごと）。**出す型が1つしかないなら引き直さない**
   * ——見た目が変わらない差し替えを毎秒走らせる理由が無い。
   */
  private advanceMaterialCycle(): void {
    if (this.busy) return;
    const place = this.childWindowPlace;
    const materials = place === undefined ? undefined : this.view.slotViewOf(place).materials;
    if (materials?.some((material) => material.objectGlobalIds.length >= 2) !== true) return;

    this.materialCycle += 1;
    this.showView();
  }

  /**
   * アクションを子ウィンドウのボタンの形へ直す。ownerは、エラー報告に残す「誰のアクションか」
   * （errorReport参照）。カードのものもキャラクタ自身のものも同じ経路を通る。
   */
  private actionButtons(actions: readonly CardAction[], owner: string): ObjectWindowAction[] {
    return actions.map((action) => ({
      label: action.name,
      description: action.description,
      minutes: action.minutes,
      enabled: action.enabled,
      reason: action.reason,
      // **探索だけは画面が実行を引き受ける。** 見つかったものを現在地の札から発見物の枠へ運び、
      // その面へ移るところまでが1つの操作なので（Windows.md 5節）、世界を変えるだけでは終わらない。
      onTap:
        action.key === EXPLORE_ACTION
          ? () => this.explore()
          : () => {
              this.applyToWorld(
                this.locale.uiText('log_action', { name: action.name, owner }),
                action.execute,
              );
            },
    }));
  }

  /**
   * 子ウィンドウを開く。同時に開けるのは1つだけなので、**開いているものはcloseChildWindowReturningOriginsで先に
   * 片付けてから呼ぶ**——借りる札を決めるのは呼び出し側なので、前の札を手放す順もそちらが持つ
   * （手放す前に借りると、同じ1枚が2箇所に出る）。originsはそこで受け取った出どころ。
   *
   * 映すオブジェクトのカードを出すウィンドウでは、**その札は元の枠からここへ移る**
   * （Windows.md 1.1節）。運びは並びの差し替えがそのまま見せる。
   */
  private openChildWindow(
    window: ObjectWindowView,
    origins: ReadonlyMap<number, Rect>,
    opened?: {
      readonly stack?: ObjectCardStack;
      readonly opensPlace?: CardPlace;
      /**
       * プロパティのタブに出すカテゴリ。**画面が覚えている固定表示の印を重ねたい対象だけ**が渡す
       * （キャラクタ、ShownStatuses）。渡さなければワールドから引いたものをそのまま出す。
       */
      readonly properties?: readonly PropertyTab[];
    },
  ): void {
    noteOperation(this.locale.uiText('log_child_window_opened', { name: window.card.name }));
    // タブに並べるスロット。可視のスロット（visible_slots、7.11節）を宣言順に並べる。
    this.childWindowTabs = window.slots.map((slot) => ({
      key: this.view.slotViewOf(slot).key,
      place: slot,
    }));
    // 型ごとの記憶の鍵。束が無いウィンドウ（装備・怪我）は覚えない——映しているのは場所であって、
    // 「この型を次に開いたときどうするか」の話にならない。
    this.childWindowDef = opened?.stack?.objects[0]?.def.name;

    this.childWindow = new ObjectWindow(this, this.metrics, {
      object: { card: window.card, description: window.description },
      properties: opened?.properties ?? window.properties,
      exploration: window.exploration,
      slots: this.childWindowTabs.map((tab) => {
        const slot = this.view.slotViewOf(tab.place);
        return {
          key: tab.key,
          title: slot.label,
          cells: this.cellsAt(tab.place),
          grows: slot.cells === 'grows',
        };
      }),
      initialTab: this.initialTab(opened?.opensPlace),
      actions: this.actionButtons(window.actions, window.card.name),
      area: this.layout.slotWindowArea,
      onTabChange: (tab) => this.changeWindowTab(tab),
      onClose: () => this.closeChildWindow(),
    });
    // 借りるのはタブによらない。**説明のタブでだけ描かれる**が、借りている間その札は元の枠に
    // 印だけを残す（Windows.md 1.1節）——タブを行き来するたびに札を飛ばさないため。
    this.shown.borrow(window.object, window.card, opened?.stack);
    // 開いたタブはウィンドウが決める（並んでいないタブは説明へ落ちる）。
    this.childWindowPlace = this.placeOfTab(this.childWindow.openedTab);
    this.rememberTab(this.childWindow.openedTab);
    this.setDragLanes();
    // 借りた1枚がウィンドウの枠へ移り、手持ちの端が指す先も変わる（laneCardsWithEdgeActions・neighbourOf参照）。
    this.showView({ origins });
  }

  /**
   * 最初に開きたいタブ。**プログラムの指定 ＞ 型ごとの記憶 ＞ 説明**（Windows.md 1.2節）。
   *
   * 指定するのは、開いた文脈がそのスロットを見に来たと分かっている場合だけ——装備・怪我のボタンと、
   * 作り始めた直後の製作中オブジェクト。それ以外は覚えているものに従う。**覚えているのはスロットの
   * タブとは限らない**（プロパティ・踏査のタブも同じように覚える）ので、並んでいるかどうかの判定は
   * ウィンドウに任せる。
   */
  private initialTab(opensPlace: CardPlace | undefined): string {
    const named = opensPlace === undefined ? undefined : this.view.slotViewOf(opensPlace).key;
    if (named !== undefined) return named;
    const remembered =
      this.childWindowDef === undefined ? undefined : this.settings.openedTab(this.childWindowDef);
    return remembered ?? DESCRIPTION_TAB;
  }

  /** タブの識別子が指す場所（説明のタブではundefined）。 */
  private placeOfTab(tab: string): CardPlace | undefined {
    return this.childWindowTabs.find((candidate) => candidate.key === tab)?.place;
  }

  /**
   * 開いたタブが変わった。**映している場所ごと変わる**ので、落とし先も並びも引き直す
   * （ドラッグの相手になるレーンはタブごとに作り直されている）。
   */
  private changeWindowTab(tab: string): void {
    this.childWindowPlace = this.placeOfTab(tab);
    this.rememberTab(tab);
    this.setDragLanes();
    this.showView();
  }

  private rememberTab(tab: string): void {
    if (this.childWindowDef !== undefined) this.settings.rememberOpenedTab(this.childWindowDef, tab);
  }

  private closeChildWindow(): void {
    this.showView({ origins: this.closeChildWindowReturningOrigins() });
  }

  /**
   * 子ウィンドウを片付け、映していた札を手放す。返すのは**その札の出どころ**（ウィンドウの枠）
   * ——手放した札は次の差し替えから元の枠に並ぶので、そこから飛んで帰る（MotionContext.origins）。
   *
   * 並びの引き直しは呼び出し側——閉じるのは差し替えの途中のこともあるため。
   */
  private closeChildWindowReturningOrigins(): ReadonlyMap<number, Rect> {
    // **枠を測る順は問わない**——閉じるボタンは窓を閉じてから知らせに来るので、ここへ来た時点で
    // 面はもう無く、枠を答えるのは窓のほう（ObjectWindow.cellRect）。
    const window = this.childWindow;

    const returned = this.shown.returnBorrowed();
    const origins = new Map<number, Rect>();
    const cardRect = window?.cellRect('card', 0);
    if (cardRect !== undefined) for (const id of returned.card) origins.set(id, cardRect);
    returned.found.forEach((card, index) => {
      const rect = window?.cellRect('found', index);
      if (rect === undefined) return;
      for (const id of card.identity ?? []) origins.set(id, rect);
    });

    window?.close();
    this.childWindow = undefined;
    this.childWindowPlace = undefined;
    this.childWindowTabs = [];
    this.childWindowDef = undefined;
    this.setDragLanes();

    return origins;
  }

  /**
   * 設置物レーンが映している場所そのものを映す子ウィンドウ（ピン留めの札を押したとき）。
   *
   * **出どころを渡すのはここ。** ピン留めの札はレーンの並びに居ないので、差し替えは「直前に居た枠」
   * として憶えていない（cardMotionPlan.resolve）——渡さないと、札は飛ばずにウィンドウの中に現れる。
   */
  private openLocationWindow(): void {
    const origins = new Map(this.closeChildWindowReturningOrigins());
    for (const id of this.shownLocation.window.card.identity ?? []) {
      const rect = this.rectOfInstance(id);
      if (rect !== undefined) origins.set(id, rect);
    }
    this.openChildWindow(this.shownLocation.window, origins);
  }

  /**
   * 借りている発見物を、それぞれの本来の場所へ帰す（Windows.md 5.1節）。帰り先はレーンの並びが
   * 決めるので、借りるのをやめて差し替えれば、あとは通常の出どころの規則（origins）が飛ばす。
   */
  private returnFound(): void {
    if (this.shown.returnFound().length === 0) return;

    // 出どころの表は要らない。借りるのをやめた札は発見物のレーンから居なくなるので、**差し替えが
    // 「直前に居た枠」として憶えている**（CardTable.placedCards）。
    this.showView();
  }

  /**
   * 設置物レーンが映している場所を1回探索する（外側を映していれば外側が探索の相手になる）。
   *
   * 探索はゲーム内時間を消費するアクションなので、その分だけ実時間をかけて進める。ワールド自体は
   * 先に変えてしまい、時計だけを実時間で動かして、結果（見つかったカード・探索率）は経過し切って
   * から見せる。押した瞬間に発見物の枠が空へ戻り、時間が経ってから埋まる。
   *
   * **前の探索で見つかったものは、始める前に本来の場所へ帰す**（Windows.md 5.1節）。枠から
   * 消えるだけだと、その札が画面のどこにも居ない時間ができてしまう。
   */
  private explore(): void {
    if (this.busy) return;

    this.returnFound();
    const statusesBefore = this.status.all();
    const startedAt = this.gameSession.world.totalMinutes;

    const explored = this.shownLocation;
    this.noteOperationAt(this.locale.uiText('log_explored', { name: explored.window.card.name }));
    // 結果待ちはここから。降ろすのは経過を見せ切った時点（passTime）。
    this.activity = 'exploring';

    const recorded = this.runAndRecord(() => {
      explored.explore();
    });
    // 道が見つかっていたら、経過を見せている間に行き先の絵のロードを始める。
    this.requestLocationArt();
    // 運ぶ順はワールドを変える操作と同じ（afterPlaybackSteps）。探索だけの段はfoundが足す。
    this.passTime(startedAt, this.gameSession.world.totalMinutes, recorded, () => {
      for (const step of afterPlaybackSteps({ moved: false, found: true })) {
        switch (step) {
          case 'refresh':
            this.view = this.viewOfGame();
            break;
          case 'noteChanges':
            this.noteStatusChanges(statusesBefore, startedAt);
            break;
          case 'found':
            this.takeFound(recorded.changesAtEnd);
            break;
          case 'signals':
            this.showSignals(recorded.signalsAtEnd);
            break;
          case 'view':
            this.showView(this.motionOf(recorded.changesAtEnd));
            break;
          case 'transit':
            // 探索では土地を移らないので、afterPlaybackStepsはこの段を返さない。
            break;
        }
      }
    });
  }

  /**
   * 見つかったものを発見物の枠へ引き取り、それを見せる面へ自分から移る（Windows.md 5節）。
   * 探索は必ず1個以上見つかるので、押した結果がどのタブに出るかを覚えていなくてよい。
   */
  private takeFound(changes: readonly WorldChange[]): void {
    this.shown.takeFound(changes);

    const exploration = this.shownLocation.window.exploration;
    if (exploration !== undefined) this.childWindow?.setExploration(exploration);
    this.childWindow?.openTab(EXPLORATION_TAB);
  }

  /** 設置物レーンとアイテムレーンに出ているカード。空き枠は除く。 */
  private get locationCards(): readonly ObjectCardStack[] {
    return [
      ...this.view.cardsIn(this.placeOfScreen('fixtures')),
      ...this.view.cardsIn(this.placeOfScreen('items')),
    ].filter((card): card is ObjectCardStack => card !== undefined);
  }

  /** ワールドを変える操作を実行し、経過の控えを取る（runAndRecordChange）。実時間での再生はpassTime。 */
  private runAndRecord(change: () => void): Recording {
    return runAndRecordChange(
      this.gameSession,
      this.codex,
      this.locale,
      this.childWindowPlace,
      change,
      this.handLaneCells(),
    );
  }

  /**
   * 今のワールドから表示内容を作る（fromGameSession）。**枠数を添えるのはここだけ**——手持ちの
   * 前詰めは画面の都合による場当たりの割り切りで（ScreenLayout.md 7.3節）、そこに要る「レーンに
   * 一度に見えている枠の数」は画面の側にしか無い。
   */
  private viewOfGame(): PlayScreenView {
    return fromGameSession(this.gameSession, this.codex, this.locale, this.handLaneCells());
  }

  /**
   * ハンドレーンに一度に見えている枠の数。**手持ちの前詰めにしか使わない**（viewOfGame）。
   *
   * `this.metrics`はbuildの中でしか今の画面を指さない（ResponsiveScene）が、写し取りはinitでも
   * 起きるので、ここだけは画面寸法から測り直す。
   */
  private handLaneCells(): number {
    return new PlayScreenLayout(new ScreenMetrics(this.scale.width, this.scale.height)).laneCells;
  }

  /**
   * fromMinutesからtoMinutesまで、ゲーム内時間の経過を実時間（realMsFor）で時計とドーナツグラフへ
   * 映し、経過し切ったらonElapsedを呼ぶ。
   *
   * **何をどの順で運ぶかはplaybackStepsが決める**（死んだら止める・粒は待たずに散らす・周回の終わりは
   * 見せ終わってから）。ここが持つのは、その1つずつをどう見せるかだけ。
   *
   * **見せ終わった時点で演出中を降ろすのはここだけ**（activity）。何を見せている最中かは始めた側が
   * 既に立てているので（探索）、立っていなければ経過そのものとして立てる。
   */
  private passTime(
    fromMinutes: number,
    toMinutes: number,
    recording: Recording,
    onElapsed: () => void,
  ): void {
    const playback = new ElapsePlayback(
      fromMinutes,
      toMinutes,
      this.gameSession.world.rawMinutesPerTick,
      recording.ticks,
    );
    const steps = playbackSteps({
      ending: this.gameSession.player.ending.kind,
      minutes: playback.totalMinutes,
    });

    // 再生だけ実時間がかかるので、続きは見せ切ってから運ぶ。
    const runFrom = (from: number): void => {
      for (let index = from; index < steps.length; index++) {
        switch (steps[index]) {
          case 'death':
            this.showDeath();
            return;
          case 'gains':
            this.showGains(
              recording.gains,
              playback.totalMinutes > 0 ? realMsFor(playback.totalMinutes) : INSTANT_GAIN_SPREAD_MS,
            );
            break;
          case 'replay':
            this.replayElapse(playback, () => runFrom(index + 1));
            return;
          case 'elapsed':
            this.activity = 'idle';
            onElapsed();
            break;
          case 'escape':
            this.showEscape();
            break;
        }
      }
    };
    runFrom(0);
  }

  /**
   * 控えを実時間で再生し、見せ切ったらonDoneを呼ぶ。
   *
   * 時計もドーナツグラフも控えもtick境界で刻む（ElapsePlayback）。**どれも同じ目盛りから導く**ので、
   * 塗りが目盛りへ届いた瞬間が、時計の飛ぶ瞬間であり、その控えを見せる瞬間になる。
   */
  private replayElapse(playback: ElapsePlayback, onDone: () => void): void {
    if (this.activity === 'idle') this.activity = 'elapsing';

    const ring = new ProgressRing(
      this,
      this.metrics,
      this.layout.fieldArea.x + this.layout.fieldArea.width / 2,
      this.layout.fieldArea.y + this.layout.fieldArea.height / 2,
    ).setDepth(SCREEN_DEPTH.ring);

    const clock = { elapsed: 0 };
    const show = (frame: ElapseFrame): void => {
      this.showClock(frame.clockMinutes);
      ring.setRatio(frame.ratio, frame.elapsedMinutes);
      for (const recorded of frame.due) this.showRecorded(recorded);
    };

    this.tweens.add({
      targets: clock,
      elapsed: playback.totalMinutes,
      duration: realMsFor(playback.totalMinutes),
      ease: 'Linear',
      onUpdate: () => show(playback.frameAt(clock.elapsed)),
      onComplete: () => {
        // 実時間の刻みが最後の目盛りちょうどに来るとは限らないので、締めで取りこぼしを拾う。
        for (const recorded of playback.takeRemaining()) this.showRecorded(recorded);
        ring.destroy();
        onDone();
      },
    });
  }

  /**
   * 操作そのものが増やしたキャラクタの値を、粒にして飛ばす（CardInteraction.md 10節）。
   * 発生源はその操作を宣言していた札（InteractionGains.sourceAndAncestors）で、行き先はポートレイト。
   *
   * 絵を持たないプロパティと、rangeを持たず割合を言えないプロパティは出さない——飛ばす絵が無く、
   * 「満タンのどれだけか」も数えられないため。
   */
  private showGains(gains: readonly InteractionGains[], spreadMs: number): void {
    const portrait = this.portraitRect;
    if (portrait === undefined) return;

    const character = this.gameSession.player.instance;
    const texts = this.locale.object(character.def.name);
    for (const { sourceAndAncestors, gains: gained } of gains) {
      const from = this.rectOfNearestShownOwner(sourceAndAncestors);
      if (from === undefined) continue;

      for (const gain of gained) {
        if (gain.object.instanceId !== character.instanceId) continue;

        const icon = texts.prop(gain.property.name).icon;
        const range = gain.property.range;
        if (icon === undefined || range === undefined || range.max <= range.min) continue;

        emitGainParticles(this, this.metrics, {
          icon,
          count: Math.ceil(PARTICLES_PER_FULL * Math.sqrt(gain.amount / (range.max - range.min))),
          from,
          to: portrait,
          spreadMs,
        });
      }
    }
  }

  /**
   * 控えておいた時点の表示内容へ切り替える。差し替えの動き（出現・破棄）は普段と同じ経路で出るので、
   * 経過中に壊れた道具はその瞬間に消える。
   *
   * 掴んで離したカードの出どころ（MotionContext.released）は渡さない。それは経過し切ったときに
   * 見せる動きで（道具は使い終わってから手元へ戻る、CardInteraction.md 6節）、途中で消費してはならない。
   *
   * そのtickで生まれた物は、控えと一緒に運んできた出入りが出どころを答える（RecordedView.changes）。
   */
  private showRecorded(recorded: RecordedView): void {
    const context = this.motionOf(recorded.changes);
    this.view = recorded.view;
    this.status.setChanges(recorded.statusChanges);
    this.showSignals(recorded.signals);
    this.showView(context);
  }

  /**
   * 告げられた出来事を、それが起きたオブジェクトの札の上に文字として浮かべる（CardView.md 14節）。
   *
   * **並びを差し替える前に呼ぶ。** 出どころの矩形（originRectsOf）と同じで、その出来事が起きたのは
   * 今出ている並びの上——効果がその物を消していれば、差し替えた後の画面にその札はもう無い。
   *
   * 画面に出ていないもの（閉じた入れ物の中・別の土地）に起きた出来事は出さない。指すべき札が無く、
   * 宙に文字だけが浮くことになるため。
   */
  private showSignals(signals: readonly WorldSignal[]): void {
    for (const signal of signals) {
      const rect = this.rectOfInstance(signal.object.instanceId);
      if (rect === undefined) continue;
      floatSignalLabel(this, this.metrics, this.locale.signal(signal.name), rect).setDepth(
        SCREEN_DEPTH.signal,
      );
    }
  }

  /** 経過分を日数・時刻へ直して時計に出す。画面を作り直した直後はまだ時計が無いことがある。 */
  private showClock(totalMinutes: number): void {
    if (!isAlive(this.situationPanel)) return;

    const { days, hour, minute } = clockParts(totalMinutes);
    this.situationPanel.setTime(days, hour, minute);
  }

  /**
   * 起きた操作を、そのときのワールド時刻を添えて控える（errorReport参照）。**添え方はここだけが
   * 決める**——操作ごとに書式を持つと、同じ「何をしたか＋いつか」の組み立てが対応表に並ぶ。
   */
  private noteOperationAt(label: string): void {
    noteOperation(this.locale.uiText('log_at_clock', { label, clock: this.clockText() }));
  }

  /** 今のワールド時刻（エラー報告と操作の記録に添える）。 */
  private clockText(): string {
    const { days, hour, minute } = clockParts(this.gameSession.world.totalMinutes);
    return this.locale.uiText('state_clock', {
      days: String(days),
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    });
  }

  /**
   * ワールドを変える操作を実行し、その結果を画面へ反映する。**実行するかどうかもここが決める**
   * ——changeがundefined（何も起きない落とし方）でも、演出中でも、決めた側として後始末まで行う。
   *
   * releasedは、その操作で手から放したもの（MotionContext.released）。**画面の事実だけを受け取る**
   * ——新しく現れるカードがどこから飛んでくるかは、この中で起きた世界の変化が答える（originRectsOf）。
   *
   * その操作がゲーム内時間を消費した場合（durationを持つcombination等）は、探索と同じく経過分だけ
   * 実時間をかけてから結果を見せる。時間を消費しない操作は待たずにそのまま反映される（passTime参照）。
   *
   * 移動を伴う操作かどうかはワールドを変えた時点で分かる（画面へ反映するのはその後なので、経過前の
   * 状態が出たまま）。そのため、場面転換の暗転を時間経過と並行して進められる（transit参照）。
   *
   * labelは、エラー報告に残す「何をしたか」（errorReport参照）。ワールドを変える操作はすべてここを
   * 通るので、再現手順として読める言葉を渡す。
   */
  private applyToWorld(
    label: string,
    change: (() => void) | undefined,
    released?: MotionContext['released'],
  ): void {
    // 実行しないと決めるのはここ——何も起きない操作（changeが無い）と、演出中（acceptsOperation）。
    // **決めた側が後始末もする**ので、落とした札が離した場所に残っていれば飛ばさず元の枠へ返す。
    if (change === undefined || this.busy) {
      this.cardTable.settleFreed();
      return;
    }

    this.noteOperationAt(label);

    // 掴んで離したカードは、経過し切るまで離した場所に置いたままにする（使っている道具はそこに在る）。
    if (released !== undefined) this.cardTable.confirmHeldIds(released);

    const startedAt = this.gameSession.world.totalMinutes;
    const locationBefore = this.gameSession.player.location?.instance;
    const statusesBefore = this.status.all();
    const recorded = this.runAndRecord(change);

    const moved = this.gameSession.player.location?.instance !== locationBefore;
    // 移動先・見つかった道の行き先の絵のロードを、経過を見せている間（暗転中）に始める。
    this.requestLocationArt();
    const elapsedMs = realMsFor(this.gameSession.world.totalMinutes - startedAt);
    const curtain = moved ? new Curtain(this, this.layout.fieldArea) : undefined;
    // 作り直すのは経過し切ってからなので、暗転はそれまでに終わっていなければならない。
    curtain?.darken(Math.min(DARKEN_MS, elapsedMs));

    // 何をどの順で運ぶかはafterPlaybackStepsが決める。ここが持つのは、その1つずつをどう見せるかだけ。
    this.passTime(startedAt, this.gameSession.world.totalMinutes, recorded, () => {
      for (const step of afterPlaybackSteps({ moved })) {
        switch (step) {
          case 'refresh':
            this.view = this.viewOfGame();
            break;
          case 'noteChanges':
            this.noteStatusChanges(statusesBefore, startedAt);
            break;
          case 'transit':
            // movedのときだけ張った幕（afterPlaybackStepsがtransitを返すのも同じとき）。
            if (curtain !== undefined) this.transit(curtain);
            break;
          case 'signals':
            this.showSignals(recorded.signalsAtEnd);
            break;
          case 'view':
            this.showView({ ...this.motionOf(recorded.changesAtEnd), released });
            break;
        }
      }
    });
  }

  /**
   * 暗くなり切ったフィールドエリアを移動先のものへ作り直し、明転する。
   *
   * 明転し切るまでは演出中のままにして、ワールドを変える操作を止める（busy）。作り直した並びが
   * まだ見えていないため、そこへの操作を受け付けると見えているものと食い違う。
   *
   * **移った先には無いものを手放すのはここではない。** 開いていた子ウィンドウは、映しているものが
   * 見えなくなった時点で自分から畳まれる（refreshChildWindowReturningOrigins）。ここで手放すのは、
   * どの枠にも帰り先を持たない発見物だけ。
   */
  private transit(curtain: Curtain): void {
    this.activity = 'transiting';
    this.shown.returnFound();
    // 移動先の絵がまだ届いていなければ、暗転のまま揃うのを待つ。普段は道の発見時に始めたロード
    // （requestLocationArt）が済んでいて、待ちは出ない。
    this.revealWhenLocationArtLoaded(curtain);
  }

  /**
   * 現在地の絵が揃った時点でフィールドエリアを作り直し、明転する。既に揃っていれば同期に進み、
   * 待ちの無い場面転換と同じ流れになる。待っている間に画面が作り直されたら（リサイズ）、幕ごと
   * 捨てられているのでこの待ちも捨てる——作り直し側が改めて幕を張る（coverUntilLocationArtLoaded）。
   */
  private revealWhenLocationArtLoaded(curtain: Curtain): void {
    this.artWaitGeneration += 1;
    const wait = this.artWaitGeneration;
    const reveal = (): void => {
      if (wait !== this.artWaitGeneration) return;
      this.rebuildFieldArea();
      this.showSky();
      this.haze.setHaze(heatHazeFor(this.view.ambientTemperature));
      this.showInformation();
      curtain.brighten(BRIGHTEN_MS, () => {
        this.activity = 'idle';
      });
    };

    this.artLoader.onceLoaded(this.currentLandArtKey, reveal);
  }

  /**
   * 今の土地の識別子。**絵の遅延ロードの単位**（artFiles参照）で、土地カードの絵とレーンの地が
   * この1つの名前で束ねられている。
   *
   * **札の絵とは別物。** 札が映す絵は段で差し替わりうる（`art_by_stage`）が、読む単位は土地そのもの
   * ——札の絵の名前で待つと、段の絵しか見ずにレーンの地を待ち損ねる。
   */
  private get currentLandArtKey(): string {
    return (this.gameSession.player.location ?? this.gameSession.startLocation).instance.def.name;
  }

  /**
   * 現在地の絵が届いているか。絵が1枚も無い土地（最小のCodex）では、待つものが無いので即座に真。
   *
   * **待っているのはレーンの地。** 札の絵は届いた時点で貼り替わる（Card）が、レーンの地は組み立て時に
   * しか差し込めない。同じ単位で一度に届くので、札の絵と別々には待たない。
   */
  private get locationArtLoaded(): boolean {
    return this.artLoader.loaded(this.currentLandArtKey);
  }

  /**
   * 今のthis.viewを画面へ反映する。カードは作り直さずに差し替え、動いた分をアニメーションで
   * 見せる（CardTable）。
   */
  private showView(context: MotionContext = {}): void {
    // 映していたものが世界から消えていれば、ここで子ウィンドウが閉じる。借りていた札の出どころを
    // 受け取り、この差し替えでウィンドウの枠から帰らせる。
    const origins = withOrigins(context.origins, this.refreshChildWindowReturningOrigins());

    const views = this.shownLanes.map(({ lane, cells }) => ({ lane, cells: cells() }));
    this.cardTable.update(views, { ...context, origins });
    this.showChildWindowContents();
    this.showSky();
    this.haze.setHaze(heatHazeFor(this.view.ambientTemperature));
    this.showInformation();
  }

  /**
   * 子ウィンドウが映しているものを、今のワールドで借り直す。差し替えの前後で束は別物になっているので、
   * そのまま使うと次のアクションが古いインスタンスに対して組まれる。
   *
   * **ウィンドウが閉じるのはここだけ**（プレイヤーが「閉じる」を押した場合を除く）。映していた1個が
   * 現在地から見えなくなっていれば、映すものもボタンが効く相手も無いので閉じる——食べた・打ち割った
   * 物も、別の土地へ移って置いてきた物（道）も同じ1つの基準（ShownCards.reborrowedWindow）。
   * ボタンを押しただけでは閉じない——何が起きたかは開いたままのウィンドウが見せる。
   * 返すのは、閉じたときに手放した札の出どころ。
   *
   * **枠を組み立てる前に呼ぶ**（showView）。閉じるならその枠は並びから消え、引き直せたならその
   * 新しい姿が枠に出る。
   */
  private refreshChildWindowReturningOrigins(): ReadonlyMap<number, Rect> {
    if (this.childWindow === undefined || this.shown.reborrowedWindow()) return new Map();
    return this.closeChildWindowReturningOrigins();
  }

  /**
   * 開いている子ウィンドウの中身を、今のviewで引き直す。素材を入れれば「作業する」が押せるように
   * なり、抜けば押せなくなる——**ボタンの可否もプロパティの行も、渡した時点で固まる**
   * （ObjectWindow）ので、世界が変わるたびに渡し直す必要がある。
   */
  private showChildWindowContents(): void {
    // プロパティは映しているものによらずキャラクタのものなので、札が無くても渡す。
    this.childWindow?.setProperties(this.status.tabs());

    const card = this.shown.windowStack;
    if (this.childWindow === undefined || card === undefined) return;

    this.childWindow.setActions(this.actionButtons(card.actions, card.name));
  }

  /**
   * 情報エリアの表示を今のthis.viewへ合わせる。条件と装備のアイコンはまだ固定値なので引き直さない
   * （PlayScreenView参照）。
   */
  private showInformation(): void {
    this.situationPanel.setTime(this.view.elapsedDays, this.view.hour, this.view.minute);
    this.situationPanel.setWeather(this.view.weather, this.view.weatherLabel);
    this.showConditions();
    this.showStatuses();
  }

  /**
   * 情報エリアの背景（1枚の本のページ）。フィールドエリアに接する辺だけ、表紙の縁がフィールドへ
   * 食い込む（informationArt参照）。内訳の各エリアは自前の背景板を持たず、このページの上に直接載る。
   *
   * 絵は縦横同率で拡大縮小し、フィールドエリア側の辺を基準に置く。反対側（横型の左・縦型の上）は
   * 画面外へはみ出す前提で、絵の側に十分な余白が取られている。極端な画面比で絵が届かない場合に
   * 備えて、下地に紙の色の背景板を敷く。背景板はレーンからはみ出したカードを隠す役目も兼ねる。
   */
  private buildInformationArea(layout: PlayScreenLayout): void {
    const area = layout.informationArea;
    const landscape = this.metrics.isLandscape;
    addInputBlockingPanel(this, area, COLOR.informationPaper);

    // 9patchなので、絵の向きは変えずに大きさだけ指定する。縦型は表紙の縁を下へ向けるため90度回す。
    // 回すと縦横が入れ替わるので、幅に情報エリアの高さを、高さに幅を渡す。
    //
    // 大きさはuで渡し、絵ごとu倍して敷く。9patchの縁は絵から原寸で切り出されるため、等倍で敷くと
    // 縁の太さが絵のピクセル数のまま固定され、uで組んだ他の寸法とずれてしまう（informationArt参照）。
    const scale = this.metrics.u;
    const along = (landscape ? area.width : area.height) / scale + INFORMATION_OVERLAP_PX;
    const across = (landscape ? area.height : area.width) / scale;
    const page = addNineSlice(this, INFORMATION_BACKGROUND, along, across, INFORMATION_BORDER_PX)
      .setScale(scale)
      // ページも背景板と同じく入力を遮る（addInputBlockingPanel参照）。コンテナは当たり判定の形を持たないので渡す。
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, along, across), Phaser.Geom.Rectangle.Contains);
    if (landscape) page.setPosition(area.x, area.y);
    // 原点(0,0)を軸に90度回すと、絵は右下方向ではなく左下方向へ広がる。右上の角を起点に置く。
    else page.setAngle(90).setPosition(area.x + area.width, area.y);

    // 縦長すぎる縦型でオプションバーの上に出る余りを、ページのはみ出しごと画面外として塗り潰す。
    // オプションバーはこの後に置くので、その帯にかぶるぶんは塗り直される。
    const outside = landscape ? 0 : layout.optionsBar.y;
    if (outside > 0) {
      addInputBlockingPanel(
        this,
        { x: 0, y: 0, width: this.metrics.width, height: outside },
        COLOR.outsideScreen,
      );
    }
  }

  private addDivider(rect: Rect): void {
    this.add.rectangle(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height,
      COLOR.laneDivider,
      0.35,
    );
  }

  private buildDashboard(layout: PlayScreenLayout): void {
    this.buildCharacterDisplay(layout.characterDisplay);
    this.buildStatusArea();
    this.buildSituationArea(layout.situationArea);
    this.addDivider(layout.informationDivider);
  }

  /**
   * ポートレイトカードと、地図・装備・怪我・レシピのボタン、条件のアイコン（ScreenLayout.md 4.1節）。
   *
   * ボタンはポートレイトの**右へ縦積み**する。このエリアで最も背の高いポートレイト（320u）の
   * 高さをボタンが使い切るので、下へ積むより1つあたりを大きく取れる。縦型・横型で同じ組み方に
   * なるため、向きによる分岐も要らない。
   */
  private buildCharacterDisplay(area: Rect): void {
    const padding = this.metrics.px(CHARACTER_DISPLAY_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const portraitWidth = this.metrics.px(SIZE.cardWidth);
    const portraitHeight = this.metrics.px(SIZE.cardHeight);
    this.portraitRect = {
      x: area.x + padding,
      y: area.y + padding,
      width: portraitWidth,
      height: portraitHeight,
    };
    // ポートレイトも枠1つのレーン。キャラクタ自身の札を子ウィンドウへ貸し出すのに、他のカードと
    // 別の道筋を持たないため（背景板も送りも要らないのでbare）。
    this.portraitLane = new CardLane(
      this,
      this.metrics,
      this.portraitRect,
      COLOR.informationPaper,
      this.portraitCells(),
      { bare: true },
    );

    const columnX = area.x + padding + portraitWidth + gap;
    // 状況アイコンはポートレイトの下だけに置き、ボタンの列はその行の下端まで伸ばす。
    // こうすると同じ大きさのボタンが4つ入る（ScreenLayout.md 4.1節）。
    const conditionSize = this.metrics.px(SIZE.conditionButton);
    this.addSlotButtonColumn({
      x: columnX,
      y: area.y + padding,
      width: area.x + area.width - padding - columnX,
      height: portraitHeight + gap + conditionSize,
    });

    // 中身は行動のたびに引き直す（showConditions）ので、ここで作るのは器だけ。
    this.conditionRow = this.add.container(area.x + padding, area.y + padding + portraitHeight + gap);
  }

  /**
   * 状況アイコンを並べ直す（ScreenLayout.md 4.1.1節）。ポートレイトの真下に1行で左詰めに並べる
   * ——キャラクタの周りの事情なので、本人を映す札の下に続けて置くと誰の周りかが読み取れる。
   *
   * **押しても何も起きないので、押せる形（Button）にはしない。** 出しているのは場所と世界の事実で、
   * そこから操作する対象が無い。何も妨げていない間は行ごと空になる。
   */
  private showConditions(): void {
    this.conditionRow.removeAll(true);
    const size = this.metrics.px(SIZE.conditionButton);
    const gap = this.metrics.px(8);
    this.view.conditions.forEach((situation, index) => {
      const x = index * (size + gap);
      const box = this.add.graphics();
      drawBox(
        box,
        { x, y: 0, width: size, height: size },
        {
          fillColor: COLOR.button,
          borderColor: COLOR.buttonBorder,
          borderWidth: this.metrics.linePx(2),
          radius: this.metrics.px(SIZE.radius),
        },
      );
      const icon = this.buttonIcon(
        { art: situation, icon: SITUATION_ICONS[situation] ?? UNKNOWN_SITUATION_ICON },
        { width: CONDITION_ICON_ART, height: CONDITION_ICON_ART },
        CONDITION_GLYPH_SIZE,
      );
      icon.setPosition(x + size / 2, size / 2).setOrigin(0.5);
      this.conditionRow.add([box, icon]);
    });
  }

  /**
   * 地図・装備・怪我・レシピの4ボタンを、渡した列へ縦に並べる。
   *
   * 並びは持ち物の近さの順。地図と装備は身につけているもの、装備と怪我は開く子ウィンドウの形が
   * 同じで、地図が最も押す頻度が低いので端に来る。レシピは持ち物ではないので反対の端。
   */
  private addSlotButtonColumn(column: Rect): void {
    // 真ん中は、キャラクタが外から見せているスロット（visible_slots）。どれが並ぶかは画面ではなく
    // ワールドが決める——窓のタブと同じ並びが、そのままボタンになる。
    const characterSlots = this.view.characterWindow.slots.flatMap((place) => {
      const looks = CHARACTER_SLOT_BUTTONS[this.view.slotViewOf(place).key];
      return looks === undefined ? [] : [{ ...looks, onTap: () => this.openCharacterWindow(place) }];
    });
    const buttons = [
      {
        art: 'map' as IconName,
        icon: SLOT_BUTTON_ICONS.map,
        fill: COLOR.mapButton,
        onTap: () => this.openMapWindow(),
      },
      ...characterSlots,
      {
        art: 'recipe' as IconName,
        icon: SLOT_BUTTON_ICONS.recipe,
        fill: COLOR.recipeButton,
        onTap: () => this.openRecipeWindow(),
      },
    ];
    // 列の高さを4等分せず、上下へ余白を空けた残りを間隔に回す（SIZE.slotButtonColumnInset）。
    // **間隔を別の定数にはしない**——両方を定数にすると、片方を変えたときに列の高さと合わなくなる。
    const width = Math.min(this.metrics.px(SIZE.slotButton.width), column.width);
    const height = this.metrics.px(SIZE.slotButton.height);
    const inset = this.metrics.px(SIZE.slotButtonColumnInset);
    const gap = Math.max(0, (column.height - inset * 2 - height * buttons.length) / (buttons.length - 1));
    const stack = height * buttons.length + gap * (buttons.length - 1);
    const top = column.y + Math.max(0, (column.height - stack) / 2);
    // 余った幅は左右へ等分する。左詰めにするとポートレイトとの間だけが詰まって、
    // 列全体が左へ寄って見えた。
    const left = column.x + Math.max(0, (column.width - width) / 2);
    buttons.forEach((spec, index) => {
      this.addSlotButton({ x: left, y: top + index * (height + gap), width, height }, spec, index);
    });
  }

  /**
   * 地図・装備・怪我・レシピのボタン。**絵を中央に1つ置くだけで、文字は載せない**（ScreenLayout.md 4.2節）。
   *
   * 4つとも役割が固定なので、絵だけで区別が付く。文字を持たなければ、言語ごとに変わる文字数を
   * ボタンの内側へ収める必要も無い（日時のフリップカードと同じ考え方）。
   *
   * **紙として置かれるので影を落とす**（drawBoxのshadow）。カードは絵に影が焼いてあり（card_frame.json）、
   * このボタンだけが本のページに貼り付いて見えていた。立体的な縁は足さない——枠を持たせるとカードと
   * 同じ格に見えて、画面のメリハリが消える。
   */
  private addSlotButton(
    rect: Rect,
    spec: { art: IconName; icon: string; fill: number; onTap: () => void },
    index: number,
  ): void {
    const radius = this.metrics.px(SIZE.radius);
    const borderWidth = this.metrics.linePx(2);
    const button = new Button(this, rect, {
      fillColor: spec.fill,
      borderColor: COLOR.paperButtonBorder,
      borderWidth,
      radius,
      shadowOffset: this.metrics.px(PAPER_BUTTON_SHADOW),
    });
    button.addContent(...this.slotButtonPaper(rect, index, radius, borderWidth));
    // 絵文字は正方形なので、キャンバスの高さがそのまま大きさになる。
    button.addCentered(this.buttonIcon(spec, SIZE.slotButtonIcon, SIZE.slotButtonIcon.height));
    button.on('pointerup', this.whileIdle(spec.onTap));
  }

  /**
   * ボタンの地。**染めた紙を敷くだけ**——色も角丸も絵に焼いてある
   * （recipes/slot_button_paper.json、カードの枠と同じ扱い）。実行時に染めて切り抜くと、
   * どちらもWebGL専用の機能になり、WebGLの無い環境で色も角丸も消える。
   *
   * 敷く紙はボタン専用の絵（`SLOT_BUTTON_PAPER_TEXTURE`）で、ボタン1つぶんが1枚。**カードの枠とは
   * 別の絵**で、同じ紙から切り出してあるだけ。枠線は紙の上へ引き直す（Buttonが描く枠線は紙の下に
   * なる）。
   *
   * 紙が読めなければ何も敷かず、Buttonの平らな塗りがそのまま地になる。
   */
  private slotButtonPaper(
    rect: Rect,
    index: number,
    radius: number,
    borderWidth: number,
  ): Phaser.GameObjects.GameObject[] {
    if (!this.textures.exists(SLOT_BUTTON_PAPER_TEXTURE)) return [];

    // ボタンごとに別の1枚を敷く。同じ絵だと4つに同じ染みが並び、模様として目に付く。
    const sheet = this.textures.get(SLOT_BUTTON_PAPER_TEXTURE);
    const paper = this.add
      .image(0, 0, SLOT_BUTTON_PAPER_TEXTURE, index % sheet.frameTotal)
      .setOrigin(0, 0)
      .setDisplaySize(rect.width, rect.height);

    const frame = this.add.graphics();
    frame.lineStyle(borderWidth, COLOR.paperButtonBorder, 1);
    frame.strokeRoundedRect(0, 0, rect.width, rect.height, radius);
    return [paper, frame];
  }

  /**
   * 絵があればそれを、無ければ絵文字を、ボタンの中央へ置く（iconArt参照）。canvasは絵を敷く寸法、
   * glyphSizeは絵文字の大きさで、**スロットのボタンと桟のアイコンの違いはこの2値だけ**なので仕組みは
   * 分けない。
   *
   * **どの絵も同じ大きさで敷く。** 3枚とも同じ寸法のキャンバスに、物だけが実物の大小——開いた地図 >
   * Tシャツ > 巻いた包帯——のとおり描き分けてある（card_art.pyの--canvas）。UIが物の大きさを測って
   * 揃えると、その差が消えてしまう。周りは透けているので、ボタンの地の色が下に出る。
   */
  private buttonIcon(
    spec: BarIcon,
    canvas: { width: number; height: number },
    glyphSize: number,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Text {
    const texture = spec.art === undefined ? undefined : iconTexture(spec.art);
    if (texture !== undefined && this.textures.exists(texture)) {
      return this.add
        .image(0, 0, texture)
        .setDisplaySize(this.metrics.px(canvas.width), this.metrics.px(canvas.height));
    }
    return addLabel(this, this.metrics, 0, 0, spec.icon, { size: glyphSize });
  }

  /**
   * バーは上端に揃える。表示件数が変わっても位置が動かないようにするため（StatusArea.md 1節）。
   *
   * 出す行は行動のたびに変わる（安全域のステータスは出さない）が、バーはここで全プロパティ分を作って
   * おき、以後は見せ方と位置だけを変える。あとから作ると、開いている子ウィンドウの覆いより手前へ
   * 出てしまうため（CardTable参照）。
   */
  private buildStatusArea(): void {
    this.statusRowGap = this.metrics.px(this.metrics.isLandscape ? 10 : 16);

    // 致命的域を伝える画面全体の枠。飛んでいるカードや子ウィンドウにも隠されないよう最前面へ出す。
    this.alertFrame = new ScreenAlertFrame(this, this.metrics).setDepth(SCREEN_DEPTH.alertFrame);

    const bars = new Map<string, StatusBar>();
    for (const status of this.status.all()) {
      const bar = new StatusBar(
        this,
        this.metrics,
        this.layout.statusRowsArea.x,
        this.layout.statusRowsArea.y,
        this.layout.statusRowsArea.width,
        status,
        // 変化を見せ終わった行を並びから外すには、引き直す機会がここにしか無い（showStatuses）。
        { onCaughtUp: () => this.showStatuses() },
      );
      bars.set(status.key, bar.setVisible(false));
    }
    this.statusBars = bars;

    this.showStatuses();
  }

  /**
   * ステータスエリアの行を今の状態へ引き直す。ワールドが変われば値も増減の記号も、どの域に入るかも
   * 変わるので、行動のたびに呼ぶ（showView）。固定表示のトグルでも呼ぶ。
   *
   * 出す行が入れ替わると並び順も変わるため、位置と内容はそのつど与える（動きはバー自身が見せる、
   * StatusBar.show）。
   */
  private showStatuses(): void {
    const rows = this.status.rows(
      (status) => this.statusBars.get(status.key)?.wouldShowChangeFor(status) === true,
    );
    const rowHeight = StatusBar.height(this.metrics);

    const shown = new Set<string>();
    rows.forEach((row, index) => {
      const bar = this.statusBars.get(row.key);
      if (bar === undefined) return;
      shown.add(row.key);
      bar.show(row, this.layout.statusRowsArea.y + index * (rowHeight + this.statusRowGap));
    });
    for (const [key, bar] of this.statusBars) if (!shown.has(key)) bar.hide();

    this.alertFrame.setAlerting(rows.some((row) => row.alert === 'fatal'));
  }

  /**
   * 行をタップしたときに開く、そのステータスの詳細（Windows.md 8節）。開き直しでも同じ経路を
   * 通せるよう、受け取るのは中身ではなくプロパティの識別子で、中身は今のviewから引き直す。
   *
   * ステータスエリアからもプロパティのタブの行からも開くため、既に開いていれば入れ替える。
   */
  private openStatusDetail(key: string): void {
    const content = this.status.contentOf(key);
    if (content === undefined) return;

    noteOperation(this.locale.uiText('log_status_detail_opened'));
    this.statusDetailWindow?.close();
    this.statusDetailKey = key;
    this.statusDetailWindow = new StatusDetailWindow(this, this.metrics, {
      content,
      area: { x: 0, y: 0, width: this.metrics.width, height: this.metrics.height },
      // 影響の枠から相手の詳細へ渡り歩く。開き直しと同じ経路なので、今の窓は入れ替わる。
      onOpenStatus: (target) => this.openStatusDetail(target),
      // 絵だけのボタンなので、押されたことはここで控える（Button.addTextButton参照）。
      onTogglePin: () => {
        noteOperation(this.locale.uiText('log_status_pin_toggled'));
        this.status.togglePin(key);
      },
      onClose: () => {
        this.statusDetailWindow = undefined;
        this.statusDetailKey = undefined;
      },
    });
  }

  /**
   * 固定表示をセーブデータへ書き戻す（SaveDataManagement.md セーブデータのスキーマ節）。
   * スロットを使わないシナリオからの起動では、そのプレイの間だけ残る。
   */
  private savePinnedStatuses(): void {
    this.save = { ...this.save, pinnedStatuses: [...this.status.pinnedKeys] };
    this.writeSave();
  }

  /** 地図でカードを置いた位置をセーブデータへ書き戻す（savePinnedStatusesと同じ扱い）。 */
  private placeMapCard(site: number, at: MapPlacement): void {
    this.mapPositions.set(site, at);
    this.save = {
      ...this.save,
      mapCardPositions: [...this.mapPositions].map(([index, position]) => ({
        site: index,
        x: position.x,
        y: position.y,
      })),
    };
    this.writeSave();
  }

  private writeSave(): void {
    if (this.slotIndex >= 0) new SaveSlots(localStorage).write(this.slotIndex, this.save);
  }

  /**
   * 行動の前後でステータスを比べ、増減を控える。次の行動まで記号を出し続けるので、移動で
   * フィールドエリアを作り直してもそのまま出る。
   *
   * 時間を消費しない操作では記号を消さない（statusChangesAfter）。
   */
  private noteStatusChanges(before: readonly StatusContent[], startedAt: number): void {
    this.status.noteChangesSince(before, this.gameSession.world.totalMinutes > startedAt);
  }

  /** 何を作るかを選ぶ一覧を開く。選ぶと製作中オブジェクトが現在地に生まれる。 */
  private openRecipeWindow(): void {
    noteOperation(this.locale.uiText('log_recipe_window_opened'));
    this.recipeWindow?.close();
    this.recipeWindow = new RecipeWindow(this, this.metrics, {
      title: this.locale.uiText('recipe_title'),
      categories: recipeCategories(this.gameSession, this.codex, this.locale, (defGlobalId, origin) => {
        this.closeRecipeWindow();
        this.startCrafting(defGlobalId, origin);
      }),
      emptyText: this.locale.uiText('recipe_empty'),
      onClose: () => this.closeRecipeWindow(),
    });
  }

  private closeRecipeWindow(): void {
    this.recipeWindow?.close();
    this.recipeWindow = undefined;
  }

  /**
   * 製作中オブジェクトを現在地へ生み、その子ウィンドウを開く。
   *
   * 生んだ直後にすることは素材を入れることしかないので、レーンから探し直させない。
   *
   * originは一覧で選んだカードの居場所。生まれたカードはそこから飛んでくる——一覧は閉じているので、
   * 選んだ札がそのまま場に出た、という見え方になる。**開く子ウィンドウへもそこから直に飛ばす**
   * （Windows.md 1.1節）——生んだ札はすぐ借り出されるので、レーンの枠を経由しても一瞬で通り過ぎる。
   *
   * **これだけは出どころが世界の事実ではない。** プレイヤーの操作が直に生んだので主体が居らず、
   * 出どころも閉じた一覧の中にしか無かった札の位置なので、その矩形を直に渡す（MotionContext.origins）。
   */
  private startCrafting(inProgressDefGlobalId: number, origin: Rect): void {
    const location = this.gameSession.player.location;
    if (location === undefined) return;

    const spawned = spawnInProgressObject(this.gameSession.session, location.instance, inProgressDefGlobalId);
    this.view = this.viewOfGame();
    this.showView({ origins: new Map([[spawned.instanceId, origin]]), born: [spawned.instanceId] });

    // 生まれたものが同じ型の束へ合流していることもあるので、束の中を見て探す。
    const card = this.locationCards.find((stack) =>
      stack.objects.some((object) => object.instanceId === spawned.instanceId),
    );
    // 生んだ直後にすることは素材を入れることしかないので、素材のタブから開く（記憶より優先する）。
    if (card !== undefined) this.openObjectWindow(card, origin, true);
  }

  /** 地図ボタンから開く地図ウィンドウ。既知の土地と発見済みの道を、ユーザが並べた位置で見せる。 */
  private openMapWindow(): void {
    noteOperation(this.locale.uiText('log_map_opened'));
    this.mapWindow?.close();
    this.mapWindow = new MapWindow(this, this.metrics, {
      lands: this.view.mapLands,
      roads: this.view.mapRoads,
      positions: this.mapPositions,
      onPlace: (site, at) => this.placeMapCard(site, at),
      onClose: () => {
        this.mapWindow = undefined;
      },
    });
  }

  private buildSituationArea(area: Rect): void {
    this.situationPanel = new WeatherPanel(this, this.metrics, area, {
      weather: this.view.weather,
      weatherLabel: this.view.weatherLabel,
      elapsedDays: this.view.elapsedDays,
      hour: this.view.hour,
      minute: this.view.minute,
      onTapTime: this.whileIdle(() => this.openCharacterWindow()),
    });
  }

  /** 縦型は画面最上部の横長バー（右寄せ）、横型は右サイドバー上段の縦積み。 */
  private buildOptionsBar(area: Rect): void {
    this.buildIconBar(
      area,
      COLOR.optionsBar,
      this.layout.optionsBarIcons(OPTION_ICONS.length),
      (rect, index) => {
        const spec = OPTION_ICONS[index];
        return this.addIconButton(
          rect,
          spec,
          false,
          COLOR.paperButtonBorder,
          spec === MENU_ICON ? () => this.confirmReturnToTitle() : undefined,
        );
      },
    );
  }

  /**
   * バーに並ぶアイコンボタンを組む（オプション・フィルター共通）。**バーに収まらない数を渡されても
   * 全部押せる**——並びを送れる面に載せ、はみ出した分をドラッグとホイールで送る
   * （ScreenLayout.md 8節。収まっていれば送り先が無く、スクロールバーも出ない）。
   *
   * **ボタン自身も送る面に含める。** ボタンがバーの厚みいっぱいを占めるので、地の見えている隙間
   * だけでは掴む所がほとんど残らない。
   *
   * 送った先は切り抜かない（CardLaneと同じ）——並びが伸びる先は画面の外か、この後に置く隣のバーの
   * 背景板が覆う。
   */
  private buildIconBar(
    bar: Rect,
    barColor: number,
    row: BarIconRow,
    addButton: (rect: Rect, index: number) => Button,
  ): Button[] {
    const panel = addInputBlockingPanel(this, bar, barColor);
    const strip = this.add.container(0, 0);
    const buttons = row.icons.map(addButton);
    strip.add(buttons);

    const scroll = new ScrollArea(this, {
      axis: row.axis,
      content: strip,
      viewport: bar,
      inputSurfaces: [panel, ...buttons],
      readout: this.addBarScrollIndicator(bar, row.axis),
      clip: false,
    });
    scroll.setContentLength(row.length);
    return buttons;
  }

  /**
   * バーの送り具合を映すスクロールバー。**縦に送るバーには同じ物を90度回して立てる**——横の帯の絵を
   * 回して縦の区切りに敷くのと同じ（shapes.addTiledImageVertical）。回すと厚みは手前側へ伸びるので、
   * 起点はバーの終わりの辺に置く。
   */
  private addBarScrollIndicator(bar: Rect, axis: 'x' | 'y'): ScrollIndicator {
    const gap = this.metrics.px(SIZE.scrollBarGap);
    const thickness = this.metrics.px(SIZE.scrollBar);
    return axis === 'y'
      ? new ScrollIndicator(this, this.metrics, bar.x + bar.width - gap, bar.y, bar.height).setAngle(90)
      : new ScrollIndicator(this, this.metrics, bar.x, bar.y + bar.height - gap - thickness, bar.width);
  }

  /**
   * 絞り込みのボタン列（ScreenLayout.md 8節）。選択中のタグは背景色を反転させて強調する。
   *
   * **並ぶボタンを決めるのはワールド**（`card_filters`、同8.1.3節）で、画面が足すのは先頭の
   * 「すべて」だけ。絵も絵文字もその宣言が名乗るので、ここに対応表は無い。
   */
  private buildFilterBar(area: Rect): void {
    const specs: readonly BarIcon[] = [
      FILTER_ALL_ICON,
      ...this.codex.cardFilters.map((filter) => ({ art: filter.id, icon: filter.icon })),
    ];
    this.filterButtons = this.buildIconBar(
      area,
      COLOR.filterBar,
      this.layout.filterBarIcons(specs.length),
      (rect, index) =>
        this.addIconButton(rect, specs[index], index === this.selectedFilter, COLOR.filterButtonBorder, () =>
          this.selectFilter(index),
        ),
    );
  }

  /**
   * 絞り込みを選び直す。**同じボタンを押し直すと解除する**（ScreenLayout.md 8.1.6節）——選べるのは
   * 1つだけなので、押すたびに入り切りが要る。
   *
   * 隠れる札が変わるだけでワールドは何も変わらないので、時間は経たない。
   */
  private selectFilter(index: number): void {
    if (this.busy) return;

    this.selectedFilter = index === this.selectedFilter ? 0 : index;
    this.filterButtons.forEach((button, i) => {
      button.setBoxStyle(this.iconButtonStyle(i === this.selectedFilter, COLOR.filterButtonBorder));
    });
    noteOperation(
      this.locale.uiText('log_filter_selected', {
        name: this.cardFilter?.id ?? this.locale.uiText('log_filter_none'),
      }),
    );
    this.showView();
  }

  /**
   * バーのアイコンボタン。**枠線の色は置かれるバーが決める**（地の色に合わせるため。theme参照）。
   *
   * スロットボタンと同じく紙として置かれるので、同じ影を落とす（addSlotButton参照）。
   *
   * **押されたことにするのはButtonに任せる**（生のpointerupを繋がない）——バーは送れるので、
   * よそで始めたドラッグを離した先がこのボタンでも、押されたことになってはいけない。
   */
  private addIconButton(
    rect: Rect,
    spec: BarIcon,
    active: boolean,
    border: number,
    onTap?: () => void,
  ): Button {
    // どの絵も同じ大きさで敷く。4つの役割に大小は無いので、物の大きさで差を付ける理由も無い。
    const button = new Button(this, rect, this.iconButtonStyle(active, border), onTap);
    const art = SIZE.iconButtonArt;
    button.addCentered(this.buttonIcon(spec, { width: art, height: art }, ICON_BUTTON_GLYPH_SIZE));
    return button;
  }

  /** バーのアイコンボタンの台紙（選択中は塗りを反転し、枠線の色は置かれるバーが決める）。 */
  private iconButtonStyle(active: boolean, border: number): BoxStyle {
    return {
      fillColor: active ? COLOR.buttonActive : COLOR.button,
      borderColor: border,
      borderWidth: this.metrics.linePx(2),
      radius: this.metrics.px(SIZE.radius),
      shadowOffset: this.metrics.px(PAPER_BUTTON_SHADOW),
    };
  }

  /**
   * 死んだことを伝えるダイアログ（VitalsSystem.md 6節）。ポートレイトと生存日数と死因だけを出す
   * ——選択肢は無く、閉じる以外にできることが残っていない。
   *
   * **画面はそのままにする。** 死んだキャラクタはもうどの土地にも居ないので、今のワールドを映し直すと
   * 現在地も足元の物も別のものに入れ替わってしまう（fromGameSession）。
   */
  private showDeath(): void {
    const cause = this.gameSession.player.ending.causeOfDeath;
    this.noteOperationAt(this.locale.uiText('log_died', { cause: cause ?? this.locale.uiText('unknown') }));

    new ModalDialog(this, this.metrics, {
      card: this.view.characterCard,
      title: this.locale.uiText('death_title', { name: this.view.characterCard.name }),
      // 死因を名乗るのはワールドの側（命を絶ったdestroy）で、画面は文言を引くだけ。
      body: [
        this.locale.uiText('survived_days', { days: String(this.view.elapsedDays) }),
        causeOfDeathSentence(cause, this.locale),
        this.locale.uiText('death_no_record'),
      ].join('\n'),
      actions: [
        {
          label: this.locale.uiText('death_to_slots'),
          style: 'primary',
          onTap: () => this.deleteSaveAndLeave(),
        },
      ],
    });
  }

  /**
   * 島を出たことを伝えるダイアログ（docs/concept/GameEndings.md 3節）。閉じると棚へ移る。
   *
   * **本土に着いた後は描かない。** 出すのは、渡り切ったことと、持ち帰った物がこれから棚へ収まる
   * ことだけ——その先の暮らしは周回の外にある。
   */
  private showEscape(): void {
    const brought = this.gameSession.player.ending.broughtArtifacts;
    this.noteOperationAt(this.locale.uiText('log_escaped', { count: String(brought.length) }));

    new ModalDialog(this, this.metrics, {
      card: this.view.characterCard,
      title: this.locale.uiText('escape_title', { name: this.view.characterCard.name }),
      body: [
        this.locale.uiText('escape_days', { days: String(this.view.elapsedDays) }),
        this.locale.uiText('escape_body'),
        this.locale.uiText('escape_no_record'),
      ].join('\n'),
      actions: [
        {
          label: this.locale.uiText('escape_to_shelf'),
          style: 'primary',
          onTap: () => this.storeAndLeave(brought),
        },
      ],
    });
  }

  /** 持ち帰った物を棚へ収め、周回を終える（棚の画面へ移る）。 */
  private storeAndLeave(brought: readonly string[]): void {
    const added = new Shelf(localStorage).addReturningNewlyAdded(brought);
    this.deleteSave();
    this.scene.start('shelf', { added });
  }

  /**
   * 死んだセーブデータを消して、セーブ選択画面へ戻る。**続きから始められる状態は残さない**
   * ——このゲームにはハードコアモードしか無い（SaveDataManagement.md）。
   */
  private deleteSaveAndLeave(): void {
    this.deleteSave();
    this.scene.start('slots');
  }

  /** 周回そのものを消す。スロットを使わないシナリオからの起動（slotIndexが-1）では消すものが無い。 */
  private deleteSave(): void {
    if (this.slotIndex >= 0) new SaveSlots(localStorage).delete(this.slotIndex);
  }

  private confirmReturnToTitle(): void {
    new ModalDialog(this, this.metrics, {
      title: this.locale.uiText('quit_title'),
      body: this.locale.uiText('quit_body'),
      actions: [
        { label: this.locale.uiText('cancel') },
        {
          label: this.locale.uiText('quit_confirm'),
          style: 'primary',
          onTap: () => this.scene.start('title'),
        },
      ],
    });
  }
}

/**
 * 2つの出どころを重ねる（cardMotionPlanのorigins）。指しているインスタンスは重ならない——世界に
 * 生まれたものと、ウィンドウが手放した札は別物のため。
 */
function withOrigins(
  origins: ReadonlyMap<number, Rect> | undefined,
  added: ReadonlyMap<number, Rect>,
): ReadonlyMap<number, Rect> | undefined {
  if (added.size === 0) return origins;

  const merged = new Map(origins);
  for (const [id, rect] of added) merged.set(id, rect);
  return merged;
}

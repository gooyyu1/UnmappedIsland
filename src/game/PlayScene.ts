import Phaser from 'phaser';
import type { Rect } from './layout/ScreenMetrics';
import { DISPLAY_PADDING, PlayScreenLayout } from './layout/PlayScreenLayout';
import { ResponsiveScene } from './ResponsiveScene';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { resolveCharacterDefName, start } from '../domain/generation/NewGame';
import { seededRng } from '../domain/runtime/Rng';
import type { Localization } from '../locale/Localization';
import type { SaveData } from '../save/SaveData';
import { SAVE_SCHEMA_VERSION } from '../save/SaveData';
import { SaveSlots } from '../save/SaveSlots';
import type { Scenario } from '../scenario/Scenario';
import { applyScenario } from '../scenario/Scenario';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { CardCombination, CardPlace, ObjectCardStack, PlayScreenView } from './PlayScreenView';
import { fromGameSession, withFrozenCards } from './PlayScreenView';
import type { StatusDelta } from './statusChanges';
import { statusChangesAfter, statusChangesBetween } from './statusChanges';
import { statusRows } from './statusRows';
import { TickProgress } from './tickProgress';
import { Button, SLOT_BUTTON_PAPER_TEXTURE } from './ui/Button';
import { EDGE_DIRECTIONS } from './ui/Card';
import type { CardContent, CardEdgeAction, CardEdgeDirection } from './ui/Card';
import { characterCardContent } from './ui/characterArt';
import { Card, cardFace } from './ui/Card';
import type { CardDrop, CardDropInfo } from './ui/CardDragController';
import { CardDragController } from './ui/CardDragController';
import { CardLane } from './ui/CardLane';
import { emptyCellsFor } from './ui/laneCells';
import { Curtain } from './ui/Curtain';
import { LocationArtLoader } from './ui/LocationArtLoader';
import { INFORMATION_BACKGROUND, INFORMATION_BORDER_PX, INFORMATION_OVERLAP_PX } from './ui/informationArt';
import { addNineSlice } from './ui/nineSlice';
import { HAND_LANE_TEXTURE, laneTexture } from './ui/backgroundArt';
import { SEPARATOR_TEXTURE } from './ui/separatorArt';
import type { MotionContext } from './ui/CardMotion';
import { CardMotion } from './ui/CardMotion';
import { ExplorationWindow } from './ui/ExplorationWindow';
import type { MapPlacement } from './ui/MapWindow';
import { MapWindow } from './ui/MapWindow';
import { ModalDialog } from './ui/ModalDialog';
import type { ObjectWindowAction, ObjectWindowTarget } from './ui/ObjectWindow';
import { ObjectWindow } from './ui/ObjectWindow';
import { RecipeWindow } from './ui/RecipeWindow';
import { recipeCategories } from './recipeList';
import { autoFillMaterials } from '../domain/runtime/autoFill';
import { MATERIALS_SLOT } from '../loader/inProgressObjects';
import { ProgressRing } from './ui/ProgressRing';
import type { PropertyTab } from './ui/PropertyWindow';
import { PropertyWindow } from './ui/PropertyWindow';
import { ScreenAlertFrame } from './ui/ScreenAlertFrame';
import type { StatusContent } from './ui/StatusBar';
import { StatusBar } from './ui/StatusBar';
import type { IconName } from './ui/iconArt';
import { iconTexture } from './ui/iconArt';
import { WeatherPanel } from './ui/WeatherPanel';
import { WeatherOverlay } from './ui/WeatherOverlay';
import { ScreenSkyTint } from './ui/ScreenSkyTint';
import { LaneHaze } from './ui/LaneHaze';
import { heatHazeFor } from './ui/heatHaze';
import { durationText } from './ui/durationText';
import { addLabel } from './ui/labels';
import type { BoxStyle } from './ui/shapes';
import { addPanel, addTiledImage, addTiledImageVertical } from './ui/shapes';
import { COLOR, SIZE } from './ui/theme';

/** オプションバー・フィルターバーの内側パディング（縦型は左右が広め）。 */
const BAR_PADDING = 16;
const OPTIONS_BAR_PADDING_X = 24;
const FILTER_BAR_PADDING_X = 20;

/** ステータスエリアの内側パディング（キャラクター表示エリア側はDISPLAY_PADDING）。 */
const STATUS_PADDING = 24;

/**
 * ゲーム内時間の経過を実時間で見せる速さ（ゲーム内15分＝現実0.5秒）。durationを持つアクションは、
 * この速さで時間が経ち切るまで結果を見せない。
 */
const REAL_MS_PER_GAME_MINUTE = 500 / 15;

/** 経過分から日付・時刻を組み立てるための1日の長さ。 */
const MINUTES_PER_DAY = 24 * 60;

/** ドーナツグラフは、飛んでいるカードも探索の子ウィンドウも越えて最前面に出す。 */
const RING_DEPTH = 2;

/** 致命的域を伝える画面全体の枠は、そのドーナツグラフよりもさらに手前に出す。 */
const ALERT_FRAME_DEPTH = 3;

/**
 * フィールドエリアの表示物を置く層。既定の層（0）より奥へ置くことで、フィールドエリアだけを
 * 作り直しても（rebuildFieldArea）、はみ出したカードを隠す隣接エリアの背景板より奥に居ることを
 * 保証する——描画順に頼ると、作り直したぶんが背景板より手前へ入ってしまう。
 */
const FIELD_DEPTH = -1;

/**
 * 雨の演出は、フィールドエリアの表示物（FIELD_DEPTH）より手前・隣接エリアの背景板（既定の層）より奥。
 * カードの上に降らせつつ、はみ出したカードを隠す背景板の上には出さないため。
 */
const WEATHER_DEPTH = -0.5;

/**
 * 日射に応じた翳り・輝きは画面全体にかぶるので、飛んでいるカードの層（CardMotion）より手前。
 * ドーナツグラフと致命的域の枠だけは更に手前に残す——暗い時間帯でも変わらず読めている必要がある。
 */
const SKY_TINT_DEPTH = 1.5;

/** 場面転換の明転にかける時間（ミリ秒）。 */
const BRIGHTEN_MS = 320;

/**
 * 場面転換の暗転にかける時間（ミリ秒）。時間経過を待たずに素早く落とし、あとは暗いまま経過を見せる
 * （時計とドーナツグラフは暗幕より手前に出る）。明転より長く取るのは、場面が変わる合図として
 * 落ちていく途中を見せたいため。移動にかかる時間がこれより短ければ、その分だけで落とし切る。
 */
const DARKEN_MS = BRIGHTEN_MS * 2;

/** メニューだけは押したときの行き先があるため、判別できるよう切り出す。 */
const MENU_ICON = '☰';

/** 地図ボタンのアイコン。ドメイン側に表示できる形が無い固定値（装備・怪我のアイコンと同じ扱い）。 */
const MAP_ICON = '🗺️';

const OPTION_ICONS = ['⚙️', '📖', '📓', MENU_ICON];
const FILTER_ICONS = ['🗂️', '🍳', '💧', '🔨', '🎲'];

/**
 * ワールドを変えている途中の、あるtick境界での表示内容（PlayScene.record）。
 *
 * ワールドは操作の実行時に一気に進み切るが、画面は実時間をかけて追いかける。経過中のtickで起きた変化を
 * その瞬間に見せるため、tickごとの表示内容を控えておいて再生する。
 */
interface RecordedView {
  /** この控えが映している時刻（ゲーム内の総経過分。tick境界の絶対時刻になる）。 */
  readonly minutes: number;
  readonly view: PlayScreenView;
  /** 行動開始時からのステータスの増減。控えた時点までの分だけを見せる。 */
  readonly statusChanges: ReadonlyMap<string, StatusDelta>;
}

/** プレイ中の画面を開くときに渡す、対象のセーブデータ。 */
export interface PlaySceneData {
  readonly save: SaveData;
  /** セーブスロットの番号。シナリオからの起動（BootScene）はセーブへ書き戻さないため-1。 */
  readonly slotIndex: number;
  /** テスト用シナリオ。渡すと、シードから作り直した世界へ開始状態を置いてから始める。 */
  readonly scenario?: Scenario;
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
  private gameSession!: NewGameSession;
  private view!: PlayScreenView;

  /** カードを並べるレーンと、その内容の差し替えを動きとして見せる層。buildのたびに作り直される。 */
  private fixtureLane!: CardLane;
  private itemLane!: CardLane;
  private handLane!: CardLane;
  private motion!: CardMotion;
  private situation!: WeatherPanel;

  /** フィールドエリアの背景板。レーンと合わせて、フィールドエリアだけを作り直すときに捨てる。 */
  private fieldPanel!: Phaser.GameObjects.Rectangle;

  /** 天気に応じてフィールドエリアへ降らせる雨。現在地には依らないので、作り直しの対象外。 */
  private weatherOverlay!: WeatherOverlay;

  /** 日射に応じて画面全体へかぶせる翳り・輝き。雨と同じく作り直しの対象外。 */
  private skyTint!: ScreenSkyTint;

  /** アイテムレーンに立てる陽炎。掛ける対象はフィールドエリアの作り直しで入れ替わる。 */
  private haze: LaneHaze | undefined;

  /** 各エリアの位置・大きさ。画面寸法から決まるので、buildのたびに作り直される。 */
  private layout!: PlayScreenLayout;

  private drag: CardDragController | undefined;

  private selectedFilter = 0;
  private filterButtons: Button[] = [];

  /** 開いている探索の子ウィンドウ。画面の作り直しをまたいで開いたままにするために持つ。 */
  private explorationWindow: ExplorationWindow | undefined;

  /**
   * 開いている子ウィンドウ（ObjectWindow）と、それが映しているもの。
   *
   * カードから開いたなら`childWindowCard`、中身のスロットを映しているなら`childWindowPlace`を持つ
   * （両方持つのはコンテナ・怪我のように、カードでありながら中身も見せるとき）。中身を映している間は、
   * その場所が手持ちの「隣」になる（laneCards・cardsOf参照）。
   */
  private childWindow: ObjectWindow | undefined;
  private childWindowCard: ObjectCardStack | undefined;
  private childWindowPlace: CardPlace | undefined;

  /** 開いているプロパティウィンドウ。探索の子ウィンドウと同じく、画面の作り直しをまたいで開いたままにする。 */
  private propertyWindow: PropertyWindow | undefined;

  /** 開いている地図ウィンドウ。探索の子ウィンドウと同じく、画面の作り直しをまたいで開いたままにする。 */
  private mapWindow: MapWindow | undefined;

  /** 開いているレシピ一覧（RecipeWindow）。開いていなければundefined。 */
  private recipeWindow: RecipeWindow | undefined;

  /**
   * ステータスエリアに出しうるバー（プロパティの識別子で引く）。出す行と並び順は行動のたびに変わるが、
   * バー自体は画面の組み立て時に全プロパティ分を作っておく（showStatuses参照）。
   */
  private statusBars: ReadonlyMap<string, StatusBar> = new Map();

  /** ステータスエリアの1行目の位置・幅と行の間隔（どのバーをどの行へ置くかは行動のたびに引き直す）。 */
  private statusRowsX = 0;
  private statusRowsY = 0;
  private statusRowsWidth = 0;
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
   * ユーザが固定表示にしたプロパティの識別子。セーブデータが持つ値の作業用の複製で、
   * 切り替えるたびにスロットへ書き戻す（togglePinnedStatus）。
   */
  private pinnedStatuses = new Set<string>();

  /**
   * ユーザが地図に置いたカードの位置（サイトindex→正規化座標）。セーブデータが持つ値の
   * 作業用の複製で、カードを置くたびにスロットへ書き戻す（placeMapCard）。
   */
  private mapPositions = new Map<number, MapPlacement>();

  /** 直前の行動でのステータスの増減。プロパティの識別子で引く（並びが変わっても対応が取れる）。 */
  private statusChanges: ReadonlyMap<string, StatusDelta> = new Map();

  /** 探索の結果待ちか（この間は次の探索を始められない）と、直前の探索で見つかったもの。 */
  private searching = false;
  private found: readonly CardContent[] = [];

  /**
   * 時間の経過を見せている最中か（passTime参照）。画面にはまだ経過前の状態が出ているため、
   * そこへの操作は既に古い並びを指している。
   */
  private passingTime = false;

  /** 場面転換（暗転 → フィールドエリアの作り直し → 明転）の最中か（transit参照）。 */
  private transiting = false;

  /** 土地の絵の遅延ロード。initで必ず設定される。 */
  private artLoader!: LocationArtLoader;

  /**
   * 絵待ちの世代番号。画面の作り直し（rebuild）は張っていた暗幕ごと表示物を捨てるため、
   * 捨てられた幕を明転させようとする古い待ちをこの番号の不一致で無効にする
   * （revealWhenLocationArtLoaded参照）。
   */
  private artWait = 0;

  /** 演出を見せている最中か。この間はワールドを変える操作を受け付けない。 */
  private get busy(): boolean {
    return this.passingTime || this.transiting;
  }

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
    this.pinnedStatuses = new Set(data.save.pinnedStatuses);
    this.mapPositions = new Map(
      data.save.mapCardPositions.map((position) => [position.site, { x: position.x, y: position.y }]),
    );
    const character = resolveCharacterDefName(this.codex, data.save.characterId);
    this.gameSession = start(this.codex, character, data.save.seed, seededRng(data.save.seed));
    if (data.scenario !== undefined) applyScenario(this.gameSession, data.scenario, this.codex);
    this.view = fromGameSession(this.gameSession, this.codex, this.locale);
    this.artLoader = new LocationArtLoader(this);
    this.requestLocationArt();
  }

  /**
   * 今の世界で絵が要る土地——現在地と、道の行き先——のロードを始める（冪等）。
   * 道が見つかった瞬間・移動が確定した瞬間（ワールドを変えた直後）に呼ぶことで、その絵が大きく映る
   * 場面（行き先の土地カード・移動後のフィールド）までにロードを済ませておく。間に合わなかった絵は、
   * カードなら届いた時点で貼り替わり（Card）、移動なら暗転のまま待つ（transit）。
   */
  private requestLocationArt(): void {
    const location = this.gameSession.player.location;
    if (location === undefined) return;

    this.artLoader.request(location.instance.def.name);
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
    const pathTagId = this.codex.tagNames.tryGetId('path');
    if (pathTagId === undefined) return [];

    const names: string[] = [];
    for (const fixture of fixtures) {
      if (!fixture.def.tags.includes(pathTagId)) continue;
      const destination = new Path(fixture, this.codex.propertyNames).destination;
      if (destination !== undefined) names.push(destination.def.name);
    }
    return names;
  }

  protected build(): void {
    const layout = new PlayScreenLayout(this.metrics);
    this.layout = layout;
    // 開いていた子ウィンドウは、画面を作り直したあと同じものを開き直す（表示物は捨てられているため）。
    const wasExploring = this.explorationWindow !== undefined;
    const openedPlace = this.childWindowPlace;
    const wasShowingProperties = this.propertyWindow !== undefined;
    const wasShowingMap = this.mapWindow !== undefined;
    const openedCard = this.childWindowCard;
    this.explorationWindow = undefined;
    this.childWindow = undefined;
    this.childWindowCard = undefined;
    this.childWindowPlace = undefined;
    this.propertyWindow = undefined;
    this.mapWindow = undefined;

    // 手前から奥への重なりに合わせて組み立てる。レーンからはみ出したカードは切り抜かず、
    // 後から描く背景板で隠す設計のため、順序そのものに意味がある。
    this.buildFieldArea(layout);
    // 雨は自前の層（WEATHER_DEPTH）に居るので、順序ではなく深度でカードの手前・背景板の奥に入る。
    this.weatherOverlay = new WeatherOverlay(
      this,
      this.metrics,
      layout.fieldArea,
      this.view.weather,
    ).setDepth(WEATHER_DEPTH);
    // 翳り・輝きは画面全体にかぶるので、組み立ての順序ではなく深度で最前面近くへ出す。
    this.skyTint = new ScreenSkyTint(this, this.metrics, this.view.sunlight).setDepth(SKY_TINT_DEPTH);
    // 飛んでいるカードの層はフィールドエリアの作り直しでは捨てないので、そちらには含めない。
    this.motion = new CardMotion(this, this.metrics);
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
    if (wasExploring) this.openExplorationWindow();
    if (openedCard !== undefined) this.openObjectWindow(openedCard);
    else if (openedPlace !== undefined) this.openSlotWindow(openedPlace);
    if (wasShowingProperties) this.openPropertyWindow();
    // 地図は全画面を覆うので、さらにその上へ開き直す。
    if (wasShowingMap) this.openMapWindow();
    this.coverUntilLocationArtLoaded();
  }

  /**
   * 現在地の絵がまだ届いていなければ（プレイ開始直後・絵待ち中の作り直し）、届くまでフィールド
   * エリアを暗幕で覆う。届いた時点で作り直して明転する——組み立て済みの表示に絵だけを後から
   * 差し込む経路は無いため。
   */
  private coverUntilLocationArtLoaded(): void {
    // 作り直し前の幕を明転させようとする待ちが残っていれば無効にする（幕は作り直しで消えている）。
    this.artWait += 1;
    if (this.artLoader.loaded(this.view.locationArt)) {
      // 場面転換の途中で作り直された場合、その転換の明転はもう起きない。busyのまま固まらないよう戻す。
      this.transiting = false;
      return;
    }

    this.transiting = true;
    const curtain = new Curtain(this, this.layout.fieldArea);
    curtain.darken(0);
    this.revealWhenLocationArtLoaded(curtain);
  }

  private buildFieldArea(layout: PlayScreenLayout): void {
    this.fieldPanel = addPanel(this, layout.fieldArea, COLOR.fieldArea).setDepth(FIELD_DEPTH);
    const [fixtures, items, hand] = layout.lanes;

    const art = this.view.locationArt;

    this.fixtureLane = new CardLane(
      this,
      this.metrics,
      fixtures,
      COLOR.fixtureLane,
      // 設置物は持ち出せないので、手持ちへ送る端の操作は付けない（並び替えのドラッグだけ）。
      this.laneCards(this.view.fixtures),
      {
        pinned: {
          ...this.view.currentLocation,
          onTap: this.whileIdle(() => this.openExplorationWindow()),
        },
        art: laneTexture('fixture', art),
        depth: FIELD_DEPTH,
      },
    );
    this.itemLane = new CardLane(this, this.metrics, items, COLOR.itemLane, this.laneCards(this.view.items), {
      // 前詰めのレーンなので、末尾に受け皿の空枠を出す（中身が空でも落とせると分かるように）。
      emptyCells: emptyCellsFor(
        this.view.items.length,
        this.view.cellCountOf('items'),
        this.view.acceptsCards('items'),
      ),
      art: laneTexture('item', art),
      depth: FIELD_DEPTH,
    });
    this.handLane = new CardLane(this, this.metrics, hand, COLOR.handLane, this.laneCards(this.view.hand), {
      art: HAND_LANE_TEXTURE,
      depth: FIELD_DEPTH,
    });

    // 陽炎はフィールドエリアの3レーンすべてに立てる（LaneHaze参照）。
    this.haze ??= new LaneHaze(this);
    this.haze.setSurfaces([
      this.fixtureLane.hazeSurface,
      this.itemLane.hazeSurface,
      this.handLane.hazeSurface,
    ]);
    this.haze.setHaze(heatHazeFor(this.view.ambientTemperature));

    // ドラッグの受け口はシーンに1つだけ置く（作り直しのたびに増やさない、CardDragController参照）。
    this.drag ??= new CardDragController(this, () => this.metrics, {
      describeDrop: (drop) => this.describeDrop(drop),
      onDrop: (drop, released) => this.applyDrop(drop, released),
    });
    this.setDragLanes();
  }

  /**
   * フィールドエリアだけを作り直す。移動で現在地が変わると、レーンの中身だけでなく現在地カードも
   * 背景の絵も総取り替えになるので、差し替え（showView）では追いつかない。
   *
   * 他のエリアは現在地に依らないため触らない（時計とステータスの反映はshowInformationが行う）。
   */
  /** 今の空を画面へ映し直す（ScreenLayout.md 空の演出節）。 */
  private showSky(): void {
    this.weatherOverlay.setWeather(this.view.weather);
    this.skyTint.setSunlight(this.view.sunlight);
  }

  private rebuildFieldArea(): void {
    this.motion.release();
    this.fieldPanel.destroy();
    for (const lane of [this.fixtureLane, this.itemLane, this.handLane]) lane.destroy();
    this.buildFieldArea(this.layout);
  }

  /** ドラッグの対象になるレーン。設置物レーンも含める——持ち出せはしないが、同じレーンの中でなら並び替えられるため。 */
  private setDragLanes(): void {
    this.drag?.setLanes(this.lanesFrontFirst);
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
  private laneCards(cards: readonly (ObjectCardStack | undefined)[]): readonly (CardContent | undefined)[] {
    return cards.map((card) => {
      if (card === undefined) return undefined;
      return {
        ...card,
        draggable: true,
        onTap: this.whileIdle(() => this.openObjectWindow(card)),
        edges: this.cardEdges(card),
        // 経過を見せている間は行動の途中の値。状態バーは減った分の帯を縮めずに溜める（statusContentと同じ）。
        midAction: this.passingTime,
      };
    });
  }

  /**
   * そのカードが出す端の操作。**そこへ移せるカードだけが矢印を出す**ので、置ける設置物（設置もできる
   * かご）を足せば、画面を直さずに設置物レーンとアイテムレーンの間を行き来できるようになる。
   */
  private cardEdges(card: ObjectCardStack): readonly CardEdgeAction[] {
    const edges: CardEdgeAction[] = [];
    for (const direction of EDGE_DIRECTIONS) {
      const move = this.edgeMove(card, direction);
      if (move !== undefined) edges.push({ direction, onTap: () => this.applyToWorld(move) });
    }
    return edges;
  }

  /** 端を押したときの移動（その向きへ移せないならundefined）。行き先は「空いている場所」なので位置は指定しない。 */
  private edgeMove(card: ObjectCardStack, direction: CardEdgeDirection): (() => void) | undefined {
    for (const place of this.edgeTargets(card.place, direction)) {
      const move = card.moveTo?.(place);
      if (move !== undefined) return move;
    }
    return undefined;
  }

  /**
   * その向きの行き先の候補を、近い順に。フィールドの並びの上下関係（設置物→アイテム→手持ち）
   * そのままで、子ウィンドウのカードの下は手持ち。
   *
   * 手持ちの上は、子ウィンドウを開いている間だけそちらを先に見る——カードをやり取りする相手が
   * 画面に出ているなら、端を押す操作もその相手を指すのが自然なため。受け取れない相手（怪我）なら
   * 元どおりアイテムへ落ちる。開いているだけで手持ちの端が使えなくなるのは不便なため。
   */
  private edgeTargets(from: CardPlace, direction: CardEdgeDirection): readonly CardPlace[] {
    if (direction === 'up') {
      if (from === 'items') return ['fixtures'];
      if (from !== 'hand') return [];
      return this.childWindowPlace === undefined ? ['items'] : [this.childWindowPlace, 'items'];
    }
    if (from === 'fixtures') return ['items'];
    if (from === 'items') return ['hand'];
    // 手持ちの下は無く、子ウィンドウのカード（装備・怪我・コンテナの中身）の下は手持ち。
    return from === 'hand' ? [] : ['hand'];
  }

  /**
   * ドロップで起きること（何も起きないならundefined）。カードに重ねたらcombination、隙間・空き枠へ
   * 落としたら位置を変える。同じレーンの中ならスタックごとの並び替え、レーンをまたぐならカード1枚の移動。
   */
  private dropAction(drop: CardDrop): (() => void) | undefined {
    if (drop.target.kind === 'combine') return this.combinationAt(drop)?.execute;

    const dragged = this.cardsOf(drop.from)[drop.fromIndex];
    if (dragged === undefined) return undefined;
    return drop.to === drop.from
      ? dragged.reorder?.(drop.target)
      : dragged.moveTo?.(this.placeOf(drop.to), drop.target);
  }

  /** カードに重ねたときに実行できるcombination（重ねる操作でなければundefined）。 */
  private combinationAt(drop: CardDrop): CardCombination | undefined {
    if (drop.target.kind !== 'combine') return undefined;

    const dragged = this.cardsOf(drop.from)[drop.fromIndex];
    const target = this.cardsOf(drop.to)[drop.target.index];
    if (dragged === undefined || target === undefined) return undefined;
    return this.view.combinationOf(dragged, target);
  }

  /**
   * そのドロップで何が起きるか（何も起きないならundefined）。combinationは名前と説明を返し、
   * ドラッグ中の吹き出しになる。位置を変えるだけの移動には説明が要らないので中身は空。
   */
  private describeDrop(drop: CardDrop): CardDropInfo | undefined {
    const combination = this.combinationAt(drop);
    if (combination !== undefined) {
      return {
        tooltip: {
          title: combination.name,
          body: combination.description,
          note: durationText(combination.minutes),
        },
      };
    }
    return this.dropAction(drop) === undefined ? undefined : {};
  }

  private cardsOf(lane: CardLane): readonly (ObjectCardStack | undefined)[] {
    if (lane === this.handLane) return this.view.hand;
    if (lane === this.itemLane) return this.view.items;
    if (lane === this.fixtureLane) return this.view.fixtures;
    return this.childWindowCards();
  }

  /** レーンが映している場所。 */
  private placeOf(lane: CardLane): CardPlace {
    if (lane === this.handLane) return 'hand';
    if (lane === this.itemLane) return 'items';
    if (lane === this.fixtureLane) return 'fixtures';
    return this.childWindowPlace ?? 'items';
  }

  private childWindowCards(): readonly ObjectCardStack[] {
    return this.childWindowPlace === undefined ? [] : this.view.cardsIn(this.childWindowPlace);
  }

  /** 今カードが並んでいるレーン。中身を映す子ウィンドウを開いている間は、その中身も並びの一部。 */
  private get openLanes(): readonly CardLane[] {
    const lanes = [this.fixtureLane, this.itemLane, this.handLane];
    const window = this.childWindow?.lane;
    if (window !== undefined) lanes.push(window);
    return lanes;
  }

  /**
   * ドロップ先を探す順。**画面で手前に重なっているものから**渡す。
   *
   * ドロップ先の判定は重なりを見ず「最初に当たったレーン」で決まる（CardDragController.dropAt）。
   * 子ウィンドウはフィールドのレーンを覆っているので、openLanesの順（末尾）のまま渡すと、
   * 覆われている側が先に当たり、**ウィンドウの中のカードへは落とせない**。
   *
   * openLanes自体は並べ替えられない——差し替えの中身と位置で対応付けている（showView）。
   */
  private get lanesFrontFirst(): readonly CardLane[] {
    const front = this.childWindow?.lane;
    const lanes = this.openLanes;
    return front === undefined ? lanes : [front, ...lanes.filter((lane) => lane !== front)];
  }

  /**
   * そのカードが今出ている画面上の矩形（どのレーンにも出ていなければundefined）。カードの同定は
   * CardMotionと同じくインスタンスのIDで行う——スタックの代表が入れ替わっても同じカードとみなせるため。
   */
  private rectOf(card: ObjectCardStack): Rect | undefined {
    const ids = new Set(card.identity ?? []);
    for (const lane of this.openLanes) {
      const index = lane.cardObjects.findIndex(
        (object) => object?.content.identity?.some((id) => ids.has(id)) === true,
      );
      if (index >= 0) return lane.slotRect(index);
    }
    return undefined;
  }

  /**
   * ドロップは、重ねた相手のカードを新しいカードの出どころとして扱う（combinationの成果物が出る位置）。
   * 掴んでいたカードは手を離した場所に居るので、そこから動き出す（releasedは分身が居た矩形）。
   */
  private applyDrop(drop: CardDrop, released: Rect): void {
    const action = this.dropAction(drop);
    if (action === undefined) return;

    const dragged = this.combinationAt(drop)?.source ?? this.cardsOf(drop.from)[drop.fromIndex]?.objects[0];
    this.applyToWorld(action, {
      origin: drop.target.kind === 'combine' ? drop.to.slotRect(drop.target.index) : undefined,
      released: dragged === undefined ? undefined : { id: dragged.instanceId, rect: released },
    });
  }

  /**
   * 装備・怪我のボタンから開く、場所そのものの子ウィンドウ。映す対象が1つに定まらないので
   * カードは持たず、見出しと中身の並びだけを出す。
   */
  private openSlotWindow(place: CardPlace): void {
    this.childWindowCard = undefined;
    // 場所を開くときも映しているオブジェクトはある——その持ち主（キャラクタ）。
    this.openChildWindow(
      {
        card: { ...characterCardContent(this.view.characterArt, this.locale), name: this.view.characterName },
      },
      [],
      place,
    );
  }

  /**
   * カードを押すと開く子ウィンドウ。そのカードで実行できるアクション（ActionSystem.md 1節）を
   * ボタンとして並べ、中身のスロットを持つカード（コンテナ・怪我）ならその並びも一緒に出す。
   *
   * アクションを実行するとワールドが変わり、このカードが消えることも別の場所へ移ることもあるため、
   * 押した時点でウィンドウを閉じる。
   *
   * アクションで生まれたものは、このカードを出どころとして飛ばす（ヤシの木から採った実は木から手元へ）。
   * 矩形を引くのはウィンドウを開いた時点ではなく押した時点——その間にレーンを送られていることがあるため。
   */
  private openObjectWindow(card: ObjectCardStack): void {
    this.childWindowCard = card;
    this.openChildWindow(
      { card, description: card.description },
      [...this.autoFillAction(card), ...this.windowActions(card)],
      card.contents,
    );
  }

  /**
   * 製作中オブジェクトの子ウィンドウに出す「自動補充」。**ボタン行の左端**に置く。
   *
   * 枠ごとに何をいくつ入れるかの判断はYAMLの語彙で書けないため、プログラム側で行う
   * （autoFillMaterials）。持たないカードでは空を返す。
   */
  private autoFillAction(card: ObjectCardStack): ObjectWindowAction[] {
    const target = card.objects[0];
    if (target === undefined || this.codex.productOf(target.def) === undefined) return [];

    return [
      {
        label: '自動補充',
        description: '手持ちと足元から、足りない素材を入れる。入れ物の中までは探さない。',
        minutes: 0,
        onTap: () => {
          const player = this.gameSession.player.instance;
          const location = this.gameSession.player.location;
          autoFillMaterials(
            target,
            this.codex.slotNames.getId(MATERIALS_SLOT),
            [
              player.tryGetSlot(this.codex.slotNames.getId('hand'))?.contents ?? [],
              location?.instance.tryGetSlot(this.codex.slotNames.getId('items'))?.contents ?? [],
            ],
            this.codex,
          );
          this.closeChildWindow();
          this.view = fromGameSession(this.gameSession, this.codex, this.locale);
          this.showView();
        },
      },
    ];
  }

  /** カードのアクションを、子ウィンドウのボタンの形へ直す。 */
  private windowActions(card: ObjectCardStack): ObjectWindowAction[] {
    return card.actions.map((action) => ({
      label: action.name,
      description: action.description,
      minutes: action.minutes,
      enabled: action.enabled,
      reason: action.reason,
      onTap: () => {
        // 矩形を引くのは押した時点——開いてから押すまでにレーンを送られていることがあるため。
        const origin = this.rectOf(card);
        this.closeChildWindow();
        this.applyToWorld(action.execute, { origin });
      },
    }));
  }

  /**
   * 子ウィンドウを開く。同時に開けるのは1つだけで、別のものを開くと入れ替わる（中身を映している間は
   * 手持ちの端が指す先が1つに定まらなくなるため）。
   */
  private openChildWindow(
    object: ObjectWindowTarget,
    actions: readonly ObjectWindowAction[],
    place: CardPlace | undefined,
  ): void {
    this.childWindow?.close();
    this.childWindowPlace = place;

    this.childWindow = new ObjectWindow(this, this.metrics, {
      object,
      slot:
        place === undefined
          ? undefined
          : {
              title: this.view.nameOf(place),
              cards: this.laneCards(this.childWindowCards()),
              acceptsCards: this.view.acceptsCards(place),
              cellCount: this.view.cellCountOf(place),
            },
      actions,
      area: this.layout.slotWindowArea,
      onClose: () => this.closeChildWindow(),
    });
    this.setDragLanes();
    // 手持ちの端が指す先が変わるため、手持ちの並びを作り直す（laneCards・neighbourOf参照）。
    this.refreshHandLane();
  }

  private closeChildWindow(): void {
    this.childWindow?.close();
    this.childWindow = undefined;
    this.childWindowCard = undefined;
    this.childWindowPlace = undefined;
    this.setDragLanes();
    this.refreshHandLane();
  }

  /** 手持ちのカードに付いている操作だけを引き直す（並びは変わらないので動きは出ない）。 */
  private refreshHandLane(): void {
    this.handLane.setCards(this.laneCards(this.view.hand));
  }

  /** 現在地のロケーションカードから開く探索の子ウィンドウ。 */
  private openExplorationWindow(): void {
    this.explorationWindow?.close();
    this.explorationWindow = new ExplorationWindow(this, this.metrics, {
      locationName: this.view.currentLocation.name,
      ratio: this.view.explorationRatio,
      area: this.layout.fieldArea,
      found: this.found,
      searching: this.searching,
      onExplore: () => this.explore(),
      onClose: () => {
        this.explorationWindow = undefined;
      },
    });
  }

  /**
   * 現在地を1回探索する。
   *
   * 探索はゲーム内時間を消費するアクションなので、その分だけ実時間をかけて進める。ワールド自体は
   * 先に変えてしまい、時計だけを実時間で動かして、結果（見つかったカード・探索率）は経過し切って
   * から見せる。押した瞬間に発見物の枠が空へ戻り、時間が経ってから埋まる。
   */
  private explore(): void {
    if (this.searching || this.busy) return;

    const shownBefore = this.shownInstanceIds();
    const statusesBefore = this.allStatuses();
    const startedAt = this.gameSession.world.totalMinutes;

    this.searching = true;
    this.found = [];
    this.openExplorationWindow();

    const recorded = this.record(() => this.gameSession.player.explore(this.gameSession.session));
    // 道が見つかっていたら、経過を見せている間に行き先の絵のロードを始める。
    this.requestLocationArt();
    this.passTime(startedAt, this.gameSession.world.totalMinutes, recorded, () => {
      this.searching = false;
      this.view = fromGameSession(this.gameSession, this.codex, this.locale);
      this.noteStatusChanges(statusesBefore, startedAt);
      this.found = this.foundSince(shownBefore);
      this.showView({ origin: this.fixtureLane.pinnedRect });
    });
  }

  /** 今フィールドとロケーションのレーンに出ているインスタンスのID。 */
  private shownInstanceIds(): ReadonlySet<number> {
    const shown = [...this.view.fixtures, ...this.view.items];
    return new Set(shown.flatMap((card) => card.identity ?? []));
  }

  /** 控えておいた「出ていたもの」に無いカード＝この探索で見つかったもの（アイテムと道）。 */
  private foundSince(shownBefore: ReadonlySet<number>): readonly CardContent[] {
    const shown = [...this.view.fixtures, ...this.view.items];
    return shown.filter((card) => card.identity?.some((id) => !shownBefore.has(id)) === true).map(cardFace);
  }

  /**
   * ワールドを変える操作を実行し、経過中の各tick時点の表示内容を控えて返す（RecordedView）。
   *
   * ワールドはこの中で進み切る。経過中のtickは物を腐らせたり道具を壊したりするので、その変化が
   * 「45分の行動の15分目に起きた」と分かるよう、tickごとの表示内容を控えて実時間で再生する（passTime）。
   *
   * 経過し切った時刻の控えは返さない。その瞬間の並びは、行動の効果まで含めてonElapsedが見せるため。
   */
  private record(change: () => void): readonly RecordedView[] {
    const statusesBefore = this.allStatuses();
    const recorded: RecordedView[] = [];

    this.gameSession.session.observeTicks(() => {
      // 控えたviewをあとから表示するので、呼んだ時点のワールドを読むcardsInは今の答えに固定する。
      const view = withFrozenCards(
        fromGameSession(this.gameSession, this.codex, this.locale),
        this.childWindowPlace,
      );
      recorded.push({
        minutes: this.gameSession.world.totalMinutes,
        view,
        statusChanges: statusChangesBetween(statusesBefore, this.allStatuses(view)),
      });
    }, change);

    const endedAt = this.gameSession.world.totalMinutes;
    return recorded.filter((snapshot) => snapshot.minutes < endedAt);
  }

  /**
   * fromMinutesからtoMinutesまで、ゲーム内時間の経過をREAL_MS_PER_GAME_MINUTEの速さで時計と
   * ドーナツグラフへ映し、経過し切ったらonElapsedを呼ぶ。時間を消費しない操作なら待たずにそのまま進む。
   *
   * 時計もドーナツグラフもtick境界で刻む（TickProgress参照）。時計はグラフが目盛りへ届いた瞬間に
   * その時刻へ飛ぶので、両者が食い違って見えない。recordedの控えも同じ刻みで見せる——控えた時刻は
   * tick境界そのものなので、目盛りに届いた瞬間がその変化が起きた瞬間になる。
   *
   * 経過を見せている間はpassingTimeを立て、ワールドを変える操作を止める。
   */
  private passTime(
    fromMinutes: number,
    toMinutes: number,
    recorded: readonly RecordedView[],
    onElapsed: () => void,
  ): void {
    const minutes = toMinutes - fromMinutes;
    if (minutes <= 0) {
      onElapsed();
      return;
    }

    this.passingTime = true;
    const progress = new TickProgress(fromMinutes, toMinutes, this.gameSession.world.minutesPerTick);
    const ring = new ProgressRing(
      this,
      this.metrics,
      this.layout.fieldArea.x + this.layout.fieldArea.width / 2,
      this.layout.fieldArea.y + this.layout.fieldArea.height / 2,
    ).setDepth(RING_DEPTH);

    const clock = { minutes: fromMinutes };
    let replayed = 0;
    this.tweens.add({
      targets: clock,
      minutes: toMinutes,
      duration: minutes * REAL_MS_PER_GAME_MINUTE,
      ease: 'Linear',
      onUpdate: () => {
        const elapsed = clock.minutes - fromMinutes;
        const stepped = fromMinutes + progress.steppedMinutesAt(elapsed);
        this.showClock(stepped);
        ring.setRatio(progress.ratioAt(elapsed));
        while (replayed < recorded.length && recorded[replayed].minutes <= stepped) {
          this.showRecorded(recorded[replayed]);
          replayed += 1;
        }
      },
      onComplete: () => {
        ring.destroy();
        this.passingTime = false;
        onElapsed();
      },
    });
  }

  /**
   * 控えておいた時点の表示内容へ切り替える。差し替えの動き（出現・破棄）は普段と同じ経路で出るので、
   * 経過中に壊れた道具はその瞬間に消える。
   *
   * 掴んで離したカードの出どころ（MotionContext.released）は渡さない。それは経過し切ったときに
   * 見せる動きで（道具は使い終わってから手元へ戻る、ScreenLayout.md）、途中で消費してはならない。
   */
  private showRecorded(recorded: RecordedView): void {
    this.view = recorded.view;
    this.statusChanges = recorded.statusChanges;
    this.showView();
  }

  /** 前の土地に紐づいていたものを手放す。移動先へ持ち越すと、そこには無いものを見せてしまうため。 */
  private leaveLocation(): void {
    this.found = [];
    // 探索の子ウィンドウは前の土地の探索率・発見物を映しているため、開き直さずに閉じる。
    this.explorationWindow?.close();
    this.explorationWindow = undefined;
    // 置いてきた入れ物の中身は開いたままにできない。手に持っている入れ物も、開き直せば済むので一律に閉じる。
    if (this.childWindowPlace !== undefined && typeof this.childWindowPlace !== 'string') {
      this.closeChildWindow();
    }
  }

  /** 経過分を日数・時刻へ直して時計に出す。画面を作り直した直後はまだ時計が無いことがある。 */
  private showClock(totalMinutes: number): void {
    if (this.situation.scene === undefined) return;

    const whole = Math.trunc(totalMinutes);
    this.situation.setTime(
      Math.trunc(whole / MINUTES_PER_DAY),
      Math.trunc((whole % MINUTES_PER_DAY) / 60),
      whole % 60,
    );
  }

  /**
   * ワールドを変える操作を実行し、その結果を画面へ反映する。originは新しく生まれたカードの出どころ。
   *
   * その操作がゲーム内時間を消費した場合（durationを持つcombination等）は、探索と同じく経過分だけ
   * 実時間をかけてから結果を見せる。時間を消費しない操作は待たずにそのまま反映される（passTime参照）。
   *
   * 移動を伴う操作かどうかはワールドを変えた時点で分かる（画面へ反映するのはその後なので、経過前の
   * 状態が出たまま）。そのため、場面転換の暗転を時間経過と並行して進められる（transit参照）。
   */
  private applyToWorld(change: () => void, context: MotionContext = {}): void {
    if (this.busy) return;

    // 掴んで離したカードは、経過し切るまで離した場所に置いたままにする（使っている道具はそこに在る）。
    if (context.released !== undefined) this.motion.hold(this.openLanes, context.released);

    const startedAt = this.gameSession.world.totalMinutes;
    const locationBefore = this.gameSession.player.location?.instance;
    const statusesBefore = this.allStatuses();
    const recorded = this.record(change);

    const moved = this.gameSession.player.location?.instance !== locationBefore;
    // 移動先・見つかった道の行き先の絵のロードを、経過を見せている間（暗転中）に始める。
    this.requestLocationArt();
    const elapsedMs = (this.gameSession.world.totalMinutes - startedAt) * REAL_MS_PER_GAME_MINUTE;
    const curtain = moved ? new Curtain(this, this.layout.fieldArea) : undefined;
    // 作り直すのは経過し切ってからなので、暗転はそれまでに終わっていなければならない。
    curtain?.darken(Math.min(DARKEN_MS, elapsedMs));

    this.passTime(startedAt, this.gameSession.world.totalMinutes, recorded, () => {
      this.view = fromGameSession(this.gameSession, this.codex, this.locale);
      // 増減はステータスへ反映する前に控える（showInformationがこれを見て記号を出す）。
      this.noteStatusChanges(statusesBefore, startedAt);
      if (curtain !== undefined) {
        this.transit(curtain);
        return;
      }
      this.showView(context);
    });
  }

  /**
   * 暗くなり切ったフィールドエリアを移動先のものへ作り直し、明転する。
   *
   * 明転し切るまでは演出中のままにして、ワールドを変える操作を止める（busy）。作り直した並びが
   * まだ見えていないため、そこへの操作を受け付けると見えているものと食い違う。
   */
  private transit(curtain: Curtain): void {
    this.transiting = true;
    this.leaveLocation();
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
    this.artWait += 1;
    const wait = this.artWait;
    this.artLoader.onceLoaded(this.view.locationArt, () => {
      if (wait !== this.artWait) return;
      this.rebuildFieldArea();
      this.showSky();
      this.haze?.setHaze(heatHazeFor(this.view.ambientTemperature));
      this.showInformation();
      curtain.brighten(BRIGHTEN_MS, () => {
        this.transiting = false;
      });
    });
  }

  /**
   * 今のthis.viewを画面へ反映する。カードは作り直さずに差し替え、動いた分をアニメーションで
   * 見せる（CardMotion）。
   */
  private showView(context: MotionContext = {}): void {
    // 開いている子ウィンドウの中身も同じ差し替えに乗せる（openLanes）。手持ちとの間でカードが行き来する
    // ため、外していると出ていったカードがウィンドウ側に現れない。
    const contents: (readonly (CardContent | undefined)[])[] = [
      this.laneCards(this.view.fixtures),
      this.laneCards(this.view.items),
      this.laneCards(this.view.hand),
    ];
    if (this.childWindow?.lane !== undefined) contents.push(this.laneCards(this.childWindowCards()));

    this.motion.update(this.openLanes, contents, context);
    this.showSky();
    this.haze?.setHaze(heatHazeFor(this.view.ambientTemperature));
    this.showInformation();
    if (this.explorationWindow !== undefined) this.openExplorationWindow();
  }

  /**
   * 情報エリアの表示を今のthis.viewへ合わせる。日時とステータスだけを引き直す——天候・条件・装備の
   * アイコンはまだ固定値（PlayScreenView参照）で、行動しても変わらないため。
   */
  private showInformation(): void {
    this.situation.setTime(this.view.elapsedDays, this.view.hour, this.view.minute);
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
    addPanel(this, area, COLOR.informationPaper);

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
      // ページも背景板と同じく入力を遮る（addPanel参照）。コンテナは当たり判定の形を持たないので渡す。
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, along, across), Phaser.Geom.Rectangle.Contains);
    if (landscape) page.setPosition(area.x, area.y);
    // 原点(0,0)を軸に90度回すと、絵は右下方向ではなく左下方向へ広がる。右上の角を起点に置く。
    else page.setAngle(90).setPosition(area.x + area.width, area.y);

    // 縦長すぎる縦型でオプションバーの上に出る余りを、ページのはみ出しごと画面外として塗り潰す。
    // オプションバーはこの後に置くので、その帯にかぶるぶんは塗り直される。
    const outside = landscape ? 0 : layout.optionsBar.y;
    if (outside > 0) {
      addPanel(this, { x: 0, y: 0, width: this.metrics.width, height: outside }, COLOR.outsideScreen);
    }
  }

  /**
   * 情報エリアの中を仕切る区切り線。背景が1枚の紙になり、エリアごとの塗り分けが無くなったため、
   * 意味のまとまり（キャラクター／ステータス）の境目だけを線で示す。見た目は現在地カードの右の
   * 区切り線と同じ（CardLane.addPinnedSlot）。
   *
   * 状況エリアとの境目には引かない。空のパネルが自分の縁を持っていて、それが境目を兼ねるため。
   */
  private buildInformationDividers(layout: PlayScreenLayout): void {
    const thickness = this.metrics.px(4);
    const padding = this.metrics.px(STATUS_PADDING);

    if (this.metrics.isLandscape) {
      // 横型はキャラクター表示エリアとステータスエリアが上下に並ぶので、境目も横向き。
      const x = layout.informationContent.x + padding;
      this.addDivider({
        x,
        y: layout.statusArea.y - thickness / 2,
        width: Math.max(0, layout.informationContent.width - padding * 2),
        height: thickness,
      });
      return;
    }

    this.addDivider({
      x: layout.statusArea.x - thickness / 2,
      y: layout.statusArea.y + padding,
      width: thickness,
      height: Math.max(0, layout.statusArea.height - padding * 2),
    });
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
    this.buildStatusArea(layout.statusArea);
    this.buildSituationArea(layout.situationArea);
    this.buildInformationDividers(layout);
  }

  /**
   * ポートレイトカードと、地図・装備・怪我のボタン、条件のアイコン（ScreenLayout.md）。
   *
   * ボタンはポートレイトの**右へ縦積み**する。このエリアで最も背の高いポートレイト（320u）の
   * 高さをボタンが使い切るので、下へ積むより1つあたりを大きく取れる。縦型・横型で同じ組み方に
   * なるため、向きによる分岐も要らない。
   */
  private buildCharacterDisplay(area: Rect): void {
    const padding = this.metrics.px(DISPLAY_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const portraitWidth = this.metrics.px(SIZE.cardWidth);
    const portraitHeight = this.metrics.px(SIZE.cardHeight);
    // 名乗っている名前で見せる点だけが、キャラクタ選択やセーブスロットの札と違う。
    new Card(this, this.metrics, area.x + padding, area.y + padding, {
      ...characterCardContent(this.view.characterArt, this.locale),
      name: this.view.characterName,
      onTap: this.whileIdle(() => this.openPropertyWindow()),
    });

    const columnX = area.x + padding + portraitWidth + gap;
    // 状況アイコンはポートレイトの下だけに置き、ボタンの列はその行の下端まで伸ばす。
    // こうすると同じ大きさのボタンが4つ入る（ScreenLayout.md）。
    const conditionSize = this.metrics.px(SIZE.conditionButton);
    this.addSlotButtonColumn({
      x: columnX,
      y: area.y + padding,
      width: area.x + area.width - padding - columnX,
      height: portraitHeight + gap + conditionSize,
    });

    this.addConditionRow(area.x + padding, area.y + padding + portraitHeight + gap);
  }

  /**
   * 条件はラベルなしのアイコンボタン。ポートレイトの真下に1行で左詰めに並べる——キャラクターの
   * 状態なので、カードの下に続けて置くと持ち主が読み取れる。
   */
  private addConditionRow(x: number, y: number): void {
    const size = this.metrics.px(SIZE.conditionButton);
    const gap = this.metrics.px(8);
    this.view.conditions.forEach((icon, index) => {
      const button = new Button(
        this,
        { x: x + index * (size + gap), y, width: size, height: size },
        {
          fill: COLOR.button,
          border: COLOR.buttonBorder,
          borderWidth: Math.max(1, this.metrics.px(2)),
          radius: this.metrics.px(SIZE.radius),
        },
      );
      button.addContent(addLabel(this, this.metrics, size / 2, size / 2, icon, { size: 28 }).setOrigin(0.5));
    });
  }

  /**
   * 地図・装備・怪我の3ボタンを、渡した列の高さを均等に分けて縦に並べる。
   *
   * 並びは持ち物の近さの順。地図と装備は身につけているもの、装備と怪我は開く子ウィンドウの形が
   * 同じで、地図が最も押す頻度が低いので端に来る。
   */
  private addSlotButtonColumn(column: Rect): void {
    const gap = this.metrics.px(SIZE.gap);
    const buttons = [
      {
        art: 'map',
        icon: MAP_ICON,
        fill: COLOR.mapButton,
        onTap: () => this.openMapWindow(),
      },
      {
        art: 'equipment',
        icon: this.view.equipmentIcon,
        fill: COLOR.equipmentButton,
        onTap: () => this.openSlotWindow('equipment'),
      },
      {
        art: 'injury',
        icon: this.view.injuryIcon,
        fill: COLOR.injuryButton,
        onTap: () => this.openSlotWindow('injuries'),
      },
      {
        art: 'recipe',
        // 下のフィルターバーが道具の絞り込みに🔨を使っているので、道具の絵は避ける。
        icon: '📜',
        fill: COLOR.button,
        onTap: () => this.openRecipeWindow(),
      },
    ] as const;
    // 列の高さを3等分せず、内容量ぶんに留める。余った高さは列の中で上下に分ける。
    const width = Math.min(this.metrics.px(SIZE.slotButton.width), column.width);
    const height = this.metrics.px(SIZE.slotButton.height);
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
   * 地図・装備・怪我のボタン。**絵を中央に1つ置くだけで、文字は載せない**（ScreenLayout.md）。
   *
   * 3つとも役割が固定なので、絵だけで区別が付く。文字を持たなければ、言語ごとに変わる文字数を
   * ボタンの内側へ収める必要も無い（日時のフリップカードと同じ考え方）。
   */
  private addSlotButton(
    rect: Rect,
    spec: { art: IconName; icon: string; fill: number; onTap: () => void },
    index: number,
  ): void {
    const radius = this.metrics.px(SIZE.radius);
    const borderWidth = Math.max(1, this.metrics.px(2));
    const button = new Button(this, rect, {
      fill: spec.fill,
      border: COLOR.buttonBorder,
      borderWidth,
      radius,
    });
    button.addContent(
      ...this.slotButtonPaper(rect, index, radius, borderWidth),
      this.slotButtonIcon(spec, rect),
    );
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

    // ボタンごとに別の1枚を敷く。同じ絵だと3つに同じ染みが並び、模様として目に付く。
    const sheet = this.textures.get(SLOT_BUTTON_PAPER_TEXTURE);
    const paper = this.add
      .image(0, 0, SLOT_BUTTON_PAPER_TEXTURE, index % sheet.frameTotal)
      .setOrigin(0, 0)
      .setDisplaySize(rect.width, rect.height);

    const frame = this.add.graphics();
    frame.lineStyle(borderWidth, COLOR.buttonBorder, 1);
    frame.strokeRoundedRect(0, 0, rect.width, rect.height, radius);
    return [paper, frame];
  }

  /**
   * 絵があればそれを、無ければ絵文字を、ボタンの中央へ置く（iconArt参照）。
   *
   * **どの絵も同じ大きさで敷く。** 3枚とも同じ寸法のキャンバスに、物だけが実物の大小——開いた地図 >
   * Tシャツ > 巻いた包帯——のとおり描き分けてある（card_art.pyの--canvas）。UIが物の大きさを測って
   * 揃えると、その差が消えてしまう。周りは透けているので、ボタンの地の色が下に出る。
   */
  private slotButtonIcon(spec: { art: IconName; icon: string }, rect: Rect): Phaser.GameObjects.GameObject {
    const x = rect.width / 2;
    const y = rect.height / 2;
    const canvas = SIZE.slotButtonIcon;
    const texture = iconTexture(spec.art);
    if (texture !== undefined && this.textures.exists(texture)) {
      return this.add
        .image(x, y, texture)
        .setOrigin(0.5)
        .setDisplaySize(this.metrics.px(canvas.width), this.metrics.px(canvas.height));
    }
    // 絵文字は正方形なので、キャンバスの高さがそのまま大きさになる。
    return addLabel(this, this.metrics, x, y, spec.icon, { size: canvas.height }).setOrigin(0.5);
  }

  /**
   * バーは上端に揃える。表示件数が変わっても位置が動かないようにするため（ScreenLayout.md）。
   *
   * 出す行は行動のたびに変わる（安全域のステータスは出さない）が、バーはここで全プロパティ分を作って
   * おき、以後は見せ方と位置だけを変える。あとから作ると、開いている子ウィンドウの覆いより手前へ
   * 出てしまうため（CardMotion参照）。
   */
  private buildStatusArea(area: Rect): void {
    const padding = this.metrics.px(STATUS_PADDING);
    this.statusRowsX = area.x + padding;
    this.statusRowsY = area.y + padding;
    this.statusRowsWidth = area.width - padding * 2;
    this.statusRowGap = this.metrics.px(this.metrics.isLandscape ? 10 : 16);

    // 致命的域を伝える画面全体の枠。飛んでいるカードや子ウィンドウにも隠されないよう最前面へ出す。
    this.alertFrame = new ScreenAlertFrame(this, this.metrics).setDepth(ALERT_FRAME_DEPTH);

    const bars = new Map<string, StatusBar>();
    for (const status of this.statusContents(this.allStatuses())) {
      const bar = new StatusBar(
        this,
        this.metrics,
        this.statusRowsX,
        this.statusRowsY,
        this.statusRowsWidth,
        status,
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
    const rows = statusRows(this.statusContents(this.view.statuses), this.statusContents(this.allEntries()));
    const rowHeight = StatusBar.height(this.metrics);

    const shown = new Set<string>();
    rows.forEach((row, index) => {
      const bar = this.statusBars.get(row.key);
      if (bar === undefined) return;
      shown.add(row.key);
      bar.show(this.statusRowsY + index * (rowHeight + this.statusRowGap), row);
    });
    for (const [key, bar] of this.statusBars) if (!shown.has(key)) bar.hide();

    this.alertFrame.setAlerting(rows.some((row) => row.alert === 'fatal'));
  }

  /**
   * ステータスエリアに出しうるプロパティ（ステータスと、プロパティウィンドウに出るもの全部）を
   * 重複なく。固定表示にすればどれもステータスエリアへ出るため、バーの用意と増減の比較はこの範囲で行う。
   *
   * viewを渡せば、今出ているものではなくそのviewの分を返す（時間経過の再現で控えた時点の増減を出す、
   * record参照）。
   */
  private allStatuses(view: PlayScreenView = this.view): readonly StatusContent[] {
    const all = new Map<string, StatusContent>();
    for (const status of [...view.statuses, ...this.allEntries(view)])
      if (!all.has(status.key)) all.set(status.key, status);
    return [...all.values()];
  }

  /** プロパティウィンドウの全タブの行（同じプロパティが複数のタブに現れうる）。 */
  private allEntries(view: PlayScreenView = this.view): readonly StatusContent[] {
    return view.propertyCategories.flatMap((tab) => tab.entries);
  }

  private statusContents(statuses: readonly StatusContent[]): readonly StatusContent[] {
    return statuses.map((status) => this.statusContent(status));
  }

  /** バーに渡す1件分。直前の行動での増減と、固定表示の状態・トグルを添える。 */
  private statusContent(status: StatusContent): StatusContent {
    const delta = this.statusChanges.get(status.key);
    return {
      ...status,
      change: delta?.change,
      ratioBefore: delta?.ratioBefore,
      // 経過を見せている間は行動の途中の値。バーは減った分の帯を縮めずに溜める（ProgressBar.setRatio）。
      midAction: this.passingTime,
      pinned: this.pinnedStatuses.has(status.key),
      onTogglePin: () => this.togglePinnedStatus(status.key),
    };
  }

  /**
   * ステータス名をタップしたときの固定表示の切り替え。固定表示にしたステータスは、安全域でも
   * ステータスエリアの先頭に出続ける（ScreenLayout.md ステータスエリア節）。
   */
  private togglePinnedStatus(key: string): void {
    if (!this.pinnedStatuses.delete(key)) this.pinnedStatuses.add(key);
    this.savePinnedStatuses();
    this.showStatuses();
    // プロパティウィンドウを開いたまま切り替えられるため、そちらの印も引き直す。
    this.propertyWindow?.setTabs(this.propertyTabs());
  }

  /**
   * 固定表示をセーブデータへ書き戻す（SaveDataManagement.md セーブデータのスキーマ節）。
   * スロットを使わないシナリオからの起動では、そのプレイの間だけ残る。
   */
  private savePinnedStatuses(): void {
    this.save = { ...this.save, pinnedStatuses: [...this.pinnedStatuses] };
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

  /** プロパティウィンドウに渡すタブ（行に固定表示の状態とトグルを添える）。 */
  private propertyTabs(): readonly PropertyTab[] {
    return this.view.propertyCategories.map((tab) => ({
      name: tab.name,
      entries: this.statusContents(tab.entries),
    }));
  }

  /**
   * 行動の前後でステータスを比べ、増減を控える。次の行動まで記号を出し続けるので、移動で
   * フィールドエリアを作り直してもそのまま出る。
   *
   * 時間を消費しない操作では記号を消さない（statusChangesAfter）。
   */
  private noteStatusChanges(before: readonly StatusContent[], startedAt: number): void {
    this.statusChanges = statusChangesAfter(
      this.statusChanges,
      before,
      this.allStatuses(),
      this.gameSession.world.totalMinutes > startedAt,
    );
  }

  /**
   * キャラクターのプロパティをタグごとに見せるウィンドウ（ポートレイトカードのタップで開く）。
   * ステータスエリアに出ていない分も含めて、ここで全部のカテゴリを見られる。
   */
  /** 何を作るかを選ぶ一覧を開く。選ぶと製作中オブジェクトが現在地に生まれる。 */
  private openRecipeWindow(): void {
    this.recipeWindow?.destroy();
    this.recipeWindow = new RecipeWindow(this, this.metrics, {
      title: '作るもの',
      categories: recipeCategories(this.gameSession, this.codex, this.locale, (defGlobalId) => {
        this.closeRecipeWindow();
        this.startCrafting(defGlobalId);
      }),
      emptyText: 'ここに並ぶものはまだ無い。',
      onClose: () => this.closeRecipeWindow(),
    });
  }

  private closeRecipeWindow(): void {
    this.recipeWindow?.destroy();
    this.recipeWindow = undefined;
  }

  /** 製作中オブジェクトを現在地のitemsスロットへ生む。 */
  private startCrafting(inProgressDefGlobalId: number): void {
    const location = this.gameSession.player.location;
    if (location === undefined) return;

    const spawned = this.gameSession.session.spawn(inProgressDefGlobalId);
    spawned.moveToSlot(location.instance, this.codex.slotNames.getId('items'), this.codex.wellKnown);
    this.view = fromGameSession(this.gameSession, this.codex, this.locale);
    this.showView();
  }

  private openPropertyWindow(): void {
    if (this.propertyWindow !== undefined) return;

    this.propertyWindow = new PropertyWindow(this, this.metrics, {
      title: this.view.characterName,
      tabs: this.propertyTabs(),
      area: this.layout.slotWindowArea,
      onClose: () => {
        this.propertyWindow = undefined;
      },
    });
  }

  /** 地図ボタンから開く地図ウィンドウ。既知の土地と発見済みの道を、ユーザが並べた位置で見せる。 */
  private openMapWindow(): void {
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
    this.situation = new WeatherPanel(this, this.metrics, area, {
      weather: this.view.weather,
      weatherLabel: this.view.weatherLabel,
      elapsedDays: this.view.elapsedDays,
      hour: this.view.hour,
      minute: this.view.minute,
    });
  }

  /** 縦型は画面最上部の横長バー（右寄せ）、横型は右サイドバー上段の縦積み。 */
  private buildOptionsBar(area: Rect): void {
    addPanel(this, area, COLOR.optionsBar);

    const size = this.metrics.px(SIZE.iconButton);
    const gap = this.metrics.px(SIZE.barGap);
    const span = OPTION_ICONS.length * size + (OPTION_ICONS.length - 1) * gap;

    OPTION_ICONS.forEach((icon, index) => {
      const rect = this.metrics.isLandscape
        ? {
            x: area.x + (area.width - size) / 2,
            y: area.y + (area.height - span) / 2 + index * (size + gap),
            width: size,
            height: size,
          }
        : {
            x: area.x + area.width - this.metrics.px(OPTIONS_BAR_PADDING_X) - span + index * (size + gap),
            y: area.y + (area.height - size) / 2,
            width: size,
            height: size,
          };
      const button = this.addIconButton(rect, icon, false);
      if (icon === MENU_ICON) button.on('pointerup', () => this.confirmReturnToTitle());
    });
  }

  /** 選択中のタグは背景色を反転させて強調する（ScreenLayout.md フィルターバー節）。 */
  private buildFilterBar(area: Rect): void {
    addPanel(this, area, COLOR.filterBar);

    const size = this.metrics.px(SIZE.iconButton);
    const gap = this.metrics.px(SIZE.barGap);
    const padding = this.metrics.px(BAR_PADDING);

    this.filterButtons = FILTER_ICONS.map((icon, index) => {
      const rect = this.metrics.isLandscape
        ? {
            x: area.x + (area.width - size) / 2,
            y: area.y + padding + index * (size + gap),
            width: size,
            height: size,
          }
        : {
            x: area.x + this.metrics.px(FILTER_BAR_PADDING_X) + index * (size + gap),
            y: area.y + (area.height - size) / 2,
            width: size,
            height: size,
          };
      const button = this.addIconButton(rect, icon, index === this.selectedFilter);
      button.on('pointerup', () => this.selectFilter(index));
      return button;
    });
  }

  private selectFilter(index: number): void {
    this.selectedFilter = index;
    this.filterButtons.forEach((button, i) => {
      button.setBoxStyle(this.iconButtonStyle(i === index));
    });
  }

  private addIconButton(rect: Rect, icon: string, active: boolean): Button {
    const button = new Button(this, rect, this.iconButtonStyle(active));
    button.addContent(
      addLabel(this, this.metrics, rect.width / 2, rect.height / 2, icon, { size: 52 }).setOrigin(0.5),
    );
    return button;
  }

  private iconButtonStyle(active: boolean): BoxStyle {
    return {
      fill: active ? COLOR.buttonActive : COLOR.button,
      border: COLOR.buttonBorder,
      borderWidth: Math.max(1, this.metrics.px(2)),
      radius: this.metrics.px(SIZE.radius),
    };
  }

  private confirmReturnToTitle(): void {
    new ModalDialog(this, this.metrics, {
      title: 'タイトルへ戻りますか？',
      body: 'ここまでの進行はセーブデータに残ります。',
      actions: [
        { label: 'キャンセル' },
        { label: 'タイトルへ', style: 'primary', onTap: () => this.scene.start('title') },
      ],
    });
  }
}

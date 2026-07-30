import type { Rect } from './layout/ScreenMetrics';
import { PlayScreenLayout } from './layout/PlayScreenLayout';
import { ResponsiveScene } from './ResponsiveScene';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { start } from '../domain/generation/NewGame';
import { seededRng } from '../domain/runtime/Rng';
import type { Localization } from '../locale/Localization';
import type { SaveData } from '../save/SaveData';
import { SAVE_SCHEMA_VERSION } from '../save/SaveData';
import type { Scenario } from '../scenario/Scenario';
import { applyScenario } from '../scenario/Scenario';
import type { CardCombination, CardPlace, ObjectCardStack, PlayScreenView } from './PlayScreenView';
import { fromGameSession } from './PlayScreenView';
import { TickProgress } from './tickProgress';
import { Button } from './ui/Button';
import type { CardContent, CardEdgeDirection } from './ui/Card';
import { Card, cardFace } from './ui/Card';
import type { CardDrop, CardDropInfo } from './ui/CardDragController';
import { CardDragController } from './ui/CardDragController';
import { CardLane } from './ui/CardLane';
import { INFORMATION_BACKGROUND, INFORMATION_OVERLAP_PX } from './ui/informationArt';
import { HAND_LANE_TEXTURE, laneTexture } from './ui/laneArt';
import { SEPARATOR_TEXTURE } from './ui/separatorArt';
import type { MotionContext } from './ui/CardMotion';
import { CardMotion } from './ui/CardMotion';
import { ExplorationWindow } from './ui/ExplorationWindow';
import { FlipCalendar } from './ui/FlipCalendar';
import { ModalDialog } from './ui/ModalDialog';
import { ProgressRing } from './ui/ProgressRing';
import { PropertyWindow } from './ui/PropertyWindow';
import { SlotWindow } from './ui/SlotWindow';
import { StatusBar } from './ui/StatusBar';
import { WeatherChip } from './ui/WeatherChip';
import { addLabel } from './ui/labels';
import type { BoxStyle } from './ui/shapes';
import { addPanel, addTiledImage, addTiledImageVertical } from './ui/shapes';
import { COLOR, SIZE } from './ui/theme';

/** オプションバー・フィルターバーの内側パディング（縦型は左右が広め）。 */
const BAR_PADDING = 16;
const OPTIONS_BAR_PADDING_X = 24;
const FILTER_BAR_PADDING_X = 20;

/** キャラクター表示エリア・ステータスエリアの内側パディング。 */
const DISPLAY_PADDING = 16;
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

/** 状況エリア・天候の帯のパディング（縦型は広め、横型は狭め）。 */
const SITUATION_PADDING_PORTRAIT = { x: 32, y: 20 };
const SITUATION_PADDING_LANDSCAPE = { x: 20, y: 12 };

/** メニューだけは押したときの行き先があるため、判別できるよう切り出す。 */
const MENU_ICON = '☰';

const OPTION_ICONS = ['⚙️', '📖', '📓', MENU_ICON];
const FILTER_ICONS = ['🗂️', '🍳', '💧', '🔨', '🎲'];

/** プレイ中の画面を開くときに渡す、対象のセーブデータ。 */
export interface PlaySceneData {
  readonly save: SaveData;
  /** セーブスロットの番号。シナリオからの起動（BootScene）はセーブへ書き戻さないため-1。 */
  readonly slotIndex: number;
  /** テスト用シナリオ。渡すと、シードから作り直した世界へ開始状態を置いてから始める。 */
  readonly scenario?: Scenario;
}

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
      characterId: 'character',
      createdAt: 0,
      elapsedDays: 0,
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
  private calendar!: FlipCalendar;

  /** フィールドエリアの矩形。時間経過のドーナツグラフと探索の子ウィンドウを、この中央に出す。 */
  private fieldArea: Rect = { x: 0, y: 0, width: 0, height: 0 };

  /** ハンドレーンを覆わない子ウィンドウの置き場所（PlayScreenLayout参照）。 */
  private slotWindowArea: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private drag: CardDragController | undefined;

  private selectedFilter = 0;
  private filterButtons: Button[] = [];

  /** 開いている探索の子ウィンドウ。画面の作り直しをまたいで開いたままにするために持つ。 */
  private explorationWindow: ExplorationWindow | undefined;

  /**
   * 開いているスロットの子ウィンドウ（装備・怪我）と、それが映している場所。
   * 開いている間は、この場所が手持ちの「隣」になる（laneCards・cardsOf参照）。
   */
  private slotWindow: SlotWindow | undefined;
  private slotWindowPlace: CardPlace | undefined;

  /** 開いているプロパティウィンドウ。探索の子ウィンドウと同じく、画面の作り直しをまたいで開いたままにする。 */
  private propertyWindow: PropertyWindow | undefined;

  /** 探索の結果待ちか（この間は次の探索を始められない）と、直前の探索で見つかったもの。 */
  private searching = false;
  private found: readonly CardContent[] = [];

  /**
   * 時間の経過を見せている最中か。この間はワールドを変える操作を受け付けない（passTime参照）。
   * 画面にはまだ経過前の状態が出ているため、そこへの操作は既に古い並びを指しているため。
   */
  private passingTime = false;

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
    this.gameSession = start(this.codex, data.save.seed, seededRng(data.save.seed));
    if (data.scenario !== undefined) applyScenario(this.gameSession, data.scenario, this.codex);
    this.view = fromGameSession(this.gameSession, this.codex, this.locale);
  }

  protected build(): void {
    const layout = new PlayScreenLayout(this.metrics);
    // 開いていた子ウィンドウは、画面を作り直したあと同じものを開き直す（表示物は捨てられているため）。
    const wasExploring = this.explorationWindow !== undefined;
    const openedPlace = this.slotWindowPlace;
    const wasShowingProperties = this.propertyWindow !== undefined;
    this.explorationWindow = undefined;
    this.slotWindow = undefined;
    this.slotWindowPlace = undefined;
    this.propertyWindow = undefined;
    this.fieldArea = layout.fieldArea;
    this.slotWindowArea = layout.slotWindowArea;

    // 手前から奥への重なりに合わせて組み立てる。レーンからはみ出したカードは切り抜かず、
    // 後から描く背景板で隠す設計のため、順序そのものに意味がある。
    this.buildFieldArea(layout);
    this.buildFilterBar(layout.filterBar);
    // 横型のオプションバーはフィールドエリアの隣（右サイドバー）なので、フィルターバーと同じく
    // レーンのはみ出しを隠す背景板を兼ねる。縦型は情報エリアの中なので、ページを敷いた後に置く。
    if (this.metrics.isLandscape) this.buildOptionsBar(layout.optionsBar);
    // 区切りの帯は隣接エリアへもかぶるため、それらの背景板を描き終えてから敷く。
    for (const rect of layout.laneSeparators) addTiledImage(this, rect, SEPARATOR_TEXTURE);
    // フィールドエリアと右サイドバーの境目は、同じ絵を90度回して縦向きに敷く（横型のみ）。
    if (layout.sidebarSeparator !== undefined) {
      addTiledImageVertical(this, layout.sidebarSeparator, SEPARATOR_TEXTURE);
    }
    // 情報エリアのページはフィールドエリアへ食い込むので、帯より後（＝手前）に置く。
    this.buildInformationArea(layout);
    this.buildDashboard(layout);
    if (!this.metrics.isLandscape) this.buildOptionsBar(layout.optionsBar);
    // オプションバーと情報エリアの境目の帯は、バーの上に重ねるので最後に敷く（縦型のみ）。
    if (layout.optionsBarSeparator !== undefined) {
      addTiledImage(this, layout.optionsBarSeparator, SEPARATOR_TEXTURE);
    }
    if (wasExploring) this.openExplorationWindow();
    if (openedPlace !== undefined) this.openSlotWindow(openedPlace);
    if (wasShowingProperties) this.openPropertyWindow();
  }

  private buildFieldArea(layout: PlayScreenLayout): void {
    addPanel(this, layout.fieldArea, COLOR.fieldArea);
    const [fixtures, items, hand] = layout.lanes;

    const art = this.view.locationArt;

    this.fixtureLane = new CardLane(
      this,
      this.metrics,
      fixtures,
      COLOR.fixtureLane,
      // 設置物は持ち出せないので、手持ちへ送る端の操作は付けない（並び替えのドラッグだけ）。
      this.laneCards(this.view.fixtures, undefined),
      {
        pinned: { ...this.view.currentLocation, onTap: () => this.openExplorationWindow() },
        art: laneTexture('fixture', art),
      },
    );
    this.itemLane = new CardLane(
      this,
      this.metrics,
      items,
      COLOR.itemLane,
      this.laneCards(this.view.items, 'down'),
      {
        // 前詰めのレーンなので、末尾に受け皿の空枠を出す（中身が空でも落とせると分かるように）。
        trailingPlaceholder: this.view.acceptsCards('items'),
        art: laneTexture('item', art),
      },
    );
    this.handLane = new CardLane(
      this,
      this.metrics,
      hand,
      COLOR.handLane,
      this.laneCards(this.view.hand, 'up'),
      { art: HAND_LANE_TEXTURE },
    );
    this.motion = new CardMotion(this, this.metrics);

    // ドラッグの受け口はシーンに1つだけ置く（作り直しのたびに増やさない、CardDragController参照）。
    this.drag ??= new CardDragController(this, () => this.metrics, {
      describeDrop: (drop) => this.describeDrop(drop),
      onDrop: (drop, released) => this.applyDrop(drop, released),
    });
    this.setDragLanes();
  }

  /** ドラッグの対象になるレーン。スロットの子ウィンドウを開いている間は、その中身も対象に加える。 */
  private setDragLanes(): void {
    // 設置物レーンも対象に含める。持ち出せはしないが、同じレーンの中でなら並び替えられるため。
    const lanes = [this.fixtureLane, this.itemLane, this.handLane];
    if (this.slotWindow !== undefined) lanes.push(this.slotWindow.lane);
    this.drag?.setLanes(lanes);
  }

  /**
   * アイテムのカードに、隣の場所への操作（端を押しての移動と、掴んでのドラッグ）を付ける。
   * 端の向きは並びの上下関係を表す: フィールドは下端（▼）が手持ち、手持ちは上端（▲）が上の場所。
   *
   * 手持ちの上端が指す先は、スロットの子ウィンドウを開いている間だけそちらへ切り替わる。カードを
   * やり取りする相手が画面に出ているなら、端を押す操作もその相手を指すのが自然なため。
   *
   * 移せない設置物・怪我にもドラッグは付ける。他のカードへ重ねるcombinationのドラッグ元にはなれるため。
   *
   * コンテナのカードは、押すと中身の子ウィンドウが開く。端の操作エリアは中央より手前に居るので、
   * 端を押しての移動とは競合しない（Card参照）。
   */
  private laneCards(
    cards: readonly (ObjectCardStack | undefined)[],
    direction: CardEdgeDirection | undefined,
  ): readonly (CardContent | undefined)[] {
    return cards.map((card) => {
      if (card === undefined) return undefined;
      const move = direction === undefined ? undefined : this.edgeMove(card);
      const contents = card.contents;
      return {
        ...card,
        draggable: true,
        onTap: contents === undefined ? undefined : () => this.openSlotWindow(contents),
        edge:
          move === undefined || direction === undefined
            ? undefined
            : { direction, onTap: () => this.applyToWorld(move) },
      };
    });
  }

  /**
   * 端を押したときの移動（移せないカードならundefined）。行き先は「空いている場所」なので位置は指定しない。
   *
   * 手持ちの行き先は、子ウィンドウが開いていればそちらを優先する。ただし受け取れない場所（怪我）なら
   * 元どおりフィールドへ戻す——開いているだけで手持ちの端が使えなくなるのは不便なため。
   */
  private edgeMove(card: ObjectCardStack): (() => void) | undefined {
    if (card.place === 'hand' && this.slotWindowPlace !== undefined) {
      const intoWindow = card.moveTo?.(this.slotWindowPlace);
      if (intoWindow !== undefined) return intoWindow;
    }
    return card.moveTo?.(card.place === 'hand' ? 'items' : 'hand');
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
      return { tooltip: { title: combination.name, body: combination.description } };
    }
    return this.dropAction(drop) === undefined ? undefined : {};
  }

  private cardsOf(lane: CardLane): readonly (ObjectCardStack | undefined)[] {
    if (lane === this.handLane) return this.view.hand;
    if (lane === this.itemLane) return this.view.items;
    if (lane === this.fixtureLane) return this.view.fixtures;
    return this.slotWindowCards();
  }

  /** レーンが映している場所。 */
  private placeOf(lane: CardLane): CardPlace {
    if (lane === this.handLane) return 'hand';
    if (lane === this.itemLane) return 'items';
    if (lane === this.fixtureLane) return 'fixtures';
    return this.slotWindowPlace ?? 'items';
  }

  private slotWindowCards(): readonly ObjectCardStack[] {
    return this.slotWindowPlace === undefined ? [] : this.view.cardsIn(this.slotWindowPlace);
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
   * 装備・怪我のボタンから開くスロットの子ウィンドウ。同時に開けるのは1つだけで、別の場所を開くと
   * 入れ替わる（手持ちの端が指す先が1つに定まらなくなるため）。
   */
  private openSlotWindow(place: CardPlace): void {
    this.slotWindow?.close();
    this.slotWindowPlace = place;
    this.slotWindow = new SlotWindow(this, this.metrics, {
      title: this.view.nameOf(place),
      cards: this.laneCards(this.slotWindowCards(), 'down'),
      area: this.slotWindowArea,
      acceptsCards: this.view.acceptsCards(place),
      onClose: () => this.closeSlotWindow(),
    });
    this.setDragLanes();
    // 手持ちの端が指す先が変わるため、手持ちの並びを作り直す（laneCards・neighbourOf参照）。
    this.refreshHandLane();
  }

  private closeSlotWindow(): void {
    this.slotWindow?.close();
    this.slotWindow = undefined;
    this.slotWindowPlace = undefined;
    this.setDragLanes();
    this.refreshHandLane();
  }

  /** 手持ちのカードに付いている操作だけを引き直す（並びは変わらないので動きは出ない）。 */
  private refreshHandLane(): void {
    this.handLane.setCards(this.laneCards(this.view.hand, 'up'));
  }

  /** 現在地のロケーションカードから開く探索の子ウィンドウ。 */
  private openExplorationWindow(): void {
    this.explorationWindow?.close();
    this.explorationWindow = new ExplorationWindow(this, this.metrics, {
      locationName: this.view.currentLocation.name,
      ratio: this.view.explorationRatio,
      area: this.fieldArea,
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
    if (this.searching || this.passingTime) return;

    const shownBefore = this.shownInstanceIds();
    const startedAt = this.gameSession.world.totalMinutes;

    this.searching = true;
    this.found = [];
    this.openExplorationWindow();

    this.gameSession.player.explore(this.gameSession.session);
    this.passTime(startedAt, this.gameSession.world.totalMinutes, () => {
      this.searching = false;
      this.view = fromGameSession(this.gameSession, this.codex, this.locale);
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
   * fromMinutesからtoMinutesまで、ゲーム内時間の経過をREAL_MS_PER_GAME_MINUTEの速さで時計と
   * ドーナツグラフへ映し、経過し切ったらonElapsedを呼ぶ。時間を消費しない操作なら待たずにそのまま進む。
   *
   * 時計もドーナツグラフもtick境界で刻む（TickProgress参照）。時計はグラフが目盛りへ届いた瞬間に
   * その時刻へ飛ぶので、両者が食い違って見えない。
   *
   * 経過を見せている間はpassingTimeを立て、ワールドを変える操作を止める。
   */
  private passTime(fromMinutes: number, toMinutes: number, onElapsed: () => void): void {
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
      this.fieldArea.x + this.fieldArea.width / 2,
      this.fieldArea.y + this.fieldArea.height / 2,
    ).setDepth(RING_DEPTH);

    const clock = { minutes: fromMinutes };
    this.tweens.add({
      targets: clock,
      minutes: toMinutes,
      duration: minutes * REAL_MS_PER_GAME_MINUTE,
      ease: 'Linear',
      onUpdate: () => {
        const elapsed = clock.minutes - fromMinutes;
        this.showClock(fromMinutes + progress.steppedMinutesAt(elapsed));
        ring.setRatio(progress.ratioAt(elapsed));
      },
      onComplete: () => {
        ring.destroy();
        this.passingTime = false;
        onElapsed();
      },
    });
  }

  /** 経過分を日数・時刻へ直して時計に出す。画面を作り直した直後はまだ時計が無いことがある。 */
  private showClock(totalMinutes: number): void {
    if (this.calendar.scene === undefined) return;

    const whole = Math.trunc(totalMinutes);
    this.calendar.setTime(
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
   */
  private applyToWorld(change: () => void, context: MotionContext = {}): void {
    if (this.passingTime) return;

    const startedAt = this.gameSession.world.totalMinutes;
    change();
    this.passTime(startedAt, this.gameSession.world.totalMinutes, () => {
      this.view = fromGameSession(this.gameSession, this.codex, this.locale);
      this.showView(context);
    });
  }

  /**
   * 今のthis.viewを画面へ反映する。カードは作り直さずに差し替え、動いた分をアニメーションで
   * 見せる（CardMotion）。
   */
  private showView(context: MotionContext = {}): void {
    const lanes = [this.fixtureLane, this.itemLane, this.handLane];
    const contents: (readonly (CardContent | undefined)[])[] = [
      this.laneCards(this.view.fixtures, undefined),
      this.laneCards(this.view.items, 'down'),
      this.laneCards(this.view.hand, 'up'),
    ];
    // 開いている子ウィンドウの中身も同じ差し替えに乗せる。手持ちとの間でカードが行き来するため、
    // 外していると出ていったカードがウィンドウ側に現れない。
    if (this.slotWindow !== undefined) {
      lanes.push(this.slotWindow.lane);
      contents.push(this.laneCards(this.slotWindowCards(), 'down'));
    }

    this.motion.update(lanes, contents, context);
    this.calendar.setTime(this.view.elapsedDays, this.view.hour, this.view.minute);
    if (this.explorationWindow !== undefined) this.openExplorationWindow();
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

    const page = this.add.image(
      0,
      0,
      landscape ? INFORMATION_BACKGROUND.landscape : INFORMATION_BACKGROUND.portrait,
    );
    const scale = landscape ? area.height / page.height : area.width / page.width;
    const overlap = INFORMATION_OVERLAP_PX * scale;
    page.setScale(scale).setInteractive();
    if (landscape) page.setOrigin(1, 0).setPosition(area.width + overlap, area.y);
    else page.setOrigin(0, 1).setPosition(area.x, area.y + area.height + overlap);

    // 縦長すぎる縦型でオプションバーの上に出る余りを、ページのはみ出しごと画面外として塗り潰す。
    // オプションバーはこの後に置くので、その帯にかぶるぶんは塗り直される。
    const outside = landscape ? 0 : layout.optionsBar.y;
    if (outside > 0) {
      addPanel(this, { x: 0, y: 0, width: this.metrics.width, height: outside }, COLOR.outsideScreen);
    }
  }

  /**
   * 情報エリアの中を仕切る区切り線。背景が1枚の紙になり、エリアごとの塗り分けが無くなったため、
   * 意味のまとまり（日時／天候・キャラクター／ステータス）の境目だけを線で示す。
   * 見た目は現在地カードの右の区切り線と同じ（CardLane.addPinnedSlot）。
   */
  private buildInformationDividers(layout: PlayScreenLayout): void {
    const thickness = this.metrics.px(4);
    const content = layout.informationContent;

    if (this.metrics.isLandscape) {
      const padding = this.metrics.px(SITUATION_PADDING_LANDSCAPE.x);
      const x = content.x + padding;
      const width = Math.max(0, content.width - padding * 2);
      for (const y of [layout.situationArea.y + layout.situationArea.height, layout.statusArea.y]) {
        this.addDivider({ x, y: y - thickness / 2, width, height: thickness });
      }
      return;
    }

    const padding = this.metrics.px(SITUATION_PADDING_PORTRAIT.x);
    // 日時・天候の上。
    this.addDivider({
      x: content.x + padding,
      y: layout.situationArea.y - thickness / 2,
      width: Math.max(0, content.width - padding * 2),
      height: thickness,
    });
    // ステータスエリアの左（キャラクター表示エリアとの境目）。
    const verticalPadding = this.metrics.px(STATUS_PADDING);
    this.addDivider({
      x: layout.statusArea.x - thickness / 2,
      y: layout.statusArea.y + verticalPadding,
      width: thickness,
      height: Math.max(0, layout.statusArea.height - verticalPadding * 2),
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
    this.buildSituationArea(layout.situationArea, layout.weatherRow === undefined);
    if (layout.weatherRow !== undefined) this.buildWeatherRow(layout.weatherRow);
    this.buildInformationDividers(layout);
  }

  /**
   * ポートレイトカードと条件・装備・怪我のボタン群。ポートレイトの方が背が高いので必ず余白が出るが、
   * ボタン群同士が離れて浮いて見えないよう、余白はポートレイト上部（頭部側）へ集約する
   * （ScreenLayout.md 設計原則）。
   */
  private buildCharacterDisplay(area: Rect): void {
    const padding = this.metrics.px(DISPLAY_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const portraitWidth = this.metrics.px(SIZE.cardWidth);
    const portraitHeight = this.metrics.px(SIZE.cardHeight);
    const portraitBottom = area.y + padding + portraitHeight;
    new Card(this, this.metrics, area.x + padding, area.y + padding, {
      icon: '🧍',
      art: this.view.characterArt,
      name: this.view.characterName,
      onTap: () => this.openPropertyWindow(),
    });

    const infoX = area.x + padding + portraitWidth + gap;
    const infoWidth = area.x + area.width - padding - infoX;
    const conditionSize = this.metrics.px(SIZE.conditionButton);
    const conditionGap = this.metrics.px(8);
    const buttonHeight = this.metrics.px(SIZE.iconButton);

    if (this.metrics.isLandscape) {
      // 横型: 条件の行・装備・怪我を右の縦列に上から並べ、列の下端をポートレイトの下端へ揃える。
      const columnHeight = conditionSize + gap + buttonHeight + gap + buttonHeight;
      let cursorY = portraitBottom - columnHeight;
      this.addConditionRow(
        infoX,
        cursorY,
        conditionSize,
        conditionGap,
        Math.max(1, this.view.conditions.length),
      );
      cursorY += conditionSize + gap;
      this.addEquipmentButton(
        { x: infoX, y: cursorY, width: infoWidth, height: buttonHeight },
        '装備',
        this.view.equipmentIcon,
        COLOR.equipmentButton,
        'equipment',
      );
      cursorY += buttonHeight + gap;
      this.addEquipmentButton(
        { x: infoX, y: cursorY, width: infoWidth, height: buttonHeight },
        '怪我',
        this.view.injuryIcon,
        COLOR.injuryButton,
        'injuries',
      );
      return;
    }

    // 縦型: 上段は「ポートレイト｜条件（2列で折り返し）」、下段は両列にまたがる装備・怪我の行。
    const conditionColumns = 2;
    const conditionRows = Math.ceil(this.view.conditions.length / conditionColumns);
    const conditionBlockWidth = conditionColumns * conditionSize + (conditionColumns - 1) * conditionGap;
    const conditionBlockHeight = conditionRows * conditionSize + (conditionRows - 1) * conditionGap;
    this.addConditionRow(
      infoX + (infoWidth - conditionBlockWidth) / 2,
      portraitBottom - conditionBlockHeight,
      conditionSize,
      conditionGap,
      conditionColumns,
    );

    const rowY = portraitBottom + gap;
    const rowWidth = area.width - padding * 2;
    const halfWidth = (rowWidth - gap) / 2;
    this.addEquipmentButton(
      { x: area.x + padding, y: rowY, width: halfWidth, height: buttonHeight },
      '装備',
      this.view.equipmentIcon,
      COLOR.equipmentButton,
      'equipment',
    );
    this.addEquipmentButton(
      { x: area.x + padding + halfWidth + gap, y: rowY, width: halfWidth, height: buttonHeight },
      '怪我',
      this.view.injuryIcon,
      COLOR.injuryButton,
      'injuries',
    );
  }

  /** 条件はラベルなしのアイコンボタン。columnsごとに折り返す。 */
  private addConditionRow(x: number, y: number, size: number, gap: number, columns: number): void {
    this.view.conditions.forEach((icon, index) => {
      const column = index % columns;
      const row = Math.trunc(index / columns);
      const button = new Button(
        this,
        { x: x + column * (size + gap), y: y + row * (size + gap), width: size, height: size },
        {
          fill: COLOR.button,
          border: COLOR.buttonBorder,
          borderWidth: Math.max(1, this.metrics.px(2)),
          radius: this.metrics.px(SIZE.radius),
        },
      );
      button.addContent(addLabel(this, this.metrics, size / 2, size / 2, icon, { size: 36 }).setOrigin(0.5));
    });
  }

  /**
   * 装備・怪我はアイコンの右に種別の固定ラベルを置いた横長ボタン（アイテム名は出さない）。
   * 押すと、そのスロットの中身を並べる子ウィンドウが開く（openSlotWindow）。
   */
  private addEquipmentButton(rect: Rect, label: string, icon: string, fill: number, place: CardPlace): void {
    const button = new Button(this, rect, {
      fill,
      border: COLOR.buttonBorder,
      borderWidth: Math.max(1, this.metrics.px(2)),
      radius: this.metrics.px(SIZE.radius),
    });
    const left = this.metrics.px(18);
    const iconText = addLabel(this, this.metrics, left, rect.height / 2, icon, { size: 44 }).setOrigin(
      0,
      0.5,
    );
    button.addContent(
      iconText,
      addLabel(
        this,
        this.metrics,
        left + iconText.width + this.metrics.px(SIZE.gap),
        rect.height / 2,
        label,
        { size: 24, bold: true },
      ).setOrigin(0, 0.5),
    );
    button.on('pointerup', () => this.openSlotWindow(place));
  }

  /** バーは上端に揃える。表示件数が変わっても位置が動かないようにするため（ScreenLayout.md）。 */
  private buildStatusArea(area: Rect): void {
    const padding = this.metrics.px(STATUS_PADDING);
    const gap = this.metrics.px(this.metrics.isLandscape ? 10 : 16);
    const barHeight = StatusBar.height(this.metrics);
    this.view.statuses.forEach((status, index) => {
      new StatusBar(
        this,
        this.metrics,
        area.x + padding,
        area.y + padding + index * (barHeight + gap),
        area.width - padding * 2,
        status,
      );
    });
  }

  /**
   * キャラクターのプロパティをタグごとに見せるウィンドウ（ポートレイトカードのタップで開く）。
   * ステータスエリアに出ていない分も含めて、ここで全部のカテゴリを見られる。
   */
  private openPropertyWindow(): void {
    if (this.propertyWindow !== undefined) return;

    this.propertyWindow = new PropertyWindow(this, this.metrics, {
      title: this.view.characterName,
      tabs: this.view.propertyCategories,
      area: this.slotWindowArea,
      onClose: () => {
        this.propertyWindow = undefined;
      },
    });
  }

  private buildSituationArea(area: Rect, withWeather: boolean): void {
    const padding = this.metrics.isLandscape ? SITUATION_PADDING_LANDSCAPE : SITUATION_PADDING_PORTRAIT;
    const calendar = new FlipCalendar(
      this,
      this.metrics,
      area.x + this.metrics.px(padding.x),
      area.y + this.metrics.px(padding.y),
      this.view.elapsedDays,
      this.view.hour,
      this.view.minute,
    );
    this.calendar = calendar;

    if (!withWeather) return;

    const chip = new WeatherChip(this, this.metrics, 0, 0, this.view.weather);
    chip.setPosition(
      Math.max(
        calendar.x + calendar.contentWidth + this.metrics.px(24),
        area.x + area.width - this.metrics.px(padding.x) - chip.contentWidth,
      ),
      // エリアではなく日時の帯に対して上下中央へ揃える（下パディングが広いため、エリア中央だと下へずれる）。
      calendar.y + (FlipCalendar.height(this.metrics) - WeatherChip.height(this.metrics)) / 2,
    );
  }

  private buildWeatherRow(area: Rect): void {
    new WeatherChip(
      this,
      this.metrics,
      area.x + this.metrics.px(SITUATION_PADDING_LANDSCAPE.x),
      area.y + this.metrics.px(SITUATION_PADDING_LANDSCAPE.y),
      this.view.weather,
    );
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

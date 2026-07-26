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
import type { ItemCard, PlayScreenView } from './PlayScreenView';
import { fromGameSession } from './PlayScreenView';
import { tickSteppedRatio } from './tickSteppedRatio';
import { Button } from './ui/Button';
import type { CardContent, CardEdgeDirection } from './ui/Card';
import { Card } from './ui/Card';
import type { CardDrop } from './ui/CardDragController';
import { CardDragController } from './ui/CardDragController';
import { CardLane } from './ui/CardLane';
import { CardMotion } from './ui/CardMotion';
import { ExplorationWindow } from './ui/ExplorationWindow';
import { FlipCalendar } from './ui/FlipCalendar';
import { ModalDialog } from './ui/ModalDialog';
import { ProgressRing } from './ui/ProgressRing';
import { StatusBar } from './ui/StatusBar';
import { WeatherChip } from './ui/WeatherChip';
import { addLabel } from './ui/labels';
import type { BoxStyle } from './ui/shapes';
import { addPanel } from './ui/shapes';
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
  readonly slotIndex: number;
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
  private locationLane!: CardLane;
  private fieldItemLane!: CardLane;
  private handLane!: CardLane;
  private motion!: CardMotion;
  private calendar!: FlipCalendar;

  /** フィールドエリアの矩形（時間経過のドーナツグラフはこの中央に出す）と、探索の子ウィンドウの幅。 */
  private fieldArea: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private windowWidth = 0;

  private drag: CardDragController | undefined;

  private selectedFilter = 0;
  private filterButtons: Button[] = [];

  /** 開いている探索の子ウィンドウ。画面の作り直しをまたいで開いたままにするために持つ。 */
  private explorationWindow: ExplorationWindow | undefined;

  /** 探索の結果待ちか（この間は次の探索を始められない）と、直前の探索で見つかったもの。 */
  private searching = false;
  private found: readonly CardContent[] = [];

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
    this.view = fromGameSession(this.gameSession, this.codex, this.locale);
  }

  protected build(): void {
    const layout = new PlayScreenLayout(this.metrics);
    const wasExploring = this.explorationWindow !== undefined;
    this.explorationWindow = undefined;
    this.fieldArea = layout.fieldArea;
    this.windowWidth = layout.fieldArea.width;

    this.buildFieldArea(layout);
    this.buildDashboard(layout);
    this.buildOptionsBar(layout.optionsBar);
    this.buildFilterBar(layout.filterBar);
    if (wasExploring) this.openExplorationWindow();
  }

  private buildFieldArea(layout: PlayScreenLayout): void {
    addPanel(this, layout.fieldArea, COLOR.fieldArea);
    const [location, fieldItems, hand] = layout.lanes;

    this.locationLane = new CardLane(
      this,
      this.metrics,
      location,
      COLOR.locationLane,
      this.view.destinations,
      { ...this.view.currentLocation, onTap: () => this.openExplorationWindow() },
    );
    this.fieldItemLane = new CardLane(
      this,
      this.metrics,
      fieldItems,
      COLOR.fieldItemLane,
      this.laneCards(this.view.fieldItems, 'down'),
    );
    this.handLane = new CardLane(
      this,
      this.metrics,
      hand,
      COLOR.handLane,
      this.laneCards(this.view.hand, 'up'),
    );
    this.motion = new CardMotion(this);

    // ドラッグの受け口はシーンに1つだけ置く（作り直しのたびに増やさない、CardDragController参照）。
    this.drag ??= new CardDragController(this, () => this.metrics, {
      canDrop: (drop) => this.dropAction(drop) !== undefined,
      onDrop: (drop) => this.applyDrop(drop),
    });
    this.drag.setLanes([this.fieldItemLane, this.handLane]);
  }

  /**
   * アイテムのカードに、レーン間の操作（端を押しての移動と、掴んでのドラッグ）を付ける。ハンドレーンは
   * フィールドアイテムレーンの下にあるので、フィールド側は下端（▼）、手持ち側は上端（▲）が移動先を指す。
   *
   * 移せない設置物にもドラッグは付ける。他のカードへ重ねるcombinationのドラッグ元にはなれるため。
   */
  private laneCards(
    cards: readonly (ItemCard | undefined)[],
    direction: CardEdgeDirection,
  ): readonly (CardContent | undefined)[] {
    return cards.map((card) => {
      if (card === undefined) return undefined;
      const move = card.move;
      return {
        ...card,
        draggable: true,
        edge: move === undefined ? undefined : { direction, onTap: () => this.applyToWorld(move) },
      };
    });
  }

  /**
   * ドロップで起きること（何も起きないならundefined）。カードに重ねたらcombination、隙間へ落としたら
   * 位置を変える。同じレーンの中ならスタックごとの並び替え、レーンをまたぐならカード1枚の移動。
   */
  private dropAction(drop: CardDrop): (() => void) | undefined {
    const dragged = this.cardsOf(drop.from)[drop.fromIndex];
    if (dragged === undefined) return undefined;

    if (drop.target.kind === 'combine') {
      const target = this.cardsOf(drop.to)[drop.target.index];
      if (target === undefined || target === dragged) return undefined;
      return this.view.combinationOf(dragged, target);
    }

    const { gapIndex } = drop.target;
    if (drop.to === drop.from) {
      const reorder = dragged.reorder;
      return reorder === undefined ? undefined : () => reorder(gapIndex);
    }

    const move = dragged.move;
    if (move === undefined) return undefined;

    // 手持ちは枠の位置が固定なので落とした隙間へ入れる。フィールド側は並び順を持たない。
    return () => move(drop.to === this.handLane ? gapIndex : undefined);
  }

  private cardsOf(lane: CardLane): readonly (ItemCard | undefined)[] {
    return lane === this.handLane ? this.view.hand : this.view.fieldItems;
  }

  /** ドロップは、重ねた相手のカードを新しいカードの出どころとして扱う（combinationの成果物が出る位置）。 */
  private applyDrop(drop: CardDrop): void {
    const action = this.dropAction(drop);
    if (action === undefined) return;

    const origin = drop.target.kind === 'combine' ? drop.to.slotRect(drop.target.index) : undefined;
    this.applyToWorld(action, origin);
  }

  /** 現在地のロケーションカードから開く探索の子ウィンドウ。 */
  private openExplorationWindow(): void {
    this.explorationWindow?.close();
    this.explorationWindow = new ExplorationWindow(this, this.metrics, {
      locationName: this.view.currentLocation.name,
      ratio: this.view.explorationRatio,
      width: this.windowWidth,
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
    if (this.searching) return;

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
      this.showView(this.locationLane.pinnedRect);
    });
  }

  /** 今フィールドとロケーションのレーンに出ているインスタンスのID。 */
  private shownInstanceIds(): ReadonlySet<number> {
    const shown = [...this.view.fieldItems, ...this.view.destinations];
    return new Set(shown.flatMap((card) => card.identity ?? []));
  }

  /** 控えておいた「出ていたもの」に無いカード＝この探索で見つかったもの（アイテムと道）。 */
  private foundSince(shownBefore: ReadonlySet<number>): readonly CardContent[] {
    const shown = [...this.view.fieldItems, ...this.view.destinations];
    return shown
      .filter((card) => card.identity?.some((id) => !shownBefore.has(id)) === true)
      .map(({ icon, name }) => ({ icon, name }));
  }

  /**
   * fromMinutesからtoMinutesまで、ゲーム内時間の経過をREAL_MS_PER_GAME_MINUTEの速さで時計と
   * ドーナツグラフへ映し、経過し切ったらonElapsedを呼ぶ。時間を消費しない操作なら待たずにそのまま進む。
   */
  private passTime(fromMinutes: number, toMinutes: number, onElapsed: () => void): void {
    const minutes = toMinutes - fromMinutes;
    if (minutes <= 0) {
      onElapsed();
      return;
    }

    const ticks = Math.max(1, Math.round(minutes / this.gameSession.world.minutesPerTick));
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
        this.showClock(clock.minutes);
        ring.setRatio(tickSteppedRatio((clock.minutes - fromMinutes) / minutes, ticks));
      },
      onComplete: () => {
        ring.destroy();
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
   */
  private applyToWorld(change: () => void, origin?: Rect): void {
    change();
    this.view = fromGameSession(this.gameSession, this.codex, this.locale);
    this.showView(origin);
  }

  /**
   * 今のthis.viewを画面へ反映する。カードは作り直さずに差し替え、動いた分をアニメーションで
   * 見せる（CardMotion）。
   */
  private showView(origin?: Rect): void {
    this.motion.update(
      [this.locationLane, this.fieldItemLane, this.handLane],
      [
        this.view.destinations,
        this.laneCards(this.view.fieldItems, 'down'),
        this.laneCards(this.view.hand, 'up'),
      ],
      origin,
    );
    this.calendar.setTime(this.view.elapsedDays, this.view.hour, this.view.minute);
    if (this.explorationWindow !== undefined) this.openExplorationWindow();
  }

  private buildDashboard(layout: PlayScreenLayout): void {
    this.buildCharacterDisplay(layout.characterDisplay);
    this.buildStatusArea(layout.statusArea);
    this.buildSituationArea(layout.situationArea, layout.weatherRow === undefined);
    if (layout.weatherRow !== undefined) this.buildWeatherRow(layout.weatherRow);
  }

  /**
   * ポートレイトカードと条件・装備・怪我のボタン群。ポートレイトの方が背が高いので必ず余白が出るが、
   * ボタン群同士が離れて浮いて見えないよう、余白はポートレイト上部（頭部側）へ集約する
   * （ScreenLayout.md 設計原則）。
   */
  private buildCharacterDisplay(area: Rect): void {
    addPanel(this, area, COLOR.characterDisplay);

    const padding = this.metrics.px(DISPLAY_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const portraitWidth = this.metrics.px(SIZE.cardWidth);
    const portraitHeight = this.metrics.px(SIZE.cardHeight);
    const portraitBottom = area.y + padding + portraitHeight;
    new Card(this, this.metrics, area.x + padding, area.y + padding, {
      icon: '🧍',
      name: this.view.characterName,
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
      );
      cursorY += buttonHeight + gap;
      this.addEquipmentButton(
        { x: infoX, y: cursorY, width: infoWidth, height: buttonHeight },
        '怪我',
        this.view.injuryIcon,
        COLOR.injuryButton,
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
    );
    this.addEquipmentButton(
      { x: area.x + padding + halfWidth + gap, y: rowY, width: halfWidth, height: buttonHeight },
      '怪我',
      this.view.injuryIcon,
      COLOR.injuryButton,
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

  /** 装備・怪我はアイコンの右に種別の固定ラベルを置いた横長ボタン（アイテム名は出さない）。 */
  private addEquipmentButton(rect: Rect, label: string, icon: string, fill: number): void {
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
  }

  /** バーは上端に揃える。表示件数が変わっても位置が動かないようにするため（ScreenLayout.md）。 */
  private buildStatusArea(area: Rect): void {
    addPanel(this, area, COLOR.statusArea);

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
        status.name,
        status.ratio,
      );
    });
  }

  private buildSituationArea(area: Rect, withWeather: boolean): void {
    addPanel(this, area, COLOR.situationArea);

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
      area.y + (area.height - WeatherChip.height(this.metrics)) / 2,
    );
  }

  private buildWeatherRow(area: Rect): void {
    addPanel(this, area, COLOR.situationArea);
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

import type { Rect } from './layout/ScreenMetrics';
import { PlayScreenLayout } from './layout/PlayScreenLayout';
import { ResponsiveScene } from './ResponsiveScene';
import { WORLD_CODEX_KEY } from './BootScene';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import { start } from '../domain/generation/NewGame';
import { seededRng } from '../domain/runtime/Rng';
import type { SaveData } from '../save/SaveData';
import type { PlayScreenView } from './PlayScreenView';
import { fromGameSession } from './PlayScreenView';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { CardLane } from './ui/CardLane';
import { FlipCalendar } from './ui/FlipCalendar';
import { ModalDialog } from './ui/ModalDialog';
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
  /** initで必ず設定される（Phaserはinit→createの順に呼ぶ）。 */
  private view!: PlayScreenView;

  private selectedFilter = 0;
  private filterButtons: Button[] = [];

  constructor() {
    super('play');
  }

  /**
   * セーブデータのシードから世界を作り直す。ワールド状態そのものの保存はまだ無いため
   * （SaveDataManagement.md）、新規作成でも既存スロットを開いた場合でも、同じシードから
   * 同じ開始状態を組み立てて表示する。
   */
  init(data: PlaySceneData): void {
    const codex = this.registry.get(WORLD_CODEX_KEY) as WorldCodex;
    this.view = fromGameSession(start(codex, data.save.seed, seededRng(data.save.seed)), codex);
  }

  protected build(): void {
    const layout = new PlayScreenLayout(this.metrics);

    this.buildFieldArea(layout);
    this.buildDashboard(layout);
    this.buildOptionsBar(layout.optionsBar);
    this.buildFilterBar(layout.filterBar);
  }

  private buildFieldArea(layout: PlayScreenLayout): void {
    addPanel(this, layout.fieldArea, COLOR.fieldArea);
    const [locationLane, fieldItemLane, handLane] = layout.lanes;

    new CardLane(
      this,
      this.metrics,
      locationLane,
      COLOR.locationLane,
      this.view.destinations,
      this.view.currentLocation,
    );
    new CardLane(this, this.metrics, fieldItemLane, COLOR.fieldItemLane, this.view.fieldItems);
    new CardLane(this, this.metrics, handLane, COLOR.handLane, this.view.hand);
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
    new Card(this, this.metrics, area.x + padding, area.y + padding, '🧍', this.view.characterName);

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

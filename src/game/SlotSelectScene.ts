import type { Rect } from './layout/ScreenMetrics';
import { ResponsiveScene } from './ResponsiveScene';
import type { SaveData } from '../save/SaveData';
import { SaveSlots, SLOT_COUNT } from '../save/SaveSlots';
import { Button } from './ui/Button';
import { ModalDialog } from './ui/ModalDialog';
import { ScreenHeader } from './ui/ScreenHeader';
import { characterIcon } from './ui/characterArt';
import { addLabel } from './ui/labels';
import { addPanel, drawBox } from './ui/shapes';
import { COLOR, SIZE } from './ui/theme';
import { truncateToWidth } from './ui/textLayout';

/** スロット一覧の外周パディングとカード間ギャップ（StartScreen_Mock.htmlの.slot-grid）。 */
const GRID_PADDING = 20;

/** スロットカードの内側パディングと、ポートレイトの一辺。 */
const SLOT_PADDING = 20;
const PORTRAIT_SIZE = 140;
const DELETE_BUTTON_SIZE = 56;

/**
 * セーブスロット選択画面（StartScreen.md 画面構成 2）。
 * スロットは4固定で、空き判定はセーブ本体の有無だけで行う。
 */
export class SlotSelectScene extends ResponsiveScene {
  constructor() {
    super('slots');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    const slots = new SaveSlots(localStorage).readAll();

    addPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, 'セーブデータを選択', () => this.scene.start('title'));

    const headerHeight = ScreenHeader.height(this.metrics);
    const padding = this.metrics.px(GRID_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    // 縦型は4つ縦積みの1列、横型は2×2グリッド（StartScreen.md 設計原則）。
    const columns = this.metrics.isLandscape ? 2 : 1;
    const rows = SLOT_COUNT / columns;
    const cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
    const cellHeight = (height - headerHeight - padding * 2 - gap * (rows - 1)) / rows;

    slots.forEach((slot, index) => {
      const cell: Rect = {
        x: padding + (index % columns) * (cellWidth + gap),
        y: headerHeight + padding + Math.trunc(index / columns) * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight,
      };
      if (slot === undefined) this.addEmptySlot(cell, index);
      else this.addSavedSlot(cell, index, slot);
    });
  }

  private addSavedSlot(cell: Rect, slotIndex: number, slot: SaveData): void {
    const borderWidth = Math.max(1, this.metrics.px(2));
    const button = new Button(
      this,
      cell,
      {
        fill: COLOR.cardFace,
        border: COLOR.cardBorder,
        borderWidth,
        radius: this.metrics.px(SIZE.radius),
      },
      () => this.scene.start('play', { save: slot, slotIndex }),
    );

    const padding = this.metrics.px(SLOT_PADDING);
    const portraitSize = Math.min(this.metrics.px(PORTRAIT_SIZE), cell.height - padding * 2);
    const portrait = this.add.graphics();
    drawBox(
      portrait,
      { x: padding, y: (cell.height - portraitSize) / 2, width: portraitSize, height: portraitSize },
      {
        fill: COLOR.slotPortrait,
        border: COLOR.cardBorder,
        borderWidth,
        radius: this.metrics.px(SIZE.radius),
      },
    );
    const icon = addLabel(
      this,
      this.metrics,
      padding + portraitSize / 2,
      cell.height / 2,
      characterIcon(slot.characterId),
      { size: 72 },
    ).setOrigin(0.5);

    const infoX = padding + portraitSize + this.metrics.px(SLOT_PADDING);
    const infoWidth = cell.width - infoX - this.metrics.px(DELETE_BUTTON_SIZE + SLOT_PADDING);
    const name = addLabel(this, this.metrics, infoX, cell.height / 2, slot.islandName, {
      size: 32,
      bold: true,
    }).setOrigin(0, 1);
    truncateToWidth(name, infoWidth);
    const days = addLabel(
      this,
      this.metrics,
      infoX,
      cell.height / 2 + this.metrics.px(8),
      `生存 ${slot.elapsedDays} 日目`,
      { size: 24, color: COLOR.textMuted },
    ).setOrigin(0, 0);

    button.addContent(portrait, icon, name, days);
    this.addDeleteButton(cell, slotIndex, slot);
  }

  private addDeleteButton(cell: Rect, slotIndex: number, slot: SaveData): void {
    const size = this.metrics.px(DELETE_BUTTON_SIZE);
    const inset = this.metrics.px(12);
    const button = new Button(
      this,
      { x: cell.x + cell.width - size - inset, y: cell.y + inset, width: size, height: size },
      {
        fill: COLOR.slotDelete,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
      },
      () => this.confirmDelete(slotIndex, slot),
    );
    button.addContent(addLabel(this, this.metrics, size / 2, size / 2, '🗑️', { size: 26 }).setOrigin(0.5));
  }

  private confirmDelete(slotIndex: number, slot: SaveData): void {
    new ModalDialog(this, this.metrics, {
      title: 'セーブデータを削除しますか？',
      body: `「${slot.islandName}」を削除します。この操作は取り消せません。`,
      actions: [
        { label: 'キャンセル' },
        {
          label: '削除する',
          style: 'danger',
          onTap: () => {
            new SaveSlots(localStorage).delete(slotIndex);
            this.scene.restart();
          },
        },
      ],
    });
  }

  private addEmptySlot(cell: Rect, slotIndex: number): void {
    const button = new Button(
      this,
      cell,
      {
        fill: COLOR.cardFace,
        fillAlpha: 0.5,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
        dashed: true,
      },
      () => this.scene.start('newgame', { slotIndex }),
    );

    const iconGap = this.metrics.px(8);
    const icon = addLabel(this, this.metrics, cell.width / 2, cell.height / 2 - iconGap, '＋', {
      size: 56,
      color: COLOR.textMuted,
    }).setOrigin(0.5, 1);
    const label = addLabel(this, this.metrics, cell.width / 2, cell.height / 2 + iconGap, '新規作成', {
      size: 28,
      bold: true,
      color: COLOR.textMuted,
    }).setOrigin(0.5, 0);
    button.addContent(icon, label);
  }
}

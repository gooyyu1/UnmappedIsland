import type { Rect } from '../ui/Rect';
import { ResponsiveScene } from './ResponsiveScene';
import type { SaveData, SavedAssetPack } from '../save/SaveData';
import { SaveSlots, SLOT_COUNT } from '../save/SaveSlots';
import { currentAssetPacks, opensWithAssetPacks } from '../save/savedAssetPacks';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from '../locale/Localization';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { ModalDialog } from './ui/ModalDialog';
import { ScreenHeader } from './ui/ScreenHeader';
import { characterCardContent } from './view/characterCard';
import { addLabel } from '../ui/labels';
import type { BoxStyle } from '../ui/shapes';
import { addInputBlockingPanel } from '../ui/shapes';
import { COLOR, SIZE, rowPlateStyle } from './looks/theme';
import { truncateToWidth } from '../ui/textLayout';

/** スロット一覧の外周パディングとカード間ギャップ（StartScreen_Mock.htmlの.slot-grid）。 */
const GRID_PADDING = 20;

/** スロットカードの内側パディングと、削除ボタンの一辺。 */
const SLOT_PADDING = 20;
const DELETE_BUTTON_SIZE = 56;

/**
 * セーブスロット選択画面（StartScreen.md 画面構成 2）。
 * スロットは4固定で、空き判定はセーブ本体の有無だけで行う。
 */
export class SlotSelectScene extends ResponsiveScene {
  /** いずれもbuildで必ず設定される。 */
  private locale!: Localization;
  private codex!: WorldCodex;

  constructor() {
    super('slots');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    this.locale = this.registry.get(LOCALIZATION_KEY) as Localization;
    this.codex = this.registry.get(WORLD_CODEX_KEY) as WorldCodex;
    const slots = new SaveSlots(localStorage).readAll();
    const installedPacks = currentAssetPacks();

    addInputBlockingPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, this.locale.uiText('slots_title'), () =>
      this.scene.start('title'),
    );

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
      else if (opensWithAssetPacks(slot, installedPacks)) this.addSavedSlot(cell, index, slot);
      else this.addUnopenableSlot(cell, index, slot, installedPacks);
    });
  }

  /** 開けるスロット。押すとそのまま再開する。 */
  private addSavedSlot(cell: Rect, slotIndex: number, slot: SaveData): void {
    this.addSlotPlate(
      cell,
      slotIndex,
      slot,
      rowPlateStyle(this.metrics),
      this.locale.uiText('survived_days', { days: String(slot.elapsedDays) }),
      () => this.scene.start('play', { save: slot, slotIndex }),
    );
  }

  /**
   * アセットパックの並びが食い違うスロット（AssetPack.md 6.4節）。**押しても開かず**、何が違うかを
   * 出すだけ——同じシードでも別の島が出るため。沈んだ色と一行の理由で、押す前に開けないと分かる。
   */
  private addUnopenableSlot(
    cell: Rect,
    slotIndex: number,
    slot: SaveData,
    installedPacks: readonly SavedAssetPack[],
  ): void {
    this.addSlotPlate(
      cell,
      slotIndex,
      slot,
      { ...rowPlateStyle(this.metrics), fillColor: COLOR.buttonDisabled },
      this.locale.uiText('slots_packs_differ'),
      () => this.explainAssetPacks(slot, installedPacks),
    );
  }

  /** スロット1つの行。開けるかどうかで変わるのは、台紙の色・名前の下の一行・押した先だけ。 */
  private addSlotPlate(
    cell: Rect,
    slotIndex: number,
    slot: SaveData,
    style: BoxStyle,
    note: string,
    onTap: () => void,
  ): void {
    const button = new Button(this, cell, style, onTap);

    const padding = this.metrics.px(SLOT_PADDING);
    // 札は行の高さいっぱいに収める（原寸より大きくはしない）。
    const cardScale = Math.min(1, (cell.height - padding * 2) / this.metrics.px(SIZE.cardHeight));
    const cardWidth = this.metrics.px(SIZE.cardWidth) * cardScale;
    const card = new Card(
      this,
      this.metrics,
      padding,
      (cell.height - this.metrics.px(SIZE.cardHeight) * cardScale) / 2,
      characterCardContent(this.codex, slot.characterId, this.locale),
    ).setScale(cardScale);

    const infoX = padding + cardWidth + this.metrics.px(SLOT_PADDING);
    const infoWidth = cell.width - infoX - this.metrics.px(DELETE_BUTTON_SIZE + SLOT_PADDING);
    const name = addLabel(this, this.metrics, infoX, cell.height / 2, slot.islandName, {
      size: 32,
      bold: true,
    }).setOrigin(0, 1);
    truncateToWidth(name, infoWidth);
    const noteLabel = addLabel(this, this.metrics, infoX, cell.height / 2 + this.metrics.px(8), note, {
      size: 24,
      color: COLOR.textMuted,
    }).setOrigin(0, 0);
    truncateToWidth(noteLabel, infoWidth);

    button.addContent(card, name, noteLabel);
    this.addDeleteButton(cell, slotIndex, slot);
  }

  /**
   * 開けない理由を出す。**何が違うかを両方並べる**——設定でアセットパックの読み込みを切り替える
   * 以外に戻す手が無いので、どちらへ揃えればよいかが分からないと直せない。
   */
  private explainAssetPacks(slot: SaveData, installedPacks: readonly SavedAssetPack[]): void {
    new ModalDialog(this, this.metrics, {
      title: this.locale.uiText('slots_packs_title', { island: slot.islandName }),
      // 空行で区切る。理由・食い違い・直し方が続けて流れると、並びの2行が本文に埋もれる。
      body: [
        this.locale.uiText('slots_packs_reason'),
        '',
        this.locale.uiText('slots_packs_saved', { packs: this.packsText(slot.assetPacks) }),
        this.locale.uiText('slots_packs_current', { packs: this.packsText(installedPacks) }),
        '',
        this.locale.uiText('slots_packs_hint'),
      ].join('\n'),
      actions: [{ label: this.locale.uiText('ok'), style: 'primary' }],
    });
  }

  private packsText(packs: readonly SavedAssetPack[]): string {
    if (packs.length === 0) return this.locale.uiText('slots_packs_none');
    return packs
      .map((pack) => this.locale.uiText('slots_packs_entry', { id: pack.id, version: pack.version }))
      .join(this.locale.uiText('list_separator'));
  }

  private addDeleteButton(cell: Rect, slotIndex: number, slot: SaveData): void {
    const size = this.metrics.px(DELETE_BUTTON_SIZE);
    const inset = this.metrics.px(12);
    const button = new Button(
      this,
      { x: cell.x + cell.width - size - inset, y: cell.y + inset, width: size, height: size },
      {
        fillColor: COLOR.slotDelete,
        borderColor: COLOR.cardBorder,
        borderWidth: this.metrics.linePx(2),
        radius: this.metrics.px(SIZE.radius),
      },
      () => this.confirmDelete(slotIndex, slot),
    );
    button.addCentered(addLabel(this, this.metrics, 0, 0, '🗑️', { size: 26 }));
  }

  private confirmDelete(slotIndex: number, slot: SaveData): void {
    new ModalDialog(this, this.metrics, {
      title: this.locale.uiText('slots_delete_title'),
      body: this.locale.uiText('slots_delete_body', { island: slot.islandName }),
      actions: [
        { label: this.locale.uiText('cancel') },
        {
          label: this.locale.uiText('slots_delete_confirm'),
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
      // まだ中身の無い行は、薄く破線で「押せるが空」と見せる。
      { ...rowPlateStyle(this.metrics), fillAlpha: 0.5, dashed: true },
      () => this.scene.start('newgame', { slotIndex }),
    );

    const iconGap = this.metrics.px(8);
    const icon = addLabel(this, this.metrics, cell.width / 2, cell.height / 2 - iconGap, '＋', {
      size: 56,
      color: COLOR.textMuted,
    }).setOrigin(0.5, 1);
    const label = addLabel(
      this,
      this.metrics,
      cell.width / 2,
      cell.height / 2 + iconGap,
      this.locale.uiText('slots_new'),
      {
        size: 28,
        bold: true,
        color: COLOR.textMuted,
      },
    ).setOrigin(0.5, 0);
    button.addContent(icon, label);
  }
}

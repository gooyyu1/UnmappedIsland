import { ResponsiveScene } from './ResponsiveScene';
import { assetPackMatches } from '../asset-pack/install';
import { Settings } from '../save/Settings';
import { Button } from './ui/Button';
import { ScreenHeader } from './ui/ScreenHeader';
import { noteOperation } from './errorReport';
import { addLabel } from '../ui/labels';
import { addPanel, drawBox } from '../ui/shapes';
import { COLOR, rowPlateStyle } from './looks/theme';
import { LIST_ITEM_PADDING_X, LIST_PADDING } from './looks/listScreen';

/** 設定1件ぶんの高さ（外周と左右の余白はlooks/listScreen）。 */
const ITEM_HEIGHT = 120;

/** 入・切のつまみ。行の右端に置く。 */
const SWITCH_WIDTH = 116;
const SWITCH_HEIGHT = 56;

/**
 * 設定画面（StartScreen.md 画面構成 4）。
 *
 * ここに並ぶのは**ゲームを始める前にだけ変えられる設定**。アセットパックは起動時に1回だけ入って
 * 以後不変（AssetPack.md 4節）なので、変えた値はページを読み込み直して初めて効く。
 */
export class SettingsScene extends ResponsiveScene {
  private readonly settings = new Settings(localStorage);

  constructor() {
    super('settings');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    addPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, '設定', () => this.leave());

    const padding = this.metrics.px(LIST_PADDING);
    const itemHeight = this.metrics.px(ITEM_HEIGHT);
    const top = ScreenHeader.height(this.metrics) + padding;

    this.addToggle(
      { x: padding, y: top, width: width - padding * 2, height: itemHeight },
      'アセットパックを読み込む',
      'サンプルパックの定義・絵・表示文字列を、同梱ぶんへ足す。',
      this.settings.loadsAssetPack,
      (value) => {
        this.settings.loadsAssetPack = value;
        this.rebuild();
      },
    );

    // 食い違っている間だけ出す。設定を変えたのに何も起きないまま画面が閉じる、を避ける。
    if (!assetPackMatches(this.settings.loadsAssetPack)) {
      addLabel(this, this.metrics, width / 2, top + itemHeight + padding, '「もどる」で読み込み直します。', {
        size: 22,
        color: COLOR.textMuted,
      }).setOrigin(0.5, 0);
    }
  }

  /**
   * タイトルへ戻る。設定が今入っているものと食い違っていれば、読み込み直して反映する
   * （そのままではこの回のゲームに映らない）。読み込み直した先もタイトル画面になる。
   */
  private leave(): void {
    if (assetPackMatches(this.settings.loadsAssetPack)) this.scene.start('title');
    else location.reload();
  }

  /** 設定1件ぶんの行。行のどこを押しても切り替わる。 */
  private addToggle(
    rect: { x: number; y: number; width: number; height: number },
    title: string,
    detail: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ): void {
    const button = new Button(this, rect, rowPlateStyle(this.metrics), () => {
      noteOperation(`設定を切り替えた: ${title} → ${label(!value)}`);
      onChange(!value);
    });

    const left = this.metrics.px(LIST_ITEM_PADDING_X);
    button.addContent(
      addLabel(this, this.metrics, left, rect.height / 2, title, { size: 30, bold: true }).setOrigin(0, 1),
      addLabel(this, this.metrics, left, rect.height / 2, detail, {
        size: 22,
        color: COLOR.textMuted,
      }).setOrigin(0, 0),
    );

    const switchWidth = this.metrics.px(SWITCH_WIDTH);
    const switchHeight = this.metrics.px(SWITCH_HEIGHT);
    const switchRect = {
      x: rect.width - left - switchWidth,
      y: (rect.height - switchHeight) / 2,
      width: switchWidth,
      height: switchHeight,
    };
    const face = this.add.graphics();
    drawBox(face, switchRect, {
      fill: value ? COLOR.primaryButton : COLOR.buttonDisabled,
      border: COLOR.buttonBorder,
      borderWidth: this.metrics.linePx(2),
      radius: switchHeight / 2,
    });
    button.addContent(
      face,
      addLabel(this, this.metrics, switchRect.x + switchWidth / 2, rect.height / 2, label(value), {
        size: 26,
        bold: true,
        color: value ? COLOR.primaryButtonText : COLOR.textMuted,
      }).setOrigin(0.5),
    );
  }
}

function label(value: boolean): string {
  return value ? 'オン' : 'オフ';
}

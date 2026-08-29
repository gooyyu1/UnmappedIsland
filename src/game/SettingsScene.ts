import { ResponsiveScene } from './ResponsiveScene';
import { assetPackInstallMatchesSetting } from '../asset-pack/install';
import { Settings } from '../save/Settings';
import { Button } from './ui/Button';
import { ScreenHeader } from './ui/ScreenHeader';
import { noteOperation } from './errorReport';
import { addLabel } from '../ui/labels';
import { uiText } from '../locale/uiTexts';
import { addInputBlockingPanel, drawBox } from '../ui/shapes';
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
    addInputBlockingPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, uiText('settings_title'), () => this.returnToTitle());

    const padding = this.metrics.px(LIST_PADDING);
    const itemHeight = this.metrics.px(ITEM_HEIGHT);
    const top = ScreenHeader.height(this.metrics) + padding;

    this.addToggle(
      { x: padding, y: top, width: width - padding * 2, height: itemHeight },
      uiText('settings_asset_pack'),
      uiText('settings_asset_pack_detail'),
      this.settings.loadsAssetPack,
      (value) => {
        this.settings.loadsAssetPack = value;
        this.rebuild();
      },
    );

    // 食い違っている間だけ出す。設定を変えたのに何も起きないまま画面が閉じる、を避ける。
    if (!assetPackInstallMatchesSetting(this.settings.loadsAssetPack)) {
      addLabel(this, this.metrics, width / 2, top + itemHeight + padding, uiText('settings_reload_notice'), {
        size: 22,
        color: COLOR.textMuted,
      }).setOrigin(0.5, 0);
    }
  }

  /**
   * タイトルへ戻る。設定が、この起動が読んだかどうかと食い違っていれば、読み込み直して反映する
   * （そのままではこの回のゲームに映らない）。読み込み直した先もタイトル画面になる。
   */
  private returnToTitle(): void {
    if (assetPackInstallMatchesSetting(this.settings.loadsAssetPack)) this.scene.start('title');
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
      noteOperation(uiText('log_settings_toggled', { title, value: onOffText(!value) }));
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
      fillColor: value ? COLOR.primaryButton : COLOR.buttonDisabled,
      borderColor: COLOR.buttonBorder,
      borderWidth: this.metrics.linePx(2),
      radius: switchHeight / 2,
    });
    button.addContent(
      face,
      addLabel(this, this.metrics, switchRect.x + switchWidth / 2, rect.height / 2, onOffText(value), {
        size: 26,
        bold: true,
        color: value ? COLOR.primaryButtonText : COLOR.textMuted,
      }).setOrigin(0.5),
    );
  }
}

function onOffText(value: boolean): string {
  return uiText(value ? 'settings_on' : 'settings_off');
}

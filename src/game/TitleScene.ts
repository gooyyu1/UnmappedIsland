import { ResponsiveScene } from './ResponsiveScene';
import { scenarioNames } from '../scenario/Scenario';
import { Button } from './ui/Button';
import { addLabel } from './ui/labels';
import { COLOR } from './ui/theme';

/** 「はじめる」「設定」ボタンの寸法（StartScreen_Mock.htmlの.title-button）。 */
const MENU_BUTTON_HEIGHT = 92;
const MENU_BUTTON_GAP = 20;
const MENU_MAX_WIDTH = 560;
const LOGO_MENU_GAP = 56;

/** 空・海・砂浜を思わせる背景の、上側グラデーションが占める割合。 */
const HORIZON_RATIO = 0.55;

/**
 * タイトル画面（StartScreen.md 画面構成 1）。
 * 「はじめる」はセーブの有無によらず常にスロット選択画面を経由する。
 */
export class TitleScene extends ResponsiveScene {
  constructor() {
    super('title');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    this.drawBackground();

    const subLabel = addLabel(this, this.metrics, 0, 0, 'Charting the', {
      size: 26,
      color: COLOR.textOnDark,
    }).setOrigin(0.5, 0);
    const mainLabel = addLabel(this, this.metrics, 0, 0, 'Unmapped Island', {
      size: 60,
      color: COLOR.textOnDark,
      bold: true,
    }).setOrigin(0.5, 0);
    mainLabel.setShadow(0, this.metrics.px(2), 'rgba(0,0,0,0.35)', this.metrics.px(6), false, true);

    // テスト用シナリオは同梱されているときだけ並べる（SaveDataManagement.md「テスト用シナリオ」節）。
    const menu: { label: string; primary: boolean; onTap?: () => void }[] = [
      { label: 'はじめる', primary: true, onTap: () => this.scene.start('slots') },
      { label: '設定', primary: false },
    ];
    if (scenarioNames().length > 0) {
      menu.push({ label: 'テスト用シナリオ', primary: false, onTap: () => this.scene.start('scenarios') });
    }

    const logoGap = this.metrics.px(12);
    const buttonHeight = this.metrics.px(MENU_BUTTON_HEIGHT);
    const buttonGap = this.metrics.px(MENU_BUTTON_GAP);
    const menuHeight = buttonHeight * menu.length + buttonGap * (menu.length - 1);
    const logoHeight = subLabel.height + logoGap + mainLabel.height;
    const contentTop = (height - (logoHeight + this.metrics.px(LOGO_MENU_GAP) + menuHeight)) / 2;

    subLabel.setPosition(width / 2, contentTop);
    mainLabel.setPosition(width / 2, contentTop + subLabel.height + logoGap);

    const menuWidth = Math.min(this.metrics.px(MENU_MAX_WIDTH), width * 0.84);
    const menuX = (width - menuWidth) / 2;
    const menuY = contentTop + logoHeight + this.metrics.px(LOGO_MENU_GAP);

    menu.forEach((item, index) => {
      const y = menuY + index * (buttonHeight + buttonGap);
      this.addMenuButton(menuX, y, menuWidth, buttonHeight, item.label, item.primary, item.onTap);
    });
  }

  /** 上から順に空・海・砂浜へ移る縦のグラデーション。中間色で2枚に分けて3色を表現する。 */
  private drawBackground(): void {
    const { width, height } = this.metrics;
    const horizon = height * HORIZON_RATIO;
    const background = this.add.graphics();
    background.fillGradientStyle(
      COLOR.titleGradientTop,
      COLOR.titleGradientTop,
      COLOR.titleGradientMiddle,
      COLOR.titleGradientMiddle,
      1,
    );
    background.fillRect(0, 0, width, horizon);
    background.fillGradientStyle(
      COLOR.titleGradientMiddle,
      COLOR.titleGradientMiddle,
      COLOR.titleGradientBottom,
      COLOR.titleGradientBottom,
      1,
    );
    background.fillRect(0, horizon, width, height - horizon);
  }

  private addMenuButton(
    x: number,
    y: number,
    width: number,
    height: number,
    content: string,
    primary: boolean,
    onTap?: () => void,
  ): void {
    const button = new Button(
      this,
      { x, y, width, height },
      primary
        ? { fill: COLOR.primaryButton, radius: height / 2 }
        : {
            fill: COLOR.textOnDark,
            fillAlpha: 0.12,
            border: COLOR.textOnDark,
            borderWidth: Math.max(1, this.metrics.px(2)),
            radius: height / 2,
          },
      onTap,
    );
    const label = addLabel(this, this.metrics, width / 2, height / 2, content, {
      size: 30,
      bold: true,
      color: primary ? COLOR.primaryButtonText : COLOR.textOnDark,
    }).setOrigin(0.5);
    button.addContent(label);
  }
}

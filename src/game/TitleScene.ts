import { ResponsiveScene } from './ResponsiveScene';
import { scenarioNames } from '../scenario/Scenario';
import { Button } from './ui/Button';
import { addLabel } from '../ui/labels';
import { COLOR, mixColor } from './looks/theme';

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
      // 棚は周回をまたいで残る唯一のもの（GameEndings.md 6節）。空きが見えていることが次の周回へ
      // 向かう動機なので、到達した直後だけでなくここからも開ける。
      { label: 'アーティファクトの棚', primary: false, onTap: () => this.scene.start('shelf') },
      { label: '設定', primary: false, onTap: () => this.scene.start('settings') },
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

  /**
   * 上から順に空・海・砂浜へ移る縦のグラデーション。中間色を境に2区間へ分けて3色を表現する。
   *
   * **色は行ごとに自分で混ぜて敷く。** Graphicsのグラデーション塗り（fillGradientStyle）はWebGL
   * 専用で、WebGLの無い環境（Canvasレンダラへ落ちる）では塗りの色が決まらず背景が真っ黒になる。
   */
  private drawBackground(): void {
    const { width, height } = this.metrics;
    const horizon = height * HORIZON_RATIO;
    const background = this.add.graphics();
    for (let y = 0; y < height; y++) {
      const [from, to, ratio] =
        y < horizon
          ? [COLOR.titleGradientTop, COLOR.titleGradientMiddle, y / horizon]
          : [COLOR.titleGradientMiddle, COLOR.titleGradientBottom, (y - horizon) / (height - horizon)];
      background.fillStyle(mixColor(from, to, ratio), 1);
      background.fillRect(0, y, width, 1);
    }
  }

  private addMenuButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    primary: boolean,
    onTap?: () => void,
  ): void {
    const button = new Button(
      this,
      { x, y, width, height },
      primary
        ? { fillColor: COLOR.primaryButton, radius: height / 2 }
        : {
            fillColor: COLOR.textOnDark,
            fillAlpha: 0.12,
            borderColor: COLOR.textOnDark,
            borderWidth: this.metrics.linePx(2),
            radius: height / 2,
          },
      onTap,
    );
    button.addCentered(
      addLabel(this, this.metrics, 0, 0, label, {
        size: 30,
        bold: true,
        color: primary ? COLOR.primaryButtonText : COLOR.textOnDark,
      }),
    );
  }
}

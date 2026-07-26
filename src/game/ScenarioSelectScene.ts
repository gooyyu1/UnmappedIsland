import { ResponsiveScene } from './ResponsiveScene';
import { bundledScenario, scenarioNames } from '../scenario/Scenario';
import { scenarioPlayData } from './PlayScene';
import { Button } from './ui/Button';
import { ScreenHeader } from './ui/ScreenHeader';
import { addLabel } from './ui/labels';
import { addPanel } from './ui/shapes';
import { COLOR, SIZE } from './ui/theme';

/** 一覧の外周パディングと、シナリオ1件ぶんの高さ。 */
const LIST_PADDING = 20;
const ITEM_HEIGHT = 96;
const ITEM_PADDING_X = 24;

/**
 * テスト用シナリオの選択画面（SaveDataManagement.md「テスト用シナリオ」節）。
 *
 * 同梱シナリオを名前順に並べるだけの簡易な一覧。選ぶとセーブスロットを使わずにプレイ画面へ入る。
 * 件数は数件を想定しているためスクロールは持たない。
 */
export class ScenarioSelectScene extends ResponsiveScene {
  constructor() {
    super('scenarios');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    addPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, 'テスト用シナリオ', () => this.scene.start('title'));

    const padding = this.metrics.px(LIST_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const itemHeight = this.metrics.px(ITEM_HEIGHT);
    let y = ScreenHeader.height(this.metrics) + padding;

    for (const name of scenarioNames()) {
      this.addItem(padding, y, width - padding * 2, itemHeight, name);
      y += itemHeight + gap;
    }
  }

  private addItem(x: number, y: number, width: number, height: number, name: string): void {
    // 同梱シナリオが読めることはtests/scenario/scenario.test.tsが担保しているため、ここでは失敗を扱わない。
    const scenario = bundledScenario(name);
    if (scenario === undefined) return;

    const button = new Button(
      this,
      { x, y, width, height },
      {
        fill: COLOR.cardFace,
        border: COLOR.cardBorder,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
      },
      () => this.scene.start('play', scenarioPlayData(scenario)),
    );

    const left = this.metrics.px(ITEM_PADDING_X);
    const title = addLabel(this, this.metrics, left, height / 2, scenario.title, {
      size: 30,
      bold: true,
    }).setOrigin(0, 1);
    const detail = addLabel(this, this.metrics, left, height / 2, `${name}（シード ${scenario.seed}）`, {
      size: 22,
      color: COLOR.textMuted,
    }).setOrigin(0, 0);
    button.addContent(title, detail);
  }
}

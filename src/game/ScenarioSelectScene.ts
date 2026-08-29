import { ResponsiveScene } from './ResponsiveScene';
import { bundledScenario, scenarioNames } from '../scenario/Scenario';
import { scenarioPlayData } from './PlayScene';
import { Button } from './ui/Button';
import { ScreenHeader } from './ui/ScreenHeader';
import { addLabel } from '../ui/labels';
import { uiText } from '../locale/uiTexts';
import { addInputBlockingPanel } from '../ui/shapes';
import { COLOR, SIZE, rowPlateStyle } from './looks/theme';
import { LIST_ITEM_PADDING_X, LIST_PADDING } from './looks/listScreen';

/** シナリオ1件ぶんの高さ（外周と左右の余白はlooks/listScreen）。 */
const ITEM_HEIGHT = 96;

/**
 * テスト用シナリオの選択画面（SaveDataManagement.md「テスト用シナリオ」節）。
 *
 * 同梱シナリオを名前順に並べるだけの簡易な一覧。選ぶとセーブスロットを使わずにプレイ画面へ入る。
 * スクロールは持たず、縦に入り切らない分は右の列へ折り返す。
 */
export class ScenarioSelectScene extends ResponsiveScene {
  constructor() {
    super('scenarios');
  }

  protected build(): void {
    const { width, height } = this.metrics;
    addInputBlockingPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, uiText('scenarios_title'), () => this.scene.start('title'));

    const padding = this.metrics.px(LIST_PADDING);
    const gap = this.metrics.px(SIZE.gap);
    const itemHeight = this.metrics.px(ITEM_HEIGHT);
    const top = ScreenHeader.height(this.metrics) + padding;
    const names = scenarioNames();

    // 縦に入る件数で折り返して列を増やす。件数が増えても末尾が画面の外へ出ないので、届かない
    // シナリオが出ない（スクロールを持たない代わりの手当て）。
    const rowsThatFit = Math.max(1, Math.floor((height - top - padding + gap) / (itemHeight + gap)));
    const columns = Math.max(1, Math.ceil(names.length / rowsThatFit));
    // 列数が決まったら、最後の列だけが極端に短くならないよう均して並べる。
    const perColumn = Math.ceil(names.length / columns);
    const itemWidth = (width - padding * 2 - gap * (columns - 1)) / columns;

    names.forEach((name, index) => {
      const x = padding + Math.floor(index / perColumn) * (itemWidth + gap);
      const y = top + (index % perColumn) * (itemHeight + gap);
      this.addItem(x, y, itemWidth, itemHeight, name);
    });
  }

  private addItem(x: number, y: number, width: number, height: number, name: string): void {
    // 同梱シナリオが読めることはtests/scenario/scenario.test.tsが担保しているため、ここでは失敗を扱わない。
    const scenario = bundledScenario(name);
    if (scenario === undefined) return;

    const button = new Button(this, { x, y, width, height }, rowPlateStyle(this.metrics), () =>
      this.scene.start('play', scenarioPlayData(scenario)),
    );

    const left = this.metrics.px(LIST_ITEM_PADDING_X);
    const title = addLabel(this, this.metrics, left, height / 2, scenario.title, {
      size: 30,
      bold: true,
    }).setOrigin(0, 1);
    const detail = addLabel(
      this,
      this.metrics,
      left,
      height / 2,
      uiText('scenario_detail', { name, seed: String(scenario.seed) }),
      { size: 22, color: COLOR.textMuted },
    ).setOrigin(0, 0);
    button.addContent(title, detail);
  }
}

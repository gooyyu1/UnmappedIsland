import { beforeAll, describe, expect, it } from 'vitest';
import { spawnInProgressObject } from '../../src/domain/crafting';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { seededRng } from '../../src/domain/Rng';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import {
  MIN_WINDOW_WIDTH,
  actionButtonWidth,
  windowContentWidth,
} from '../../src/game/looks/childWindowLayout';
import { ScreenMetrics } from '../../src/game/looks/ScreenMetrics';
import { SIZE } from '../../src/game/looks/theme';
import type { CardAction } from '../../src/game/view/cardOperations';
import { craftingActions } from '../../src/game/view/craftingView';
import type { Localization } from '../../src/locale/Localization';
import { loadLocalization } from '../../src/locale/Localization';
import { nameWidth } from '../support/labelWidth';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 子ウィンドウの操作の行に並べられる数と、そこへ載る名前の長さの線
 * （[`docs/ui/Windows.md`](../../docs/ui/Windows.md) 4節）。
 *
 * **移す先が無い線**なので、破れたときに直すのは世界の側になる——縦の並びは横型の画面に入らず、
 * 折り返しも別のウィンドウへの送りも採らない。**画面の側に逃げ道が無いぶん、宣言を足した時点で
 * 赤くなる必要がある。**
 *
 * **数えるのは同梱の型すべてで、開いてみた1つの窓ではない**——窓は押した札のものを映すので、
 * 5つ目が1つの型の側へ生えたときに、代表を1つ開く試験は緑のまま通る。
 *
 * 画面が自分で足すボタン（製作中オブジェクトの自動補充・作業する・中断）も並びに入るので
 * （`cardOperations.actionsOf`）、**宣言だけを数えると足りない。** その数は数え上げずに
 * {@link craftingActions} 自身へ訊く。
 */
describe('操作の行に並ぶ数と名前', () => {
  /**
   * 1行に並べられる数の上限（Windows.md 4節）。**最小タップ領域を割らない最後の数**で、
   * 下の「上限は、最小タップ領域を割らない最後の数」がこの値を幾何へ結び付けている。
   */
  const ACTION_ROW_CAPACITY = 6;

  /** 島の生成と時刻の引きを固定する種。並びの数はどの島でも変わらないので、値そのものに意味は無い。 */
  const SEED = 12345;

  let codex: WorldCodex;
  let locale: Localization;

  /**
   * u単位のまま読める寸法（`u = 1`）。横型で高さ1080u、幅は横型の設計寸法より広く取る。
   * u=1であることは下の試験が確かめるので、設計寸法が動いたら気付ける。
   */
  const metrics = new ScreenMetrics(4000, 1080);

  /** count個を等分したときの、1つのボタンの幅（u）。**最も狭いウィンドウ**のときで測る。 */
  function widthOf(count: number): number {
    return actionButtonWidth(metrics, windowContentWidth(metrics, metrics.px(MIN_WINDOW_WIDTH)), count);
  }

  /** 画面が製作中オブジェクトへ足すボタン（craftingViewに訊く。宣言には無い）。 */
  function craftingButtons(): readonly CardAction[] {
    const game = startNewGame(codex, SAMPLE_CHARACTER, SEED, seededRng(SEED));
    const inProgress = [...codex.objects].find((def) => def.isInProgress);
    if (inProgress === undefined) throw new Error('製作中オブジェクトの型が1つもありません。');

    const spawned = spawnInProgressObject(game.startLocation.instance, inProgress.globalId);
    return craftingActions(spawned, game, locale);
  }

  beforeAll(() => {
    codex = bundledCodex();
    locale = loadLocalization([]);
  });

  it('u単位のまま読める寸法で測っている', () => {
    expect(metrics.u, '横型の設計寸法が4000uを超えると、下の幅はuではなくなる').toBe(1);
  });

  /**
   * 6という数が幾何から出ていることを固定する。**最も狭いウィンドウで等分して、アイコンボタンの
   * 最小タップ領域（ScreenLayout.md 2節）を割らない最後の数**で、ウィンドウの下限幅・間隔・
   * タップ領域のどれかが動けばここが赤くなり、4節の記述を書き直す合図になる。
   */
  it('上限は、最小タップ領域を割らない最後の数', () => {
    expect(widthOf(ACTION_ROW_CAPACITY), `${ACTION_ROW_CAPACITY}個`).toBeGreaterThanOrEqual(SIZE.iconButton);
    expect(widthOf(ACTION_ROW_CAPACITY + 1), `${ACTION_ROW_CAPACITY + 1}個`).toBeLessThan(SIZE.iconButton);
  });

  it('1つのオブジェクトに並ぶ操作は、1行に入る数を超えない', () => {
    const added = craftingButtons().length;
    expect(added, '画面が足すボタンを数えられていない').toBeGreaterThan(0);

    const over = [...codex.objects]
      .map((def) => ({
        name: def.name,
        count: def.menuTriggers.length + (def.isInProgress ? added : 0),
      }))
      .filter((one) => one.count > ACTION_ROW_CAPACITY);

    expect(over.map((one) => `${one.name}: ${one.count}個`)).toEqual([]);
  });

  /**
   * 並べる数がそのまま名前の予算になる（Windows.md 4節）。**ラベルは縮みも折り返しもしない**ので、
   * 等分した箱より長い名前は箱の外へ描かれる。
   */
  it('操作の名前は、並べたときの箱に収まる', () => {
    const buttons = craftingButtons();
    const overflowing: string[] = [];
    let checked = 0;

    for (const def of codex.objects) {
      const texts = locale.object(def.name);
      const labels = [
        ...def.menuTriggers.map((trigger) => texts.interaction(trigger.interaction.name).displayName),
        ...(def.isInProgress ? buttons.map((button) => button.name) : []),
      ];
      const box = widthOf(labels.length);

      for (const label of labels) {
        checked += 1;
        if (nameWidth(label) * SIZE.textButtonLabel > box)
          overflowing.push(`${def.name}: '${label}' は${labels.length}個並ぶ箱（${box}u）に入らない`);
      }
    }

    expect(checked, '操作の名前を1つも測れていない').toBeGreaterThan(0);
    expect(overflowing).toEqual([]);
  });
});

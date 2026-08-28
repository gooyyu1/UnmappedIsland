import { describe, expect, it } from 'vitest';
import type { CardLane } from '../../src/game/ui/CardLane';
import type { ObjectWindowLane, ObjectWindowPane } from '../../src/game/ui/ObjectWindowPane';
import { OpenPane } from '../../src/game/ui/OpenPane';
import type { Rect } from '../../src/ui/Rect';

/**
 * 子ウィンドウが開いている面（OpenPane）の自動テスト。
 *
 * 確かめるのは**面を捨てたあとも借りた札の枠を答えられること**——帰りのアニメーションの出発点は、
 * 窓が閉じたあとに測りに来る（PlayScene.closeChildWindowReturningOrigins）。
 */
describe('開いている面', () => {
  const CARD_RECT: Rect = { x: 10, y: 20, width: 30, height: 40 };
  const OTHER_RECT: Rect = { x: 50, y: 60, width: 30, height: 40 };

  /** 枠を答えるだけのレーン。OpenPaneが見るのはcellRectだけ。 */
  const laneAt = (rect: Rect): CardLane => ({ cellRect: () => rect }) as unknown as CardLane;

  const paneWith = (...lanes: readonly ObjectWindowLane[]): ObjectWindowPane => ({
    lanes,
    refresh: () => {},
    destroy: () => {},
  });

  /** 説明のタブ（借りた札を出す面）。 */
  const cardPane = (rect: Rect): ObjectWindowPane => paneWith({ role: 'card', lane: laneAt(rect) });

  /** スロットのタブ（札の枠を持たない面）。 */
  const contentPane = (): ObjectWindowPane => paneWith({ role: 'content', lane: laneAt(OTHER_RECT) });

  it('開いている面が札の枠を持つなら、その枠をそのまま答える', () => {
    const open = new OpenPane();

    open.replace(() => cardPane(CARD_RECT));

    expect(open.cardRect).toEqual(CARD_RECT);
  });

  it('札の枠を持たない面へ切り替えても、最後の枠を答える', () => {
    const open = new OpenPane();
    open.replace(() => cardPane(CARD_RECT));

    open.replace(() => contentPane());

    expect(open.cardRect, '控えた枠を答える（今の面のレーンではない）').toEqual(CARD_RECT);
  });

  it('面を捨てて閉じたあとも、最後の枠を答える', () => {
    // 閉じるボタンは窓を閉じてから呼び出し側へ知らせるので、出どころは閉じたあとに測られる。
    // ここが答えられないと、借りた札は元の枠へ飛んで帰らずその場に現れる。
    const open = new OpenPane();
    open.replace(() => cardPane(CARD_RECT));

    open.close();

    expect(open.cardRect).toEqual(CARD_RECT);
  });

  it('タブを切り替えてから閉じても、札を出していた枠を答える', () => {
    const open = new OpenPane();
    open.replace(() => cardPane(CARD_RECT));
    open.replace(() => contentPane());

    open.close();

    expect(open.cardRect).toEqual(CARD_RECT);
  });

  it('捨てた面は破棄し、レーンも手放す', () => {
    let destroyed = 0;
    const open = new OpenPane();
    const pane: ObjectWindowPane = { ...cardPane(CARD_RECT), destroy: () => (destroyed += 1) };

    open.replace(() => pane);
    open.close();

    expect(destroyed, '閉じるときに面を破棄する').toBe(1);
    expect(open.lanes, '閉じたあとのレーンは無い').toEqual([]);
  });
});

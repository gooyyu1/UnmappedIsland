import { beforeAll, describe, expect, it } from 'vitest';
import type { CardContent } from '../../src/game/ui/Card';
import type { LaneCell } from '../../src/game/ui/laneCells';
import { hiddenOnlyCells } from '../../src/game/ui/laneCells';
import { parseLocale } from '../../src/locale/Localization';
import { setUiTexts } from '../../src/locale/uiTexts';

/** 印の字面は対応表から出るので、確かめたい形をここに置く（durationText.test.tsと同じ形）。 */
beforeAll(() => {
  setUiTexts(
    parseLocale(
      'ja.yaml',
      `ui_texts:
  lane_hidden_cards: '隠れ{count}枚'
`,
    ),
  );
});

const card = (name: string): CardContent => ({ icon: '🪵', name });

/** 空き枠だけが並ぶレーン（受け皿の空枠が1つ）。 */
const emptyLane: readonly LaneCell[] = [{}];

/**
 * 絞り込みで空になったレーンの枠（hiddenOnlyCells、ScreenLayout.md 8.1.7節）。**問いは「なぜ空なのか」**
 * なので、印が付くのは1枚も残っていないときだけ。
 */
describe('絞り込みで空になったレーンの枠', () => {
  it('1枚も残らなければ、隠れている枚数が先頭の枠に出る', () => {
    // 何も置いていないレーンと同じ「受け皿の空枠が1つ」では、置き忘れたのか隠れているのかが読めない。
    expect(hiddenOnlyCells(emptyLane, 3)[0].overlay).toBe('隠れ3枚');
  });

  it('何も隠していなければ、印は出ない', () => {
    expect(hiddenOnlyCells(emptyLane, 0)[0].overlay, '本当に空のレーン').toBeUndefined();
  });

  it('1枚でも残っていれば、印は出ない', () => {
    // 絞り込みを選んでいることはボタンの強調が言っているので、札が見えているレーンに問いは立たない。
    const cells = hiddenOnlyCells([{ card: card('丸太') }, {}], 2);

    expect(cells.map((cell) => cell.overlay)).toEqual([undefined, undefined]);
  });

  it('空枠が複数あっても、印を出すのは先頭の1枠だけ', () => {
    // 空になった理由は1度言えば足りる。
    const cells = hiddenOnlyCells([{}, {}, {}], 1);

    expect(cells.map((cell) => cell.overlay)).toEqual(['隠れ1枚', undefined, undefined]);
  });

  it('枠が持っていた他の印は残す', () => {
    const [cell] = hiddenOnlyCells([{ accepts: card('石'), borderColor: 0x123456 }], 1);

    expect(cell.accepts?.name).toBe('石');
    expect(cell.borderColor).toBe(0x123456);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { CardContent } from '../../src/game/ui/Card';
import type { LaneCell } from '../../src/game/ui/laneCells';
import { hiddenCountCells } from '../../src/game/ui/laneCells';
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
 * 絞り込みが隠している枚数の印（hiddenCountCells、ScreenLayout.md 8.1.7節）。**残っている札の有無に
 * よらず出す**ので、見えている札がレーンの全部かどうかがどのレーンでも読める。
 */
describe('絞り込みが隠している枚数の印', () => {
  it('1枚も残らなければ、隠れている枚数が先頭の枠に出る', () => {
    // 何も置いていないレーンと同じ「受け皿の空枠が1つ」では、置き忘れたのか隠れているのかが読めない。
    expect(hiddenCountCells(emptyLane, 3)[0].overlay).toBe('隠れ3枚');
  });

  it('何も隠していなければ、印は出ない', () => {
    expect(hiddenCountCells(emptyLane, 0)[0].overlay, '本当に空のレーン').toBeUndefined();
  });

  it('札が残っているレーンでも、隠れている枚数が出る', () => {
    // 見えている札がレーンの全部なのかは、そのレーンを見ないと分からない。
    const cells = hiddenCountCells([{ card: card('丸太') }, {}], 2);

    expect(cells.map((cell) => cell.overlay)).toEqual([undefined, '隠れ2枚']);
  });

  it('札が残っていれば、印は先頭の空き枠に出る（カードの絵には重ねない）', () => {
    const cells = hiddenCountCells([{ card: card('丸太') }, { card: card('石') }, {}, {}], 5);

    expect(cells.map((cell) => cell.overlay)).toEqual([undefined, undefined, '隠れ5枚', undefined]);
  });

  it('空き枠が1つも無ければ、末尾の枠に出る', () => {
    // 枠数の決まったスロットが埋まっている並び。続きがあることを言う場所として、並びの終わりが最も近い。
    const cells = hiddenCountCells([{ card: card('丸太') }, { card: card('石') }], 3);

    expect(cells.map((cell) => cell.overlay)).toEqual([undefined, '隠れ3枚']);
  });

  it('空枠が複数あっても、印を出すのは先頭の1枠だけ', () => {
    // 隠れているという事実は1度言えば足りる。
    const cells = hiddenCountCells([{}, {}, {}], 1);

    expect(cells.map((cell) => cell.overlay)).toEqual(['隠れ1枚', undefined, undefined]);
  });

  it('枠が持っていた他の印は残す', () => {
    const [cell] = hiddenCountCells([{ accepts: card('石'), borderColor: 0x123456 }], 1);

    expect(cell.accepts?.name).toBe('石');
    expect(cell.borderColor).toBe(0x123456);
  });
});

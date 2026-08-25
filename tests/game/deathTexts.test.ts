import { describe, expect, it } from 'vitest';
import { causeOfDeathSentence } from '../../src/game/looks/deathTexts';
import { parseLocale } from '../../src/locale/Localization';

/**
 * 死んだことを伝える一文（VitalsSystem.md 6節）に対する自動テスト。
 *
 * **確かめるのは「消し方の対応表から引いている」こと。** 死因の名前と段の名前は別の名前空間なので、
 * 段の対応表から引いていると、名前がたまたま揃っている間だけ通る。
 */
describe('causeOfDeathSentence(死んだことを伝える一文)', () => {
  const locale = parseLocale(
    'ja.yaml',
    `destroy_reason_texts:
  drowned: 溺れ
stage_texts:
  dehydrated: 渇き
`,
  );

  it('段に無い名前でも、消し方の対応表から文言が出る', () => {
    expect(causeOfDeathSentence('drowned', locale)).toBe('溺れで死んだ。');
  });

  it('段に同じ名前があっても、そちらは引かない', () => {
    // 段の`dehydrated`（渇き）は「今どこに居るか」で、死因は「どう消したか」。引く先が段だと、
    // 死因の名前を段と違う語にした瞬間に文言が出なくなる。
    expect(causeOfDeathSentence('dehydrated', locale)).toBe('dehydratedで死んだ。');
  });

  it('名乗らずに消えたなら、死に方を言わない', () => {
    expect(causeOfDeathSentence(undefined, locale)).toBe('力尽きた。');
  });
});

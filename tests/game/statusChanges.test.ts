import { describe, expect, it } from 'vitest';
import { statusChangesAfter, statusChangesBetween } from '../../src/game/view/statusChanges';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/** 域は増減の判定に使わないため、比較に効くkey・value・ratioだけを指定して作る。 */
function status(key: string, value: number, ratio?: number): StatusContent {
  return { key, name: key, value, ratio, alert: 'safe' };
}

describe('statusChangesBetween(行動の前後でのステータスの増減)', () => {
  it('増えた項目と減った項目だけを、プロパティの識別子で引ける形にする', () => {
    const before = [status('satiety', 100), status('hydration', 100), status('stamina', 100)];
    const after = [status('satiety', 120), status('hydration', 90), status('stamina', 100)];

    const changes = statusChangesBetween(before, after);

    expect(changes.get('satiety')?.change).toBe('increased');
    expect(changes.get('hydration')?.change).toBe('decreased');
    expect(changes.has('stamina'), '変わらなかった項目は含めない').toBe(false);
  });

  it('行動前の満たされ具合を添える（現れた行が、その行動での減少ぶんだけを帯で見せるため）', () => {
    const changes = statusChangesBetween([status('satiety', 4850, 0.5)], [status('satiety', 4750, 0.49)]);

    expect(changes.get('satiety')?.ratioBefore).toBe(0.5);
  });

  it('比べる相手が無い項目は含めない', () => {
    const changes = statusChangesBetween([status('satiety', 100)], [status('hydration', 50)]);

    expect(changes.size).toBe(0);
  });
});

describe('statusChangesAfter(操作のあとの増減の記号)', () => {
  const shown = new Map([['satiety', { change: 'decreased' as const, ratioBefore: 0.5 }]]);

  it('時間が経過してなお値が動かなければ、記号は消える', () => {
    const unchanged = [status('satiety', 100)];

    expect(statusChangesAfter(shown, unchanged, unchanged, true).size).toBe(0);
  });

  it('時間を消費しない操作では、値が動かなくても記号を消さない', () => {
    // 箱へ入れる・並べ替えるといった操作は行動の区切りではないので、直前の行動の記号を残す。
    const unchanged = [status('satiety', 100)];

    expect(statusChangesAfter(shown, unchanged, unchanged, false).get('satiety')?.change).toBe('decreased');
  });

  it('時間を消費しない操作でも、動いた項目は上書きする（荷重など）', () => {
    const changes = statusChangesAfter(
      shown,
      [status('satiety', 100), status('load', 0)],
      [status('satiety', 100), status('load', 500)],
      false,
    );

    expect(changes.get('load')?.change).toBe('increased');
    expect(changes.get('satiety')?.change, '動かなかった項目は残る').toBe('decreased');
  });

  it('時間が経過した操作は、動かなかった項目の記号を引き継がない', () => {
    const changes = statusChangesAfter(
      shown,
      [status('satiety', 100), status('hydration', 100)],
      [status('satiety', 100), status('hydration', 90)],
      true,
    );

    expect(changes.get('hydration')?.change).toBe('decreased');
    expect(changes.has('satiety'), '前の行動の記号は消える').toBe(false);
  });
});

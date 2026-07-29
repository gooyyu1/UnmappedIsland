import { describe, expect, it } from 'vitest';
import { statusChangesBetween } from '../../src/game/statusChanges';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/** ratioは増減の判定に使わないため、比較に効くvalueだけを指定して作る。 */
function status(name: string, value: number): StatusContent {
  return { name, value, ratio: undefined };
}

describe('statusChangesBetween(行動の前後でのステータスの増減)', () => {
  it('増えた項目と減った項目だけを、表示名で引ける形にする', () => {
    const before = [status('満腹度', 100), status('水分', 100), status('体力', 100)];
    const after = [status('満腹度', 120), status('水分', 90), status('体力', 100)];

    const changes = statusChangesBetween(before, after);

    expect(changes.get('満腹度')).toBe('increased');
    expect(changes.get('水分')).toBe('decreased');
    expect(changes.has('体力'), '変わらなかった項目は含めない').toBe(false);
  });

  it('比べる相手が無い項目は含めない', () => {
    const changes = statusChangesBetween([status('満腹度', 100)], [status('水分', 50)]);

    expect(changes.size).toBe(0);
  });
});

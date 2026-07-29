import { describe, expect, it } from 'vitest';
import { statusChangesBetween } from '../../src/game/statusChanges';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/** ratioと域は増減の判定に使わないため、比較に効くkeyとvalueだけを指定して作る。 */
function status(key: string, value: number): StatusContent {
  return { key, name: key, value, ratio: undefined, alert: 'safe' };
}

describe('statusChangesBetween(行動の前後でのステータスの増減)', () => {
  it('増えた項目と減った項目だけを、プロパティの識別子で引ける形にする', () => {
    const before = [status('satiety', 100), status('hydration', 100), status('stamina', 100)];
    const after = [status('satiety', 120), status('hydration', 90), status('stamina', 100)];

    const changes = statusChangesBetween(before, after);

    expect(changes.get('satiety')).toBe('increased');
    expect(changes.get('hydration')).toBe('decreased');
    expect(changes.has('stamina'), '変わらなかった項目は含めない').toBe(false);
  });

  it('比べる相手が無い項目は含めない', () => {
    const changes = statusChangesBetween([status('satiety', 100)], [status('hydration', 50)]);

    expect(changes.size).toBe(0);
  });
});

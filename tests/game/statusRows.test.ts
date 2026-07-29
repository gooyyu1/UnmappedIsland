import { describe, expect, it } from 'vitest';
import type { AlertLevel } from '../../src/domain/defs/AlertLevel';
import { statusRows } from '../../src/game/statusRows';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/** 並び順と絞り込みに効くkey・域・固定表示だけを指定して作る。 */
function status(key: string, alert: AlertLevel, pinned = false): StatusContent {
  return { key, name: key, value: 0, ratio: 0, alert, pinned };
}

describe('statusRows(ステータスエリアに並べる行)', () => {
  it('安全域は出さず、要注意域より危険域・致命的域を先に出す', () => {
    const rows = statusRows(
      [
        status('satiety', 'caution'),
        status('hydration', 'fatal'),
        status('wakefulness', 'safe'),
        status('stamina', 'danger'),
      ],
      [],
    );

    expect(rows.map((row) => row.key)).toEqual(['hydration', 'stamina', 'satiety']);
  });

  it('同じまとまりの中はプロパティの宣言順を保つ', () => {
    const rows = statusRows([status('satiety', 'danger'), status('hydration', 'fatal')], []);

    expect(rows.map((row) => row.key)).toEqual(['satiety', 'hydration']);
  });

  it('固定表示にしたステータスは、安全域でも先頭に出る', () => {
    const rows = statusRows([status('satiety', 'danger'), status('wakefulness', 'safe', true)], []);

    expect(rows.map((row) => row.key)).toEqual(['wakefulness', 'satiety']);
  });

  it('statusタグが無いプロパティは、固定表示にしたものだけが出る', () => {
    const rows = statusRows(
      [status('satiety', 'caution')],
      [status('body_fat', 'danger'), status('meat_nutrition', 'safe', true)],
    );

    expect(
      rows.map((row) => row.key),
      'body_fatは危険域でも固定表示でなければ出ない',
    ).toEqual(['meat_nutrition', 'satiety']);
  });

  it('複数のタブに現れる同じプロパティを重複して出さない', () => {
    const rows = statusRows(
      [status('satiety', 'caution', true)],
      [status('satiety', 'caution', true), status('satiety', 'caution', true)],
    );

    expect(rows.map((row) => row.key)).toEqual(['satiety']);
  });
});

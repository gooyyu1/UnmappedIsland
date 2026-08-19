import { describe, expect, it } from 'vitest';
import type { AlertLevel } from '../../src/domain/AlertLevel';
import { statusRows } from '../../src/game/view/statusRows';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/** 並び順と絞り込みに効くkey・域・固定表示だけを指定して作る。 */
function status(key: string, alert: AlertLevel, pinned = false): StatusContent {
  return { key, name: key, value: 0, ratio: 0, alert, pinned };
}

/** どのバーも変化を見せ終わっている（安全域はその場で落ちる）ときの並び。 */
function settledRows(
  tagged: readonly StatusContent[],
  others: readonly StatusContent[] = [],
): readonly StatusContent[] {
  return statusRows(tagged, others, () => false);
}

describe('statusRows(ステータスエリアに並べる行)', () => {
  it('安全域は出さず、要注意域より危険域・致命的域を先に出す', () => {
    const rows = settledRows([
      status('satiety', 'caution'),
      status('hydration', 'fatal'),
      status('wakefulness', 'safe'),
      status('stamina', 'danger'),
    ]);

    expect(rows.map((row) => row.key)).toEqual(['hydration', 'stamina', 'satiety']);
  });

  it('留意域は要注意域と同じまとまりに置く（今のところUIは区別しない）', () => {
    const rows = settledRows([
      status('satiety', 'watch'),
      status('hydration', 'danger'),
      status('stamina', 'caution'),
    ]);

    expect(rows.map((row) => row.key)).toEqual(['hydration', 'satiety', 'stamina']);
  });

  it('同じまとまりの中はプロパティの宣言順を保つ', () => {
    const rows = settledRows([status('satiety', 'danger'), status('hydration', 'fatal')]);

    expect(rows.map((row) => row.key)).toEqual(['satiety', 'hydration']);
  });

  it('固定表示にしたステータスは、安全域でも先頭に出る', () => {
    const rows = settledRows([status('satiety', 'danger'), status('wakefulness', 'safe', true)]);

    expect(rows.map((row) => row.key)).toEqual(['wakefulness', 'satiety']);
  });

  it('statusタグが無いプロパティは、固定表示にしたものだけが出る', () => {
    const rows = settledRows(
      [status('satiety', 'caution')],
      [status('body_fat', 'danger'), status('meat_nutrition', 'safe', true)],
    );

    expect(
      rows.map((row) => row.key),
      'body_fatは危険域でも固定表示でなければ出ない',
    ).toEqual(['meat_nutrition', 'satiety']);
  });

  it('安全域へ戻った行は、変化を見せ終わるまで残る', () => {
    // 良くなった分の帯が動く前に消すと、何がどれだけ良くなったのかが見えないため。
    const improving = status('hydration', 'safe');

    const rows = statusRows([status('satiety', 'caution'), improving], [], (s) => s === improving);

    expect(rows.map((row) => row.key)).toEqual(['satiety', 'hydration']);
  });

  it('変化を見せ終わった行は、次に引き直したとき落ちる', () => {
    const settled = status('hydration', 'safe');

    expect(statusRows([status('satiety', 'caution'), settled], [], () => false).map((r) => r.key)).toEqual([
      'satiety',
    ]);
  });

  it('残っている安全域は最後尾に置く（留意域より上へ出さない）', () => {
    // 消える途中の行が、まだ注意すべき行より上に来ると読み違える。
    const improving = status('hydration', 'safe');

    const rows = statusRows(
      [improving, status('satiety', 'watch'), status('stamina', 'fatal')],
      [],
      (s) => s === improving,
    );

    expect(rows.map((row) => row.key)).toEqual(['stamina', 'satiety', 'hydration']);
  });

  it('複数のタブに現れる同じプロパティを重複して出さない', () => {
    const rows = settledRows(
      [status('satiety', 'caution', true)],
      [status('satiety', 'caution', true), status('satiety', 'caution', true)],
    );

    expect(rows.map((row) => row.key)).toEqual(['satiety']);
  });
});

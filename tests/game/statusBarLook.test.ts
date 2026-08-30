import { describe, expect, it } from 'vitest';
import type { StatusContent, StatusStage } from '../../src/game/ui/StatusBar';
import { barFillOf, barNextStageTextOf, barValueTextOf } from '../../src/game/view/statusBarLook';

/**
 * ステータス1行がバーとその上の文字で何を映すか（docs/ui/StatusArea.md 9節）。
 * 割合を持たない行——腕前（docs/engine/SkillSystem.md 5節）——が、レベルと段内進捗になる。
 */
describe('ステータス行が映すもの', () => {
  const status = (ratio: number | undefined, stage?: StatusStage): StatusContent => ({
    key: 'skill_cordage',
    name: '繊維・編み',
    value: 30,
    ratio,
    stage,
    alert: 'safe',
  });

  const stage = (name: string, progress?: { nextName: string; ratio: number }): StatusStage => ({
    name,
    span: undefined,
    boundaries: [],
    progress,
  });

  it('割合を持つ行は満たされ具合のバーだけで、文字を載せない', () => {
    const hydration = status(0.4, stage('parched'));

    expect(barFillOf(hydration)).toBeCloseTo(0.4);
    expect(barValueTextOf(hydration), '長さがそのまま答えなので段の名前も出さない').toBe('');
    expect(barNextStageTextOf(hydration)).toBe('');
  });

  it('割合を持たず段の進みがある行は、進みのバーの両端に今の段と次の段を出す', () => {
    const skill = status(undefined, stage('一人前', { nextName: '熟練', ratio: 0.25 }));

    expect(barFillOf(skill), '満たされ具合ではなく段の中の進み').toBeCloseTo(0.25);
    expect(barValueTextOf(skill)).toBe('一人前');
    expect(barNextStageTextOf(skill)).toBe('熟練');
  });

  it('進みを言えない段は、バーを出さず段の名前だけを出す', () => {
    const topStage = status(undefined, stage('名人'));

    expect(barFillOf(topStage), '0のバーを出すと止まって見える').toBeUndefined();
    expect(barValueTextOf(topStage)).toBe('名人');
    expect(barNextStageTextOf(topStage), '向かう先が無い').toBe('');
  });

  it('段を持たない行は、これまでどおり実効値をそのまま出す', () => {
    const plain = status(undefined);

    expect(barFillOf(plain)).toBeUndefined();
    expect(barValueTextOf(plain)).toBe('30');
    expect(barNextStageTextOf(plain)).toBe('');
  });
});

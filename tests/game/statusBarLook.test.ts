import { describe, expect, it } from 'vitest';
import type { StatusContent, StatusStage } from '../../src/game/ui/StatusBar';
import {
  barFillOf,
  barKeepsAxis,
  barNextStageTextOf,
  barValueTextOf,
} from '../../src/game/view/statusBarLook';

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

  /** 段1つ。**識別子と表示名は別物**なので、同じ文言を持つ2段も作れるようにしておく。 */
  const stage = (key: string, progress?: { nextName: string; ratio: number }, name = key): StatusStage => ({
    key,
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

  it('段が上がった行は、前の段の位置と比べない（帯の軸が入れ替わるため）', () => {
    const before = status(undefined, stage('一人前', { nextName: '熟練', ratio: 0.95 }));
    const after = status(undefined, stage('熟練', { nextName: '名人', ratio: 0.02 }));

    expect(barKeepsAxis(before, after), '0.95→0.02は「減った」ではない').toBe(false);
    expect(barKeepsAxis(before, before), '同じ段の中なら比べられる').toBe(true);
  });

  it('表示名が同じでも、別の段なら軸が入れ替わったと見る', () => {
    // 段の文言は平らな対応表（stage_texts）なので、別々の段が同じ語を持てる。表示名で見比べると、
    // 段が上がったのに「同じ軸」と読まれて赤い帯が戻る。
    const before = status(undefined, stage('basic', { nextName: '熟練', ratio: 0.95 }, '一人前'));
    const after = status(undefined, stage('skilled', { nextName: '名人', ratio: 0.02 }, '一人前'));

    expect(barKeepsAxis(before, after)).toBe(false);
  });

  it('満たされ具合のバーは、段をまたいでも軸が変わらない', () => {
    // 軸はrangeそのもので、段は目盛りでしかない。ここで比べるのをやめると、水分が渇きの段へ
    // 落ちた行だけ帯が出なくなる。
    const before = status(0.5, stage('hydrated'));
    const after = status(0.3, stage('dryish'));

    expect(barKeepsAxis(before, after)).toBe(true);
  });
});

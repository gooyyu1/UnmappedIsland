import { describe, expect, it } from 'vitest';
import {
  playbackSteps,
  afterPlaybackSteps,
  isMidAction,
  acceptsOperation,
} from '../../src/game/view/operationSteps';

/**
 * 操作1回の段取り（operationSteps）の自動テスト。
 *
 * 見るのは順序と分岐だけ。**入れ替えても例外は出ず、画面が静かにおかしくなるだけ**の箇所なので、
 * ここで契約として固定する。
 */
describe('操作1回の段取り', () => {
  describe('操作を受け付けるか', () => {
    it('何も見せていない間だけ受け付ける', () => {
      expect(acceptsOperation('idle')).toBe(true);
    });

    it('見せている最中の画面は、今のワールドを映していないので受け付けない', () => {
      // 経過中は過去の時点を再現していて、場面転換中は作り直しを暗幕で隠している。
      for (const activity of ['exploring', 'elapsing', 'transiting'] as const)
        expect(acceptsOperation(activity), activity).toBe(false);
    });

    it('行動の途中の値を見せているのは、経過中と探索中', () => {
      expect(isMidAction('elapsing')).toBe(true);
      expect(isMidAction('exploring')).toBe(true);
    });

    it('場面転換中は途中の値ではない（見せているのは経過し切った後の値）', () => {
      expect(isMidAction('transiting')).toBe(false);
      expect(isMidAction('idle')).toBe(false);
    });
  });

  describe('経過を見せる手順', () => {
    const steps = (options: Partial<Parameters<typeof playbackSteps>[0]> = {}) =>
      playbackSteps({ ending: undefined, minutes: 45, ...options });

    it('死んだら、経過も結果も見せない', () => {
      expect(steps({ ending: 'death' })).toEqual(['death']);
      expect(steps({ ending: 'death', minutes: 0 }), '時間を消費しない操作で死んでも同じ').toEqual(['death']);
    });

    it('時間を消費するなら、控えを再生してから結果へ進む', () => {
      expect(steps()).toEqual(['gains', 'replay', 'elapsed']);
    });

    it('時間を消費しないなら、再生を挟まず結果まで進む', () => {
      expect(steps({ minutes: 0 })).toEqual(['gains', 'elapsed']);
    });

    it('増えた値の粒は、経過を見せる前から散らし始める', () => {
      // 効果が適用されるのは経過し切った時点だが、増えた量は押した瞬間に決まっている。
      const shown = steps();
      expect(shown.indexOf('gains')).toBeLessThan(shown.indexOf('replay'));
    });

    it('本土に着いたら、見せ終わってから出す', () => {
      expect(steps({ ending: 'escape' })).toEqual(['gains', 'replay', 'elapsed', 'escape']);
      expect(steps({ minutes: 0, ending: 'escape' })).toEqual(['gains', 'elapsed', 'escape']);
    });

    it('着いていなければ周回の終わりは出さない', () => {
      expect(steps()).not.toContain('escape');
    });
  });

  describe('経過し切った時点の手順', () => {
    it('移動しない操作は、出来事を出してから並びを差し替える', () => {
      // 効果がその物を消していれば、差し替えた後の画面にその札はもう無い。
      expect(afterPlaybackSteps({ moved: false })).toEqual(['refresh', 'noteChanges', 'signals', 'view']);
    });

    it('土地を移った操作は、作り直しへ進み、出来事は出さない', () => {
      // 出来事が起きた札は置いてきた土地の並びに居るので、指すべき札が無い。
      expect(afterPlaybackSteps({ moved: true })).toEqual(['refresh', 'noteChanges', 'transit']);
    });

    it('探索は、見つかったものを引き取ってから並びを差し替える', () => {
      // 出どころの矩形は今出ている並びの上にしか無い。
      expect(afterPlaybackSteps({ moved: false, found: true })).toEqual([
        'refresh',
        'noteChanges',
        'found',
        'signals',
        'view',
      ]);
    });

    it('ステータスの増減は、値を反映する前に控える', () => {
      for (const options of [{ moved: false }, { moved: true }, { moved: false, found: true }]) {
        const shown = afterPlaybackSteps(options);
        const reflects = shown.findIndex((step) => step === 'view' || step === 'transit');
        expect(shown.indexOf('noteChanges'), JSON.stringify(options)).toBeLessThan(reflects);
      }
    });
  });
});

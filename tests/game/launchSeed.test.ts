import { afterEach, describe, expect, it } from 'vitest';
import { initialSeed, parseLaunchSeed, setLaunchSeed } from '../../src/game/launchSeed';
import { SEED_MAX } from '../../src/save/SaveData';
import { StubRng } from '../support/StubRng';

describe('起動URLで固定する島の種(?seed=)', () => {
  // モジュールに残した値は次のテストファイルにも見えるため（vitest.config.tsのisolate: false）、
  // 指定が無い状態へ必ず戻す。
  afterEach(() => setLaunchSeed(undefined));

  it('?seed=の値を種として読む', () => {
    expect(parseLaunchSeed('?seed=1837462519')).toBe(1837462519);
    expect(parseLaunchSeed('?seed=0')).toBe(0);
    expect(parseLaunchSeed(`?seed=${SEED_MAX}`)).toBe(SEED_MAX);
    expect(parseLaunchSeed('?slot=2&seed=42')).toBe(42);
  });

  it('指定が無い・読めない・値域外のときは固定しない', () => {
    expect(parseLaunchSeed('')).toBeUndefined();
    expect(parseLaunchSeed('?other=1')).toBeUndefined();
    expect(parseLaunchSeed('?seed=')).toBeUndefined();
    expect(parseLaunchSeed('?seed=abc')).toBeUndefined();
    expect(parseLaunchSeed('?seed=-1')).toBeUndefined();
    expect(parseLaunchSeed(`?seed=${SEED_MAX + 1}`)).toBeUndefined();
  });

  it('固定されていれば、新規ゲームの初期値は毎回その種になる', () => {
    setLaunchSeed(parseLaunchSeed('?seed=12345'));

    // 乱数源を一切引かないので、StubRngの用意した値が減らない（引けば例外になる）。
    const rng = new StubRng({ ints: [] });
    expect(initialSeed(rng)).toBe(12345);
    expect(initialSeed(rng)).toBe(12345);
  });

  it('固定されていなければ、新規ゲームの初期値は今までどおり乱数から作る', () => {
    expect(initialSeed(new StubRng({ ints: [777] }))).toBe(777);
  });
});

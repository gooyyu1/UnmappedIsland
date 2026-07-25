import { describe, expect, it } from 'vitest';
import { SEED_MAX } from '../../src/save/SaveData';
import {
  CHARACTER_CHOICES,
  createSaveData,
  normalizeIslandName,
  parseSeed,
  randomCharacter,
  randomIslandName,
  randomSeed,
} from '../../src/save/newGameInput';
import { StubRng } from '../support/StubRng';

describe('新規ゲームの入力(SaveDataManagement.md)', () => {
  it('島の名前は形容語と名詞を1つずつ選んで繋ぐ', () => {
    expect(randomIslandName(new StubRng({ ints: [0, 0] }))).toBe('霧深い孤島');
  });

  it('乱数シードは0以上2^32-1以下で作られる', () => {
    expect(randomSeed(new StubRng({ ints: [SEED_MAX] }))).toBe(SEED_MAX);
    expect(randomSeed(new StubRng({ ints: [0] }))).toBe(0);
  });

  it('キャラクターは選択肢の中から選ばれる', () => {
    expect(randomCharacter(new StubRng({ ints: [2] }))).toBe(CHARACTER_CHOICES[2]);
  });

  it('数字以外を含むシードと値域外のシードは受け付けない', () => {
    expect(parseSeed('1837462519')).toBe(1837462519);
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed(String(SEED_MAX))).toBe(SEED_MAX);
    expect(parseSeed(String(SEED_MAX + 1))).toBeUndefined();
    expect(parseSeed('12a')).toBeUndefined();
    expect(parseSeed('')).toBeUndefined();
    expect(parseSeed('-1')).toBeUndefined();
  });

  it('島の名前は前後の空白を落とし、空文字と21文字以上は受け付けない', () => {
    expect(normalizeIslandName('  霧深い孤島  ')).toBe('霧深い孤島');
    expect(normalizeIslandName('   ')).toBeUndefined();
    expect(normalizeIslandName('あ'.repeat(20))).toBe('あ'.repeat(20));
    expect(normalizeIslandName('あ'.repeat(21))).toBeUndefined();
  });

  it('作成直後のセーブデータの生存日数は0になる', () => {
    const save = createSaveData('霧深い孤島', 42, 'farmer', 1700000000000);
    expect(save.elapsedDays).toBe(0);
    expect(save.seed).toBe(42);
    expect(save.createdAt).toBe(1700000000000);
  });
});

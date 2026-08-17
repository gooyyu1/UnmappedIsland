import { describe, expect, it } from 'vitest';
import { Settings } from '../../src/save/Settings';
import { assetPackMatches } from '../../src/asset-pack/install';
import { MemoryStorage } from '../support/MemoryStorage';

/** ゲームを始める前にだけ変えられる設定（StartScreen.md 画面構成 4）。 */
describe('設定', () => {
  it('アセットパックは、何も設定されていなければ読まない', () => {
    expect(new Settings(new MemoryStorage()).loadsAssetPack).toBe(false);
  });

  it('切り替えた値は保存先に残り、次に開いたときも同じ', () => {
    const storage = new MemoryStorage();

    new Settings(storage).loadsAssetPack = true;
    expect(new Settings(storage).loadsAssetPack).toBe(true);

    new Settings(storage).loadsAssetPack = false;
    expect(new Settings(storage).loadsAssetPack).toBe(false);
  });

  it('他タブや手動編集で壊れた値は、読まない側として読む', () => {
    const storage = new MemoryStorage();
    storage.setItem('unmapped-island:settings:asset-pack', 'yes');

    expect(new Settings(storage).loadsAssetPack).toBe(false);
  });
});

/**
 * 設定と、実際に入っているパックの照合。食い違いは読み込み直しでしか解けない（AssetPack.md 4節）。
 * テストの中ではパックを入れないので、「読む」と言われた側が食い違いになる。
 */
describe('設定とアセットパックの照合', () => {
  it('読まない設定なら、入っていないことと一致する', () => {
    expect(assetPackMatches(false)).toBe(true);
  });

  it('読む設定なのに入っていなければ、一致しない', () => {
    expect(assetPackMatches(true)).toBe(false);
  });
});

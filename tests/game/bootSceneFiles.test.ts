import { describe, expect, it } from 'vitest';
import { WORLD_CODEX_FILES } from '../../src/game/worldCodexFiles';
import { WORLD_CODEX_DIR, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * BootSceneが読み込むYAMLの一覧が、public/world-codex/ の中身と一致することを検査する。
 *
 * 他のテストはディレクトリ全体を一括ロードするため、この一覧への追加を忘れても全部通ってしまい、
 * 実際にゲームを起動したときだけ定義が欠ける。
 */
describe('BootSceneが読み込むWorldCodexのファイル一覧', () => {
  it('public/world-codex/ の中身と過不足なく一致する', () => {
    const prefix = `${WORLD_CODEX_DIR}/`;
    const onDisk = worldCodexYamlPaths().map((path) => path.slice(prefix.length).replaceAll('\\', '/'));

    expect([...WORLD_CODEX_FILES].sort()).toEqual([...onDisk].sort());
  });
});

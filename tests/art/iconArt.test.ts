import { existsSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../src/art/iconArt';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** アイコンの絵の置き場所（src/art/iconArt.ts の規約）。 */
const ART_DIR = 'src/assets/icons';

/**
 * 絵の解決は「ファイル名＝アイコンの識別子」という規約だけで成り立っており、コード側に対応表が
 * 無い。名前を間違えた絵は黙って使われないまま残るため、ここで実在の識別子かどうかを検査する
 * （objectArt.test.tsと同じ考え方）。
 *
 * **識別子を名乗るのはコードだけではない**——フィルターのボタンの絵は、ワールドの`card_filters`が
 * 名乗る（docs/ui/ScreenLayout.md 8.1.3節）。
 */
describe('アイコンの絵', () => {
  let filterIds: readonly string[];

  beforeAll(() => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    filterIds = codex.cardFilters.map((filter) => filter.id);
  });

  /** 絵はまだ1枚も無いことがある（ディレクトリごと存在しない）。 */
  function artNames(): string[] {
    if (!existsSync(ART_DIR)) return [];
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  it('ファイル名は、絵を引く側が名乗る識別子である', () => {
    for (const name of artNames())
      expect([...ICON_NAMES, ...filterIds], `'${name}.png' を引くものが無い`).toContain(name);
  });

  it('引く側の識別子は命名規則（3.2節）に従う', () => {
    for (const name of [...ICON_NAMES, ...filterIds]) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

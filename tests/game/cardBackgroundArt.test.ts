import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 設置物のカードの地に敷く背景の置き場所（src/game/ui/cardBackgroundArt.ts の規約）。 */
const ART_DIR = 'src/assets/card_backgrounds';

/**
 * 絵の解決は「ファイル名＝土地のobject_defの識別子」という規約だけで成り立っており、コード側に
 * 対応表が無い。名前を間違えた絵は黙って使われないまま残るため、ここで実在の土地かどうかを
 * 検査する（laneArt.test.ts / objectArt.test.tsと同じ考え方）。
 */
describe('カードの背景画像', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function artNames(): string[] {
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  it('ファイル名は、locationタグを持つ実在のobject_defの識別子である', () => {
    const locationTag = codex.tagNames.getId('location');
    const names = artNames();
    expect(names.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);

    for (const name of names) {
      const globalId = codex.objectNames.tryGetId(name);
      expect(globalId, `'${name}.png' に対応するobject_defが無い`).toBeDefined();
      if (globalId === undefined) continue;

      expect(codex.objects.get(globalId).tags, `'${name}.png' のobject_defは土地ではない`).toContain(
        locationTag,
      );
    }
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

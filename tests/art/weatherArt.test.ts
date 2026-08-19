import { existsSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 空の絵の置き場所（src/art/weatherArt.ts の規約）。 */
const ART_DIR = 'src/assets/weather';

/**
 * 絵の解決は「ファイル名＝天気の識別子」という規約だけで成り立っており、コード側に対応表が無い。
 * 名前を間違えた絵は黙って使われないまま残るため、ここで実在の識別子かどうかを検査する
 * （objectArt.test.tsと同じ考え方）。
 */
describe('空の絵', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /** 絵はまだ1枚も無いことがある（ディレクトリごと存在しない）。 */
  function artNames(): string[] {
    if (!existsSync(ART_DIR)) return [];
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  it('ファイル名は、実在するシンボル型プロパティの値である', () => {
    for (const name of artNames())
      expect(codex.symbolNames.tryGetId(name), `'${name}.png' に対応するシンボルが無い`).toBeDefined();
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

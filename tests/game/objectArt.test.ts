import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** object_defごとの絵の置き場所（src/game/ui/objectArt.ts の規約）。 */
const ART_DIR = 'src/assets/objects';

/**
 * 載り方が違う絵だけが名乗る接尾辞。objectArt.ts の MULTIPLY_SUFFIX に一致していなければならない。
 */
const MULTIPLY_SUFFIX = '_multiply';

/**
 * 絵の解決は「ファイル名＝object_defの識別子」という規約だけで成り立っており、コード側に対応表が無い。
 * 名前を間違えた絵は黙って使われないまま残るため、ここで実在の識別子かどうかを検査する。
 */
describe('object_defごとの絵', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function artNames(): string[] {
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  /** ファイル名が指すobject_defの識別子（乗算の絵は接尾辞を外したもの）。 */
  function objectNameOf(fileName: string): string {
    return fileName.endsWith(MULTIPLY_SUFFIX) ? fileName.slice(0, -MULTIPLY_SUFFIX.length) : fileName;
  }

  it('ファイル名は、実在するobject_defの識別子である', () => {
    const names = artNames();
    expect(names.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);

    for (const name of names) {
      expect(
        codex.objectNames.tryGetId(objectNameOf(name)),
        `'${name}.png' に対応するobject_defが無い`,
      ).toBeDefined();
    }
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

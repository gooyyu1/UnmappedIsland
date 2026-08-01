import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 背景画像の置き場所（src/game/ui/backgroundArt.ts の規約）。 */
const ART_DIR = 'src/assets/backgrounds';

/**
 * 土地ごとに絵が変わる用途の接尾辞。backgroundArt.ts の LocationLane と CARD_BACKGROUND_SUFFIX に
 * 一致していなければならない。
 */
const LOCATION_SUFFIXES = ['fixture', 'item', 'card_background'];

/** 土地によらない絵。 */
const FIXED_ART = ['hand'];

/**
 * 絵の解決は「ファイル名＝`<土地のobject_defの識別子>_<用途>`」という規約だけで成り立っており、
 * コード側に対応表が無い。名前を間違えた絵は黙って使われないまま残るため、ここで実在の土地かどうかを
 * 検査する（objectArt.test.tsと同じ考え方）。
 */
describe('背景画像', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function artNames(): string[] {
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  /** ファイル名を土地と用途へ分ける（どの用途の接尾辞も付いていなければundefined）。 */
  function split(name: string): { location: string; suffix: string } | undefined {
    for (const suffix of LOCATION_SUFFIXES) {
      if (name.endsWith(`_${suffix}`)) {
        return { location: name.slice(0, -`_${suffix}`.length), suffix };
      }
    }
    return undefined;
  }

  it('土地によらない絵が揃っている', () => {
    expect(artNames()).toEqual(expect.arrayContaining(FIXED_ART));
  });

  it('ファイル名の接尾辞は、土地ごとに絵が変わる用途のものだけ', () => {
    for (const name of artNames()) {
      if (FIXED_ART.includes(name)) continue;
      expect(split(name), `'${name}.png' がどの用途の絵か分からない`).toBeDefined();
    }
  });

  it('ファイル名の土地の部分は、locationタグを持つ実在のobject_defの識別子である', () => {
    const locationTag = codex.tagNames.getId('location');
    let checked = 0;

    for (const name of artNames()) {
      const parts = split(name);
      if (parts === undefined) continue;

      const globalId = codex.objectNames.tryGetId(parts.location);
      expect(globalId, `'${name}.png' に対応するobject_defが無い`).toBeDefined();
      if (globalId === undefined) continue;

      expect(codex.objects.get(globalId).tags, `'${name}.png' のobject_defは土地ではない`).toContain(
        locationTag,
      );
      checked += 1;
    }
    expect(checked, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);
  });

  it('どの用途の絵も少なくとも1枚は置かれている', () => {
    const found = new Set(artNames().map((name) => split(name)?.suffix));
    for (const suffix of LOCATION_SUFFIXES)
      expect(found, `接尾辞 '_${suffix}' の絵が1枚も無い`).toContain(suffix);
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

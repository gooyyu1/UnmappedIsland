import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 背景画像の置き場所（src/game/ui/backgroundArt.ts の規約）。 */
const ART_DIR = 'src/assets/backgrounds';

/**
 * 対象ごとに絵が変わる用途の接尾辞。backgroundArt.ts の LocationLane と CARD_BACKGROUND_SUFFIX に
 * 一致していなければならない。
 *
 * レーンの2つは土地の絵に限られるが、カードの地は**そのカードが何の上に在るか**なので、土地の
 * ほかに怪我を負う身体も対象になる（CardView.md 7節）。
 */
const LANE_SUFFIXES = ['fixture', 'item'];
const CARD_BACKGROUND_SUFFIX = 'card_background';
const SUBJECT_SUFFIXES = [...LANE_SUFFIXES, CARD_BACKGROUND_SUFFIX];

/** 対象によらない絵。 */
const FIXED_ART = ['hand'];

/**
 * 絵の解決は「ファイル名＝`<対象のobject_defの識別子>_<用途>`」という規約だけで成り立っており、
 * コード側に対応表が無い。名前を間違えた絵は黙って使われないまま残るため、ここで実在の対象かどうかを
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

  /** ファイル名を対象と用途へ分ける（どの用途の接尾辞も付いていなければundefined）。 */
  function split(name: string): { subject: string; suffix: string } | undefined {
    for (const suffix of SUBJECT_SUFFIXES) {
      if (name.endsWith(`_${suffix}`)) {
        return { subject: name.slice(0, -`_${suffix}`.length), suffix };
      }
    }
    return undefined;
  }

  /** そのobject_defが土地か（レーンの背景の対象になれるか）。 */
  function isLocation(globalId: number): boolean {
    return codex.objects.get(globalId).tags.includes(codex.tagNames.getId('location'));
  }

  /** そのobject_defが怪我を負う身体か——injuriesスロットを持てば、その肌がカードの地になりうる。 */
  function isBody(globalId: number): boolean {
    const injuriesSlotId = codex.slotNames.tryGetId('injuries');
    return (
      injuriesSlotId !== undefined && codex.objects.get(globalId).getSlotDef(injuriesSlotId) !== undefined
    );
  }

  it('対象によらない絵が揃っている', () => {
    expect(artNames()).toEqual(expect.arrayContaining(FIXED_ART));
  });

  it('ファイル名の接尾辞は、対象ごとに絵が変わる用途のものだけ', () => {
    for (const name of artNames()) {
      if (FIXED_ART.includes(name)) continue;
      expect(split(name), `'${name}.png' がどの用途の絵か分からない`).toBeDefined();
    }
  });

  it('ファイル名の対象の部分は、実在するobject_defの識別子である', () => {
    let checked = 0;

    for (const name of artNames()) {
      const parts = split(name);
      if (parts === undefined) continue;

      expect(
        codex.objectNames.tryGetId(parts.subject),
        `'${name}.png' に対応するobject_defが無い`,
      ).toBeDefined();
      checked += 1;
    }
    expect(checked, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);
  });

  it('レーンの背景の対象は土地で、カードの地の対象は土地か怪我を負う身体である', () => {
    for (const name of artNames()) {
      const parts = split(name);
      const globalId = parts === undefined ? undefined : codex.objectNames.tryGetId(parts.subject);
      if (parts === undefined || globalId === undefined) continue;

      if (parts.suffix === CARD_BACKGROUND_SUFFIX) {
        expect(
          isLocation(globalId) || isBody(globalId),
          `'${name}.png' のobject_defは土地でも身体でもない`,
        ).toBe(true);
      } else {
        expect(isLocation(globalId), `'${name}.png' のobject_defは土地ではない`).toBe(true);
      }
    }
  });

  it('どの用途の絵も少なくとも1枚は置かれている', () => {
    const found = new Set(artNames().map((name) => split(name)?.suffix));
    for (const suffix of SUBJECT_SUFFIXES)
      expect(found, `接尾辞 '_${suffix}' の絵が1枚も無い`).toContain(suffix);
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

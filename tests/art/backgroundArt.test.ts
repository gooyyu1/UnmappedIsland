import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 背景画像の置き場所（src/art/backgroundArt.ts の規約）。 */
const ART_DIR = 'src/assets/backgrounds';

/** 敷く場所。backgroundArt.ts の Use に一致していなければならない。 */
const USES = ['lane', 'card'];

/**
 * 絵の解決は「ファイル名＝`<持ち主>_<スロット名>_<用途>`」という規約だけで成り立っており、コード側に
 * 対応表が無い。**どのスロットの絵かはファイル名しか言わない**ので、名前を間違えた絵は黙って使われない
 * まま残る。ここで、実在する持ち主の・実在するスロットを指しているかを検査する
 * （objectArt.test.tsと同じ考え方）。
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

  /**
   * ファイル名を持ち主・スロット・用途へ分ける。スロット名にも用途にも `_` は入らないので、
   * 末尾から2つを外した残りが持ち主（持ち主によらない絵ではundefined）。
   */
  function split(name: string): { owner: string | undefined; slot: string; use: string } | undefined {
    const parts = name.split('_');
    if (parts.length < 2) return undefined;
    const use = parts[parts.length - 1] ?? '';
    if (!USES.includes(use)) return undefined;
    return {
      owner: parts.length > 2 ? parts.slice(0, -2).join('_') : undefined,
      slot: parts[parts.length - 2] ?? '',
      use,
    };
  }

  it('ファイル名は、敷く場所（lane/card）で終わる', () => {
    const names = artNames();
    expect(names.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);

    for (const name of names) {
      expect(split(name), `'${name}.png' がどこへ敷く絵か分からない`).toBeDefined();
    }
  });

  it('ファイル名のスロットは、その持ち主が実際に持っているスロットである', () => {
    let checked = 0;

    for (const name of artNames()) {
      const parts = split(name);
      // 持ち主によらない絵（hand_lane）は、どのobject_defにも紐づかない受け皿。
      if (parts?.owner === undefined) continue;

      const globalId = codex.objectNames.tryGetId(parts.owner);
      expect(globalId, `'${name}.png' に対応するobject_defが無い`).toBeDefined();
      if (globalId === undefined) continue;

      const slotId = codex.slotNames.tryGetId(parts.slot);
      expect(slotId, `'${name}.png' のスロット '${parts.slot}' は存在しない`).toBeDefined();
      if (slotId === undefined) continue;

      expect(
        codex.objects.get(globalId).getSlotDef(slotId),
        `'${name}.png' の '${parts.owner}' は '${parts.slot}' スロットを持たない`,
      ).toBeDefined();
      checked += 1;
    }
    expect(checked, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);
  });

  it('どの用途の絵も少なくとも1枚は置かれている', () => {
    const found = new Set(artNames().map((name) => split(name)?.use));
    for (const use of USES) expect(found, `用途 '${use}' の絵が1枚も無い`).toContain(use);
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

import { existsSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
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
 * **識別子の出どころは3つある。** 画面が固定で置くボタンはUIが決める（ICON_NAMES）が、状況アイコンは
 * 段の`situation`が名乗り（docs/ui/ScreenLayout.md 4.1.1節）、フィルターのボタンは`card_filters`が
 * 名乗る（同8.1.3節）ので、どちらも同梱の宣言から集める。
 */
describe('アイコンの絵', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 絵はまだ1枚も無いことがある（ディレクトリごと存在しない）。 */
  function artNames(): string[] {
    if (!existsSync(ART_DIR)) return [];
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  /** 同梱の宣言のうち、段が名乗っている状況アイコンの識別子。 */
  function situationNames(): string[] {
    const situations = new Set<string>();
    for (let globalId = 0; globalId < codex.objects.count; globalId++)
      for (const propertyDef of codex.objects.get(globalId).enumeratePropertyDefs())
        for (const stage of propertyDef.stages)
          if (stage.situation !== undefined) situations.add(stage.situation);
    return [...situations];
  }

  /** 絵を引く側が名乗っている識別子（画面・段・フィルター）。 */
  function drawnNames(): string[] {
    return [...ICON_NAMES, ...situationNames(), ...codex.cardFilters.map((filter) => filter.id)];
  }

  it('ファイル名は、絵を引く側が名乗る識別子である', () => {
    const drawn = drawnNames();
    for (const name of artNames()) expect(drawn, `'${name}.png' を引くものが無い`).toContain(name);
  });

  it('引く側の識別子は命名規則（3.2節）に従う', () => {
    for (const name of drawnNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

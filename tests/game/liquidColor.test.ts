import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { coloredLiquidNames, liquidColorOf } from '../../src/game/ui/liquidColor';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 中身のバーの色は、液体のobject_defの識別子で引く（src/game/ui/liquidColor.ts）。定義を足し忘れた
 * 液体は灰色で出てしまい画面を見ても気付けないため、実在の液体との過不足をここで検査する。
 */
describe('液体ごとのバーの色', () => {
  let codex: WorldCodex;

  /** liquidタグが付いたobject_def＝バーで中身として出うる液体（liquid_containers.yaml）。 */
  function liquidNames(): readonly string[] {
    return codex.objectDefNamesWithTag('liquid');
  }

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  it('液体はすべて色を持つ', () => {
    const names = liquidNames();
    expect(names.length, '検査対象が無い（liquidタグが変わっていないか）').toBeGreaterThan(0);

    for (const name of names) {
      expect(coloredLiquidNames(), `'${name}' の色が定義されていない`).toContain(name);
    }
  });

  it('色を定義してある識別子は、実在する液体である', () => {
    for (const name of coloredLiquidNames()) expect(liquidNames()).toContain(name);
  });

  it('水は青、茶は茶緑、油は黄色で、互いに見分けが付く', () => {
    const colors = ['water_liquid', 'tea_liquid', 'oil_liquid'].map((name) => liquidColorOf(name));
    expect(new Set(colors).size, '同じ色の液体が無い').toBe(colors.length);

    const [water, tea, oil] = colors.map((color) => ({
      red: (color >> 16) & 0xff,
      green: (color >> 8) & 0xff,
      blue: color & 0xff,
    }));
    expect(water.blue, '水は青が最も強い').toBeGreaterThan(Math.max(water.red, water.green));
    expect(tea.green, '茶は緑が最も強い').toBeGreaterThan(Math.max(tea.red, tea.blue));
    expect(Math.min(oil.red, oil.green), '油は赤と緑が揃って強い＝黄色').toBeGreaterThan(oil.blue);
  });

  it('色の分からない液体でも、中身があること自体は見える色になる', () => {
    expect(liquidColorOf('unknown_liquid')).toBe(liquidColorOf(undefined));
  });
});

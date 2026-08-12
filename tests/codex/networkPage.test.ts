import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CodexSource } from '../../src/codex/CodexSource';
import { CodexView } from '../../src/codex/CodexView';
import { renderNetworkPage } from '../../src/codex/networkPage';
import { renderObjectPage } from '../../src/codex/pages';
import { LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * クラフトネットワークのページの検証。同梱の定義を読み、ユーザーが目で辿る形
 * （土地 → 探索 → 素材 → 道具タグ → 加工 → 成果物）がHTMLに現れることを確かめる。
 */
describe('クラフトネットワークのページ', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  const locale = parseLocale(LOCALE_FILE, readFileSync(`public/${LOCALE_FILE}`, 'utf8'));
  const view = new CodexView(new CodexSource(codex, locale, ['test']), 'display');

  it('型・工程・タグのノードが1枚のSVGに出る', () => {
    const html = renderNetworkPage(view);

    // 型は絵つきで、クリックでそのページへ。
    expect(html).toContain('id="net-o:coconut"');
    expect(html).toContain('href="#/object/coconut"');
    // 工程はラベル無しの丸として出て、名前はツールチップ、クリックで宣言元の型のページへ。
    expect(html).toMatch(/net-step[^>]*href="#\/object\/sandy_beach"[^>]*><circle/);
    expect(html).toContain('<title>探索する（sandy_beach.explore）</title>');
    // withタグは挟まって出る。
    expect(html).toContain('id="net-o:sharp_stone"');
    expect(html).toContain('>cutting_tool</text>');
  });

  it('拡大・縮小の操作が付く', () => {
    const html = renderNetworkPage(view);

    expect(html).toContain('data-network-zoom="in"');
    expect(html).toContain('data-network-zoom="out"');
    expect(html).toContain('data-network-zoom="reset"');
  });

  it('消費されない入力（道具）は破線になる', () => {
    // 皮をはぐ（husk）の刃物はdestroyされない＝破線の入力。
    expect(renderNetworkPage(view)).toContain('net-input net-dashed');
  });

  it('複数生まれる出力には×Nが付く', () => {
    expect(renderNetworkPage(view)).toContain('>×2</text>');
  });

  it('ハイライトは対象のチェーンを強調し、それ以外を薄める', () => {
    const html = renderNetworkPage(view, 'husked_coconut');

    expect(html).toMatch(/net-target[^>]*id="net-o:husked_coconut"/);
    expect(html).toContain('net-hl');
    expect(html).toContain('net-dim');
    // 解除の導線がある。
    expect(html).toContain('href="#/network"');
  });

  it('クラフトに関わる型のページからネットワークへ飛べる', () => {
    expect(renderObjectPage(view, 'coconut')).toContain('#/network/coconut');
    // クラフトに関わらない型にはリンクを出さない（行き先の図に居ないため）。
    expect(renderObjectPage(view, 'world')).not.toContain('#/network/world');
  });
});

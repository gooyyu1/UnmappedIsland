import { describe, expect, it } from 'vitest';
import { CodexSource } from '../../src/codex-viewer/CodexSource';
import { CodexView } from '../../src/codex-viewer/CodexView';
import { renderNetworkPage } from '../../src/codex-viewer/networkPage';
import { renderObjectPage } from '../../src/codex-viewer/pages';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * クラフトネットワークのページの検証。ユーザーが目で辿る形（土地 → 探索 → 素材 → 道具タグ →
 * 加工 → 成果物）がHTMLに現れることを確かめる。
 *
 * **同梱の定義は読まない**。図に出るのは「何がどこから生まれ、何を道具に使うか」だけなので、
 * その繋がりを1本その場に書けば足りる。
 */
const YAML = `
object_defs:
  # クラフトに関わらない型。図に居ないので、ページからのリンクも出ない。
  world:
    singleton: true

  sandy_beach:
    tags: [location]
    actions:
      explore:
        duration: 30
        spawn: {object: coconut}

  coconut:
    tags: [item]
    combinations:
      # 刃物はdestroyされない＝消費されない入力（道具）。
      husk:
        with: {tag: cutting_tool}
        destroy: self
        spawn: {object: husked_coconut}

  husked_coconut:
    tags: [item]
    combinations:
      crack:
        with: {tag: cutting_tool}
        destroy: self
        spawn: {object: coconut_half, count: 2}

  coconut_half: {tags: [item]}
  woven_leaf: {tags: [item]}

  # 道具そのものも作られる物なので、図に並ぶ。
  stone:
    tags: [item]
    combinations:
      knap:
        with: {object: stone}
        destroy: self
        spawn: {object: sharp_stone}

  sharp_stone: {tags: [item, cutting_tool]}

  # ヤシの実の繋がりの外に居る型。強調したときに薄まる側。
  woven_basket:
    tags: [item]
    recipes:
      woven:
        steps:
          - requires: [{object: woven_leaf, count: 6, consume: true}]
            duration: 120
`;

const LOCALE = `
object_texts:
  sandy_beach:
    interactions:
      explore:
        display_name: 探索する
`;

describe('クラフトネットワークのページ', () => {
  const codex = new WorldCodexYamlLoader().load('network.yaml', YAML).build();
  const locale = parseLocale('ja.yaml', LOCALE);
  const view = new CodexView(new CodexSource(codex, locale, ['network.yaml']), 'display');

  it('型・工程・タグのノードが1枚のSVGに出る', () => {
    const html = renderNetworkPage(view);

    // 型は絵つきで、強調前はクリックで強調表示（ページへは飛ばない）。
    expect(html).toMatch(/id="net-o:coconut" href="#\/network\/coconut"/);
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

  it('強調中の型はページへ、強調されていない型は強調表示へ飛ぶ', () => {
    const html = renderNetworkPage(view, 'husked_coconut');

    // 対象そのものと、チェーン上（強調中）の型はページへ。
    expect(html).toMatch(/id="net-o:husked_coconut" href="#\/object\/husked_coconut"/);
    expect(html).toMatch(/net-hl[^>]*id="net-o:coconut" href="#\/object\/coconut"/);
    // チェーンの外（薄い側）の型は、押すとそちらの強調へ切り替わる。
    expect(html).toMatch(/net-dim[^>]*id="net-o:woven_basket" href="#\/network\/woven_basket"/);
  });

  it('クラフトに関わる型のページからネットワークへ飛べる', () => {
    expect(renderObjectPage(view, 'coconut')).toContain('#/network/coconut');
    // クラフトに関わらない型にはリンクを出さない（行き先の図に居ないため）。
    expect(renderObjectPage(view, 'world')).not.toContain('#/network/world');
  });
});

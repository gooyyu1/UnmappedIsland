import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CodexSource } from '../../src/codex/CodexSource';
import { CodexView } from '../../src/codex/CodexView';
import {
  renderObjectListPage,
  renderObjectPage,
  renderObjectsByTagPage,
  renderPropertyPage,
  renderSlotPage,
  renderTagListPage,
} from '../../src/codex/pages';
import { LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * ビューアのページ組み立てのテスト。同梱の定義・表示文字列をそのまま読み、
 * 「ゲームと同じ表示名・説明文・絵が出ること」と「識別子の見せ方を切り替えられること」を確かめる。
 * ページはDOMに触れず文字列を返すだけなので、ブラウザ無しで検証できる。
 */
describe('WorldCodexビューアのページ', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  const locale = parseLocale(LOCALE_FILE, readFileSync(`public/${LOCALE_FILE}`, 'utf8'));
  const source = new CodexSource(codex, locale, ['coconut.yaml']);
  const view = new CodexView(source, 'display');
  const identifierView = new CodexView(source, 'identifier');

  it('一覧はすべての型を、絵と表示名つきで並べる', () => {
    const html = renderObjectListPage(view);

    expect(html).toContain('data-name="coconut"');
    expect(html).toContain('熟したヤシの実');
    // 絵はゲームと同じ画像を参照する（src/assets/objects/<識別子>.png）。
    expect(html).toMatch(/<img class="art art-thumb" src="[^"]*coconut[^"]*"/);
  });

  it('オブジェクトのページに表示名・説明文・定義の中身が出る', () => {
    const html = renderObjectPage(view, 'coconut');

    expect(html).toContain('熟したヤシの実');
    expect(html).toContain('厚い繊維の皮に覆われた実');
    // combinationは表示名・説明文と、効果の中身の両方が出る。
    expect(html).toContain('皮をはぐ');
    expect(html).toContain('husked_coconut'); // spawn先へのリンク（title属性の識別子）
    expect(html).toContain('#/object/husked_coconut');
  });

  it('識別子モードでは参照が識別子で出る', () => {
    expect(renderObjectPage(identifierView, 'coconut')).not.toContain('熟したヤシの実');
    expect(renderObjectPage(identifierView, 'coconut')).toContain('<h1>coconut</h1>');
  });

  it('土地の型の表示名と亜種はlocation_textsから引く', () => {
    const html = renderObjectPage(view, 'sandy_beach');

    expect(html).toContain('砂浜');
    expect(html).toContain('亜種（土地の名前）');
    expect(html).toContain('ヤシの浜');
  });

  it('プロパティのページに影響元が出る', () => {
    const html = renderPropertyPage(view, 'world', 'sunlight');

    expect(html).toContain('影響元');
    expect(html).toContain('modify');
    expect(html).toContain('#/object/world');
  });

  it('スロットからその型を辿れる', () => {
    expect(renderSlotPage(view, 'contents')).toContain('#/object/woven_basket');
  });

  it('タグ一覧はタグと件数だけを出す（型そのものはタグ別の一覧が持つ）', () => {
    const html = renderTagListPage(view);

    expect(html).toContain('#/by-tag/item');
    expect(html).toContain('#/by-tag/location');
    expect(html).not.toContain('#/object/');
  });

  it('タグ別の一覧は、全タグの節を1ページに絵つきで並べる', () => {
    const html = renderObjectsByTagPage(view);

    expect(html).toContain('id="tag-item"');
    expect(html).toContain('id="tag-location"');
    // 節の中身は一覧と同じ絵つきのカード。
    expect(html).toContain('data-name="coconut"');
    expect(html).toMatch(/<img class="art art-thumb" src="[^"]*sandy_beach[^"]*"/);
    // どの型もどこかの節に出るよう、タグを持たない型（world）もまとめて出す。
    expect(html).toContain('タグなし');
    expect(html).toContain('data-name="world"');
  });

  it('オブジェクト一覧から、タグ別の一覧とタグ一覧の両方へ行ける', () => {
    const html = renderObjectListPage(view);

    expect(html).toContain('href="#/by-tag"');
    expect(html).toContain('href="#/tags"');
  });

  it('生まれる側から、それを生み出す操作を辿れる', () => {
    // 太い枝は土地の探索から手に入る（spawn元の逆引き）。
    const html = renderObjectPage(view, 'thick_branch');

    expect(html).toContain('この型を生み出す操作');
    expect(html).toContain('#/object/sandy_beach');
    expect(html).toContain('探索する');
    // 箇条書きにどの型のどの操作かだけを出し、探索のpickの木（weightの並び）は持ち込まない。
    expect(html).not.toContain('weight = ');
  });

  it('材料から、それを使うレシピの完成品を辿れる', () => {
    const html = renderObjectPage(view, 'woven_leaf');

    expect(html).toContain('この型を材料・道具に使うレシピ');
    expect(html).toContain('#/object/woven_basket');
    // 完成品の名前だけで足りる（作り方は完成品のページにある）。
    expect(html).not.toContain('工程1');
  });

  it('存在しない型・プロパティはエラーとして出す', () => {
    expect(renderObjectPage(view, 'no_such_object')).toContain('見つかりません');
    expect(renderPropertyPage(view, 'coconut', 'no_such_prop')).toContain('ありません');
  });

  it('識別子はHTMLとして解釈されないようエスケープする', () => {
    expect(renderObjectPage(view, '<script>')).toContain('&lt;script&gt;');
    expect(renderObjectPage(view, '<script>')).not.toContain('<script>');
  });
});

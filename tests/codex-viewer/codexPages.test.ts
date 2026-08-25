import { describe, expect, it } from 'vitest';
import { ART_BY_OBJECT_NAME } from '../../src/art/objectArt';
import { CodexSource } from '../../src/codex-viewer/CodexSource';
import { CodexView } from '../../src/codex-viewer/CodexView';
import type { CodexPage } from '../../src/codex-viewer/CodexPage';
import {
  ObjectListPage,
  ObjectPage,
  ObjectsByTagPage,
  PropertyPage,
  SlotPage,
  TagListPage,
} from '../../src/codex-viewer/pages';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * ビューアのページ組み立てのテスト。ページはDOMに触れず文字列を返すだけなので、ブラウザ無しで
 * 検証できる。
 *
 * **同梱の定義は読まない**。ここで見るのは「どの宣言がページのどこへ出るか」で、同梱のYAMLに
 * 何が書いてあるかは関係しない。
 */

/**
 * 絵が用意されている型の識別子を2つ借りる（`src/assets/objects/<識別子>.png`）。
 *
 * **絵の在庫だけは借り物**——絵の有無で出し分ける規約（ART_BY_OBJECT_NAME）を確かめるには、実在する
 * ファイル名が要る。どれでもよいので、在庫の先頭から取る。
 */
const [DRAWN_ITEM, DRAWN_LAND] = [...ART_BY_OBJECT_NAME.keys()].sort();

/** ページ1枚を組み立てる。引数が足りなければページはundefinedを返すので、ここで落とす。 */
function pageHtml(page: CodexPage, view: CodexView, ...args: readonly string[]): string {
  const html = page.render(view, args);
  if (html === undefined) throw new Error(`${page.route}に渡した引数が足りない`);
  return html;
}

const renderObjectListPage = (view: CodexView): string => pageHtml(new ObjectListPage(), view);
const renderObjectPage = (view: CodexView, name: string): string => pageHtml(new ObjectPage(), view, name);
const renderObjectsByTagPage = (view: CodexView): string => pageHtml(new ObjectsByTagPage(), view);
const renderPropertyPage = (view: CodexView, objectName: string, propertyName: string): string =>
  pageHtml(new PropertyPage(), view, objectName, propertyName);
const renderSlotPage = (view: CodexView, slotName: string): string =>
  pageHtml(new SlotPage(), view, slotName);
const renderTagListPage = (view: CodexView): string => pageHtml(new TagListPage(), view);

const YAML = `
object_defs:
  world:
    singleton: true
    props:
      ambient_brightness: {value: 0, range: {min: -6, max: 17}}
      hour:
        value: 0
        range: {min: 0, max: 24}
        stages:
          - name: night
            passives:
              - modify: {self: {ambient_brightness: -5}}

  ${DRAWN_LAND}:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
    interactions:
      explore:
        trigger: menu
        duration: 30
        spawn: {object: thick_branch}

  thick_branch: {tags: [item]}
  woven_leaf: {tags: [item]}
  sharp_stone: {tags: [item, cutting_tool]}

  ${DRAWN_ITEM}:
    tags: [item]
    interactions:
      husk:
        trigger: {drag: {tag: cutting_tool}}
        destroy: self
        spawn: {object: husked_coconut}

  husked_coconut:
    tags: [item]
    interactions:
      crack:
        trigger: {drag: {tag: cutting_tool}}
        destroy: self
        # 割ると2つできる（spawnのcount、9.4節）。
        spawn: {object: coconut_half, count: 2}

  coconut_half: {tags: [item]}

  woven_basket:
    tags: [item]
    storage: true
    slots:
      contents:
        cell_count: 10
        capacity: 20000
        cell: {accept: {tag: item}}
    recipes:
      woven:
        steps:
          - requires: [{object: woven_leaf, count: 6, consume: true}]
            duration: 120

axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}

location_types:
  ${DRAWN_LAND}:
    object_def: ${DRAWN_LAND}
    variants:
      - {id: palm}
      - {id: crab}
    applicable_scopes: [island]
    axis_preferences:
      elevation: {ideal: 10, tolerance: 30, weight: 100}

generation_scopes:
  island:
    site_count: {min: 10, max: 20}
    coast_band: 15
    hull_coast: true
    interior_bias: 0.6
    diameter_meters: 6700
    walk_meters_per_hour: 4000
    climb_meters_per_hour: 600
    elevation_axis: elevation
    elevation_top_meters: 400
`;

const LOCALE = `
object_texts:
  ${DRAWN_ITEM}:
    display_name: 熟したヤシの実
    description: 厚い繊維の皮に覆われた実。
    interactions:
      husk:
        display_name: 皮をはぐ
location_texts:
  ${DRAWN_LAND}:
    display_name: 砂浜
    variants:
      palm: {display_name: ヤシの浜}
`;

describe('WorldCodexビューアのページ', () => {
  const codex = new WorldCodexYamlLoader().load('viewer.yaml', YAML).buildAndReset();
  const locale = parseLocale('ja.yaml', LOCALE);
  const source = new CodexSource(codex, locale, ['viewer.yaml']);
  const view = new CodexView(source, 'display');
  const identifierView = new CodexView(source, 'identifier');

  it('一覧はすべての型を、絵と表示名つきで並べる', () => {
    const html = renderObjectListPage(view);

    expect(html).toContain(`data-name="${DRAWN_ITEM}"`);
    expect(html).toContain('熟したヤシの実');
    // 絵はゲームと同じ画像を参照する（src/assets/objects/<識別子>.png）。
    expect(html).toMatch(new RegExp(`<img class="art art-thumb" src="[^"]*${DRAWN_ITEM}[^"]*"`));
  });

  it('絵が用意されていない型は、絵の場所を空けておく', () => {
    expect(renderObjectListPage(view)).toContain('art-thumb art-missing');
  });

  it('製作中オブジェクトは一覧に出さない（完成品のrecipesに同じ内容が出ているため）', () => {
    const inProgress = 'woven_basket__woven';

    expect(renderObjectListPage(view)).not.toContain(inProgress);
    expect(renderObjectsByTagPage(view)).not.toContain(inProgress);
    // 識別子で名指しすれば個別のページは開ける（完成品への行き先つき）。
    expect(renderObjectPage(view, inProgress)).toContain('#/object/woven_basket');
  });

  it('オブジェクトのページに表示名・説明文・定義の中身が出る', () => {
    const html = renderObjectPage(view, DRAWN_ITEM);

    expect(html).toContain('熟したヤシの実');
    expect(html).toContain('厚い繊維の皮に覆われた実');
    // combinationは表示名・説明文と、効果の中身の両方が出る。
    expect(html).toContain('皮をはぐ');
    expect(html).toContain('husked_coconut'); // spawn先へのリンク（title属性の識別子）
    expect(html).toContain('#/object/husked_coconut');
  });

  it('識別子モードでは参照が識別子で出る', () => {
    expect(renderObjectPage(identifierView, DRAWN_ITEM)).not.toContain('熟したヤシの実');
    expect(renderObjectPage(identifierView, DRAWN_ITEM)).toContain(`<h1>${DRAWN_ITEM}</h1>`);
  });

  it('土地の型の表示名と亜種はlocation_textsから引く', () => {
    const html = renderObjectPage(view, DRAWN_LAND);

    expect(html).toContain('砂浜');
    expect(html).toContain('亜種（土地の名前）');
    expect(html).toContain('ヤシの浜');
  });

  it('プロパティのページに影響元が出る', () => {
    const html = renderPropertyPage(view, 'world', 'ambient_brightness');

    expect(html).toContain('影響元');
    expect(html).toContain('modify');
    expect(html).toContain('#/object/world');
  });

  it('スロットからその型を辿れる', () => {
    expect(renderSlotPage(view, 'contents')).toContain('#/object/woven_basket');
  });

  it('slotsは1スロット1行の表で出す', () => {
    const html = renderObjectPage(view, 'woven_basket');
    const slots = html.slice(html.indexOf('<h2>slots</h2>'));

    expect(slots).toContain('<th>受け入れる型</th>');
    expect(slots).toContain('<th>枠数</th>');
    // 中身のスロットは枠10・capacity 20000で、itemタグを受け入れる。
    expect(slots).toContain('<td>10</td><td>20000</td>');
    expect(slots).toContain('#/by-tag/item');
  });

  it('同じものを複数spawnする操作は×Nで出す', () => {
    expect(renderObjectPage(view, 'husked_coconut')).toContain('×2');
  });

  it('タグ一覧はタグ・件数・そのタグの型の絵を出す（型の一覧はタグ別の一覧が持つ）', () => {
    const html = renderTagListPage(view);

    expect(html).toContain('#/by-tag/item');
    // itemを名乗るのは、枝・葉・刃物・実・皮を剥いだ実・割れた実・籠の7つ。
    expect(html).toContain('item <span class="muted">(7)</span>');
    // 製作中オブジェクトだけが持つタグは、行き先が空になるので出さない。
    expect(html).not.toContain('#/by-tag/wip');
    // 絵は、そのタグを持つ型のうち絵が用意されている最初のものを借りる。
    expect(html).toMatch(
      new RegExp(`<img class="art art-thumb" src="[^"]*${DRAWN_LAND}[^"]*"[^>]*>[^<]*<span[^>]*>location`),
    );
    expect(html).not.toContain('#/object/');
  });

  it('タグ別の一覧は、全タグの節を1ページに絵つきで並べる', () => {
    const html = renderObjectsByTagPage(view);

    expect(html).toContain('id="tag-item"');
    expect(html).toContain('id="tag-location"');
    // 節の中身は一覧と同じ絵つきのカード。
    expect(html).toContain(`data-name="${DRAWN_ITEM}"`);
    expect(html).toMatch(new RegExp(`<img class="art art-thumb" src="[^"]*${DRAWN_LAND}[^"]*"`));
    // どの型もどこかの節に出るよう、タグを持たない型（world）もまとめて出す。
    expect(html).toContain('タグなし');
    expect(html).toContain('data-name="world"');
  });

  it('オブジェクト一覧から、タグ別の一覧とタグ一覧の両方へ行ける', () => {
    const html = renderObjectListPage(view);

    expect(html).toContain('href="#/by-tag"');
    expect(html).toContain('href="#/tags"');
  });

  it('生まれる側から、それを生み出す型を絵で辿れる', () => {
    // 太い枝は土地の探索から手に入る（spawn元の逆引き）。
    const html = renderObjectPage(view, 'thick_branch');

    expect(html).toContain('この型を生み出すもの');
    expect(html).toContain(`#/object/${DRAWN_LAND}`);
    expect(html).toMatch(new RegExp(`<img class="art art-thumb" src="[^"]*${DRAWN_LAND}[^"]*"`));
    // 行き先の型を並べるだけで、操作の名前も探索のpickの木（weightの並び）も持ち込まない。
    expect(html).not.toContain('探索する');
    expect(html).not.toContain('weight = ');
  });

  it('材料から、それを使うレシピの完成品を絵で辿れる', () => {
    const html = renderObjectPage(view, 'woven_leaf');

    expect(html).toContain('この型を材料・道具に使うもの');
    expect(html).toContain('#/object/woven_basket');
    // 完成品を並べるだけで足りる（作り方は完成品のページにある）。
    expect(html).not.toContain('工程1');
  });

  it('存在しない型・プロパティはエラーとして出す', () => {
    expect(renderObjectPage(view, 'no_such_object')).toContain('見つかりません');
    expect(renderPropertyPage(view, DRAWN_ITEM, 'no_such_prop')).toContain('ありません');
  });

  it('識別子はHTMLとして解釈されないようエスケープする', () => {
    expect(renderObjectPage(view, '<script>')).toContain('&lt;script&gt;');
    expect(renderObjectPage(view, '<script>')).not.toContain('<script>');
  });
});

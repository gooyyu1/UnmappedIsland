import { describe, expect, it } from 'vitest';
import type {
  ChainRoute,
  ConsumptionRow,
  DeviceRow,
  ObjectCost,
  SupplyRow,
} from '../../src/analysis/balanceTables';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import type { RainWaterRow } from '../../src/analysis/seasonalRain';
import { ART_BY_NAME } from '../../src/art/objectArt';
import { BalancePage } from '../../src/codex-viewer/balancePage';
import { CodexSource } from '../../src/codex-viewer/CodexSource';
import { CodexView } from '../../src/codex-viewer/CodexView';
import type { CodexPage } from '../../src/codex-viewer/CodexPage';
import { escapeHtml } from '../../src/codex-viewer/html';
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
 * **絵の在庫だけは借り物**——絵の有無で出し分ける規約（ART_BY_NAME）を確かめるには、実在する
 * ファイル名が要る。どれでもよいので、在庫の先頭から取る。
 */
const [DRAWN_ITEM, DRAWN_LAND] = [...ART_BY_NAME.keys()].sort();

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

/**
 * 描かれた行1つ。見出し（表の`<th>`／`<dl>`の`<dt>`）から、そこに出ている中身を引く。中身はHTMLの
 * まま持つ（中の絵やリンクごと突き合わせる）。
 */
type RenderedRow = ReadonlyMap<string, string>;

/**
 * 表に出すフィールド1つ。`label`はその見出しで、`texts`は**セルに出ているはずの値**——入れ子の型は
 * 出す約束をした中身だけを取り出す（前提なら道具の名前だけで、他の土地で用意するかは文字にならない）。
 *
 * `texts`は行も受け取る。**出るかどうかが同じ行の他のフィールドで決まるものがある**——供給表の周期は
 * 労働と同じなら`—`になるので、値だけでは何を要求すべきかが決まらない。
 */
interface ShownField<Row, Value> {
  readonly label: string;
  readonly texts: (value: Value, row: Row) => readonly (string | number)[];
}

/** 値をそのまま出すフィールド。決まらない値（undefined）はセルにも出ないので、何も要求しない。 */
function asIs<Row>(label: string): ShownField<Row, string | number | undefined> {
  return { label, texts: (value) => (value === undefined ? [] : [value]) };
}

function shows<Row, Value>(
  label: string,
  texts: (value: Value, row: Row) => readonly (string | number)[],
): ShownField<Row, Value> {
  return { label, texts };
}

/**
 * 解析の型のフィールドと、それが出る見出しの対応。**出さないと決めたフィールドだけがnull**で、
 * 理由を添える。`[K in keyof Row]`なので、**フィールドが増えるとここへ書き足すまでtypecheckが
 * 通らない**。
 */
type ShownFields<Row> = { readonly [K in keyof Row]: ShownField<Row, Row[K]> | null };

/** そのフィールドがセルに出しているはずの値。出さないと決めたフィールドは何も要求しない。 */
function textsOf<Row, K extends keyof Row>(
  fields: ShownFields<Row>,
  key: K,
  row: Row,
): readonly (string | number)[] {
  const field = fields[key];
  return field === null ? [] : field.texts(row[key], row);
}

/**
 * 解析の型のフィールドが、描かれた表に出ているかの見張り。
 *
 * **同じ型が2箇所へ別々に書き出される**——`stats/balance.yaml`と、このページ。フィールドが増えた
 * ときに片方だけ足しても、どちらのテストも緑のままだった（`DeviceRow.condition`でissue #977、
 * `ChainRoute.devices`でissue #993。囲いの中でしか進まないヤケイの繁殖が、どこに置いても働くように
 * 読める表が残った）。
 *
 * 大半は`<table>`（見出しは全行に共通の`<th>`）、連鎖の内訳だけが`<dl>`（見出しは行ごとの`<dt>`）
 * だが、**違うのは見出しと中身の取り出し方だけ**なので、`RenderedRow`にしてからは同じここが見る。
 */
function describeShownFields<Row>(spec: {
  /** 見張る表の名前。 */
  readonly name: string;
  readonly fields: ShownFields<Row>;
  /** 解析が出した行。描かれた行と同じ並びで渡す。 */
  readonly rows: readonly Row[];
  readonly rendered: readonly RenderedRow[];
  /** 行の型のフィールドではない見出し。 */
  readonly extraLabels: readonly string[];
}): void {
  const { name, fields, rows, rendered, extraLabels } = spec;
  // `Object.keys`が返せるのはstring[]までなので、対応表がRowの全フィールドを持つことを使って読み替える。
  const keys = Object.keys(fields) as unknown as readonly (keyof Row)[];
  const labelOf = (key: keyof Row): string | undefined => fields[key]?.label;

  describe(name, () => {
    it('見出しが、型のフィールドと対応している', () => {
      const declared = keys.map(labelOf).filter((label) => label !== undefined);
      const drawn = [...new Set(rendered.flatMap((row) => [...row.keys()]))];

      expect(drawn.sort()).toEqual([...new Set([...extraLabels, ...declared])].sort());
    });

    it('見本の世界が、出す約束のフィールドに値を持つ', () => {
      const empty = keys.filter(
        (key) => fields[key] !== null && rows.every((row) => textsOf(fields, key, row).length === 0),
      );

      expect(empty, '値が空のままのフィールドは、出ているかを見張れない').toEqual([]);
    });

    it('行が、その値をすべて出す', () => {
      expect(rendered.length, '解析が出した行が、すべて描かれてはいない').toBe(rows.length);

      rows.forEach((row, index) => {
        for (const key of keys) {
          const label = labelOf(key);
          if (label === undefined) continue;

          for (const text of textsOf(fields, key, row)) {
            const message = `${index}行目の${String(key)}（${text}）が「${label}」に出ていない`;
            expect(showsText(rendered[index].get(label), text), message).toBe(true);
          }
        }
      });
    });
  });
}

/**
 * その中身がその値を出しているか。数は見出しごとに丸めの桁が違うので、どれかの桁で一致すればよい。
 * 中身がundefinedなのはその見出しが無いときで、そのときも「出ていない」。
 */
function showsText(cell: string | undefined, text: string | number): boolean {
  if (cell === undefined) return false;
  return typeof text === 'number'
    ? [0, 1, 2, 3].some((digits) => cell.includes(text.toFixed(digits)))
    : cell.includes(escapeHtml(text));
}

/** 見出しと中身を対にする。数が合わなければ対応が崩れたまま緑になるので、そこで落とす。 */
function renderedRow(labels: readonly string[], cells: readonly string[]): RenderedRow {
  if (labels.length !== cells.length)
    throw new Error(`見出し${labels.length}個に対して中身が${cells.length}個ある`);
  return new Map(labels.map((label, index) => [label, cells[index]]));
}

/**
 * その見出しの後ろに最初に出てくる表（見出しは全行に共通の`<th>`）。**表は見出しで指す**——同じ節に
 * 表が2つ並ぶ（待ち生産と雨で溜まる水）ので、節の頭から数えると後ろの表が指せない。
 */
function tableRowsAfter(html: string, heading: string): readonly RenderedRow[] {
  const found = html.indexOf(heading);
  if (found < 0) throw new Error(`${heading}が描かれていない`);
  const start = html.indexOf('<table>', found);
  const end = html.indexOf('</table>', start);
  if (start < 0 || end < 0) throw new Error(`${heading}の表が描かれていない`);
  const table = html.slice(start, end);
  const headers = [...table.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(([, header]) => header);

  return table
    .split('<tr>')
    .map((row) => [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell))
    .filter((cells) => cells.length > 0)
    .map((cells) => renderedRow(headers, cells));
}

/** 連鎖の経路1つぶんの内訳。見出しは行ごとの`<dt>`なので、行によって出る見出しが違う。 */
function routeDetailRows(html: string): readonly RenderedRow[] {
  return [...html.matchAll(/<dl class="route-detail">([\s\S]*?)<\/dl>/g)].map(([, detail]) =>
    renderedRow(
      [...detail.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map(([, label]) => label),
      [...detail.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(([, cell]) => cell),
    ),
  );
}

/** 1日の必要量を取る代表キャラクタ。収支ページが持つ定数（balancePage.SAMPLE_CHARACTER）と同じ名前。 */
const SAMPLE_CHARACTER = 'medic';

/** 待ち生産表の列と、`DeviceRow`（`src/analysis/balanceTables.ts`）のフィールドの対応。 */
const DEVICE_LABELS: ShownFields<DeviceRow> = {
  deviceName: asIs('設備'),
  stepName: asIs('工程'),
  condition: asIs('条件'),
  periodMinutes: asIs('周期'),
  productName: asIs('産物'),
  perCycle: asIs('産物'),
  perDay: asIs('個/日'),
  lifetimeDays: asIs('寿命'),
  overLifetime: asIs('生涯'),
  lifetimeProperty: asIs('出どころ'),
  buildMinutes: asIs('製作'),
  laborPerUnit: asIs('分/個'),
};

/** `DeviceRow`のフィールドではない列。行がどの場所のものかは`PlaceBalance`が持つ。 */
const PLACE_LABEL = '場所';

/** 連鎖の経路を開いたときの内訳（`<dl>`）と、`ChainRoute`のフィールドの対応。 */
const CHAIN_LABELS: ShownFields<ChainRoute> = {
  steps: shows('工程', (steps) => steps.flatMap((step) => [step.objectName, step.stepName])),
  devices: shows('設備', (devices) =>
    devices.flatMap((device) => [device.deviceName, device.stepName, device.condition]),
  ),
  deltas: shows('1回で返る値', (deltas) => deltas.flatMap(({ name, amount }) => [name, amount])),
  prerequisites: shows('前提', (prerequisites) =>
    prerequisites.map(({ label, objectName }) => objectName ?? label),
  ),

  // 1回ぶんの時間は、需要1単位あたりへ割った形でだけ出す（割り算は`PropertyRoute`が持つ）。
  executionMinutes: null,
  exploreMinutes: null,
  craftMinutes: null,

  // 1回で埋まる量は`1単位あたり`の分母として効くだけで、プロパティのidから引く形では出さない。
  fills: null,

  // 行の見た目で出す（`route-import`）。
  needsImport: null,

  // どの並びへ出すかの印で、行の中身ではない。塞がった経路とその土地を起点にしない経路は
  // `placeBalances`が落とすのでこの表に届かず、時間を数えられない経路は畳んで出す。
  blocked: null,
  rootedHere: null,
  untimed: null,
};

/** `ChainRoute`のフィールドではない見出し。需要で割った時間は`PropertyRoute`が持つ。 */
const PER_UNIT_LABEL = '1単位あたり';

/** 総コスト表の列と、`ObjectCost`のフィールドの対応。 */
const COST_LABELS: ShownFields<ObjectCost> = {
  objectName: asIs('オブジェクト'),
  minutes: asIs('総労働'),
  exploreMinutes: asIs('探索'),
  craftMinutes: asIs('それ以外'),
  days: asIs('日数'),
  steps: shows('作り方', (steps) => steps.flatMap((step) => [step.objectName, step.stepName])),
  prerequisites: shows('前提', (prerequisites) => prerequisites.map(({ label }) => label)),

  // 前提の列が、入手経路の無い道具へ「入手経路なし」を添える。この真偽と前提は同じ1つの事実の裏表。
  blockedByTool: shows('前提', (blocked) => (blocked ? ['入手経路なし'] : [])),

  // 足りない入力は、表の前に出す「入手経路が無いもの」の一覧が持つ。この表は作れるものだけを並べる
  // ので、ここへ来る行では常に空。
  missing: null,

  // 総コストの出ない行を2つの一覧へ振り分ける印で、表の列ではない。ここへ来る行では常に偽。
  obtainableWithoutCost: null,
};

/** 雨で溜まる水の表の列と、`RainWaterRow`のフィールドの対応。 */
const RAIN_WATER_LABELS: ShownFields<RainWaterRow> = {
  containerName: asIs('容器'),
  seasonName: asIs('季節'),
  capacity: asIs('容量'),
  rainPerDay: asIs('降雨'),
  evaporationPerDay: asIs('蒸発'),
  netPerDay: asIs('差引'),
};

/** 消費表の列と、`ConsumptionRow`のフィールドの対応。 */
const CONSUMPTION_LABELS: ShownFields<ConsumptionRow> = {
  propertyName: asIs('プロパティ'),
  condition: asIs('条件'),

  // キャラクタ1人が1列で、見出しはその名前。見本の世界のキャラクタは代表の1人だけ。
  perTickByCharacter: shows(SAMPLE_CHARACTER, (amounts) =>
    amounts.filter((amount): amount is number => amount !== undefined),
  ),
};

/** 供給表の列と、`SupplyRow`のフィールドの対応。 */
const SUPPLY_LABELS: ShownFields<SupplyRow> = {
  ownerName: asIs('宣言元'),
  stepName: asIs('工程'),

  // 時間で回る工程だけが、工程名の後ろにその旨を添える。
  kind: shows('工程', (kind) => (kind === 'periodic' ? [kind] : [])),

  laborMinutes: asIs('労働'),

  // 定義だけでは決まらない工程は、労働の後ろに「?」が付く。
  hasUnresolvedReferences: shows('労働', (unresolved) => (unresolved ? ['?'] : [])),

  // 待ち時間の無い工程では労働と同じ数字になるので、その行は`—`にする。
  elapsedMinutes: shows('周期', (minutes, row) => (minutes === row.laborMinutes ? [] : [minutes])),

  spawns: shows('期待産出', (spawns) => spawns.flatMap(({ name, amount }) => [name, amount])),
  agentDeltas: shows('値の増減', (deltas) => deltas.flatMap(({ name, amount }) => [name, amount])),
  selfDeltas: shows('値の増減', (deltas) => deltas.flatMap(({ name, amount }) => [name, amount])),
};

/**
 * 収支ページの6つの表を描かせる世界。**どの表のどのフィールドにも値が入るように書く**——朽ちない
 * 設備や作り方の無い設備ではundefinedになるフィールドがあり、その見出しが見張られなくなる。
 */
const DEVICE_YAML = `
object_defs:
  # 雨で溜まる水は、器の居る場所の明るさを時刻ごとに置いて数える（worldAmbientBrightnessOf）。
  # worldがhourとambient_brightnessを宣言していないとそこで止まる。
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

  ${SAMPLE_CHARACTER}:
    tags: [character]
    props:
      hydration:
        value: 96
        range: {min: 0, max: 96}
        passives:
          - add: {self: {hydration: -1}}

  spring_field:
    tags: [location]
    props:
      exploration_progress: {value: 0, range: {min: 0, max: 100}}
    interactions:
      explore:
        trigger: menu
        duration: 60
        spawn: {object: fiber, into: self}

  # 地面に置いてある間だけ周期が進み（＝「条件つき」）、耐久が尽きると自分が消える設備。
  rain_basket:
    tags: [item]
    slots:
      contents: {cell_count: 1, cell: {accept: {tag: item}}}
    recipes:
      woven:
        steps:
          - requires: [{object: fiber, count: 2, consume: true}]
            duration: 180
    props:
      fill_remaining:
        value: 16
        range: {min: 0, max: 16}
        passives:
          - conditions: [{in_slot: items}]
            add: {self: {fill_remaining: -1}}
        on_min:
          add: {self: {fill_remaining: 16}}
          spawn: {object: gourd, into: self}
      durability:
        value: 960
        range: {min: 0, max: 960}
        passives:
          - conditions: [{in_slot: items}]
            add: {self: {durability: -1}}
        on_min:
          destroy: self

  fiber: {tags: [item]}

  gourd:
    tags: [item]
    interactions:
      drink:
        trigger: menu
        duration: 5
        destroy: self
        add: {agent: {hydration: 96}}
      # 繊維を噛ませて漉しながら、飲み干さずにひと口だけ。かかる時間は漉す繊維の目の細かさで
      # 決まるが、**その値を宣言している型が世界に1つも無い**ので、定義だけでは決まらない
      # （SupplyRow.hasUnresolvedReferences）。
      sip:
        trigger: {drag: {object: fiber}}
        duration: {subject: instrument, prop: mesh}
        add: {agent: {hydration: 8}}

  # 入手経路が無い道具。これを要るレシピが「道具が無くて作れないもの」になる（ObjectCost.blockedByTool）。
  flint_blade: {tags: [item, cutting_tool]}

  # 材料は揃うが、切る道具が手に入らないもの。
  fiber_rope:
    tags: [item]
    recipes:
      twist:
        steps:
          - requires:
              - {object: fiber, count: 3, consume: true}
              - {tag: cutting_tool, count: 1, consume: false}
            duration: 90

  # 空けたまま置くと雨を受け、雨の降っていない間は蒸発する容器（RainWaterRow）。
  rain_bowl:
    tags: [item]
    props:
      # 抱えている量の重さを載せる先（containerPropagationPassives）。
      weight: {value: 200}
      fill:
        value: 0
        range: {min: 0, max: 2000}
        passives:
          - conditions: [{subject: ancestor, prop: weather, eq: light_rain}]
            add: {self: {fill: 10}}
          - conditions: [{subject: ancestor, prop: weather, eq: heavy_rain}]
            add: {self: {fill: 20}}
          - conditions: [{subject: ancestor, prop: weather, eq: storm}]
            add: {self: {fill: 40}}
          - conditions:
              - {subject: ancestor, prop: weather, not_in: [light_rain, heavy_rain, storm]}
            add: {self: {fill: -1}}
`;

describe('収支ページの表', () => {
  const codex = new WorldCodexYamlLoader().load('devices.yaml', DEVICE_YAML).buildAndReset();
  // 識別子モードで描かせる。中身に出る名前が、そのまま解析の持つ識別子になる。
  const source = new CodexSource(codex, parseLocale('ja.yaml', 'object_texts: {}'), ['devices.yaml']);
  const view = new CodexView(source, 'identifier');
  const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);
  const html = pageHtml(new BalancePage(), view);

  // 節の並びはページと同じ（連鎖 → 総コスト → 待ち生産 → 雨で溜まる水 → 消費 → 供給）。
  describeShownFields({
    name: '連鎖の経路',
    fields: CHAIN_LABELS,
    // 描く順（土地 → プロパティ → 時間を数えた経路 → 数えられない経路）に並べる。
    rows: tables.places
      .filter((place) => place.properties.length > 0)
      .flatMap((place) =>
        place.properties.flatMap((chains) => [
          ...chains.routes.filter((entry) => !entry.route.untimed),
          ...chains.routes.filter((entry) => entry.route.untimed),
        ]),
      )
      .map((entry) => entry.route),
    rendered: routeDetailRows(html),
    extraLabels: [PER_UNIT_LABEL],
  });

  describeShownFields({
    name: 'オブジェクトの総コスト',
    fields: COST_LABELS,
    // 表に並ぶのは作れるものだけ。作れないものは表の前の一覧が持つ。
    rows: tables.objectCosts.filter((cost) => cost.minutes !== undefined),
    rendered: tableRowsAfter(html, '<h2 id="balance-総コスト">'),
    extraLabels: [],
  });

  describeShownFields({
    name: '待ち生産',
    fields: DEVICE_LABELS,
    rows: tables.places.flatMap((place) => place.devices),
    rendered: tableRowsAfter(html, '<h2 id="balance-待ち生産">'),
    extraLabels: [PLACE_LABEL],
  });

  describeShownFields({
    name: '雨で溜まる水',
    fields: RAIN_WATER_LABELS,
    rows: tables.rainWater,
    rendered: tableRowsAfter(html, '<h3>雨で溜まる水</h3>'),
    extraLabels: [],
  });

  describeShownFields({
    name: '消費',
    fields: CONSUMPTION_LABELS,
    rows: tables.consumption,
    rendered: tableRowsAfter(html, '<h2 id="balance-消費">'),
    extraLabels: [],
  });

  describeShownFields({
    name: '供給',
    fields: SUPPLY_LABELS,
    rows: tables.supply,
    rendered: tableRowsAfter(html, '<h2 id="balance-供給">'),
    extraLabels: [],
  });
});

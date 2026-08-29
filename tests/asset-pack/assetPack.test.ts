import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/asset-pack/AssetPack';
import { AssetPacks } from '../../src/asset-pack/install';
import { readZip } from '../../src/asset-pack/zip';
import { artKeyIn, rebuildArtCatalog } from '../../src/art/packArt';
import { BACKGROUND_ART } from '../../src/art/backgroundArt';
import { ART_BY_NAME, artUrl, objectTexture } from '../../src/art/objectArt';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { loadDefinitions } from '../../src/loader/loadDefinitions';
import { LoadReport } from '../../src/loader/LoadReport';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { loadLocalization } from '../../src/locale/Localization';
import { zipArchive } from '../support/zipArchive';
import type { ZipSource } from '../support/zipArchive';

/**
 * アセットパックの読み込み（AssetPack.md）。ZIPのトップが `src/assets/` に相当する形で
 * 定義YAML・表示文字列・絵を受け取り、同梱ぶんへ重ねられることを確かめる。
 */
async function pack(id: string, sources: readonly ZipSource[]): Promise<AssetPack> {
  return packOf([{ name: 'pack.yaml', content: `id: ${id}\nversion: '1'\n` }, ...sources]);
}

/** 名乗りも含めてZIPの中身をそのまま渡す（`pack.yaml` の検査用）。 */
async function packOf(sources: readonly ZipSource[]): Promise<AssetPack> {
  return new AssetPack(await readZip(zipArchive(sources)));
}

const OBJECT_YAML = `
object_defs:
  driftwood_totem:
    tags: [item, fixture]
    props:
      weight: {value: 4000}
      volume: {value: 12000}
`;

describe('パックの名乗り（pack.yaml）', () => {
  it('識別子と版を名乗り、出所の表示は識別子から採る', async () => {
    const loaded = await packOf([
      { name: 'pack.yaml', content: "id: potions\nversion: '2'\n" },
      { name: 'world-codex/totem.yaml', content: OBJECT_YAML },
    ]);

    expect(loaded.name).toBe('potions');
    expect(loaded.version).toBe('2');
    expect([...loaded.worldCodexTexts().keys()]).toEqual(['potions:world-codex/totem.yaml']);
  });

  it('pack.yaml が無ければパックとして受け取らない', async () => {
    await expect(packOf([{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }])).rejects.toThrow(
      YamlLoadError,
    );
  });

  it('idもversionも省略できない', async () => {
    await expect(packOf([{ name: 'pack.yaml', content: 'id: potions\n' }])).rejects.toThrow(/version/);
    await expect(packOf([{ name: 'pack.yaml', content: "version: '1'\n" }])).rejects.toThrow(/id/);
    await expect(packOf([{ name: 'pack.yaml', content: "id:\nversion: '1'\n" }])).rejects.toThrow(/id/);
  });

  it('知らないキーはエラーになる', async () => {
    await expect(
      packOf([{ name: 'pack.yaml', content: "id: potions\nversion: '1'\nauthor: だれか\n" }]),
    ).rejects.toThrow(/author/);
  });
});

describe('アセットパックの中身', () => {
  it('定義YAMLを、出所つきのファイル名で取り出せる', async () => {
    const loaded = await pack('sample', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]);

    expect([...loaded.worldCodexTexts().keys()]).toEqual(['sample:world-codex/totem.yaml']);
  });

  it('表示文字列は言語ごとに引ける（無ければundefined）', async () => {
    const loaded = await pack('sample', [{ name: 'locale/ja.yaml', content: 'object_texts: {}' }]);

    expect(loaded.localeText('ja')).toBe('object_texts: {}');
    expect(loaded.localeText('en')).toBeUndefined();
  });

  it('絵は同梱ぶんと同じ名前（拡張子を落としたファイル名）で並ぶ', async () => {
    const loaded = await pack('sample', [
      { name: 'objects/driftwood_totem.png', content: new Uint8Array([1]) },
      { name: 'backgrounds/driftwood_totem_fixtures_lane.png', content: new Uint8Array([2]) },
      { name: 'world-codex/totem.yaml', content: OBJECT_YAML },
    ]);

    expect([...loaded.objectArt().keys()]).toEqual(['driftwood_totem']);
    expect([...loaded.backgroundArt().keys()]).toEqual(['driftwood_totem_fixtures_lane']);
    // 実体はBlobのURLで、同じ絵を2度引いても1つのまま。
    expect(loaded.objectArt().get('driftwood_totem')).toBe(loaded.objectArt().get('driftwood_totem'));
  });
});

describe('アセットパックを重ねた読み込み', () => {
  it('パックの定義が同梱の定義に足される', async () => {
    const codex = loadWorldCodex(
      [await pack('sample', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }])],
      new LoadReport(),
    );

    expect(codex.objectNames.tryGetId('driftwood_totem')).toBeDefined();
    // 同梱ぶんはそのまま読める。
    expect(codex.objectNames.tryGetId('coconut')).toBeDefined();
  });

  it('同梱と同じ識別子を宣言したパックはエラーになる', async () => {
    const clash = await pack('sample', [
      { name: 'world-codex/clash.yaml', content: 'object_defs:\n  coconut: {tags: [item]}\n' },
    ]);

    expect(() => loadWorldCodex([clash], new LoadReport())).toThrow(YamlLoadError);
  });

  it('パックの表示文字列が同梱の対応表に足される', async () => {
    const locale = loadLocalization([
      await pack('sample', [
        {
          name: 'locale/ja.yaml',
          content: 'object_texts:\n  driftwood_totem:\n    display_name: 流木の像\n',
        },
      ]),
    ]);

    expect(locale.object('driftwood_totem').displayName).toBe('流木の像');
    expect(locale.object('coconut').displayName).toBe('熟したヤシの実');
  });

  it('同梱と同じ識別子の表示文字列を持つパックはエラーになる', async () => {
    const clash = await pack('sample', [
      { name: 'locale/ja.yaml', content: 'object_texts:\n  coconut:\n    display_name: 別のヤシの実\n' },
    ]);

    expect(() => loadLocalization([clash])).toThrow(YamlLoadError);
  });

  it('読めないパックは丸ごと外し、同梱ぶんだけで組み直す', async () => {
    const report = new LoadReport();
    const broken = await pack('sample', [
      { name: 'world-codex/totem.yaml', content: OBJECT_YAML },
      // 同梱と同じ識別子。操作単位では捨てられないので、パックごと外れる（AssetPack.md 6.1節）。
      { name: 'world-codex/clash.yaml', content: 'object_defs:\n  coconut: {tags: [item]}\n' },
    ]);

    const definitions = loadDefinitions([broken], report);

    expect(definitions.codex.objectNames.tryGetId('driftwood_totem'), 'パックの型は入らない').toBeUndefined();
    expect(definitions.codex.objectNames.tryGetId('coconut'), '同梱ぶんは読める').toBeDefined();
    expect(definitions.files.some((file) => file.startsWith('sample:'))).toBe(false);
    expect(report.problems).toHaveLength(1);
  });

  it('パックを渡さなければ同梱ぶんだけを読む', () => {
    expect(loadWorldCodex([], new LoadReport()).objectNames.tryGetId('driftwood_totem')).toBeUndefined();
  });
});

/**
 * 複数のパックを並べて読む（AssetPack.md 6.2節）。順が変えるのは宣言順に振られるものだけで、
 * 出来上がる世界の中身はどの順でも同じになる（同名の識別子は常にエラーで、後勝ちが無いため）。
 */
describe('複数のアセットパックを並べた順に読む', () => {
  /** プロパティタグ・レシピ一覧の棚（＝宣言順がそのまま並びになるもの）だけを宣言したパック。 */
  async function ordered(id: string, tag: string): Promise<AssetPack> {
    return pack(id, [
      {
        name: 'world-codex/order.yaml',
        content: `property_tags:\n  ${tag}: {}\nrecipe_categories: [${tag}]\n`,
      },
    ]);
  }

  it('宣言順に振られるものが、渡した順に並ぶ', async () => {
    const [first, second] = [await ordered('first', 'alpha'), await ordered('second', 'beta')];

    const forward = loadWorldCodex([first, second], new LoadReport());
    const backward = loadWorldCodex([second, first], new LoadReport());

    const tagOrder = (codex: WorldCodex): readonly string[] =>
      ['alpha', 'beta'].sort((a, b) => codex.propertyTagNames.getId(a) - codex.propertyTagNames.getId(b));
    expect(tagOrder(forward)).toEqual(['alpha', 'beta']);
    expect(tagOrder(backward)).toEqual(['beta', 'alpha']);

    // 同梱ぶんの棚が先に並んでいるので、パックが足したぶんだけを見る。
    const shelves = (codex: WorldCodex): readonly string[] =>
      codex.recipeCategoryTagIdsByPriority
        .map((id) => codex.tagNames.getName(id))
        .filter((name) => name === 'alpha' || name === 'beta');
    expect(shelves(forward)).toEqual(['alpha', 'beta']);
    expect(shelves(backward)).toEqual(['beta', 'alpha']);
  });

  it('片方が読めなくても、もう片方は生き残る', async () => {
    const report = new LoadReport();
    const broken = await pack('broken', [
      // 同梱と同じ識別子。操作単位では捨てられないので、このパックだけが丸ごと外れる（6.1節）。
      { name: 'world-codex/clash.yaml', content: 'object_defs:\n  coconut: {tags: [item]}\n' },
    ]);
    const sound = await pack('sound', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]);

    const definitions = loadDefinitions([broken, sound], report);

    expect(definitions.codex.objectNames.tryGetId('driftwood_totem'), '無事なパックは入る').toBeDefined();
    expect(definitions.files.some((file) => file.startsWith('broken:'))).toBe(false);
    expect(definitions.files.some((file) => file.startsWith('sound:'))).toBe(true);
    expect(report.problems.map((problem) => problem.source)).toEqual(['broken']);
  });

  it('同じ識別子のパックは2つ入れられない（AssetPack.md 3.2節）', async () => {
    const packs = new AssetPacks();
    packs.add(await pack('twin', []));
    const again = await pack('twin', []);

    expect(() => packs.add(again)).toThrow(/twin/);
    expect(packs.all).toHaveLength(1);
  });
});

/**
 * 定義と絵は、パック1つを単位にまとめて載るかまとめて外れる（AssetPack.md 6.1節）。片方だけを
 * 外すと「同梱ぶん＋無事なパック」にならない——定義だけ残ればその型は絵を持たず、絵だけ残れば
 * 外したパックの背景が同梱の型に敷かれる。
 */
describe('絵の名前が重なるパックを外す', () => {
  /** 同梱ぶんが持っている背景の名前（在庫表の鍵から前置きを外したもの）と、そのURL。 */
  const BUNDLED_BACKGROUND_KEY = [...BACKGROUND_ART.keys()].sort()[0];
  const BUNDLED_BACKGROUND = BUNDLED_BACKGROUND_KEY.replace(/^background:/, '');
  const BUNDLED_BACKGROUND_URL = BACKGROUND_ART.get(BUNDLED_BACKGROUND_KEY);

  const MASK_YAML = `
object_defs:
  driftwood_mask:
    tags: [item]
    props:
      weight: {value: 400}
      volume: {value: 1200}
`;

  it('同梱と同じ名前の背景を持つパックは、定義もろとも外れて、他のパックは載る', async () => {
    const report = new LoadReport();
    const clashing = await pack('clashing', [
      { name: 'world-codex/mask.yaml', content: MASK_YAML },
      { name: `backgrounds/${BUNDLED_BACKGROUND}.png`, content: new Uint8Array([1]) },
    ]);
    const sound = await pack('sound', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]);

    // 起動を止めない（AssetPack.md 6.1節の2段目）。
    const definitions = loadDefinitions([clashing, sound], report);

    expect(
      definitions.codex.objectNames.tryGetId('driftwood_mask'),
      '外したパックの型は入らない',
    ).toBeUndefined();
    expect(definitions.codex.objectNames.tryGetId('driftwood_totem'), '無事なパックは入る').toBeDefined();
    expect(definitions.codex.objectNames.tryGetId('coconut'), '同梱ぶんは読める').toBeDefined();
    expect(definitions.files.some((file) => file.startsWith('clashing:'))).toBe(false);
    expect(report.problems.map((problem) => problem.source)).toEqual(['clashing']);
    // 在庫表は同梱ぶんのまま（重ねた側が勝たない。同6節）。
    expect(BACKGROUND_ART.get(`background:${BUNDLED_BACKGROUND}`)).toBe(BUNDLED_BACKGROUND_URL);
  });

  it('定義が読めずに外したパックの絵は、在庫表に残らない', async () => {
    const report = new LoadReport();
    const broken = await pack('broken', [
      // 同梱と同じ識別子。操作単位では捨てられないので、このパックだけが丸ごと外れる（6.1節）。
      { name: 'world-codex/clash.yaml', content: 'object_defs:\n  coconut: {tags: [item]}\n' },
      { name: 'backgrounds/driftwood_mask_fixtures_lane.png', content: new Uint8Array([2]) },
      { name: 'objects/driftwood_mask.png', content: new Uint8Array([3]) },
    ]);

    loadDefinitions([broken], report);

    expect(BACKGROUND_ART.has('background:driftwood_mask_fixtures_lane')).toBe(false);
    expect(ART_BY_NAME.has('broken:driftwood_mask')).toBe(false);
  });

  it('載ったパックの絵は在庫表に並ぶ', async () => {
    const loaded = await pack('loaded', [
      { name: 'world-codex/mask.yaml', content: MASK_YAML },
      { name: 'backgrounds/driftwood_mask_fixtures_lane.png', content: new Uint8Array([4]) },
      { name: 'objects/driftwood_mask.png', content: new Uint8Array([5]) },
    ]);

    const definitions = loadDefinitions([loaded], new LoadReport());

    expect(definitions.codex.objectNames.tryGetId('driftwood_mask')).toBeDefined();
    expect(BACKGROUND_ART.has('background:driftwood_mask_fixtures_lane')).toBe(true);
    expect(artUrl(definitions.codex.artNameOf('driftwood_mask'))).toBe(
      ART_BY_NAME.get('loaded:driftwood_mask'),
    );
  });
});

/**
 * どのパックの絵かは、その型を宣言したパックで決まる（AssetPack.md 5節）。出所は型が名乗る絵の
 * 名前に添えて運ぶので、引くのは名前1つで済む。
 */
describe('型の絵の出所', () => {
  it('パックの型は、出所を添えた絵の名前を名乗る', async () => {
    const declaring = await pack('declaring', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]);

    const codex = loadWorldCodex([declaring], new LoadReport());

    expect(codex.artNameOf('driftwood_totem')).toBe('declaring:driftwood_totem');
  });

  it('同じ名前の絵を2つのパックが持つとき、その型を宣言した側の絵が使われる', () => {
    // どちらも `objects/driftwood_totem.png` を持つ在庫表（installPackObjectArtが作る形）。
    const catalog = new Map<string, string>();
    rebuildArtCatalog(
      catalog,
      new Map([['coconut', '/bundled/coconut.png']]),
      [
        { packName: 'declaring', art: new Map([['declaring:driftwood_totem', 'blob:declaring']]) },
        { packName: 'bystander', art: new Map([['bystander:driftwood_totem', 'blob:bystander']]) },
      ],
      '型の絵',
    );

    // 型 driftwood_totem を宣言しているのは declaring なので、名乗る絵の名前もそちらの出所を持つ。
    expect(catalog.get(artKeyIn(catalog, 'declaring:driftwood_totem')!)).toBe('blob:declaring');
    expect(catalog.get(artKeyIn(catalog, 'bystander:driftwood_totem')!)).toBe('blob:bystander');
  });

  it('パックが持っていない絵は同梱ぶんへ落ちる', () => {
    const catalog = new Map<string, string>();
    rebuildArtCatalog(
      catalog,
      new Map([['coconut', '/bundled/coconut.png']]),
      [{ packName: 'borrowing', art: new Map([['borrowing:elixir', 'blob:elixir']]) }],
      '型の絵',
    );

    // 「定義だけを足して絵は同梱のものを使う」パック（`art: coconut` を名乗った型）。
    expect(artKeyIn(catalog, 'borrowing:coconut')).toBe('coconut');
    expect(artKeyIn(catalog, 'borrowing:elixir')).toBe('borrowing:elixir');
    expect(artKeyIn(catalog, 'borrowing:not_drawn_yet')).toBeUndefined();
  });

  it('読み込む鍵も落ちた先のもの（同梱ぶんの絵を二重に読まない）', async () => {
    // 絵を1枚も持たず、同梱の絵を名乗るだけのパック。在庫表は触らないので、引くのは同梱ぶん。
    const borrowing = await pack('borrowing', [
      { name: 'world-codex/totem.yaml', content: `${OBJECT_YAML}    art: coconut\n` },
    ]);

    const codex = loadWorldCodex([borrowing], new LoadReport());

    const artName = codex.artNameOf('driftwood_totem');
    expect(artName).toBe('borrowing:coconut');
    expect(artUrl(artName)).toBe(ART_BY_NAME.get('coconut'));
    expect(objectTexture(artName)).toBe('object:coconut');
  });
});

describe('絵の在庫表への重ね方', () => {
  it('同梱に無い絵は足される', () => {
    const catalog = new Map<string, string>();

    rebuildArtCatalog(
      catalog,
      new Map([['coconut', '/bundled/coconut.png']]),
      [{ packName: 'sample', art: new Map([['sample:driftwood_totem', 'blob:totem']]) }],
      '型の絵',
    );

    expect(catalog.get('sample:driftwood_totem')).toBe('blob:totem');
    expect(catalog.get('coconut')).toBe('/bundled/coconut.png');
  });

  it('同じ鍵の絵はエラーになる（在庫表は上書きしない）', () => {
    // 衝突しうるのは前置きの付かない背景の絵だけ（型の絵は鍵に出所が付く。AssetPack.md 6節）。
    const catalog = new Map<string, string>();
    const bundled = new Map([['background:hand_card', '/bundled/hand_card.png']]);

    expect(() =>
      rebuildArtCatalog(
        catalog,
        bundled,
        [{ packName: 'sample', art: new Map([['background:hand_card', 'blob:other']]) }],
        '背景の絵',
      ),
    ).toThrow(/hand_card/);
  });

  it('組み直しは同梱ぶんから始まる（前に載せたパックのぶんが残らない）', () => {
    const catalog = new Map<string, string>();
    const bundled = new Map([['coconut', '/bundled/coconut.png']]);

    rebuildArtCatalog(
      catalog,
      bundled,
      [{ packName: 'gone', art: new Map([['gone:x', 'blob:x']]) }],
      '型の絵',
    );
    rebuildArtCatalog(
      catalog,
      bundled,
      [{ packName: 'kept', art: new Map([['kept:y', 'blob:y']]) }],
      '型の絵',
    );

    expect([...catalog.keys()]).toEqual(['coconut', 'kept:y']);
  });

  it('重ねられないパックがあれば、在庫表は組み直す前のまま', () => {
    const catalog = new Map<string, string>();
    const bundled = new Map([['background:hand_card', '/bundled/hand_card.png']]);
    rebuildArtCatalog(
      catalog,
      bundled,
      [{ packName: 'kept', art: new Map([['background:y', 'blob:y']]) }],
      '背景の絵',
    );

    expect(() =>
      rebuildArtCatalog(
        catalog,
        bundled,
        [{ packName: 'clashing', art: new Map([['background:hand_card', 'blob:other']]) }],
        '背景の絵',
      ),
    ).toThrow(/hand_card/);
    expect([...catalog.keys()]).toEqual(['background:hand_card', 'background:y']);
  });
});

import { readFileSync } from 'node:fs';
import { isMap, isSeq, parseDocument } from 'yaml';
import type { Document, YAMLMap } from 'yaml';
import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { worldCodexPath, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 地形生成の宣言（`axes`/`location_types`/`generation_scopes`）だけは、`WorldCodex.schema.json` が
 * ルートキーを許すだけで中身を見ていない（`WorldCodexSchema.md` 2.2節）。**綴りの誤りを止めているのは
 * ローダーだけ**なので、それが本当に全部を止めているかをここで見る。
 *
 * 同梱の `terrain_generation.yaml` に在る**すべてのmapping**へ未知キーを1つずつ足し、どこへ足しても
 * ロードが落ちることを確かめる。走査するのは実物の宣言なので、**パーサへ新しい入れ子を足して
 * `requireKnownKeys` を置き忘れれば、その入れ子を使う宣言が入った時点でこの検査が赤くなる**
 * （検査の側に書き足すものは無い）。
 */
describe('地形生成の宣言に足した未知キー', () => {
  const GENERATION_PATH = worldCodexPath('terrain_generation.yaml');
  const UNKNOWN_KEY = 'no_such_key';

  /** 地形生成のルートキー。ここから下のmappingだけを走査する（他のルートキーは既存の検査が持つ）。 */
  const GENERATION_ROOTS = ['axes', 'location_types', 'generation_scopes'] as const;

  type YamlPath = readonly (string | number)[];

  /** 地形生成のルートキー以下に在るmappingのパスを、深さ優先で全部集める。 */
  function mappingPaths(doc: Document): YamlPath[] {
    const found: YamlPath[] = [];
    const walk = (node: unknown, path: YamlPath): void => {
      if (isMap(node)) {
        found.push(path);
        for (const pair of node.items) walk(pair.value, [...path, String(pair.key)]);
      } else if (isSeq(node)) node.items.forEach((item, index) => walk(item, [...path, index]));
    };
    for (const root of GENERATION_ROOTS) walk(doc.get(root, true), [root]);
    return found;
  }

  /**
   * 地形生成以外の同梱ファイル。**渡したDocumentをローダーは書き換えない**（`loadDocument`）ので、
   * 1度読んだものを何度でも渡せる——壊し方の数だけ読み直すと、これだけで数秒かかる。
   */
  const otherDocuments = (): readonly (readonly [string, Document])[] =>
    (parsedOthers ??= worldCodexYamlPaths()
      .filter((path) => path !== GENERATION_PATH)
      .map((path) => [path, parseDocument(readFileSync(path, 'utf8'))] as const));
  let parsedOthers: readonly (readonly [string, Document])[] | undefined;

  /**
   * 渡した地形生成のYAMLがロードを通るか。**参照の検証はビルドまで遅延する**ので
   * （`buildGenerationDefs`）、パースで落ちなければ同梱の他のファイルも読んでビルドまで通す。
   * 落ちるのが `YamlLoadError` であることも併せて見る（型エラーで落ちたのを「止めた」と数えない）。
   */
  function passesLoad(generationYaml: string): boolean {
    try {
      new WorldCodexYamlLoader().load(GENERATION_PATH, generationYaml);
    } catch (error) {
      expect(error).toBeInstanceOf(YamlLoadError);
      return false;
    }
    try {
      const loader = new WorldCodexYamlLoader().load(GENERATION_PATH, generationYaml);
      for (const [label, document] of otherDocuments()) loader.loadDocument(label, document);
      loader.buildAndReset();
    } catch (error) {
      expect(error).toBeInstanceOf(YamlLoadError);
      return false;
    }
    return true;
  }

  it('壊していない同梱の宣言は通る（落ちるのが未知キーのせいだと言えるようにする）', () => {
    expect(passesLoad(readFileSync(GENERATION_PATH, 'utf8'))).toBe(true);
  });

  // 亜種のpropsへ足したぶんは参照の検証まで降りないと分からない（ビルドが要る）。そこだけ世界を
  // 組み直すので、既定の5秒には収まらない。
  it('どのmappingへ足してもロードが落ちる', () => {
    const text = readFileSync(GENERATION_PATH, 'utf8');
    const paths = mappingPaths(parseDocument(text));
    expect(paths.length).toBeGreaterThan(0);

    const slippedThrough = paths.filter((path) => {
      const broken = parseDocument(text);
      (broken.getIn(path, true) as YAMLMap).set(UNKNOWN_KEY, 1);
      return passesLoad(String(broken));
    });

    expect(slippedThrough.map((path) => path.join('.'))).toEqual([]);
  }, 60_000);
});

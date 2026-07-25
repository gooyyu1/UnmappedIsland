import { parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import { asMap, asScalarText, entriesInOrder, tryGetMap } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';

/** 表示文字列を引く言語。切り替えの入口はまだ無いため、日本語で固定（Localization.md）。 */
export const LANGUAGE = 'ja';

/** ゲーム本体に同梱される表示文字列ファイルのパス（public/配下、ビルドでそのまま配信される）。 */
export const LOCALE_FILE = `locale/${LANGUAGE}.yaml`;

/**
 * 識別子から表示文字列を引く対応表（Localization.md）。WorldCodexは識別子だけを持ち、
 * 画面に出す文字列はこちらが持つ。
 *
 * 未登録の識別子は識別子そのものを返す: 表示文字列の欠落でゲームが止まるより、画面に
 * 識別子が出て気付ける方がよいため。
 */
export class Localization {
  private readonly objectNames: ReadonlyMap<string, string>;

  constructor(objectNames: ReadonlyMap<string, string>) {
    this.objectNames = objectNames;
  }

  /** object_defの表示名。 */
  objectName(objectDefName: string): string {
    return this.objectNames.get(objectDefName) ?? objectDefName;
  }

  /** 表示文字列を1つも持たない対応表（表示文字列を必要としないテスト用）。 */
  static empty(): Localization {
    return new Localization(new Map());
  }
}

/**
 * 表示文字列のYAMLを読む（labelはエラーメッセージ用の出所表示）。トップレベルは
 * 「対象の種類（object_defs等）→ 識別子 → 表示文字列」の2段のマッピング。
 */
export function parseLocale(label: string, yamlText: string): Localization {
  const document = parseDocument(yamlText);
  if (document.errors.length > 0)
    throw new YamlLoadError(`${label}: YAML構文エラー: ${document.errors[0].message}`);
  if (document.contents === null) return Localization.empty();

  return new Localization(readSection(asMap(document.contents, label), 'object_defs', label));
}

function readSection(root: YAMLMap, key: string, label: string): Map<string, string> {
  const entries = new Map<string, string>();
  const section = tryGetMap(root, key, label);
  if (section === undefined) return entries;

  for (const [name, node] of entriesInOrder(section))
    entries.set(name, asScalarText(node, `${label}.${key}.'${name}'`));
  return entries;
}

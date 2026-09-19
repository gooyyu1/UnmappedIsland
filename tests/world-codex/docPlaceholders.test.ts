import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { specDocs } from '../../scripts/docScope.mjs';
import { bundledLocaleText } from '../../src/locale/Localization';

/**
 * `docs/` が名指しする差し込みの名前が、同梱の対応表に在る書式のものかの検査
 * （[`docs/engine/Localization.md`](../../docs/engine/Localization.md)「書式のプレースホルダは名前で書く」）。
 *
 * **書式の名前は、文書と対応表の2箇所に現れる。** 対応表の側で名前を変えても文書は緑のままなので、
 * `{container}` のようにどの書式にも無い名前が例として残った（issue #2091）。名前は機械で
 * 突き合わせられるので、ずれたらここが落ちる。
 *
 * **射程は `docs/` だけ。** `{…}` は表示文字列だけの書き方ではなく、`agent-ops/` は GitHub の
 * API のパス（`repos/{owner}/{repo}/…`）を同じ形で書く。対応表を説明しているのは `docs/` の側
 * だけなので、そこに閉じる。
 *
 * 置き場がここなのは、**片側が同梱の対応表そのもの**だから——対応表の書式を直した副作用で赤くなる
 * （tests/architecture/testKinds.test.ts の3種類目）。
 */

const ROOT = resolve(__dirname, '../..');

/** 差し込みの名前。`{subject: self}` のような YAML の写しと混ざらないよう、識別子1つだけを見る。 */
const PLACEHOLDER = /\{[a-z_][a-z0-9_]*\}/g;

/** 同梱の対応表（`src/assets/locale/ja.yaml`）が持つ書式に、実際に書かれている差し込み。 */
function placeholdersInBundledLocale(): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const name of node.match(PLACEHOLDER) ?? []) found.add(name);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  visit(parse(bundledLocaleText()));
  return found;
}

/** `docs/` の文書（射程は {@link specDocs} が1箇所で持つ）。 */
function documents(): string[] {
  return specDocs(ROOT);
}

/** その本文が名指しする差し込みを、行番号付きで返す。 */
function placeholdersIn(text: string): { name: string; line: number }[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) => (line.match(PLACEHOLDER) ?? []).map((name) => ({ name, line: index + 1 })));
}

const BUNDLED = placeholdersInBundledLocale();

describe('docs/ が挙げる差し込みの名前は、同梱の対応表の書式に在る', () => {
  it('対応表から差し込みを拾えている（拾えなければ以下がすべて素通しになる）', () => {
    expect(BUNDLED).toContain('{base}');
    expect(BUNDLED).toContain('{value}');
  });

  it.each(documents())('%s', (rel) => {
    const unknown = placeholdersIn(readFileSync(join(ROOT, rel), 'utf-8')).filter(
      ({ name }) => !BUNDLED.has(name),
    );
    expect(unknown.map(({ name, line }) => `${rel}:${line} ${name}`)).toEqual([]);
  });

  it('対応表に無い名前を書けば落ちる', () => {
    const probe = '差し込みのある書式は、`{container}` のように名前で書きます。';
    expect(placeholdersIn(probe).filter(({ name }) => !BUNDLED.has(name))).toEqual([
      { name: '{container}', line: 1 },
    ]);
  });

  it('YAMLの写し（`{tag: x}`）は差し込みとして読まない', () => {
    expect(placeholdersIn('`{subject: self, matches: {tag: wide_open_container}}`')).toEqual([]);
  });
});

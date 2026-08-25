import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv/dist/2020';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * `docs/engine/WorldCodex.schema.json`（YAML文法の形式的なスキーマ）と、同梱の定義YAMLが
 * 食い違っていないことの検査。
 *
 * **スキーマの正はローダーの実装**（WorldCodexSchema.md 冒頭）なので、ここが赤くなったら直すのは
 * スキーマの側。ローダーへ文法を足してYAMLがそれを使い始めた瞬間に、スキーマがまだ知らなければ
 * この検査が落ちる——**書いた人がその場で気付く**ための1本で、走らせる人が居ないまま乖離が
 * 育つのを止める（実測で146件まで育ったことがある。issue #800）。
 *
 * 「受け入れる」だけを見ると、スキーマを緩めれば緑になってしまうので、**外れた記述を拒むことも
 * 併せて見る**。赤の意味は2本で分かれる——受理側の赤は「スキーマがまだ知らない文法がある」、
 * 拒否側の赤は「スキーマが緩んで何も見なくなった」。
 */

const SCHEMA_PATH = 'docs/engine/WorldCodex.schema.json';

/**
 * スキーマを組む。`strict`を切らないのは、綴りを間違えたキーワード（`additionalProprties`）が
 * 黙って無視されるとスキーマが何も見なくなるため——ajvのstrictモードがその場で落とす。
 */
function compileSchema(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
}

/** 1つの文書に対する違反を「どこで何が」の1行ずつに畳む。 */
function violationsOf(validate: ValidateFunction, label: string, document: unknown): string[] {
  if (validate(document)) return [];
  return (validate.errors ?? []).map(
    (error) => `${label}${error.instancePath === '' ? '' : ` ${error.instancePath}`}: ${error.message}`,
  );
}

/** 拒まれるべき記述。WorldCodexSchema.md 1節が「拒否を確認済み」と書いている観点をここへ移した。 */
const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
  ['識別子の命名規則に反するキー', { object_defs: { Twig: { props: {} } } }],
  ['未定義の比較演算子', { traits: { t: { passives: [{ conditions: [{ prop: 'x', between: 1 }] }] } } }],
  [
    'set/addの対象にchild',
    { traits: { t: { interactions: { a: { trigger: 'menu', add: { child: { x: 1 } } } } } } },
  ],
  [
    'destroyの対象にancestor',
    { traits: { t: { interactions: { a: { trigger: 'menu', destroy: 'ancestor' } } } } },
  ],
  [
    '枠のacceptにtagとobjectを同時指定',
    { traits: { t: { slots: { s: { cell: { accept: { tag: 'item', object: 'twig' } } } } } } },
  ],
  ['枠のacceptがtagもobjectも持たない', { traits: { t: { slots: { s: { cell: { accept: {} } } } } } }],
  ['操作にtriggerが無い', { traits: { t: { interactions: { a: { destroy: 'self' } } } } }],
  ['廃止したauto_placement', { traits: { t: { slots: { s: { auto_placement: false } } } } }],
  ['passivesを配列でなく単一マッピングで書く', { traits: { t: { passives: { add: { self: { x: 1 } } } } } }],
  [
    'conditionsの葉にslotとpropを同時指定',
    { traits: { t: { passives: [{ conditions: [{ prop: 'x', slot: 's', matches: { tag: 'item' } }] }] } } },
  ],
  [
    'conditionsのvalueに未対応のmax',
    { traits: { t: { passives: [{ conditions: [{ prop: 'x', gte: 'max' }] }] } } },
  ],
  [
    'in/not_inに配列でないvalueを渡す',
    { traits: { t: { passives: [{ conditions: [{ prop: 'x', in: 1 }] }] } } },
  ],
  [
    'spawnに生む型が無い',
    { traits: { t: { interactions: { a: { trigger: 'menu', spawn: { into: 'self' } } } } } },
  ],
  [
    'moveの行き先を1つも書かない',
    { traits: { t: { interactions: { a: { trigger: 'menu', move: { subject: 'self' } } } } } },
  ],
  [
    'レシピの要求にconsumeが無い',
    { object_defs: { o: { recipes: { r: { steps: [{ requires: [{ object: 'twig' }], duration: 1 }] } } } } },
  ],
  ['未知のルートキー', { object_defs_typo: {} }],
];

describe('WorldCodex.schema.json', () => {
  it('Draft 2020-12 のスキーマとして組める', () => {
    expect(() => compileSchema()).not.toThrow();
  });

  it('同梱の定義YAMLをすべて受け入れる', () => {
    const validate = compileSchema();
    const paths = worldCodexYamlPaths();

    const violations = paths.flatMap((path) =>
      violationsOf(validate, path, parse(readFileSync(path, 'utf8'))),
    );

    // 読み込む先が空になったことも見張る（置き場が動くと、検査が黙って何も見なくなる）。
    expect(paths.length).toBeGreaterThan(0);
    expect(violations, 'ローダーが受け付ける文法をスキーマが知らない（直すのはスキーマの側）').toEqual([]);
  });

  it('文法から外れた記述を拒む', () => {
    const validate = compileSchema();

    const accepted = REJECTED.filter(([, document]) => validate(document)).map(([label]) => label);

    expect(accepted, 'スキーマが緩んで、外れた記述を通すようになっている').toEqual([]);
  });
});

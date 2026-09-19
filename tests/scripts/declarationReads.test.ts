import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildReadIndex } from '../../scripts/declarationReads.mjs';

/**
 * `scripts/declarationReads.mjs` の検査。
 *
 * この索引が答えるのは「その名前を**読んでいる**ファイルはどれか」で、
 * `tests/architecture/unreadFields.test.ts` はこの答えだけを見て誰も読まないフィールドを挙げる。
 * **書きを読みと数えた瞬間に、向こうの検査は何も見なくなる**——組み立てているだけの宣言が
 * 読み手を持つことになるので、一覧は空のまま緑になる。
 *
 * 現物のコードに対して見つけられることは向こうが押さえるので、ここで見るのは**位置の見分け**
 * だけ。道具の入力は任意のTypeScriptなので、確かめたい形をその場で書く。
 */

const WORKSPACE = mkdtempSync(join(tmpdir(), 'declaration-reads-'));

/** 見分けたい位置を1つずつ含んだソース。 */
const SAMPLE = `
interface Plan {
  readonly discards: readonly string[];
  readonly kept: readonly string[];
}

export function plan(): Plan {
  return { discards: [], kept: [] };
}

export function keptCount(from: Plan): number {
  const { kept } = from;
  return kept.length;
}

export class Counter {
  #count = 0;

  bump(): void {
    this.#count += 1;
  }

  get value(): number {
    return this.#count;
  }
}

export class Box {
  private label = '';

  rename(next: string): void {
    this.label = next;
  }
}
`;

writeFileSync(join(WORKSPACE, 'sample.ts'), SAMPLE);
const READS = buildReadIndex(WORKSPACE, ['sample.ts']);

afterAll(() => rmSync(WORKSPACE, { recursive: true, force: true }));

function readers(name: string): readonly string[] {
  return [...(READS.get(name) ?? [])];
}

describe('読みだけを数えた索引', () => {
  it('宣言とオブジェクトリテラルのキーだけの名前を、読まれていないと答える', () => {
    expect(readers('discards'), 'discardsを読んでいる場所は無い').toEqual([]);
  });

  it('分割代入とプロパティの参照を、読みと答える', () => {
    expect(readers('kept')).toEqual(['sample.ts']);
  });

  it('代入の左辺だけの名前を、読まれていないと答える', () => {
    expect(readers('label'), 'this.label = next は書き').toEqual([]);
  });

  it('privateフィールドを、宣言と同じ`#`付きの字面で引ける', () => {
    expect(readers('#count'), '索引のキーは`#`ごと（引く側も落とさない）').toEqual(['sample.ts']);
    expect(readers('count'), '`#`を落とした名前では引けない').toEqual([]);
  });
});

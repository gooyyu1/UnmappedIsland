import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NameRegistry } from '../../src/domain/NameRegistry';
import type { LocalIndexByGlobalId } from '../../src/domain/LocalIndexByGlobalId';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * グローバルIDの種類分け（[`GlobalId`](../../src/domain/GlobalId.ts)）が効いていることの検査。
 *
 * **`@ts-expect-error` の行が、この検査の本体。** 受け口が素の `number` へ戻れば、その行は型で
 * 止まらなくなり、`@ts-expect-error` のほうが余ったものとして `npm run typecheck` が赤くなる
 * ——赤が出るのは vitest ではなく型検査のほうで、CIはどちらも常に走らせる。
 *
 * **渡す相手は、どれも実際に配られたIDにする。** 素のnumberとして止まったのでは、名前空間で
 * 分かれていることを確かめたことにならない（`GlobalId<Namespace>` が Namespace を見なくなっても
 * 緑のままになる）。名前空間はどれも0始まりの連番なので、通れば別の名前空間の同じ番号が黙って引かれる。
 *
 * 実行時の主張（IDは素の数のまま）も同じ場所で確かめる。印は型の上にしか無く、実体が
 * `number` でなくなったらMapの鍵も配列の添字も一斉に壊れるため。
 */
const ROOT = resolve(__dirname, '../..');

/** 値をIDとして読み替えてよい唯一の場所。別名の一覧もここが持つ。 */
const READERS = 'src/domain/GlobalId.ts';

/** そのディレクトリ以下の `.ts`（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

const readSource = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

describe('グローバルIDの種類分け', () => {
  const codex = new WorldCodexYamlLoader()
    .load(
      'globalId.yaml',
      `
property_tags:
  vitals:
  wear:

object_defs:
  stone:
    tags: [mineral]
    props:
      weight:
        tags: [vitals]
        value: 100
      condition:
        tags: [wear]
        value: 100
      mood: {value: calm}
    slots:
      contents: {}
`,
    )
    .buildAndReset();

  const stoneId = codex.objectNames.getId('stone');
  const weightId = codex.propertyNames.getId('weight');
  const contentsSlotId = codex.slotNames.getId('contents');
  const mineralTagId = codex.tagNames.getId('mineral');
  const vitalsPropertyTagId = codex.propertyTagNames.getId('vitals');
  const calmSymbolId = codex.symbolNames.getId('calm');

  const stone = new WorldSession(codex).createObject(stoneId);

  it('IDの実体は素のnumberのまま', () => {
    for (const id of [stoneId, weightId, contentsSlotId, mineralTagId, vitalsPropertyTagId, calmSymbolId])
      expect(typeof id).toBe('number');
    expect(stone.getProperty(weightId).number).toBe(100);
  });

  it('素のnumberは、どの名前空間の受け口にも渡せない', () => {
    // @ts-expect-error NameRegistryを通っていない数は型のIDではない。
    codex.objects.tryGet(stoneId as number);
    // @ts-expect-error 同じくプロパティのIDではない。
    stone.tryGetProperty(weightId as number);
    // @ts-expect-error 同じくスロットのIDではない。
    stone.tryGetSlot(contentsSlotId as number);
    // @ts-expect-error 同じく型のタグのIDではない。
    stone.def.hasTag(mineralTagId as number);
    // @ts-expect-error 同じくプロパティのタグのIDではない。
    stone.propertiesWithTag(vitalsPropertyTagId as number);
    // @ts-expect-error 同じくシンボルのIDではない。
    codex.symbolNames.tryGetName(calmSymbolId as number);

    expect(stone.tryGetProperty(weightId)?.def.name).toBe('weight');
  });

  it('別の名前空間のIDは、受け口に渡せない', () => {
    // @ts-expect-error スロットのIDはプロパティのIDではない。
    stone.tryGetProperty(contentsSlotId);
    // @ts-expect-error プロパティのIDはスロットのIDではない。
    stone.tryGetSlot(weightId);
    // @ts-expect-error 型のIDはプロパティのIDではない。
    stone.tryGetProperty(stoneId);
    // @ts-expect-error シンボルのIDは型のIDではない。
    codex.objects.tryGet(calmSymbolId);

    expect(stone.tryGetSlot(contentsSlotId)?.def.name).toBe('contents');
  });

  it('型のタグとプロパティのタグは、互いの受け口に渡せない', () => {
    // タグは2つの名前空間に分かれている（4.1節と6.7節）。番号だけでは見分けが付かないので、
    // 取り違えると「そのタグを持たない」が静かに返る。
    // @ts-expect-error プロパティのタグのIDは、型のタグのIDではない。
    stone.def.hasTag(vitalsPropertyTagId);
    // @ts-expect-error 型のタグのIDは、プロパティのタグのIDではない。
    stone.propertiesWithTag(mineralTagId);

    expect(stone.def.hasTag(mineralTagId)).toBe(true);
    expect(stone.propertiesWithTag(vitalsPropertyTagId).map((p) => p.def.name)).toEqual(['weight']);
  });

  it('NameRegistryが配ったIDの並びは、配った順にその名前空間を覆う', () => {
    // 添字を数える形で並びを作ると、そこが素の数からIDへ変わる場所になる（NameRegistry.ids）。
    // 並びが宣言順であることは、UIがタブ・棚の並び順としてそのまま使う（WorldCodex.propertyTagNames）。
    expect(codex.propertyTagNames.ids.map((id) => codex.propertyTagNames.getName(id))).toEqual([
      'vitals',
      'wear',
    ]);
    expect(codex.slotNames.ids.map((id) => codex.slotNames.getName(id))).toContain('contents');
    expect(codex.propertyTagNames.ids).toContain(vitalsPropertyTagId);
  });

  it('種類の付いた名前空間・表を、素のnumberのものとして扱えない', () => {
    // **見張っているのは「広がらないこと」。** メソッドの引数は既定では双変なので、不変にする手を
    // 失うと `NameRegistry<PropertyGlobalId>` が `NameRegistry<number>` として通り、そこから先は
    // 素の数が引数として入る。境界がクラスの中だけであることはそれで破れる——**名前空間を増やす者が
    // 型エラーを避けて `in out` を外す**のが、いちばん起きやすい破り方。
    //
    // 広がった時点で代入が通り、余った `@ts-expect-error` が `npm run typecheck` を赤くする。
    // 表のほうは、不変な NameRegistry を持っていることでも不変になるので、`in out` の2語だけを
    // 外しても広がらない（だからこの試験は2語ではなく代入の可否を見る）。
    // @ts-expect-error 種類の付いた名前空間は、素のnumberの名前空間ではない。
    const widenedNames: NameRegistry<number> = codex.propertyNames;
    // @ts-expect-error 種類の付いた表は、素のnumberの表ではない。
    const widenedIndex: LocalIndexByGlobalId<number> = stone.def.propertyIndexByGlobalId;

    expect(widenedNames.getName(weightId)).toBe('weight');
    expect(widenedIndex.toLocal(weightId)).toBe(0);
  });

  it('値をIDとして読む経路が、GlobalId.ts の外に無い', () => {
    // 「値をIDとして読む経路はこの2つに寄せる」（GlobalId.ts）を守るものがこれ。読み出す側それぞれが
    // `as <種類>GlobalId` と書けば、どの名前空間へ持っていくかの判断が読み手の数だけ散り、しかも
    // **型検査は緑のまま**——書き換えは型の上だけで済んでしまう。字面で見張る以外に手立てが無い。
    //
    // 見張る綴りは GlobalId.ts が持つ別名そのものから作る（ここへ書き写すと、名前空間を1つ足した
    // ぶんだけ見張りに穴が空く）。**拾うのは名前空間の別名だけ**——`NotAGlobalId` のように
    // 「IDではない」と名乗る型は、綴りは似ていても向きが逆で、書いても越境にならない。
    const aliases = [...readSource(READERS).matchAll(/export type (\w+) = GlobalId</g)].map(
      (match) => match[1],
    );
    expect(aliases.length, '別名が1つも読めていない').toBeGreaterThan(0);

    const writesId = new RegExp(String.raw`\bas\s+(?:${aliases.join('|')})\b`);
    const offenders = sourcesIn('src')
      .filter((file) => file !== READERS)
      .filter((file) => writesId.test(readSource(file)));

    expect(offenders).toEqual([]);
  });
});

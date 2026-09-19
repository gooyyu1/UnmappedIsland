import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { trackedDocs } from '../../scripts/docScope.mjs';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { MINUTES_PER_TICK } from '../../src/domain/worldTime';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import { bundledCodex, worldCodexYamlPaths } from '../support/worldCodexFiles';
import { WorldSession } from '../../src/domain/WorldSession';
import type { WorldObject } from '../../src/domain/WorldObject';

/**
 * 行動の所要時間がtickの格子に乗っていることを、同梱のYAMLと、仕様書がそれを写して見せている例に
 * 対して確かめる（[`docs/engine/ActionSystem.md`](../../docs/engine/ActionSystem.md) 6.2節）。
 *
 * tickが回るのは**絶対時刻が15分の倍数になる瞬間**なので、格子から外れた長さの行動は、いつ押したかで
 * 跨ぐtickの数が変わる——同じ行動が獣に手番を与えたり与えなかったりする。tickは腐敗・火の衰え・空腹が
 * 動く瞬間でもあるので、これは見た目の端数ではなく性質の違いになる。
 *
 * **数え上げにしない。** 今ずれている箇所を並べる検査は、新しく足した行動を素通りさせる。ここが見るのは
 * 「世界じゅうの行動」と「所要時間を動かしうる宣言のすべて」で、**どちらも定義から引く**。
 * **1つだけ射程が狭い**——「縮めきっても0分にならない」は、同じ名前を複数の型が名乗っているとき、
 * その宣言の中しか見ない（どの型の素へ積む分かが名前から決まらないため。下の検査に理由が在る）。
 */
const codex = bundledCodex();

const ROOT = resolve(__dirname, '../..');

/** 5分未満を要求する操作（飲む）のための、格子のもう1つの目（ActionSystem.md 6.2節）。 */
const SHORT_MINUTES = 5;

/** 所要時間を名乗るプロパティの名前の尻尾。`duration`が読める相手はこの形に揃える。 */
const MINUTES_SUFFIX = '_minutes';

/** その分数が格子に乗っているか（0分・5分・15分の倍数のいずれか）。 */
function onGrid(minutes: number): boolean {
  return minutes === 0 || minutes === SHORT_MINUTES || minutes % MINUTES_PER_TICK === 0;
}

/** 世界じゅうのYAMLの構文木（型の側の宣言を字面から辿るため）。 */
function worldCodexRoots(): readonly unknown[] {
  return worldCodexYamlPaths().map((path) => parseDocument(readFileSync(path, 'utf8')).contents);
}

/** スカラーの数値（数値でなければundefined）。 */
function numberOf(node: unknown): number | undefined {
  if (!isScalar(node)) return undefined;
  return typeof node.value === 'number' ? node.value : undefined;
}

/**
 * `modify`・`add`の下で、そのプロパティへ積まれている量をすべて集める。
 *
 * **役（self/parent/ancestor/agent…）では絞らない**——どの役へ積んでも、行き着く先が所要時間なら
 * 分数が動く。積む側は世界じゅうに散っている（腕の段・荷重の段・海流・帆）ので、名前で拾う。
 */
function amountsMovingMinutes(node: unknown, found: Map<string, number[]>): void {
  if (isSeq(node)) {
    for (const item of node.items) amountsMovingMinutes(item, found);
    return;
  }
  if (!isMap(node)) return;

  for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if ((key === 'modify' || key === 'add') && isMap(pair.value)) {
      for (const role of pair.value.items) {
        if (!isMap(role.value)) continue;
        for (const assignment of role.value.items) {
          const name = isScalar(assignment.key) ? String(assignment.key.value) : '';
          const amount = numberOf(assignment.value);
          if (name.endsWith(MINUTES_SUFFIX) && amount !== undefined)
            found.set(name, [...(found.get(name) ?? []), amount]);
        }
      }
    }
    amountsMovingMinutes(pair.value, found);
  }
}

/** 所要時間を積まずに置き換えている宣言（`set`・`transfer` の行き先）を、在り処つきで集める。 */
function replacedMinutes(node: unknown, found: string[]): void {
  if (isSeq(node)) {
    for (const item of node.items) replacedMinutes(item, found);
    return;
  }
  if (!isMap(node)) return;

  for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (key === 'set' && isMap(pair.value))
      for (const role of pair.value.items) {
        if (!isMap(role.value)) continue;
        for (const assignment of role.value.items) {
          const name = isScalar(assignment.key) ? String(assignment.key.value) : '';
          if (name.endsWith(MINUTES_SUFFIX)) found.push(`set ${name}`);
        }
      }
    // transferは行き先をto_propで名指す（from_propは出どころなので所要時間にはならない）。
    if (key === 'to_prop' && isScalar(pair.value) && String(pair.value.value).endsWith(MINUTES_SUFFIX))
      found.push(`transfer ${String(pair.value.value)}`);
    replacedMinutes(pair.value, found);
  }
}

/** `duration` に分数を直に書いてある宣言をすべて集める（参照で書いてあるものは拾わない）。 */
function writtenDurations(node: unknown, found: number[]): void {
  if (isSeq(node)) {
    for (const item of node.items) writtenDurations(item, found);
    return;
  }
  if (!isMap(node)) return;

  for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    const minutes = numberOf(pair.value);
    if (key === 'duration' && minutes !== undefined) found.push(minutes);
    writtenDurations(pair.value, found);
  }
}

/**
 * 仕様書が例の中で `duration` へ直に書いている分数。**キーが `duration` ちょうどのものだけ**を拾う
 * ——`season_duration`（季節の日数、docs/diagnostics/ClimateSystemStats.md）は分ではない。
 */
const DOC_DURATION = /(?:^|[\s{])duration:\s*(-?\d+(?:\.\d+)?)/g;

/** `docs/` の文書。追跡しているものだけを見る（生成物の `site/` は初めから入らない）。 */
function documents(): readonly string[] {
  return trackedDocs(ROOT).filter((rel) => rel.startsWith(`docs${sep}`));
}

/** 仕様書の例が書いている所要時間を、在り処つきで集める。 */
function durationsInDocs(): readonly { readonly where: string; readonly minutes: number }[] {
  const found: { where: string; minutes: number }[] = [];
  for (const rel of documents())
    readFileSync(join(ROOT, rel), 'utf-8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        for (const match of line.matchAll(DOC_DURATION))
          found.push({ where: `${rel}:${index + 1}`, minutes: Number(match[1]) });
      });
  return found;
}

/** 所要時間を名乗るプロパティの宣言（同じ名前が複数の型に在るので、名前ごとに全部）。 */
function minutePropBodies(): ReadonlyMap<string, unknown[]> {
  const found = new Map<string, unknown[]>();

  const walk = (node: unknown, underProps: boolean): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, false);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (underProps && key.endsWith(MINUTES_SUFFIX)) found.set(key, [...(found.get(key) ?? []), pair.value]);
      walk(pair.value, key === 'props');
    }
  };

  for (const root of worldCodexRoots()) walk(root, false);
  return found;
}

/** そのプロパティの宣言が名乗る素の値（`value`）。宣言していなければundefined。 */
function declaredValueOf(body: unknown): number | undefined {
  return isMap(body) ? numberOf(body.get('value', true)) : undefined;
}

/** そのプロパティの宣言が土台にしている相手の名前（`base`）。土台を持たなければundefined。 */
function baseNameOf(body: unknown): string | undefined {
  const base = isMap(body) ? body.get('base', true) : undefined;
  if (!isMap(base)) return undefined;
  const prop = base.get('prop', true);
  return isScalar(prop) ? String(prop.value) : undefined;
}

/** そのプロパティの宣言が持つ`range`の両端（持たなければundefined）。 */
function rangeOf(body: unknown): { readonly min?: number; readonly max?: number } | undefined {
  const range = isMap(body) ? body.get('range', true) : undefined;
  if (!isMap(range)) return undefined;
  return { min: numberOf(range.get('min', true)), max: numberOf(range.get('max', true)) };
}

/** その値のプレイヤーキャラクタ（腕前を段ごとに振るため）。 */
function characterWithSkills(value: number): WorldObject {
  const character = new WorldSession(codex).createObject(codex.objectNames.getId('medic'));
  for (const property of character.propertiesWithTag(codex.propertyTagNames.getId('skill')))
    property.setNumberWithoutEvents(value);
  return character;
}

/** 腕前の段の下端（docs/engine/SkillSystem.md 6節）。段の数は腕の宣言から引く。 */
function skillStageMinimums(): readonly number[] {
  const skill = characterWithSkills(0).propertiesWithTag(codex.propertyTagNames.getId('skill'))[0];
  return skill.def.stages.map((stage) => stage.min ?? 0);
}

describe('行動の所要時間はtickの格子に乗る', () => {
  it('世界じゅうの行動が、素の分数で格子に乗っている', () => {
    // **全型を総なめする**ので、操作もレシピも、足した人がそのままここへ掛かる（craftingStepsOfが
    // その2つを1つの形へ均す）。ここで出るのは素人・空身の分数で、そこから動く分は下の検査が見る。
    //
    // **レシピはここでは全工程の和として出る**（craftingStepsOfが工程の別を畳む）。工程1つずつは
    // 下の2つ——`duration`の字面と、段を振った実測——が見るので、和が乗って工程が乗らない形は
    // そちらで落ちる。
    const offGrid: string[] = [];
    for (const def of codex.objects)
      for (const step of craftingStepsOf(codex, def))
        if (!onGrid(step.laborMinutes)) offGrid.push(`${def.name} の ${step.name}: ${step.laborMinutes}分`);

    expect(offGrid, '格子から外れた所要時間').toEqual([]);
  });

  it('分数を直に書いた宣言も、どれも格子に乗っている', () => {
    // 一つ上は `craftingStepsOf` が均した形（操作とレシピの工程）を見るので、**そこへ現れない
    // `duration` は素通りする**——枠へ入れるのにかかる時間（`put_in`、GameElementDefinition.md
    // 7.10節）がそれ。`duration` は分数を名乗る唯一のキーなので、字面のほうから拾い直す。
    const written: number[] = [];
    for (const root of worldCodexRoots()) writtenDurations(root, written);
    expect(written.length, '分数を直に書いた宣言が1つも無い').toBeGreaterThan(0);

    expect(
      written.filter((minutes) => !onGrid(minutes)),
      '格子から外れた分数',
    ).toEqual([]);
  });

  it('所要時間を動かすのは、積む宣言（modify・add）だけ', () => {
    // **下の2つが成り立つ前提。** `set`・`transfer` は素の値ごと置き換えるので、動かす量ではなく
    // 動いた後の値を見ないと格子に乗っているか言えない——**積む側だけを見張っている今の形では
    // 素通りする**。書ける場所を1つに絞っておけば、見張りの射程と世界の宣言が食い違わない。
    const replaced: string[] = [];
    for (const root of worldCodexRoots()) replacedMinutes(root, replaced);

    expect(replaced, '所要時間を置き換える宣言（動かすのはmodify・addだけ）').toEqual([]);
  });

  it('所要時間を動かす宣言は、どれもtickの刻みの倍数', () => {
    // 素の分数が格子に乗っていても、動かす側が刻みの倍数でなければ、動いた先が格子から外れる
    // ——腕の段・荷重の段・海流・帆が、どれも所要時間を`modify`で動かしている。
    const moving = new Map<string, number[]>();
    for (const root of worldCodexRoots()) amountsMovingMinutes(root, moving);
    expect(moving.size, '所要時間を動かす宣言が1つも無い').toBeGreaterThan(0);

    const offGrid: string[] = [];
    for (const [name, amounts] of moving)
      for (const amount of amounts)
        if (amount % MINUTES_PER_TICK !== 0) offGrid.push(`${name} を ${amount}分 動かす宣言`);

    expect(offGrid, '刻みの倍数でない動かし方').toEqual([]);
  });

  it('所要時間が土台にする相手も、刻みの倍数でしか動かない', () => {
    // `base`で継ぐ相手（道が継ぐ歩みの遅れ）は所要時間そのものではないので、一つ上の検査では
    // 拾えない。**継いだ先が分数になる**以上、素も動く分も刻みの倍数でなければならない。
    const bases = new Set<string>();
    for (const bodies of minutePropBodies().values())
      for (const body of bodies) {
        const base = baseNameOf(body);
        if (base !== undefined) bases.add(base);
      }
    expect(bases.size, '所要時間が土台にする相手が1つも無い').toBeGreaterThan(0);

    const offGrid: string[] = [];
    for (const name of bases)
      for (const amount of declaredAmountsOf(name))
        if (amount % MINUTES_PER_TICK !== 0) offGrid.push(`${name} の ${amount}`);

    expect(offGrid, '刻みの倍数でない土台').toEqual([]);
  });

  it('15分の倍数でない所要時間は、何にも動かされない', () => {
    // 格子には15分の倍数のほかに0分と5分が在る（飲むのが5分）。**そこへ刻みを足すと外れる**
    // （5 + 15 = 20）ので、短いほうの目に居る所要時間は動かされないことを別に確かめる。
    const moving = new Map<string, number[]>();
    for (const root of worldCodexRoots()) amountsMovingMinutes(root, moving);

    const moved: string[] = [];
    for (const [name, bodies] of minutePropBodies())
      for (const body of bodies) {
        const value = declaredValueOf(body);
        if (value === undefined || value % MINUTES_PER_TICK === 0) continue;
        if (moving.has(name) || baseNameOf(body) !== undefined) moved.push(`${name}（素 ${value}分）`);
      }

    expect(moved, '刻みに乗っていないのに動かされる所要時間').toEqual([]);
  });

  it('縮めきっても、所要時間は0分にならない', () => {
    // **0分は格子に乗っている**ので、上の検査はどれも「腕で0分まで縮む手作業」を通してしまう。
    // 0分は「1 tickに何度でもできる」を意味する（ActionSystem.md 6.2節）ので、**そこへ落ちてよいのは
    // 繰り返しても得をしない操作だけ**——腕を上げた者だけがその状態になる形は、その線の外側にある。
    //
    // 見るのは**素と、自分を縮める宣言だけで分数が決まるプロパティ**。土台（`base`）を持つものは
    // 継ぐ相手ぶんが足され、`range`を持つものはその下端が止めるので、ここでは答えが出ない。
    //
    // **縮める分をどこから拾うかは、その名前を宣言している型の数で決まる。** 1つの型しか名乗って
    // いない名前なら、世界じゅうのどこがその名前を縮めても行き先はその1つなので、世界じゅうから
    // 集める——**別の型の`passives`が名前で縮める形**は、宣言の中だけを見ていると射程の外に落ちる。
    // 同じ名前が複数の型に在る（死体ごとの`butcher_minutes`）ときだけ宣言の中に絞る。そこで世界
    // じゅうから集めると、別の型の縮める分まで1つの素へ積むことになる。
    const worldWide = new Map<string, number[]>();
    for (const root of worldCodexRoots()) amountsMovingMinutes(root, worldWide);

    const emptied: string[] = [];
    let checked = 0;
    for (const [name, bodies] of minutePropBodies())
      for (const body of bodies) {
        const value = declaredValueOf(body);
        if (value === undefined || baseNameOf(body) !== undefined || rangeOf(body) !== undefined) continue;
        checked += 1;
        const own = new Map<string, number[]>();
        amountsMovingMinutes(body, own);
        const amounts = (bodies.length === 1 ? worldWide.get(name) : own.get(name)) ?? [];
        const shortest = amounts.reduce((left, amount) => left + Math.min(amount, 0), value);
        if (shortest <= 0) emptied.push(`${name}: 素 ${value}分 → 縮めきると ${shortest}分`);
      }
    expect(checked, '素と縮める宣言だけで決まる所要時間が1つも無い').toBeGreaterThan(0);

    expect(emptied, '縮めきると0分以下になる所要時間').toEqual([]);
  });

  it('所要時間のrangeの両端も格子に乗る', () => {
    // `range`は合計をその中へ収める（GameElementDefinition.md 6.3節）ので、**端が格子から外れて
    // いれば、そこで止まった分数がそのまま外れる。**
    const offGrid: string[] = [];
    for (const [name, bodies] of minutePropBodies())
      for (const body of bodies) {
        const range = rangeOf(body);
        if (range === undefined) continue;
        for (const [label, end] of [
          ['min', range.min],
          ['max', range.max],
        ] as const)
          if (end !== undefined && !onGrid(end)) offGrid.push(`${name} の range.${label}: ${end}分`);
      }

    expect(offGrid, '格子から外れたrangeの端').toEqual([]);
  });

  it('腕を上げても、レシピの工程は格子から外れない', () => {
    // 上の検査は宣言の形を見るので、**縮めた後の分数までは出ない**——レシピの`deftness`は工程ごとに
    // 引かれるので、引いた先が実際に格子へ乗るかは分数を出して確かめる（docs/world/Skills.md 7節）。
    //
    // **素の型で絞らず、同じレシピを見た回数で畳む。** 変種（作りかけ・塩漬けの軸）が持つレシピは
    // 素の型のものと同じ`RecipeDef`なので、**型で絞ると変種にしか現れないレシピを落とす**一方、
    // 絞らなければ同じ1本を何度も見るだけで済む。
    const offGrid: string[] = [];
    for (const value of skillStageMinimums()) {
      const character = characterWithSkills(value);
      const seen = new Set<RecipeDef>();
      for (const product of codex.objects)
        for (const recipe of product.recipesProducingThis) {
          if (seen.has(recipe)) continue;
          seen.add(recipe);
          for (const [index, step] of recipe.steps.entries()) {
            const minutes = recipe.minutesFor(step, character);
            if (!onGrid(minutes))
              offGrid.push(`${product.name}.${recipe.name} の工程${index + 1}（腕 ${value}）: ${minutes}分`);
          }
        }
      expect(seen.size, `腕 ${value} で見たレシピ`).toBeGreaterThan(0);
    }

    expect(offGrid, '腕を上げると格子から外れる工程').toEqual([]);
  });

  it('仕様書が見せているYAMLの例も、格子に乗った所要時間を書いている', () => {
    // **例は読む人が書き方を写す先**なので、格子から外れた値が載っていると、そこから書き始めた宣言が
    // 上の検査で落ちる（issue #2227）。落ちてから直すより、写される側を格子に留める。
    //
    // **見るのは格子だけで、世界の値との一致は見ない。** 例は抜粋なので「どこまで一致していれば
    // 合っているか」が決められないが、格子に乗っているかは抜き方と関わりなく決まる。
    const written = durationsInDocs();
    expect(written.length, '仕様書が例として書いている所要時間が1つも無い').toBeGreaterThan(0);

    expect(
      written.filter(({ minutes }) => !onGrid(minutes)).map(({ where, minutes }) => `${where}: ${minutes}分`),
      '格子から外れた、仕様書の例の所要時間',
    ).toEqual([]);
  });
});

/** そのプロパティの、素の値と動かされる量をすべて（宣言していない相手なら空）。 */
function declaredAmountsOf(name: string): readonly number[] {
  const values: number[] = [];
  for (const root of worldCodexRoots()) collectDeclaredValues(root, name, values);
  return [...values, ...movingAmountsOf(name)];
}

/** `props`の下でその名前が名乗っている`value`をすべて集める。 */
function collectDeclaredValues(node: unknown, name: string, found: number[]): void {
  if (isSeq(node)) {
    for (const item of node.items) collectDeclaredValues(item, name, found);
    return;
  }
  if (!isMap(node)) return;

  for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (key === 'props' && isMap(pair.value))
      for (const prop of pair.value.items)
        if (isScalar(prop.key) && String(prop.key.value) === name) {
          const value = declaredValueOf(prop.value);
          if (value !== undefined) found.push(value);
        }
    collectDeclaredValues(pair.value, name, found);
  }
}

/** その名前のプロパティが`modify`・`add`で動かされている量をすべて。 */
function movingAmountsOf(name: string): readonly number[] {
  const found: number[] = [];

  const walk = (node: unknown): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if ((key === 'modify' || key === 'add') && isMap(pair.value))
        for (const role of pair.value.items) {
          if (!isMap(role.value)) continue;
          for (const assignment of role.value.items) {
            const amount = numberOf(assignment.value);
            if (isScalar(assignment.key) && String(assignment.key.value) === name && amount !== undefined)
              found.push(amount);
          }
        }
      walk(pair.value);
    }
  };

  for (const root of worldCodexRoots()) walk(root);
  return found;
}

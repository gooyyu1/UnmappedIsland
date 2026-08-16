import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { CraftingStep } from '../../src/domain/defs/CraftingStep';
import type { ObjectDef, RangeCycle } from '../../src/domain/defs/ObjectDef';
import type { TickDelta } from '../../src/domain/defs/PassiveEffect';
import type { StaticValueResolver } from '../../src/domain/defs/ReferenceRoot';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義（`src/assets/world-codex/*.yaml`）だけから「時間あたりの収支」を計算し、
 * `docs/diagnostics/BalanceStats.md`へ書き出す。
 *
 * 通常のテストスイート（`npm test`）には含めない: 合否判定を目的とした回帰テストではなく、
 * 数値を触るたびに差分で影響を見るための再計算が目的のため、`RUN_BALANCE_STATS`環境変数が
 * 立っているときだけ実行する。定義の数値を変えた後に再生成する: `npm run stats:balance`
 *
 * 消費（passivesのtick毎の増減）も供給（工程の所要時間と産出）も、突き詰めれば
 * 「プロパティ量 ÷ 分」という1つの物差しに乗る——tick毎の増減は「15分かかって値が動く工程」と
 * 同じ形なので、消費表と供給表は符号の違いでしかなく、連鎖表はその足し算になる。
 */

const TICKS_PER_DAY = 96;
const MINUTES_PER_TICK = 15;
const MINUTES_PER_DAY = TICKS_PER_DAY * MINUTES_PER_TICK;

/** 浮動小数の比較で「改善した」と見なさない差（分）。 */
const EPSILON = 1e-9;

/** 消費表の行を「プロパティ」と「条件」の対で引くための区切り。識別子にも段の名前にも現れない。 */
const KEY_SEPARATOR = ' :: ';

/**
 * 工程を実行するのに要る、消費されない入力1件。costがundefinedなら、この土地では前提が揃わない
 * （その経路はここでは辿れない）。
 */
interface Prerequisite {
  readonly label: string;
  readonly objectGlobalId: number | undefined;
  readonly cost: Cost | undefined;
}

/** 素材から摂取までの時間（分）。探索に費やす分と、加工に費やす分を分けて持つ。 */
interface Cost {
  readonly exploreMinutes: number;
  readonly craftMinutes: number;
}

/** 工程1つと、それを宣言している型。 */
interface StepRef {
  readonly def: ObjectDef;
  readonly step: CraftingStep;

  /**
   * 時間で回る工程（罠の判定）なら、その周期と、宣言元の寿命。**プレイヤーは待ち時間を払わないが、
   * 設備は待っている間も朽ちる**ので、1周期で使い切る設備の割合（周期÷寿命）が値段になる。
   * 寿命を持たない設備では按分できないためundefined。
   */
  readonly cycle: DeviceCycle | undefined;
}

interface DeviceCycle {
  readonly periodMinutes: number;
  readonly lifetimeMinutes: number | undefined;
}

function totalOf(cost: Cost): number {
  return cost.exploreMinutes + cost.craftMinutes;
}

function addCost(a: Cost, b: Cost): Cost {
  return {
    exploreMinutes: a.exploreMinutes + b.exploreMinutes,
    craftMinutes: a.craftMinutes + b.craftMinutes,
  };
}

function divideCost(cost: Cost, divisor: number): Cost {
  return {
    exploreMinutes: cost.exploreMinutes / divisor,
    craftMinutes: cost.craftMinutes / divisor,
  };
}

function scaleCost(cost: Cost, factor: number): Cost {
  return {
    exploreMinutes: cost.exploreMinutes * factor,
    craftMinutes: cost.craftMinutes * factor,
  };
}

/** 1回の実行で、その型が生まれる期待個数（分岐の確率で重み付けした和）。 */
function expectedSpawns(step: CraftingStep): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const spawn of outcome.spawns)
      counts.set(
        spawn.objectGlobalId,
        (counts.get(spawn.objectGlobalId) ?? 0) + outcome.probability * spawn.count,
      );
  return counts;
}

/** 1回の実行で、対象のプロパティが動く期待量（分岐の確率で重み付けした和）。 */
function expectedDeltas(step: CraftingStep, target: 'actor' | 'self'): ReadonlyMap<number, number> {
  const amounts = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const delta of outcome.deltas) {
      if (delta.target !== target) continue;
      amounts.set(
        delta.propertyGlobalId,
        (amounts.get(delta.propertyGlobalId) ?? 0) + outcome.probability * delta.amount,
      );
    }
  return amounts;
}

/**
 * 1つの土地に立っている前提で、各型を1個手に入れるのに要する時間を求める。
 *
 * 全工程を何度も走査して、入力の値段が下がったら出力の値段も下げる、を変化が止まるまで繰り返す
 * （再帰で辿ると、素材どうしが循環している定義で止まらなくなる）。道具（消費されない入力）の
 * 入手時間は含めない——繰り返し使えるものを1個あたりへ按分するには「何回使うか」の仮定が要る。
 */
class Acquisition {
  readonly costByObject = new Map<number, Cost>();

  /** その型を最も安く生む工程。連鎖を遡って前提の道具を集めるのに使う。 */
  readonly viaStep = new Map<number, StepRef>();

  private readonly steps: readonly StepRef[];
  private readonly codex: WorldCodex;

  constructor(codex: WorldCodex, steps: readonly StepRef[]) {
    this.codex = codex;
    this.steps = steps;
    this.relax();
  }

  /**
   * この工程を1回実行するのに**プレイヤーが払う**時間（労働時間＋消費する入力の入手時間）。
   * 揃わなければundefined。待ち時間は含めない——待っている間に他のことができるため。
   */
  stepCost(ref: StepRef): Cost | undefined {
    const owned = isLocation(this.codex, ref.def);
    let cost: Cost = {
      exploreMinutes: owned ? ref.step.laborMinutes : 0,
      craftMinutes: owned ? 0 : ref.step.laborMinutes,
    };

    // 時間で回る工程は、1周期ぶんだけ設備を使い切る。朽ちない設備は按分できない（待てば無限に得られる）。
    if (ref.cycle !== undefined) {
      if (ref.cycle.lifetimeMinutes === undefined) return undefined;
      const device = this.costByObject.get(ref.def.globalId);
      if (device === undefined) return undefined;
      cost = addCost(cost, scaleCost(device, ref.cycle.periodMinutes / ref.cycle.lifetimeMinutes));
    }

    for (const input of ref.step.inputs) {
      if (!input.consumed) continue;
      const inputCost = this.inputCost(input);
      if (inputCost === undefined) return undefined;
      cost = addCost(cost, inputCost);
    }
    return cost;
  }

  /**
   * この工程を実行するのに要る、消費されない入力（道具・採取ポイント）。土地そのものは除く——
   * どこかの土地には必ず立っているため。
   */
  prerequisites(ref: StepRef): readonly Prerequisite[] {
    const found: Prerequisite[] = [];
    for (const input of ref.step.inputs) {
      if (input.consumed) continue;
      if (input.kind === 'object' && isLocation(this.codex, this.codex.objects.get(input.objectGlobalId)))
        continue;

      // タグ指定の入力は、そのタグを名乗ったうえで実際に使う型を添える（cutting_tool → sharp_stone）。
      const declared =
        input.kind === 'tag'
          ? this.codex.tagName(input.tagGlobalId)
          : this.codex.objectName(input.objectGlobalId);

      const objectGlobalId = this.cheapestCandidate(input);
      if (objectGlobalId === undefined) {
        found.push({ label: declared, objectGlobalId: undefined, cost: undefined });
        continue;
      }

      const chosen = this.codex.objectName(objectGlobalId);
      found.push({
        label: chosen === declared ? chosen : `${declared} → ${chosen}`,
        objectGlobalId,
        cost: this.costByObject.get(objectGlobalId),
      });
    }
    return found;
  }

  /** その型を手に入れるまでの連鎖に現れる工程を、最も安い経路だけ遡って挙げる。 */
  routeOf(objectGlobalId: number, seen = new Set<number>()): readonly StepRef[] {
    if (seen.has(objectGlobalId)) return [];
    seen.add(objectGlobalId);

    const ref = this.viaStep.get(objectGlobalId);
    if (ref === undefined) return [];

    const route: StepRef[] = [ref];
    for (const input of ref.step.inputs) {
      if (!input.consumed) continue;
      const candidate = this.cheapestCandidate(input);
      if (candidate !== undefined) route.push(...this.routeOf(candidate, seen));
    }
    return route;
  }

  /** 入力1件を満たすのに最も安い型。この土地でどれも手に入らなければundefined。 */
  private cheapestCandidate(input: CraftingStep['inputs'][number]): number | undefined {
    let best: number | undefined;
    let bestCost: Cost | undefined;
    for (const objectGlobalId of this.candidatesOf(input)) {
      const cost = this.costByObject.get(objectGlobalId);
      if (cost === undefined) continue;
      if (bestCost === undefined || totalOf(cost) < totalOf(bestCost)) {
        best = objectGlobalId;
        bestCost = cost;
      }
    }
    return best;
  }

  /** 入力1件を満たすのに最も安い値段。この土地でどれも手に入らなければundefined。 */
  private inputCost(input: CraftingStep['inputs'][number]): Cost | undefined {
    const objectGlobalId = this.cheapestCandidate(input);
    return objectGlobalId === undefined ? undefined : this.costByObject.get(objectGlobalId);
  }

  /** 入力1件を満たしうる型のグローバルID（タグ指定なら、そのタグを持つ型すべて）。 */
  private candidatesOf(input: CraftingStep['inputs'][number]): readonly number[] {
    if (input.kind === 'object') return [input.objectGlobalId];

    const found: number[] = [];
    for (let globalId = 0; globalId < this.codex.objects.count; globalId++)
      if (this.codex.objects.get(globalId).tags.includes(input.tagGlobalId)) found.push(globalId);
    return found;
  }

  private relax(): void {
    for (let pass = 0; pass <= this.codex.objects.count; pass++) {
      let improved = false;
      for (const ref of this.steps) {
        const cost = this.stepCost(ref);
        if (cost === undefined) continue;

        for (const [objectGlobalId, count] of expectedSpawns(ref.step)) {
          if (count <= 0) continue;
          const candidate = divideCost(cost, count);
          const known = this.costByObject.get(objectGlobalId);
          if (known !== undefined && totalOf(known) <= totalOf(candidate) + EPSILON) continue;

          this.costByObject.set(objectGlobalId, candidate);
          this.viaStep.set(objectGlobalId, ref);
          improved = true;
        }
      }
      if (!improved) return;
    }
  }
}

function isLocation(codex: WorldCodex, def: ObjectDef): boolean {
  const locationTag = codex.tagNames.tryGetId('location');
  return locationTag !== undefined && def.tags.includes(locationTag);
}

function allDefs(codex: WorldCodex): readonly ObjectDef[] {
  return [...Array(codex.objects.count).keys()].map((globalId) => codex.objects.get(globalId));
}

/**
 * 全型の全工程。宣言順（型のグローバルID順、型の中は宣言順）。プレイヤーが起こす工程に続けて、
 * 時間で回る工程（罠の判定）も並べる。
 *
 * outerは、祖先（＝置かれている土地）が入れる値を解く手立て。罠が掛ける動物の重みは土地が
 * 宣言するので（`inherit`）、これが無いと候補が全部0になる。
 */
function allSteps(codex: WorldCodex, outer?: StaticValueResolver): readonly StepRef[] {
  return allDefs(codex).flatMap((def) => {
    const cycles = def.rangeCycles(outer);
    const lifetimeMinutes = lifetimeOf(cycles);
    return [
      ...def.craftingSteps(outer).map((step) => ({ def, step, cycle: undefined })),
      ...cycles
        .filter((cycle) => cycle.repeats)
        .map((cycle) => ({
          def,
          step: cycle.step,
          cycle: { periodMinutes: cycle.minutes, lifetimeMinutes },
        })),
    ];
  });
}

/** その型が朽ちるまでの時間（分）。複数あれば最も早く尽きるもの。朽ちないならundefined。 */
function lifetimeOf(cycles: readonly RangeCycle[]): number | undefined {
  const ends = cycles.filter((cycle) => cycle.destroysSelf && !cycle.repeats).map((cycle) => cycle.minutes);
  return ends.length === 0 ? undefined : Math.min(...ends);
}

/** 祖先（置かれている土地）の宣言値を答える手立て。宣言していないプロパティは寄与0。 */
function ancestorContext(location: ObjectDef): StaticValueResolver {
  return (root, propertyGlobalId) =>
    root === 'ancestor' ? (location.staticValueOf(propertyGlobalId) ?? 0) : undefined;
}

/** その土地に立っているときに実行できる工程（他の土地が宣言する工程は届かない）。 */
function stepsAt(codex: WorldCodex, steps: readonly StepRef[], location: ObjectDef): readonly StepRef[] {
  return steps.filter((ref) => !isLocation(codex, ref.def) || ref.def.globalId === location.globalId);
}

/** そのゲート（8.2節）を1語で言い表す。消費表の「条件」列。 */
function conditionLabel(codex: WorldCodex, delta: TickDelta): string {
  if (delta.gate.stage !== undefined)
    return `段 ${codex.propertyName(delta.gate.stage.propertyGlobalId)}=${delta.gate.stage.name}`;
  if (delta.gate.conditional) return '条件つき';
  return '常時';
}

/** キャラクタ1人が、自分のプロパティをtick毎にどれだけ動かすか。キーはプロパティと条件。 */
function tickDeltasOf(codex: WorldCodex, def: ObjectDef): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  for (const delta of def.passives.tickDeltas()) {
    if (delta.target !== 'self') continue;
    const key = `${codex.propertyName(delta.propertyGlobalId)}${KEY_SEPARATOR}${conditionLabel(codex, delta)}${
      delta.capped ? '（輸送・在庫がある間）' : ''
    }`;
    byKey.set(key, (byKey.get(key) ?? 0) + delta.amount);
  }
  return byKey;
}

/** 1日にそのプロパティが減る量（常時効く増減だけ）。減らないプロパティは0。 */
function dailyNeeds(codex: WorldCodex, character: ObjectDef): ReadonlyMap<number, number> {
  const needs = new Map<number, number>();
  for (const delta of character.passives.tickDeltas()) {
    if (delta.target !== 'self' || delta.capped) continue;
    if (delta.gate.stage !== undefined || delta.gate.conditional) continue;
    if (delta.amount >= 0) continue;
    needs.set(
      delta.propertyGlobalId,
      (needs.get(delta.propertyGlobalId) ?? 0) + -delta.amount * TICKS_PER_DAY,
    );
  }
  return needs;
}

function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = value.toFixed(digits);
  return rounded === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : rounded;
}

function buildReport(codex: WorldCodex): string {
  const lines: string[] = [];
  const append = (line = ''): void => {
    lines.push(line);
  };

  const characters = codex
    .objectDefNamesWithTag('character')
    .map((name) => codex.objects.get(codex.objectNames.getId(name)));

  append('# アイテム収支レポート');
  append();
  append('`tests/diagnostics/balanceStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）');
  append('だけから計算した「時間あたりの収支」。定義の数値を変えたら以下で再生成する。');
  append();
  append('```');
  append('npm run stats:balance');
  append('```');
  append();

  const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
  const needs = dailyNeeds(codex, character);
  const balances = locationBalances(codex, needs);

  appendMethod(append);
  appendConsumption(append, codex, characters);
  // 供給表は島全体の文脈で出す。罠の重みは土地が入れるので、土地を決めないと候補が全部0になる。
  appendSupply(append, codex, balances[0].steps);
  appendChains(append, codex, balances, needs);
  appendDevices(append, codex, balances);

  return lines.join('\n') + '\n';
}

function appendMethod(append: (line?: string) => void): void {
  append('## 計測方法');
  append();
  append(`- 1 tick = ${MINUTES_PER_TICK}分、1日 = ${TICKS_PER_DAY} tick = ${MINUTES_PER_DAY}分。`);
  append('- `pick` の分岐は `weight` から期待値を取る。入れ子の `pick` は確率の積まで畳んである。');
  append('- **1つの工程が複数の値を返す場合、所要時間は按分せず全額を各値に計上する。** 按分には');
  append('  水と満腹の交換レートが要るが、そのレートこそこの表が見つけようとしているもの。');
  append('  代わりに「同時に返す値」の列を置いた——行を縦に足すと二重計上になる。');
  append('- **道具（消費されない入力）の入手時間は単位あたりの時間に含めない。** 繰り返し使えるものを');
  append('  1個あたりへ按分するには「何回使うか」の仮定が要り、その仮定が数字を支配するため。');
  append('  代わりに「前提」列へ、1度だけ払う入手時間として別に並べる。');
  append('- 連鎖の起点は探索。土地ごとに得られる物が違うので、連鎖表は土地ごとに出す。');
  append(`  ただし資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の`);
  append(`  **${WHOLE_ISLAND}**を先頭に置く——各資源を最も得やすい土地で得て、移動時間は数えない場合。`);
  append();
  append('### 待って得る生産の数え方');
  append();
  append('罠のように、仕掛けてから時間が経つと産物が返るものは、**待っている間に他のことができる**。');
  append('そこで工程の時間を2本に分けて数える。');
  append();
  append('- **労働時間**: プレイヤーが払う分。他の行動と直接競合するのはこれだけで、');
  append('  上の各表の「分」はすべてこちら。');
  append('- **周期**: 経過するだけの分。単位あたりの時間には**足さない**。');
  append();
  append('では待ち時間が無コストかというと、そうではない。**設備は待っている間も朽ちる**ので、');
  append('1周期で使い切る設備の割合（周期 ÷ 寿命）が、そのまま製作労働の按分になる——罠1回の判定は');
  append('「罠を作る労働の、周期÷寿命ぶん」を払っている。連鎖表の数字はこの按分を含む。');
  append();
  append('この数え方が成り立つのは**並列度に上限があるとき**だけ。いくらでも並べられて朽ちもしない');
  append('設備は、待つだけで無限に得られることになるので按分できず、連鎖表から外して4節へ回す。');
  append();
  append('### この表が数えていないもの');
  append();
  append('- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。');
  append('  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。');
  append('- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは');
  append('  宣言値だけなので、罠のレートは**餌なし**の値。');
  append('- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。');
  append('  そのため水を汲む経路は所要時間0分の工程として出る（下表で † を付けた行）。');
  append('- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。');
  append('- **獲物が死体に変わるまで。** 罠に掛かった獲物を殺すのは、刺さった傷が**親へ**与える出血');
  append('  （`snare_laceration` の `add: {parent: {blood: -15}}`）で、しかも傷の `bleeding` が尽きる');
  append('  数tickだけ効く。「傷の勢い×効いている長さ」と「獲物の血の量」の勝負なので、tick毎の');
  append('  増減を1つ足すだけでは決まらない。そのため4節の産物（獲物）は3節の連鎖へ繋がっておらず、');
  append('  連鎖表の「設備数」列は今のところ全て空になる。');
  append();
}

function appendConsumption(
  append: (line?: string) => void,
  codex: WorldCodex,
  characters: readonly ObjectDef[],
): void {
  append('## 1. 消費表（1日あたり何が要るか）');
  append();
  append('キャラクタが自分のプロパティをtick毎にどれだけ動かすか（`passives` の `add` と `transfer`）。');
  append('括弧内は1日ぶん（×96）。個体差はそのまま列に出る。');
  append();

  const byCharacter = characters.map((def) => tickDeltasOf(codex, def));
  const keys: string[] = [];
  for (const deltas of byCharacter) for (const key of deltas.keys()) if (!keys.includes(key)) keys.push(key);

  append(`| プロパティ | 条件 | ${characters.map((def) => def.name).join(' | ')} |`);
  append(`| --- | --- | ${characters.map(() => '---').join(' | ')} |`);
  for (const key of keys) {
    const [propertyName, condition] = key.split(KEY_SEPARATOR);
    const cells = byCharacter.map((deltas) => {
      const amount = deltas.get(key);
      if (amount === undefined) return '—';
      return `${formatNumber(amount, 2)}（${formatNumber(amount * TICKS_PER_DAY, 0)}）`;
    });
    append(`| ${propertyName} | ${condition} | ${cells.join(' | ')} |`);
  }
  append();
}

function appendSupply(append: (line?: string) => void, codex: WorldCodex, steps: readonly StepRef[]): void {
  append('## 2. 供給表（1工程あたり）');
  append();
  append('何かを生むか、値を動かす工程すべて。産出は1回の実行あたりの期待個数。');
  append(
    '「値の増減」はキャラクタ（actor）が受け取る分で、括弧に（self）と書いたものは工程の主が受け取る分。',
  );
  append();
  append('`?` は、所要時間か分岐の重みが**定義だけでは決まらない**工程（相手の持ち物を見る');
  append('`{subject: dragged, prop: ...}` 参照など）。解けない重みは0として扱うので、その行の期待値は');
  append('残った候補へ寄っている——例えば `strike` の当たり方は武器が決めるため、ここでは出せない。');
  append();
  append('種別 `periodic` は時間で回る工程（罠の判定）。労働は0で、周期だけが経過する。');
  append('`transfer` の増減は宣言された上限で、実際に動く量は在庫と空きで目減りする。');
  append();
  append('| 宣言元 | 工程 | 種別 | 労働（分） | 周期（分） | 期待産出 | 値の増減 |');
  append('| --- | --- | --- | --- | --- | --- | --- |');

  for (const ref of steps) {
    const spawns = expectedSpawns(ref.step);
    const actorDeltas = expectedDeltas(ref.step, 'actor');
    const selfDeltas = expectedDeltas(ref.step, 'self');
    if (spawns.size === 0 && actorDeltas.size === 0 && selfDeltas.size === 0) continue;

    const spawnText = [...spawns]
      .map(([objectGlobalId, count]) => `${codex.objectName(objectGlobalId)} ×${formatNumber(count, 2)}`)
      .join('、');
    const deltaText = [
      ...[...actorDeltas].map(
        ([propertyGlobalId, amount]) => `${codex.propertyName(propertyGlobalId)} ${signed(amount)}`,
      ),
      ...[...selfDeltas].map(
        ([propertyGlobalId, amount]) => `（self）${codex.propertyName(propertyGlobalId)} ${signed(amount)}`,
      ),
    ].join('、');

    append(
      `| ${ref.def.name} | ${ref.step.name} | ${ref.step.kind} |` +
        ` ${formatNumber(ref.step.laborMinutes, 0)}${ref.step.hasUnresolvedReferences ? ' ?' : ''} |` +
        ` ${formatNumber(ref.step.elapsedMinutes, 0)} | ${spawnText || '—'} | ${deltaText || '—'} |`,
    );
  }
  append();
}

/** 土地1つぶんの計算結果。連鎖表と待ち生産表が同じものを見る。 */
interface LocationBalance {
  readonly name: string;
  readonly acquisition: Acquisition;
  readonly steps: readonly StepRef[];
  readonly rows: readonly (readonly [number, readonly ChainRow[]])[];
}

/**
 * 資源は土地ごとに分かれているので、1つの土地に閉じると多くの連鎖が「前提が揃わない」で終わる。
 * 島を渡り歩ける前提の見方も要るため、全土地の探索を使える文脈を先頭に1つ置く。
 */
const WHOLE_ISLAND = '島全体';

function locationBalances(codex: WorldCodex, needs: ReadonlyMap<number, number>): readonly LocationBalance[] {
  const locations = allDefs(codex).filter((def) => isLocation(codex, def));

  const balances: LocationBalance[] = [];
  for (const location of [undefined, ...locations]) {
    // 罠が掛ける動物の重みは土地が宣言する（inherit）ので、土地を決めてから工程を組み立てる。
    // 島全体では、その値を最も高く宣言している土地に置く前提を取る。
    const context = location === undefined ? bestAncestorContext(locations) : ancestorContext(location);
    const steps =
      location === undefined ? allSteps(codex, context) : stepsAt(codex, allSteps(codex, context), location);
    const acquisition = new Acquisition(codex, steps);
    balances.push({
      name: location?.name ?? WHOLE_ISLAND,
      acquisition,
      steps,
      rows: chainRows(codex, acquisition, steps, needs),
    });
  }
  return balances;
}

/** どの土地に置いてもよい前提での祖先の値。最も高く宣言している土地に置いたものとして扱う。 */
function bestAncestorContext(locations: readonly ObjectDef[]): StaticValueResolver {
  return (root, propertyGlobalId) => {
    if (root !== 'ancestor') return undefined;
    const declared = locations
      .map((location) => location.staticValueOf(propertyGlobalId))
      .filter((value): value is number => value !== undefined);
    return declared.length === 0 ? 0 : Math.max(...declared);
  };
}

function appendChains(
  append: (line?: string) => void,
  codex: WorldCodex,
  balances: readonly LocationBalance[],
  needs: ReadonlyMap<number, number>,
): void {
  append('## 3. 連鎖表（素材から摂取までの総時間）');
  append();
  append(
    `1日ぶんの必要量は ${SAMPLE_CHARACTER} のもの（消費表の常時効く減りから）。時間はすべて労働時間で、`,
  );
  append('待ち時間は含まない（待ち生産の設備は、周期÷寿命ぶんの製作労働として計上する）。');
  append('「1日の割合」は、1日ぶんを賄うのに要る労働が1日（1440分）に占める割合。');
  append('「設備数」は、待ち生産の経路で1日ぶんを賄うのに同時に要る設備の数（4節参照）。');
  append('† は、素材を所要時間0分の工程で得ている経路（この表が時間を数えられていない、上の注記を参照）。');
  append('前提の道具がその土地で手に入らない経路は、数字を出したうえで表の末尾へ回す。');
  append();

  for (const { name, rows } of balances) {
    if (rows.length === 0) continue;

    append(`### ${name}`);
    append();

    for (const [propertyGlobalId, propertyRows] of rows) {
      const need = needs.get(propertyGlobalId) ?? 0;
      append(`#### ${codex.propertyName(propertyGlobalId)}（1日 ${formatNumber(need, 0)}）`);
      append();
      append(
        '| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |',
      );
      append('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const row of propertyRows) {
        append(
          `| ${row.route} | ${formatNumber(row.perUnit, 2)}${row.untimed ? ' †' : ''} |` +
            ` ${formatNumber(row.exploreMinutes, 2)} | ${formatNumber(row.craftMinutes, 2)} |` +
            ` ${formatNumber(row.perUnit * need, 0)} |` +
            ` ${formatNumber((row.perUnit * need * 100) / MINUTES_PER_DAY, 1)}% |` +
            ` ${row.deviceCount === undefined ? '—' : formatNumber(row.deviceCount, 1)} |` +
            ` ${row.coProducts || '—'} | ${row.prerequisites || '—'} |`,
        );
      }
      append();
    }
  }
}

function appendDevices(
  append: (line?: string) => void,
  codex: WorldCodex,
  balances: readonly LocationBalance[],
): void {
  append('## 4. 待ち生産表（設備が時間をかけて返す分）');
  append();
  append('仕掛けてから時間が経つと産物が返るもの。**周期は単位あたりの労働時間には足していない**');
  append('（計測方法の「待って得る生産の数え方」参照）ので、この表が代わりに周期とレートを出す。');
  append();
  append('- **設備あたり（個/日）**: 1日は24時間まるごと回る。眠っている間も進むのが待ち生産の取り柄。');
  append('- **寿命の間に（個）**: 設備1つが朽ちるまでに返す総数。これが並列度の上限を決める。');
  append('- **労働（分/個）**: 製作労働 ÷ 寿命の間に返す数。連鎖表に載るのはこの値。');
  append();

  for (const { name, acquisition, steps } of balances) {
    const devices = steps.filter((ref) => ref.cycle !== undefined && ref.step.outputs.length > 0);
    if (devices.length === 0) continue;

    append(`### ${name}`);
    append();
    append(
      '| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |',
    );
    append('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');

    for (const ref of devices) {
      const cycle = ref.cycle!;
      const deviceCost = acquisition.costByObject.get(ref.def.globalId);
      const lifetimeDays =
        cycle.lifetimeMinutes === undefined ? undefined : cycle.lifetimeMinutes / MINUTES_PER_DAY;
      const cyclesPerDay = MINUTES_PER_DAY / cycle.periodMinutes;

      for (const [objectGlobalId, perCycle] of expectedSpawns(ref.step)) {
        // 単独で存在できない型（怪我、7.9節）は産物ではない——獲物に刺さる傷は資源に数えない。
        if (perCycle <= 0 || codex.objects.get(objectGlobalId).boundToOwner) continue;
        const overLifetime = lifetimeDays === undefined ? undefined : perCycle * cyclesPerDay * lifetimeDays;
        const laborPerUnit =
          deviceCost === undefined || overLifetime === undefined
            ? undefined
            : totalOf(deviceCost) / overLifetime;

        append(
          `| ${ref.def.name} | ${ref.step.name} | ${formatNumber(cycle.periodMinutes, 0)} |` +
            ` ${codex.objectName(objectGlobalId)} ×${formatNumber(perCycle, 3)} |` +
            ` ${formatNumber(perCycle * cyclesPerDay, 2)} |` +
            ` ${lifetimeDays === undefined ? '—（朽ちない）' : formatNumber(lifetimeDays, 1)} |` +
            ` ${overLifetime === undefined ? '—' : formatNumber(overLifetime, 1)} |` +
            ` ${deviceCost === undefined ? '入手経路なし' : formatNumber(totalOf(deviceCost))} |` +
            ` ${laborPerUnit === undefined ? '—' : formatNumber(laborPerUnit, 2)} |`,
        );
      }
    }
    append();
  }
}

interface ChainRow {
  readonly route: string;
  readonly perUnit: number;
  readonly exploreMinutes: number;
  readonly craftMinutes: number;
  readonly coProducts: string;
  readonly prerequisites: string;

  /** この土地では前提の道具が手に入らない経路か。表の末尾へ回す。 */
  readonly blocked: boolean;

  /** 途中に所要時間0分の工程を含む経路か（時間を数えられていない、†）。 */
  readonly untimed: boolean;

  /**
   * 待ち生産を含む経路で、1日ぶんを賄うのに同時に要る設備の数。含まないならundefined。
   *
   * 1日ぶんに要る労働を、設備1つを寿命の間に作り直し続ける労働（＝製作労働 ÷ 寿命の日数）で
   * 割ったもの。**待ち時間が労働へ跳ね返る場所がここ**で、周期が長いほど設備数が要る。
   */
  readonly deviceCount: number | undefined;
}

/**
 * 必要量のあるプロパティごとに、それを返す工程を総時間の昇順で並べる。**最良経路だけには絞らない**
 * ——順位が入れ替わったときに差分が「1行まるごと差し替え」になり、何が起きたか読めなくなるため。
 */
function chainRows(
  codex: WorldCodex,
  acquisition: Acquisition,
  steps: readonly StepRef[],
  needs: ReadonlyMap<number, number>,
): readonly (readonly [number, readonly ChainRow[]])[] {
  const byProperty = new Map<number, ChainRow[]>();

  for (const ref of steps) {
    const cost = acquisition.stepCost(ref);
    if (cost === undefined) continue;

    const deltas = expectedDeltas(ref.step, 'actor');
    for (const [propertyGlobalId, gain] of deltas) {
      if (gain <= 0 || !needs.has(propertyGlobalId)) continue;

      const route = [ref, ...acquisition.routeOf(ref.def.globalId)];
      const rows = byProperty.get(propertyGlobalId) ?? [];
      rows.push(
        buildRow(
          codex,
          acquisition,
          route,
          cost,
          gain,
          deltas,
          propertyGlobalId,
          needs.get(propertyGlobalId)!,
        ),
      );
      byProperty.set(propertyGlobalId, rows);
    }
  }

  // 前提が揃わない経路は末尾へ。数字は出すが、この土地では辿れない。
  for (const rows of byProperty.values())
    rows.sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.perUnit - b.perUnit);
  return [...byProperty].sort(([a], [b]) => a - b);
}

function buildRow(
  codex: WorldCodex,
  acquisition: Acquisition,
  route: readonly StepRef[],
  cost: Cost,
  gain: number,
  deltas: ReadonlyMap<number, number>,
  propertyGlobalId: number,
  dailyNeed: number,
): ChainRow {
  // 経路の中で作る物は前提に数えない（自分で用意する手順が既に経路として出ているため）。
  const madeInRoute = new Set(route.flatMap((ref) => [...expectedSpawns(ref.step).keys()]));

  const prerequisites = new Map<string, Prerequisite>();
  for (const ref of route)
    for (const prerequisite of acquisition.prerequisites(ref)) {
      if (prerequisite.objectGlobalId !== undefined && madeInRoute.has(prerequisite.objectGlobalId)) continue;
      prerequisites.set(prerequisite.label, prerequisite);
    }

  return {
    route: route
      .map((ref) => `${ref.def.name}.${ref.step.name}`)
      .reverse()
      .join(' → '),
    perUnit: totalOf(cost) / gain,
    exploreMinutes: cost.exploreMinutes / gain,
    craftMinutes: cost.craftMinutes / gain,
    coProducts: [...deltas]
      .filter(([otherId]) => otherId !== propertyGlobalId)
      .map(([otherId, amount]) => `${codex.propertyName(otherId)} ${signed(amount)}`)
      .join('、'),
    prerequisites: [...prerequisites.values()]
      .map(
        ({ label, cost: toolCost }) =>
          `${label}（${toolCost === undefined ? 'この土地では入手できない' : `${formatNumber(totalOf(toolCost))}分`}）`,
      )
      .join('、'),
    blocked: [...prerequisites.values()].some(({ cost: toolCost }) => toolCost === undefined),
    // 摂取そのもの（経路の先頭）が0分なのは仕様。素材を0分で得ている場合だけが数え落とし。
    untimed: route.slice(1).some((ref) => ref.cycle === undefined && ref.step.laborMinutes === 0),
    deviceCount: deviceCountFor(acquisition, route, (totalOf(cost) / gain) * dailyNeed),
  };
}

/**
 * 1日ぶんの労働を賄うのに同時に要る設備の数。経路に待ち生産が無ければundefined。
 *
 * 設備1つが1日に生む価値は「その設備を寿命の間ずっと作り直し続ける労働」＝製作労働÷寿命の日数に
 * 等しい（連鎖表の単位あたりの労働がこの按分で出ているため）。1日ぶんの労働をそれで割れば個数が出る。
 */
function deviceCountFor(
  acquisition: Acquisition,
  route: readonly StepRef[],
  dailyMinutes: number,
): number | undefined {
  let maintenancePerDay = 0;
  for (const ref of route) {
    if (ref.cycle?.lifetimeMinutes === undefined) continue;
    const deviceCost = acquisition.costByObject.get(ref.def.globalId);
    if (deviceCost === undefined) continue;
    maintenancePerDay += totalOf(deviceCost) / (ref.cycle.lifetimeMinutes / MINUTES_PER_DAY);
  }
  return maintenancePerDay === 0 ? undefined : dailyMinutes / maintenancePerDay;
}

function signed(amount: number): string {
  return `${amount >= 0 ? '+' : ''}${formatNumber(amount, 2)}`;
}

describe.runIf(process.env.RUN_BALANCE_STATS === '1')('アイテム収支レポート', () => {
  it('定義から収支を計算してBalanceStats.mdを再生成する', () => {
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();

    const report = buildReport(codex);
    const outPath = join('docs', 'diagnostics', 'BalanceStats.md');
    writeFileSync(outPath, report, 'utf8');
    console.log(`Report written to: ${outPath}`);

    expect(report).toContain('# アイテム収支レポート');
  }, 600_000);
});

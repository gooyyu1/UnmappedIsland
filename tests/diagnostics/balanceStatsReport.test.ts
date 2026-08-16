import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import type { CraftingStep } from '../../src/domain/defs/CraftingStep';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { TickDelta } from '../../src/domain/defs/PassiveEffect';
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

  /** この工程を1回実行するのにかかる時間（所要時間＋消費する入力の入手時間）。揃わなければundefined。 */
  stepCost(ref: StepRef): Cost | undefined {
    const owned = isLocation(this.codex, ref.def);
    let cost: Cost = {
      exploreMinutes: owned ? ref.step.durationMinutes : 0,
      craftMinutes: owned ? 0 : ref.step.durationMinutes,
    };

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

/** 全型の全工程。宣言順（型のグローバルID順、型の中は宣言順）。 */
function allSteps(codex: WorldCodex): readonly StepRef[] {
  return allDefs(codex).flatMap((def) => def.craftingSteps().map((step) => ({ def, step })));
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
  const steps = allSteps(codex);

  append('# アイテム収支レポート');
  append();
  append('`tests/diagnostics/balanceStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）');
  append('だけから計算した「時間あたりの収支」。定義の数値を変えたら以下で再生成する。');
  append();
  append('```');
  append('npm run stats:balance');
  append('```');
  append();

  appendMethod(append);
  appendConsumption(append, codex, characters);
  appendSupply(append, codex, steps);
  appendChains(append, codex, steps);

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
  append();
  append('### この表が数えていないもの');
  append();
  append('- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。');
  append('- **罠による狩り。** 獲物を返すのは操作ではなく `catch_remaining` の `on_shortfall`');
  append('  （時間で回る仕掛け）なので、所要時間を持つ工程として並べられない。');
  append('- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。');
  append('  そのため水を汲む経路は所要時間0分の工程として出る（下表で † を付けた行）。');
  append('- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。');
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
  append('所要時間の `?` は、所要時間か分岐の重みが**定義だけでは決まらない**工程（相手の持ち物を見る');
  append('`{subject: dragged, prop: ...}` 参照など）。解けない重みは0として扱うので、その行の期待値は');
  append('残った候補へ寄っている——例えば `strike` の当たり方は武器が決めるため、ここでは出せない。');
  append();
  append('| 宣言元 | 工程 | 種別 | 所要（分） | 期待産出 | 値の増減 |');
  append('| --- | --- | --- | --- | --- | --- |');

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
      `| ${ref.def.name} | ${ref.step.name} | ${ref.step.kind} | ${ref.step.durationMinutes}` +
        `${ref.step.hasUnresolvedReferences ? ' ?' : ''} | ${spawnText || '—'} | ${deltaText || '—'} |`,
    );
  }
  append();
}

function appendChains(append: (line?: string) => void, codex: WorldCodex, steps: readonly StepRef[]): void {
  append('## 3. 連鎖表（素材から摂取までの総時間）');
  append();
  append(`1日ぶんの必要量は ${SAMPLE_CHARACTER} のもの（消費表の常時効く減りから）。`);
  append('「1日の割合」は、1日ぶんを賄うのに要る時間が1日（1440分）に占める割合。');
  append('† は、素材を所要時間0分の工程で得ている経路（この表が時間を数えられていない、上の注記を参照）。');
  append('前提の道具がその土地で手に入らない経路は、数字を出したうえで表の末尾へ回す。');
  append();

  const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
  const needs = dailyNeeds(codex, character);

  for (const location of allDefs(codex)) {
    if (!isLocation(codex, location)) continue;

    const available = stepsAt(codex, steps, location);
    const acquisition = new Acquisition(codex, available);
    const rows = chainRows(codex, acquisition, available, needs);
    if (rows.length === 0) continue;

    append(`### ${location.name}`);
    append();

    for (const [propertyGlobalId, propertyRows] of rows) {
      const need = needs.get(propertyGlobalId) ?? 0;
      append(`#### ${codex.propertyName(propertyGlobalId)}（1日 ${formatNumber(need, 0)}）`);
      append();
      append('| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 同時に返す値 | 前提 |');
      append('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const row of propertyRows) {
        append(
          `| ${row.route} | ${formatNumber(row.perUnit, 2)}${row.untimed ? ' †' : ''} |` +
            ` ${formatNumber(row.exploreMinutes, 2)} | ${formatNumber(row.craftMinutes, 2)} |` +
            ` ${formatNumber(row.perUnit * need, 0)} |` +
            ` ${formatNumber((row.perUnit * need * 100) / MINUTES_PER_DAY, 1)}% |` +
            ` ${row.coProducts || '—'} | ${row.prerequisites || '—'} |`,
        );
      }
      append();
    }
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
      rows.push(buildRow(codex, acquisition, route, cost, gain, deltas, propertyGlobalId));
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
    untimed: route.slice(1).some((ref) => ref.step.durationMinutes === 0),
  };
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

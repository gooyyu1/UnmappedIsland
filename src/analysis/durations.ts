import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingStep } from './CraftingStep';
import { MINUTES_PER_DAY } from './balanceTables';
import { craftingStepsOf } from './craftingSteps';
import { rangeCyclesOf } from './rangeCycles';
import { ticksToRangeEnd } from './rangeEvents';
import { staticValueOf } from './staticValue';

/**
 * 定義全体から**日をまたぐ長さ**を集め、種類を問わず1本の列に並べる。怪我が治るまでも食べ物が
 * 腐るまでも季節が変わるまでも、「ある値が端へ届くまで」という同じ1つの形をしている
 * （{@link rangeCyclesOf}）ので、日へ揃えれば長短をそのまま比べられる。
 *
 * 答えるのは長さだけで、判定（この長さは適切か・どれとどれが逆転しているか）は持たない。
 *
 * 引く線は3つ。
 *
 * **1日に満たないものは数えない**（{@link MINIMUM_DAYS}）。乾き・飢え・調理・火の燃えは1日の中で
 * 何度も回るもので、日で読む長さとは尺度が違う。同じ列に混ぜると、日をまたぐ長さの逆転が
 * 1日未満の行に埋もれる。
 *
 * **隣の物に押されて初めて進むものは数えない。** 炉が焼く・刺さった傷が血を奪うといった増減は、
 * 置いておくだけでは起こらない（{@link rangeCyclesOf} の`external`を渡さないことがそのまま線に
 * なる）。これを寿命と呼ぶと、火にかけていない肉まで勝手に焼け落ちることになる。
 *
 * **時間では減らず、使うたびに減る値は日で数えない**（{@link toolWearsOf}）。斧が何日で壊れるかは
 * 振り続けた場合の労働時間でしかなく、肉が腐るまでの10日と同じ軸には置けない。
 */

/** 日の列に載る下限。これに満たない長さは1日の中で回るものとして落とす。 */
export const MINIMUM_DAYS = 1;

/** 日をまたぐ長さ1件。 */
export interface Duration {
  readonly objectName: string;
  readonly propertyName: string;

  /**
   * 端へ届くまでの日数。**同時に成立しうる条件（8.2節）の組み合わせのうち、最も遅いもの**の値
   * ——生肉は置いておくだけなら10日もつが、暑さのような上乗せが重なればもっと早く傷む。
   * 生成時のロール（6.2節）は短いほうに出た場合で見る。
   */
  readonly days: number;

  /** 同じ組み合わせのうち、最も速いものの日数。組み合わせが1通りなら{@link days}と等しい。 */
  readonly shortestDays: number;

  /**
   * **生成時のロール（6.2節）が長いほうに出た場合**の日数。ロールを持たない物では{@link days}と
   * 等しい。骨折は折れ方を1回ロールするので、10.5日と14日の両端を持つ。
   *
   * 条件つきの幅（{@link days}〜{@link shortestDays}）とは**別の軸**。1つの幅へ畳むと、条件が
   * 重なったのか重く出たのかが読めなくなる。
   */
  readonly longestDays: number;

  /** 端で値が戻って繰り返すか（季節の交代・畑の実り）。偽なら一度きりの長さ。 */
  readonly repeats: boolean;

  /** 端でその物自体が消えるか（怪我が治る・食べ物が腐り落ちる）。 */
  readonly destroysSelf: boolean;
}

/**
 * 使ってはじめて減る値が尽きるまで1件。減るのは工程1回につき一定量なので、長さは**回数**で出る
 * ——時間へ直すには「他に何もせず使い続ける」と置くほかなく、それは経過時間ではなく労働時間になる。
 */
export interface ToolWear {
  /** 減る側の型。その工程が消費せずに要求する物＝道具。 */
  readonly objectName: string;
  readonly propertyName: string;

  /** その道具を減らす工程と、それを宣言している型。同じ道具でも使い方ごとに減り方が違う。 */
  readonly stepName: string;
  readonly stepOwnerName: string;

  /** 尽きるまでの回数。 */
  readonly uses: number;

  /** 1回にプレイヤーが払う時間（分）。 */
  readonly laborMinutes: number;
}

/** 日をまたぐ長さを長い順に並べたもの（{@link Duration}）。同じ長さは型・プロパティの名前順。 */
export function durationsOf(codex: WorldCodex): readonly Duration[] {
  const found: Duration[] = [];
  for (const def of codex.objects)
    for (const cycle of rangeCyclesOf(def)) {
      const days = cycle.minutes / MINUTES_PER_DAY;
      if (days < MINIMUM_DAYS) continue;

      found.push({
        objectName: def.name,
        propertyName: codex.propertyNames.getName(cycle.propertyGlobalId),
        days,
        shortestDays: cycle.shortestMinutes / MINUTES_PER_DAY,
        longestDays: cycle.longestMinutes / MINUTES_PER_DAY,
        repeats: cycle.repeats,
        destroysSelf: cycle.destroysSelf,
      });
    }

  return found.sort(
    (a, b) =>
      b.days - a.days ||
      a.objectName.localeCompare(b.objectName) ||
      a.propertyName.localeCompare(b.propertyName),
  );
}

/**
 * 使ってはじめて減る値が尽きるまで（{@link ToolWear}）。長く保つ使い方から順に並べる。
 *
 * 拾うのは、**工程が自分以外の物の値を減らし、その物をその工程が消費しない**場合。消費しないから
 * 道具で、自分以外だから借り物——斧を木へ、槍を獲物へ持って行くときの減りがこれにあたる。
 * 時間でも減る値（罠が地面で朽ちる耐久）は日の列（{@link durationsOf}）が持つので、ここでは飛ばす。
 */
export function toolWearsOf(codex: WorldCodex): readonly ToolWear[] {
  const found: ToolWear[] = [];
  for (const owner of codex.objects)
    for (const step of craftingStepsOf(codex, owner)) found.push(...toolWearsIn(codex, step));

  return found.sort(
    (a, b) =>
      b.uses * b.laborMinutes - a.uses * a.laborMinutes ||
      a.objectName.localeCompare(b.objectName) ||
      a.stepName.localeCompare(b.stepName) ||
      a.stepOwnerName.localeCompare(b.stepOwnerName),
  );
}

/** その工程1回が、持ち込んだ道具から削る量（{@link toolWearsOf}）。 */
function toolWearsIn(codex: WorldCodex, step: CraftingStep): readonly ToolWear[] {
  const found: ToolWear[] = [];
  for (const [propertyGlobalId, perUse] of outwardDeltasOf(step))
    for (const tool of toolsIn(codex, step)) {
      const propertyDef = tool.tryGetPropertyDef(propertyGlobalId);
      if (propertyDef === undefined) continue;

      // 時間でも減るなら、その物の寿命は使い方に依らない——日の列が答える。
      if (rangeCyclesOf(tool).some((cycle) => cycle.propertyGlobalId === propertyGlobalId)) continue;

      // 端までの距離を1回あたりの減りで割るのは、tick毎の増減で割るのと同じ計算。
      const uses = ticksToRangeEnd(propertyDef, staticValueOf(tool, propertyGlobalId, 'lowest'), perUse);
      if (uses === undefined) continue;

      found.push({
        objectName: tool.name,
        propertyName: codex.propertyNames.getName(propertyGlobalId),
        stepName: step.name,
        stepOwnerName: codex.objects.get(step.ownerGlobalId).name,
        uses,
        laborMinutes: step.laborMinutes,
      });
    }
  return found;
}

/**
 * その工程が1回で、**自分以外の物**から減らす値と量（分岐をまたいだ期待値）。増える値は返さない。
 *
 * 自分の値（`self`）を除くのは、それが工程の主のものだから——主は借りてこられる道具ではなく、
 * 工程が起こる場所そのもの（木を伐る工程にとっての木）。
 */
function outwardDeltasOf(step: CraftingStep): ReadonlyMap<number, number> {
  const byProperty = new Map<number, number>();
  for (const outcome of step.outcomes)
    for (const delta of outcome.deltas) {
      if (delta.target === 'self') continue;
      byProperty.set(
        delta.propertyGlobalId,
        (byProperty.get(delta.propertyGlobalId) ?? 0) + outcome.probability * delta.amount,
      );
    }

  return new Map([...byProperty].filter(([, amount]) => amount < 0));
}

/** その工程が消費せずに要求する型＝道具。タグで指した入力は、そのタグを名乗る型すべてに開く。 */
function toolsIn(codex: WorldCodex, step: CraftingStep): readonly ObjectDef[] {
  const found: ObjectDef[] = [];
  for (const input of step.inputs) {
    if (input.consumed) continue;
    if (input.kind === 'object') {
      if (input.objectGlobalId !== step.ownerGlobalId) found.push(codex.objects.get(input.objectGlobalId));
      continue;
    }
    for (const def of codex.objects) if (def.hasTag(input.tagGlobalId)) found.push(def);
  }
  return found;
}

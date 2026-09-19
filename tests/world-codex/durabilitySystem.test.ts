import { beforeAll, describe, expect, it } from 'vitest';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { toolWearsOf } from '../../src/analysis/durations';
import { staticValueOf } from '../../src/analysis/staticValue';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { instrumentDurabilityLineOf, stepStandsAt } from '../support/durabilityLines';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * `docs/engine/DurabilitySystem.md` が置いている耐久の規約を、同梱の定義全体に当てる。
 *
 * 1節（上限960）も2.1節（余力を見る線の引き方）も、**物ごとの宣言が守って初めて本当になる**決めごと
 * で、破っても個別の試験は緑のまま通る——落とし穴が2,880を名乗ったまま気付かれなかったのが
 * issue #2164。ここは型を1つも名指しせず、`durability` を持つもの・道具として減るものを全部
 * 引いて当てるので、**新しく足した物も同じ線で見張られる。**
 */
describe('耐久の規約（同梱の定義すべて）', () => {
  /** 1節のスケール。寿命は上限ではなくレートが作る。 */
  const SCALE = 960;

  let codex: WorldCodex;
  let durabilityId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    durabilityId = codex.propertyNames.getId('durability');
  });

  it('durabilityの上限は、素材・アイテムの種類によらず960', () => {
    // 1節。長持ちを上限で作ると、同じレートが物ごとに違う日数を意味することになり、
    // 「tickあたりの減少量 = 10 ÷ 寿命の日数」が読めなくなる。
    //
    // **`range` を書いていない宣言も落とす。** 上限が無いのは「上限が960でない」なので、`undefined`
    // を黙って外すと、`durability` を持ちながら規約の外に居る型が増えても緑のままになる。
    const offenders = [...codex.objects]
      .map((def) => ({ name: def.name, durability: def.tryGetPropertyDef(durabilityId) }))
      .filter((row) => row.durability !== undefined)
      .map((row) => ({ name: row.name, max: row.durability?.range?.max }))
      .filter((row) => row.max !== SCALE);

    expect(offenders, `上限が${SCALE}でない宣言が在る`).toEqual([]);
  });

  it('道具のいちばん安い使い道には線が無く、それより高い工程には食う量ちょうどの線が在る', () => {
    // 2.1節。線が守るのは工程の成果ではなく、その道具に残っていた安い使い道なので、いちばん安い
    // 使い道に引くと「何にも使えないのに消えもしない札」が残る。
    //
    // **食う量は宣言から読む**（timberYaml.test.tsと同じ理由）。直値で書くと線の側しか見ないことに
    // なり、`add` を動かしても緑のままになる。
    //
    // **何も返さない手を挟んだ先の手は、線が無くてよい**（下の「払ったぶんが取り残される値」）。
    const lines = wearLines();
    expect(lines.length, '道具として減る宣言が1つも拾えていない').toBeGreaterThan(0);

    const cheapest = new Map<string, number>();
    for (const line of lines)
      cheapest.set(line.toolName, Math.min(cheapest.get(line.toolName) ?? Infinity, line.cost));

    expect(lines.map(describeLine)).toEqual(
      lines.map((line) => {
        if (line.cost === cheapest.get(line.toolName)) return describeLine({ ...line, threshold: undefined });
        // **無いことを許すだけで、無いことは求めない**——払ったぶんが取り残されない書き方（流木の
        // 玉切りのように手ごとに物が返る形）なら、続きの手にも線を引ける。
        if (line.threshold === undefined && !standsBeforeAnyBarrenHand(line.ownerName, line.stepName))
          return describeLine(line);
        return describeLine({ ...line, threshold: line.cost });
      }),
    );
  });

  it('何も返さない手を挟んだ先では、余力の線が断る側へ回らない', () => {
    // DurabilitySystem.md 2.1節。余力は待つ間も減る（`weathering.yaml`）ので、線が言えるのは
    // 「今この手を始められるか」までで、**後の手が成り立つことは約束できない**。1つの仕事が何回かの
    // 手に分かれ、途中の手が進みだけを進めて何も返さないとき（ActionSystem.md 6.3節）、その先で線が
    // 断る側へ回ると、そこまでに払った時間が相手に取り残される——issue #2304 は、ちょうど1本ぶんの
    // 余力で刻み始めた斧が2回目の一撃で断られ、受け口だけの幹が残った形。
    //
    // **型を1つも名指ししない**ので、別の物に同じ形を足せばここで落ちる。**線をどう書いたかも見ない**
    // ——進みの値ごとに「余力が届いていなければ断るか」を引き比べる（stepStandsAt）ので、`any` で
    // 包んでも、条件を分けても、断る側へ回れば挙がる。
    const offenders: string[] = [];
    for (const def of codex.objects) {
      const spans = barrenProgressOf(def);
      if (spans.size === 0) continue;
      for (const stepName of new Set(def.triggers.map((trigger) => trigger.interaction.name)))
        for (const [propertyGlobalId, span] of spans)
          for (const value of span.progressed) {
            const progress = new Map([[propertyGlobalId, value]]);
            if (
              stepStandsAt(codex, def.name, stepName, progress, true) &&
              !stepStandsAt(codex, def.name, stepName, progress, false)
            )
              offenders.push(
                `${def.name}.${stepName}（${codex.propertyNames.getName(propertyGlobalId)}=${value}）`,
              );
          }
    }

    expect(offenders, '払ったぶんが取り残される値で、余力が断っている').toEqual([]);
  });

  /**
   * その手が、**何も返さない手が動かす前の相手**に立つか。何も返さない手を持たない相手では常に真
   * ——取り残されるものが無いので、どの手にも線を引ける。
   */
  function standsBeforeAnyBarrenHand(ownerName: string, stepName: string): boolean {
    const def = codex.objects.get(codex.objectNames.getId(ownerName));
    const untouched = new Map(
      [...barrenProgressOf(def)].map(([propertyGlobalId, span]) => [propertyGlobalId, span.initial]),
    );
    return stepStandsAt(codex, ownerName, stepName, untouched, true);
  }

  /**
   * **何も返さない手が動かす値**（進み）と、それが取りうる値。
   *
   * 繋がりを進みのプロパティで見るのは、**どの手が同じ仕事なのかを宣言が名乗らない**ため——排他の
   * 条件が見ている値だけが、手どうしを1つの仕事へ繋いでいる（`timber.yaml` の `trunk_integrity`、
   * `animals.yaml` の `butchering_progress`）。**初期値そのものは挙げない**——そこはまだ誰も何も
   * 払っていない、線を引いてよい側。
   */
  function barrenProgressOf(def: ObjectDef): ReadonlyMap<PropertyGlobalId, ProgressSpan> {
    const moved = new Set<PropertyGlobalId>();
    for (const step of craftingStepsOf(codex, def)) {
      if (step.outputs.length > 0) continue;
      for (const outcome of step.outcomes)
        for (const delta of outcome.deltas) if (delta.target === 'self') moved.add(delta.propertyGlobalId);
    }

    const spans = new Map<PropertyGlobalId, ProgressSpan>();
    for (const propertyGlobalId of moved) {
      const range = def.tryGetPropertyDef(propertyGlobalId)?.range;
      const initial = staticValueOf(def, propertyGlobalId, 'lowest');
      if (range === undefined || initial === undefined) continue;
      const progressed: number[] = [];
      for (let value = range.min; value <= range.max; value += 1)
        if (value !== initial) progressed.push(value);
      spans.set(propertyGlobalId, { initial, progressed });
    }
    return spans;
  }

  /** 進みが取りうる値。progressedは**初期値を除いた並び**——誰かが手を付けた後の状態。 */
  interface ProgressSpan {
    readonly initial: number;
    readonly progressed: readonly number[];
  }

  it('刃を食う手は、どれも物を返す', () => {
    // DurabilitySystem.md 2.1節。**進みや腕しか返さない手は刃を食わない**——1つの仕事が何回かの手に分かれたとき
    // （ActionSystem.md 6.3節）、途中の手にも刃を食わせると、返るものが無いまま道具だけが折れる
    // 形ができる。**型を1つも名指ししない**ので、別の物に同じ形を足せばここで落ちる。
    const barren: string[] = [];
    for (const wear of toolWearsOf(codex)) {
      if (wear.propertyName !== 'durability') continue;
      const owner = codex.objects.get(codex.objectNames.getId(wear.stepOwnerName));
      const step = craftingStepsOf(codex, owner).find((candidate) => candidate.name === wear.stepName);
      if (step === undefined || step.outputs.length === 0)
        barren.push(`${wear.stepOwnerName}.${wear.stepName} が ${wear.objectName} を削る`);
    }

    expect(barren, '物を返さないのに刃を食う手').toEqual([]);
  });

  /** その道具の使い道1つ。costはその工程1回が削る量、thresholdは引かれている線（無ければundefined）。 */
  interface WearLine {
    readonly toolName: string;
    readonly stepName: string;
    readonly ownerName: string;
    readonly cost: number;
    readonly threshold: number | undefined;
  }

  /** ずれた行がどの宣言のものか名前で引けるように、1行を文へ均す。 */
  function describeLine(line: WearLine): string {
    const drawn = line.threshold === undefined ? '線なし' : `gte: ${line.threshold}`;
    return `${line.toolName} を ${line.ownerName}.${line.stepName} で使う（${line.cost}）: ${drawn}`;
  }

  /** 同梱の定義が持つ「使うたびに減る」宣言すべてに、その工程が引いている線を添えたもの。 */
  function wearLines(): readonly WearLine[] {
    return toolWearsOf(codex)
      .filter((wear) => wear.propertyName === 'durability')
      .map((wear) => ({
        toolName: wear.objectName,
        stepName: wear.stepName,
        ownerName: wear.stepOwnerName,
        cost: startingDurabilityOf(wear.objectName) / wear.uses,
        threshold: instrumentDurabilityLineOf(codex, wear.stepOwnerName, wear.stepName),
      }));
  }

  /**
   * `toolWearsOf` が回数を数え始めた値（その道具が宣言している初期値）。
   *
   * **上限（960）ではなくこちらを割る。** 回数は初期値から数えてある（`toolWearsOf`）ので、満タンで
   * 生まれない道具が1つ入った途端、上限で割った「食う量」は実際の `add` とずれ、線との突き合わせが
   * 黙って意味を失う。
   */
  function startingDurabilityOf(toolName: string): number {
    const def = codex.objects.get(codex.objectNames.getId(toolName));
    const value = staticValueOf(def, durabilityId, 'lowest');
    expect(value, `${toolName} の durability が定義だけから読めない`).toBeDefined();
    return value!;
  }
});

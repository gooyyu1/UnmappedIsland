import { describe, expect, it } from 'vitest';
import { analysisContextOf } from '../../src/analysis/craftingSteps';
import { staticResolverOf } from '../../src/analysis/staticValue';
import { resolveDeclaredNumber } from '../../src/domain/DeclaredNumber';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { InteractionDef } from '../../src/domain/InteractionDef';
import type {
  ConditionalReading,
  DeclaredNumberReading,
  EffectReader,
  PickReading,
  TransferReading,
} from '../../src/domain/EffectReader';
import type { GateReading, PassivePropertyReading, PassiveReader } from '../../src/domain/PassiveReader';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 1回の操作・1つの工程が進めてよい時間の線を、同梱のYAMLに対して確かめる
 * （[`docs/engine/ActionSystem.md`](../../docs/engine/ActionSystem.md) 6.3節）。
 *
 * 押している間プレイヤーは何もできないので、長い行動はそのぶん盤面を取り上げる。
 * **数え上げにしない**——今長い箇所を並べる検査は、次に足された行動を素通りさせる。ここが見るのは
 * 「世界じゅうの操作」「世界じゅうのレシピの工程」「世界じゅうの枠」で、**線の外に居てよい相手も
 * 定義から引く**（{@link HandOverSeeker}）。
 */
const codex = bundledCodex();

/** 1回の操作・1つの工程が進めてよい時間の上限（分）。ActionSystem.md 6.3節。 */
const LONGEST_MINUTES = 60;

/**
 * 経過し終えてから受け取るものを、1つでも宣言しているか（`EffectReader`参照）。
 *
 * 受け取るものが在るなら、必ず**物が生まれる**（`spawn`）か**値が動く**（`add`・`set`・`transfer`・
 * `become`）。それは経過し終えた瞬間に一度だけ渡るので、1時間を超えるなら割らなければ、途中で
 * 止めた者の手には何も残らない。
 *
 * **数えない動詞がある。**
 *
 * - `move`——居場所が変わるだけ。**行った先そのものが結果で、途中の地点は世界に無い**
 *   （渡っている最中の海にも、道の途中にも、立てる場所が無い）。
 * - `destroy`——世界から出て行くだけで、手には何も渡らない。受け取るものが在れば、同じ操作の中で
 *   必ず上のどれかが一緒に起きる。
 * - `signal`——世界の形が変わらない（9.8節）。
 *
 * **`passives`（経過の各tick）も数えない**——受け取る量が経過に比例するので、割っても等価になる。
 */
class HandOverSeeker implements EffectReader {
  found = false;

  set(): void {
    this.found = true;
  }

  add(): void {
    this.found = true;
  }

  spawn(): void {
    this.found = true;
  }

  become(): void {
    this.found = true;
  }

  transfer(): void {
    this.found = true;
  }

  destroy(): void {}

  move(): void {}

  signal(): void {}

  pick(reading: PickReading): void {
    reading.readEveryCandidate(this);
  }

  conditional(reading: ConditionalReading): void {
    reading.readEveryBranch(this);
  }
}

/** その操作が、経過し終えてから受け取るものを渡すか（{@link HandOverSeeker}）。 */
function handsResultAtTheEnd(interaction: InteractionDef): boolean {
  const seeker = new HandOverSeeker();
  interaction.readBy(seeker);
  return seeker.found;
}

/** その宣言が解ける分数（解けなければundefined）。ロールは長いほうの端で見る。 */
function minutesOf(def: ObjectDef, reading: DeclaredNumberReading | undefined): number | undefined {
  if (reading === undefined) return 0;
  const resolve = staticResolverOf(def, 'highest', analysisContextOf(codex, []));
  return resolveDeclaredNumber(reading, resolve);
}

/** 世界じゅうの持続効果が、そのプロパティへ積む量（押し上げる向きだけ）。 */
class UpwardPushCollector implements PassiveReader {
  readonly amounts: number[] = [];

  constructor(private readonly propertyGlobalId: PropertyGlobalId) {}

  modify(reading: PassivePropertyReading): void {
    this.take(reading);
  }

  accumulate(reading: PassivePropertyReading): void {
    this.take(reading);
  }

  transfer(_reading: TransferReading, _gate: GateReading): void {}

  private take(reading: PassivePropertyReading): void {
    if (reading.propertyGlobalId !== this.propertyGlobalId) return;
    // 導出される量（中身の重さの伝播）は所要時間へは行かないので、定数の宣言だけを見る。
    if (reading.amount.kind === 'fixed' && reading.amount.value > 0) this.amounts.push(reading.amount.value);
  }
}

/**
 * その所要時間が届きうる最大の分数。**役では絞らない**——どの役へ積んでも、行き着く先が所要時間なら
 * 分数が動く（腕は`self`へ、海区は航路の`parent`へ積む）。
 *
 * `range`の上端が在ればそこで止まるので、そちらを採る。
 */
function longestMinutesOf(def: ObjectDef, propertyGlobalId: PropertyGlobalId, declared: number): number {
  const collector = new UpwardPushCollector(propertyGlobalId);
  for (const owner of codex.objects) owner.passives.readBy(collector);
  const pushed = collector.amounts.reduce((total, amount) => total + amount, declared);

  const max = def.tryGetPropertyDef(propertyGlobalId)?.range?.max;
  return max === undefined ? pushed : Math.min(pushed, max);
}

describe('1回の行動は1時間を超えない', () => {
  it('経過し終えてから結果を渡す操作が、1時間を超えない', () => {
    // **全型を総なめする**ので、操作を足した人はそのままここへ掛かる。生成された変種も同じ操作を
    // 持つので、素の型で直せば変種も通る。
    const tooLong: string[] = [];
    let checked = 0;
    for (const def of codex.objects)
      for (const trigger of def.triggers) {
        const interaction = trigger.interaction;
        if (!handsResultAtTheEnd(interaction)) continue;
        checked += 1;

        const minutes = minutesOf(def, interaction.durationReading);
        if (minutes === undefined) {
          tooLong.push(`${def.name} の ${interaction.name}: 所要時間が定義から解けない`);
          continue;
        }
        if (minutes > LONGEST_MINUTES) tooLong.push(`${def.name} の ${interaction.name}: ${minutes}分`);
      }
    expect(checked, '経過し終えてから結果を渡す操作が1つも無い').toBeGreaterThan(0);

    expect(tooLong, '1時間を超えて時間を進める操作').toEqual([]);
  });

  it('その所要時間は、何にも1時間より上へ押し上げられない', () => {
    // 一つ上は宣言された分数を見るので、**そこへ積まれた先までは出ない**。所要時間を押し上げる宣言は
    // 世界じゅうに散っている（腕・荷・風）ので、行き着く先が線を越えないことを別に確かめる。
    const tooLong: string[] = [];
    for (const def of codex.objects)
      for (const trigger of def.triggers) {
        const reading = trigger.interaction.durationReading;
        if (!handsResultAtTheEnd(trigger.interaction) || reading?.kind !== 'property') continue;

        const propertyDef = def.tryGetPropertyDef(reading.propertyGlobalId);
        // 土台（`base`）を継ぐ所要時間は、継ぐ相手の分だけ伸びる先が定義から出ない。
        if (propertyDef?.base !== undefined) {
          tooLong.push(`${def.name} の ${trigger.interaction.name}: 所要時間が土台を継いでいる`);
          continue;
        }

        const declared = propertyDef?.initialValueAt('highest');
        if (declared === undefined) continue;
        const longest = longestMinutesOf(def, reading.propertyGlobalId, declared);
        if (longest > LONGEST_MINUTES)
          tooLong.push(`${def.name} の ${trigger.interaction.name}: 押し上げると ${longest}分`);
      }

    expect(tooLong, '1時間より上へ押し上げられる所要時間').toEqual([]);
  });

  it('レシピの工程が1時間を超えない', () => {
    // **工程には線の外が無い。** 完成品が出るのは進捗が上限へ届いた瞬間だけなので、どの工程も
    // 「経過し終えてから結果を渡す」側に居る（RecipeSystem.md 1節）。
    const tooLong: string[] = [];
    let checked = 0;
    for (const def of codex.objects)
      for (const recipe of def.recipesProducingThis)
        for (const [index, step] of recipe.steps.entries()) {
          checked += 1;
          if (step.durationMinutes > LONGEST_MINUTES)
            tooLong.push(`${def.name}.${recipe.name} の工程${index + 1}: ${step.durationMinutes}分`);
        }
    expect(checked, 'レシピの工程が1つも無い').toBeGreaterThan(0);

    expect(tooLong, '1時間を超えて時間を進める工程').toEqual([]);
  });

  it('枠へ入れるのにかかる時間も1時間を超えない', () => {
    // 枠へ入れるのも時間を進める操作（GameElementDefinition.md 7.10節）で、**上の2つには現れない**
    // ——操作でもレシピでもないので、`triggers`からも`recipesProducingThis`からも辿れない。
    const tooLong: string[] = [];
    let checked = 0;
    for (const def of codex.objects)
      for (const slotDef of def.enumerateSlotDefs()) {
        if (!slotDef.hasPutInDuration) continue;
        checked += 1;

        const minutes = minutesOf(def, slotDef.putInDurationReading);
        if (minutes === undefined || minutes > LONGEST_MINUTES)
          tooLong.push(`${def.name} の枠 ${slotDef.name}: ${minutes ?? '定義から解けない'}分`);
      }
    expect(checked, '時間のかかる枠が1つも無い').toBeGreaterThan(0);

    expect(tooLong, '1時間を超えて時間を進める枠').toEqual([]);
  });
});

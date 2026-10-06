import type { PassivePropertyReading, PassiveReader } from '../domain/PassiveReader';
import type { TransferReading } from '../domain/EffectReader';
import type { PropertyGlobalId } from '../domain/GlobalId';
import type { WorldCodex } from '../domain/WorldCodex';
import type { SkyState } from './skyState';
import { ancestorConditionsHold } from './skyState';
import type { PropertyComparison } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';

/**
 * 持ち歩ける明かりを、宣言から読む手立て。
 *
 * **値を書き写さない**ためにある——光源が何段持ち上げるかを決めているのは `fire.yaml` の
 * `passives` の `modify` 1箇所で（`ContentSkeleton.md` 8.1.1.2節が内訳を持つ）、どこで消えるかを
 * 決めているのは `lit` を下げる passive の条件（`FireSystem.md` 8.2節）。どちらを動かしても、
 * 測り直した数が一緒に動く。
 */

/** 手に持つ光源が届く先（IlluminationSystem.md 2節・3節）。手元と視界の両方へ、同じ量が届く。 */
const CARRIED_BRIGHTNESS_PROPERTIES = ['hand_brightness', 'looking_brightness'] as const;

/** 明かりが灯っているか（`fire.yaml` の `lightable`）。 */
const LIT_PROPERTY = 'lit';

/** 手に持った明かり1つ。 */
export interface CarriedLight {
  /** 灯っているあいだ、持っている人の明るさへ足す段数（EV）。 */
  readonly ev: number;

  /**
   * その空の下で灯っていられるか。**段数は灯っているあいだにしか足されない**ので、明かりを数える側は
   * 段数と必ず組で使う——段数だけを足すと、雨の屋外で消えた松明が開けた時間まで数に入る。
   */
  staysLitUnder(sky: SkyState): boolean;
}

/**
 * その型を手に持ったときの明かり。**手元と視界が違う量なら例外にする**——1つの数として扱えるのは
 * 両方へ同じだけ届くからで（IlluminationSystem.md 3節）、食い違えば「松明1本で何が開くか」を1つの数
 * では答えられない。
 */
export function carriedLightOf(codex: WorldCodex, objectName: string): CarriedLight {
  const ev = carriedLightEvOf(codex, objectName);
  const putOutBy = putOutConditionsOf(codex, objectName);
  return {
    ev,
    staysLitUnder: (sky) => !putOutBy.some((conditions) => ancestorConditionsHold(codex, conditions, sky)),
  };
}

function carriedLightEvOf(codex: WorldCodex, objectName: string): number {
  const def = codex.objects.get(codex.objectNames.getId(objectName));
  const amounts = CARRIED_BRIGHTNESS_PROPERTIES.map((propertyName) => {
    const collector = new ParentModifyCollector(codex.propertyNames.getId(propertyName));
    def.passives.readBy(collector);
    return { propertyName, amount: collector.amount };
  });

  const distinct = new Set(amounts.map(({ amount }) => amount));
  if (distinct.size !== 1)
    throw new Error(
      `${objectName} が持ち主へ届ける明るさが、手元と視界で食い違っています` +
        `（${amounts.map(({ propertyName, amount }) => `${propertyName}: ${amount}`).join('、')}）。`,
    );

  const [amount] = [...distinct];
  if (amount === 0) throw new Error(`${objectName} は持ち主の明るさを何も動かしません。`);
  return amount;
}

/**
 * その型の `lit` を下げる増減ごとの、祖先（＝置かれている場所）への条件。どれか1つが成り立てば消える。
 *
 * **祖先への比較のほかに条件を持つ増減は例外にする。** 自分の値や段で縛られた消え方は空の状態だけ
 * からは決まらないので、ここで読める形に無い。
 */
function putOutConditionsOf(
  codex: WorldCodex,
  objectName: string,
): readonly (readonly PropertyComparison[])[] {
  const def = codex.objects.get(codex.objectNames.getId(objectName));
  const litId = codex.propertyNames.getId(LIT_PROPERTY);
  return tickDeltasOf(def)
    .filter(
      (delta) =>
        delta.target === 'self' &&
        delta.propertyGlobalId === litId &&
        delta.amount < 0 &&
        delta.gate.possibleFor(def),
    )
    .map((delta) => {
      if (
        delta.gate.stage !== undefined ||
        delta.gate.selfComparisons.length > 0 ||
        delta.gate.requiredSelfStages.length > 0
      )
        throw new Error(`${objectName} の ${LIT_PROPERTY} が、置かれた場所の空以外の条件で下がります。`);
      return delta.gate.ancestorConditions;
    });
}

/** 親（＝持っている人）のそのプロパティへ効く `modify` の合計。 */
class ParentModifyCollector implements PassiveReader {
  amount = 0;

  constructor(private readonly propertyGlobalId: PropertyGlobalId) {}

  modify(reading: PassivePropertyReading): void {
    if (reading.target !== 'parent' || reading.propertyGlobalId !== this.propertyGlobalId) return;
    if (reading.amount.kind !== 'fixed') return;
    this.amount += reading.amount.value;
  }

  accumulate(): void {}

  transfer(_reading: TransferReading): void {}
}

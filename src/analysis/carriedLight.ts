import type { PassivePropertyReading, PassiveReader } from '../domain/PassiveReader';
import type { TransferReading } from '../domain/EffectReader';
import type { PropertyGlobalId } from '../domain/GlobalId';
import type { WorldCodex } from '../domain/WorldCodex';

/**
 * 持ち歩ける明かりが、持っている人の明るさへ足す段数（EV）を宣言から読む手立て。
 *
 * **値を書き写さない**ためにある——光源が何段持ち上げるかを決めているのは `fire.yaml` の
 * `passives` の `modify` 1箇所で（`ContentSkeleton.md` 8.1.1.2節が内訳を持つ）、そこを動かせば
 * 測り直した数も一緒に動く。
 */

/** 手に持つ光源が届く先（IlluminationSystem.md 2節・3節）。手元と視界の両方へ、同じ量が届く。 */
const CARRIED_BRIGHTNESS_PROPERTIES = ['hand_brightness', 'looking_brightness'] as const;

/**
 * その型を手に持っているときに足される段数。**手元と視界が違う量なら例外にする**——1つの数として
 * 扱えるのは両方へ同じだけ届くからで（同 3節）、食い違えば「松明1本で何が開くか」を1つの数では
 * 答えられない。
 */
export function carriedLightEvOf(codex: WorldCodex, objectName: string): number {
  const def = codex.objects.get(codex.objectNames.getId(objectName));
  const amounts = CARRIED_BRIGHTNESS_PROPERTIES.map((propertyName) => {
    const collector = new ParentModifyCollector(codex.propertyNames.getId(propertyName));
    def.passives.read(collector);
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

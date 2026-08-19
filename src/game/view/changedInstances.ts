import type { WorldChange } from '../../domain/WorldChange';

/**
 * 世界に起きた変化（WorldChange）を、カードの動きの言葉へ直す——どこから飛び立つか
 * （originInstances）と、どのインスタンスが世界に出入りしたか（bornInstances / vanishedInstances）。
 *
 * **世界の出入りは、画面の出入りでは代われない。** 別のレーンへ移っただけのカードも、レーンから
 * 見れば消えて現れる。壊れた・生まれたことを知っているのは変化のログだけ。
 */

/**
 * 「そのインスタンスは、どのインスタンスの札から飛び立つか」
 * （HuntingSystem.md 6.2節）。矩形に直すのは、差し替え直前の並びを読める側（PlayScene）。
 *
 * 出どころは主体——その変化を起こした効果を宣言していたオブジェクト。主体を持たない変化
 * （プレイヤーの操作が直に動かした分）は移動前の親を出どころにする。画面に出ていないスロット
 * （未発見の設置物、閉じた入れ物の中）から出てきた物が、その持ち主の札から飛ぶことになる。
 *
 * 同じインスタンスが一度の差し替えの間に何度も動いても、見せる飛びは1回なので最初の出どころを採る。
 * 世界から出た物（to === undefined）は何も現れないので持たない。
 */
export function originInstances(changes: readonly WorldChange[]): ReadonlyMap<number, number> {
  const origins = new Map<number, number>();
  for (const change of changes) {
    if (change.to === undefined) continue;

    const origin = change.subject ?? change.from?.parent;
    if (origin === undefined) continue;

    const id = change.object.instanceId;
    if (!origins.has(id)) origins.set(id, origin.instanceId);
  }
  return origins;
}

/**
 * 世界から出たインスタンス（壊れた・使い切った・食べられた）。同じ物が2度出ることはないので、
 * そのまま並べてよい。
 */
export function vanishedInstances(changes: readonly WorldChange[]): readonly number[] {
  return changes.filter((change) => change.to === undefined).map((change) => change.object.instanceId);
}

/** 世界に生まれたインスタンス。生まれるのも1度きり。 */
export function bornInstances(changes: readonly WorldChange[]): readonly number[] {
  return changes.filter((change) => change.from === undefined).map((change) => change.object.instanceId);
}

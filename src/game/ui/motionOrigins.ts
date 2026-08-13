import type { WorldChange } from '../../domain/runtime/WorldChange';

/**
 * 世界に起きた変化（WorldChange）を「そのインスタンスは、どのインスタンスの札から飛び立つか」へ
 * 直す（HuntingSystem.md 6.2節）。矩形に直すのは、差し替え直前の並びを読める側（PlayScene）。
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

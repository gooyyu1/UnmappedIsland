import { spendDuration } from './actionTime';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * プレイヤーの操作としてitemをownerのスロットへ入れる。枠が入れるのに時間を要求していれば
 * （SlotDef.putInMinutes）その分だけ先に時間を進めてから入れる。
 *
 * **プレイヤーが物を入れる経路はすべてここを通す。** 値段は枠が決めるので、カードへ重ねても、
 * レーンへ落としても、端の矢印で送っても同じだけかかる（経路で値段が変わらない、SlotSystem.md 2節）。
 * 世界の組み立て（シナリオ・地形生成）は操作ではないので通さない。
 *
 * 時間と効果の順序、経過中に関与オブジェクトが失われたときの扱いはactions/combinationsと同じ
 * （ActionSystem.md 2節）。placeは入れ方そのもので、位置を指定する入れ方（WorldObject.moveToSlotAt*）
 * も同じ扱いになる。
 */
export function putIntoSlot(
  item: WorldObject,
  owner: WorldObject,
  slotGlobalId: number,
  actor: WorldObject | undefined,
  session: WorldSession,
  place: () => void,
): void {
  // 入らないと分かっているなら時間も取らない。時間だけ取られて何も入らない、が起きないようにする。
  if (item.rejectionForMoveTo(owner, slotGlobalId) !== undefined) return;

  const minutes = owner.def.getSlotDef(slotGlobalId)?.putInMinutes(owner, item, actor) ?? 0;
  if (!spendDuration(minutes, session, [item, owner])) return;

  place();
}

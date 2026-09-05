import { spendDurationAndReportParticipantsAlive } from './actionTime';
import type { Slot } from './Slot';
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
 * （ActionSystem.md 2節）。placeは入れ方そのもので、位置を指定する入れ方（WorldObject.moveToSlotOrRejectionのat）
 * も同じ扱いになる。
 */
export function putIntoSlot(
  item: WorldObject,
  slot: Slot,
  agent: WorldObject | undefined,
  session: WorldSession,
  place: () => void,
): void {
  // これも操作1つなので、まるごと囲う（WorldSession.runToSeam）。経過中に配られて待たされた
  // 手番は、入れ終えたこの切れ目で起きる。クレーム（whileActing）の外側で閉じるのは
  // Interaction.tryExecuteと同じ理由。
  session.runToSeam(() =>
    // 11.5節の表に並ぶ操作の1つなので、判定も分数の問い合わせも時間の経過も入れることそのものも、
    // 同じ関係を張った状態で行う。実行なので動作主も主張する（whileActing）。
    slot.def.putInRelation(slot.owner, agent, item).whileActing((context) => {
      // 入らないと分かっているなら時間も取らない。時間だけ取られて何も入らない、が起きないようにする。
      if (item.rejectionForMoveTo(slot) !== undefined) return;

      const minutes = slot.def.putInMinutes(context);
      if (!spendDurationAndReportParticipantsAlive(minutes, session, [item, slot.owner])) return;

      place();
    }),
  );
}

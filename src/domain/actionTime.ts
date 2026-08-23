import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * 行動にかかるゲーム内時間を進める（ActionSystem.md 実行の順序）。
 *
 * 時間は効果の適用より**先**に進める。行動してから結果が出る順序であり、作ったもの・見つけたものが
 * 自分の制作時間・探索時間ぶんの tick を浴びずに済むため。
 *
 * ただし経過中の tick は range イベント（`on_min` 等）を通してオブジェクトを破棄しうるので、
 * 使っていた道具が行動の途中で壊れることがある。破棄は「親スロットから切り離す」ことなので
 * （GameElementDefinition.md 9.3節）、そのまま効果を適用しても例外にはならないが、`same_slot` の
 * spawn が置き場所を失うなどして**黙って何も起きない**結果になる。それでは追えないため、関与する
 * オブジェクトが1つでも世界から失われていたら、その行動は成立しなかったものとして打ち切る。
 *
 * 戻り値は「このまま効果を適用してよいか」。falseでも時間は既に経過している（1時間かけて道具が
 * 壊れ、何も得られなかった、という結果になる）。
 */
export function spendDurationAndReportParticipantsAlive(
  minutes: number,
  session: WorldSession,
  participants: readonly (WorldObject | undefined)[],
): boolean {
  // Worldを持たないセッション（時間の概念が無い単体テスト等）では時間を進めない。
  const world = session.world;
  if (minutes <= 0 || world === undefined) return true;

  // 見るのは「経過前に世界に居たのに、経過後は居ない」ものだけ。もともと世界の木に繋がっていない
  // オブジェクト（時間を持たない文脈で作った一時的なもの等）は、失われたわけではない。
  const present = participants.filter(
    (participant): participant is WorldObject =>
      participant !== undefined && world.instance.containsOrIs(participant),
  );

  session.advanceWorldTime(minutes);
  return present.every((participant) => world.instance.containsOrIs(participant));
}

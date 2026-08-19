import type { WorldCodex } from './WorldCodex';
import type { CellDef } from './SlotDef';
import type { RecipeRequirementDef } from './RecipeDef';
import type { WorldObject } from './WorldObject';

/**
 * 製作中オブジェクトの枠へ、手元と足元から素材を自動で入れる（RecipeSystem.md 4節）。
 *
 * 「スロットの中身をまとめて検査して、足りるものを選んで入れる」という判断はYAMLの語彙では
 * 表せないため、プログラム側に置く。
 *
 * 探す順は**手持ち → 現在地のアイテム**。入れ物（かご）の中までは探さない——探すと、しまった物が
 * 勝手に出ていくことになり、しまうという操作の意味が無くなる。どちらのスロットも直下の中身しか
 * 見ないので、入れ子は構造的に起こらない。
 *
 * 同じ枠に入りうる型が複数あるときは、**要求数を満たせる型のうち最初に見つかったもの**を使う。
 * 満たせる型が1つも無ければ、足りなくても最初に見つかった型を入れる（何も起きないより、
 * 何が足りないかが見える方がよい）。型で指定された枠でもタグで指定された枠でも、候補の集め方が
 * 変わるだけで選び方は同じなので、分岐を持たない。
 *
 * @returns 入れた物の数。0なら何も動かなかった。
 */
export function autoFillMaterials(
  inProgress: WorldObject,
  materialsSlotGlobalId: number,
  sources: readonly (readonly WorldObject[])[],
  codex: WorldCodex,
  /** 残りの工程が要求するもの（crafting.remainingRequirements）。省略すると全ての枠を埋める。 */
  stillNeeded?: readonly RecipeRequirementDef[],
): number {
  const slot = inProgress.tryGetSlot(materialsSlotGlobalId);
  if (slot === undefined) return 0;

  const available = sources.flat();
  let moved = 0;

  for (let index = 0; index < (slot.def.cellCount ?? 0); index += 1) {
    const cell = slot.def.cellAt(index);
    // 出番の終わった枠は埋めない。表示から消える枠なので、入れると取り出せなくなる。
    const candidates = chooseCandidates(cell, 1, available).filter(
      (object) =>
        stillNeeded === undefined || stillNeeded.some((requirement) => requirement.requires(object.def)),
    );
    if (candidates.length === 0) continue;

    const needed = (cell.max ?? 1) - (slot.cells[index]?.members.length ?? 0);
    if (needed <= 0) continue;

    for (const candidate of chooseCandidates(cell, needed, available).slice(0, needed)) {
      if (candidate.moveToSlot(inProgress, materialsSlotGlobalId) !== undefined) break;
      available.splice(available.indexOf(candidate), 1);
      moved += 1;
    }
  }

  return moved;
}

/**
 * その枠に入る候補を型ごとにまとめ、要求数を満たせる最初の型を返す。満たせる型が無ければ、
 * 最初に見つかった型をそのまま返す。
 */
function chooseCandidates(
  cell: CellDef,
  needed: number,
  available: readonly WorldObject[],
): readonly WorldObject[] {
  const byDef = new Map<number, WorldObject[]>();
  for (const object of available) {
    if (!cell.accepts(object.def)) continue;
    const group = byDef.get(object.def.globalId);
    if (group === undefined) byDef.set(object.def.globalId, [object]);
    else group.push(object);
  }

  const groups = [...byDef.values()];
  return groups.find((group) => group.length >= needed) ?? groups[0] ?? [];
}

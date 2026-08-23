import type { WorldCodex } from './WorldCodex';
import type { SlotCell } from './CellLayout';
import type { RecipeRequirementDef } from './RecipeDef';
import type { WorldObject } from './WorldObject';

/**
 * 製作中オブジェクトの枠へ、手元と足元から素材を自動で入れる（RecipeSystem.md 4節）。
 *
 * 「スロットの中身をまとめて検査して、足りるものを選んで入れる」という判断はYAMLの語彙では
 * 表せないため、プログラム側に置く。
 *
 * **探すのはsourcesの並び順**で、どこから集めるかは呼び出し側が決める（craftingView）。渡された
 * 並びの直下しか見ないので、入れ子は構造的に起こらない。
 *
 * 同じ枠に入りうる型が複数あるときは、**枠の空きを埋められる型のうち最初に見つかったもの**を使う。
 * 埋められる型が1つも無ければ、足りなくても最初に見つかった型を入れる（何も起きないより、
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

  // 材料スロットは要求ごとの枠を持つ（inProgressObjects）ので、枠数は必ず決まっている。
  if (slot.def.cellsToKeep === 'grows') return 0;

  const available = sources.flat();
  let moved = 0;

  for (const [index, cell] of slot.cells.entries()) {
    // 出番の終わった枠は埋めない。表示から消える枠なので、入れると取り出せなくなる。
    if (!stillWanted(cell, stillNeeded)) continue;

    for (const candidate of chooseCandidates(cell, available)) {
      // 入れる先は選んだ枠そのもの。スロットに任せると、同じ型を受け入れる別の枠へ入りうる。
      const target = inProgress.getSlot(materialsSlotGlobalId);
      if (candidate.moveToSlot(target, { kind: 'cell', index }) !== undefined) break;
      available.splice(available.indexOf(candidate), 1);
      moved += 1;
    }
  }

  return moved;
}

/**
 * この枠に対応する要求がまだ残っているか。枠は要求の指定（`match`）ごとに1つ作られる
 * （inProgressObjects.requirementCells）ので、同じ指定の要求が残っていなければその枠の出番は
 * 終わっている。要求から作られていない枠（`accept`を持たない枠）は対応する要求を持たない。
 */
function stillWanted(cell: SlotCell, stillNeeded: readonly RecipeRequirementDef[] | undefined): boolean {
  if (stillNeeded === undefined) return true;

  const accept = cell.def.accept;
  return accept !== undefined && stillNeeded.some((requirement) => requirement.match.key === accept.key);
}

/**
 * その枠へ入れる候補を型ごとにまとめ、**枠の空きを埋められる型のうち最初に見つかったもの**を、
 * 空きの数だけ返す。埋められる型が無ければ、足りなくても最初に見つかった型を返す。
 * 空きが無い型（合流できない相手が入っている枠）は候補にしない。
 */
function chooseCandidates(cell: SlotCell, available: readonly WorldObject[]): readonly WorldObject[] {
  const byDef = new Map<number, WorldObject[]>();
  for (const object of available) {
    if (!cell.accepts(object.def)) continue;
    const group = byDef.get(object.def.globalId);
    if (group === undefined) byDef.set(object.def.globalId, [object]);
    else group.push(object);
  }

  const groups = [...byDef.values()]
    .map((objects) => ({ objects, room: cell.roomFor(objects[0]) }))
    .filter(({ room }) => room >= 1);

  const chosen = groups.find(({ objects, room }) => objects.length >= room) ?? groups.at(0);
  return chosen === undefined ? [] : chosen.objects.slice(0, chosen.room);
}

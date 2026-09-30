import type { SlotCell } from './CellLayout';
import { materialsSlotOf, remainingRequirementsOf } from './crafting';
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
 * 枠1つに入るのは1つの型なので、**どの枠へどの型を入れるかは、入る数が最も多くなる組み合わせを
 * 選ぶ**（planFills）。受け入れが重なる枠を宣言順に先着で埋めると、尖った石が刃物の枠へ入った時点で
 * 石斧の行き場が無くなり、持っているのに埋まらない。型で指定された枠でもタグで指定された枠でも、
 * 候補の集め方が変わるだけで選び方は同じなので、分岐を持たない。
 *
 * @returns 入れた物の数。0なら何も動かなかった。
 */
export function autoFillMaterials(
  inProgress: WorldObject,
  sources: readonly (readonly WorldObject[])[],
): number {
  const slot = materialsSlotOf(inProgress);
  if (slot === undefined) return 0;

  // 材料スロットは要求ごとの枠を持つ（inProgressObjects）ので、枠数は必ず決まっている。
  if (slot.def.cellCountPolicy === 'grows') return 0;

  // 何がまだ要るかは製作中オブジェクト自身から決まる（crafting.remainingRequirementsOf）ので、
  // 外から渡させない。別の進み具合の一覧を渡されても型は通り、済んだ工程の枠へ入れてしまう。
  const stillNeeded = remainingRequirementsOf(inProgress);
  const targets = [...slot.cells.entries()]
    // 出番の終わった枠は埋めない。表示から消える枠なので、入れると取り出せなくなる。
    .filter(([, cell]) => hasRemainingRequirement(cell, stillNeeded))
    .map(([index, cell]) => ({ index, cell }));
  let moved = 0;

  for (const { index, objects } of planFills(targets, sources.flat())) {
    for (const object of objects) {
      // 入れる先は選んだ枠そのもの。スロットに任せると、同じ型を受け入れる別の枠へ入りうる。
      if (object.moveToSlotOrRejection(slot, { kind: 'cell', index }) !== undefined) break;
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
function hasRemainingRequirement(cell: SlotCell, stillNeeded: readonly RecipeRequirementDef[]): boolean {
  const accept = cell.def.accept;
  return accept !== undefined && stillNeeded.some((requirement) => requirement.match.key === accept.key);
}

/** 枠（スロットの中の添字）と、そこへ入れる物。 */
interface Fill {
  readonly index: number;
  readonly objects: readonly WorldObject[];
}

/**
 * 枠ごとに入れる型を1つずつ選び、**入る数の合計が最も多くなる組み合わせ**を返す。同じ数になる
 * 組み合わせが複数あれば、枠を並び順に見て、枠を埋め切れる型→埋め切れない型→入れない、の順で、
 * それぞれ先に見つかった型から試して最初に見つけたものを採る——重ならない枠では、どの枠も埋め切れる型の
 * うち最初に見つかったものになる。空きが無い型（合流できない相手が入っている枠）は候補にしない。
 *
 * 枠の数も手元の型の数も小さいので、組み合わせを総当たりし、残りの枠が全部埋まっても今の最良に届かない
 * 枝だけを刈る。
 */
function planFills(
  targets: readonly { readonly index: number; readonly cell: SlotCell }[],
  available: readonly WorldObject[],
): readonly Fill[] {
  const groups = groupByDef(available);
  const used = groups.map(() => 0);
  const roomOf = (cell: SlotCell, group: number): number =>
    Math.min(cell.vacancyForIgnoringVolume(groups[group][0]), available.length);
  const acceptedBy = targets.map(({ cell }) =>
    groups.flatMap((objects, group) =>
      cell.accepts(objects[0].def) && roomOf(cell, group) >= 1 ? [group] : [],
    ),
  );
  // 残りの枠が、どれも入れられるだけ入れた場合に足せる数（刈り込みの上限）。
  const bestCase = acceptedBy.map((accepted, at) =>
    Math.max(0, ...accepted.map((group) => Math.min(roomOf(targets[at].cell, group), groups[group].length))),
  );
  const bestCaseFrom = bestCase.map((_, at) => bestCase.slice(at).reduce((sum, n) => sum + n, 0));

  // 枠ごとに選んだもの（並び順）。入れない枠はobjectsが空。
  const chosen: Fill[] = [];
  let best: { moved: number; plan: readonly Fill[] } = { moved: -1, plan: [] };

  const search = (at: number, moved: number): void => {
    if (moved + (bestCaseFrom[at] ?? 0) <= best.moved) return;
    if (at === targets.length) {
      best = { moved, plan: [...chosen] };
      return;
    }

    const { index, cell } = targets[at];
    const options = acceptedBy[at]
      .map((group) => ({ group, room: roomOf(cell, group), left: groups[group].length - used[group] }))
      .filter(({ left }) => left >= 1);
    const ordered = [
      ...options.filter(({ left, room }) => left >= room),
      ...options.filter(({ left, room }) => left < room),
    ];
    for (const { group, room, left } of ordered) {
      const count = Math.min(room, left);
      // 同じ型を前の枠が使っていれば、その残りから取る。
      chosen.push({ index, objects: groups[group].slice(used[group], used[group] + count) });
      used[group] += count;
      search(at + 1, moved + count);
      used[group] -= count;
      chosen.pop();
    }

    chosen.push({ index, objects: [] });
    search(at + 1, moved);
    chosen.pop();
  };

  search(0, 0);
  return best.plan;
}

/** 物を型ごとにまとめる（見つかった順）。 */
function groupByDef(objects: readonly WorldObject[]): WorldObject[][] {
  const byDef = new Map<number, WorldObject[]>();
  for (const object of objects) {
    const group = byDef.get(object.def.globalId);
    if (group === undefined) byDef.set(object.def.globalId, [object]);
    else group.push(object);
  }
  return [...byDef.values()];
}

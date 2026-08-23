import type { SlotDef } from './SlotDef';
import type { SlotPosition } from './SlotPosition';
import type { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';
import { CellLayout, type SlotCell } from './CellLayout';

/**
 * 1つのWorldObjectが持つ、1つのスロットの実行時状態。中身の並べ方はCellLayoutが持ち、こちらは
 * **このスロットが何を受け入れるか**を答える。正の情報源はこちら側（親のスロット配列）であり、
 * 子側のWorldObject.parentは逆引き用のキャッシュ（7.1節）。
 *
 * 中身の追加・削除はWorldObjectのスロット移動系経由でのみ行う（親子の整合性を1箇所でのみ保証するため）。
 */
export class Slot {
  readonly def: SlotDef;

  /**
   * この枠を持っているオブジェクト。**枠は必ず誰かのもの**なので、受け入れ判定に要る規約プロパティも
   * 断る理由に書く名前も、呼び出し側から渡されずに自分で辿る。
   */
  readonly owner: WorldObject;

  private readonly layout: CellLayout;

  constructor(def: SlotDef, owner: WorldObject) {
    this.def = def;
    this.owner = owner;
    this.layout = new CellLayout(def);
  }

  /** セルの並びそのもの。位置＝添字。 */
  get cells(): readonly SlotCell[] {
    return this.layout.cells;
  }

  /** スタックの区別を畳み込んだ、このスロットの中身全部のビュー。 */
  get contents(): readonly WorldObject[] {
    return this.layout.contents;
  }

  /** 中身を、積み重なっているまとまりごとに分けたもの（空セルは含まない。先頭が代表）。 */
  get stacks(): readonly (readonly WorldObject[])[] {
    return this.layout.stacks;
  }

  /**
   * この候補オブジェクトを受け入れない理由（受け入れるならundefined）。見るのは枠の型・枠の空き・
   * capacity（move_to_slot、7.1〜7.3節）。
   */
  rejectionFor(candidate: WorldObject): string | undefined {
    const engine = this.owner.session.codex.vocabulary.engine;
    const ownerName = this.owner.def.name;
    if (!this.def.acceptsAnywhere(candidate.def)) {
      return `'${ownerName}.${this.def.name}' は '${candidate.def.name}' を受け入れられません（枠の型が合いません）。`;
    }

    if (this.def.capacity !== undefined) {
      const currentVolume = this.sumVolume(engine.volumeId);
      const addedVolume = candidate.tryGetProperty(engine.volumeId)?.number ?? 0;
      if (currentVolume + addedVolume > this.def.capacity) {
        return `'${ownerName}.${this.def.name}' の容量（${this.def.capacity}）を超えます。`;
      }
    }

    if (this.layout.vacancyForIgnoringVolume(candidate) < 1) {
      return `'${ownerName}.${this.def.name}' に '${candidate.def.name}' を置ける枠が空いていません。`;
    }

    return undefined;
  }

  /**
   * この枠へitemを入れるのにかかるゲーム内時間（分、SlotDef.putInMinutes）。宣言が無ければ0。
   * 値段は枠が決めるので、どの経路で入れても同じだけかかる（slotEntry参照）。
   */
  putInMinutes(actor: WorldObject | undefined, item: WorldObject): number {
    return this.def.putInMinutes(this.owner, actor, item);
  }

  /**
   * candidatesを先頭から順に入れていったとき、続けて受け取れる個数（1つ目で断るなら0）。
   *
   * 1つずつrejectionForを訊いても答えは出ない——2つ目が入るかは、1つ目が入った後の空きで決まるため。
   * まとめて入れる操作が「何個まで入るか」を、実際に動かす前に問うための入口。
   *
   * candidatesは同じ束の仲間（同じ型・同じ代表チェーン）であることを前提にする。置ける枠の数は
   * 型だけで決まるので先頭の1つで代表して数え、かさ（volume）だけを1つずつ積み上げる。
   */
  acceptedCount(candidates: readonly WorldObject[]): number {
    const engine = this.owner.session.codex.vocabulary.engine;
    if (candidates.length === 0 || !this.def.acceptsAnywhere(candidates[0].def)) return 0;

    const vacancy = this.layout.vacancyForIgnoringVolume(candidates[0]);
    let volume = this.sumVolume(engine.volumeId);
    let count = 0;
    for (const candidate of candidates) {
      if (count >= vacancy) break;
      volume += candidate.tryGetProperty(engine.volumeId)?.number ?? 0;
      if (this.def.capacity !== undefined && volume > this.def.capacity) break;
      count += 1;
    }
    return count;
  }

  private sumVolume(volumePropertyGlobalId: number): number {
    return this.contents.reduce((sum, o) => sum + (o.tryGetProperty(volumePropertyGlobalId)?.number ?? 0), 0);
  }

  /**
   * 中身のかさ（7.3節のvolume）が上限（capacity）に対して占める割合（0〜1）。上限を持たないスロットは
   * 割合を定義できないためundefined。
   */
  fillRatio(volumePropertyGlobalId: number): number | undefined {
    if (this.def.capacity === undefined || this.def.capacity <= 0) return undefined;
    return Math.min(1, this.sumVolume(volumePropertyGlobalId) / this.def.capacity);
  }

  addWithoutParentLink(obj: WorldObject): void {
    this.layout.add(obj);
  }

  removeWithoutParentLink(obj: WorldObject): void {
    this.layout.remove(obj);
  }

  /** 代表チェーンが変わったobjを、合致するスタックへ入れ直す（CellLayout.restack）。 */
  restack(obj: WorldObject): void {
    this.layout.restack(obj);
  }

  /** same_slotによる置き換えの配置（CellLayout.placeSameSlot）。 */
  placeSameSlot(obj: WorldObject, originCellIndex: number, sameKindStillInCell: boolean): boolean {
    return this.layout.placeSameSlot(obj, originCellIndex, sameKindStillInCell);
  }

  /** 位置を指定して入れる（CellLayout.insertAt）。 */
  insertAt(obj: WorldObject, at: SlotPosition): boolean {
    return this.layout.insertAt(obj, at);
  }

  /** 位置を指定して並び替える（CellLayout.moveStackTo）。 */
  moveStackTo(stack: ObjectStack, at: SlotPosition): boolean {
    return this.layout.moveStackTo(stack, at);
  }

  /** objが現在属しているObjectStack（無ければundefined）。 */
  findStackContaining(obj: WorldObject): ObjectStack | undefined {
    return this.layout.findStackContaining(obj);
  }

  /** objが自分1個だけで占めているセルのスタック（合流していればundefined）。 */
  findOwnStack(obj: WorldObject): ObjectStack | undefined {
    return this.layout.findOwnStack(obj);
  }

  /** このObjectStackがセルの並びの何番目にあるか（属していなければ-1）。 */
  indexOfStack(stack: ObjectStack): number {
    return this.layout.indexOfStack(stack);
  }
}

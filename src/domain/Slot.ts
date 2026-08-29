import type { SlotDef } from './SlotDef';
import type { SlotPosition } from './SlotPosition';
import type { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';
import { CellLayout, type SlotCell } from './CellLayout';
import type { WornCoverage } from './WornCoverage';

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
   * capacity（move_to_slot、7.1〜7.3節）と、身につける枠なら装備の排他（7.5節）。
   */
  rejectionFor(candidate: WorldObject): string | undefined {
    const engine = this.owner.session.codex.vocabulary.engine;
    const ownerName = this.owner.def.name;
    if (!this.def.acceptsAnywhere(candidate.def)) {
      return `'${ownerName}.${this.def.name}' は '${candidate.def.name}' を受け入れられません（枠の型が合いません）。`;
    }

    const occupant = this.wornOccupantBlocking(candidate);
    if (occupant !== undefined) {
      return `'${ownerName}.${this.def.name}' は既に '${occupant.def.name}' で埋まっています（同じ部位の同じ階層は重ねられません）。`;
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
  putInMinutes(agent: WorldObject | undefined, item: WorldObject): number {
    return this.def.putInMinutes(this.owner, agent, item);
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
    if (this.wornOccupantBlocking(candidates[0]) !== undefined) return 0;

    // 場所を占める物は、同じ束から1つしか身につけられない（7.5節）——2つ目は1つ目と衝突する。
    const vacancy = Math.min(
      this.layout.vacancyForIgnoringVolume(candidates[0]),
      this.wornCoverageIn(candidates[0]) === undefined ? Number.POSITIVE_INFINITY : 1,
    );
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

  /**
   * この枠で候補が占める場所（7.5節）。身につける枠でなければ、部位を持たない物と同じくundefined
   * ——**同じ衣類を2着持ち歩けなくなっては困る**ので、排他が効くのは着る場所だけ。
   *
   * エンジンの他の規則と違い、ここは世界の側の語をそのまま読む——「身につける枠」を枠の宣言から
   * 導く手掛かりが他に無いため（`WorldRuleVocabulary`。WorldObject.isLandと同じ事情）。
   */
  private wornCoverageIn(candidate: WorldObject): WornCoverage | undefined {
    const world = this.owner.session.codex.vocabulary.world;
    return this.def.globalId === world.equipmentSlotId ? candidate.def.wornCoverage : undefined;
  }

  /** 候補と同じ場所を既に占めている中身（競合はブロック型なので、外すのはプレイヤー。7.5節）。 */
  private wornOccupantBlocking(candidate: WorldObject): WorldObject | undefined {
    const coverage = this.wornCoverageIn(candidate);
    if (coverage === undefined) return undefined;

    return this.contents.find((worn) => coverage.conflictsWith(worn.def.wornCoverage));
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

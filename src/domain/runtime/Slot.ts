import type { SlotDef } from '../defs/SlotDef';
import type { WellKnownProperties } from '../defs/WellKnownProperties';
import { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';

/**
 * 1つのWorldObjectが持つ、1つのスロットの実行時状態。中身を「セルの並び」として保持する。各セルは1つの
 * ObjectStack（7.6節）か、空（undefined）。位置＝セルの添字。正の情報源はこちら側（親のスロット配列）であり、
 * 子側のWorldObject.parentは逆引き用のキャッシュ（7.1節）。
 *
 * fixedPositionsと非fixedPositionsの違いは「空になったセルを残すか、詰めるか」の1点のみ:
 * - fixedPositions: セル配列は常にunitCapacity長で、空セルはundefinedとして保持され位置が安定する。
 * - 非fixedPositions: 空になったセルは削除して前詰めする（undefinedを含まない）。
 *
 * 中身の追加・削除はWorldObjectのスロット移動系経由でのみ行う（親子の整合性を1箇所でのみ保証するため）。
 */
export class Slot {
  readonly def: SlotDef;

  /** セルの並び。要素はObjectStackかundefined（空セル、fixedPositionsのみ）。位置＝添字。 */
  private readonly _cells: (ObjectStack | undefined)[] = [];

  private get liveStacks(): readonly ObjectStack[] {
    return this._cells.filter((c): c is ObjectStack => c !== undefined);
  }

  /** セルの並びそのもの（空セルはundefined）。位置＝添字。 */
  get cells(): readonly (ObjectStack | undefined)[] {
    return [...this._cells];
  }

  /** スタックの区別を畳み込んだ、このスロットの中身全部のビュー。 */
  get contents(): readonly WorldObject[] {
    return this.liveStacks.flatMap((s) => s.members);
  }

  constructor(def: SlotDef) {
    this.def = def;
    // fixedPositionsは固定長のセル配列（全て空=undefined）として持つ。
    if (def.fixedPositions) {
      for (let i = 0; i < (def.unitCapacity ?? 0); i++) this._cells.push(undefined);
    }
  }

  /**
   * move_to_slot（7.1節）が候補オブジェクトを受け入れられるか（accepts制約・capacity・unitCapacity、
   * 7.2〜7.3節）。force=trueの場合は呼び出し側がこの判定自体をスキップする。
   *
   * 戻り値: 受け入れ可能ならundefined、拒否する場合はその理由。
   */
  canAccept(candidate: WorldObject, wellKnown: WellKnownProperties, ownerName: string): string | undefined {
    if (!this.acceptsRule(candidate)) {
      return `'${ownerName}.${this.def.name}' は '${candidate.def.name}' を受け入れられません（accepts制約）。`;
    }

    if (this.def.capacity !== undefined) {
      const currentSize = this.sumSize(wellKnown.sizeId);
      const addedSize = candidate.getNumber(wellKnown.sizeId);
      if (currentSize + addedSize > this.def.capacity) {
        return `'${ownerName}.${this.def.name}' の容量（${this.def.capacity}）を超えます。`;
      }
    }

    if (this.def.unitCapacity !== undefined && !this.hasCapacityFor(candidate)) {
      return `'${ownerName}.${this.def.name}' の上限（${this.def.unitCapacity}）を超えます。`;
    }

    return undefined;
  }

  private acceptsRule(candidate: WorldObject): boolean {
    const rules = this.def.accepts;
    if (rules.length === 0) return true; // accepts省略 = 無制限スロット（7.1節）

    for (const rule of rules) {
      if (!rule.matches(candidate.def)) continue;
      const countOfSameType = this.contents.filter((o) => rule.matches(o.def)).length;
      if (countOfSameType < rule.max) return true;
    }
    return false;
  }

  private sumSize(sizePropertyGlobalId: number): number {
    return this.contents.reduce((sum, o) => sum + o.getNumber(sizePropertyGlobalId), 0);
  }

  /**
   * 量的オブジェクト（7.6節）をこのスロットへ何単位まで受け入れられるか。capacity未指定なら無制限
   * （Number.POSITIVE_INFINITY）。既に入っている量の分だけ空きが減る。
   */
  remainingCapacity(sizePropertyGlobalId: number): number {
    if (this.def.capacity === undefined) return Number.POSITIVE_INFINITY;
    return this.def.capacity - this.sumSize(sizePropertyGlobalId);
  }

  /**
   * 量的オブジェクトの合流先（同じ型の在中インスタンス）。同種は1インスタンスに保たれる前提のため
   * 最初の1つを返す。accepts制約を満たさない場合はundefined（異種の液体が既にいる場合など）。
   */
  findQuantityMergeTarget(candidate: WorldObject): WorldObject | undefined {
    return this.contents.find((o) => o.def.globalId === candidate.def.globalId);
  }

  /** acceptsルール（7.2節）だけを判定する。量的オブジェクトはcapacityを量として別に扱うため分けて使う。 */
  acceptsByRule(candidate: WorldObject): boolean {
    return this.acceptsRule(candidate);
  }

  /**
   * unitCapacityにcandidateを新たに加える余地があるか。stackableで既存のObjectStackへ合流できる場合は
   * 新しい枠を消費しない（非stackableは同種でも常に個体ごとに別スタック）。
   */
  private hasCapacityFor(candidate: WorldObject): boolean {
    if (this.def.unitCapacity === undefined) return true;
    if (this.def.stackable && this.findMatchingStack(candidate) !== undefined) return true;
    return this.liveStacks.length < this.def.unitCapacity;
  }

  /**
   * 通常の追加。合流できる既存スタックがあればそこへ、無ければ新規スタックとして最初の空きセルへ、空きが無ければ
   * 末尾へ入れる。
   */
  addInternal(obj: WorldObject): void {
    if (this.def.stackable) {
      // tryInsertはmatchesを満たさない相手を弾くため、その場合は新規スタック生成へフォールバックする。
      const existing = this.findMatchingStack(obj);
      if (existing !== undefined && existing.tryInsert(obj)) return;
    }

    this.placeNewStack(new ObjectStack(obj));
  }

  /** 新規スタックを最初の空きセルへ、無ければ末尾へ。 */
  private placeNewStack(newStack: ObjectStack): void {
    const firstEmpty = this._cells.indexOf(undefined);
    if (firstEmpty >= 0) this._cells[firstEmpty] = newStack;
    else this._cells.push(newStack);
  }

  removeInternal(obj: WorldObject): void {
    const idx = this._cells.findIndex((c) => c !== undefined && c.members.includes(obj));
    if (idx < 0) return;

    this._cells[idx]!.remove(obj);
    if (this._cells[idx]!.members.length > 0) return;

    // 空になったセル: fixedPositionsは空セル(undefined)として残し、非fixedPositionsは前詰めする。
    if (this.def.fixedPositions) this._cells[idx] = undefined;
    else this._cells.splice(idx, 1);
  }

  /**
   * objの代表チェーンが変わったかもしれないとき、今の所属スタックの固定識別子に合致しなくなっていれば抜いて
   * 入れ直し（既存スタックへ合流／新規スタック）、「同種は1スタックにまとまる」という不変条件を中身の変化後も
   * 保つ。非stackableは対象外（個体ごとの別スタックで、合流判定の相手が居ないため実害が無い）。
   */
  restack(obj: WorldObject): void {
    if (!this.def.stackable) return;

    const idx = this._cells.findIndex((c) => c !== undefined && c.members.includes(obj));
    if (idx < 0) return;

    const current = this._cells[idx]!;
    if (current.matches(obj)) return; // まだ同じ識別子に合致：動かす必要は無い

    current.remove(obj);
    if (current.members.length === 0) {
      if (this.def.fixedPositions) this._cells[idx] = undefined;
      else this._cells.splice(idx, 1);
    }

    this.addInternal(obj);
  }

  /**
   * same_slotによる置き換え（GameElementDefinition.md 9.4節）。置き換えオブジェクトを新規スタックとして、
   * originが居たセル(originCellIndex)を基準に配置する（EffectSite参照）。自動整列は行わない（同種はObjectStack
   * 内で整列されるため、スタック間の位置は著者が見た位置を保つ）。
   *
   * - kindRemains（originの同種がまだ残る＝selfが生き残る/同種の兄弟が残る）: 置き換え先はoriginの隣。非
   *   fixedPositionsはその添字へ挿入（後続が右へずれる）。fixedPositionsはoriginの右隣（無ければ左隣）へ、
   *   最寄りの空きセルをずらして場所を作って入れる。空きが無ければ配置失敗（false→呼び出し側でfallback）。
   * - !kindRemains（originの同種が全て消えた）: 空いた元の位置へ。非fixedPositionsはその添字へ挿入、
   *   fixedPositionsは空になったそのセル(undefined)を埋める。
   */
  placeSameSlot(obj: WorldObject, originCellIndex: number, kindRemains: boolean): boolean {
    if (!this.def.fixedPositions) {
      const at = kindRemains ? originCellIndex + 1 : originCellIndex;
      this._cells.splice(Math.min(Math.max(at, 0), this._cells.length), 0, new ObjectStack(obj));
      return true;
    }

    const stack = new ObjectStack(obj);
    return kindRemains
      ? this.tryPlaceAdjacent(stack, originCellIndex)
      : this.tryFillCell(stack, originCellIndex);
  }

  /** fixedPositions: 空いているセル(cellIndex)をスタックで埋める（埋まっていれば失敗）。 */
  private tryFillCell(stack: ObjectStack, cellIndex: number): boolean {
    if (cellIndex < 0 || cellIndex >= this._cells.length || this._cells[cellIndex] !== undefined)
      return false;
    this._cells[cellIndex] = stack;
    return true;
  }

  /**
   * fixedPositions: originCellIndexの右隣（無ければ左隣）へ、最寄りの空きセルをその方向へずらして場所を作り、
   * スタックを入れる。「右が空いている限り右に、そうでなければ左に生まれる」。どちらの方向にも空きが無ければ
   * false（＝スロットが埋まっている。呼び出し側でfallbackへ委ねる）。
   */
  private tryPlaceAdjacent(stack: ObjectStack, originCellIndex: number): boolean {
    return (
      this.tryPlaceShifted(stack, originCellIndex, 1) || this.tryPlaceShifted(stack, originCellIndex, -1)
    );
  }

  /** fixedPositions: gapIndexの隙間へ、step方向へ既存のセルをずらして場所を作り、スタックを入れる。 */
  private tryPlaceAtGap(stack: ObjectStack, gapIndex: number, step: 1 | -1): boolean {
    return step === 1
      ? this.tryPlaceShifted(stack, gapIndex - 1, 1)
      : this.tryPlaceShifted(stack, gapIndex, -1);
  }

  private tryPlaceShifted(stack: ObjectStack, originCellIndex: number, step: number): boolean {
    const target = originCellIndex + step;
    if (target < 0 || target >= this._cells.length) return false;

    let emptyAt = -1;
    for (let i = target; i >= 0 && i < this._cells.length; i += step) {
      if (this._cells[i] === undefined) {
        emptyAt = i;
        break;
      }
    }
    if (emptyAt === -1) return false;

    // emptyからtargetへ、間のセルをstep方向へ1つずつずらす（targetを空ける）。押し出しはセル単位で行うため、
    // 押し出されるスタック（同種複数個）の中身の相対順序は変わらない。
    for (let i = emptyAt; i !== target; i -= step) this._cells[i] = this._cells[i - step];
    this._cells[target] = stack;
    return true;
  }

  /**
   * プレイヤーが位置を指定して入れる手動配置。gapIndexはセルとセルの隙間の番号で、0が先頭のセルの前、
   * cells.lengthが末尾のセルの後ろ。
   *
   * fixedPositionsはまず右方向へ、それが無理なら左方向へ既存のセルをずらして場所を作る
   * （tryPlaceShifted）。どちらへもずらせなければfalse。前詰めスロットはその隙間へ挿入するだけ。
   *
   * 合流できる既存スタックがあるときは、指定された位置よりも「同種は1スタックにまとまる」という不変条件を
   * 優先してそちらへ入れる（addInternalと同じ扱い）。
   */
  tryInsertAtGap(obj: WorldObject, gapIndex: number): boolean {
    if (this.def.stackable) {
      const existing = this.findMatchingStack(obj);
      if (existing !== undefined && existing.tryInsert(obj)) return true;
    }

    const stack = new ObjectStack(obj);
    if (!this.def.fixedPositions) {
      this._cells.splice(clampIndex(gapIndex, this._cells.length), 0, stack);
      return true;
    }
    return this.tryPlaceAtGap(stack, gapIndex, 1) || this.tryPlaceAtGap(stack, gapIndex, -1);
  }

  /**
   * プレイヤーが空きセルを指定して入れる手動配置（fixedPositions専用）。指定したセルが空いていなければ
   * false。合流できる既存スタックの優先はtryInsertAtGapと同じ。
   */
  tryInsertAtCell(obj: WorldObject, cellIndex: number): boolean {
    if (!this.def.fixedPositions) return false;

    if (this.def.stackable) {
      const existing = this.findMatchingStack(obj);
      if (existing !== undefined && existing.tryInsert(obj)) return true;
    }

    return this.tryFillCell(new ObjectStack(obj), cellIndex);
  }

  /**
   * プレイヤーによる手動並び替え。スタックを丸ごと、指定した隙間へ入れ直す。
   *
   * 並び替えを1個ずつの出し入れで行うことはできない。抜いた1個を入れ直すとき、残った同種のスタックへの
   * 合流が位置指定より優先される（tryInsertAtGap）ため、必ず元の位置へ戻ってしまうため。
   *
   * fixedPositionsで詰める向きは、スタックが抜けた跡の側を先に試す。そちらには必ず空きがあるので、
   * 遠くのセルを動かさずに済む。自分の両隣の隙間へ落とした場合は、跡がそのまま行き先になるので
   * 何も動かさない。前詰めスロットは抜いて入れ直すだけ。
   */
  tryMoveStackToGap(stack: ObjectStack, gapIndex: number): boolean {
    const from = this._cells.indexOf(stack);
    if (from < 0) return false;
    if (gapIndex === from || gapIndex === from + 1) return true;

    if (!this.def.fixedPositions) {
      this._cells.splice(from, 1);
      // 抜いた跡の分だけ、右へ動かすときの行き先が1つ手前へずれる。
      this._cells.splice(clampIndex(gapIndex > from ? gapIndex - 1 : gapIndex, this._cells.length), 0, stack);
      return true;
    }

    this._cells[from] = undefined;
    const toward: 1 | -1 = from < gapIndex ? -1 : 1;
    if (this.tryPlaceAtGap(stack, gapIndex, toward)) return true;
    if (this.tryPlaceAtGap(stack, gapIndex, toward === 1 ? -1 : 1)) return true;

    this._cells[from] = stack;
    return false;
  }

  /** objが現在属しているObjectStack（無ければundefined）。 */
  findStackContaining(obj: WorldObject): ObjectStack | undefined {
    return this._cells.find((c) => c !== undefined && c.members.includes(obj));
  }

  /** candidateが合流できる既存のObjectStack（ObjectDef・代表ObjectDef列が一致するもの、無ければundefined）。 */
  findMatchingStack(candidate: WorldObject): ObjectStack | undefined {
    return this._cells.find((c) => c !== undefined && c.matches(candidate));
  }

  /**
   * このObjectStackがセルの並びの何番目にあるか（＝位置。fixedPositionsでは固定番号）。属していなければ-1。
   * 位置を知りたい呼び出し側は、対象の具体的なObjectStack（cells / findStackContaining / findMatchingStackで
   * 得る）を渡す。型（ObjectDef）では引かない——represented_byが絡むと同じ外側Defでも別スタックが並びうるため、
   * Defは位置を一意に決めない。
   */
  indexOfStack(stack: ObjectStack): number {
    return this._cells.indexOf(stack);
  }

  /**
   * プレイヤーによる手動並び替え（fixedPositions専用）。対象のスタックを、指定した番号のセルと入れ替える
   * （相手が空セルなら実質移動になり、元のセルが空く）。前詰めしない前提のため、単純な2者間のswap。対象は
   * 具体的なObjectStackで受け取る（型では一意に定まらないため。indexOfStack参照）。
   */
  trySetManualPosition(stack: ObjectStack, newGridIndex: number): boolean {
    if (!this.def.fixedPositions) return false;
    const cur = this._cells.indexOf(stack);
    if (cur < 0) return false;
    if (newGridIndex < 0 || newGridIndex >= this._cells.length) return false;

    const tmp = this._cells[newGridIndex];
    this._cells[newGridIndex] = this._cells[cur];
    this._cells[cur] = tmp;
    return true;
  }
}

/** 挿入位置をセルの並びの範囲へ収める（前詰めスロットは範囲外の指定を端として受け入れる）。 */
function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

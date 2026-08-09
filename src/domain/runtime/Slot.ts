import type { SlotDef } from '../defs/SlotDef';
import type { WellKnownProperties } from '../defs/WellKnownProperties';
import { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';

/**
 * 1つのWorldObjectが持つ、1つのスロットの実行時状態。中身を「セルの並び」として保持する。各セルは1つの
 * ObjectStack（7.6節）か、空（undefined）。位置＝セルの添字。正の情報源はこちら側（親のスロット配列）であり、
 * 子側のWorldObject.parentは逆引き用のキャッシュ（7.1節）。
 *
 * 枠数が決まっている（cellCount）かどうかで、空になったセルを残すか詰めるかが変わる:
 * - cellCountあり: セル配列は常にその長さで、空セルはundefinedとして保持され位置が安定する。
 * - cellCountなし: 空になったセルは削除して前詰めする（undefinedを含まない）。
 *
 * 中身の追加・削除はWorldObjectのスロット移動系経由でのみ行う（親子の整合性を1箇所でのみ保証するため）。
 */
export class Slot {
  readonly def: SlotDef;

  /** セルの並び。要素はObjectStackかundefined（空セル、枠数固定のスロットのみ）。位置＝添字。 */
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

  /** 枠の数が決まっているスロットか（＝空セルを残して位置を安定させるか、SlotSystem.md 3節）。 */
  private get hasFixedCells(): boolean {
    return this.def.cellCount !== undefined;
  }

  constructor(def: SlotDef) {
    this.def = def;
    // 枠数が決まっていれば、その長さの配列（全て空=undefined）として持つ。
    for (let i = 0; i < (def.cellCount ?? 0); i++) this._cells.push(undefined);
  }

  /**
   * move_to_slot（7.1節）が候補オブジェクトを受け入れられるか（枠の型・枠の空き・capacity、
   * 7.2〜7.3節）。force=trueの場合は呼び出し側がこの判定自体をスキップする。
   *
   * 戻り値: 受け入れ可能ならundefined、拒否する場合はその理由。
   */
  canAccept(candidate: WorldObject, wellKnown: WellKnownProperties, ownerName: string): string | undefined {
    if (!this.def.acceptsAnywhere(candidate.def)) {
      return `'${ownerName}.${this.def.name}' は '${candidate.def.name}' を受け入れられません（枠の型が合いません）。`;
    }

    if (this.def.capacity !== undefined) {
      const currentSize = this.sumSize(wellKnown.sizeId);
      const addedSize = candidate.getNumber(wellKnown.sizeId);
      if (currentSize + addedSize > this.def.capacity) {
        return `'${ownerName}.${this.def.name}' の容量（${this.def.capacity}）を超えます。`;
      }
    }

    if (this.vacancyFor(candidate) < 1) {
      return `'${ownerName}.${this.def.name}' に '${candidate.def.name}' を置ける枠が空いていません。`;
    }

    return undefined;
  }

  /**
   * candidatesを先頭から順に入れていったとき、続けて受け取れる個数（1つ目で断るなら0）。
   *
   * 1つずつcanAcceptを訊いても答えは出ない——2つ目が入るかは、1つ目が入った後の空きで決まるため。
   * まとめて入れる操作が「何個まで入るか」を、実際に動かす前に問うための入口。
   *
   * candidatesは同じ束の仲間（同じ型・同じ代表チェーン）であることを前提にする。置ける枠の数は
   * 型だけで決まるので先頭の1つで代表して数え、かさ（capacity）だけを1つずつ積み上げる。
   */
  acceptedCount(candidates: readonly WorldObject[], wellKnown: WellKnownProperties): number {
    if (candidates.length === 0 || !this.def.acceptsAnywhere(candidates[0].def)) return 0;

    const vacancy = this.vacancyFor(candidates[0]);
    let size = this.sumSize(wellKnown.sizeId);
    let count = 0;
    for (const candidate of candidates) {
      if (count >= vacancy) break;
      size += candidate.getNumber(wellKnown.sizeId);
      if (this.def.capacity !== undefined && size > this.def.capacity) break;
      count += 1;
    }
    return count;
  }

  /**
   * candidateと同じ型のものを、かさを見ずにあと何個置けるか（findCellForが置き場所を見つけられる
   * 回数）。合流できる枠の残りと、型の合う空き枠に入る数の合計。
   *
   * 枠数が決まっていないスロットは末尾に枠が増えるので上限が無い。束ねられない型（stackable=false）は
   * 1枠に1個しか入らないので、maxがいくつでも空き枠の数がそのまま上限になる。
   */
  private vacancyFor(candidate: WorldObject): number {
    if (!this.hasFixedCells) return Number.POSITIVE_INFINITY;

    return this._cells.reduce((room, cell, index) => {
      const max = this.def.cellAt(index).max ?? Number.POSITIVE_INFINITY;
      if (cell === undefined) {
        if (!this.def.cellAt(index).accepts(candidate.def)) return room;
        return room + (candidate.def.stackable ? max : 1);
      }
      if (!candidate.def.stackable || !cell.matches(candidate)) return room;
      return room + Math.max(0, max - cell.members.length);
    }, 0);
  }

  /**
   * candidateを置ける枠の位置（合流できる枠か、型の合う空き枠）。無ければundefined。
   *
   * 合流を先に見るのは「同種は1スタックにまとまる」を保つため（tryMergeIntoMatchingStack参照）。
   * 枠数が決まっていないスロットは、空き枠が無ければ末尾に枠が増えるので必ず置ける。
   */
  private findCellFor(candidate: WorldObject): number | undefined {
    const mergeable = this.findMergeableCell(candidate);
    if (mergeable !== undefined) return mergeable;

    const empty = this._cells.findIndex(
      (cell, index) => cell === undefined && this.def.cellAt(index).accepts(candidate.def),
    );
    if (empty >= 0) return empty;

    return this.hasFixedCells ? undefined : this._cells.length;
  }

  private indexOfFirstEmptyCell(): number | undefined {
    const index = this._cells.indexOf(undefined);
    return index < 0 ? undefined : index;
  }

  /**
   * candidateが合流できる枠の位置（無ければundefined）。合流には、その型が束ねられること
   * （ObjectDef.stackable）・代表チェーンが一致すること・その枠のmaxに空きがあることが要る。
   */
  private findMergeableCell(candidate: WorldObject): number | undefined {
    if (!candidate.def.stackable) return undefined;

    const index = this._cells.findIndex((cell, i) => {
      if (cell === undefined || !cell.matches(candidate)) return false;
      const max = this.def.cellAt(i).max;
      return max === undefined || cell.members.length < max;
    });
    return index < 0 ? undefined : index;
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
   * 中身の量が上限（capacity）を超えている分。超えていなければ0。中身自身のaccumulateは上限を
   * 知らずに量を増やせるため（降雨で溜まる水）、超過分を捨てる側がこの量を問い合わせる。
   */
  overflowingQuantity(sizePropertyGlobalId: number): number {
    return Math.max(0, -this.remainingCapacity(sizePropertyGlobalId));
  }

  /**
   * 中身の量（7.3節のsize）が上限（capacity）に対して占める割合（0〜1）。上限を持たないスロットは
   * 割合を定義できないためundefined。
   */
  fillRatio(sizePropertyGlobalId: number): number | undefined {
    if (this.def.capacity === undefined || this.def.capacity <= 0) return undefined;
    return Math.min(1, this.sumSize(sizePropertyGlobalId) / this.def.capacity);
  }

  /**
   * 量的オブジェクトの合流先（同じ型の在中インスタンス）。同種は1インスタンスに保たれる前提のため
   * 最初の1つを返す。枠に空きが無い場合はundefined（異種の液体が既にいる場合など）。
   */
  findQuantityMergeTarget(candidate: WorldObject): WorldObject | undefined {
    return this.contents.find((o) => o.def.globalId === candidate.def.globalId);
  }

  /** 型だけを判定する（7.2節）。量的オブジェクトはcapacityを量として別に扱うため分けて使う。 */
  acceptsByRule(candidate: WorldObject): boolean {
    return this.def.acceptsAnywhere(candidate.def);
  }

  /**
   * 通常の追加。合流できる既存スタックがあればそこへ、無ければ新規スタックとして型の合う空き枠へ、
   * 枠数が決まっていないスロットで空きが無ければ末尾へ入れる。
   */
  addInternal(obj: WorldObject): void {
    if (this.tryMergeIntoMatchingStack(obj)) return;

    // 型の合う枠が無いのは、canAcceptを飛ばすforce配置（9.4節）でのみ起きうる。その場合は型を問わず
    // 空いている枠へ、それも無ければ末尾へ足して受け止める。
    const at = this.findCellFor(obj) ?? this.indexOfFirstEmptyCell();
    const stack = new ObjectStack(obj);
    if (at !== undefined && at < this._cells.length) this._cells[at] = stack;
    else this._cells.push(stack);
  }

  /**
   * 合流できる既存スタックがあればそこへ入れる。「同種は1スタックにまとまる」という不変条件は位置の指定より
   * 優先されるため、中身を加える経路は位置指定の有無によらず必ず最初にここを通す。
   *
   * 束ねられない型（ObjectDef.stackable=false）と、枠のmaxが埋まっている相手は合流しない
   * （呼び出し側は新規スタックの生成へ進む）。
   */
  private tryMergeIntoMatchingStack(obj: WorldObject): boolean {
    const at = this.findMergeableCell(obj);
    return at !== undefined && this._cells[at]!.tryInsert(obj);
  }

  removeInternal(obj: WorldObject): void {
    const idx = this._cells.findIndex((c) => c !== undefined && c.members.includes(obj));
    if (idx < 0) return;

    this._cells[idx]!.remove(obj);
    if (this._cells[idx]!.members.length > 0) return;

    // 空になったセル: 枠数が決まっていれば空セル(undefined)として残し、そうでなければ前詰めする。
    if (this.hasFixedCells) this._cells[idx] = undefined;
    else this._cells.splice(idx, 1);
  }

  /**
   * objの代表チェーンが変わったかもしれないとき、今の所属スタックの固定識別子に合致しなくなっていれば抜いて
   * 入れ直し（既存スタックへ合流／新規スタック）、「同種は1スタックにまとまる」という不変条件を中身の変化後も
   * 保つ。非stackableは対象外（個体ごとの別スタックで、合流判定の相手が居ないため実害が無い）。
   */
  restack(obj: WorldObject): void {
    if (!obj.def.stackable) return;

    const idx = this._cells.findIndex((c) => c !== undefined && c.members.includes(obj));
    if (idx < 0) return;

    const current = this._cells[idx]!;
    if (current.matches(obj)) return; // まだ同じ識別子に合致：動かす必要は無い

    current.remove(obj);
    if (current.members.length === 0) {
      if (this.hasFixedCells) this._cells[idx] = undefined;
      else this._cells.splice(idx, 1);
    }

    this.addInternal(obj);
  }

  /**
   * same_slotによる置き換え（GameElementDefinition.md 9.4節）。合流先が無ければ置き換えオブジェクトを新規
   * スタックとして、originが居たセル(originCellIndex)を基準に配置する（EffectSite参照）。自動整列は行わない
   * （同種はObjectStack内で整列されるため、スタック間の位置は著者が見た位置を保つ）。
   *
   * - kindRemains（originの同種がまだ残る＝selfが生き残る/同種の兄弟が残る）: 置き換え先はoriginの隣。
   *   前詰めスロットはその添字へ挿入（後続が右へずれる）。枠数固定のスロットはoriginの右隣（無ければ左隣）へ、
   *   最寄りの空きセルをずらして場所を作って入れる。空きが無ければ配置失敗（false→呼び出し側でfallback）。
   * - !kindRemains（originの同種が全て消えた）: 空いた元の位置へ。前詰めスロットはその添字へ挿入、
   *   枠数固定のスロットは空になったそのセル(undefined)を埋める。
   */
  placeSameSlot(obj: WorldObject, originCellIndex: number, kindRemains: boolean): boolean {
    if (this.tryMergeIntoMatchingStack(obj)) return true;

    if (!this.hasFixedCells) {
      const at = kindRemains ? originCellIndex + 1 : originCellIndex;
      this._cells.splice(Math.min(Math.max(at, 0), this._cells.length), 0, new ObjectStack(obj));
      return true;
    }

    const stack = new ObjectStack(obj);
    return kindRemains
      ? this.tryPlaceAdjacent(stack, originCellIndex)
      : this.tryFillCell(stack, originCellIndex);
  }

  /** 枠数固定のスロット: 空いているセル(cellIndex)をスタックで埋める（埋まっていれば失敗）。 */
  private tryFillCell(stack: ObjectStack, cellIndex: number): boolean {
    if (cellIndex < 0 || cellIndex >= this._cells.length || this._cells[cellIndex] !== undefined)
      return false;
    this._cells[cellIndex] = stack;
    return true;
  }

  /**
   * 枠数固定のスロット: originCellIndexの右隣（無ければ左隣）へ、最寄りの空きセルをその方向へずらして場所を作り、
   * スタックを入れる。「右が空いている限り右に、そうでなければ左に生まれる」。どちらの方向にも空きが無ければ
   * false（＝スロットが埋まっている。呼び出し側でfallbackへ委ねる）。
   */
  private tryPlaceAdjacent(stack: ObjectStack, originCellIndex: number): boolean {
    return (
      this.tryPlaceShifted(stack, originCellIndex, 1) || this.tryPlaceShifted(stack, originCellIndex, -1)
    );
  }

  /** 枠数固定のスロット: gapIndexの隙間へ、step方向へ既存のセルをずらして場所を作り、スタックを入れる。 */
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
   * 枠数固定のスロットはまず右方向へ、それが無理なら左方向へ既存のセルをずらして場所を作る
   * （tryPlaceShifted）。どちらへもずらせなければfalse。前詰めスロットはその隙間へ挿入するだけ。
   *
   * 合流が指定位置に優先することはtryMergeIntoMatchingStack参照。
   */
  tryInsertAtGap(obj: WorldObject, gapIndex: number): boolean {
    if (this.tryMergeIntoMatchingStack(obj)) return true;

    const stack = new ObjectStack(obj);
    if (!this.hasFixedCells) {
      this._cells.splice(clampIndex(gapIndex, this._cells.length), 0, stack);
      return true;
    }
    return this.tryPlaceAtGap(stack, gapIndex, 1) || this.tryPlaceAtGap(stack, gapIndex, -1);
  }

  /**
   * プレイヤーが空きセルを指定して入れる手動配置（枠数固定のスロット専用）。指定したセルが空いていなければ
   * false。合流できる既存スタックの優先はtryInsertAtGapと同じ。
   */
  tryInsertAtCell(obj: WorldObject, cellIndex: number): boolean {
    if (!this.hasFixedCells) return false;

    if (this.tryMergeIntoMatchingStack(obj)) return true;

    return this.tryFillCell(new ObjectStack(obj), cellIndex);
  }

  /**
   * プレイヤーによる手動並び替え。スタックを丸ごと、指定した隙間へ入れ直す。
   *
   * 並び替えを1個ずつの出し入れで行うことはできない。抜いた1個を入れ直すとき、残った同種のスタックへの
   * 合流が位置指定より優先される（tryInsertAtGap）ため、必ず元の位置へ戻ってしまうため。
   *
   * 枠数固定のスロットで詰める向きは、スタックが抜けた跡の側を先に試す。そちらには必ず空きがあるので、
   * 遠くのセルを動かさずに済む。自分の両隣の隙間へ落とした場合は、跡がそのまま行き先になるので
   * 何も動かさない。前詰めスロットは抜いて入れ直すだけ。
   */
  tryMoveStackToGap(stack: ObjectStack, gapIndex: number): boolean {
    const from = this._cells.indexOf(stack);
    if (from < 0) return false;
    if (gapIndex === from || gapIndex === from + 1) return true;

    if (!this.hasFixedCells) {
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

  /**
   * objが自分1個だけでセルを占めているなら、そのスタック。既存スタックへ合流していれば（＝新しいセルを
   * 消費していなければ）undefined。「合流は枠を消費しない」を、位置を決める側が問い合わせるための口。
   */
  findOwnStack(obj: WorldObject): ObjectStack | undefined {
    const stack = this.findStackContaining(obj);
    return stack !== undefined && stack.members.length === 1 ? stack : undefined;
  }

  /** candidateが合流できる既存のObjectStack（ObjectDef・代表ObjectDef列が一致するもの、無ければundefined）。 */
  findMatchingStack(candidate: WorldObject): ObjectStack | undefined {
    return this._cells.find((c) => c !== undefined && c.matches(candidate));
  }

  /**
   * このObjectStackがセルの並びの何番目にあるか（＝位置。枠数固定のスロットでは固定番号）。属していなければ-1。
   * 位置を知りたい呼び出し側は、対象の具体的なObjectStack（cells / findStackContaining / findMatchingStackで
   * 得る）を渡す。型（ObjectDef）では引かない——represented_byが絡むと同じ外側Defでも別スタックが並びうるため、
   * Defは位置を一意に決めない。
   */
  indexOfStack(stack: ObjectStack): number {
    return this._cells.indexOf(stack);
  }

  /**
   * プレイヤーによる手動並び替え（枠数固定のスロット専用）。対象のスタックを、指定した番号のセルと入れ替える
   * （相手が空セルなら実質移動になり、元のセルが空く）。前詰めしない前提のため、単純な2者間のswap。対象は
   * 具体的なObjectStackで受け取る（型では一意に定まらないため。indexOfStack参照）。
   */
  trySetManualPosition(stack: ObjectStack, newGridIndex: number): boolean {
    if (!this.hasFixedCells) return false;
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

import type { SlotDef, CellDef } from './SlotDef';
import type { SlotPosition } from './SlotPosition';
import { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';

/**
 * 枠1つ。**宣言（CellDef）と、今そこに入っているもの（ObjectStack）の組。**
 *
 * 枠の宣言は添字ではなく枠そのものに付く。**ずらしても動くのは中身だけ**で、宣言は元の位置に留まる
 * （枠数を決めたスロットでは、`cells[2]` が受け入れる型は中身が入れ替わっても変わらない）。
 *
 * 中身を入れ替えるのはCellLayoutだけ。枠は並びの外へ単独では出ないので、TypeScriptのfriendの代わりに
 * 名前で断っている。
 */
export class SlotCell {
  readonly def: CellDef;

  private _stack: ObjectStack | undefined;

  constructor(def: CellDef, stack?: ObjectStack) {
    this.def = def;
    this._stack = stack;
  }

  get stack(): ObjectStack | undefined {
    return this._stack;
  }

  get isEmpty(): boolean {
    return this._stack === undefined;
  }

  /** この枠がcandidateを受け入れる型か（個数は見ない）。 */
  accepts(candidateDef: WorldObject['def']): boolean {
    return this.def.accepts(candidateDef);
  }

  /**
   * 今入っているスタックへ合流できるか。束ねられる型で、代表チェーンが一致し、maxに空きがあること
   * （GameElementDefinition.md 7.6節）。
   */
  canMerge(candidate: WorldObject): boolean {
    if (!candidate.def.stackable || this._stack === undefined) return false;
    if (!this._stack.canMerge(candidate)) return false;
    return this.def.max === undefined || this._stack.members.length < this.def.max;
  }

  /**
   * この枠にあと何個入るか。空き枠なら型が合えばmax個（束ねられない型は1個）、埋まっていれば
   * 合流できる場合のmaxまでの残り。
   */
  vacancyForIgnoringVolume(candidate: WorldObject): number {
    const max = this.def.max ?? Number.POSITIVE_INFINITY;
    if (this._stack === undefined) {
      if (!this.accepts(candidate.def)) return 0;
      return candidate.def.stackable ? max : 1;
    }
    if (!candidate.def.stackable || !this._stack.canMerge(candidate)) return 0;
    return Math.max(0, max - this._stack.members.length);
  }

  /** 合流できるなら入れる。**maxを守るのはこの枠自身**（ObjectStackは自分の上限を知らない）。 */
  tryMerge(obj: WorldObject): boolean {
    return this.canMerge(obj) && this._stack!.tryInsert(obj);
  }

  /** 中身を入れ替える（CellLayout専用）。 */
  replaceContents(stack: ObjectStack | undefined): void {
    this._stack = stack;
  }
}

/**
 * スロットの中身の並び。位置＝枠の添字で、置き場所を作る（＝ずらす）のもここ。
 *
 * 枠数を決めたスロットと前詰めのスロットは、別々の置き方をしているのではなく**同じずらし方**に乗る。
 * 前詰めのスロットは枠の宣言が全て同じ1つなので、「末尾に枠を1つ生やしてから、そこへ向けて中身を
 * ずらす」ことが挿入と同じ結果になる。両者の差は次だけで、それぞれ1箇所でしか効かない
 * （SlotSystem.md 3節）:
 *
 * - 空き枠が無いとき末尾に枠を足せるか（tryGrowCell）
 * - 空になった枠を残すか（vacateCell）
 * - 位置の指定が枠を直接指せるか（pointsCell）
 */
export class CellLayout {
  private readonly def: SlotDef;

  /** セルの並び。位置＝添字で、枠数固定のスロットでは空になっても枠そのものは残る。 */
  private readonly _cells: SlotCell[] = [];

  constructor(def: SlotDef) {
    this.def = def;
    // 枠数が決まっていれば、その長さの配列（全て空=undefined）として持つ。
    const cells = def.cellCountPolicy;
    if (cells !== 'grows') for (let i = 0; i < cells; i++) this._cells.push(new SlotCell(def.cellAt(i)));
  }

  /**
   * 枠の数が決まっているスロットか（＝空セルを残して位置を安定させるか、SlotSystem.md 3節）。
   * 枠は増えず、空いた枠は残り、その枠を位置として指せる。
   */
  private get hasFixedCells(): boolean {
    return this.def.cellCountPolicy !== 'grows';
  }

  private get stacksInFilledCells(): readonly ObjectStack[] {
    return this._cells.map((cell) => cell.stack).filter((s): s is ObjectStack => s !== undefined);
  }

  /** セルの並びそのもの。位置＝添字。 */
  get cells(): readonly SlotCell[] {
    return [...this._cells];
  }

  /** スタックの区別を畳み込んだ、中身全部のビュー。 */
  get contents(): readonly WorldObject[] {
    return this.stacksInFilledCells.flatMap((s) => s.members);
  }

  /** 中身を、積み重なっているまとまりごとに分けたもの（空セルは含まない。先頭が代表）。 */
  get stacks(): readonly (readonly WorldObject[])[] {
    return this.stacksInFilledCells.map((stack) => stack.members);
  }

  /**
   * candidateと同じ型のものを、かさを見ずにあと何個置けるか。合流できる枠の残りと、型の合う空き枠に
   * 入る数の合計。枠が増えるスロットは上限が無い。束ねられない型（stackable=false）は1枠に1個しか
   * 入らないので、maxがいくつでも空き枠の数がそのまま上限になる。
   */
  vacancyForIgnoringVolume(candidate: WorldObject): number {
    if (!this.hasFixedCells) return Number.POSITIVE_INFINITY;

    return this._cells.reduce((room, cell) => room + cell.vacancyForIgnoringVolume(candidate), 0);
  }

  /**
   * 通常の追加。合流できる既存スタックがあればそこへ、無ければ新規スタックとして型の合う空き枠へ、
   * 枠が増えるスロットで空きが無ければ末尾へ入れる。
   */
  add(obj: WorldObject): void {
    if (this.tryMergeIntoMatchingStack(obj)) return;

    // 受け入れ判定（Slot.rejectionFor）を通った後にだけ呼ばれるので、置ける枠は必ずある。
    const at = this.takeOrGrowEmptyCell(obj.def);
    if (at === undefined) return;
    this._cells[at].replaceContents(new ObjectStack(obj));
  }

  remove(obj: WorldObject): void {
    const idx = this.indexOfCellContaining(obj);
    if (idx < 0) return;

    const stack = this._cells[idx].stack!;
    stack.remove(obj);
    if (stack.members.length === 0) this.vacateCell(idx);
  }

  /**
   * objの代表チェーンが変わったかもしれないとき、今の所属スタックの固定識別子に合致しなくなっていれば抜いて
   * 入れ直し（既存スタックへ合流／新規スタック）、「同種は1スタックにまとまる」という不変条件を中身の変化後も
   * 保つ。非stackableは対象外（個体ごとの別スタックで、合流判定の相手が居ないため実害が無い）。
   */
  restack(obj: WorldObject): void {
    if (!obj.def.stackable) return;

    const idx = this.indexOfCellContaining(obj);
    if (idx < 0) return;

    const current = this._cells[idx].stack!;
    if (current.canMerge(obj)) return; // まだ同じ識別子に合致：動かす必要は無い

    current.remove(obj);
    if (current.members.length === 0) this.vacateCell(idx);

    this.add(obj);
  }

  /**
   * same_slotによる置き換え（GameElementDefinition.md 9.4節）。合流先が無ければ置き換えオブジェクトを新規
   * スタックとして、originが居たセル(originCellIndex)を基準に配置する（SameSlotSpawnSite参照）。自動整列は行わない
   * （同種はObjectStack内で整列されるため、スタック間の位置は著者が見た位置を保つ）。
   *
   * - sameKindStillInCell（originの同種がまだ残る＝selfが生き残る/同種の兄弟が残る）: 置き換え先はoriginの隣。
   *   originの右隣（無ければ左隣）へ、最寄りの空きセルをずらして場所を作って入れる。空きが無ければ
   *   配置失敗（false→呼び出し側でfallback）。
   * - !sameKindStillInCell（originの同種が全て消えた）: 空いた元の位置へ。
   */
  placeSameSlot(obj: WorldObject, originCellIndex: number, sameKindStillInCell: boolean): boolean {
    if (this.tryMergeIntoMatchingStack(obj)) return true;

    const stack = new ObjectStack(obj);
    return sameKindStillInCell
      ? this.tryPlaceAtGap(stack, originCellIndex + 1, 1) || this.tryPlaceAtGap(stack, originCellIndex, -1)
      : this.tryPlaceAt(stack, { kind: 'cell', index: originCellIndex });
  }

  /**
   * 位置を指定して入れる（SlotPosition参照）。合流が指定位置に優先することは
   * tryMergeIntoMatchingStack参照。
   */
  insertAt(obj: WorldObject, at: SlotPosition): boolean {
    if (this.tryMergeIntoMatchingStack(obj)) return true;

    return this.tryPlaceAt(new ObjectStack(obj), at);
  }

  /**
   * 位置を指定して並び替える。動くのは1個ではなくスタック丸ごと。
   *
   * 並び替えを1個ずつの出し入れで行うことはできない。抜いた1個を入れ直すとき、残った同種のスタックへの
   * 合流が位置指定より優先される（insertAt）ため、必ず元の位置へ戻ってしまうため。
   *
   * 枠を指した並び替えは**指した枠と入れ替える**——相手が空なら実質の移動になり、元の枠が空く。
   * 詰めないので単純な2者間のswapで足りる。
   *
   * 隙間を指した並び替えで詰める向きは、スタックが抜けた跡の側を先に試す。そちらには必ず空きがあるので、
   * 遠くのセルを動かさずに済む。自分の両隣の隙間へ落とした場合は、跡がそのまま行き先になるので
   * 何も動かさない。
   */
  moveStackTo(stack: ObjectStack, at: SlotPosition): boolean {
    const from = this.indexOfStack(stack);
    if (from < 0) return false;

    if (this.pointsCell(at)) return this.trySwapCellContents(from, at.index);

    const gapIndex = clampIndex(at.index, this._cells.length);
    if (gapIndex === from || gapIndex === from + 1) return true;

    this._cells[from].replaceContents(undefined);
    const toward: 1 | -1 = from < gapIndex ? -1 : 1;
    if (this.tryPlaceAtGap(stack, gapIndex, toward)) return true;
    if (this.tryPlaceAtGap(stack, gapIndex, toward === 1 ? -1 : 1)) return true;

    this._cells[from].replaceContents(stack);
    return false;
  }

  /** objが現在属しているObjectStack（無ければundefined）。 */
  findStackContaining(obj: WorldObject): ObjectStack | undefined {
    return this._cells.find((cell) => cell.stack?.members.includes(obj) === true)?.stack;
  }

  /**
   * objが自分1個だけでセルを占めているなら、そのスタック。既存スタックへ合流していれば（＝新しいセルを
   * 消費していなければ）undefined。「合流は枠を消費しない」を、位置を決める側が問い合わせるための口。
   */
  findOwnStack(obj: WorldObject): ObjectStack | undefined {
    const stack = this.findStackContaining(obj);
    return stack !== undefined && stack.members.length === 1 ? stack : undefined;
  }

  /**
   * このObjectStackがセルの並びの何番目にあるか（＝位置。枠数固定のスロットでは固定番号）。属していなければ-1。
   * 位置を知りたい呼び出し側は、対象の具体的なObjectStack（cells / findStackContainingで
   * 得る）を渡す。型（ObjectDef）では引かない——束ねない型（stackable: false）は同じDefでも1個ずつ
   * 別スタックになるため、Defは位置を一意に決めない。
   */
  indexOfStack(stack: ObjectStack): number {
    return this._cells.findIndex((cell) => cell.stack === stack);
  }

  /**
   * 合流できる既存スタックがあればそこへ入れる。「同種は1スタックにまとまる」という不変条件は位置の指定より
   * 優先されるため、中身を加える経路は位置指定の有無によらず必ず最初にここを通す。
   *
   * 束ねられない型（ObjectDef.stackable=false）と、枠のmaxが埋まっている相手は合流しない
   * （呼び出し側は新規スタックの生成へ進む）。
   */
  private tryMergeIntoMatchingStack(obj: WorldObject): boolean {
    const at = this._cells.findIndex((cell) => cell.canMerge(obj));
    return at >= 0 && this._cells[at].tryMerge(obj);
  }

  /**
   * 新規スタックを置ける空き枠。型の合う空き枠が無ければ、枠が増えるスロットでは末尾に足す。
   */
  private takeOrGrowEmptyCell(candidateDef: WorldObject['def']): number | undefined {
    const empty = this._cells.findIndex((cell) => cell.isEmpty && cell.accepts(candidateDef));
    return empty >= 0 ? empty : this.tryGrowCell();
  }

  /**
   * 位置の指定に従ってスタックを置く。枠の指定はその枠を埋め（埋まっていれば失敗）、隙間の指定は
   * まず右方向へ、それが無理なら左方向へ既存のセルをずらして場所を作る。
   */
  private tryPlaceAt(stack: ObjectStack, at: SlotPosition): boolean {
    if (this.pointsCell(at)) return this.tryFillCell(stack, at.index);

    const gapIndex = clampIndex(at.index, this._cells.length);
    return this.tryPlaceAtGap(stack, gapIndex, 1) || this.tryPlaceAtGap(stack, gapIndex, -1);
  }

  /**
   * 枠を直接指す指定として扱えるか。**枠を指せるのは枠数を決めたスロットだけ**なので、前詰めの
   * スロットでは隙間の指定として読む——空き枠は末尾の受け皿だけで、枠の位置がそのまま並びの終わりを
   * 指すため。指す側がどちらのスロットかを知らなくて済むよう、読み替えはここで行う。
   */
  private pointsCell(at: SlotPosition): boolean {
    return at.kind === 'cell' && this.hasFixedCells;
  }

  /** 空いているセル(cellIndex)をスタックで埋める（埋まっていれば失敗）。 */
  private tryFillCell(stack: ObjectStack, cellIndex: number): boolean {
    if (cellIndex < 0 || cellIndex >= this._cells.length || !this._cells[cellIndex].isEmpty) return false;
    this._cells[cellIndex].replaceContents(stack);
    return true;
  }

  /** gapIndexの隙間へ、step方向へ既存のセルをずらして場所を作り、スタックを入れる。 */
  private tryPlaceAtGap(stack: ObjectStack, gapIndex: number, step: 1 | -1): boolean {
    return step === 1
      ? this.tryPlaceShifted(stack, gapIndex - 1, 1)
      : this.tryPlaceShifted(stack, gapIndex, -1);
  }

  /**
   * originCellIndexのstep隣へ、最寄りの空きセルをその方向からずらして場所を作り、スタックを入れる。
   * 空きが無ければfalse（＝そちらへは置けない。呼び出し側が反対方向やfallbackへ進む）。
   */
  private tryPlaceShifted(stack: ObjectStack, originCellIndex: number, step: 1 | -1): boolean {
    const target = originCellIndex + step;
    if (target < 0) return false;
    // 枠が増えるスロットには空き枠が残らないので、ずらす先をその都度末尾に作る（右方向のみ）。
    if (step === 1 && target <= this._cells.length && !this._cells.some((cell) => cell.isEmpty)) {
      this.tryGrowCell();
    }
    if (target >= this._cells.length) return false;

    let emptyAt = -1;
    for (let i = target; i >= 0 && i < this._cells.length; i += step) {
      if (this._cells[i].isEmpty) {
        emptyAt = i;
        break;
      }
    }
    if (emptyAt === -1) return false;

    // emptyからtargetへ、間の**中身**をstep方向へ1つずつずらす（targetを空ける）。枠の宣言は添字に
    // 留まり、動くのは中身だけ。押し出しはセル単位で行うため、押し出されるスタック（同種複数個）の
    // 中身の相対順序は変わらない。
    for (let i = emptyAt; i !== target; i -= step)
      this._cells[i].replaceContents(this._cells[i - step].stack);
    this._cells[target].replaceContents(stack);
    return true;
  }

  /** 枠を指した並び替え。中身だけを入れ替える（枠の宣言はそれぞれの添字に留まる）。 */
  private trySwapCellContents(from: number, cellIndex: number): boolean {
    if (cellIndex < 0 || cellIndex >= this._cells.length) return false;

    const swapped = this._cells[cellIndex].stack;
    this._cells[cellIndex].replaceContents(this._cells[from].stack);
    this._cells[from].replaceContents(swapped);
    return true;
  }

  /**
   * 末尾に空き枠を1つ足す。**枠が増えるスロットだけ**で、枠数を決めたスロットは足せない（undefined）。
   * 枠の宣言は共有の1つ（cellsを宣言していないスロットなので、どの位置も同じ受け入れ方をする）。
   */
  private tryGrowCell(): number | undefined {
    if (this.hasFixedCells) return undefined;

    this._cells.push(new SlotCell(this.def.cellAt(this._cells.length)));
    return this._cells.length - 1;
  }

  /** セルを空にする。枠数が決まっていれば空の枠として残し、そうでなければ取り除いて前詰めする。 */
  private vacateCell(index: number): void {
    this._cells[index].replaceContents(undefined);
    if (!this.hasFixedCells) this._cells.splice(index, 1);
  }

  private indexOfCellContaining(obj: WorldObject): number {
    return this._cells.findIndex((cell) => cell.stack?.members.includes(obj) === true);
  }
}

/** 挿入位置をセルの並びの範囲へ収める（範囲外の指定は端として受け入れる）。 */
function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

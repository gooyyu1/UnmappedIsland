import type { CellDef, SlotDef } from './SlotDef';
import type { SlotPosition } from './SlotPosition';
import { ObjectStack } from './ObjectStack';
import type { WorldObject } from './WorldObject';

/**
 * 枠1つ。**宣言（CellDef）と、今そこに入っているもの（ObjectStack）の組。**
 *
 * 枠の宣言は添字ではなく枠そのものに付く。**ずらしても動くのは中身だけ**で、宣言は元の位置に留まる
 * （枠数を決めたスロットでは、`cells[2]` が受け入れる型は中身が入れ替わっても変わらない）。
 *
 * 中身を入れ替えるのはSlotだけ。枠はSlotの外へ単独では出ないので、TypeScriptのfriendの代わりに
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
    if (!this._stack.matches(candidate)) return false;
    return this.def.max === undefined || this._stack.members.length < this.def.max;
  }

  /**
   * この枠にあと何個入るか。空き枠なら型が合えばmax個（束ねられない型は1個）、埋まっていれば
   * 合流できる場合のmaxまでの残り。
   */
  roomFor(candidate: WorldObject): number {
    const max = this.def.max ?? Number.POSITIVE_INFINITY;
    if (this._stack === undefined) {
      if (!this.accepts(candidate.def)) return 0;
      return candidate.def.stackable ? max : 1;
    }
    if (!candidate.def.stackable || !this._stack.matches(candidate)) return 0;
    return Math.max(0, max - this._stack.members.length);
  }

  /** 合流できるなら入れる。**maxを守るのはこの枠自身**（ObjectStackは自分の上限を知らない）。 */
  tryInsert(obj: WorldObject): boolean {
    return this.canMerge(obj) && this._stack!.tryInsert(obj);
  }

  /** 中身を入れ替える（Slot専用）。 */
  hold(stack: ObjectStack | undefined): void {
    this._stack = stack;
  }
}

/**
 * 1つのWorldObjectが持つ、1つのスロットの実行時状態。中身を枠（SlotCell）の並びとして保持する。
 * 位置＝枠の添字。正の情報源はこちら側（親のスロット配列）であり、子側のWorldObject.parentは
 * 逆引き用のキャッシュ（7.1節）。
 *
 * 枠数が決まっている（cellCount）かどうかで、空になった枠を残すか詰めるかが変わる:
 * - cellCountあり: 枠の並びは常にその長さで、中身が空になっても枠は残り位置が安定する。
 * - cellCountなし: 中身が空になった枠は取り除いて前詰めする。
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

  /** セルの並び。位置＝添字で、枠数固定のスロットでは空になっても枠そのものは残る。 */
  private readonly _cells: SlotCell[] = [];

  private get liveStacks(): readonly ObjectStack[] {
    return this._cells.map((cell) => cell.stack).filter((s): s is ObjectStack => s !== undefined);
  }

  /** セルの並びそのもの。位置＝添字。 */
  get cells(): readonly SlotCell[] {
    return [...this._cells];
  }

  /** スタックの区別を畳み込んだ、このスロットの中身全部のビュー。 */
  get contents(): readonly WorldObject[] {
    return this.liveStacks.flatMap((s) => s.members);
  }

  /** 中身を、積み重なっているまとまりごとに分けたもの（空セルは含まない。先頭が代表）。 */
  get stacks(): readonly (readonly WorldObject[])[] {
    return this.liveStacks.map((stack) => stack.members);
  }

  /**
   * 枠の数が決まっているスロットか（＝空セルを残して位置を安定させるか、SlotSystem.md 3節）。
   * 空き枠を指したドロップを、枠そのものへ入れる操作として扱ってよいのはこちらだけ。
   */
  private get hasFixedCells(): boolean {
    return this.def.cellsToKeep !== 'grows';
  }

  constructor(def: SlotDef, owner: WorldObject) {
    this.def = def;
    this.owner = owner;
    // 枠数が決まっていれば、その長さの配列（全て空=undefined）として持つ。
    const cells = def.cellsToKeep;
    if (cells !== 'grows') for (let i = 0; i < cells; i++) this._cells.push(new SlotCell(def.cellAt(i)));
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

    if (this.vacancyFor(candidate) < 1) {
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

    const vacancy = this.vacancyFor(candidates[0]);
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
   * candidateと同じ型のものを、かさを見ずにあと何個置けるか（findCellForが置き場所を見つけられる
   * 回数）。合流できる枠の残りと、型の合う空き枠に入る数の合計。
   *
   * 枠数が決まっていないスロットは末尾に枠が増えるので上限が無い。束ねられない型（stackable=false）は
   * 1枠に1個しか入らないので、maxがいくつでも空き枠の数がそのまま上限になる。
   */
  private vacancyFor(candidate: WorldObject): number {
    if (!this.hasFixedCells) return Number.POSITIVE_INFINITY;

    return this._cells.reduce((room, cell) => room + cell.roomFor(candidate), 0);
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

    const empty = this._cells.findIndex((cell) => cell.isEmpty && cell.accepts(candidate.def));
    if (empty >= 0) return empty;

    return this.hasFixedCells ? undefined : this._cells.length;
  }

  /**
   * candidateが合流できる枠の位置（無ければundefined）。合流には、その型が束ねられること
   * （ObjectDef.stackable）・代表チェーンが一致すること・その枠のmaxに空きがあることが要る。
   */
  private findMergeableCell(candidate: WorldObject): number | undefined {
    const index = this._cells.findIndex((cell) => cell.canMerge(candidate));
    return index < 0 ? undefined : index;
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

  /**
   * 通常の追加。合流できる既存スタックがあればそこへ、無ければ新規スタックとして型の合う空き枠へ、
   * 枠数が決まっていないスロットで空きが無ければ末尾へ入れる。
   */
  addInternal(obj: WorldObject): void {
    if (this.tryMergeIntoMatchingStack(obj)) return;

    // 受け入れ判定（rejectionFor）を通った後にだけ呼ばれるので、枠数を決めたスロットにも必ず置ける枠がある。
    const at = this.findCellFor(obj);
    const stack = new ObjectStack(obj);
    if (at !== undefined && at < this._cells.length) this._cells[at].hold(stack);
    else this._cells.push(new SlotCell(this.def.cellAt(this._cells.length), stack));
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
    return at !== undefined && this._cells[at].tryInsert(obj);
  }

  removeInternal(obj: WorldObject): void {
    const idx = this.indexOfCellContaining(obj);
    if (idx < 0) return;

    const stack = this._cells[idx].stack!;
    stack.remove(obj);
    if (stack.members.length > 0) return;

    // 空になったセル: 枠数が決まっていれば空の枠として残し、そうでなければ前詰めする。
    if (this.hasFixedCells) this._cells[idx].hold(undefined);
    else this._cells.splice(idx, 1);
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
    if (current.matches(obj)) return; // まだ同じ識別子に合致：動かす必要は無い

    current.remove(obj);
    if (current.members.length === 0) {
      if (this.hasFixedCells) this._cells[idx].hold(undefined);
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
      this.insertGrownCell(Math.min(Math.max(at, 0), this._cells.length), new ObjectStack(obj));
      return true;
    }

    const stack = new ObjectStack(obj);
    return kindRemains
      ? this.tryPlaceAdjacent(stack, originCellIndex)
      : this.tryFillCell(stack, originCellIndex);
  }

  /** 枠数固定のスロット: 空いているセル(cellIndex)をスタックで埋める（埋まっていれば失敗）。 */
  private tryFillCell(stack: ObjectStack, cellIndex: number): boolean {
    if (cellIndex < 0 || cellIndex >= this._cells.length || !this._cells[cellIndex].isEmpty) return false;
    this._cells[cellIndex].hold(stack);
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
      if (this._cells[i].isEmpty) {
        emptyAt = i;
        break;
      }
    }
    if (emptyAt === -1) return false;

    // emptyからtargetへ、間の**中身**をstep方向へ1つずつずらす（targetを空ける）。枠の宣言は添字に
    // 留まり、動くのは中身だけ。押し出しはセル単位で行うため、押し出されるスタック（同種複数個）の
    // 中身の相対順序は変わらない。
    for (let i = emptyAt; i !== target; i -= step) this._cells[i].hold(this._cells[i - step].stack);
    this._cells[target].hold(stack);
    return true;
  }

  /**
   * 位置を指定して入れる（SlotPosition参照）。**枠を指せるのは枠数を決めたスロットだけ**なので、
   * 前詰めスロットではその位置の隙間として扱う——空き枠は末尾の受け皿だけで、枠の位置がそのまま
   * 並びの終わりを指すため。指す側がどちらのスロットかを知らなくて済むよう、読み替えはここで行う。
   */
  insertAt(obj: WorldObject, at: SlotPosition): boolean {
    return at.kind === 'cell' && this.hasFixedCells
      ? this.tryInsertAtCell(obj, at.index)
      : this.tryInsertAtGap(obj, at.index);
  }

  /** 位置を指定して並び替える（insertAtと同じ読み替え）。動くのは1個ではなくスタック丸ごと。 */
  moveStackTo(stack: ObjectStack, at: SlotPosition): boolean {
    return at.kind === 'cell' && this.hasFixedCells
      ? this.tryMoveStackToCell(stack, at.index)
      : this.tryMoveStackToGap(stack, at.index);
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
  private tryInsertAtGap(obj: WorldObject, gapIndex: number): boolean {
    if (this.tryMergeIntoMatchingStack(obj)) return true;

    const stack = new ObjectStack(obj);
    if (!this.hasFixedCells) {
      this.insertGrownCell(clampIndex(gapIndex, this._cells.length), stack);
      return true;
    }
    return this.tryPlaceAtGap(stack, gapIndex, 1) || this.tryPlaceAtGap(stack, gapIndex, -1);
  }

  /**
   * プレイヤーが空きセルを指定して入れる手動配置（枠数固定のスロット専用）。指定したセルが空いていなければ
   * false。合流できる既存スタックの優先はtryInsertAtGapと同じ。
   */
  private tryInsertAtCell(obj: WorldObject, cellIndex: number): boolean {
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
  private tryMoveStackToGap(stack: ObjectStack, gapIndex: number): boolean {
    const from = this.indexOfStack(stack);
    if (from < 0) return false;
    if (gapIndex === from || gapIndex === from + 1) return true;

    if (!this.hasFixedCells) {
      this._cells.splice(from, 1);
      // 抜いた跡の分だけ、右へ動かすときの行き先が1つ手前へずれる。
      this.insertGrownCell(clampIndex(gapIndex > from ? gapIndex - 1 : gapIndex, this._cells.length), stack);
      return true;
    }

    this._cells[from].hold(undefined);
    const toward: 1 | -1 = from < gapIndex ? -1 : 1;
    if (this.tryPlaceAtGap(stack, gapIndex, toward)) return true;
    if (this.tryPlaceAtGap(stack, gapIndex, toward === 1 ? -1 : 1)) return true;

    this._cells[from].hold(stack);
    return false;
  }

  /**
   * 前詰めスロットで枠を1つ増やす。**枠の宣言は共有の1つ**（cellsを宣言していないスロットなので、
   * どの位置も同じ受け入れ方をする）。
   */
  private insertGrownCell(at: number, stack: ObjectStack): void {
    this._cells.splice(at, 0, new SlotCell(this.def.cellAt(at), stack));
  }

  private indexOfCellContaining(obj: WorldObject): number {
    return this._cells.findIndex((cell) => cell.stack?.members.includes(obj) === true);
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
   * 枠数の決まったスロットの並び替え（moveStackToの片割れ）。**指した枠と入れ替える**——相手が空なら
   * 実質の移動になり、元の枠が空く。詰めないので単純な2者間のswapで足りる。
   */
  private tryMoveStackToCell(stack: ObjectStack, cellIndex: number): boolean {
    if (!this.hasFixedCells) return false;
    const from = this.indexOfStack(stack);
    if (from < 0) return false;
    if (cellIndex < 0 || cellIndex >= this._cells.length) return false;

    // 入れ替えるのは中身だけ。枠の宣言はそれぞれの添字に留まる。
    const swapped = this._cells[cellIndex].stack;
    this._cells[cellIndex].hold(this._cells[from].stack);
    this._cells[from].hold(swapped);
    return true;
  }
}

/** 挿入位置をセルの並びの範囲へ収める（前詰めスロットは範囲外の指定を端として受け入れる）。 */
function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

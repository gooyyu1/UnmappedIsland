import type { ObjectStack } from './ObjectStack';
import type { Slot } from './Slot';
import type { WorldObject } from './WorldObject';

/** same_slot置き換えの配置指示: originが居たセルの位置と、そのセルに同種が残っているか。 */
export class SameSlotPlacement {
  readonly originCellIndex: number;
  readonly kindRemains: boolean;

  constructor(originCellIndex: number, kindRemains: boolean) {
    this.originCellIndex = originCellIndex;
    this.kindRemains = kindRemains;
  }
}

/**
 * applyActiveEffectの入口でself（効果の起点）が占めていた位置を捕捉したスナップショット。same_slot spawnだけが
 * これを使い、置き換え先を決める。「これからselfが消えるか」は捕捉時には織り込まず、置き換え位置の判断は配置時の
 * スロットの状態から行う（originKindRemains参照）。1つの効果が複数のオブジェクトを生む場合、2個目以降の位置も
 * ここが決めるため（placeReplacement）、置いた場所を覚えている。
 */
export class EffectSite {
  readonly parent: WorldObject;

  /** 捕捉時にself(origin)が入っていた枠。 */
  private readonly slot: Slot;

  /** 捕捉時にself(origin)が属していたObjectStack。 */
  private readonly originStack: ObjectStack;

  /** 捕捉時のoriginStackのセル位置。空セルが除去される非fixedPositionsでは、同種が消えた後はindexOfStackで引けなくなるため捕捉値が要る。 */
  private readonly stackIndexAtCapture: number;

  /** 次の1つを「その隣」へ並べる基準になるスタック。直前にセルを消費して置いた置き換えオブジェクトが入る（まだ誰も消費していなければundefined＝originの位置が基準）。 */
  private anchorStack: ObjectStack | undefined;

  constructor(parent: WorldObject, slot: Slot, originStack: ObjectStack, stackIndexAtCapture: number) {
    this.parent = parent;
    this.slot = slot;
    this.originStack = originStack;
    this.stackIndexAtCapture = stackIndexAtCapture;
  }

  /**
   * 置き換えオブジェクトをoriginが居た位置へ配置する（Slot.placeSameSlot参照）。1つの効果が複数のオブジェクトを
   * 生む場合、位置を引き継ぐのは新しいセルを要る最初の1つで、以降はその隣へ続けて並ぶ。空いた1つのセルを
   * 取り合わせると、2個目以降は置き場所を失ってfallbackで外へこぼれてしまうため（ヤシの実の皮がアイテム
   * レーンへ落ちる）。
   *
   * 戻り値: 配置できたらtrue。falseなら呼び出し側がfallbackへ委ねる。
   */
  placeReplacement(spawned: WorldObject): boolean {
    const slot = this.slot;
    const placed =
      spawned.insertSameSlot(this.parent, slot.def.globalId, this.nextPlacement(slot)) === undefined;

    // 既存スタックへ合流したもの（findOwnStackがundefined）はセルを消費しないため基準にしない——originの
    // 位置はまだ誰も引き継いでおらず、次の1つのために空けておく。配置に失敗したものも同じ扱いになる。
    const ownStack = placed ? slot.findOwnStack(spawned) : undefined;
    if (ownStack !== undefined) this.anchorStack = ownStack;

    return placed;
  }

  /** 次の置き換えオブジェクトの置き場所。基準になるスタックが居れば「その隣」＝同種が残っている場合と同じ扱いになる。 */
  private nextPlacement(slot: Slot): SameSlotPlacement {
    if (this.anchorStack !== undefined) {
      return new SameSlotPlacement(slot.indexOfStack(this.anchorStack), true);
    }
    return new SameSlotPlacement(this.originCellIndex(slot), this.originKindRemains);
  }

  /**
   * 元のスタックにoriginと同種がまだ残っているか（selfが生き残る／同種の兄弟が残る）。残っていれば置き換え
   * オブジェクトは隣へ、残っていなければ空いたその位置をそのまま引き継ぐ。判定は在庫（members.length）で行う
   * ——「その位置が同種を受け入れられるか」ではない。空になったセルも同種を受け入れ可能だが、位置は引き継ぐ
   * べきだから。
   */
  private get originKindRemains(): boolean {
    return this.originStack.members.length > 0;
  }

  /** originが居たセルの位置。同種が残っていればoriginStackの現在位置、消えていれば捕捉時の位置。 */
  private originCellIndex(slot: Slot): number {
    return this.originKindRemains ? slot.indexOfStack(this.originStack) : this.stackIndexAtCapture;
  }
}

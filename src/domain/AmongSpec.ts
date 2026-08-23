import { pickWeighted } from './Rng';
import type { Rng } from './Rng';
import type { ReferenceContext, ReferenceRoot } from './ReferenceRoot';
import type { TypeMatchReading, TypeMatchRule } from './TypeMatchRule';
import type { DeclaredNumberReading } from './EffectReader';
import type { DeclaredNumber } from './DeclaredNumber';
import type { WorldObject } from './WorldObject';

/** `among`の宣言（AmongSpec参照）。 */
export interface AmongReading {
  readonly root: ReferenceRoot;
  readonly slotGlobalId: number;

  /** 候補の絞り込み。省略していればundefined＝そのスロットの中身すべて。 */
  readonly match: TypeMatchReading | undefined;

  /** 候補ごとの重み。省略していればundefined＝一律。 */
  readonly weight: DeclaredNumberReading | undefined;
}

/**
 * `pick`の候補が、**周りの物から相手を1つ選ぶ**宣言（GameElementDefinition.md 10.3節）。
 * 選ばれた相手は`picked`で指す。
 *
 * 集合の指し方は条件の`{subject, slot, matches}`（14.4節）とまったく同じ2つ組＋絞り込みで、
 * 足しているのは**その中から1つ選ぶ**ことと、その重みだけ。
 *
 * **候補が1つも無ければ、その候補は抽選から外れる**（PickEffect参照）。「相手が居なければ
 * 起こらない」を著者が書かなくてよくなる。
 */
export class AmongSpec {
  /** 候補を探す相手（そのスロットの持ち主）。 */
  private readonly root: ReferenceRoot;

  private readonly slotGlobalId: number;

  /** 候補の絞り込み。undefinedならそのスロットの中身すべて。 */
  private readonly match: TypeMatchRule | undefined;

  /**
   * 候補ごとの重み。undefinedなら一律（どれも同じ確からしさ）。
   * **参照は候補自身を指す**ので、`{subject: picked, prop: volume}` のように書く。
   */
  private readonly weight: DeclaredNumber | undefined;

  constructor(
    root: ReferenceRoot,
    slotGlobalId: number,
    match: TypeMatchRule | undefined,
    weight: DeclaredNumber | undefined,
  ) {
    this.root = root;
    this.slotGlobalId = slotGlobalId;
    this.match = match;
    this.weight = weight;
  }

  /** 今この文脈での候補。相手が解決できない・そのスロットを持たないなら空。 */
  candidates(context: ReferenceContext): readonly WorldObject[] {
    const contents = context.objectAt(this.root)?.tryGetSlot(this.slotGlobalId)?.contents ?? [];
    return this.match === undefined ? contents : contents.filter((item) => this.match!.matches(item.def));
  }

  /**
   * 候補から重み付きで1つ選ぶ。**重みは候補ごとに引き直す**（その候補をpickedとした文脈で解く）。
   * 候補が無ければundefined。
   *
   * **全部の重みが0なら先頭**——`pick`の候補と同じ規約（10節）で、候補が在るのに何も選ばない回を
   * 作らない。
   */
  select(context: ReferenceContext, rng: Rng): WorldObject | undefined {
    const candidates = this.candidates(context);
    const weightOf =
      this.weight === undefined
        ? () => 1
        : (item: WorldObject) => this.weight!.resolveOrZero(context.withPicked(item));
    return pickWeighted(candidates, weightOf, rng) ?? candidates.at(0);
  }

  /** この宣言そのもの（AmongReading参照）。 */
  get reading(): AmongReading {
    return {
      root: this.root,
      slotGlobalId: this.slotGlobalId,
      match: this.match?.reading,
      weight: this.weight?.reading,
    };
  }
}

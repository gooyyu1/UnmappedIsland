/**
 * クラフトの1工程を「入力 → 工程 → 出力」の形に均した見方（クラフトネットワーク用）。
 *
 * actions・combinations・recipesは文法がそれぞれ違うが、「何を使って（消費して）何ができるか」
 * という問いに対しては同じ形で答えられる。各定義クラス（InteractionDef・ObjectDef）が
 * 自分の宣言からこれを組み立てる。
 */

/** 工程への入力1つ。型そのもの（object）か、タグで指した相手（tag）のどちらか。 */
export type CraftingInput =
  /** consumedは、この工程がその入力を消す（destroy・レシピのconsume）か。道具は消えないので偽。 */
  | { readonly kind: 'object'; readonly objectGlobalId: number; readonly consumed: boolean }
  | { readonly kind: 'tag'; readonly tagGlobalId: number; readonly consumed: boolean };

/** 工程の出力1つ。countは1回の実行で生まれる個数（pickの候補どうしで違いうるため、出現した値を全て持つ）。 */
export interface CraftingOutput {
  readonly objectGlobalId: number;
  readonly counts: readonly number[];
}

/**
 * クラフトの1工程。nameは宣言上の名前（アクション・combination・レシピの識別子）で、
 * ownerGlobalIdはそれ'を宣言している型。kindは表示名の引き方が違うため持つ（Localization.md）。
 */
export interface CraftingStep {
  readonly kind: 'action' | 'combination' | 'recipe';
  readonly name: string;
  readonly ownerGlobalId: number;
  readonly inputs: readonly CraftingInput[];
  readonly outputs: readonly CraftingOutput[];
}

/** (objectGlobalId, count)の列を、型ごとに個数をまとめたCraftingOutputの列にする。 */
export class CraftingOutputCollector {
  private readonly countsByObject = new Map<number, number[]>();

  add = (objectGlobalId: number, count: number): void => {
    const counts = this.countsByObject.get(objectGlobalId);
    if (counts === undefined) this.countsByObject.set(objectGlobalId, [count]);
    else counts.push(count);
  };

  toOutputs(): readonly CraftingOutput[] {
    return [...this.countsByObject].map(([objectGlobalId, counts]) => ({ objectGlobalId, counts }));
  }
}

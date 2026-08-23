import type { AmongReading } from './AmongSpec';
import type { ObjectRefReading } from './ObjectRef';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 自分が何を宣言しているかを読み上げられるもの（効果そのものと、それを抱える操作）。入れ子の候補も
 * この形で渡す（docs/engine/Layers.md 6節「読み下せる宣言だけを外へ出す」）。
 */
export interface EffectDeclaration {
  read(reader: EffectReader): void;
}

/**
 * 一時的な効果（9・10節）が**何を宣言しているか**を読み上げる相手（ActiveEffect.read）。
 *
 * 効果の木そのものは外へ出さない。出すのは「setがある」「pickの候補が3つあって重みはこれ」という
 * 宣言の読み上げだけで、**それをどう解釈するか（重みを確率へ直す・期待値を取る・値域の端を割ったと
 * みなす）は読み手の裁量**——定義から数値を導く近似は、ドメインではなく解析側（`src/analysis`）に置く。
 *
 * 動詞ごとにメソッドを持つのは、効果を1つ足したときに読み手が黙って取りこぼさないようにするため
 * （`read`は抽象なので、実装を書かない効果はコンパイルが通らない）。
 */
export interface EffectReader {
  /** `set`（9.2節）。リテラルの絶対値を代入する。 */
  set(target: ReferenceRoot, propertyGlobalId: number, value: number): void;

  /** `add`（9.2節）。加減算する。 */
  add(reading: AddReading): void;

  /** `spawn`（9.4節）。配置先（into）は読み上げない——どこへ入るかは世界の形の話で、宣言の意味ではない。 */
  spawn(objectGlobalId: number, count: number): void;

  /** `destroy`（9.3節）。 */
  destroy(target: ObjectRefReading): void;

  /**
   * `become`（9.9節）。行き先は識別子ではなく座標——動かす軸とその値——で渡す（3.5節）。
   * どの型になるかは対象が今居る座標との組み合わせで決まるので、宣言だけでは定まらない。
   */
  become(subject: ObjectRefReading, axisValues: ReadonlyMap<string, string>): void;

  /** `transfer`（9.5節）。amountは在庫が満ちている場合の上限で、実際に動く量は目減りしうる。 */
  transfer(reading: TransferReading): void;

  /**
   * `move`（9.6節）。オブジェクトの居場所を変えるだけで、値も個数も動かさない。
   * slotGlobalIdは名指しの行き先スロット（`to_slot`）で、undefinedなら宣言順で最初に受け入れた枠。
   */
  move(subject: ObjectRefReading, destination: ObjectRefReading, slotGlobalId: number | undefined): void;

  /**
   * `signal`（9.8節）。世界の形は何も変わらない。
   *
   * **誰の身に起きたかは渡さない。** 「避けた」のか「避けられた」のかは識別子を付けた側の裁量で、
   * 読む側がその意味に関心を持てない以上、対象にも関心を持てない。
   */
  signal(name: string): void;

  /**
   * `pick`（10節）。候補は宣言順で、重みは**宣言のまま**（リテラルか参照）渡す。確率へ直すのも、
   * 全部0のときに先頭を選ぶ規約（PickEffect.selectWeighted）を当てはめるのも読み手の側。
   */
  pick(candidates: readonly PickCandidateReading[]): void;
}

/** `pick`の候補1つの読み上げ（EffectReader.pick参照）。 */
export interface PickCandidateReading {
  readonly weight: DeclaredNumberReading;

  /** この候補が起こすこと。`read`でさらに読み下げる。 */
  readonly effect: EffectDeclaration;

  /**
   * 周りから相手を1つ選ぶ宣言（`among`、10.3節）。書いていなければundefined。
   *
   * **どれが選ばれるかは渡さない**——集合も重みも実行時の世界で決まるので、定義だけからは
   * 「どこから、どういう絞り込みで、どんな重みで選ぶか」しか言えない。
   */
  readonly among: AmongReading | undefined;
}

/**
 * 重み・所要時間の宣言（10.2節）。リテラルか、対象のプロパティ参照かの二択。
 *
 * 参照の側を**数値へ解かずに**渡すのは、解ける値かどうかが文脈で決まるため——重ねる相手の値は
 * 「どれを重ねた場合か」を決めた側にしか答えられない。
 */
export type DeclaredNumberReading =
  | { readonly kind: 'literal'; readonly value: number }
  | {
      readonly kind: 'property';
      readonly subject: ReferenceRoot;
      readonly propertyGlobalId: number;
    };

/** `transfer`（9.5節）の読み上げ。linkedはamountが全量動いた場合の`linked_add`。 */
export interface TransferReading {
  readonly from: ReferenceRoot;
  readonly fromPropertyGlobalId: number;
  readonly to: ReferenceRoot;
  readonly toPropertyGlobalId: number;
  readonly amount: number;
  readonly toAmount: number;
  readonly linked: readonly AddReading[];
}

/**
 * 「どの対象の、どのプロパティを、いくつ」——`add`（9.2節）そのものと、輸送に連れて動く
 * `linked_add`（9.5節）1件が、同じ三つ組で読める。
 */
export interface AddReading {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly amount: number;
}

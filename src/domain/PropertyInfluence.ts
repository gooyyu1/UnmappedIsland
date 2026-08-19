import type { WorldObject } from './WorldObject';

/**
 * 影響の相手（[`Windows.md`](../../docs/ui/Windows.md) 8節）。同じオブジェクトの別のプロパティか、
 * 別のオブジェクトそのものか。
 *
 * オブジェクトを相手に持つのは、**ステータスを動かすものがステータスとは限らない**ため——痛みを
 * 押し上げるのは怪我、押し下げるのは治療具で、どちらもプロパティではない。
 */
export type InfluenceCounterpart =
  | { readonly kind: 'property'; readonly propertyGlobalId: number }
  | { readonly kind: 'object'; readonly object: WorldObject };

/** 1つのプロパティから見た、影響1件。 */
export interface PropertyInfluence {
  readonly counterpart: InfluenceCounterpart;

  /**
   * 可逆な寄与（`modify`、8.3節）か。不可逆な積み上げ（`add`・`transfer`、8.4節）ならfalse。
   * 表示側はこれで記号の形を選ぶ（可逆なら三角、不可逆なら＋−）。
   */
  readonly reversible: boolean;

  /** 相手を増やす向きか。 */
  readonly increases: boolean;

  /** 今ゲート（8.2節）が開いているか。閉じている影響は、今この値を動かしていない。 */
  readonly active: boolean;
}

/**
 * 影響の1本の辺。「**原因**（どのオブジェクトのどのプロパティがゲートを開けているか）→
 * **結果**（どのオブジェクトのどのプロパティが動くか）」だけを持つ。
 *
 * 与える側・受ける側のどちらの一覧へ入るかは持たない——それは辺ではなく**視点**が決めることで、
 * 同じ辺が、一方のプロパティから見れば「与えている」、他方から見れば「受けている」になる
 * （PropertyInfluences）。
 */
export interface InfluenceEdge {
  /** 原因の側のオブジェクト。 */
  readonly causeObject: WorldObject;

  /**
   * 原因の側のプロパティ（causeObjectのもの）。プロパティを名指せない効果——段で縛っていない
   * `modify`/`add`——ではundefinedで、動く先そのものが原因になる（自分で自分を減らす基礎代謝）。
   */
  readonly causePropertyGlobalId: number | undefined;

  readonly target: WorldObject;
  readonly targetPropertyGlobalId: number;

  readonly reversible: boolean;
  readonly increases: boolean;
  readonly active: boolean;
}

/** 影響の辺の書き込み先。持続効果（PassiveEffect）は、自分が持つ辺をここへ書き出す。 */
export interface InfluenceWriter {
  write(edge: InfluenceEdge): void;
}

/** 1つのプロパティから見た影響の出入り（WorldObject.readInfluences）。 */
export interface PropertyInfluenceReading {
  /** このプロパティが他へ与えている影響。 */
  readonly given: readonly PropertyInfluence[];

  /** このプロパティが受けている影響。 */
  readonly received: readonly PropertyInfluence[];
}

/**
 * 1つのプロパティ（viewerのpropertyGlobalId）を視点に、書き出された辺を「与えている」「受けている」
 * へ振り分ける。
 *
 * - **受けている**: 動く先が自分である辺。相手は、原因が自分自身のプロパティならそのプロパティ、
 *   別のオブジェクトならそのオブジェクト。
 * - **与えている**: 原因が自分である辺。相手は動く先。
 *
 * **自分が自分を動かす辺は「受けている」にだけ出す。** 同じ1本を両側へ書くと、自分の段が自分を
 * 削っていること（基礎代謝）が2回並ぶ。
 *
 * **相手も記号も同じになる辺は1件にまとめる。** 段ごとに宣言された基礎代謝は段の数だけ辺を持つが、
 * プレイヤーにとっては「体脂肪が自分を削っている」の1件で、今開いているのはそのうち1つだけ。
 * 1つでも開いていればまとまりとして開いているものとして出す。
 */
export class PropertyInfluences implements InfluenceWriter {
  private readonly viewer: WorldObject;
  private readonly propertyGlobalId: number;

  private readonly givenEntries = new Map<string, PropertyInfluence>();
  private readonly receivedEntries = new Map<string, PropertyInfluence>();

  constructor(viewer: WorldObject, propertyGlobalId: number) {
    this.viewer = viewer;
    this.propertyGlobalId = propertyGlobalId;
  }

  get given(): readonly PropertyInfluence[] {
    return [...this.givenEntries.values()];
  }

  get received(): readonly PropertyInfluence[] {
    return [...this.receivedEntries.values()];
  }

  write(edge: InfluenceEdge): void {
    if (edge.target === this.viewer && edge.targetPropertyGlobalId === this.propertyGlobalId) {
      this.add(this.receivedEntries, this.counterpartOfCause(edge), edge);
      return;
    }

    if (edge.causeObject === this.viewer && edge.causePropertyGlobalId === this.propertyGlobalId)
      this.add(this.givenEntries, this.counterpartOf(edge.target, edge.targetPropertyGlobalId), edge);
  }

  /** 受けている影響の相手。原因がプロパティを名指していなければ、動く先＝自分自身が原因。 */
  private counterpartOfCause(edge: InfluenceEdge): InfluenceCounterpart {
    return this.counterpartOf(edge.causeObject, edge.causePropertyGlobalId ?? this.propertyGlobalId);
  }

  /** 自分のプロパティならプロパティとして、他のオブジェクトならそのオブジェクトとして指す。 */
  private counterpartOf(object: WorldObject, propertyGlobalId: number): InfluenceCounterpart {
    return object === this.viewer ? { kind: 'property', propertyGlobalId } : { kind: 'object', object };
  }

  private add(
    into: Map<string, PropertyInfluence>,
    counterpart: InfluenceCounterpart,
    edge: InfluenceEdge,
  ): void {
    const id =
      counterpart.kind === 'property'
        ? `p${counterpart.propertyGlobalId}`
        : `o${counterpart.object.instanceId}`;
    const key = `${id}|${edge.reversible}|${edge.increases}`;

    const existing = into.get(key);
    if (existing === undefined) {
      into.set(key, {
        counterpart,
        reversible: edge.reversible,
        increases: edge.increases,
        active: edge.active,
      });
      return;
    }
    if (edge.active && !existing.active) into.set(key, { ...existing, active: true });
  }
}

import type { PropertyValue } from './PropertyValue';
import type { WorldObject } from './WorldObject';

/**
 * conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）・active効果の
 * 対象/参照が共通で参照する起点。self.prop/parent.propのような1階層の参照のみ対応。
 * worldは起点として未対応（ロード時エラー、14.1節）。Ancestorは見つからなければworldまで遡るため、
 * 世界固有の概念の参照はAncestorで代替できる。
 */
export type ReferenceRoot =
  | 'self'
  | 'parent'
  /**
   * 親が宣言した効果を、そのスロットに入った各子へブロードキャスト登録するために使う（8.1節）。
   * **相手が1つに定まらない唯一のroot**で、書ける場所を決めるのはReferenceScope.broadcasts。
   */
  | 'child'
  | 'agent'
  /**
   * 運ばれてきて働きかけに使われる参加者。宣言が乗っていない側で、画面での操作の仕方では決まらない
   * （11.5節）。**今どこで書けるかを持つのはReferenceScope**——11.5節の表は未実装ぶんまで含む。
   */
  | 'instrument'
  /**
   * `among`（10.3節）が周りから選んだ相手。**候補ごとに束ね直される**ので、重みを解くときは
   * その候補、効果を当てるときは選ばれた1つを指す。amongを書いた候補の中でのみ意味を持つ。
   */
  | 'picked'
  /**
   * selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（WorldObject.findAncestorWithProperty
   * 参照）。SlotPosition判定（{in_slot: ...}）では意味を持たないため未対応（ロード時エラー）。
   */
  | 'ancestor';

/**
 * 宣言に書かれたReferenceRootを実行時のオブジェクトへ解くための、**どの役に誰が居るか**という文脈
 * （その場所がどの役を用意できるかはReferenceScopeが持つ）。
 *
 * 参照を持つ側（条件・効果・重み）はこれを組み立てず、受け取ったものをそのまま下へ渡す。**組み立てるのは
 * 「誰がこの行動をしているか」を知っている一番外側だけ**で、途中の誰も中身をばらして持ち回らない。
 *
 * ancestorはここでは解けない——「参照先のプロパティを定義している最初の祖先」なので、探すプロパティを
 * 知っている側（PropertyPath）でしか決まらない。
 */
export class ReferenceContext {
  /** この文脈のself。効果の宣言元であり、parent・ancestorはここから辿る。 */
  readonly self: WorldObject | undefined;

  /** この操作をしている者。誰も操作していない文脈（tick・持続効果のゲート）ではundefined。 */
  readonly agent: WorldObject | undefined;

  /** この操作で働きかけに使われる物。それを伴わない操作ではundefined（11.5節）。 */
  readonly instrument: WorldObject | undefined;

  /** `among`が周りから選んだ相手。amongを書いた候補の中でのみ居る（10.3節）。 */
  readonly picked: WorldObject | undefined;

  private constructor(
    self: WorldObject | undefined,
    agent: WorldObject | undefined,
    instrument: WorldObject | undefined,
    picked: WorldObject | undefined,
  ) {
    this.self = self;
    this.agent = agent;
    this.instrument = instrument;
    this.picked = picked;
  }

  /**
   * selfだけが決まっている文脈（ReferenceScope.declaration）。ほかの役は解決先を持たない——誰かが
   * 操作しているとは限らない場面（持続効果のゲート、影響の一覧）で使う。
   */
  static forSelf(self: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(self, undefined, undefined, undefined);
  }

  /** 操作の文脈（誰が・何を使って）。instrumentを伴わない操作ではundefinedを渡す（11.5節）。 */
  static acting(
    self: WorldObject | undefined,
    agent: WorldObject | undefined,
    instrument: WorldObject | undefined,
  ): ReferenceContext {
    return new ReferenceContext(self, agent, instrument, undefined);
  }

  /** selfだけを差し替えた文脈。誰が操作しているかは変わらないまま、参照の起点が移る場面で使う。 */
  withSelf(self: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(self, this.agent, this.instrument, this.picked);
  }

  /** instrumentだけを差し替えた文脈。同じ操作を候補ごとに引き直す場面で使う（TransferEffect.acceptedCount）。 */
  withInstrument(instrument: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(this.self, this.agent, instrument, this.picked);
  }

  /** pickedだけを差し替えた文脈。amongが候補ごとに重みを引き、選んだ1つへ効果を当てるときに使う。 */
  withPicked(picked: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(this.self, this.agent, this.instrument, picked);
  }

  /**
   * rootが指すオブジェクト。解決先を持たないrootはundefined——childは相手が1つに定まらず
   * （PassiveEffect.setChildRegistered）、ancestorは探すプロパティが要る（ownerOfProperty）。
   */
  objectAt(root: ReferenceRoot): WorldObject | undefined {
    switch (root) {
      case 'self':
        return this.self;
      case 'parent':
        return this.self?.parent;
      case 'agent':
        return this.agent;
      case 'instrument':
        return this.instrument;
      case 'picked':
        return this.picked;
      default:
        return undefined;
    }
  }

  /**
   * rootが指す、propertyGlobalIdを持つべきオブジェクト。**ancestorを解けるのはここだけ**——
   * 「そのプロパティを定義している最初の祖先」なので、探すプロパティが決まって初めて相手が決まる
   * （8.6節）。
   */
  ownerOfProperty(root: ReferenceRoot, propertyGlobalId: number): WorldObject | undefined {
    return root === 'ancestor' ? this.self?.findAncestorWithProperty(propertyGlobalId) : this.objectAt(root);
  }
}

/**
 * {subject, prop}が指す、1階層のプロパティ参照（ReferenceRoot＋プロパティのグローバルID）。
 * weightのpath参照（10.2節）・conditionsのvalueRef（14節）・activeの対象・passivesの対象が共有する。
 *
 * **どのプロパティを指すかとどう辿るかを1つにまとめて持つ**ので、解決するときにプロパティIDを
 * 渡し直す必要が無い（ancestor探索と読み出しが同じIDを使う）。
 *
 * 主語とプロパティが必ず対になるとは限らない場面ではこれを使わない——`ConditionNode` の葉は
 * `{subject, in_slot}` のようにプロパティを伴わない形も取るので、主語は主語のまま持つ。
 */
export class PropertyPath {
  readonly root: ReferenceRoot;
  readonly propertyGlobalId: number;

  constructor(root: ReferenceRoot, propertyGlobalId: number) {
    this.root = root;
    this.propertyGlobalId = propertyGlobalId;
  }

  /** この参照が指すプロパティを持つべきオブジェクト（ReferenceContext.ownerOfProperty）。 */
  owner(context: ReferenceContext): WorldObject | undefined {
    return context.ownerOfProperty(this.root, this.propertyGlobalId);
  }

  /** この参照が指すプロパティ値。解決先がそのプロパティを持たなければundefined。 */
  propertyValue(context: ReferenceContext): PropertyValue | undefined {
    return this.owner(context)?.tryGetProperty(this.propertyGlobalId);
  }

  /** この参照が指すプロパティの実効値。解決できなければundefined（0とは区別する）。 */
  effectiveNumber(context: ReferenceContext): number | undefined {
    return this.propertyValue(context)?.getEffectiveValue();
  }
}

/**
 * 宣言が置かれた場所が、参照の解決に何を用意できるか（GameElementDefinition.md 14.1節）。
 *
 * **ロード時に弾く根拠と、実行時に組む`ReferenceContext`は同じ1つの事実。** agentが居ない場所で
 * agentを指せてしまうと、書けたのに実行時は必ず空振りする。だから場所ごとに許すrootを数え上げるのでは
 * なく、**場所は自分が何を持つかだけを宣言し、rootの側が何を要るかを言う**。両者の食い違いは、
 * 一覧を書き写す代わりに導出で消える。
 */
export class ReferenceScope {
  /** 宣言元の個体（self）が居るか。parent・ancestorもここから辿るので、無ければ揃って解けない。 */
  private readonly hasSelf: boolean;

  /** 操作している者（agent）が居るか。誰かが操作しているとは限らない場所には居ない。 */
  private readonly hasAgent: boolean;

  /** 働きかけに使われる物（instrument）が居るか。真になるのは物が運ばれてくる場所だけ（下のcombination）。 */
  private readonly hasInstrument: boolean;

  /** amongが選んだ相手（picked）が居るか。amongを書いた候補の中だけ（10.3節）。 */
  private readonly hasPicked: boolean;

  /** 参照先のプロパティ名が決まっているか。ancestorはそれで祖先を探すので、無ければ解けない。 */
  private readonly namesProperty: boolean;

  /** 相手が1つに定まらなくてよいか。childを指せるのはここが真の場所だけ（8.1節のブロードキャスト登録）。 */
  private readonly broadcasts: boolean;

  private constructor(
    hasSelf: boolean,
    hasAgent: boolean,
    hasInstrument: boolean,
    hasPicked: boolean,
    namesProperty: boolean,
    broadcasts: boolean,
  ) {
    this.hasSelf = hasSelf;
    this.hasAgent = hasAgent;
    this.hasInstrument = hasInstrument;
    this.hasPicked = hasPicked;
    this.namesProperty = namesProperty;
    this.broadcasts = broadcasts;
  }

  /** 宣言元の個体だけが居る場所（rangeイベント6.3節、passivesの8節）。誰かが操作しているとは限らない。 */
  static readonly declaration = new ReferenceScope(true, false, false, false, true, false);

  /** 誰かが操作している場所（actions、11節）。 */
  static readonly action = new ReferenceScope(true, true, false, false, true, false);

  /** 使う物が運ばれてくる場所（`drag`のinteractions 12節・`put_in`の`duration` 7.10節）。 */
  static readonly combination = new ReferenceScope(true, true, true, false, true, false);

  /**
   * 成果物のインスタンスがまだ無い場所（レシピの解放条件、SkillSystem.md 4節）。
   * 「このレシピを知っているか」の判定なので、居るのは操作者だけ。
   */
  static readonly recipeUnlock = new ReferenceScope(false, true, false, false, true, false);

  /** プロパティ名を伴わず、オブジェクトそのものを指す場所（destroy・signal・move・in_slot判定）。 */
  get withoutPropertyName(): ReferenceScope {
    return new ReferenceScope(
      this.hasSelf,
      this.hasAgent,
      this.hasInstrument,
      this.hasPicked,
      false,
      this.broadcasts,
    );
  }

  /** amongが選んだ相手を指せる場所（10.3節）。amongを書いた候補の重みと効果だけがこれになる。 */
  get withPicked(): ReferenceScope {
    return new ReferenceScope(
      this.hasSelf,
      this.hasAgent,
      this.hasInstrument,
      true,
      this.namesProperty,
      this.broadcasts,
    );
  }

  /** 相手が1つに定まらなくてよい場所（passivesの対象。付いている子ごとに登録を配る、8.1節）。 */
  get withBroadcast(): ReferenceScope {
    return new ReferenceScope(
      this.hasSelf,
      this.hasAgent,
      this.hasInstrument,
      this.hasPicked,
      this.namesProperty,
      true,
    );
  }

  /**
   * rootがこの場所で解決先を持たない理由（**この場所に何が無いか**）。持つならundefined。
   * 呼び出し側は、どこの宣言かを添えてロード時エラーにする。
   */
  unresolvableReason(root: ReferenceRoot): string | undefined {
    switch (root) {
      case 'self':
      case 'parent':
        return this.hasSelf ? undefined : 'ここには宣言元の個体が居ません';
      case 'agent':
        return this.hasAgent ? undefined : 'ここは誰かが操作している場面とは限りません';
      case 'instrument':
        return this.hasInstrument ? undefined : 'ここには働きかけに使われる物が運ばれてきません';
      case 'picked':
        return this.hasPicked ? undefined : "'picked'はamongを書いた候補の中でのみ使えます";
      case 'ancestor':
        if (!this.hasSelf) return 'ここには遡る起点になる個体が居ません';
        return this.namesProperty
          ? undefined
          : 'ancestorはプロパティ名で祖先を探すので、オブジェクトそのものを指す場所では使えません';
      case 'child':
        return this.broadcasts
          ? undefined
          : "ここは相手が1つに決まる場所なので、どの子かが定まらない'child'は使えません";
    }
  }
}

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
   * （11.5節）。
   */
  | 'instrument'
  /**
   * 働きかけられる参加者。**操作の宣言が乗っている側**なので、操作の宣言の中では`self`と同じ物になり、
   * そこでは書けない（11.5節。どこで書けるかはReferenceScope）。
   */
  | 'patient'
  /**
   * `among`（10.3節）が周りから選んだ相手。**候補ごとに束ね直される**ので、重みを解くときは
   * その候補、効果を当てるときは選ばれた1つを指す。amongを書いた候補の中でのみ意味を持つ。
   */
  | 'picked'
  /**
   * selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（WorldObject.findAncestorWithProperty
   * 参照）。**探すのにプロパティ名が要る唯一のroot**で、それが決まらない場所では解決先を持たない
   * （ReferenceScope.namesProperty）。
   */
  | 'ancestor';

/** 操作の関係が持つ3つの役（11.5節）。**役の名前の唯一の一覧**で、数え上げる側はここから引く。 */
export const INTERACTION_ROLES = ['agent', 'instrument', 'patient'] as const;

/** 操作の関係が用意する役（INTERACTION_ROLESの要素）。 */
export type InteractionRole = (typeof INTERACTION_ROLES)[number];

/**
 * 1つの操作が結んでいる、参加者どうしの関係（GameElementDefinition.md 11.5節）。
 *
 * **関係は世界に刻む。** 張っている間、参加者は自分がどの操作に参加しているかを知り、その`props`
 * （`base`・`passives`）から役を指せる——道の所要時間が「今歩いている人の遅れ」を土台にできるのは、
 * 条件の判定も所要時間の問い合わせも効果の適用も、同じ関係を張った状態で行うからで、片方だけで
 * 張ると押す前に見せる分数と実際に進む分数がずれる。
 *
 * **張るのも外すのもここだけ**（`during`）。呼び出し側は「この関係の下で読む／実行する」と頼むだけで、
 * 張り忘れ・外し忘れを覚えておく必要がない。
 */
export class InteractionRelation {
  /** 働きかけられる物（11.5節）。操作の宣言が乗っている側で、宣言の中では`self`と同じ物を指す。 */
  readonly patient: WorldObject | undefined;

  /** この操作で動いている個体。誰かが動いているとは限らない場面（レシピの解放条件）では居ない。 */
  readonly agent: WorldObject | undefined;

  /** 運ばれてきて働きかけに使われる物。それを伴わない操作では居ない（11.5節）。 */
  readonly instrument: WorldObject | undefined;

  constructor(
    patient: WorldObject | undefined,
    agent: WorldObject | undefined,
    instrument: WorldObject | undefined,
  ) {
    this.patient = patient;
    this.agent = agent;
    this.instrument = instrument;
  }

  /** roleに就いている物。就いている物が居なければundefined。 */
  objectAt(role: InteractionRole): WorldObject | undefined {
    switch (role) {
      case 'agent':
        return this.agent;
      case 'instrument':
        return this.instrument;
      case 'patient':
        return this.patient;
    }
  }

  /** selfを起点に、この関係の役を解決する文脈。 */
  contextFor(self: WorldObject | undefined): ReferenceContext {
    return ReferenceContext.withRoles(self, this.agent, this.instrument, this.patient);
  }

  /**
   * この関係を張った状態でbodyを実行し、**必ず外してから**返す（11.5節「1つずつ張って外す」）。
   * bodyへ渡す文脈の起点は`patient`——操作の宣言が乗っている側がそのままselfになる。
   *
   * 押す前に見せるための問い合わせ（条件・所要時間）がこれ。**動作そのものではない**ので、
   * agentが動いていると主張しない——実行中の操作の傍らで別の候補の分数を引くことは起こる。
   */
  during<T>(body: (context: ReferenceContext) => T): T {
    return this.bound(false, body);
  }

  /**
   * 実行として関係を張る。**同じ物が2つの操作のagentになることはない**（11.5節の不変条件。動作主は
   * 一度に1つの動作しかできない）ので、既に動いている個体をagentにしようとすればその場で止まる。
   */
  whileActing<T>(body: (context: ReferenceContext) => T): T {
    return this.bound(true, body);
  }

  private bound<T>(claimsAgent: boolean, body: (context: ReferenceContext) => T): T {
    const leaves: (() => void)[] = [];
    try {
      for (const [participant, isAgent] of this.participants())
        leaves.push(participant.joinInteraction(this, claimsAgent && isAgent));
      return body(this.contextFor(this.patient));
    } finally {
      while (leaves.length > 0) leaves.pop()!();
    }
  }

  /**
   * 関係を刻む相手を1つずつ（同じ物が2つの役に就く再帰的な操作、11.5節では1回だけ）。
   * **agentを先頭に置く**ので、一意性が破れているときは他の誰も加わらないうちに止まる。
   */
  private participants(): readonly (readonly [WorldObject, boolean])[] {
    const joined: (readonly [WorldObject, boolean])[] = [];
    for (const role of INTERACTION_ROLES) {
      const participant = this.objectAt(role);
      if (participant === undefined || joined.some(([already]) => already === participant)) continue;
      joined.push([participant, participant === this.agent]);
    }
    return joined;
  }
}

/**
 * 宣言に書かれたReferenceRootを実行時のオブジェクトへ解くための、**どの役に誰が居るか**という文脈
 * （その場所がどの役を用意できるかはReferenceScopeが持つ）。
 *
 * 参照を持つ側はこれを組み立てず、受け取ったものをそのまま下へ渡す。**組み立てるのは「誰がこの行動を
 * しているか」を知っている一番外側だけ**で、途中の誰も中身をばらして持ち回らない。
 *
 * ancestorはここでは解けない——「参照先のプロパティを定義している最初の祖先」なので、探すプロパティを
 * 知っている側（PropertyPath）でしか決まらない。
 */
export class ReferenceContext {
  /** この文脈のself。効果の宣言元であり、parent・ancestorはここから辿る。 */
  readonly self: WorldObject | undefined;

  /** この操作をしている者。誰かが操作しているとは限らない文脈（forSelf）ではundefined。 */
  readonly agent: WorldObject | undefined;

  /** この操作で働きかけに使われる物。それを伴わない操作ではundefined（11.5節）。 */
  readonly instrument: WorldObject | undefined;

  /** この操作で働きかけられる物。操作の外（rangeイベント等）ではundefined（11.5節）。 */
  readonly patient: WorldObject | undefined;

  /** `among`が周りから選んだ相手。amongを書いた候補の中でのみ居る（10.3節）。 */
  readonly picked: WorldObject | undefined;

  private constructor(
    self: WorldObject | undefined,
    agent: WorldObject | undefined,
    instrument: WorldObject | undefined,
    patient: WorldObject | undefined,
    picked: WorldObject | undefined,
  ) {
    this.self = self;
    this.agent = agent;
    this.instrument = instrument;
    this.patient = patient;
    this.picked = picked;
  }

  /**
   * selfだけが決まっている文脈（ReferenceScope.declaration）。操作の役は解決先を持たない——
   * rangeイベント（6.3節）は操作ではなく値が端に着いた瞬間への反応なので、selfが今どれかの操作に
   * 参加していても役は見えない（11.5節）。
   */
  static forSelf(self: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(self, undefined, undefined, undefined, undefined);
  }

  /**
   * 参加者のprops（`base`・`passives`、ReferenceScope.participantProps）を読む文脈。役は、selfが今
   * 参加している関係（世界に刻まれている、InteractionRelation）から解ける。参加していなければ
   * forSelfと同じで、役はどれも解決先を持たない。
   */
  static forParticipant(self: WorldObject | undefined): ReferenceContext {
    const relation = self?.participation;
    return relation === undefined ? ReferenceContext.forSelf(self) : relation.contextFor(self);
  }

  /**
   * 操作ではないが、問う側がagentを渡す場所（レシピの解放条件・`crafting_conditions`、13.3・13.4節）。
   * **関係は張らない**——「誰にとって解放されているか」を問う判定であって、誰も何にも働きかけていない
   * （11.5節）。成果物のインスタンスがまだ無いのでselfも居ない。
   */
  static asking(agent: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(undefined, agent, undefined, undefined, undefined);
  }

  /** 3役が揃った文脈。組み立てられるのは関係を持っている側だけ（InteractionRelation.contextFor）。 */
  static withRoles(
    self: WorldObject | undefined,
    agent: WorldObject | undefined,
    instrument: WorldObject | undefined,
    patient: WorldObject | undefined,
  ): ReferenceContext {
    return new ReferenceContext(self, agent, instrument, patient, undefined);
  }

  /** instrumentだけを差し替えた文脈。同じ操作を候補ごとに引き直す場面で使う（TransferEffect.acceptedCount）。 */
  withInstrument(instrument: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(this.self, this.agent, instrument, this.patient, this.picked);
  }

  /** pickedだけを差し替えた文脈。amongが候補ごとに重みを引き、選んだ1つへ効果を当てるときに使う。 */
  withPicked(picked: WorldObject | undefined): ReferenceContext {
    return new ReferenceContext(this.self, this.agent, this.instrument, this.patient, picked);
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
      case 'patient':
        return this.patient;
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
 * 宣言が置かれた場所が、参照の解決に何を用意できるか（GameElementDefinition.md 14.1節。操作の3役に
 * ついては同11.5節「役を書ける場所」）。
 *
 * **ロード時に弾く根拠と、実行時に組む`ReferenceContext`は同じ1つの事実。** agentが居ない場所で
 * agentを指せてしまうと、書けたのに実行時は必ず空振りする。だから場所ごとに許すrootを数え上げるのでは
 * なく、**場所は自分が何を持つかだけを宣言し、rootの側が何を要るかを言う**。両者の食い違いは、
 * 一覧を書き写す代わりに導出で消える。
 *
 * **下のstaticは11.5節の表の行と1対1ではない。** 持つものが同じ場所は同じstaticを使う——`drag`と
 * `put_in`は`acting.withInstrument`を共有し、`declaration`は表に無い`resists`（7.13節）も担う。
 * 表の行ごとにstaticを立てると、数え上げをこちら側で作り直すことになる。
 */
export class ReferenceScope {
  /** 宣言元の個体（self）が居るか。parent・ancestorもここから辿るので、無ければ揃って解けない。 */
  private readonly hasSelf: boolean;

  /** 操作している者（agent）が居るか。誰かが操作しているとは限らない場所には居ない。 */
  private readonly hasAgent: boolean;

  /** 働きかけに使われる物（instrument）が居るか。真になるのは物が運ばれてくる場所だけ（下のwithInstrument）。 */
  private readonly hasInstrument: boolean;

  /** 働きかけられる物（patient）が居るか。操作の場と、その参加者のpropsだけ（11.5節）。 */
  private readonly hasPatient: boolean;

  /**
   * その patient が宣言元（self）と同じ物か。**操作の宣言はpatientに乗る**（11.5節）ので、操作の宣言の
   * 中では必ず真になり、そこでは`patient`と書けない——同じ物に2つの名前が付くと、読む側は毎回どちらが
   * 正かを考えることになる。参加者のpropsでは宣言元がどの役に就くかが静的に決まらないので偽。
   */
  private readonly selfIsPatient: boolean;

  /**
   * 押すのが可逆な寄与か（`modify`、8.3節）。寄与は相手の上で合計されて誰の分か見分けられなくなるので、
   * **同時に2つの操作へ就きうる役**（`instrument`・`patient`）へは押せない。`agent`は1つの操作に1人しか
   * 居ないので混ざらない。
   */
  private readonly pushesReversibly: boolean;

  /** amongが選んだ相手（picked）が居るか。amongを書いた候補の中だけ（10.3節）。 */
  private readonly hasPicked: boolean;

  /** 参照先のプロパティ名が決まっているか。ancestorはそれで祖先を探すので、無ければ解けない。 */
  private readonly namesProperty: boolean;

  /** 相手が1つに定まらなくてよいか。childを指せるのはここが真の場所だけ（8.1節のブロードキャスト登録）。 */
  private readonly broadcasts: boolean;

  private constructor(available: ScopeFacts) {
    this.hasSelf = available.hasSelf;
    this.hasAgent = available.hasAgent;
    this.hasInstrument = available.hasInstrument;
    this.hasPatient = available.hasPatient;
    this.selfIsPatient = available.selfIsPatient;
    this.pushesReversibly = available.pushesReversibly;
    this.hasPicked = available.hasPicked;
    this.namesProperty = available.namesProperty;
    this.broadcasts = available.broadcasts;
  }

  /** 宣言元の個体だけが居る場所（`on_max`/`on_min` 6.3節・`resists` 7.13節）。操作ではないので役は居ない。 */
  static readonly declaration = new ReferenceScope({
    hasSelf: true,
    hasAgent: false,
    hasInstrument: false,
    hasPatient: false,
    selfIsPatient: false,
    pushesReversibly: false,
    hasPicked: false,
    namesProperty: true,
    broadcasts: false,
  });

  /**
   * 参加者のprops（`base` 6.5節・`passives` 8節）。**3役とも書ける**——そこには「宣言元がどの役に就くか」
   * を静的に決めるものが無いので、`patient`も`self`の言い換えにはならない（11.5節）。
   */
  static readonly participantProps = new ReferenceScope({
    hasSelf: true,
    hasAgent: true,
    hasInstrument: true,
    hasPatient: true,
    selfIsPatient: false,
    pushesReversibly: false,
    hasPicked: false,
    namesProperty: true,
    broadcasts: false,
  });

  /**
   * 宣言元の個体に加えて、操作している者が居る場所（誰かが押した・引いた結果として起きる、11節）。
   *
   * **操作の宣言はpatientに乗る**（11.5節）ので、patientが居るのはここから。ただし`self`と同じ物を
   * 指すので名前としては書けない（selfIsPatient）。使う物が運ばれてくるかは場所ごとに違うので、
   * そちらだけを`withInstrument`が足す。
   */
  static readonly acting = new ReferenceScope({
    hasSelf: true,
    hasAgent: true,
    hasInstrument: false,
    hasPatient: true,
    selfIsPatient: true,
    pushesReversibly: false,
    hasPicked: false,
    namesProperty: true,
    broadcasts: false,
  });

  /**
   * 操作者だけが居る場所（レシピの条件）。操作ではなく「誰にとって解放されているか」を問う判定なので、
   * 問う側が渡すのはagentだけ（11.5節・13.3節）。宣言元が居ない理由は書ける場所ごとに違うので、
   * 13.3・13.4節が各々で述べる。
   */
  static readonly recipeUnlock = new ReferenceScope({
    hasSelf: false,
    hasAgent: true,
    hasInstrument: false,
    hasPatient: false,
    selfIsPatient: false,
    pushesReversibly: false,
    hasPicked: false,
    namesProperty: true,
    broadcasts: false,
  });

  /**
   * プロパティ名を伴わず、オブジェクトそのものを指す場所。プロパティ名で祖先を探すancestorが、
   * ここでは解決先を持たなくなる。
   */
  get withoutPropertyName(): ReferenceScope {
    return new ReferenceScope({ ...this, namesProperty: false });
  }

  /**
   * 可逆な寄与（`modify`、8.3節）を押す場所。**同時に2つの操作へ就きうる役へは押せない**——寄与は
   * 相手の上で合計され、読んだ側は誰の寄与かを見分けられないので、混ざると戻せなくなる。
   */
  get pushingReversibly(): ReferenceScope {
    return new ReferenceScope({ ...this, pushesReversibly: true });
  }

  /** 働きかけに使われる物が運ばれてくる場所（`drag`のinteractions 12節・`put_in`の`duration` 7.10節）。 */
  get withInstrument(): ReferenceScope {
    return new ReferenceScope({ ...this, hasInstrument: true });
  }

  /** amongが選んだ相手を指せる場所（10.3節）。amongを書いた候補の重みと効果だけがこれになる。 */
  get withPicked(): ReferenceScope {
    return new ReferenceScope({ ...this, hasPicked: true });
  }

  /** 相手が1つに定まらなくてよい場所（passivesの対象。付いている子ごとに登録を配る、8.1節）。 */
  get withBroadcast(): ReferenceScope {
    return new ReferenceScope({ ...this, broadcasts: true });
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
        if (!this.hasInstrument) return 'ここには働きかけに使われる物が運ばれてきません';
        return this.sharedRoleReason;
      case 'patient':
        if (!this.hasPatient) return 'ここには働きかけられる物が居ません';
        // 居るが書けない側（11.5節の表の`✕`）。理由が「居ないから」ではないので、文面を分ける。
        if (this.selfIsPatient)
          return "'patient'は操作の宣言が乗っている側なので、ここでは'self'と同じ物を指します（'self'と書いてください）";
        return this.sharedRoleReason;
      case 'picked':
        return this.hasPicked ? undefined : 'ここには候補の中から選ばれた相手が居ません';
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

  /**
   * 複数の操作に同時に就きうる役（`instrument`・`patient`）を、この場所が拒む理由。拒まないならundefined。
   * 拒むのは可逆な寄与を押す場所だけ（8.3節）。
   */
  private get sharedRoleReason(): string | undefined {
    return this.pushesReversibly
      ? '可逆な寄与は、複数の操作に同時に就きうる役へは押せません（8.3節。誰の寄与かを見分けられなくなります）'
      : undefined;
  }
}

/** ReferenceScopeが持つ事実の一式。増やしたら全ての場所が答えることになる（数え上げの逆）。 */
interface ScopeFacts {
  readonly hasSelf: boolean;
  readonly hasAgent: boolean;
  readonly hasInstrument: boolean;
  readonly hasPatient: boolean;
  readonly selfIsPatient: boolean;
  readonly pushesReversibly: boolean;
  readonly hasPicked: boolean;
  readonly namesProperty: boolean;
  readonly broadcasts: boolean;
}

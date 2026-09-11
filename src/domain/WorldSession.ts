import type { WorldCodex } from './WorldCodex';
import { randomRng } from './Rng';
import type { Rng } from './Rng';
import type { World } from './wrappers/World';
import type { PropertyDef } from './PropertyDef';
import type { PropertyValue } from './PropertyValue';
import type { InteractionGains, PropertyGain } from './PropertyGain';
import type { PassiveEffects } from './PassiveEffects';
import type { Slot } from './Slot';
import type { WorldChange } from './WorldChange';
import type { WorldSignal } from './WorldSignal';
import type { Action } from './Interaction';
import type { ReferenceContext } from './ReferenceRoot';
import { WorldObject } from './WorldObject';
import { EffectiveValueReading } from './EffectiveValueReading';
import { Scoped } from '../util/scoped';
import type { ObjectGlobalId } from './GlobalId';

/**
 * 1セッション分の実行時状態。WorldCodexはロード後不変な定義の集合であり続けるため、instance IDの発行という
 * 可変な状態はここに持たせる。スロット移動はWorldObject.moveToSlotOrRejectionが自分自身の責務として行うため、ここでは
 * 仲介しない。
 *
 * **観測口（observe*）はどれも同じ約束を持つ。**
 *
 * - 観測できるのはbodyの実行中に起きた分だけで、溜め置きはしない。
 * - 解除もobserve*が行う（呼び出し側に外し忘れる余地を残さない、Scoped）。
 * - **読み取り専用。** 受け取ったコールバックから世界を変えてはならない。
 *
 * 分かれているのは運ぶものが違うからで、何を運ぶかは各メソッドが言う。
 */
export class WorldSession {
  readonly codex: WorldCodex;

  private _world: World | undefined;
  get world(): World | undefined {
    return this._world;
  }

  /** pick（10節）の重み付き抽選に使う乱数源。テストで決定的に振る舞わせられるよう、コンストラクタで差し替え可能。 */
  readonly rng: Rng;

  private nextInstanceId = 1;

  /**
   * 実効値（8.3節）の読み取りの区切り。世界の状態ではなく計算の途中を区切るものなので、使うのも
   * いつ区切るかを決めるのもPropertyValueだけ。
   */
  readonly effectiveValueReading = new EffectiveValueReading();

  /**
   * 観測口と、今の適用の文脈。**どれも「bodyの実行中だけ差し替わる値」**（Scoped）なので、
   * 挿して抜くところは各メソッドに書かない——戻し忘れる余地が無いことは、Scopedが1箇所で保証する。
   */
  private readonly tickObserver = new Scoped<() => void>();
  private readonly changeObserver = new Scoped<(change: WorldChange) => void>();
  private readonly signalObserver = new Scoped<(signal: WorldSignal) => void>();
  private readonly gainObserver = new Scoped<(gains: InteractionGains) => void>();

  /**
   * 今、1つの操作を実行している最中か（withInteractionGains）。ここに居る間の書き込みだけを
   * 溜める。undefinedなら溜めない＝操作の外で回ったtickや、rangeイベントから走る効果は入らない。
   */
  private readonly gainsBeingGathered = new Scoped<Map<string, PropertyGain>>();

  /**
   * 今、時間の経過（runTick）の中か。**ここでの実体値への書き込みは、操作が直に増やしたものでは
   * ない**（PropertyGain）——値を動かしているのは経過そのもので、輸送も端のクランプも同じ。
   * その中で始まった別の操作は自分の稼ぎを持つので、withInteractionGainsが降ろす。
   */
  private readonly insideTick = new Scoped<boolean>();

  /**
   * 今のtickで動いたぶんが操作の稼ぎになるプロパティ（countTickMovementAsGain）。tickを回す手前で、
   * その操作が宣言した持続効果（11.7節）が対象を名乗って並べる。
   */
  private readonly tickGainTargets = new Scoped<Set<PropertyValue>>();

  /**
   * 今効いている、操作が宣言した持続効果（11.7節）と、その宣言元、そして**その操作の関係が用意した
   * 文脈**。`duration`を進めている間だけ並ぶ。**経過中のtickで、そのぶんだけを操作の稼ぎとして拾う**
   * ための控え（countTickMovementAsGain）であり、**宣言元がbecomeしたときに登録を張り直す先**でもある
   * （setInteractionPassivesRegistered）。
   *
   * **文脈を憶えるのは、役の解決先が宣言元の今の参加から決まらないから**（11.5節）。宣言元が経過中に
   * 別の関係へも加わると、そちらが役を解く関係になる（WorldObject.participation）ので、辿り直しでは
   * この操作の役に戻れない。
   *
   * **1つではなく積む。** 経過中のtickは手番を配り、その手番も操作なのでここへ乗る（入れ子）。
   * 内側だけを持つと、外側のぶんは登録されたまま辿れなくなる。
   */
  private readonly runningInteractionPassives: {
    owner: WorldObject;
    context: ReferenceContext;
    passives: PassiveEffects;
  }[] = [];

  /** 今どのオブジェクトの効果を適用しているか（withSubject）。記録する変化の主体になる。 */
  private readonly subject = new Scoped<WorldObject>();

  /** 実行中のまとまりの深さ（runToSeam）。0へ戻ったところが操作の切れ目。 */
  private seamDepth = 0;

  /**
   * 時間の中では起こせず、操作の切れ目を待っている手番（`trigger: tick`、11.1節）。**時間を要する
   * 手番は、配られたその場では起こせない**——手番を配るのは時間を進めている最中で、そのとき動作主は
   * 時間を進めている操作にまだ就いている（GameElementDefinition.md 11.5節の不変条件）。
   */
  private waitingTurns: Action[] = [];

  /** 待っていた手番を起こしている最中か。この間に挙がった待ちは受け取らない（takeWaitingTurns）。 */
  private takingWaitingTurns = false;

  constructor(codex: WorldCodex, world?: World, rng?: Rng) {
    this.codex = codex;
    this._world = world;
    this.rng = rng ?? randomRng();
  }

  /**
   * worldを後から結び付ける。**worldインスタンス自身をこのセッションで生成するための唯一の道**——
   * WorldObjectの生成にはセッションが要る（初期値のロールにrngを使う）のに、World付きのセッションは
   * そのworldインスタンスを要る、という相互依存をここで断つ。
   *
   * 結び付けは一度だけ。2回目は、既にそのworldで動き出したオブジェクトが居るはずなので拒む。
   */
  adoptWorld(world: World): void {
    if (this._world !== undefined) throw new Error('WorldSessionのworldは1度しか結び付けられません。');
    this._world = world;
  }

  /** 指定したObjectDefの新しいWorldObjectを生成する（spawn、9.4節）。まだどこにも配置されていないため、呼び出し側がmoveToSlotOrRejectionで配置する。 */
  createObject(objectDefGlobalId: ObjectGlobalId): WorldObject {
    const def = this.codex.objects.get(objectDefGlobalId);
    return new WorldObject(this.nextInstanceId++, def, this);
  }

  /**
   * bodyの実行中にtickが回るたび、その直後にonTickを呼ぶ。呼ばれた時点で世界はそのtick境界の時刻に
   * 居るので、UI層は「その瞬間の世界」を読み取れる（時間経過の再現、PlayScene参照）。
   */
  observeTicks(onTick: () => void, body: () => void): void {
    this.tickObserver.during(onTick, body);
  }

  /**
   * bodyの実行中に物が出入りするたび、その1件ずつをonChangeへ流す（WorldChange参照）。
   *
   * **これは「何が起きたか」だけを運ぶ。** 起きた結果どう見えるかは、そのtick境界の世界を読み直す側
   * （PlayScene.runAndRecord）の仕事で、両方が要る——ログだけでは絵にならず、絵だけでは誰がやったか分からない。
   */
  observeChanges(onChange: (change: WorldChange) => void, body: () => void): void {
    this.changeObserver.during(onChange, body);
  }

  /**
   * bodyの実行中に告げられた出来事を、その1件ずつをonSignalへ流す（WorldSignal参照）。どの告げ方で
   * 宣言されたものも、この1つの口を通る。
   *
   * **物の出入りとは別の観測口にする。** 出入りは世界の形が変わったことで、こちらは形が変わらない
   * ままの出来事なので、同じログに混ぜると受け取る側が毎回どちらかを選り分けることになる。
   */
  observeSignals(onSignal: (signal: WorldSignal) => void, body: () => void): void {
    this.signalObserver.during(onSignal, body);
  }

  /**
   * bodyの実行中に操作が直に増やした値を、操作1回ぶんまとめてonGainsへ流す（PropertyGain参照）。
   *
   * **1件ずつではなく1回ぶんをまとめて流す。** 同じ値へ複数回書く効果があり（胃へ足したぶんが
   * 溢れて戻る）、途中の書き込みを個別に流すと、受け取る側が足し合わせ直すことになる。
   */
  observeGains(onGains: (gains: InteractionGains) => void, body: () => void): void {
    this.gainObserver.during(onGains, body);
  }

  /**
   * bodyを「sourceが宣言した操作1回」として囲う（InteractionDefが、実行のはじめから終わりまでを
   * 囲う）。ここに居る間に操作が増やした値だけがobserveGainsへ流れる——経過中のtickが動かした値は
   * 入らず（insideTick）、その操作が宣言した持続効果が動かしたぶんだけが入る（recordTickMovement）。
   *
   * 溜めたぶんは抜けるときに流す。**入れ子になる**——経過中のtickが配った手番（動物の1手）は
   * その中で実行され、自分の稼ぎを自分の溜め場へ持つ。
   */
  withInteractionGains<T>(source: WorldObject, body: () => T): T {
    // 出どころは適用前に控える（InteractionGains.sourceAndAncestors）。飲み干した水は適用し終えた時点で
    // 世界から出ていて、そこからでは親を辿れない。
    const chain: WorldObject[] = [];
    for (let object: WorldObject | undefined = source; object !== undefined; object = object.parent)
      chain.push(object);

    // **溜めるのは差し替えの中、流すのは戻った後。** 溜め場が外側のものへ戻ってから流さないと、
    // 受け取った側がこの中で世界を読むときに、まだ内側の溜め場を指したままになる。
    const gathered = new Map<string, PropertyGain>();
    let result!: T;
    try {
      this.gainsBeingGathered.during(gathered, () =>
        this.insideTick.during(false, () => {
          result = body();
        }),
      );
    } finally {
      const gains = [...gathered.values()].filter((gain) => gain.amount > 0);
      if (gains.length > 0) this.gainObserver.current?.({ sourceAndAncestors: chain, gains });
    }
    return result;
  }

  /**
   * 操作が宣言した持続効果（11.7節）が効いている間としてbodyを実行する。登録はその一式が持ち
   * （PassiveEffects.setAllRegistered）、こちらは効いている間のぶんを積んで持つ。
   *
   * `context`はその操作の関係が用意した文脈（InteractionRelation.contextFor）。**役はここから解く**
   * ——理由はrunningInteractionPassives。
   */
  whileInteractionPassives<T>(
    owner: WorldObject,
    context: ReferenceContext,
    passives: PassiveEffects,
    body: () => T,
  ): T {
    this.runningInteractionPassives.push({ owner, context, passives });
    try {
      passives.setAllRegistered(owner, context, true);
      return body();
    } finally {
      passives.setAllRegistered(owner, context, false);
      this.runningInteractionPassives.pop();
    }
  }

  /**
   * declarerが宣言元になっている、経過中の操作の持続効果（11.7節）の登録を、対象を問わずまとめて
   * 外す/載せ直す。
   *
   * **この登録を辿れるのはここだけ。** 宣言しているのは物ではなく操作で、効いている間そのdefを
   * 持っているのはこのセッションなので、物のdefからは見つからない。
   *
   * **載る先は宣言元とは限らない**（役を対象にできる、11.5節）ので、誰の型が変わったときに呼ぶかを
   * 決めるのは呼ぶ側（WorldObject.setInteractionPassivesOfParticipantsRegistered）。
   */
  setInteractionPassivesRegistered(declarer: WorldObject, register: boolean): void {
    for (const running of this.runningInteractionPassives)
      if (running.owner === declarer) running.passives.setAllRegistered(declarer, running.context, register);
  }

  /**
   * 実体値への書き込み1件を溜める（PropertyValue.addからのみ呼ぶ）。操作を実行している間
   * （withInteractionGains）の、**時間の経過の外**での書き込みだけを数える。
   */
  recordGain(object: WorldObject, property: PropertyDef, delta: number): void {
    if (this.insideTick.current === true) return;
    this.gather(object, property, delta);
  }

  /**
   * このtickでpropertyが動いたぶんを、今の操作の稼ぎとして数える（PropertyPassiveEffectが、積分の
   * 手前で自分の対象を名乗る）。名乗れるのは今の操作が宣言した持続効果（11.7節）だけ。
   */
  countTickMovementAsGain(property: PropertyValue): void {
    this.tickGainTargets.current?.add(property);
  }

  /**
   * このtickで実体値が動いたぶんを溜める（PropertyValue.tickからのみ呼ぶ）。**時間の経過の中で
   * 起きるのに操作の稼ぎになる唯一のもの**なので、recordGainとは別の口で受ける。
   *
   * **受け取るのは、その値へ同じtickに入る`add`をまとめ、端のクランプまで済ませた後の正味。**
   * 数え先かどうかは名乗り（countTickMovementAsGain）が決めるが、数える量は宣言した量ではなく
   * 動いた量で、荷や痛みが同じtickで削ったぶんはそこから引かれている。
   */
  recordTickMovement(property: PropertyValue, delta: number): void {
    if (this.tickGainTargets.current?.has(property) !== true) return;
    this.gather(property.owner, property.def, delta);
  }

  private gather(object: WorldObject, property: PropertyDef, delta: number): void {
    const gathered = this.gainsBeingGathered.current;
    if (gathered === undefined) return;

    const key = `${object.instanceId}:${property.globalId}`;
    const found = gathered.get(key);
    gathered.set(key, { object, property, amount: (found?.amount ?? 0) + delta });
  }

  /**
   * bodyの実行中に起きた変化の主体をsubjectにする（WorldObject.applyActiveEffectが囲う）。
   *
   * 入れ子は内側が勝つ。効果の適用中に別のオブジェクトのrangeイベントが走れば、そこで起きた変化は
   * そのオブジェクトのものになる（治りきった怪我が自分を消すのは、殴った側の仕業ではない）。
   */
  withSubject(subject: WorldObject, body: () => void): void {
    this.subject.during(subject, body);
  }

  /**
   * 物の出入り1件を観測口へ流す（WorldObjectの配置の関門からのみ呼ぶ）。主体は今適用中の効果から
   * 決まるので、呼び出し側は渡さない——「誰の仕業か」を各関門が覚えて回す形にすると、増えた関門が
   * 渡し忘れる。
   *
   * 観測していなければ何もしない。世界に出入りが無い呼び出し（未配置のまま消えた物）も流さない。
   */
  runAndRecordChange(object: WorldObject, from: Slot | undefined, to: Slot | undefined): void {
    const observer = this.changeObserver.current;
    if (observer === undefined || (from === undefined && to === undefined)) return;
    observer({ object, subject: this.subject.current, from, to });
  }

  /**
   * 形を変えない出来事1件を観測口へ流す（SignalEffectからのみ呼ぶ）。**誰の身に起きたかは効果が
   * 指した対象**で、物の出入りの主体（今適用中の効果、runAndRecordChange）とは別に決まる——殴って外した
   * 出来事は、殴った側ではなく殴られた側の上のことになる。
   */
  recordSignal(object: WorldObject, name: string): void {
    this.signalObserver.current?.({ name, object });
  }

  /**
   * bodyを、**抜けたところを操作の切れ目にする1つのまとまり**として走らせる（ActionSystem.md 2節）。
   * 時間の中では起こせなかった手番（deferTurn）を、抜けたところで起こす。
   *
   * **まとまりを名乗るのは、操作を実行として張る側**（`InteractionRelation.whileActing`）
   * ——操作（actions/combinations・製作の1工程・枠へ入れる）はどれもそこを通るので、操作を書く側が
   * 囲いを覚えておく必要は無い。操作でないのに囲うのは**操作の外で起きる時間の進行**
   * （advanceWorldTime）で、待たせた手番を無関係な次の操作まで持ち越さないため。
   *
   * 入れ子の内側では起こさない——外側のまとまりがまだ続いていて、動作主はそちらに就いたままだから
   * （GameElementDefinition.md 11.5節）。
   */
  runToSeam<T>(body: () => T): T {
    this.seamDepth++;
    try {
      return body();
    } finally {
      this.seamDepth--;
      if (this.seamDepth === 0) this.takeWaitingTurns();
    }
  }

  /**
   * 時間を要する手番を、操作の切れ目まで待たせる（Action.takeTurn）。
   *
   * **同じ物の同じ手番は1つしか待たせない。** 限界に居る間は毎tick同じ手番が挙がるが、起こすのは
   * 切れ目に1度でよい。
   *
   * **待ちを起こしている最中に挙がったものは、手番の別を問わず落とす**（理由はtakeWaitingTurns）。
   */
  deferTurn(turn: Action): void {
    if (this.takingWaitingTurns) return;
    if (this.waitingTurns.some((waiting) => waiting.isSameTurnAs(turn))) return;
    this.waitingTurns.push(turn);
  }

  /**
   * 待っていた手番を、宣言の順に起こす。要件（14節）は起こす時点で引き直されるので、待っている間に
   * 限界を抜けた手番はそこで落ちる。
   *
   * **起こしている最中に挙がった待ちは、手番の別を問わず落とす**（deferTurn）。起こした手番自身も
   * 時間を進めるので、その間にまた同じ手番が挙がることも（一度の強制では限界を抜けられなかった場合）、
   * 別の値が尽きて違う手番が挙がることもある。どちらもここで受け取ると切れ目から抜けられないので、
   * 次に時間が動いたときの待ちとして拾い直す。
   */
  private takeWaitingTurns(): void {
    if (this.waitingTurns.length === 0) return;

    const turns = this.waitingTurns;
    this.waitingTurns = [];
    this.takingWaitingTurns = true;
    try {
      for (const turn of turns) if (turn.actorIsInWorld) turn.tryExecute();
    } finally {
      this.takingWaitingTurns = false;
    }
  }

  /**
   * ゲーム内時間をamount分だけ進める。tick境界（World.minutesUntilTick）を跨ぐたびに、その境界まで
   * 時計を進めてtick()を1回実行する。
   *
   * 呼び出しを刻んでも結果は変わらない（次の境界までを時計から読み直すため）。UI層はこれを利用して、
   * 一括で進めた経過をあとから刻んで見せる。
   *
   * **これ自身も1つのまとまりとして囲う**（runToSeam）。操作の中から呼ばれたぶんは入れ子になるので
   * 切れ目にならず、操作の外で時間が動いた場合だけ、進め終えたところが切れ目になる。
   */
  advanceWorldTime(amount: number): void {
    if (this.world === undefined) {
      throw new Error('advanceWorldTimeにはWorldを持つWorldSessionが必要です。');
    }

    const world = this.world;
    this.runToSeam(() => {
      const minutesPerTick = world.rawMinutesPerTick;
      const untilFirstTick = world.minutesUntilTick(1);

      if (amount < untilFirstTick) {
        world.addMinutes(amount);
        return;
      }

      const ticksToRun = 1 + Math.trunc((amount - untilFirstTick) / minutesPerTick);
      world.addMinutes(untilFirstTick);
      this.runTick(world);

      for (let i = 1; i < ticksToRun; i++) {
        world.addMinutes(minutesPerTick);
        this.runTick(world);
      }

      world.addMinutes(amount - untilFirstTick - (ticksToRun - 1) * minutesPerTick);
    });
  }

  /**
   * 1 tick分の世界の進行。値の積分（WorldObject.tick）のあとに、時間が起こす操作を配る
   * （`trigger: tick`、WorldObject.runTickActions）——動物が動くのは時間が経ったからで、
   * そのtickの値が出そろった後になる（HuntingSystem.md 5.2節）。
   *
   * 観測口（observeTicks）へ知らせるのは両方を終えてから。「そのtick境界の世界」には、
   * 動物がしたことも含まれている。
   */
  private runTick(world: World): void {
    this.insideTick.during(true, () => {
      this.tickGainTargets.during(new Set(), () => {
        // 稼ぎとして数える先は積分の前に名乗らせ、量は積分が終わってから受け取る
        // （recordTickMovement）——足す前に量を読むと、同じtickの他の寄与も端のクランプも
        // 引かれていない。**このtickを進めているのは一番内側**で、外側は自分のtickをこの中で
        // 回している最中なので、二重に数えない。
        const running = this.runningInteractionPassives.at(-1);
        if (running !== undefined)
          running.passives.countTickMovementsAsGains(running.owner, running.context, this);

        world.instance.tick();
      });
      world.instance.runTickActions();
    });
    this.tickObserver.current?.();
  }
}

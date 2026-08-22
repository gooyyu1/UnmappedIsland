import type { WorldCodex } from './WorldCodex';
import { randomRng } from './Rng';
import type { Rng } from './Rng';
import type { World } from './wrappers/World';
import type { PropertyDef } from './PropertyDef';
import type { InteractionGains, PropertyGain } from './PropertyGain';
import type { Slot } from './Slot';
import type { WorldChange } from './WorldChange';
import type { WorldSignal } from './WorldSignal';
import { WorldObject } from './WorldObject';

/**
 * 1セッション分の実行時状態。WorldCodexはロード後不変な定義の集合であり続けるため、instance IDの発行という
 * 可変な状態はここに持たせる。スロット移動はWorldObject.moveToSlotが自分自身の責務として行うため、ここでは
 * 仲介しない。
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

  /** tickを回した直後に呼ぶ観測口（observeTicks）。 */
  private tickObserver: (() => void) | undefined;

  /** 物の出入りを流す観測口（observeChanges）。 */
  private changeObserver: ((change: WorldChange) => void) | undefined;

  /** 形を変えない出来事を流す観測口（observeSignals）。 */
  private signalObserver: ((signal: WorldSignal) => void) | undefined;

  /** 操作そのものが増やした値を流す観測口（observeGains）。 */
  private gainObserver: ((gains: InteractionGains) => void) | undefined;

  /**
   * 今、操作の効果を適用している最中か（withInteractionEffect）。ここに居る間の書き込みだけを
   * 溜める。undefinedなら溜めない＝経過中のtickや、rangeイベントから走る効果は入らない。
   */
  private gathered: Map<string, PropertyGain> | undefined;

  /** 今どのオブジェクトの効果を適用しているか（withSubject）。記録する変化の主体になる。 */
  private subject: WorldObject | undefined;

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

  /** 指定したObjectDefの新しいWorldObjectを生成する（spawn、9.4節）。まだどこにも配置されていないため、呼び出し側がmoveToSlotで配置する。 */
  spawn(objectDefGlobalId: number): WorldObject {
    const def = this.codex.objects.get(objectDefGlobalId);
    return new WorldObject(this.nextInstanceId++, def, this);
  }

  /**
   * bodyの実行中にtickが回るたび、その直後にonTickを呼ぶ。呼ばれた時点で世界はそのtick境界の時刻に
   * 居るので、UI層は「その瞬間の世界」を読み取れる（時間経過の再現、PlayScene参照）。
   *
   * 観測の解除もここで行う（呼び出し側が外し忘れる余地を残さない）。読み取り専用の観測口なので、
   * onTickから世界を変えてはならない。
   */
  observeTicks(onTick: () => void, body: () => void): void {
    const outer = this.tickObserver;
    this.tickObserver = onTick;
    try {
      body();
    } finally {
      this.tickObserver = outer;
    }
  }

  /**
   * bodyの実行中に物が出入りするたび、その1件ずつをonChangeへ流す（WorldChange参照）。観測の解除も
   * ここで行う（observeTicksと同じく、呼び出し側に外し忘れの余地を残さない）。
   *
   * **これは「何が起きたか」だけを運ぶ。** 起きた結果どう見えるかは、そのtick境界の世界を読み直す側
   * （PlayScene.record）の仕事で、両方が要る——ログだけでは絵にならず、絵だけでは誰がやったか分からない。
   *
   * 観測できるのはbodyの実行中に起きた分だけで、溜め置きはしない。読み取り専用の観測口なので、
   * onChangeから世界を変えてはならない。
   */
  observeChanges(onChange: (change: WorldChange) => void, body: () => void): void {
    const outer = this.changeObserver;
    this.changeObserver = onChange;
    try {
      body();
    } finally {
      this.changeObserver = outer;
    }
  }

  /**
   * bodyの実行中に告げられた出来事（signal、9.8節）を、その1件ずつをonSignalへ流す（WorldSignal参照）。
   * 観測の解除もここで行う（observeChangesと同じく、呼び出し側に外し忘れの余地を残さない）。
   *
   * **物の出入りとは別の観測口にする。** 出入りは世界の形が変わったことで、こちらは形が変わらない
   * ままの出来事なので、同じログに混ぜると受け取る側が毎回どちらかを選り分けることになる。
   *
   * 観測できるのはbodyの実行中に起きた分だけで、溜め置きはしない。読み取り専用の観測口なので、
   * onSignalから世界を変えてはならない。
   */
  observeSignals(onSignal: (signal: WorldSignal) => void, body: () => void): void {
    const outer = this.signalObserver;
    this.signalObserver = onSignal;
    try {
      body();
    } finally {
      this.signalObserver = outer;
    }
  }

  /**
   * bodyの実行中に操作が直に増やした値を、操作1回ぶんまとめてonGainsへ流す（PropertyGain参照）。
   * 観測の解除もここで行う（observeChangesと同じく、呼び出し側に外し忘れの余地を残さない）。
   *
   * **1件ずつではなく1回ぶんをまとめて流す。** 同じ値へ複数回書く効果があり（胃へ足したぶんが
   * 溢れて戻る）、途中の書き込みを個別に流すと、受け取る側が足し合わせ直すことになる。
   */
  observeGains(onGains: (gains: InteractionGains) => void, body: () => void): void {
    const outer = this.gainObserver;
    this.gainObserver = onGains;
    try {
      body();
    } finally {
      this.gainObserver = outer;
    }
  }

  /**
   * bodyを「sourceが宣言した操作の効果の適用」として囲う（InteractionDefが、時間を進め終えてから
   * 囲う）。ここに居る間の書き込みだけがobserveGainsへ流れるので、時間経過で回ったtickの分は入らない。
   *
   * 溜めたぶんは抜けるときに流す。入れ子にはならない（効果の適用は操作1回につき1度）が、外側で
   * 溜めていた分を捨てないよう、退避して戻す形は他の観測口と揃える。
   */
  withInteractionEffect(source: WorldObject, body: () => void): void {
    const outer = this.gathered;
    this.gathered = new Map();

    // 出どころは適用前に控える（InteractionGains.source）。飲み干した水は適用し終えた時点で
    // 世界から出ていて、そこからでは親を辿れない。
    const chain: WorldObject[] = [];
    for (let object: WorldObject | undefined = source; object !== undefined; object = object.parent)
      chain.push(object);

    try {
      body();
    } finally {
      const gains = [...this.gathered.values()].filter((gain) => gain.amount > 0);
      this.gathered = outer;
      if (gains.length > 0) this.gainObserver?.({ source: chain, gains });
    }
  }

  /**
   * 実体値への書き込み1件を溜める（PropertyValue.addからのみ呼ぶ）。操作の効果を適用している間
   * （withInteractionEffect）でなければ何もしない。
   */
  recordGain(object: WorldObject, property: PropertyDef, delta: number): void {
    if (this.gathered === undefined) return;

    const key = `${object.instanceId}:${property.globalId}`;
    const found = this.gathered.get(key);
    this.gathered.set(key, { object, property, amount: (found?.amount ?? 0) + delta });
  }

  /**
   * bodyの実行中に起きた変化の主体をsubjectにする（WorldObject.applyActiveEffectが囲う）。
   *
   * 入れ子は内側が勝つ。効果の適用中に別のオブジェクトのrangeイベントが走れば、そこで起きた変化は
   * そのオブジェクトのものになる（治りきった怪我が自分を消すのは、殴った側の仕業ではない）。
   */
  withSubject(subject: WorldObject, body: () => void): void {
    const outer = this.subject;
    this.subject = subject;
    try {
      body();
    } finally {
      this.subject = outer;
    }
  }

  /**
   * 物の出入り1件を観測口へ流す（WorldObjectの配置の関門からのみ呼ぶ）。主体は今適用中の効果から
   * 決まるので、呼び出し側は渡さない——「誰の仕業か」を各関門が覚えて回す形にすると、増えた関門が
   * 渡し忘れる。
   *
   * 観測していなければ何もしない。世界に出入りが無い呼び出し（未配置のまま消えた物）も流さない。
   */
  recordChange(object: WorldObject, from: Slot | undefined, to: Slot | undefined): void {
    if (this.changeObserver === undefined || (from === undefined && to === undefined)) return;
    this.changeObserver({ object, subject: this.subject, from, to });
  }

  /**
   * 形を変えない出来事1件を観測口へ流す（SignalEffectからのみ呼ぶ）。**誰の身に起きたかは効果が
   * 指した対象**で、物の出入りの主体（今適用中の効果、recordChange）とは別に決まる——殴って外した
   * 出来事は、殴った側ではなく殴られた側の上のことになる。
   */
  recordSignal(object: WorldObject, name: string): void {
    this.signalObserver?.({ name, object });
  }

  /**
   * ゲーム内時間をamount分だけ進める。tick境界（minute % minutesPerTickが0に戻る瞬間）を跨ぐたびに、その境界まで
   * minuteを進めてtick()を1回実行する。
   *
   * 呼び出しを刻んでも結果は変わらない（tick内経過分をminuteから読み直すため）。UI層はこれを利用して、
   * 一括で進めた経過をあとから刻んで見せる。
   */
  advanceWorldTime(amount: number): void {
    if (this.world === undefined) {
      throw new Error('advanceWorldTimeにはWorldを持つWorldSessionが必要です。');
    }

    const world = this.world;
    const minutesPerTick = world.minutesPerTick;
    const minuteOfTick = world.minute % minutesPerTick;
    const total = minuteOfTick + amount;
    const ticksToRun = Math.trunc(total / minutesPerTick);

    if (ticksToRun === 0) {
      world.addMinutes(amount);
    } else {
      world.addMinutes(minutesPerTick - minuteOfTick);
      this.runTick(world);

      for (let i = 1; i < ticksToRun; i++) {
        world.addMinutes(minutesPerTick);
        this.runTick(world);
      }

      world.addMinutes(total % minutesPerTick);
    }
  }

  /**
   * 1 tick分の世界の進行。値の積分（WorldObject.tick）のあとに動物の1手を配る
   * （HuntingSystem.md 5.2節）——動物が動くのは時間が経ったからで、その tick の値が出そろった後になる。
   *
   * 観測口（observeTicks）へ知らせるのは両方を終えてから。「そのtick境界の世界」には、
   * 動物がしたことも含まれている。
   */
  private runTick(world: World): void {
    world.instance.tick();
    world.runAnimalTurns(this);
    this.tickObserver?.();
  }
}

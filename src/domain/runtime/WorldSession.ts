import type { WorldCodex } from '../defs/WorldCodex';
import { randomRng } from './Rng';
import type { Rng } from './Rng';
import type { World } from './views/World';
import type { WorldChange, WorldPlace } from './WorldChange';
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
  recordChange(object: WorldObject, from: WorldPlace | undefined, to: WorldPlace | undefined): void {
    if (this.changeObserver === undefined || (from === undefined && to === undefined)) return;
    this.changeObserver({ object, subject: this.subject, from, to });
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
      world.addMinutes(amount, this);
      return;
    }

    world.addMinutes(minutesPerTick - minuteOfTick, this);
    this.runTick(world);

    for (let i = 1; i < ticksToRun; i++) {
      world.addMinutes(minutesPerTick, this);
      this.runTick(world);
    }

    world.addMinutes(total % minutesPerTick, this);
  }

  private runTick(world: World): void {
    world.instance.tick(this);
    this.tickObserver?.();
  }
}

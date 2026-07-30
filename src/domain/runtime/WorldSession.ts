import type { WorldCodex } from '../defs/WorldCodex';
import { randomRng } from './Rng';
import type { Rng } from './Rng';
import type { World } from './views/World';
import { WorldObject } from './WorldObject';

/**
 * 1セッション分の実行時状態。WorldCodexはロード後不変な定義の集合であり続けるため、instance IDの発行という
 * 可変な状態はここに持たせる。スロット移動はWorldObject.moveToSlotが自分自身の責務として行うため、ここでは
 * 仲介しない。
 */
export class WorldSession {
  readonly codex: WorldCodex;
  readonly world: World | undefined;

  /** pick（10節）の重み付き抽選に使う乱数源。テストで決定的に振る舞わせられるよう、コンストラクタで差し替え可能。 */
  readonly rng: Rng;

  private nextInstanceId = 1;

  /** tickを回した直後に呼ぶ観測口（observeTicks）。 */
  private tickObserver: (() => void) | undefined;

  constructor(codex: WorldCodex, world?: World, rng?: Rng) {
    this.codex = codex;
    this.world = world;
    this.rng = rng ?? randomRng();
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

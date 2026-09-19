import type { PropertyGlobalId, SlotGlobalId } from '../domain/GlobalId';
import { symbolGlobalIdOfPropertyValue } from '../domain/GlobalId';
import { seededRng } from '../domain/Rng';
import type { WorldCodex } from '../domain/WorldCodex';
import { WorldObject } from '../domain/WorldObject';
import { WorldSession } from '../domain/WorldSession';
import { World } from '../domain/wrappers/World';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TICKS_PER_DAY } from '../domain/worldTime';
import type { SeaLeg, SeaZoneReading, VoyageLegs } from './voyageLegs';

/**
 * 荒天の押し流し（`docs/world/Voyage.md` 3.8節）を入れて、出航地点から本土まで**実際に渡らせて**測る。
 *
 * 静的に解く側（{@link voyageLegsOf}）が数えないと断っているのがここ——**何区間ぶん押し流されるかは
 * 実行時にしか決まらない**（季節ごとに嵐の出方が違い、風向きも8時間ごとに引き直す）ので、世界を回す。
 *
 * 引く線は次のとおり。
 *
 * - **押し流しそのものはエンジンが起こす。** 海区と筏を実体化して時計を進めるだけで、さらされた時間の
 *   溜まり方も、風下がどちらかも、分かれ道でどちらへ流されるかも `voyage.yaml` の宣言が決める。ここが
 *   書くのは**乗り手の振る舞いだけ**——どの辺を選び、いつ見張り、いつ漕ぎ出すか。
 * - **渡るのに要る時間は静的に解いた側から採る**（{@link SeaLeg.crossingMinutesByWind}）。同じ値を
 *   組み直すと、押し流しを入れた合計と入れない合計が別々の物差しになる。**筏の側の事情（`sail_speed`）は
 *   どちらにも乗っていない。**
 * - **1日に航海へ充てられるのは `dailyFreeMinutes` だけ**で、残りは筏が漂ったまま過ぎる。押し流しは
 *   浮かんでいる限り進む（乗り手が何をしていようと関係ない）ので、**実日数を詰めると嵐にさらされる
 *   時間が実際より短く出る。** 日数の分母が島側の労働と同じであることは
 *   [`VoyageStats.md`](../../docs/diagnostics/VoyageStats.md) が持つ。
 * - **見張りが明るく穏やかなうちだけであること（`Voyage.md` 3.10節）は見ていない。** 静的に解く側と
 *   同じ線で、1日のどこに時間が入るかは要る時間の量とは別の問い。**嵐で見張りが閉じる分も同じ**
 *   ——押し流しが進むのはまさにその時間なので、ここが出す日数は短めに出る。収まる根拠は同3.10節。
 * - **釣りも積荷も乗り手の体も測らない。** 渡り切るのに何区間かかるかだけを出す。
 */

/** 出航地点1つから本土まで渡り切った、1回ぶんの結果。 */
export interface VoyageDriftRun {
  readonly coastName: string;

  /** **漕ぎ出したときの**季節。渡っている間に季節が変われば、その先はもう別の季節の海になる。 */
  readonly seasonName: string;

  /** 漕ぎ出した回数。押し流されて空振りになった渡りも数える。 */
  readonly crossings: number;

  /** そのうち、渡っている最中に押し流されて空振りになった回数（`Voyage.md` 3.8節）。 */
  readonly voidedCrossings: number;

  /** 押し流されて、本土までの残り海区数が増えた回数。 */
  readonly sweptBackwards: number;

  /** 押し流されて、本土までの残り海区数が減った回数。 */
  readonly sweptForwards: number;

  /**
   * 見張りと横断へ充てた分。漂ったまま過ぎた時間は入らない一方、**押し流しで空振りになった渡りは
   * 漕ぎ出したときの分がそのまま入る**——途中まで漕いだ分だけを差し引くと、空振りが「安く済んだ渡り」
   * として出る。
   */
  readonly workMinutes: number;

  /** 出航から到達までの実日数。 */
  readonly days: number;
}

/** 1回の航海が終わらないと見なす上限（tick）。網が壊れて堂々巡りになったときに止まる。 */
const TICK_LIMIT = TICKS_PER_DAY * 400;

const RAFT_OBJECT = 'raft';
const SEASON_PROPERTY = 'season';
const WIND_PROPERTY = 'wind';

/**
 * 海区と筏だけを置いた世界を1つ持ち、そこで何度でも渡らせる。
 *
 * **島は作らない。** 押し流しに要るのは world（天気と風向き）と海区と筏だけで、島の地形まで実体化すると
 * 1 tick の仕事が数十倍になる（`huntEncounter.ts` が島の生成を通さないのと同じ理由）。
 */
export class VoyageDriftSimulation {
  private readonly session: WorldSession;
  private readonly worldInstance: WorldObject;
  private readonly raft: WorldObject;

  /** 海区の型の名前 → 世界に立っているその海区。 */
  private readonly places = new Map<string, WorldObject>();

  private readonly zones: ReadonlyMap<string, SeaZoneReading>;
  private readonly dailyFreeMinutes: number;

  private readonly seasonId: PropertyGlobalId;
  private readonly windId: PropertyGlobalId;
  private readonly fixturesSlotId: SlotGlobalId;

  constructor(
    private readonly codex: WorldCodex,
    legs: VoyageLegs,
    seed: number,
  ) {
    this.zones = new Map(legs.zones.map((zone) => [zone.name, zone]));
    this.dailyFreeMinutes = legs.dailyFreeMinutes;
    this.seasonId = codex.propertyNames.getId(SEASON_PROPERTY);
    this.windId = codex.propertyNames.getId(WIND_PROPERTY);
    this.fixturesSlotId = codex.vocabulary.world.fixturesSlotId;

    this.session = new WorldSession(codex, undefined, seededRng(seed));
    const worldDef = codex.objects.get(codex.objectNames.getId(codex.vocabulary.world.worldObject));
    // world だけが instanceId 0。以降は WorldSession が 1 から配る（`NewGame.ts` と同じ取り決め）。
    this.worldInstance = new WorldObject(0, worldDef, this.session);
    this.session.adoptWorld(new World(this.worldInstance));

    // 海区も本土も singleton なので、world が受け取れるものを全部入れれば網がそのまま立つ。
    // **隣が世界に居ないと押し流しは何も起きない回になる**ので、名指しで選ばずまとめて置く。
    for (const globalId of codex.singletonGlobalIds()) {
      if (globalId === worldDef.globalId) continue;
      const instance = this.session.createObject(globalId);
      if (instance.moveIntoFirstAcceptingSlot(this.worldInstance))
        this.places.set(instance.def.name, instance);
      else instance.destroy();
    }
    for (const name of this.zones.keys())
      if (!this.places.has(name)) throw new Error(`海区 '${name}' が世界に立ちませんでした。`);

    this.raft = this.session.createObject(codex.objectNames.getId(RAFT_OBJECT));
  }

  /**
   * 出航地点に立つ海区から本土まで、1回渡らせる。
   *
   * **同じ世界を使い回す**ので、海区に貯まった荒天の時間も海図も前の航海から続く。見張りの進み具合
   * だけは航海ごとに数え直す——鎖の全部を1周回で渡るのが1回の航海（`Voyage.md` 3.9.1節）で、前の
   * 周回で見張ったことは次の周回へ持ち越さない。
   */
  sail(coastName: string, startZoneName: string): VoyageDriftRun {
    const seasonName = this.currentSeasonName();
    const sightedLookouts = new Map<string, number>();

    let here = this.moveRaftTo(startZoneName);
    let crossings = 0;
    let voidedCrossings = 0;
    let sweptBackwards = 0;
    let sweptForwards = 0;
    let workMinutes = 0;
    let elapsedTicks = 0;

    /**
     * 1 tick のあいだに航海の仕事が進む分。**1日ぶんの自由時間しか進まない**ので、実日数は
     * 費やした仕事の分を `dailyFreeMinutes` で割ったものになる——静的に解いた側の日数
     * （{@link VoyageCourse.total}）とまったく同じ物差しで、押し流しの無い季節はそこへ戻る。
     */
    const workPerTick = (MINUTES_PER_TICK * this.dailyFreeMinutes) / MINUTES_PER_DAY;

    /** 今かかっている仕事の、残りの仕事の分。渡っているなら行き先を持つ。 */
    let workLeftInTask = 0;
    let crossingTo: SeaLeg | undefined;

    for (;;) {
      if (workLeftInTask <= 0) {
        const zone = this.zoneReading(here);
        const done = sightedLookouts.get(zone.name) ?? 0;
        let cost: number;
        if (done < zone.lookouts) {
          sightedLookouts.set(zone.name, done + 1);
          cost = zone.minutesPerLookout;
        } else {
          crossingTo = this.legTowardMainland(zone);
          const minutes = crossingTo.crossingMinutesByWind.get(this.currentWindName());
          if (minutes === undefined)
            throw new Error(`航路 '${crossingTo.routeName}' に今の風で渡る時間がありません。`);
          crossings++;
          cost = minutes;
        }
        // **足す**——tick で刻むと仕事は tick の切れ目をまたぐので、置き換えると端数が毎回切り上がり、
        // 見張りの多い航海ほど実日数が水増しされる。
        workLeftInTask += cost;
        workMinutes += cost;
      }

      this.session.advanceWorldTime(MINUTES_PER_TICK);
      elapsedTicks++;
      if (elapsedTicks > TICK_LIMIT)
        throw new Error(`${coastName} からの航海が ${TICK_LIMIT} tick で終わりませんでした。`);

      const swept = this.raft.parent;
      if (swept === undefined) throw new Error('筏が海区から外れました。');
      if (swept !== here) {
        // 押し流された。**渡っている最中なら、その渡りは空振りになる**（`Voyage.md` 3.8節）——時間だけが過ぎ、
        // 居場所は荒天が決めた先。
        if (crossingTo !== undefined) voidedCrossings++;
        if (this.remainingZones(swept) > this.remainingZones(here)) sweptBackwards++;
        else sweptForwards++;
        here = swept;
        workLeftInTask = 0;
        crossingTo = undefined;
        continue;
      }

      workLeftInTask -= workPerTick;
      if (workLeftInTask > 0 || crossingTo === undefined) continue;

      // 渡り切った。行き先が海区でなければ本土なので、そこで周回が終わる。
      const destination = crossingTo.destinationName;
      crossingTo = undefined;
      if (!this.zones.has(destination)) {
        return {
          coastName,
          seasonName,
          crossings,
          voidedCrossings,
          sweptBackwards,
          sweptForwards,
          workMinutes,
          days: elapsedTicks / TICKS_PER_DAY,
        };
      }
      here = this.moveRaftTo(destination);
    }
  }

  /** 今の季節の綴り。 */
  private currentSeasonName(): string {
    return this.symbolNameOf(SEASON_PROPERTY, this.seasonId);
  }

  /** 今の風向きの綴り。 */
  private currentWindName(): string {
    return this.symbolNameOf(WIND_PROPERTY, this.windId);
  }

  private symbolNameOf(propertyName: string, propertyGlobalId: PropertyGlobalId): string {
    const value = this.worldInstance.tryGetProperty(propertyGlobalId)?.number;
    if (value === undefined) throw new Error(`world が ${propertyName} を持っていません。`);
    return this.codex.symbolNames.getName(symbolGlobalIdOfPropertyValue(value));
  }

  /** 筏をその海区へ移す。**押し流しと同じ移動**で、違うのは起こした側だけ。 */
  private moveRaftTo(zoneName: string): WorldObject {
    const place = this.places.get(zoneName);
    if (place === undefined) throw new Error(`海区 '${zoneName}' が世界に居ません。`);

    const rejection = this.raft.moveToSlotOrRejection(place.getSlot(this.fixturesSlotId));
    if (rejection !== undefined) throw new Error(`筏を '${zoneName}' へ置けません（${rejection}）。`);
    return place;
  }

  private zoneReading(place: WorldObject): SeaZoneReading {
    const zone = this.zones.get(place.def.name);
    if (zone === undefined) throw new Error(`'${place.def.name}' は海区ではありません。`);
    return zone;
  }

  /** その海区から本土まで、最短で何区間か。 */
  private remainingZones(place: WorldObject): number {
    return this.zoneReading(place).zonesToMainland;
  }

  /**
   * 本土へいちばん近づく辺。**押し流された先がどこであっても、そこから残り区間の最も少ない辺を選ぶ**
   * ——遠回りを選ぶ理由は実り（`Voyage.md` 3.3節）であって、押し流しの測りに要るのは最短で渡り切る形だけ。
   */
  private legTowardMainland(zone: SeaZoneReading): SeaLeg {
    let best: SeaLeg | undefined;
    for (const leg of zone.legs)
      if (best === undefined || leg.destinationZonesToMainland < best.destinationZonesToMainland) best = leg;
    if (best === undefined) throw new Error(`海区 '${zone.name}' から先へ出る辺がありません。`);
    return best;
  }
}

import type { EffectReader, PickCandidateReading, DeclaredNumberReading } from '../../domain/EffectReader';
import type { ObjectRefReading } from '../../domain/ObjectRef';
import type { ObjectDef } from '../../domain/ObjectDef';
import type { GateReading, PassivePropertyReading, PassiveReader } from '../../domain/PassiveReader';
import type { WorldCodex } from '../../domain/WorldCodex';
import type { WorldObject } from '../../domain/WorldObject';
import type { World } from '../../domain/wrappers/World';

/** 1日の分数（推定日数を出すのに要る唯一の定数）。 */
const MINUTES_PER_DAY = 24 * 60;

/**
 * 見積もりを丸める刻み（日）。**半日**にするのは、積み下ろしのたびに動く細かさが要る一方、
 * 分まで出すと海図の粗さ（±5海区）より細かい数字になるため。
 */
const DAY_STEP = 0.5;

/**
 * 渡るのにかかる時間を持つ場所＝海区、と読むためのプロパティ名（`docs/world/Voyage.md` 3.2節）。
 * 積載が速さを削り、速さの段が横断時間を縮める鎖も、この2つの名前だけで辿れる（同3.2節）。
 */
const CROSSING_MINUTES = 'crossing_minutes';
const SAIL_SPEED = 'sail_speed';

/**
 * 海図が言う「本土まであと何海区か」の下限と上限（同3.7節）。**真値（`zones_to_mainland`）は読まない**
 * ——プレイヤーへ出すのは海図が言う幅だけ（`docs/concept/GameEndings.md` 9.3節）。
 */
const ZONES_MIN = 'zones_to_mainland_min';
const ZONES_MAX = 'zones_to_mainland_max';

/**
 * 今の積載で本土まで何日かかるかの見積もり（`docs/concept/GameEndings.md` 9.3節）。
 * **幅は幅のまま持つ**——1つの数へ丸めると、粗い海図から出た見積もりが確かなものに見える。
 */
export interface VoyageForecast {
  readonly minDays: number;
  readonly maxDays: number;
}

/** 宣言された`modify`のうち、受け取ると決めたものの量を足し合わせる読み手。 */
class ModifySum implements PassiveReader {
  total = 0;

  constructor(private readonly accepts: (reading: PassivePropertyReading) => boolean) {}

  modify(reading: PassivePropertyReading): void {
    // 量が積（ContainerSystem.mdの重さの伝播）の寄与は宣言だけからは決まらないので数えない。
    if (reading.amount.kind === 'fixed' && this.accepts(reading)) this.total += reading.amount.value;
  }

  accumulate(): void {}

  transfer(): void {}
}

/** その型が宣言している`modify`のうち、条件に合うものの量の合計。 */
function sumModify(def: ObjectDef, accepts: (reading: PassivePropertyReading) => boolean): number {
  const sum = new ModifySum(accepts);
  for (const passive of def.passives.declarations) passive.read(sum);
  return sum.total;
}

/** ゲート（8.2節）を持たない寄与か。 */
function isUngated(gate: GateReading): boolean {
  return gate.stage === undefined && gate.conditions === undefined;
}

/** 段だけで縛られた寄与か（条件を併せ持つものは含まない）。 */
function isStageOnly(gate: GateReading): boolean {
  return gate.stage !== undefined && gate.conditions === undefined;
}

/** 自分を型で名指した場所へ移す`move`だけを拾う読み手（`pick`の候補の中を見る）。 */
class SelfMoveDestinations implements EffectReader {
  readonly destinations: number[] = [];

  move(subject: ObjectRefReading, destination: ObjectRefReading): void {
    if (subject.kind === 'root' && subject.root === 'self' && destination.kind === 'object')
      this.destinations.push(destination.objectGlobalId);
  }

  pick(candidates: readonly PickCandidateReading[]): void {
    for (const candidate of candidates) candidate.effect.read(this);
  }

  set(): void {}

  add(): void {}

  spawn(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  signal(): void {}
}

/** 出航の卓の候補1つ——引かれる重みと、そのとき自分が移る先の型。 */
interface DepartureCandidate {
  readonly weight: DeclaredNumberReading;
  readonly destinationGlobalId: number;
}

/**
 * 操作の宣言から、出航の卓（`pick`）の候補を拾う読み手。**「出航」という名前は見ない**
 * ——自分を型で名指した場所へ移す抽選が出航で、行き先が海区かどうかは行き先の側が答える。
 */
class DepartureCandidates implements EffectReader {
  readonly candidates: DepartureCandidate[] = [];

  pick(candidates: readonly PickCandidateReading[]): void {
    for (const candidate of candidates) {
      const moves = new SelfMoveDestinations();
      candidate.effect.read(moves);
      for (const destinationGlobalId of moves.destinations)
        this.candidates.push({ weight: candidate.weight, destinationGlobalId });
    }
  }

  set(): void {}

  add(): void {}

  spawn(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  move(): void {}

  signal(): void {}
}

/** 半日単位へ切り上げる。**半端な半日ぶんの水と食料も要る**ので、どちらの端も切り上げる。 */
function toDays(minutes: number): number {
  return Math.ceil(minutes / MINUTES_PER_DAY / DAY_STEP) * DAY_STEP;
}

/**
 * 積み下ろしの間に出す、今の積載での推定日数（`docs/concept/GameEndings.md` 9.3節）を引けるようにする。
 *
 * 見積もりを持たないもの——横断時間を持たない物、海にも海岸にも居ない筏——ではundefined。
 * ワールド側の宣言をひとつも持たないCodexでも、名前が引けなければ黙って見積もりを出さない。
 */
export function voyageForecastOf(
  codex: WorldCodex,
  world: World,
): (object: WorldObject) => VoyageForecast | undefined {
  const crossingId = codex.propertyNames.tryGetId(CROSSING_MINUTES);
  const sailSpeedId = codex.propertyNames.tryGetId(SAIL_SPEED);
  const zonesMinId = codex.propertyNames.tryGetId(ZONES_MIN);
  const zonesMaxId = codex.propertyNames.tryGetId(ZONES_MAX);
  if (
    crossingId === undefined ||
    sailSpeedId === undefined ||
    zonesMinId === undefined ||
    zonesMaxId === undefined
  )
    return () => undefined;

  /** 海区か。**型の名前もタグも見ない**——渡るのにかかる時間を持つ場所が海区（Voyage.md 3.2節）。 */
  const isZone = (place: WorldObject): boolean => place.tryGetProperty(crossingId) !== undefined;

  /** 出航の卓が引く重み。海岸が名乗る「この海区に面しているか」（同3.6節）はここで読む。 */
  const weightOf = (reading: DeclaredNumberReading, raft: WorldObject): number => {
    if (reading.kind === 'literal') return reading.value;
    const subject =
      reading.subject === 'self' ? raft : reading.subject === 'parent' ? raft.parent : undefined;
    return subject?.tryGetProperty(reading.propertyGlobalId)?.getEffectiveValue() ?? 0;
  };

  /** 今の海岸から漕ぎ出したときに立ちうる海区。重みが0の候補＝面していない海区は挙がらない。 */
  const departureZones = (raft: WorldObject): readonly WorldObject[] => {
    const reader = new DepartureCandidates();
    for (const trigger of raft.def.menuTriggers) trigger.interaction.read(reader);

    const zones: WorldObject[] = [];
    for (const candidate of reader.candidates) {
      if (weightOf(candidate.weight, raft) <= 0) continue;
      const zone = world.instance.findSelfOrDescendantOfDef(candidate.destinationGlobalId);
      if (zone !== undefined && isZone(zone) && !zones.includes(zone)) zones.push(zone);
    }
    return zones;
  };

  /**
   * これから渡ることになる海区。海に浮かんでいればその海区、海岸に繋いであれば出航の卓が立てうる海区。
   * **どちらへ出るかが抽選なら候補は複数**で、そのぶん幅が広がる。
   */
  const zonesAhead = (raft: WorldObject): readonly WorldObject[] => {
    const parent = raft.parent;
    if (parent === undefined) return [];
    return isZone(parent) ? [parent] : departureZones(raft);
  };

  /**
   * その海区へ浮かべたときの筏の速さ（同3.2節）。**風は入れない**——日ごとに変わるものを入れると、
   * 「積載の側に不確かさは無い」（GameEndings.md 12.6節）が崩れ、幅が海図の粗さを表さなくなる。
   *
   * 足すのは3つ。海が配るもの（海流）、組み込んだ部品が配るもの（帆）、そして積載の段が削るもの。
   */
  const sailSpeedAtSea = (raft: WorldObject, zone: WorldObject): number => {
    const speed = raft.getProperty(sailSpeedId);
    let sum = speed.number;

    // 海が浮かんでいるものすべてへ配る寄与。**条件の付いた寄与は採らない**——それは海の側の、
    // その日その時の事情で、見積もりが当てにできるものではない。
    sum += sumModify(
      zone.def,
      (reading) =>
        reading.target === 'child' && reading.propertyGlobalId === sailSpeedId && isUngated(reading.gate),
    );

    // 組み込んだ部品が配る寄与。**ゲートは見ない**——部品は海に出れば必ず効くもので、ゲートは
    // 浜に繋いだままの筏に嘘を言わせないためだけに在る（Voyage.md 3.2節）。
    for (const part of raft.children())
      sum += sumModify(
        part.def,
        (reading) => reading.target === 'parent' && reading.propertyGlobalId === sailSpeedId,
      );

    // 積載の段が自分から削る寄与（同3.2節の weight の段）。段だけで縛られた自分の事情を採る。
    sum += sumModify(
      raft.def,
      (reading) =>
        reading.target === 'self' &&
        reading.propertyGlobalId === sailSpeedId &&
        isStageOnly(reading.gate) &&
        (raft.tryGetProperty(reading.gate.stage!.propertyGlobalId)?.isInStage(reading.gate.stage!.name) ??
          false),
    );

    return speed.def.range?.clamp(sum) ?? sum;
  };

  /**
   * その海区を1つ渡るのにかかる時間。素の横断時間から、上の速さの段が引く（同3.2節）。
   *
   * **これ1区間で残り全部を代表できるのは、素の横断時間がどの海区も同じだから**（同3.2節）。
   * 海図が持つのは残りの海区数だけ（GameEndings.md 12.6節）なので、他の海区の時間は掛ける相手に
   * できない——海区ごとに違えば、遠い出航地点ほど短く見えることが起きる。
   */
  const crossingMinutes = (raft: WorldObject, zone: WorldObject): number => {
    const crossing = zone.getProperty(crossingId);
    const stage = raft.getProperty(sailSpeedId).def.stageAt(sailSpeedAtSea(raft, zone));
    if (stage === undefined) return crossing.number;

    const shortened = sumModify(
      raft.def,
      (reading) =>
        reading.target === 'parent' &&
        reading.propertyGlobalId === crossingId &&
        isStageOnly(reading.gate) &&
        reading.gate.stage!.propertyGlobalId === sailSpeedId &&
        reading.gate.stage!.name === stage.name,
    );
    return crossing.def.range?.clamp(crossing.number + shortened) ?? crossing.number + shortened;
  };

  return (object: WorldObject): VoyageForecast | undefined => {
    // 渡る当人（速さを持つもの）だけが見積もりを持つ。
    if (object.tryGetProperty(sailSpeedId) === undefined) return undefined;

    let minDays: number | undefined;
    let maxDays: number | undefined;
    for (const zone of zonesAhead(object)) {
      const zonesMin = zone.tryGetProperty(zonesMinId)?.getEffectiveValue();
      const zonesMax = zone.tryGetProperty(zonesMaxId)?.getEffectiveValue();
      if (zonesMin === undefined || zonesMax === undefined) continue;

      const minutes = crossingMinutes(object, zone);
      const low = toDays(zonesMin * minutes);
      const high = toDays(zonesMax * minutes);
      minDays = minDays === undefined ? low : Math.min(minDays, low);
      maxDays = maxDays === undefined ? high : Math.max(maxDays, high);
    }

    return minDays === undefined || maxDays === undefined ? undefined : { minDays, maxDays };
  };
}

import type { IslandMap } from '../domain/generation/IslandMap';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { ActivityHoursRow } from './activityHours';
import type { BalanceTables } from './balanceTables';
import { MINUTES_PER_DAY } from './balanceTables';
import { craftingStepsOf } from './craftingSteps';

/**
 * 生成された島を測って、**1日を局面ごとに数える**（ContentSkeleton.md 8.2節・8.3節）。
 *
 * **数え方は局面をまたいで1つだけ。**
 *
 * ```
 * その日その土地で進む仕事（分） = min(屋外の枠 − 往復の移動 − 生存の採取, その土地でその仕事ができる時間)
 * ```
 *
 * **頭打ちに使うのは、その局面でそこですることができる時間**——探索の局面は探索できる時間
 * （`ActivityHoursRow.explorationHoursPerDay`）、定常の局面は採れる時間（同`gatheringHoursPerDay`）。
 * 2つが違うのは**嵐が採取だけを止める**ためで（ContentSkeleton.md 8.1.4節）、明るさの要求は同じ。
 * 手元の細かい作業（`handworkHoursPerDay`）が当たっているのは夜の加工360分のほうで、この式は
 * 1分も数えていない（8.3節の割り付け）。
 *
 * 局面の違いは**どこへ行くか**と**そこで何をするか**の2つで、式そのものは共有する。遠さは移動の項
 * として、暗さと風雨は頭打ちとして、同じ1行に入る——**そこで何をするかは、どの頭打ちを渡すかで
 * しか現れない。**
 *
 * 引く線は4つ。**1日は1つの土地で使う**——往復は1回で、余った時間を次の土地へ繰り越さない。
 * **荷物は数えない**——運べる量に上限が無い（ExplorationSystem.md 1.1節）ので、採ったものを置いて
 * 帰る自由はこの勘定に現れない。**探索の抽選は解かない**——何が見つかるかは実行時にしか決まらない
 * ので、探索は回数と時間だけで測る。**定常の局面に泊まりがけを入れない**——探索と違って山は終わりの
 * ある仕事ではないので、滞在の長さを決めるものが無い。日帰りで届かない組を持つ拠点は定常の局面を
 * 持たず（`BaseDailyPhases.steady`）、数える側が標本から外す。
 */

/** 1日の屋外の枠（分）。太陽が出ている12時間で、移動のしきい値を満たす時間そのもの。 */
export const OUTDOOR_WINDOW_MINUTES = 720;

/** 夜の睡眠（分）。1日の割り付け（屋外720・夜の加工360・睡眠360）はContentSkeleton.md 8.3節。 */
export const SLEEP_MINUTES_PER_DAY = 360;

/** 焚き火のそばでの加工（分/日）。1日の割り付けの残りで、屋外にも睡眠にも入らない分。 */
export const NIGHT_CRAFT_MINUTES_PER_DAY = MINUTES_PER_DAY - OUTDOOR_WINDOW_MINUTES - SLEEP_MINUTES_PER_DAY;

/**
 * 1日の枠のうち、収支表の最小労働（BalanceStats.md）から出る2つ。**どちらも書き写さない**
 * ——最小労働が動けば、生存の採取も自由時間も一緒に動く。
 */
export interface DailyBudget {
  /** 1日を賄う生存の採取（分）。最小労働から睡眠を引いた、昼に払うぶん。 */
  readonly survivalGatheringMinutes: number;

  /** 最小労働を払って残る自由時間（分）。山の量を日数へ直すときの分母。 */
  readonly surplusMinutes: number;
}

/**
 * 収支表の最小労働を、1日の割り付けへ当てはめる。**引き算は最小労働から睡眠を落とす1回だけ**
 * ——自由時間そのものは収支表が持っている（`BalanceTables.surplusMinutes`）ので、ここでは組み直さない。
 */
export function dailyBudgetOf(balance: BalanceTables): DailyBudget {
  return {
    survivalGatheringMinutes: balance.minimumLabourMinutes - SLEEP_MINUTES_PER_DAY,
    surplusMinutes: balance.surplusMinutes,
  };
}

/** 探索できる土地の型1つの、局面の勘定に要るぶん。 */
export interface LocationTypeDay {
  readonly locationDefName: string;

  /** 探索率100%までに要る探索時間（分）＝ 探索の回数 × 探索1回の時間。 */
  readonly explorationMinutes: number;

  /** 屋外で採れる時間（分/日）。季節ごとの値の平均。 */
  readonly gatheringMinutesPerDay: number;

  /** 探索できる時間（分/日）。同じく季節ごとの値の平均で、採取と違って嵐を引かない。 */
  readonly exploringMinutesPerDay: number;
}

/**
 * 山の土地の配分1つ（ContentSkeleton.md 8.3節の仮置き）。**どの土地でその組の仕事ができるか**を
 * 型の名前で持ち、その日の行き先は組の中から選ぶ。
 */
export interface WorkShare {
  readonly label: string;
  readonly locationDefNames: readonly string[];

  /** 屋外の山のうち、この組が占める割合。全部の合計が1になる。 */
  readonly share: number;
}

/**
 * 屋外の山を、どの土地でどれだけこなすか（ContentSkeleton.md 8.3節）。
 *
 * **探索できる土地の型は、どれか1つの組にちょうど1回だけ現れる**（`locationTypeDaysOf`が検査する）。
 * 型が増えたのに配分へ現れないと、その土地はこの勘定から黙って消える。
 */
export const WORK_SHARES: readonly WorkShare[] = [
  {
    label: '開けた土地',
    locationDefNames: [
      'sandy_beach',
      'rocky_coast',
      'cliff_coast',
      'grassland',
      'rocky_field',
      'wasteland',
      'mountainside',
      'mountain_peak',
    ],
    share: 0.5,
  },
  { label: '森', locationDefNames: ['forest'], share: 0.25 },
  { label: '密林', locationDefNames: ['jungle'], share: 0.25 },
];

/**
 * 1周回に積む山1つ（ContentSkeleton.md 4節）。
 *
 * **何を山と数えるかは宣言する。** 量の大小からは決められない——磨いた石器も恒久窯も労働は要るのに
 * 山に立たない（開けるものを持たないため。同節）。**逆に、立つと決めた山の量は数える**。
 */
export interface WorkPile {
  /** 系統の番号（ContentSkeleton.md 3節）。 */
  readonly system: number;

  readonly label: string;

  /**
   * その山の量。**型の名前**なら収支表に出るその型の総労働、**数**なら置いた日数（仮置き）。
   * 置いた値になるのは、まだ宣言が無い山と、量が個数や往復の回数で決まっていて型1つでは立たない山
   * （畑・塩田・甕。同節）。
   */
  readonly amount: string | number;
}

/**
 * 1周回に積む山の全部（ContentSkeleton.md 4節の表）。**この一覧が1周回の日数の出どころ**で、
 * 山を1つ足すことは、ここへ1行足すことと同じ。
 */
export const WORK_PILES: readonly WorkPile[] = [
  { system: 1, label: '雨受けと貯水を据える', amount: 2 },
  { system: 1, label: '甕を10個焼く', amount: 3.2 },
  { system: 1, label: '航海ぶんの水を積む', amount: 1 },
  { system: 2, label: '畑を拓いて回す', amount: 4 },
  { system: 2, label: '家畜の囲い', amount: 'pen' },
  { system: 2, label: '大型の狩り', amount: 2 },
  { system: 3, label: '干し場', amount: 'drying_rack' },
  { system: 3, label: '燻し小屋', amount: 2 },
  { system: 3, label: '製塩', amount: 3 },
  { system: 3, label: '航海ぶんを塩漬けにする', amount: 1 },
  { system: 4, label: '鉱石を掘って製錬', amount: 5 },
  { system: 6, label: '石鏃の槍', amount: 1 },
  { system: 6, label: '青銅の穂先', amount: 2 },
  { system: 7, label: 'なめし革の背負い袋', amount: 1 },
  { system: 7, label: 'そり', amount: 2 },
  { system: 8, label: 'なめし革の一式', amount: 'tanned_leather_clothing' },
  { system: 9, label: '高床の寝台', amount: 1.5 },
  { system: 9, label: '詰め物', amount: 1 },
  { system: 10, label: '葉の小屋', amount: 3 },
  { system: 10, label: '高床', amount: 4 },
  { system: 10, label: '板の壁・床', amount: 5 },
  { system: 12, label: '筏', amount: 'raft' },
  { system: 12, label: '帆', amount: 'rawhide_sail' },
  { system: 12, label: '櫂と舵', amount: 2 },
  { system: 12, label: '沿岸航海', amount: 3 },
  { system: 12, label: '海図を仕上げる', amount: 5 },
];

/**
 * 屋外での採取・伐採・運搬が山に占める割合（ContentSkeleton.md 8.3節の仮置き）。残りが拠点での加工で、
 * **律速は屋外のほう**——拠点での加工は夜の枠に収まる。
 */
const OUTDOOR_WORK_SHARE = 2 / 3;

/** 山1つの量。 */
export interface WorkPileAmount {
  readonly pile: WorkPile;
  readonly minutes: number;
  readonly days: number;
}

/**
 * 山の一覧を量へ直す。置いた日数の山は自由時間を掛けて分へ、型で立つ山は収支表の総労働をそのまま採る。
 * **型が収支表に出ていなければ投げる**——0分の山として黙って通すと、1周回の日数だけが静かに縮む。
 */
export function workPileAmountsOf(balance: BalanceTables, budget: DailyBudget): readonly WorkPileAmount[] {
  return WORK_PILES.map((pile) => {
    const minutes =
      typeof pile.amount === 'number'
        ? pile.amount * budget.surplusMinutes
        : objectCostMinutesOf(balance, pile.amount);
    return { pile, minutes, days: minutes / budget.surplusMinutes };
  });
}

function objectCostMinutesOf(balance: BalanceTables, objectName: string): number {
  const cost = balance.objectCosts.find((row) => row.objectName === objectName);
  if (cost?.minutes === undefined)
    throw new Error(`山が名乗る型 '${objectName}' の総労働が、収支表に出ていません。`);
  return cost.minutes;
}

/** 山の合計を、屋外と拠点へ割ったもの（ContentSkeleton.md 8.3節）。 */
export interface WorkTotal {
  readonly pileCount: number;
  readonly minutes: number;
  readonly days: number;

  /** 屋外での採取・伐採・運搬と、拠点での加工。定常の局面が消化するのは前者だけ。 */
  readonly outdoorMinutes: number;
  readonly baseMinutes: number;

  /** 拠点での加工が、夜の加工の枠で何日ぶんか。 */
  readonly baseDays: number;
}

export function workTotalOf(amounts: readonly WorkPileAmount[], budget: DailyBudget): WorkTotal {
  const minutes = amounts.reduce((sum, amount) => sum + amount.minutes, 0);
  const baseMinutes = minutes * (1 - OUTDOOR_WORK_SHARE);

  return {
    pileCount: amounts.length,
    minutes,
    days: minutes / budget.surplusMinutes,
    outdoorMinutes: minutes * OUTDOOR_WORK_SHARE,
    baseMinutes,
    baseDays: baseMinutes / NIGHT_CRAFT_MINUTES_PER_DAY,
  };
}

/** 探索の局面（島を開き切るまで）を、拠点1つから見たもの。 */
export interface ExplorationPhase {
  /** 島の全土地を探索率100%まで開くのに要る探索時間の合計（分）。移動を含まない。 */
  readonly explorationMinutes: number;

  /**
   * 日帰りだけで開き切るのに要る日数。**1つでも日帰りで開けない土地があればundefined**——その島では
   * 日帰りだけの行程が成立しない。
   */
  readonly dayTripDays: number | undefined;

  /** 上の日数のうち、1日あたりの移動時間（往復、分）。 */
  readonly dayTripTravelMinutesPerDay: number | undefined;

  /** 上の日数のうち、1日あたりに進む探索時間（分）。 */
  readonly dayTripExplorationMinutesPerDay: number | undefined;

  /** 同じく、1日あたりに探索へ使える枠（分）＝ 屋外の枠 − 往復の移動 − 生存の採取。 */
  readonly dayTripWindowMinutesPerDay: number | undefined;

  /**
   * その枠のうち、探索が進まずに余る分（分/日）。**探索の局面に山を1分も乗せていない**ので、
   * この余りがそのまま「1周回が下へ振れる材料」になる（ContentSkeleton.md 8.3節）。
   */
  readonly dayTripSpareMinutesPerDay: number | undefined;

  /** 土地ごとに日帰りと泊まりの安いほうを採ったときの日数。日帰りだけの日数との差が、泊まりで浮く分。 */
  readonly mixedDays: number;

  /** そのうち、泊まりのほうが安い（日帰りでは開けない場合を含む）土地の数。 */
  readonly stayOverSiteCount: number;

  /** 往復で枠が尽き、日帰りでは1分も探索が進まない土地の数。 */
  readonly dayTripImpossibleSiteCount: number;
}

/** 定常の局面で、山の配分1つがその島で持つ値。 */
export interface SteadyPhaseShare {
  readonly label: string;

  /** その組で選んだ土地への往復（分）。 */
  readonly roundTripMinutes: number;

  /** その土地で1日に進む山（分）。 */
  readonly workMinutesPerDay: number;

  /** 屋外の山のうちこの組が占める割合を、その組に費やす**日数**の割合へ直したもの。 */
  readonly dayShare: number;
}

/** 定常の局面（島を開き切った後）の1日を、拠点1つから見たもの。 */
export interface SteadyPhase {
  /** 日数の割合で重み付けした、1日の移動（往復、分）。 */
  readonly travelMinutesPerDay: number;

  /** 同じく、1日に進む山（分）。屋外の山をこれで割ると、定常の局面の日数になる。 */
  readonly workMinutesPerDay: number;

  /** 島にある組だけ。並びは`WORK_SHARES`と同じ。 */
  readonly shares: readonly SteadyPhaseShare[];
}

/** 拠点1つから見た、局面ごとの1日。 */
export interface BaseDailyPhases {
  readonly siteIndex: number;

  /** 拠点から他の土地への片道（最短経路）の移動時間（分）の平均。島の広さそのもの。 */
  readonly oneWayMinutes: number;

  readonly exploration: ExplorationPhase;

  /** **日帰りで届かない組を持つ拠点ではundefined**（このファイルのクラスコメント）。 */
  readonly steady: SteadyPhase | undefined;
}

/** 島1つ。 */
export interface IslandDailyPhases {
  readonly seed: number;

  /** 全土地を拠点として測ったもの。並びはサイトindex。 */
  readonly bases: readonly BaseDailyPhases[];

  /**
   * **局面ごとの1日を代表する拠点**。プレイヤーは拠点を選べるので、選べる中で片道の平均が最も短い
   * 土地を採る（同じなら`siteIndex`の小さいほう）。良し悪しの判定ではなく順序の定義。
   *
   * **1日はこの拠点1つから見たものを採る**——`bases`を平均すると、どの土地に住んだ人のものでもない
   * 1日になる（TerrainStats.md「局面ごとの1日」）。
   */
  readonly bestBase: BaseDailyPhases;
}

/** 1周回を、拠点1つから見たもの（ContentSkeleton.md 8.3節）。 */
export interface CycleDays {
  readonly explorationDays: number;
  readonly steadyDays: number;
  readonly totalDays: number;
}

/**
 * 局面を積んだ1周回の日数。**探索の局面には山を1分も乗せない**（ContentSkeleton.md 8.3節）ので、
 * 屋外の山は全部が定常の局面に乗る。
 *
 * **日数はこの拠点1つの実入りで割って出す。** 島ごとの日数を平均するのと、島をまたいで平均した
 * 実入りで割るのは別物で、後者は日数を短く出す（TerrainStats.md「定常の局面」）。
 *
 * 日帰りで開き切れない島と、定常の局面を持たない拠点ではundefined。
 */
export function cycleDaysOf(base: BaseDailyPhases, outdoorWorkMinutes: number): CycleDays | undefined {
  const explorationDays = base.exploration.dayTripDays;
  if (explorationDays === undefined || base.steady === undefined) return undefined;

  const steadyDays = outdoorWorkMinutes / base.steady.workMinutesPerDay;
  return { explorationDays, steadyDays, totalDays: explorationDays + steadyDays };
}

/**
 * 探索できる土地の型ごとに、局面の勘定に要る値を実測する。定義は島をまたいで変わらないので、
 * 島ごとの算出はこれを使い回す。
 *
 * 採れる時間・探索できる時間は`activityHoursOf`の行（土地×季節）を季節で平均したもの。
 * **配分（`WORK_SHARES`）から漏れている型があれば投げる**——黙って通すと、その土地は山の勘定に
 * 一度も現れない。
 */
export function locationTypeDaysOf(
  codex: WorldCodex,
  activityHours: readonly ActivityHoursRow[],
): ReadonlyMap<number, LocationTypeDay> {
  const generation = codex.generation;
  if (generation === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');

  const days = new Map<number, LocationTypeDay>();
  for (const locationType of generation.locationTypes) {
    const locationDef = codex.objects.get(locationType.objectDefGlobalId);
    if (days.has(locationDef.globalId)) continue;

    days.set(locationDef.globalId, {
      locationDefName: locationDef.name,
      explorationMinutes: explorationMinutesOf(codex, locationDef),
      gatheringMinutesPerDay: minutesPerDayOf(
        activityHours,
        locationDef.name,
        (row) => row.gatheringHoursPerDay,
      ),
      exploringMinutesPerDay: minutesPerDayOf(
        activityHours,
        locationDef.name,
        (row) => row.explorationHoursPerDay,
      ),
    });
  }

  assertWorkSharesCover([...days.values()].map((day) => day.locationDefName));
  return days;
}

/** 生成された島1つを測る。 */
export function dailyPhasesOf(
  map: IslandMap,
  locationDays: ReadonlyMap<number, LocationTypeDay>,
  budget: DailyBudget,
): IslandDailyPhases {
  const distances = shortestPathMinutes(map);
  const days = map.sites.map((site) => locationTypeDayOf(locationDays, map, site.index));
  const bases = map.sites.map((site) => baseDailyPhasesOf(distances, days, site.index, budget));

  return {
    seed: map.seed,
    bases,
    bestBase: bases.reduce((best, base) => (base.oneWayMinutes < best.oneWayMinutes ? base : best)),
  };
}

function baseDailyPhasesOf(
  distances: readonly number[][],
  days: readonly LocationTypeDay[],
  base: number,
  budget: DailyBudget,
): BaseDailyPhases {
  const others = days.map((_, site) => site).filter((site) => site !== base);

  return {
    siteIndex: base,
    oneWayMinutes: others.reduce((sum, site) => sum + distances[base][site], 0) / others.length,
    exploration: explorationPhaseOf(distances, days, base, budget),
    steady: steadyPhaseOf(distances, days, base, budget),
  };
}

/**
 * 島の全土地を開き切るまでの行程。土地1つを開く日数は他の土地に依らないので、**開く順は結果に
 * 効かない**——効くのは「その順で回れるか」だけで、遠い土地へ着くのに要る道は手前の土地を開く
 * 過程で必ず出る（ExplorationSystem.md 3.2節が「探索率100%に達する前に道が出そろう」を生成の
 * 不変条件として保証している）。
 */
function explorationPhaseOf(
  distances: readonly number[][],
  days: readonly LocationTypeDay[],
  base: number,
  budget: DailyBudget,
): ExplorationPhase {
  let explorationMinutes = 0;
  let dayTripDays: number | undefined = 0;
  let dayTripTravelMinutes = 0;
  let dayTripWindowMinutes = 0;
  let mixedDays = 0;
  let stayOverSiteCount = 0;
  let dayTripImpossibleSiteCount = 0;

  for (const [site, day] of days.entries()) {
    const roundTripMinutes = 2 * distances[base][site];
    explorationMinutes += day.explorationMinutes;

    const perDayMinutes = workMinutesPerDayOf(day.exploringMinutesPerDay, roundTripMinutes, budget);
    const tripDays = perDayMinutes > 0 ? Math.ceil(day.explorationMinutes / perDayMinutes) : undefined;
    const stayDays = stayOverDaysOf(day, roundTripMinutes);

    if (tripDays === undefined) {
      dayTripImpossibleSiteCount++;
      dayTripDays = undefined;
    } else if (dayTripDays !== undefined) {
      dayTripDays += tripDays;
      dayTripTravelMinutes += tripDays * roundTripMinutes;
      dayTripWindowMinutes += tripDays * windowMinutesOf(roundTripMinutes, budget);
    }

    if (tripDays === undefined || stayDays < tripDays) stayOverSiteCount++;
    mixedDays += tripDays === undefined ? stayDays : Math.min(tripDays, stayDays);
  }

  return {
    explorationMinutes,
    dayTripDays,
    dayTripTravelMinutesPerDay: dayTripDays === undefined ? undefined : dayTripTravelMinutes / dayTripDays,
    dayTripExplorationMinutesPerDay: dayTripDays === undefined ? undefined : explorationMinutes / dayTripDays,
    dayTripWindowMinutesPerDay: dayTripDays === undefined ? undefined : dayTripWindowMinutes / dayTripDays,
    dayTripSpareMinutesPerDay:
      dayTripDays === undefined ? undefined : (dayTripWindowMinutes - explorationMinutes) / dayTripDays,
    mixedDays,
    stayOverSiteCount,
    dayTripImpossibleSiteCount,
  };
}

/**
 * 泊まりがけで土地1つを開くのに要る日数。**滞在中の生存の採取は現地で払わない**——補給を持ち込む
 * 行程（GameEndings.md 9.2節）として数えるので、暗い土地でも滞在そのものは成立する。
 *
 * 縛るのは2つ。1日に進む探索はその土地で探索できる時間を超えられず、行程全体では往復の移動も
 * 屋外の枠から出る。
 */
function stayOverDaysOf(day: LocationTypeDay, roundTripMinutes: number): number {
  return Math.max(
    Math.ceil(day.explorationMinutes / day.exploringMinutesPerDay),
    Math.ceil((day.explorationMinutes + roundTripMinutes) / OUTDOOR_WINDOW_MINUTES),
  );
}

/**
 * 山の配分ごとに行き先を1つ選んで、1日を組み立てる。**選ぶのはその日の実入りが最も多い土地**
 * （同じなら近いほう）——同じ組のどの土地でも同じ仕事ができると置いているので、遠さと暗さの
 * 釣り合いはこの1つの比較に落ちる。
 *
 * **配分は仕事の量の配分であって、日数の配分ではない。** 1日は1つの土地で使うので、ある組へ費やす
 * 日数はその組の仕事量をその土地の1日の実入りで割ったものになり、**1日に進む山は日数で重み付けした
 * 平均**になる。仕事量の割合でそのまま平均すると、実入りの少ない土地に居る日を短く数えてしまう。
 *
 * **島に無い組の配分は、ある組へ按分する。** 無い土地からは採れない。**島にあって日帰りで届かない
 * 組は按分しない**——無いのではなく届かないだけなので、その山は消えずにそこへ残る。届かない組が
 * 1つでもあれば、この拠点は定常の局面を持たない（undefined）。
 */
function steadyPhaseOf(
  distances: readonly number[][],
  days: readonly LocationTypeDay[],
  base: number,
  budget: DailyBudget,
): SteadyPhase | undefined {
  const found: { label: string; roundTripMinutes: number; workMinutesPerDay: number; share: number }[] = [];

  for (const workShare of WORK_SHARES) {
    const best = bestDestinationOf(distances, days, base, workShare, budget);
    if (best === undefined) continue;
    if (best.workMinutesPerDay === 0) return undefined;

    found.push({ label: workShare.label, share: workShare.share, ...best });
  }
  if (found.length === 0) throw new Error('山の配分に載っている土地が島に1つもありません。');

  const dayWeights = found.map((share) => share.share / share.workMinutesPerDay);
  const totalDayWeight = dayWeights.reduce((sum, weight) => sum + weight, 0);
  const shares = found.map((share, i) => ({
    label: share.label,
    roundTripMinutes: share.roundTripMinutes,
    workMinutesPerDay: share.workMinutesPerDay,
    dayShare: dayWeights[i] / totalDayWeight,
  }));

  const weightedSumOf = (valueOf: (share: SteadyPhaseShare) => number): number =>
    shares.reduce((sum, share) => sum + share.dayShare * valueOf(share), 0);

  return {
    travelMinutesPerDay: weightedSumOf((share) => share.roundTripMinutes),
    workMinutesPerDay: weightedSumOf((share) => share.workMinutesPerDay),
    shares,
  };
}

/** その組の土地のうち、1日に進む山が最も多いもの。組の土地が島に無ければundefined。 */
function bestDestinationOf(
  distances: readonly number[][],
  days: readonly LocationTypeDay[],
  base: number,
  workShare: WorkShare,
  budget: DailyBudget,
): { roundTripMinutes: number; workMinutesPerDay: number } | undefined {
  let best: { roundTripMinutes: number; workMinutesPerDay: number } | undefined;

  for (const [site, day] of days.entries()) {
    if (!workShare.locationDefNames.includes(day.locationDefName)) continue;

    const roundTripMinutes = 2 * distances[base][site];
    const candidate = {
      roundTripMinutes,
      workMinutesPerDay: workMinutesPerDayOf(day.gatheringMinutesPerDay, roundTripMinutes, budget),
    };
    if (best === undefined || isBetterDestination(candidate, best)) best = candidate;
  }
  return best;
}

function isBetterDestination(
  candidate: { roundTripMinutes: number; workMinutesPerDay: number },
  incumbent: { roundTripMinutes: number; workMinutesPerDay: number },
): boolean {
  return candidate.workMinutesPerDay !== incumbent.workMinutesPerDay
    ? candidate.workMinutesPerDay > incumbent.workMinutesPerDay
    : candidate.roundTripMinutes < incumbent.roundTripMinutes;
}

/**
 * 局面をまたいで共有する、1日の勘定そのもの（このファイルのクラスコメント）。**局面が違っても
 * 変わるのは頭打ち（`capMinutes`）だけ**——そこで何をするかは、その土地でその仕事ができる時間として
 * しか式に現れない。
 */
function workMinutesPerDayOf(capMinutes: number, roundTripMinutes: number, budget: DailyBudget): number {
  return Math.max(0, Math.min(windowMinutesOf(roundTripMinutes, budget), capMinutes));
}

/** 頭打ちに掛ける前の、その日その土地で使える枠（分）。**往復で尽きれば負**で、その日は行けない。 */
function windowMinutesOf(roundTripMinutes: number, budget: DailyBudget): number {
  return OUTDOOR_WINDOW_MINUTES - roundTripMinutes - budget.survivalGatheringMinutes;
}

function locationTypeDayOf(
  locationDays: ReadonlyMap<number, LocationTypeDay>,
  map: IslandMap,
  site: number,
): LocationTypeDay {
  const day = locationDays.get(map.sites[site].type!.objectDefGlobalId);
  if (day === undefined) throw new Error(`サイト ${site} の土地の型が、土地ごとの実測に載っていません。`);
  return day;
}

/**
 * その土地を探索率100%まで開くのに要る時間（分）。進捗は探索1回につき1進むので、上限の回数だけ
 * 探索すれば届く（ExplorationSystem.md 2節）。
 */
function explorationMinutesOf(codex: WorldCodex, locationDef: ObjectDef): number {
  const range = locationDef.tryGetPropertyDef(codex.vocabulary.world.explorationProgressId)?.range;
  if (range === undefined)
    throw new Error(`土地 '${locationDef.name}' がexploration_progressのrangeを宣言していません。`);

  const explore = craftingStepsOf(codex, locationDef).find(
    (step) => step.kind === 'interaction' && step.name === codex.vocabulary.world.exploreAction,
  );
  if (explore === undefined) throw new Error(`土地 '${locationDef.name}' が探索を宣言していません。`);

  return range.max * explore.laborMinutes;
}

/** その土地で1日にその列ぶん動ける時間（分/日）。季節ごとの行を平均する。 */
function minutesPerDayOf(
  activityHours: readonly ActivityHoursRow[],
  locationDefName: string,
  hoursOf: (row: ActivityHoursRow) => number,
): number {
  const rows = activityHours.filter((row) => row.locationName === locationDefName);
  if (rows.length === 0) throw new Error(`土地 '${locationDefName}' が活動時間の表に載っていません。`);

  return (rows.reduce((sum, row) => sum + hoursOf(row), 0) / rows.length) * 60;
}

/** 配分の検査。1つの型が2つの組に現れることも、どの組にも現れないことも許さない。 */
function assertWorkSharesCover(locationDefNames: readonly string[]): void {
  const declared = WORK_SHARES.flatMap((workShare) => workShare.locationDefNames);
  const duplicated = declared.filter((name, i) => declared.indexOf(name) !== i);
  if (duplicated.length > 0)
    throw new Error(`山の配分に同じ土地が複数の組で現れています（${[...new Set(duplicated)].join('・')}）。`);

  const missing = locationDefNames.filter((name) => !declared.includes(name));
  if (missing.length > 0)
    throw new Error(`探索できる土地 ${missing.join('・')} が、山の配分（WORK_SHARES）に現れていません。`);

  const unknown = declared.filter((name) => !locationDefNames.includes(name));
  if (unknown.length > 0)
    throw new Error(`山の配分の ${unknown.join('・')} が、探索できる土地として定義されていません。`);
}

/** 全点間の最短移動時間（分）。土地は高々20個なのでWarshall-Floyd法で足りる。 */
function shortestPathMinutes(map: IslandMap): number[][] {
  const n = map.sites.length;
  const distances = Array.from({ length: n }, (_, from) =>
    Array.from({ length: n }, (_, to) => (from === to ? 0 : Number.POSITIVE_INFINITY)),
  );
  for (const edge of map.edges) {
    distances[edge.a][edge.b] = Math.min(distances[edge.a][edge.b], edge.travelMinutes);
    distances[edge.b][edge.a] = distances[edge.a][edge.b];
  }

  for (let via = 0; via < n; via++)
    for (let from = 0; from < n; from++)
      for (let to = 0; to < n; to++) {
        const viaCost = distances[from][via] + distances[via][to];
        if (viaCost < distances[from][to]) distances[from][to] = viaCost;
      }

  return distances;
}

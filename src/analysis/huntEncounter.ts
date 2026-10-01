import type { ConditionalReading, EffectReader, PickReading } from '../domain/EffectReader';
import type { PropertyGlobalId, SlotGlobalId } from '../domain/GlobalId';
import type { Combination } from '../domain/Interaction';
import type { ObjectDef } from '../domain/ObjectDef';
import type { Rng } from '../domain/Rng';
import { seededRng } from '../domain/Rng';
import type { WorldCodex } from '../domain/WorldCodex';
import type { WorldObject } from '../domain/WorldObject';
import { WorldSession } from '../domain/WorldSession';

/**
 * 狩りの遭遇を、同梱の定義（`src/assets/world-codex/**`）のまま実際に通して手数を数える
 * （docs/engine/HuntingSystem.md）。
 *
 * **静的な集計では出ない値のためにある。** 何手で逃げに転じるか、槍と斧で結末がどう違うか、
 * こちらが何箇所やられるかは、獣の1手（同5節）とこちらの一撃（同1.2節）を交互に回して、
 * 実際に起きたことを数えるまで決まらない。数える側は `tests/diagnostics/huntStatsReport.test.ts`、
 * 書き出す先は `stats/hunt.yaml`、読み方は `docs/diagnostics/HuntStats.md`。
 *
 * **1回の遭遇はシード1つで決まる。** 引きを固定する（テストの`fixedRng`）のではなく列を回すので、
 * 「この引きならこうなる」ではなく「何回に1回こうなる」が出る。
 */

/** 遭遇がどう終わったか。 */
export type HuntEncounterEnding =
  /** 獣の血が尽きた（死体になった）。 */
  | 'felled'
  /** 獣が隣の土地へ逃げた（殴る側がその場に居るうちに限る）。 */
  | 'fled'
  /** 獣が立ち去った（`stay_remaining`が尽きて世界から消えた）。 */
  | 'left'
  /** 打ち切りまで決着しなかった。 */
  | 'undecided';

/** 1回の遭遇の記録。 */
export interface HuntEncounter {
  /** 決着までに回った手数（tick）。決着しなければ打ち切りの手数。 */
  readonly turns: number;
  readonly ending: HuntEncounterEnding;
  /** 獣が気を失った手数。最後まで立っていたならundefined。 */
  readonly turnsUntilDowned: number | undefined;
  /** 獣が現れたときの警戒と、その段の名前。 */
  readonly warinessAtStart: number;
  readonly warinessStageAtStart: string | undefined;
  /**
   * 獣が落ち着く（攻め手も逃走も抽選から外れる）までの手数。**近寄れるようになるまで**で、
   * 決着が先に来たならundefined。
   */
  readonly turnsUntilCalm: number | undefined;
  /** 獣の警戒が尽きて掴めるようになるまでの手数（HuntingSystem.md 4節）。 */
  readonly turnsUntilUnguarded: number | undefined;
  /** 殴った側が負った怪我の数。 */
  readonly woundsTaken: number;
  /** 殴った回数。**外した回も数える**（振れば道具は減り、相手の気は立つ）。 */
  readonly strikes: number;
  /** 獣が引いた手の内訳（signalの名前→回数）。様子見は{@link LURKED}で数える。 */
  readonly beastMoves: ReadonlyMap<string, number>;
  /** こちらの一撃の内訳（signalの名前→回数）。殴らなかった遭遇では空。 */
  readonly strikeOutcomes: ReadonlyMap<string, number>;
}

/** 遭遇の組み方。 */
export interface HuntEncounterSetup {
  /** 対峙する獣（`animals.yaml`の型の名前）。 */
  readonly animalName: string;
  /** 手に持つ武器（`tools.yaml`）。**undefinedなら素手**——獣の1手だけを数える。 */
  readonly weaponName?: string;
  /**
   * 手にした武器を実際に振るか（既定は振る）。**falseなら構えているだけ**で、間合いの効き
   * （HuntingSystem.md 1.2節）だけが1手の顔ぶれに出る。
   */
  readonly striking?: boolean;
  /** 獣に開けておく逃げ道の本数。0なら逃走の候補が抽選に出ない（HuntingSystem.md 5.3節）。 */
  readonly escapeRoutes: number;
  /** 足元に並べておく物（`quarry`でないものは持ち去りの、`fragile`なものは体当たりの相手になる）。 */
  readonly groundItems: readonly string[];
  /** 獣の警戒の初期値。undefinedなら定義のまま。 */
  readonly startingWariness?: number;
  /**
   * 獣の意識の初期値。undefinedなら定義のまま（満たされた状態）。**押し下げている当人は問わない**
   * ——痛み・失血・衝撃はどれも意識へ合流する（docs/engine/VitalsSystem.md 2節）ので、合流した後の
   * 値を置けば、何が濁らせたかによらない1手の顔ぶれ（HuntingSystem.md 5.5節）が出る。
   */
  readonly startingConsciousness?: number;
  /**
   * この手数を殴ったら、殴る側は道の通っていない土地へ退く。**退いた後は逃げられても終わらない**
   * ので、手負いの獣が世界に残る手数——追跡の窓（HuntingSystem.md 5.6節）——がそのまま`turns`に出る。
   */
  readonly strikesBeforeLeaving?: number;
  /** ここまで回して決着しなければ打ち切る。 */
  readonly turnLimit: number;
}

/** 遭遇を1回通す。**同じ`seed`からは同じ結末が返る。** */
export function runHuntEncounter(codex: WorldCodex, setup: HuntEncounterSetup, seed: number): HuntEncounter {
  return new Encounter(codex, setup, seededRng(seed)).run();
}

/** 様子をうかがった手番。**何も起きないので何も告げられない**ので、告げられなかった回として数える。 */
const LURKED = 'lurk';

/** 獣が引いた手の内訳に、様子見（告げられなかった回）を足したもの。 */
export function beastMoveCountsOf(encounter: HuntEncounter): ReadonlyMap<string, number> {
  const told = [...encounter.beastMoves.values()].reduce((sum, count) => sum + count, 0);
  return new Map([...encounter.beastMoves, [LURKED, encounter.turns - told]]);
}

/**
 * 殴る側のキャラクタ（docs/world/Characters.md）。**当たり所の重みは殴る人の狙い（`hunting_aim`）を
 * 土台に積む**（docs/world/Skills.md 5節）ので、誰が殴るかで卓が変わる——腕の差を測りたいのでは
 * ないから1人に固定する。
 */
export const HUNTER = 'medic';

/**
 * こちらの一撃が告げうる名前。獣の型が宣言する`strike`（`animals.yaml`のbeast trait）の候補から
 * 集める——ここへ書き写すと、一撃の名前を1つ足したときにそれが黙って獣の1手へ数えられる。
 */
function strikeSignalsOf(animal: ObjectDef): ReadonlySet<string> {
  const collector = new SignalCollector();
  for (const trigger of animal.triggers) {
    if (trigger.interaction.name === 'strike') trigger.interaction.readBy(collector);
  }
  return collector.names;
}

/** 効果が告げうる名前（`signal`、9.8節）を、抽選の枝も分け隔てなく集める。 */
class SignalCollector implements EffectReader {
  readonly names = new Set<string>();

  signal(name: string): void {
    this.names.add(name);
  }

  pick(reading: PickReading): void {
    reading.readEveryCandidate(this);
  }

  conditional(reading: ConditionalReading): void {
    reading.readEveryBranch(this);
  }

  set(): void {}

  add(): void {}

  spawn(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  move(): void {}
}

/**
 * 遭遇1回ぶんの世界。密林と、そこから伸びる道と、密林に立つ狩人と獣だけを置く。
 *
 * **島の生成は通さない。** 測りたいのは獣とこちらの手数で、土地の顔ぶれではない——通すと、
 * 同じ獣に何手かかるかがその周の島の形に左右される。
 */
class Encounter {
  private readonly session: WorldSession;
  private readonly jungle: WorldObject;
  /** 狩人が退く先。**密林から道が通っていない**ので、獣は追ってこないし逃げ込みもしない。 */
  private readonly refuge: WorldObject;
  private readonly hunter: WorldObject;
  private readonly animal: WorldObject;
  private readonly weapon: WorldObject | undefined;

  private readonly injuriesSlotId: SlotGlobalId;
  private readonly charactersSlotId: SlotGlobalId;
  private readonly bloodId: PropertyGlobalId;
  private readonly consciousnessId: PropertyGlobalId;
  private readonly warinessId: PropertyGlobalId;

  private readonly beastMoves = new Map<string, number>();
  private readonly strikeOutcomes = new Map<string, number>();
  private readonly strikeSignals: ReadonlySet<string>;
  private strikes = 0;
  private readonly warinessAtStart: number;
  private readonly warinessStageAtStart: string | undefined;
  private turnsUntilCalm: number | undefined;
  private turnsUntilUnguarded: number | undefined;

  constructor(
    private readonly codex: WorldCodex,
    private readonly setup: HuntEncounterSetup,
    rng: Rng,
  ) {
    this.injuriesSlotId = codex.slotNames.getId('injuries');
    this.charactersSlotId = codex.slotNames.getId('characters');
    this.bloodId = codex.propertyNames.getId('blood');
    this.consciousnessId = codex.vocabulary.world.consciousnessId;
    this.warinessId = codex.propertyNames.getId('wariness');

    this.session = new WorldSession(codex, rng);
    const world = this.session.createWorld().instance;

    this.jungle = this.spawnInto('jungle', world, 'locations');
    this.refuge = this.spawnInto('grassland', world, 'locations');
    for (let i = 0; i < setup.escapeRoutes; i++) this.openPath(world);

    this.hunter = this.spawnInto(HUNTER, this.jungle, 'characters');
    this.weapon =
      setup.weaponName === undefined ? undefined : this.spawnInto(setup.weaponName, this.hunter, 'hand');

    for (const item of setup.groundItems) this.spawnInto(item, this.jungle, 'items');
    this.animal = this.spawnInto(setup.animalName, this.jungle, 'items');
    this.strikeSignals = strikeSignalsOf(this.animal.def);
    const wariness = this.animal.getProperty(this.warinessId);
    if (setup.startingWariness !== undefined) wariness.setNumberWithoutEvents(setup.startingWariness);
    if (setup.startingConsciousness !== undefined) {
      this.animal.getProperty(this.consciousnessId).setNumberWithoutEvents(setup.startingConsciousness);
    }
    this.warinessAtStart = wariness.getEffectiveValue();
    this.warinessStageAtStart = wariness.stage?.name;
  }

  run(): HuntEncounter {
    let turnsUntilDowned: number | undefined;
    // 現れた時点で既に落ち着いている獣が居る（HuntingSystem.md 3.1節）ので、1手目より前に見る。
    this.noteWarinessArc(0);

    for (let turn = 1; turn <= this.setup.turnLimit; turn++) {
      this.session.observeSignals(
        (signal) => this.recordSignal(signal.name),
        () => this.passTurn(),
      );
      if (turnsUntilDowned === undefined && this.isDowned()) turnsUntilDowned = turn;
      this.noteWarinessArc(turn);
      if (this.strikes === this.setup.strikesBeforeLeaving) this.withdrawHunter();

      const ending = this.endingAfterTurn();
      if (ending !== undefined) return this.finish(turn, ending, turnsUntilDowned);
    }
    return this.finish(this.setup.turnLimit, 'undecided', turnsUntilDowned);
  }

  /**
   * 1手ぶん進める。**武器を手にしているなら、殴ることがそのまま時間の経過になる**（strikeは15分＝
   * 1tick、HuntingSystem.md 2節）ので、殴る回と時間を進める回を別に数えない。
   */
  private passTurn(): void {
    const strike = this.strikeNow();
    if (strike?.tryExecute() === true) {
      this.strikes++;
      return;
    }
    this.session.advanceWorldTime(this.session.world!.rawMinutesPerTick);
  }

  /** 今この手番で振れる一撃。構えているだけ・武器が無い・獣が手の届く所に居ないなら振らない。 */
  private strikeNow(): Combination | undefined {
    if (this.setup.striking === false) return undefined;
    if (this.weapon === undefined || this.animal.parent !== this.hunter.parent) return undefined;
    return this.animal.combinationsWith(this.weapon, this.hunter).find((c) => c.name === 'strike');
  }

  /** 狩人が、道の通っていない土地へ退く。以後この世界に獣を見ている者は誰も居ない。 */
  private withdrawHunter(): void {
    this.hunter.moveToSlotOrRejection(this.refuge.getSlot(this.charactersSlotId));
  }

  /**
   * この手番で告げられたことを数える。**獣の1手とこちらの一撃は同じ回に告げられる**ので、
   * 名前で分ける（どちらの卓の候補かは、卓の側にしか書かれていない）。
   */
  private recordSignal(name: string): void {
    const table = this.strikeSignals.has(name) ? this.strikeOutcomes : this.beastMoves;
    table.set(name, (table.get(name) ?? 0) + 1);
  }

  /**
   * 警戒が引いていく途中の目盛りを控える。**どちらも一度きり**——殴れば警戒は戻るが、
   * 測りたいのは「現れてから最初に近寄れる／掴めるまで」だから。
   */
  private noteWarinessArc(turn: number): void {
    const wariness = this.animal.tryGetProperty(this.warinessId);
    if (wariness === undefined) return;
    if (this.turnsUntilCalm === undefined && wariness.stage?.name === 'calm') this.turnsUntilCalm = turn;
    if (this.turnsUntilUnguarded === undefined && wariness.getEffectiveValue() <= 0) {
      this.turnsUntilUnguarded = turn;
    }
  }

  /** 獣が気を失っているか（VitalsSystem.md 5節。決着は死ではなく気絶で付く）。 */
  private isDowned(): boolean {
    return (
      this.animal
        .tryGetProperty(this.consciousnessId)
        ?.isInStage(this.codex.vocabulary.world.unconsciousStage) ?? false
    );
  }

  /**
   * 決着が付いたか。**血が尽きたかを先に見る**——逃げた同じ手番に倒れることがあり、死体はその獣が
   * 居た土地に湧く（`blood`の`on_min`）ので、消えた場所を数えると取り違える。
   */
  private endingAfterTurn(): HuntEncounterEnding | undefined {
    if ((this.animal.tryGetProperty(this.bloodId)?.number ?? Number.POSITIVE_INFINITY) <= 0) return 'felled';
    if (this.animal.parent === undefined) return 'left';
    if (this.animal.parent !== this.hunter.parent && this.hunter.parent === this.jungle) return 'fled';
    return undefined;
  }

  private finish(
    turns: number,
    ending: HuntEncounterEnding,
    turnsUntilDowned: number | undefined,
  ): HuntEncounter {
    return {
      turns,
      ending,
      turnsUntilDowned,
      warinessAtStart: this.warinessAtStart,
      warinessStageAtStart: this.warinessStageAtStart,
      turnsUntilCalm: this.turnsUntilCalm,
      turnsUntilUnguarded: this.turnsUntilUnguarded,
      strikes: this.strikes,
      woundsTaken: this.hunter.tryGetSlot(this.injuriesSlotId)?.contents.length ?? 0,
      beastMoves: this.beastMoves,
      strikeOutcomes: this.strikeOutcomes,
    };
  }

  /** 密林から伸びる道を1本通す。行き先は道ごとに別の土地にする（同じ先へ何本も繋がないため）。 */
  private openPath(world: WorldObject): void {
    const destination = this.spawnInto('grassland', world, 'locations');
    const path = this.spawnInto('path', this.jungle, 'fixtures');
    path
      .getProperty(this.codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(destination.instanceId);
  }

  private spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = this.session.createObject(this.codex.objectNames.getId(objectName));
    const rejection = spawned.moveToSlotOrRejection(parent.getSlot(this.codex.slotNames.getId(slotName)));
    if (rejection !== undefined) {
      throw new Error(`${objectName}を${parent.def.name}の${slotName}へ置けない: ${rejection}`);
    }
    return spawned;
  }
}

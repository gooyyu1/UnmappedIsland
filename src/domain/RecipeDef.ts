import type { WorldObject } from './WorldObject';
import type { ObjectDef } from './ObjectDef';
import type { PickEffect } from './PickEffect';
import type { TypeMatchRule } from './TypeMatchRule';
import type { Requirement, Requirements } from './Requirement';
import { ReferenceContext } from './ReferenceRoot';
import type { PropertyGlobalId } from './GlobalId';
import { MINUTES_PER_TICK } from './worldTime';

/**
 * 製作中オブジェクト（RecipeSystem.md 1節）を生成するときの軸名（GameElementDefinition.md 3.5節）。
 * 値はレシピの名前で、この軸を落とした座標——`become: {recipe: none}`——が完成品そのものを指す。
 */
export const RECIPE_AXIS = 'recipe';

/**
 * 製作中であることを表すタグ（RecipeSystem.md 5節）。生成した型はYAMLへ戻してから読み込む
 * （inProgressObjectsYaml）ので、作りかけであることもYAMLに書ける印で運ぶ。
 */
export const IN_PROGRESS_TAG = 'wip';

/**
 * 工程が要求する素材または道具1件（GameElementDefinition.md 13.1節）。
 *
 * **要求はタグでも書ける**（4.1節）。道具は
 * 「その用途に使える物」であって特定の型ではないので、刃物を`cutting_tool`で求められる。
 */
export class RecipeRequirementDef {
  /** 要求する型の指定（型そのもの、またはタグ）。 */
  readonly match: TypeMatchRule;

  readonly count: number;

  /** trueなら素材（消費される）、falseなら道具（存在確認のみ）。 */
  readonly consume: boolean;

  constructor(match: TypeMatchRule, count: number, consume: boolean) {
    if (count < 1) throw new Error(`要求の個数は1以上である必要があります（値: ${count}）。`);

    this.match = match;
    this.count = count;
    this.consume = consume;
  }

  /** この要求にcandidateDefが当てはまるか（素材・道具のどちらでも）。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.match.matches(candidateDef);
  }
}

/**
 * 短縮しきった後も工程が下回れない分数（13.5節）。**tickの刻みそのもの**
 * （[`worldTime.ts`](./worldTime.ts) の `MINUTES_PER_TICK`）で、これより短い工程は、開始時刻によって
 * 跨ぐtickの数が変わる（docs/engine/ActionSystem.md 6.2節）。
 *
 * **これは下限で止める値ではなく、宣言が守るべき下限**——短縮後にここを割る `deftness` はロード時に
 * 弾く（RecipeDeftnessDef）。黙って止めると、格子から外れた宣言が「止まっているから平気」として
 * 残り続ける。
 */
const MINIMUM_STEP_MINUTES = MINUTES_PER_TICK;

/**
 * 実行経路が腕前へ1を配るごとの分数（docs/engine/SkillSystem.md 3節）。端数は切り上げるので、
 * 30分までの手が+1、1時間の手が+2になる。
 *
 * **手作業はこの値をYAMLへ書き下す**（`add`の量。揃っているかは
 * tests/world-codex/skillsYaml.test.tsが見張る）。**レシピの工程は書ける場所が無い**ので
 * （工程が持つのは要求と仕事の量だけ、13.1節）、ここで同じ規則を引く。
 *
 * **exportしない。** 検査の側は規則から組み直した値で引き比べる（同ファイル）ので、ここを引かせると
 * 同じ式を2度書くだけになり、規則から外れても緑のままになる。
 */
const MINUTES_PER_SKILL_GAIN = 30;

/**
 * その腕がその段に届いている作り手にとって、工程1つが何分縮むか（13.5節）。
 *
 * **どの腕が・どの段から・何分縮めるかは、レシピごとに宣言する**（docs/world/Skills.md 7節）。
 * 腕の数は増減しにくく、行動の数は増減するので、**組み合わせを宣言するのは増減する側**——全レシピが
 * 読む共通の上乗せを1つ置くと、そこを触るたびに世界じゅうの工程の分数が動く。
 */
export class RecipeDeftnessDef {
  /** 速さを決める腕（`skill_*`、SkillSystem.md 3節）。作り手（agent）が持つ。 */
  readonly skillGlobalId: PropertyGlobalId;

  /** 効き始める段の名前（6.4節）。この段以上で縮む。 */
  readonly fromStage: string;

  /**
   * 縮む分数。**負の値**——手作業の側（`<操作名>_minutes`の`passives`が`modify`で積む量）と向きを
   * 揃える（docs/world/Skills.md 7節）。
   */
  readonly minutes: number;

  constructor(skillGlobalId: PropertyGlobalId, fromStage: string, minutes: number) {
    if (minutes >= 0) throw new Error(`deftnessのminutesは負の数である必要があります（値: ${minutes}）。`);

    this.skillGlobalId = skillGlobalId;
    this.fromStage = fromStage;
    this.minutes = minutes;
  }

  /** agentがこの段に届いているか。届いていなければ工程は宣言どおりの分数。 */
  appliesTo(agent: WorldObject): boolean {
    return agent.tryGetProperty(this.skillGlobalId)?.isInStage(this.fromStage, 'or_above') === true;
  }
}

/** レシピの工程1つ（13.1節）。 */
export class RecipeStepDef {
  /**
   * この工程が要求する素材と道具（13.1節）。**1つも要求しない工程が在りうる**——1回の工程が1時間を
   * 超えられない（docs/engine/ActionSystem.md 6.3節）ので、長い仕事は素材を使い切った後も工程が
   * 続く。要求を無理に散らすと、その工程で実際に使う物とずれる。
   */
  readonly requirements: readonly RecipeRequirementDef[];

  /**
   * この工程が宣言した仕事の量を、ゲーム内時間（分）で表したもの。
   *
   * **作り手が実際に費やす時間とは別**（作り手の手際ぶん短くなる、`RecipeDef.minutesFor`）。進捗が
   * 数えるのはこちら——片付いた仕事の量は腕によらないので、進捗の上限（RecipeSystem.md 1節）は
   * ロード時に決まったままでいられる。
   */
  readonly durationMinutes: number;

  constructor(requirements: readonly RecipeRequirementDef[], durationMinutes: number) {
    if (durationMinutes <= 0)
      throw new Error(`工程の所要時間は正の数である必要があります（値: ${durationMinutes}）。`);

    this.requirements = requirements;
    this.durationMinutes = durationMinutes;
  }

  /** この工程がcandidateDefを要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.requirements.some((requirement) => requirement.requires(candidateDef));
  }
}

/**
 * レシピ1つ（13節）。成果物のObjectDefが持つ。
 *
 * `conditions`は**このレシピを知っているか**を判定するもので、素材が揃っているかとは別物
 * （素材の充足は`steps.requires`が持つ）。判定する時点では成果物のインスタンスがまだ無いので、そこを
 * 起点に辿る参照は解決先を持たない（何を書けるかはReferenceScope.acting.withoutSelfが決める）。
 */
export class RecipeDef {
  readonly name: string;

  readonly steps: readonly RecipeStepDef[];

  /** 解放条件（SkillSystem.md 4節）。undefinedなら最初から解放されている。 */
  readonly unlock: Requirements | undefined;

  /**
   * 作り手の腕が工程の時間へ効く宣言（docs/world/Skills.md 7節）。名乗っていなければundefined＝腕は
   * 速さに効かない。
   *
   * **名乗れるのは1つだけ。** 上位のレシピは複数の腕を連言で要求する（SkillSystem.md 4.1節）が、
   * そこからはどの腕が速さを決めるか1つに定まらないので、作る側が名乗る。
   */
  readonly deftness: RecipeDeftnessDef | undefined;

  /**
   * 完成した瞬間に1回だけ引く、余分が取れるかの卓（13.5節）。宣言していなければundefined＝
   * 何個作っても1つしかできない物。
   */
  readonly surplus: PickEffect | undefined;

  constructor(
    name: string,
    steps: readonly RecipeStepDef[],
    unlock: Requirements | undefined,
    deftness: RecipeDeftnessDef | undefined,
    surplus: PickEffect | undefined,
  ) {
    if (steps.length === 0) throw new Error(`レシピ'${name}': stepsは1件以上必要です。`);
    // **縮めきった後の分数も、tickの刻みを割らない**（docs/engine/ActionSystem.md 6.2節）。止めるのは
    // ここ——黙って下限で止めると、格子から外れた宣言が世界に残り、腕を上げた者だけがtickを飛ばす。
    if (deftness !== undefined)
      for (const step of steps)
        if (step.durationMinutes + deftness.minutes < MINIMUM_STEP_MINUTES)
          throw new Error(
            `レシピ'${name}': ${step.durationMinutes}分の工程をdeftnessが${-deftness.minutes}分縮めると` +
              `${MINIMUM_STEP_MINUTES}分を割ります。`,
          );

    this.name = name;
    this.steps = steps;
    this.unlock = unlock;
    this.deftness = deftness;
    this.surplus = surplus;
  }

  /**
   * agentがその工程に実際に費やすゲーム内時間（分）。宣言された仕事の量から、作り手の腕が届いて
   * いれば宣言された分だけ縮めた値（13.5節）。腕を名乗っていない、または作り手がその段に届いて
   * いないなら宣言どおり。
   *
   * **問うのは「この者にとって何分か」なのでagentは必ず要る**（解放条件`unmetUnlockRequirement`と
   * 同じ形）。誰にとってでもない分数は、工程が宣言した仕事の量（`durationMinutes`）が直接答える。
   */
  minutesFor(step: RecipeStepDef, agent: WorldObject): number {
    const deftness = this.deftness;
    return deftness !== undefined && deftness.appliesTo(agent)
      ? step.durationMinutes + deftness.minutes
      : step.durationMinutes;
  }

  /**
   * 工程を1つ終えた作り手の腕前を、実行経路のぶんだけ伸ばす（docs/engine/SkillSystem.md 3.4節）。
   *
   * **伸ばす腕を決めるのは`deftness`の名乗り**（13.5節）——どのレシピがどの腕の仕事かを言う宣言は
   * これしか無いので、速さと伸びは同じ1本が決める。名乗っていないレシピは、どの腕の仕事でもないと
   * 決めた印なので何もしない。
   *
   * **量は工程が宣言した仕事の量から決まり、手際で縮んだ時間からではない**——縮んだぶんは同じ量が
   * 短い時間で届く形になり、手作業で腕が上がったときと揃う（同3節）。
   */
  advanceSkillOf(agent: WorldObject, step: RecipeStepDef): void {
    const deftness = this.deftness;
    if (deftness === undefined) return;
    agent
      .tryGetProperty(deftness.skillGlobalId)
      ?.add(Math.ceil(step.durationMinutes / MINUTES_PER_SKILL_GAIN));
  }

  /**
   * 全工程が宣言した仕事の量の合計（分）。完成までの進捗の上限そのもの。
   *
   * **作り手が費やす時間の合計ではない**（手際のぶん短くなる、`minutesFor`）。上限が誰にとっても
   * 同じでなければ、作りかけの進捗が作り手ごとに違う意味を持つことになる。
   */
  get totalMinutes(): number {
    return this.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
  }

  /** このレシピがcandidateDefを、どこかの工程で素材か道具として要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.steps.some((step) => step.requires(candidateDef));
  }

  /**
   * agentが解放条件を満たしていない場合、最初に落ちた要件。満たしていればundefined。
   *
   * 未解放のレシピも一覧へ出し、そこでなぜ作れないかを言うため、可否と理由を1回の評価から得る
   * （Requirements.firstUnmet と同じ理由）。
   *
   * **問うのは「この者にとって解放されているか」なので、agentは必ず要る**（13.2節）。誰にとってでも
   * ない「解放条件を持つか」は`unlock`が直接答える。
   */
  unmetUnlockRequirement(agent: WorldObject): Requirement | undefined {
    // まだ成果物のインスタンスが無いので、selfを持たない文脈で評価する（13.2節）——selfを起点に辿る
    // 参照はそのまま解決先を持たない。
    return this.unlock?.firstUnmet(ReferenceContext.asking(agent));
  }
}

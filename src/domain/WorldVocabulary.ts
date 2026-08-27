import type { NameRegistry } from './NameRegistry';

/**
 * 製作中オブジェクト（RecipeSystem.md 1節）を組み立てるのに要る語——自分で持つ進捗・工程数・材料枠と、
 * 完成品から写すかさ（volume）。
 *
 * **文字列のまま要るのはローダだけ**（inProgressObjects）。型の宣言を組み立てる時点ではまだCodexが無く、
 * IDを引けないため。実行時に読む側はIDを使う（EngineVocabulary）ので、語はここに1度書くだけで済む。
 */
export const PROGRESS_PROPERTY = 'progress';
export const FINISHED_STEPS_PROPERTY = 'finished_steps';
export const MATERIALS_SLOT = 'materials';
export const VOLUME_PROPERTY = 'volume';

/**
 * **コードがYAMLの単語へ寄せている依存の一覧。** ここに無い単語をコードが直に引いていたら、それは
 * 一覧から漏れている——「この単語をYAMLから消したら何が壊れるか」を1箇所で答えられるようにするための表。
 *
 * ロード処理の最後、全ての名前のinternが終わったタイミングで1回だけ構築する。
 *
 * **IDはinternで取る（無ければ作る）。** 引いた名前を誰も宣言していなければ、そのIDを持つ物は世界に
 * 1つも居ないので、「この物はそれを持つか」を訊けば自然に「持たない」が返る。**語彙の有無を分岐に
 * 使わない**のはそのためで、`number | undefined`も「絶対マッチしないID」も要らない。
 *
 * **オブジェクト型の名前とアクション名は、IDではなく文字列で持つ。** 型のIDはObjectDefTableの添字に
 * なるので、宣言されていない名前をinternすると範囲外を指す。アクションは元々名前で引く（tryGetAction）。
 *
 * **載せるのは、コード側にリテラルとして書かれている単語だけ。** シナリオYAMLやURLに書かれた名前を
 * 引く箇所（Scenario・CodexView）はユーザーの語であって、コードの依存ではない。
 *
 * **載せるのは単語であって、規則ではない。** 「このタグならこの枠色」「この段に居たら覆いを出す」の
 * ような対応は読む側（cardLooks）に残る——ここが答えるのは「その語をYAMLから消したら何が壊れるか」
 * だけで、消えた結果どう見えるかは知らない。
 *
 * **結果と対でしか意味を持たない名前は載せない**（cardLooks の `cooking_progress`・`treatment` など）。
 * あれらは「その値が進んでいたら覆いを出す」という規則の一部で、名前だけを引き剥がすと規則が
 * 2箇所に割れる。種別を言うタグ（item・animal など）はそうではなく、**この世界に何が居るかを言う語**
 * なので、他の規約プロパティと同じくここに並ぶ。
 *
 * **実測値の表の鍵も載せない**（analysis/seasonalRain の季節名・天候の名前）。あれらは
 * シミュレーションで測った数値に付いた行名で、名前と数値で1つ。世界を変えたときに古くなるのは
 * 数値のほうで、それはこの一覧が答えられることではない。
 */
export class WorldVocabulary {
  readonly engine: EngineVocabulary;
  readonly world: WorldRuleVocabulary;

  constructor(propertyNames: NameRegistry, slotNames: NameRegistry, tagNames: NameRegistry) {
    this.engine = new EngineVocabulary(propertyNames, slotNames);
    this.world = new WorldRuleVocabulary(propertyNames, slotNames, tagNames);
  }
}

/**
 * エンジンの汎用ロジックが規約として直接読み書きする単語。**どんなYAMLを載せ替えても変わらない。**
 *
 * - volume: かさ（mL）。capacityの検証（Slot.rejectionFor）が使う。
 * - fill: 中身入りの変種（3.5節）が抱えている量。0になった変種は素の型へ戻る。
 * - weight: 物の重さ。子のweightをそのまま合算する（率はかけない）。
 * - density: 単位量あたりの重さ（g/mL。水=1）。fill × density が中身の重さになる。
 * - load: 担いだ人が感じる負荷。直接の子のweightに、その子のload_rateを効かせた分。
 * - load_rate: 担ぎ方による体感の割合（宣言しなければ素の重さがそのまま効く）。
 * - progress / finished_steps / materials: 製作中オブジェクトの進捗・工程数・材料枠（RecipeSystem.md）。
 */
export class EngineVocabulary {
  readonly volumeId: number;
  readonly fillId: number;
  readonly weightId: number;
  readonly densityId: number;
  readonly loadId: number;
  readonly loadRateId: number;

  readonly progressId: number;
  readonly finishedStepsId: number;
  readonly materialsSlotId: number;

  constructor(propertyNames: NameRegistry, slotNames: NameRegistry) {
    this.volumeId = propertyNames.intern(VOLUME_PROPERTY);
    this.fillId = propertyNames.intern('fill');
    this.weightId = propertyNames.intern('weight');
    this.densityId = propertyNames.intern('density');
    this.loadId = propertyNames.intern('load');
    this.loadRateId = propertyNames.intern('load_rate');

    this.progressId = propertyNames.intern(PROGRESS_PROPERTY);
    this.finishedStepsId = propertyNames.intern(FINISHED_STEPS_PROPERTY);
    this.materialsSlotId = slotNames.intern(MATERIALS_SLOT);
  }
}

/**
 * この世界のルールが依存する単語（`src/assets/world-codex`）。エンジンの語と違い、**別の世界を書けば
 * 変わりうる**——変わったときに何が動かなくなるかが、この一覧の中身そのもの。
 *
 * 使い手は `domain/wrappers`・`domain/generation`・`analysis` と、`WorldObject` の抵抗の判定
 * （`resists`、GameElementDefinition.md 7.13節）。いずれも名前を「値や集合を引く鍵」としてだけ使っていて、
 * どの名前かに他の判断が依存しない。
 */
export class WorldRuleVocabulary {
  // ---- 時間と気候（ClimateSystem.md、wrappers/World） ----
  readonly dayId: number;
  readonly hourId: number;
  readonly minuteId: number;
  readonly minutesPerTickId: number;
  readonly weatherId: number;
  readonly ambientBrightnessId: number;
  readonly ambientTemperatureId: number;

  // ---- キャラクタ（docs/world/Characters.md、wrappers/PlayerCharacter） ----
  readonly hpId: number;
  readonly satietyId: number;
  readonly handSlotId: number;
  readonly equipmentSlotId: number;
  readonly injuriesSlotId: number;

  // ---- 土地と道（ExplorationSystem.md、wrappers/Location・wrappers/Path・generation） ----
  readonly explorationProgressId: number;
  readonly requiredProgressId: number;
  readonly destinationIdId: number;
  readonly returnPathIdId: number;
  readonly travelMinutesId: number;
  readonly locationsSlotId: number;
  readonly itemsSlotId: number;
  readonly fixturesSlotId: number;
  readonly charactersSlotId: number;
  readonly undiscoveredFixturesSlotId: number;

  // ---- 種別を言うタグ ----
  readonly locationTagId: number;
  readonly characterTagId: number;
  readonly pathTagId: number;

  /**
   * 海区（`voyage.yaml`）。**島の土地と同じ場所**（location＋explorable）なので、島だけを数える側は
   * これで見分ける（`analysis/islandLocations`）。
   */
  readonly seaTagId: number;

  /**
   * 物が何であるかを言うタグ。**兼ねる物がある**（動物はitemでもあり、編み籠はitemでもfixtureでもある）
   * ので、どれを先に見るかは読む側が決める（cardLooks.kindOf）。
   */
  readonly itemTagId: number;
  readonly fixtureTagId: number;
  readonly injuryTagId: number;
  readonly animalTagId: number;
  readonly foodTagId: number;
  readonly containerTagId: number;
  readonly liquidContainerTagId: number;
  readonly toolTagId: number;

  /** 周回の終わりを読む（docs/concept/GameEndings.md）。本土へ渡り、持ち帰った秘宝を数える。 */
  readonly mainlandTagId: number;
  readonly artifactTagId: number;

  // ---- 名前で指して実行するアクション（IDではなく名前で引く、ActionSystem.md 1節） ----
  readonly exploreAction = 'explore';
  readonly travelAction = 'travel';

  // ---- 名指しで引くオブジェクト型（IDはObjectDefTableの添字なのでinternできない） ----
  readonly worldObject = 'world';
  readonly pathObject = 'path';

  constructor(propertyNames: NameRegistry, slotNames: NameRegistry, tagNames: NameRegistry) {
    this.dayId = propertyNames.intern('day');
    this.hourId = propertyNames.intern('hour');
    this.minuteId = propertyNames.intern('minute');
    this.minutesPerTickId = propertyNames.intern('minutes_per_tick');
    this.weatherId = propertyNames.intern('weather');
    this.ambientBrightnessId = propertyNames.intern('ambient_brightness');
    this.ambientTemperatureId = propertyNames.intern('ambient_temperature');

    this.hpId = propertyNames.intern('hp');
    this.satietyId = propertyNames.intern('satiety');
    this.handSlotId = slotNames.intern('hand');
    this.equipmentSlotId = slotNames.intern('equipment');
    this.injuriesSlotId = slotNames.intern('injuries');

    this.explorationProgressId = propertyNames.intern('exploration_progress');
    this.requiredProgressId = propertyNames.intern('required_progress');
    this.destinationIdId = propertyNames.intern('destination_id');
    this.returnPathIdId = propertyNames.intern('return_path_id');
    this.travelMinutesId = propertyNames.intern('travel_minutes');
    this.locationsSlotId = slotNames.intern('locations');
    this.itemsSlotId = slotNames.intern('items');
    this.fixturesSlotId = slotNames.intern('fixtures');
    this.charactersSlotId = slotNames.intern('characters');
    this.undiscoveredFixturesSlotId = slotNames.intern('undiscovered_fixtures');

    this.locationTagId = tagNames.intern('location');
    this.characterTagId = tagNames.intern('character');
    this.pathTagId = tagNames.intern('path');
    this.seaTagId = tagNames.intern('sea');
    this.itemTagId = tagNames.intern('item');
    this.fixtureTagId = tagNames.intern('fixture');
    this.injuryTagId = tagNames.intern('injury');
    this.animalTagId = tagNames.intern('animal');
    this.foodTagId = tagNames.intern('food');
    this.containerTagId = tagNames.intern('container');
    this.liquidContainerTagId = tagNames.intern('liquid_container');
    this.toolTagId = tagNames.intern('tool');

    this.mainlandTagId = tagNames.intern('mainland');
    this.artifactTagId = tagNames.intern('artifact');
  }
}

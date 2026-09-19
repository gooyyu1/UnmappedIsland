import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRAVEL_MINUTES_STEP } from '../../src/domain/generation/PathNetworkBuilder';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * fire.yamlの火の連鎖を、実ファイルの定義だけで検証する。
 * 火口に火をつけ、火種で炉へ着火し、薪をくべ、火を育て、肉を焼き、石を積んで炉を上げるところまで。
 *
 * 火の育ちと衰えはtick駆動（docs/engine/FireSystem.md 2.2節）なので、時間を進めて観測する。
 */
describe('fire.yamlの火の連鎖', () => {
  // lightの候補は宣言順に「成功（火口のignition_chance）・失敗（10）」。乾いた枯れ草は60:10なので、
  // 0.95を引けば外れる。
  /** 火起こしに成功する引き。 */
  const LIGHTS = 0;
  /** 火起こしを外す引き。 */
  const FAILS = 0.95;

  /** 日の差さない時刻と、日差しが最も強い時刻（core.yamlのhour）。 */
  const NIGHT_HOUR = 0;
  const NOON_HOUR = 12;

  /** 強い日差しの境目（salt.yaml・drying.yamlのdrying_remainingと同じEV、IlluminationSystem.md 1節）。 */
  const STRONG_SUNLIGHT = 14;

  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let land: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 燃料（locations.yaml）・火口（coconut.yaml・fiber.yaml）・料理（animals.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
  });

  beforeEach(() => {
    // 火起こしは確率で外す。連鎖を見るテストは必ず成功する側を引く。
    open(LIGHTS);
  });

  /** 草地に立つプレイヤーから始める。rollはpickがどの候補を引くかを決める。 */
  function open(roll: number): void {
    session = new WorldSession(codex, undefined, fixedRng(roll));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    worldView = new World(worldInstance);
    session.adoptWorld(worldView);

    land = spawnInto('grassland', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, land, 'characters');
    // 火起こしは手元の明るさを要求する（IlluminationSystem.md 5節）。ここで見たいのは火の連鎖なので、
    // 時刻を作らずに火を起こす側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location).items.map((object) => object.def.name);
  }

  /** プレイヤーが手に持っている物。 */
  function carried(): string[] {
    return player.getSlot(codex.slotNames.getId('hand')).contents.map((object) => object.def.name);
  }

  /**
   * もう1つの土地と、そこへ歩く道を1本。**刻み1つぶん**（TRAVEL_MINUTES_STEP）＝生成されうる
   * いちばん短い道に縮めるのは、何が渡れて何が渡れないかを言うには、いちばん短い道で見る必要が
   * あるため——長い道で燃え尽きることは、短い道で燃え尽きることを言わない。
   */
  function roadToAnotherLand(): { destination: WorldObject; walk: () => void } {
    const destination = spawnInto('grassland', land.parent!, 'locations');
    const path = spawnInto('path', land, 'fixtures');
    path
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(destination.instanceId);
    path.getProperty(codex.propertyNames.getId('travel_minutes')).setNumberWithoutEvents(TRAVEL_MINUTES_STEP);

    return {
      destination,
      walk: (): void => {
        expect(path.tryGetAction('travel', player)?.tryExecute(), '道を歩く').toBe(true);
        expect(player.parent, '向こうの土地へ着いた').toBe(destination);
      },
    };
  }

  function effectiveNumberOf(object: WorldObject, propertyName: string): number {
    return object.tryGetProperty(codex.propertyNames.getId(propertyName))?.number ?? 0;
  }

  /** その炉の火力が指定した段にあるか。 */
  function heatIs(hearth: WorldObject, stageName: string): boolean {
    return hearth.tryGetProperty(codex.propertyNames.getId('heat'))?.isInStage(stageName) ?? false;
  }

  /** 火のついた炉を1つ作って返す（火口・火起こし具・着火まで済ませる）。 */
  function litCampfire(): WorldObject {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    lightDryGrass();

    const tinder = new Location(land).items.find((o) => o.def.name === 'burning_tinder');
    expect(tinder, '火起こしに成功している').toBeDefined();
    expect(
      hearth
        .combinationsWith(tinder!, player)
        .find((c) => c.name === 'ignite')
        ?.tryExecute() === true,
    ).toBe(true);
    return hearth;
  }

  /**
   * その物のambient_temperatureの実効値。土地（core.yamlのlocation trait）なら世界の気温を土台に
   * 炉の暖が積まれた値、worldそのものなら空の気温。
   */
  function temperatureOf(object: WorldObject): number {
    return object.getProperty(codex.propertyNames.getId('ambient_temperature')).getEffectiveValue();
  }

  /** 世界の天気を変える（core.yamlのweather）。シンボル型なので名前をIDへ直して入れる。 */
  function setWeather(weatherName: string): void {
    land
      .parent!.getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId(weatherName));
  }

  /** 種火に薪を少しくべた焚き火（火力1・薪5）。薪はfewの段なので、1tickで+2だけ育つ。 */
  function smallFire(): WorldObject {
    const hearth = spawnInto('campfire', land, 'fixtures');
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumber(5);
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumber(1);
    return hearth;
  }

  /** 炉へ燃料を1つくべる。 */
  function stoke(hearth: WorldObject, fuelName: string): void {
    const fuel = spawnInto(fuelName, land, 'items');
    expect(
      hearth
        .combinationsWith(fuel, player)
        .find((c) => c.name === 'add_fuel')
        ?.tryExecute() === true,
    ).toBe(true);
  }

  it('火起こし具は小枝と太い枝から作れて、解放条件を持たない', () => {
    const drill = codex.objects.get(codex.objectNames.getId('fire_drill'));

    expect(drill.recipesProducingThis).toHaveLength(1);
    const [step] = drill.recipesProducingThis[0].steps;
    const requires = (name: string): boolean =>
      step.requirements.some((r) => r.requires(codex.objects.get(codex.objectNames.getId(name))));
    expect(step.requirements).toHaveLength(2);
    expect(requires('thick_branch')).toBe(true);
    expect(requires('twig')).toBe(true);
    // **誰でも作れる。** これが作れないと火の腕を伸ばす操作に手が届かず、きりもみ式が道具も紐も
    // 要求しないことで保証されている立ち上がり（SkillSystem.md 3.2節）が崩れる。
    expect(drill.recipesProducingThis[0].unlock).toBeUndefined();
  });

  it('火口に火起こし具を重ねると火種ができ、火口は消える', () => {
    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(
      grass
        .combinationsWith(drill, player)
        .find((c) => c.name === 'light')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(itemsOn(land)).toEqual(['burning_tinder']);
    expect(drill.parent, '火起こし具は消費されない').toBe(player);
  });

  it('作りかけの火起こし具では火をつけられない', () => {
    // 製作中オブジェクトは働きを言うタグを持たない（RecipeSystem.md 5節）。lightが相手に指す
    // fire_drillは型そのものなので、作りかけの型（fire_drill__carved）は当てはまらない。
    const grass = spawnInto('dry_grass', land, 'items');
    const wipDrill = spawnInto(inProgressObjectName('fire_drill', 'carved'), player, 'hand');

    expect(grass.combinationsWith(wipDrill, player).map((c) => c.name)).toEqual([]);
    expect(
      grass
        .combinationsWith(wipDrill, player)
        .find((c) => c.name === 'light')
        ?.tryExecute() === true,
    ).toBe(false);
  });

  it('火が付いた回も外した回も、火口の札の上で起きたことを告げる', () => {
    // 火口はどちらの回も同じように消えるので、レーンを見ているだけでは成否が付かない
    // （docs/engine/FireSystem.md 3.1節）。
    expect(signalsOf(lightDryGrass)).toEqual(['dry_grass: lit']);

    open(FAILS);

    expect(signalsOf(lightDryGrass)).toEqual(['dry_grass: not_lit']);
    expect(itemsOn(land), '外した回は火口だけが無駄になる').toEqual([]);
  });

  /** 枯れ草へ火起こし具を重ねる。引き（open）によって火種ができるか、枯れ草だけが失われる。 */
  function lightDryGrass(): void {
    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');
    expect(
      grass
        .combinationsWith(drill, player)
        .find((c) => c.name === 'light')
        ?.tryExecute() === true,
    ).toBe(true);
  }

  /** bodyの実行中に告げられた出来事（signal、9.8節）を「誰の身に・何が」の形で並べる。 */
  function signalsOf(body: () => void): string[] {
    const seen: string[] = [];
    session.observeSignals((signal) => seen.push(`${signal.object.def.name}: ${signal.name}`), body);
    return seen;
  }

  it('火の腕が上がると火が付きやすくなる（noviceが外す引きでも、expertは火を得る）', () => {
    // 乾いた枯れ草の素の重みは60対10でnoviceは85.7%、expertは上乗せ+120が積まれて180対10で94.7%
    // （docs/world/Skills.md 5節）。引きは両方とも0.9で、動かしているのは腕だけ。
    const BETWEEN = 0.9;
    const firecraftId = codex.propertyNames.getId('skill_firecraft');

    open(BETWEEN);
    expect(signalsOf(lightDryGrass), 'noviceは外す').toEqual(['dry_grass: not_lit']);

    open(BETWEEN);
    player.getProperty(firecraftId).setNumberWithoutEvents(180);
    expect(signalsOf(lightDryGrass), 'expertは同じ引きで火を得る').toEqual(['dry_grass: lit']);
  });

  /** 世界じゅうの火口（tinderタグを名乗る型）。宣言は、それを産する物のファイルの側に散らばっている。 */
  function tinderNames(): string[] {
    const tinder = codex.tagNames.getId('tinder');
    return [...codex.objects].filter((def) => def.tags.includes(tinder)).map((def) => def.name);
  }

  /** 火の腕の各段のいちばん下の値（player_character.yamlのskill_firecraftのstages）。 */
  function firecraftStageFloors(): number[] {
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const stages = character.tryGetPropertyDef(codex.propertyNames.getId('skill_firecraft'))?.stages ?? [];
    return stages.map((stage) => stage.min ?? 0);
  }

  /**
   * 今の世界でその火口へ火起こし具を重ねる。火が付いたらtrue（火口はどちらの回も失われる）。
   * 湿りを持たせたいときは、呼ぶ前に湧かせた個体へ入れておく（下のlightChanceOf）。
   */
  function lightTinder(tinderName: string, tinder = spawnInto(tinderName, land, 'items')): boolean {
    const drill = spawnInto('fire_drill', player, 'hand');
    const lit = signalsOf(() => {
      expect(
        tinder
          .combinationsWith(drill, player)
          .find((c) => c.name === 'light')
          ?.tryExecute() === true,
        `${tinderName}へ火起こし具を重ねられる`,
      ).toBe(true);
    });
    return lit.includes(`${tinderName}: lit`);
  }

  /**
   * その湿りから始めた火口に火が付く割合。**pickは「引き×重みの合計」を累積と比べる**（fixedRng）
   * ので、**付くかどうかが切り替わる引きが、そのまま成功率**になる。それを二分で挟んで出す。
   *
   * **割合を定義から計算せずに測るのは、火起こしの2 tick（30分）のあいだにも水が抜けるから**
   * ——引きを決める時点の湿りは、始めた値と乾く速さの両方で決まる。
   */
  function lightChanceOf(tinderName: string, moisture: number): number {
    const moistureId = codex.propertyNames.getId('moisture');
    let lights = 0;
    let misses = 1;

    // 0.0005まで挟む（段の押し下げが作る差はこれよりずっと大きい）。
    for (let i = 0; i < 11; i++) {
      const roll = (lights + misses) / 2;
      open(roll);
      const tinder = spawnInto(tinderName, land, 'items');
      tinder.getProperty(moistureId).setNumberWithoutEvents(moisture);
      if (lightTinder(tinderName, tinder)) lights = roll;
      else misses = roll;
    }
    return lights;
  }

  it('乾いた火口は、どの火口・どの腕でも85%以上で火が付く', () => {
    // **この節の水準そのもの**（docs/engine/FireSystem.md 10節）。pickは「引き×重みの合計」を
    // 累積と比べる（fixedRng）ので、**引き0.85でどれも火が付くことが「成功率が85%を上回る」
    // ことそのもの**になる。外れの重みを緩めても、火口の素の値を下げても、ここが赤くなる。
    // **腕の上乗せを削っても赤くならない**——水準を縛っているのは上乗せの無いnoviceの側なので、
    // 刻みそのものを見張るのはtests/world-codex/skillsYaml.test.tsのほう。
    //
    // 火口の宣言は、それを産する物のファイルの側に散らばっている（docs/engine/FireSystem.md 概要）ので、
    // 名指しではなくtinderタグを名乗る全型を回す——後から足した火口も同じ水準を要求される。
    const FLOOR = 0.85;
    const names = tinderNames();
    const floors = firecraftStageFloors();
    const missed: string[] = [];

    expect(names.length, '火口が1つも無い').toBeGreaterThan(0);
    expect(floors.length, '火の腕の段が1つも無い').toBeGreaterThan(0);

    for (const name of names)
      for (const floor of floors) {
        open(FLOOR);
        player.getProperty(codex.propertyNames.getId('skill_firecraft')).setNumberWithoutEvents(floor);
        if (!lightTinder(name)) missed.push(`${name}（腕${floor}）`);
      }

    expect(missed, `引き${FLOOR}で外す組み合わせ`).toEqual([]);
  });

  it('濡らした火口は、乾いた火口より火が付きにくい', () => {
    // 成功率が火口の種類だけでなく乾き具合でも動くこと（docs/engine/FireSystem.md 3.2.1節）。
    // **動かしているのは湿りだけ**で、腕も天気も同じ。
    const names = tinderNames();
    const unchanged: string[] = [];

    for (const name of names) {
      const dry = lightChanceOf(name, 0);
      const soaked = lightChanceOf(name, soakedMoistureOf(name));
      if (soaked >= dry) unchanged.push(`${name}（乾いて${dry}、濡れて${soaked}）`);
    }

    expect(names.length, '火口が1つも無い').toBeGreaterThan(0);
    expect(unchanged, '濡らしても付きやすさが変わらない火口').toEqual([]);
  });

  /** その火口のmoistureの最上段（最も湿った段）のいちばん下の値。 */
  function soddenMoistureOf(tinderName: string): number {
    const def = codex.objects.get(codex.objectNames.getId(tinderName));
    const stages = def.tryGetPropertyDef(codex.propertyNames.getId('moisture'))?.stages ?? [];
    return stages[stages.length - 1]?.min ?? 0;
  }

  /** その火口のmoistureが取りうる最大（吸い切った状態）。 */
  function soakedMoistureOf(tinderName: string): number {
    const def = codex.objects.get(codex.objectNames.getId(tinderName));
    return def.tryGetPropertyDef(codex.propertyNames.getId('moisture'))?.range?.max ?? 0;
  }

  it('どの火口も、湿り具合をカードのバーとして名乗る', () => {
    // **プレイヤーが備えるには、今その火口が付きやすいかを読めなければならない。** アイテムの札で
    // それを言えるのはゲージのバーだけで（docs/ui/CardView.md 8節、段もalertもアイテムの札には
    // 出ない）、バーが出るかは`gauge`の宣言が決める（同8.1節、tests/game/cardGauges.test.tsが
    // 宣言とバーの対応そのものを見る）。ここが見るのは、**全火口がその宣言を持っていること**。
    const moistureId = codex.propertyNames.getId('moisture');
    const silent: string[] = [];

    for (const name of tinderNames()) {
      const def = codex.objects.get(codex.objectNames.getId(name));
      if (def.tryGetPropertyDef(moistureId)?.gauge === undefined) silent.push(name);
    }

    expect(silent, '湿りを画面へ出さない火口').toEqual([]);
  });

  it('どの火口も、最も湿った段でまだ火が付く余地を残す', () => {
    // 押し下げは火口によらず同じ量なので、素の値の小さい火口を足すと重みが0以下へ潰れうる
    // （重みが0以下の候補は選ばれない、GameElementDefinition.md 10.2節）。潰れた火口は、
    // 乾かしても腕を上げても**その段では絶対に付かない**——濡れているだけのはずが可否の線になる。
    const moistureId = codex.propertyNames.getId('moisture');
    const chanceId = codex.propertyNames.getId('ignition_chance');
    const dead: string[] = [];

    for (const name of tinderNames()) {
      const tinder = spawnInto(name, land, 'items');
      tinder.getProperty(moistureId).setNumberWithoutEvents(soddenMoistureOf(name));
      if (tinder.getProperty(chanceId).getEffectiveValue() <= 0) dead.push(name);
    }

    expect(dead, '最も湿った段で重みが残らない火口').toEqual([]);
  });

  it('野ざらしの火口は雨で湿り、日に広げれば乾く', () => {
    // **湿った火口を戻す手が世界に在ること**（issue #2181の完了の条件）。濡れるのも日で速く乾くのも
    // 地面に出しているあいだだけで、日差しの境目は塩田・干し場と同じ（salt.yamlのdrying_remaining）。
    const moistureId = codex.propertyNames.getId('moisture');
    const grass = spawnInto('dry_grass', land, 'items');
    const moisture = grass.getProperty(moistureId);
    const HOURS = 3;

    expect(moisture.number, '拾ったばかりの火口は乾いている').toBe(0);

    setHour(NIGHT_HOUR);
    setWeather('heavy_rain');
    session.advanceWorldTime(60 * HOURS);
    expect(moisture.isInStage('sodden'), '雨に打たれれば濡れる').toBe(true);

    setHour(NOON_HOUR);
    setWeather('clear');
    expect(
      land.getProperty(codex.propertyNames.getId('ambient_brightness')).getEffectiveValue(),
      '晴れた真昼は強い日差しの側',
    ).toBeGreaterThanOrEqual(STRONG_SUNLIGHT);
    session.advanceWorldTime(60 * HOURS);
    expect(moisture.isInStage('dry'), '日に広げれば押し下げの無い段まで戻る').toBe(true);
  });

  it('手に持った火口は雨で濡れず、それでも水は抜けていく', () => {
    // **この2つが、湿りを詰みにしない**（docs/engine/FireSystem.md 3.2.1節）。濡れるのを地面に
    // 出しているあいだだけに限らないと、雨の中を歩くだけで手持ちが全部湿り、屋根の下へ逃げ込んでも
    // そこには日が差さないので戻せない。抜けていく側を日差しだけに絞っても同じ行き止まりになる。
    const moistureId = codex.propertyNames.getId('moisture');
    const grass = spawnInto('dry_grass', player, 'hand');
    const moisture = grass.getProperty(moistureId);
    const HOURS = 3;

    setHour(NIGHT_HOUR);
    setWeather('heavy_rain');
    session.advanceWorldTime(60 * HOURS);
    expect(moisture.number, '持っていれば雨に打たれない').toBe(0);

    // 日の差さない夜のまま、抜けていく側だけを見る。
    moisture.setNumber(soakedMoistureOf('dry_grass'));
    setWeather('clear');
    const soaked = moisture.number;
    session.advanceWorldTime(60 * HOURS);
    expect(moisture.number, '日が無くても抜けていく').toBeLessThan(soaked);
  });

  /** 世界の時刻を変える（core.yamlのhour）。日差しの強さはここから決まる。 */
  function setHour(hour: number): void {
    land.parent!.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(hour);
  }

  it('雨の日は屋外で火が起こせない', () => {
    // 確率が下がるのではなく、できない側に線が引かれる（docs/engine/FireSystem.md 3.1.1節）。
    // 引きは成功する側（LIGHTS）のままなので、止めているのは天気だけ。
    setWeather('heavy_rain');
    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(
      grass.combinationsWith(drill, player).map((c) => c.name),
      '候補にも挙がらない',
    ).toEqual([]);
    expect(itemsOn(land), '外した回と違って火口も減らない').toEqual(['dry_grass']);
  });

  it('雨でも屋根の下なら火を起こせる', () => {
    // 洞窟がsheltered: 1を宣言し、火口の祖先がそこで止まる（ContainerSystem.md 6節）。
    const cave = spawnInto('shallow_cave', land, 'fixtures');
    setWeather('heavy_rain');
    expect(cave.tryGetAction('enter', player)?.tryExecute(), '屋根の下へ入る').toBe(true);
    const grass = spawnInto('dry_grass', cave, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    const light = grass.combinationsWith(drill, player).find((c) => c.name === 'light');
    expect(light, '大雨でも候補に挙がる').toBeDefined();
    expect(light?.tryExecute(), '起こせる').toBe(true);
    expect(itemsOn(cave), '洞窟の中に火種ができる').toEqual(['burning_tinder']);
  });

  it('雨の日でも、洞窟で起こした火種を外の炉へ運んで灯せる', () => {
    // 洞窟と外は同じ土地の中なので、1tickで燃え尽きる火種でも届く（3.1節）。**島から火が絶えた
    // ときに雨の中で火を戻せるのはこの道だけ**で、そこが洞窟の価値になっている——生きた炉がどこかに
    // 在るなら、雨でも松明を運べばよい（下の「雨の屋外でも…」）。
    const cave = spawnInto('shallow_cave', land, 'fixtures');
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    setWeather('heavy_rain');

    expect(cave.tryGetAction('enter', player)?.tryExecute(), '洞窟へ入る').toBe(true);
    const grass = spawnInto('dry_grass', cave, 'items');
    const drill = spawnInto('fire_drill', cave, 'items');
    expect(
      grass
        .combinationsWith(drill, player)
        .find((c) => c.name === 'light')
        ?.tryExecute(),
      '中では起こせる',
    ).toBe(true);

    const tinder = new Location(cave).items.find((o) => o.def.name === 'burning_tinder');
    expect(tinder, '火種ができている').toBeDefined();
    expect(tinder!.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
    expect(cave.tryGetAction('leave', player)?.tryExecute(), '火種を持って外へ出る').toBe(true);

    const ignite = hearth.combinationsWith(tinder!, player).find((c) => c.name === 'ignite');
    expect(ignite, '屋外の炉へ落とせる').toBeDefined();
    expect(ignite?.tryExecute()).toBe(true);
    expect(heatIs(hearth, 'ember'), '雨の中の炉にも種火が立つ').toBe(true);
  });

  it('枝は火口にならない（繊維状のものだけが火を受け止める）', () => {
    const twig = spawnInto('twig', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(
      twig.combinationsWith(drill, player).map((c) => c.name),
      '小枝と火起こし具は組み合わない',
    ).toEqual([]);
  });

  it('ヤシの実の皮と植物繊維も火口になる', () => {
    const tinderTag = codex.tagNames.getId('tinder');
    for (const name of ['dry_grass', 'coconut_husk', 'plant_fiber']) {
      expect(codex.objects.get(codex.objectNames.getId(name)).tags, `${name}は火口`).toContain(tinderTag);
    }
  });

  it('薪をくべると炉の薪が増え、燃料そのものは残らない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');

    stoke(hearth, 'thick_branch');

    expect(effectiveNumberOf(hearth, 'fuel'), '太い枝1本ぶん').toBe(20);
    expect(itemsOn(land), '燃料は消える').toEqual([]);
  });

  it('薪を組んだだけの炉は火が消えたままで、薪も減らない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');

    session.advanceWorldTime(60 * 4);

    expect(heatIs(hearth, 'out'), '火は消えたまま').toBe(true);
    expect(effectiveNumberOf(hearth, 'fuel'), '火がつくまで薪は減らない').toBe(20);
  });

  it('薪の無い炉には火種を落とせない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const tinder = spawnInto('burning_tinder', land, 'items');

    expect(
      hearth
        .combinationsWith(tinder, player)
        .find((c) => c.name === 'ignite')
        ?.tryExecute() === true,
    ).toBe(false);
    expect(heatIs(hearth, 'out'), '火は消えたまま').toBe(true);
  });

  it('薪の無い炉は、火種を断る理由を名乗る', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const tinder = spawnInto('burning_tinder', land, 'items');

    expect(
      hearth.combinationsWith(tinder, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth.refusedCombinationsWith(tinder, player).map((c) => c.unmetRequirement()?.reasonName),
      '断る理由まで辿り着ける（14.6節のreason）',
    ).toEqual(['no_fuel']);
  });

  it('断られた火種は、薪を組み直すより先に燃え尽きて失われる', () => {
    // 「薪が先」（FireSystem.md 3.1節）の根拠。断る→時間が経つ→失う、をひと続きで見る。
    const hearth = spawnInto('campfire', land, 'fixtures');
    lightDryGrass();
    const tinder = new Location(land).items.find((o) => o.def.name === 'burning_tinder');
    expect(tinder, '火起こしに成功している').toBeDefined();
    expect(
      hearth.combinationsWith(tinder!, player).map((c) => c.name),
      '薪の無い炉は落とさせない',
    ).toEqual([]);

    session.advanceWorldTime(15);

    expect(itemsOn(land), '断られているあいだに燃え尽きる').toEqual([]);
    expect(heatIs(hearth, 'out'), '炉は消えたまま').toBe(true);
  });

  it('燃えている炉は火種を断る。重ねて火力を種火まで落とすことはない', () => {
    const hearth = litCampfire();
    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame'), '炎まで育っている').toBe(true);
    const grown = effectiveNumberOf(hearth, 'heat');

    const tinder = spawnInto('burning_tinder', land, 'items');
    expect(
      hearth.combinationsWith(tinder, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth.refusedCombinationsWith(tinder, player).map((c) => c.unmetRequirement()?.reasonName),
      '断る理由まで辿り着ける（落とすと火力が種火まで落ちる）',
    ).toEqual(['already_lit']);
    expect(effectiveNumberOf(hearth, 'heat'), '火力は落ちない').toBe(grown);
    expect(itemsOn(land), '火種も失われない').toEqual(['burning_tinder']);
  });

  it('種火だけの炉も火種を断る（火が生きているかは火力が0より大きいこと）', () => {
    // 種火（heatが1）へ落としても差分は0で、火種だけが黙って消える。
    const hearth = spawnInto('campfire', land, 'fixtures');
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumberWithoutEvents(20);
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumberWithoutEvents(1);
    const tinder = spawnInto('burning_tinder', land, 'items');

    expect(
      hearth.combinationsWith(tinder, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth.refusedCombinationsWith(tinder, player).map((c) => c.unmetRequirement()?.reasonName),
    ).toEqual(['already_lit']);

    // 薪が尽きていれば2つの条件が同時に落ちる。画面へ出るのは宣言順で最初のほう（14.6節の
    // unmetRequirement）なので、火種では足せないことを言うalready_litが先だと固定する。
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumberWithoutEvents(0);
    expect(
      hearth.refusedCombinationsWith(tinder, player).map((c) => c.unmetRequirement()?.reasonName),
      '薪も尽きているが、火種を断る理由は「もう火が付いている」のほう',
    ).toEqual(['already_lit']);
  });

  it('松明は火種で灯り、灯った松明は2つ目の火種を断る', () => {
    const torch = spawnInto('torch', player, 'hand');
    const tinder = spawnInto('burning_tinder', land, 'items');

    expect(
      torch
        .combinationsWith(tinder, player)
        .find((c) => c.name === 'light')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(effectiveNumberOf(torch, 'lit'), '灯った').toBe(1);
    expect(itemsOn(land), '火種は移った').toEqual([]);

    // litのrangeは0〜1なので、重ねてもsetの差分は0。断らなければ火種だけが消える。
    const second = spawnInto('burning_tinder', land, 'items');
    expect(
      torch.combinationsWith(second, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      torch.refusedCombinationsWith(second, player).map((c) => c.unmetRequirement()?.reasonName),
    ).toEqual(['already_lit']);
    expect(itemsOn(land), '2つ目の火種は失われない').toEqual(['burning_tinder']);
  });

  it('燃えている炉からも松明を灯せる。炉の火は減らない', () => {
    const hearth = litCampfire();
    const heatBefore = effectiveNumberOf(hearth, 'heat');
    const fuelBefore = effectiveNumberOf(hearth, 'fuel');
    const torch = spawnInto('torch', player, 'hand');

    expect(
      hearth
        .combinationsWith(torch, player)
        .find((c) => c.name === 'light_from_flame')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(effectiveNumberOf(torch, 'lit'), '灯った').toBe(1);
    expect(effectiveNumberOf(hearth, 'heat'), '炉の火力は変わらない').toBe(heatBefore);
    expect(effectiveNumberOf(hearth, 'fuel'), '炉の薪も減らない').toBe(fuelBefore);
  });

  it('灯っている松明は火を分けてもらえない', () => {
    const hearth = litCampfire();
    const torch = spawnInto('torch', player, 'hand');
    torch.getProperty(codex.propertyNames.getId('lit')).setNumberWithoutEvents(1);

    expect(
      hearth.combinationsWith(torch, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    // どちらの向きも、同じ「もう火が付いている」で落ちる——分けてもらう先は灯っていて、
    // 分けてやる先は燃えている。
    expect(
      hearth.refusedCombinationsWith(torch, player).map((c) => c.unmetRequirement()?.reasonName),
    ).toEqual(['already_lit', 'already_lit']);
  });

  it('消えている炉と灯っていない松明の間では、どちらの向きにも火が動かない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const torch = spawnInto('torch', player, 'hand');

    // **プレイヤーへ届くのは先頭の1つだけ**（GameElementDefinition.md 14.6節のunmetRequirement、
    // docs/ui/CardInteraction.md 2.1節）。どちらの向きの理由も真だが、運んできた側に火が無いことを
    // 先に言う——火を持って来たつもりの手には、そちらが答えになる。
    expect(
      hearth.refusedCombinationsWith(torch, player).map((c) => c.unmetRequirement()?.reasonName),
    ).toEqual(['no_flame_carried', 'fire_out']);
    expect(effectiveNumberOf(torch, 'lit'), '灯らない').toBe(0);
    expect(heatIs(hearth, 'out'), '炉も消えたまま').toBe(true);
  });

  it('火種は、いちばん短い道でも渡り切れない', () => {
    // 火種で火を運べるのは同じ土地の中まで（FireSystem.md 3.1節）。**いちばん短い道で見る**
    // ——長い道で消えることは、短い道で消えることを言わない。
    const road = roadToAnotherLand();

    spawnInto('burning_tinder', player, 'hand');
    road.walk();

    expect(carried(), '火種は道の上で燃え尽きる').toEqual([]);
  });

  it('灯った松明は火を別の土地へ運び、向こうの炉に種火を立てる', () => {
    // 火が土地を越える道（FireSystem.md 3.1.2節）。**炉から分けてもらって運ぶところまで**を
    // ひと続きで見る——松明を持っていることではなく、火が渡ることがこの道の中身。
    const torch = spawnInto('torch', player, 'hand');
    expect(
      smallFire()
        .combinationsWith(torch, player)
        .find((c) => c.name === 'light_from_flame')
        ?.tryExecute() === true,
    ).toBe(true);

    const road = roadToAnotherLand();
    const cold = spawnInto('campfire', road.destination, 'fixtures');
    stoke(cold, 'thick_branch');
    road.walk();

    expect(carried(), '松明は渡り切る').toEqual(['torch']);
    expect(effectiveNumberOf(torch, 'lit'), '灯ったまま').toBe(1);
    expect(
      cold
        .combinationsWith(torch, player)
        .find((c) => c.name === 'ignite_from_flame')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(heatIs(cold, 'ember'), '向こうの炉に種火が立つ').toBe(true);
    expect(effectiveNumberOf(torch, 'lit'), '松明は灯ったまま——火の在る側は何も失わない').toBe(1);
  });

  it('雨の屋外でも、灯った松明から炉へ火を戻せる', () => {
    // 雨が閉じるのは着火の1点だけ（FireSystem.md 3.1.1節）。**この向きは摩擦発火を通らない**ので、
    // 雨の条件を持たない——生きた炉がどこかに在れば、雨の日でも火は戻る（同3.1節）。
    // 屋根の下でしか起こせないこと（上の「雨の日は屋外で火が起こせない」）と対で読む。
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    const torch = spawnInto('torch', player, 'hand');
    torch.getProperty(codex.propertyNames.getId('lit')).setNumberWithoutEvents(1);
    setWeather('heavy_rain');

    expect(
      hearth
        .combinationsWith(torch, player)
        .find((c) => c.name === 'ignite_from_flame')
        ?.tryExecute() === true,
      '大雨の屋外でも通る',
    ).toBe(true);
    expect(heatIs(hearth, 'ember'), '雨の中の炉に種火が立つ').toBe(true);
  });

  it('灯っていない松明では、炉に火を点けられない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    const torch = spawnInto('torch', player, 'hand');

    expect(
      hearth.combinationsWith(torch, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth.refusedCombinationsWith(torch, player).map((c) => c.unmetRequirement()?.reasonName),
      '先頭が画面へ出る。運んできた側に火が無いことを先に言う',
    ).toEqual(['no_flame_carried', 'fire_out']);
    expect(heatIs(hearth, 'out'), '炉は消えたまま').toBe(true);
  });

  it('薪の無い炉は、灯った松明も断る——火を育てるのは薪で、種火だけでは残らない', () => {
    // 火種を落とすとき（上の「薪の無い炉は、火種を断る理由を名乗る」）と同じ条件で断る。
    // **宣言順がここに効く**——炉を灯す向きを後ろへ回すと、火を持って来た手に届くのが
    // 「この炉は消えている」になり、やりたいことと逆向きの説明になる。
    const hearth = spawnInto('campfire', land, 'fixtures');
    const torch = spawnInto('torch', player, 'hand');
    torch.getProperty(codex.propertyNames.getId('lit')).setNumberWithoutEvents(1);

    expect(
      hearth.combinationsWith(torch, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth.refusedCombinationsWith(torch, player).map((c) => c.unmetRequirement()?.reasonName),
      '先頭が画面へ出る。薪が入っていないことを先に言う',
    ).toEqual(['no_fuel', 'fire_out']);
    expect(heatIs(hearth, 'out'), '炉は消えたまま').toBe(true);
    expect(effectiveNumberOf(torch, 'lit'), '松明も灯ったまま失われない').toBe(1);
  });

  it('着火が置くのは種火だけで、そこから薪が火を育てる', () => {
    const hearth = litCampfire();

    expect(heatIs(hearth, 'ember'), '落とした直後は種火').toBe(true);

    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame'), '1時間で炎まで育つ').toBe(true);
  });

  it('薪が尽きると火は衰え、種火を経て死ぬ', () => {
    const hearth = litCampfire();
    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame')).toBe(true);

    // 太い枝1本（20）を炎（-1.5/tick）で食い尽くし、そこから冷めきるまで進める。
    session.advanceWorldTime(60 * 12);

    expect(effectiveNumberOf(hearth, 'fuel')).toBe(0);
    expect(heatIs(hearth, 'out'), '薪も種火も尽きた').toBe(true);
  });

  it('雨は野ざらしの炉の火力を削り、育つはずの種火を消す', () => {
    const underClearSky = smallFire();
    session.advanceWorldTime(15);
    expect(effectiveNumberOf(underClearSky, 'heat'), '晴れなら薪のぶんだけ育つ').toBe(3);

    open(LIGHTS);
    const inTheRain = smallFire();
    setWeather('heavy_rain');
    session.advanceWorldTime(15);

    expect(heatIs(inTheRain, 'out'), '大雨の-4は薪の育ちを上回る').toBe(true);
  });

  it('雨の野ざらしでも、太い枝1本ぶんの薪があれば種火は残って育つ', () => {
    // FireSystem.md 3.1節。**戻した種火が残るかは薪の段しだい**——雨の-4を上回るのはsomeの段
    // （fuel 10以上。太い枝1本が20）からで、fewの育ち+2では上の検査のとおり消える。
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumber(1);
    setWeather('heavy_rain');

    session.advanceWorldTime(15);

    expect(effectiveNumberOf(hearth, 'heat'), 'someの+6が雨の-4を上回る').toBe(3);
  });

  it('焚き火は薪を積めるだけ積んでも高温には届かない', () => {
    const hearth = litCampfire();
    stoke(hearth, 'thick_branch'); // 上限の30まで積む
    session.advanceWorldTime(60 * 3);

    expect(effectiveNumberOf(hearth, 'heat'), '火力の上限で頭打ちになる').toBe(30);
    expect(heatIs(hearth, 'flame'), '開いた焚き火は炎まで').toBe(true);
    expect(heatIs(hearth, 'blaze'), '高温には届かない').toBe(false);
  });

  it('石囲いの炉は薪を多く積めるので、高温へ届く', () => {
    const hearth = spawnInto('stone_hearth', land, 'fixtures');
    for (let i = 0; i < 6; i++) stoke(hearth, 'thick_branch');
    expect(effectiveNumberOf(hearth, 'fuel')).toBe(120);

    hearth.tryGetProperty(codex.propertyNames.getId('heat'))?.setNumber(1);
    session.advanceWorldTime(60 * 6);

    expect(heatIs(hearth, 'blaze'), '料理の最上段').toBe(true);
  });

  it('束ねた薪はまとめてくべられる。何本入るかは炉の残りが決める', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const branches = [
      spawnInto('thick_branch', land, 'items'),
      spawnInto('thick_branch', land, 'items'),
      spawnInto('thick_branch', land, 'items'),
    ];

    // 焚き火のfuelは0〜30、太い枝は1本20。2本目で満ちるので、3本目は入らない。
    expect(
      hearth
        .combinationsWith(branches[0], player)
        .find((c) => c.name === 'add_fuel')
        ?.acceptedCountIncludingSelf(branches.slice(1)) ?? 1,
    ).toBe(2);

    for (const branch of branches.slice(0, 2))
      expect(
        hearth
          .combinationsWith(branch, player)
          .find((c) => c.name === 'add_fuel')
          ?.tryExecute() === true,
      ).toBe(true);

    expect(effectiveNumberOf(hearth, 'fuel'), '溢れた分は捨てられる（量の器は部分的に受け取る）').toBe(30);
    expect(itemsOn(land), 'くべた2本は残らない').toEqual(['thick_branch']);
  });

  it('満杯の炉にはくべられない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    stoke(hearth, 'thick_branch');
    expect(effectiveNumberOf(hearth, 'fuel')).toBe(30);

    const extra = spawnInto('thick_branch', land, 'items');
    expect(
      hearth.combinationsWith(extra, player).map((c) => c.name),
      '成立する組み合わせは無い',
    ).toEqual([]);
    expect(
      hearth
        .combinationsWith(extra, player)
        .find((c) => c.name === 'add_fuel')
        ?.tryExecute() === true,
    ).toBe(false);
    expect(extra.parent, 'くべられなかった薪は手元に残る').toBe(land);
    expect(
      hearth.refusedCombinationsWith(extra, player).map((c) => c.unmetRequirement()?.reasonName),
      '断る理由まで辿り着ける（落とせるのに何も起きない、にしない）',
    ).toEqual(['hearth_full']);
  });

  it('どの炉も、自分の上限で満杯を告げる', () => {
    // 満杯を拒む条件は炉ごとに書いてあり、閾値はその炉のfuelのrange.maxと一致していなければ
    // ならない。1本手前で成立し、ちょうど上限で理由に変わるところまで見て、写し違いを捕まえる。
    const fuelId = codex.propertyNames.getId('fuel');
    const hearthTag = codex.tagNames.getId('hearth');
    const hearths = [...codex.objects].filter((def) => def.tags.includes(hearthTag));
    expect(hearths.length, '炉が拾えていないなら何も見張っていない').toBeGreaterThan(0);

    for (const def of hearths) {
      open(LIGHTS);
      const hearth = spawnInto(def.name, land, 'fixtures');
      const branch = spawnInto('thick_branch', land, 'items');
      const capacity = def.tryGetPropertyDef(fuelId)!.range!.max;

      hearth.getProperty(fuelId).setNumberWithoutEvents(capacity - 1);
      expect(
        hearth.combinationsWith(branch, player).map((c) => c.name),
        `${def.name}: 空きが残っていればくべられる`,
      ).toEqual(['add_fuel']);

      hearth.getProperty(fuelId).setNumberWithoutEvents(capacity);
      expect(
        hearth.combinationsWith(branch, player).map((c) => c.name),
        `${def.name}: 満杯では成立しない`,
      ).toEqual([]);
      expect(
        hearth.refusedCombinationsWith(branch, player).map((c) => c.unmetRequirement()?.reasonName),
        `${def.name}: 満杯を告げる`,
      ).toEqual(['hearth_full']);
    }
  });

  it('火にかけた生肉は焼けた肉になり、放っておくと焦げる', () => {
    const hearth = litCampfire();
    const meat = spawnInto('raw_meat', land, 'items');
    expect(meat.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    session.advanceWorldTime(60 * 3);
    expect(new Location(land).fixtures[0].def.name).toBe('campfire');
    expect(childNames(hearth), '焼き上がりは同じ枠に残る').toEqual(['roasted_meat']);

    session.advanceWorldTime(60 * 3);
    expect(childNames(hearth), '出し忘れると焦げる').toEqual(['charred_lump']);
  });

  it('火にかけた肉は、今の火力のまま何tickで焼き上がるかを答える', () => {
    const hearth = litCampfire();
    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame'), '炎（3/tick）で焼く').toBe(true);

    const cookingId = codex.propertyNames.getId('cooking_progress');
    const meat = spawnInto('raw_meat', land, 'items');
    expect(meat.tryGetProperty(cookingId)?.ticksUntilMax(), '火の外では進まない').toBeUndefined();

    expect(meat.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();
    // 24 ÷ 3 = 8tickでmaxちょうどに乗り、そのtickでon_maxが起きる。
    expect(meat.tryGetProperty(cookingId)?.ticksUntilMax()).toBe(8);

    session.advanceWorldTime(15 * 7);
    expect(childNames(hearth), '7tickではまだ焼き上がらない').toEqual(['raw_meat']);

    session.advanceWorldTime(15);
    expect(childNames(hearth), '8tick目に焼き上がる').toEqual(['roasted_meat']);
  });

  /** 炉のfireスロットに入っている物の型名。 */
  function childNames(hearth: WorldObject): string[] {
    const slot = hearth.tryGetSlot(codex.slotNames.getId('fire'));
    return (slot?.contents ?? []).map((object) => object.def.name);
  }

  it('石を3つ積むと三石のかまど、さらに8つで石囲いの炉になる', () => {
    let hearth = spawnInto('campfire', land, 'fixtures');

    for (let i = 0; i < 3; i++) {
      const stone = spawnInto('stone', land, 'items');
      expect(
        hearth
          .combinationsWith(stone, player)
          .find((c) => c.name === 'add_stone')
          ?.tryExecute() === true,
      ).toBe(true);
    }
    hearth = new Location(land).fixtures[0];
    expect(hearth.def.name).toBe('three_stone_hearth');

    for (let i = 0; i < 8; i++) {
      const stone = spawnInto('stone', land, 'items');
      expect(
        hearth
          .combinationsWith(stone, player)
          .find((c) => c.name === 'add_stone')
          ?.tryExecute() === true,
      ).toBe(true);
    }
    expect(new Location(land).fixtures[0].def.name).toBe('stone_hearth');
  });

  it('炉の段が上がるほど、火にかけられる枠が増える', () => {
    const cellCount = (hearthName: string): number | undefined =>
      codex.objects.get(codex.objectNames.getId(hearthName)).tryGetSlotDef(codex.slotNames.getId('fire'))
        ?.cellCount;

    // 焚き火の2枠は焼く物だけ。三石は器の枠が1つ、石囲いは2つ増える（1.1節）。
    expect(cellCount('campfire')).toBe(2);
    expect(cellCount('three_stone_hearth')).toBe(3);
    expect(cellCount('stone_hearth')).toBe(5);
  });

  it('火の中の枠は、丸焼きの鎖と焼ける石だけを受け入れる', () => {
    const fireSlot = codex.objects
      .get(codex.objectNames.getId('campfire'))
      .tryGetSlotDef(codex.slotNames.getId('fire'));
    const accepts = (objectName: string): boolean =>
      fireSlot?.acceptsAnywhere(codex.objects.get(codex.objectNames.getId(objectName))) === true;

    // 焦げた塊は焼けないが、焦げた瞬間に枠を引き継ぐために入る（7.2節）。焼け石も同じ理由で入る
    // ——溜め切った瞬間に石から置き換わる（9.1節）。
    for (const name of ['raw_meat', 'roasted_meat', 'charred_lump', 'rat_carcass', 'roasted_rat']) {
      expect(accepts(name), name).toBe(true);
    }
    for (const name of ['stone', 'hot_stone']) {
      expect(accepts(name), name).toBe(true);
    }
    for (const name of ['twig', 'fire_drill', 'dry_grass']) {
      expect(accepts(name), name).toBe(false);
    }

    const hearth = litCampfire();
    const twig = spawnInto('twig', land, 'items');
    expect(twig.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeDefined();
    expect(twig.parent, '入らなかった小枝は手元に残る').toBe(land);
  });

  it('火の中の石は熱を溜めて焼け石になり、炉から出せば冷めて石に戻る', () => {
    const hearth = litCampfire();
    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame'), '炎（3/tick）で焼く').toBe(true);

    const stone = spawnInto('stone', land, 'items');
    expect(stone.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    // 12 ÷ 3 = 4tickでmaxちょうどに乗る。
    session.advanceWorldTime(15 * 3);
    expect(childNames(hearth), '3tickではまだ溜まり切らない').toEqual(['stone']);
    session.advanceWorldTime(15);
    expect(childNames(hearth), '4tick目に焼け石へ置き換わる').toEqual(['hot_stone']);

    const hot = hearth.getSlot(codex.slotNames.getId('fire')).contents[0];
    expect(effectiveNumberOf(hot, 'heat_soak'), '生まれた焼け石は溜め切っている').toBe(12);

    // 炉から出すと冷める（-3/tick）。4tickで抜け切って普通の石に戻る。
    expect(hot.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    session.advanceWorldTime(15 * 3);
    expect(itemsOn(land), '3tickではまだ焼け石').toEqual(['hot_stone']);
    session.advanceWorldTime(15);
    expect(itemsOn(land), '抜け切れば普通の石').toEqual(['stone']);
  });

  it('炉の火が消えていれば、石は熱を溜めない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const stone = spawnInto('stone', land, 'items');
    expect(stone.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    session.advanceWorldTime(60 * 4);

    expect(effectiveNumberOf(stone, 'heat_soak'), '火が無ければ溜まらない').toBe(0);
    expect(childNames(hearth), '石のまま').toEqual(['stone']);
  });

  /**
   * 中身を満たしたヤシの殻。**空の変種は作れない**——量が0の器は中身の軸を落として空の容器へ戻る
   * （fillのon_min）ので、生まれた瞬間に打ち消される。
   */
  function filledBowl(liquidName: string): WorldObject {
    const bowl = spawnInto(`coconut_bowl__content_${liquidName}`, land, 'items');
    bowl.getProperty(codex.propertyNames.getId('fill')).setNumberWithoutEvents(250);
    return bowl;
  }

  it('焼け石を水を張った器へ落とすと、器に耐火性が無くても湯が沸く', () => {
    // ヤシの殻は火にかければ焦げる器（cookwareを持たない）。焼け石の側は相手が何かを問わない。
    const bowl = filledBowl('water_liquid');
    const hot = spawnInto('hot_stone', land, 'items');

    expect(
      hot
        .combinationsWith(bowl, player)
        .find((c) => c.name === 'boil')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(bowl.def.name, '中身が湯になる').toBe('coconut_bowl__content_hot_water_liquid');
    expect(itemsOn(land), '熱を使い切った石はその場で普通の石に戻る').toEqual([
      'stone',
      'coconut_bowl__content_hot_water_liquid',
    ]);
  });

  it('冷めかけた焼け石では湯を沸かせない', () => {
    const bowl = filledBowl('water_liquid');
    const hot = spawnInto('hot_stone', land, 'items');

    // 炉の外では-3/tick。3tick（45分）で3まで落ち、湯を沸かせる段（searing、6以上）から外れる。
    session.advanceWorldTime(15 * 3);
    expect(effectiveNumberOf(hot, 'heat_soak')).toBe(3);

    expect(
      hot.combinationsWith(bowl, player).map((c) => c.name),
      '候補にも挙がらない',
    ).toEqual([]);
    expect(bowl.def.name, '水のまま').toBe('coconut_bowl__content_water_liquid');
  });

  it('燃えている炉は、その土地だけを暖める（隣の土地も世界も暖まらない）', () => {
    // 暖は親のambient_temperatureへのmodify（FireSystem.md 9.2節）。届き先は炉が置かれた場所だけで、
    // 世界の気温を継いでいる隣の土地はそのまま——炉ひとつで島全体が暖まることはない。
    const world = land.parent!;
    const neighbor = spawnInto('grassland', world, 'locations');
    const outside = temperatureOf(neighbor);
    // **空の気温は土地の気温と同じではない**——土地は海抜ぶんだけ低い（ClimateSystem.md 1.1節）ので、
    // 動かないことは隣の土地の値ではなく、火を点ける前の空の値と比べる。
    const sky = temperatureOf(world);

    // 火の点いていない炉は暖めない。組んだだけの炉を隣へ置いて、暖の出どころが「炉が在ること」では
    // なく「火が生きていること」であることまで見る。
    spawnInto('campfire', neighbor, 'fixtures');
    litCampfire();

    expect(temperatureOf(land), '火のある土地は+8').toBe(outside + 8);
    expect(temperatureOf(neighbor), '隣の土地は動かない（組んだだけの炉は暖めない）').toBe(outside);
    expect(temperatureOf(world), '世界も動かない').toBe(sky);
  });

  it('炉の暖が戻す先は土地で変わり、山頂は平年へ戻らない', () => {
    // FireSystem.md 9.2節。+8は**空が**最も冷えるとき（涼しい季節-5＋夜-3＝12℃）を平年の20℃へ
    // 戻す量で、**土地の海抜ぶんの差はその上に乗る**（ClimateSystem.md 1.1節）。山頂は戻り切らず、
    // それでも素のchill_pointは上回る——この2つが揃って初めて「火のそばなら冷えない」が言える。
    const world = land.parent!;
    setHour(NIGHT_HOUR);
    world.getProperty(codex.propertyNames.getId('thermal_level')).setNumberWithoutEvents(0);
    expect(worldView.ambientTemperature, '空が最も冷えるとき').toBe(12);

    const beach = spawnInto('sandy_beach', world, 'locations');
    const peak = spawnInto('mountain_peak', world, 'locations');
    litHearthOn(beach);
    litHearthOn(peak);

    expect(temperatureOf(beach), '海抜ぶんの差を持たない土地はちょうど平年へ戻る').toBe(20);
    expect(temperatureOf(peak), '山頂は3℃ぶん戻り切らない').toBe(17);
    const chillPoint = player.getProperty(codex.propertyNames.getId('chill_point')).getEffectiveValue();
    expect(temperatureOf(peak), '戻り切らなくても寒さの入口は上回る').toBeGreaterThan(chillPoint);
  });

  /** その土地に、火の生きている炉を1つ置く（着火の連鎖は通さず、火力だけを立てる）。 */
  function litHearthOn(location: WorldObject): WorldObject {
    const hearth = spawnInto('campfire', location, 'fixtures');
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumber(20);
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumber(1);
    return hearth;
  }

  it('沸かした湯は放っておくと冷めて水に戻る', () => {
    const bowl = filledBowl('hot_water_liquid');

    // 湯は-1/tick。12 tick（3時間）で抜け切る。
    session.advanceWorldTime(15 * 11);
    expect(bowl.def.name, '11tickではまだ湯').toBe('coconut_bowl__content_hot_water_liquid');

    session.advanceWorldTime(15);
    expect(bowl.def.name, '抜け切れば水').toBe('coconut_bowl__content_water_liquid');
  });
});

/**
 * 炉の火床の枠が、空いているうちに何を名乗るか（docs/engine/FireSystem.md 1.1節、
 * docs/ui/CardView.md 11節）。**火の中の枠と石の上の枠が違うものを受ける**のが炉の段の実体なので、
 * どちらがどちらかは枠自身が言う。
 */
describe('炉の火床の枠が名乗る型', () => {
  const codex = bundledCodex();

  /** 器を載せる枠を持つ炉（docs/engine/FireSystem.md 6節の段の表）。 */
  const COOKWARE_HEARTHS = ['three_stone_hearth', 'stone_hearth'];

  /**
   * 器を載せる枠を持たない炉。**下の検査はこの2組で炉を二分する**ので、余りの側も名乗らせる。
   *
   * 燻し小屋（smoking.yaml）は枠が6つとも同じ物（`smokable`）を受けるので、焚き火・覆い焼きの炉と
   * 同じくどの枠も型を名乗らない。
   */
  const PLAIN_HEARTHS = ['campfire', 'earth_kiln', 'smokehouse'];

  it('この検査は、炉を1つ残らずどちらか一方へ振り分けている', () => {
    // どちらの一覧にも載らない炉は、下のどの検査にも回されないまま緑で通る。段の表（同6節）は
    // データに無いので一覧は手で持つしかないが、**覆っていることは`hearth`タグと突き合わせられる。**
    expect([...COOKWARE_HEARTHS, ...PLAIN_HEARTHS].sort()).toEqual(
      [...codex.objectDefNamesWithTag(codex.tagNames.getId('hearth'))].sort(),
    );
  });

  const fireCells = (hearthName: string): readonly (readonly string[])[] => {
    const hearth = codex.objects.get(codex.objectNames.getId(hearthName));
    const slotDef = hearth.tryGetSlotDef(codex.slotNames.getId('fire'));
    if (slotDef === undefined) throw new Error(`${hearthName} が fire スロットを持ちません。`);
    return codex.typesShownInEmptyCells(slotDef).map((types, index) =>
      types.map((id) => {
        const def = codex.objects.get(id);
        if (!slotDef.cellAt(index).accepts(def))
          throw new Error(`${hearthName} の${index}番目の枠が受けない型（${def.name}）を名乗っています。`);
        return def.name;
      }),
    );
  };

  it('器を載せられる炉は、火の中の枠が焼ける物を名乗る', () => {
    for (const hearthName of COOKWARE_HEARTHS) {
      expect(fireCells(hearthName)[0].length, `${hearthName} の火の中の枠`).toBeGreaterThan(0);
    }
  });

  it('石の上の枠は、載せられる器が世界に入るまで紙のまま', () => {
    // **docs/engine/FireSystem.md 1.1節がそう書いている。** 器が入れば枠は名乗り始めるので、
    // そのとき同節を書き直すためにここで落とす（煮炊きのレシピは同11節の未決事項）。
    expect(
      codex.objectDefNamesWithTag(codex.tagNames.getId('cookware')),
      'cookwareを名乗る型が入った。FireSystem.md 1.1節の「今は紙のまま」を書き直す',
    ).toEqual([]);

    for (const hearthName of COOKWARE_HEARTHS) {
      const cells = fireCells(hearthName);
      expect(cells[cells.length - 1], `${hearthName} の石の上の枠`).toEqual([]);
    }
  });

  it('器を載せられない炉は、枠が言えることを並びが既に言っているので名乗らない', () => {
    // 焚き火の火床はどちらの枠も焼く物を受ける（fire.yaml）。覆い焼きの炉も同じで、4枠とも土器。
    for (const hearthName of PLAIN_HEARTHS)
      expect(
        fireCells(hearthName).every((types) => types.length === 0),
        hearthName,
      ).toBe(true);
  });
});

describe('炉が火にかける場所', () => {
  const codex = bundledCodex();

  it('hearthを名乗る設備は、どれもfireスロット1つだけで受ける', () => {
    // **docs/engine/FireSystem.md 1.1節がそう書いている。** 火にかける場所を2つ目のスロットへ分けると、
    // 炉を開いたときに火の中と石の上が別のタブへ分かれる（docs/ui/Windows.md 1.2節）。置き場所の違いは
    // スロットではなくcellsの並びが持つ。
    const hearthNames = codex.objectDefNamesWithTag(codex.tagNames.getId('hearth'));
    expect(hearthNames, 'hearthを名乗る設備が1つも無い').not.toEqual([]);
    for (const hearthName of hearthNames) {
      expect(
        codex.objects
          .get(codex.objectNames.getId(hearthName))
          .enumerateSlotDefs()
          .map((slotDef) => slotDef.name),
        hearthName,
      ).toEqual(['fire']);
    }
  });
});

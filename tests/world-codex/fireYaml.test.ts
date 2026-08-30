import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * fire.yamlの火の連鎖を、実ファイルの定義だけで検証する。
 * 火口に火をつけ、火種で炉へ着火し、薪をくべ、火を育て、肉を焼き、石を積んで炉を上げるところまで。
 *
 * 火の育ちと衰えはtick駆動（docs/engine/FireSystem.md 2.2節）なので、時間を進めて観測する。
 */
describe('fire.yamlの火の連鎖', () => {
  // lightの候補は宣言順に「成功（火口のignition_chance）・失敗（40）」。枯れ草は60:40なので、
  // 0.8を引けば外れる。
  /** 火起こしに成功する引き。 */
  const LIGHTS = 0;
  /** 火起こしを外す引き。 */
  const FAILS = 0.8;

  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let land: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 燃料（locations.yaml）・火口（coconut.yaml・fiber.yaml）・料理（animals.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  beforeEach(() => {
    // 火起こしは確率で外す。連鎖を見るテストは必ず成功する側を引く。
    open(LIGHTS);
  });

  /** 草地に立つプレイヤーから始める。rollはpickがどの候補を引くかを決める。 */
  function open(roll: number): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex);
    session = new WorldSession(codex, worldView, fixedRng(roll));

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
    return new Location(location, codex).items.map((object) => object.def.name);
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

    const tinder = new Location(land, codex).items.find((o) => o.def.name === 'burning_tinder');
    expect(tinder, '火起こしに成功している').toBeDefined();
    expect(
      hearth
        .combinationsWith(tinder!, player)
        .find((c) => c.name === 'ignite')
        ?.tryExecute() === true,
    ).toBe(true);
    return hearth;
  }

  /** その場の気温（core.yamlのlocation trait）。世界の気温を土台に、炉の暖が積まれた実効値。 */
  function temperatureOf(location: WorldObject): number {
    return location.getProperty(codex.propertyNames.getId('ambient_temperature')).getEffectiveValue();
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
    expect(drill.recipesProducingThis[0].unmetUnlockRequirement(undefined)).toBeUndefined();
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

    expect(grass.combinationsWith(wipDrill, player)).toEqual([]);
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

  it('火の腕が上がると火が付きやすくなる（素人が外す引きでも、熟達者は火を得る）', () => {
    // 枯れ草の素の重みは60対40で素人は6割、熟達は倍率3が掛かって180対40（docs/world/Skills.md 5節）。
    // 引きは両方とも0.7で、動かしているのは腕だけ。
    const BETWEEN = 0.7;
    const firecraftId = codex.propertyNames.getId('skill_firecraft');

    open(BETWEEN);
    expect(signalsOf(lightDryGrass), '素人は外す').toEqual(['dry_grass: not_lit']);

    open(BETWEEN);
    player.getProperty(firecraftId).setNumberWithoutEvents(180);
    expect(signalsOf(lightDryGrass), '熟達者は同じ引きで火を得る').toEqual(['dry_grass: lit']);
  });

  it('雨の日は屋外で火が起こせない', () => {
    // 確率が下がるのではなく、できない側に線が引かれる（docs/engine/FireSystem.md 3.1.1節）。
    // 引きは成功する側（LIGHTS）のままなので、止めているのは天気だけ。
    setWeather('heavy_rain');
    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(grass.combinationsWith(drill, player), '候補にも挙がらない').toEqual([]);
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
    // 洞窟と外は同じ土地の中なので、1tickで燃え尽きる火種でも届く（3.1節）。この道は塞がない
    // ——「雨の日に火を戻すには洞窟が要る」という形が、そのまま洞窟の価値になっている。
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

    const tinder = new Location(cave, codex).items.find((o) => o.def.name === 'burning_tinder');
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

    expect(twig.combinationsWith(drill, player), '小枝と火起こし具は組み合わない').toEqual([]);
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

    expect(hearth.combinationsWith(tinder, player), '成立する組み合わせは無い').toEqual([]);
    expect(
      hearth.refusedCombinationsWith(tinder, player).map((c) => c.unmetRequirement()?.reasonName),
      '断る理由まで辿り着ける（14.6節のreason）',
    ).toEqual(['no_fuel']);
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
      hearth.combinationsWith(extra, player),
      '候補にも挙がらない（落とせるのに何も起きない、にしない）',
    ).toEqual([]);
    expect(
      hearth
        .combinationsWith(extra, player)
        .find((c) => c.name === 'add_fuel')
        ?.tryExecute() === true,
    ).toBe(false);
    expect(extra.parent, 'くべられなかった薪は手元に残る').toBe(land);
  });

  it('火にかけた生肉は焼けた肉になり、放っておくと焦げる', () => {
    const hearth = litCampfire();
    const meat = spawnInto('raw_meat', land, 'items');
    expect(meat.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    session.advanceWorldTime(60 * 3);
    expect(new Location(land, codex).fixtures[0].def.name).toBe('campfire');
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
    hearth = new Location(land, codex).fixtures[0];
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
    expect(new Location(land, codex).fixtures[0].def.name).toBe('stone_hearth');
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

    expect(hot.combinationsWith(bowl, player), '候補にも挙がらない').toEqual([]);
    expect(bowl.def.name, '水のまま').toBe('coconut_bowl__content_water_liquid');
  });

  it('燃えている炉は、その土地だけを暖める（隣の土地も世界も暖まらない）', () => {
    // 暖は親のambient_temperatureへのmodify（FireSystem.md 9.2節）。届き先は炉が置かれた場所だけで、
    // 世界の気温を継いでいる隣の土地はそのまま——炉ひとつで島全体が暖まることはない。
    const world = land.parent!;
    const neighbor = spawnInto('grassland', world, 'locations');
    const outside = temperatureOf(neighbor);

    // 火の点いていない炉は暖めない。組んだだけの炉を隣へ置いて、暖の出どころが「炉が在ること」では
    // なく「火が生きていること」であることまで見る。
    spawnInto('campfire', neighbor, 'fixtures');
    litCampfire();

    expect(temperatureOf(land), '火のある土地は+8').toBe(outside + 8);
    expect(temperatureOf(neighbor), '隣の土地は動かない（組んだだけの炉は暖めない）').toBe(outside);
    expect(worldView.ambientTemperature, '世界も動かない').toBe(outside);
  });

  it('沸かした湯は放っておくと冷めて水に戻る', () => {
    const bowl = filledBowl('hot_water_liquid');

    // 湯は-1/tick。12tick＝3時間で抜け切る。
    session.advanceWorldTime(15 * 11);
    expect(bowl.def.name, '11tickではまだ湯').toBe('coconut_bowl__content_hot_water_liquid');

    session.advanceWorldTime(15);
    expect(bowl.def.name, '抜け切れば水').toBe('coconut_bowl__content_water_liquid');
  });
});

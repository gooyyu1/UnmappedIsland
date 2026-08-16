import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * traps.yamlのくくり罠を、実ファイルの定義だけで検証する（docs/engine/TrapSystem.md）。
 * 仕掛ける→待つ→掛かる→怪我が刺さる→死ぬか生き延びる、の一巡を通す。
 */
describe('traps.yamlのくくり罠', () => {
  // 外側のpickの重みは 空振り40・草食10・肉食10（合計60）。内側は草原なら 空振り8・ヤケイ10・
  // ネズミ6（合計24）、肉食側は 空振り8・ネズミ6（合計14）。fixedRngは両方の階層へ同じ値を渡すので、
  // 引きは2つの区間の重なりで決まる。
  /** 何も寄って来ない引き（外側の空振り）。 */
  const NOTHING_CAME = 0.2;
  /** 草食の卓を引き、その中でヤケイに当たる引き。 */
  const CATCHES_FOWL = 0.7;
  /** 草食の卓を引き、その中でネズミに当たる引き。 */
  const CATCHES_RAT = 0.8;

  let codex: WorldCodex;
  let session: WorldSession;
  let grassland: WorldObject;
  let player: WorldObject;
  let snare: WorldObject;
  let warinessId: number;
  let vulnerabilityId: number;
  let bloodId: number;
  let durabilityId: number;
  let catchRemainingId: number;
  let missWeightId: number;
  let herbivoreWeightId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    warinessId = codex.propertyNames.getId('wariness');
    vulnerabilityId = codex.propertyNames.getId('vulnerability');
    bloodId = codex.propertyNames.getId('blood');
    durabilityId = codex.propertyNames.getId('durability');
    catchRemainingId = codex.propertyNames.getId('catch_remaining');
    missWeightId = codex.propertyNames.getId('miss_weight');
    herbivoreWeightId = codex.propertyNames.getId('herbivore_weight');
  });

  /** 草原に立つプレイヤーと、その足元へ仕掛けた罠から始める。rollがpickの引きを決める。 */
  function open(roll: number, locationName = 'grassland'): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(
      codex,
      new World(worldInstance, codex.propertyNames, codex.symbolNames),
      fixedRng(roll),
    );
    grassland = spawnInto(locationName, worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, grassland, 'characters');
    snare = spawnInto('snare', grassland, 'items');
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  /** 今この土地のアイテムスロットに並んでいる物の識別子。 */
  function itemsOnGround(): string[] {
    return grassland.tryGetSlot(codex.slotNames.getId('items'))!.contents.map((object) => object.def.name);
  }

  /** 今この罠に掛かっている物（獲物か死体）。 */
  function caught(): WorldObject[] {
    return [...(snare.tryGetSlot(codex.slotNames.getId('catch'))?.contents ?? [])];
  }

  /** その動物に刺さっている怪我の識別子。 */
  function injuriesOf(animal: WorldObject): string[] {
    const slot = animal.tryGetSlot(codex.slotNames.getId('injuries'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) grassland.tick(session);
  }

  /** 掛かるまで進める。掛からなければ失敗させる（周期16 tickなので余裕を持って回す）。 */
  function tickUntilCaught(limit = 40): WorldObject {
    for (let i = 0; i < limit; i++) {
      tick(1);
      const [first] = caught();
      if (first !== undefined) return first;
    }
    throw new Error('罠に何も掛からなかった');
  }

  it('地面に置いた罠だけが動く', () => {
    // 「仕掛けた罠」と「持ち歩く罠」を型で分けない（TrapSystem.md 1節）。作動しているかどうかは、
    // 今どのスロットに入っているかだけが決める。
    open(NOTHING_CAME);
    const onGround = snare.readProperty(catchRemainingId)!.value;
    tick(1);
    expect(snare.readProperty(catchRemainingId)!.value, '地面では減る').toBeLessThan(onGround);

    expect(snare.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();
    const inHand = snare.readProperty(catchRemainingId)!.value;
    tick(1);
    expect(snare.readProperty(catchRemainingId)!.value, '手に持てば止まる').toBe(inHand);
  });

  it('掛かった獲物は罠のスロットへ入り、その罠の怪我が1つ刺さる', () => {
    // spawnの配列が順に生むので、獲物を生んでからその中へ怪我を生む（into: child、5.3節）。
    open(CATCHES_FOWL);
    const prey = tickUntilCaught();

    expect(prey.def.name).toBe('junglefowl');
    expect(injuriesOf(prey), 'くくり罠の傷が刺さる').toEqual(['snare_laceration']);
    expect(itemsOnGround(), 'レーンに出るのは罠のままで、獲物は中に居る').toEqual(['snare']);
  });

  it('掛かっている間、罠は止まる', () => {
    // 見回らなければ罠は増えない（6節）。回収するまで次の抽選は回らない。
    open(CATCHES_FOWL);
    tickUntilCaught();
    const stopped = snare.readProperty(catchRemainingId)!.value;

    tick(5);
    expect(snare.readProperty(catchRemainingId)!.value).toBe(stopped);
    expect(caught(), '2匹目は掛からない').toHaveLength(1);
  });

  it('掛かった獲物は警戒を打ち消され、仕留めやすくなる', () => {
    // 拘束（5節）。気を失った動物への宣言とまったく同じ内容で、resistsが成立しないので
    // 飛び出さず、仕留めの重みは跳ね上がる。
    open(CATCHES_FOWL);
    const prey = tickUntilCaught();

    expect(prey.readProperty(warinessId)!.value, '罠の中では暴れない').toBe(0);
    expect(prey.readProperty(vulnerabilityId)!.value, '無防備さが跳ね上がる').toBeGreaterThan(100);
  });

  it('ネズミは掛かったその場で死に、死体は罠の中に残る', () => {
    // 血が6mLしかないので、傷が最初の1tickで奪う15mLに耐えられない（5.1節）。掛かった tick の
    // うちに死体へ置き換わるので、生きたネズミは1度も画面に出ない。
    open(CATCHES_RAT);
    const prey = tickUntilCaught();
    expect(prey.def.name, '掛かった瞬間には既に死体').toBe('rat_carcass');

    // 死体はanimalタグを持たないが、枠もタイマーのゲートもquarryで受けるので、罠の中に残り、
    // 次の抽選も回らない（1.1節・6節）。
    const stopped = snare.readProperty(catchRemainingId)!.value;
    tick(4);
    expect(caught().map((object) => object.def.name)).toEqual(['rat_carcass']);
    expect(snare.readProperty(catchRemainingId)!.value, '死体が入ったままでも回らない').toBe(stopped);
  });

  it('ヤケイは同じ傷で生き延びる', () => {
    // 血が80mLあるので、30〜60mLを奪われても残る。**同じ1枚の傷が体格で意味を変える**（5.1節）。
    open(CATCHES_FOWL);
    const prey = tickUntilCaught();

    tick(6);
    expect(
      caught().map((object) => object.def.name),
      '死体になっていない',
    ).toEqual(['junglefowl']);
    expect(prey.readProperty(bloodId)!.value).toBeGreaterThan(0);
  });

  it('土地が宣言していない動物は掛からない', () => {
    // 罠の側は1行も書き換えずに、土地のpropsの有無だけで決まる（3節）。岩礁海岸はヤケイを
    // 宣言していないので、草原と同じ引きでも重みが0になり、その候補ごと抽選から外れる。
    open(CATCHES_FOWL, 'rocky_coast');
    const caughtNames = new Set<string>();
    for (let i = 0; i < 200; i++) {
      tick(1);
      for (const object of caught()) {
        caughtNames.add(object.def.name);
        object.destroy();
      }
    }

    expect(caughtNames.size, '何かは掛かる').toBeGreaterThan(0);
    expect([...caughtNames], 'ヤケイだけは掛からない').not.toContain('junglefowl');
  });

  it('餌を仕掛けると、その食性の卓が引かれやすくなる', () => {
    // 餌は掛かる確率を上げるのと、掛かる相手を食性で寄せるのを同時に言う（4節）。
    open(NOTHING_CAME);
    const before = {
      miss: snare.readProperty(missWeightId)!.value,
      herbivore: snare.readProperty(herbivoreWeightId)!.value,
    };

    const spinach = spawnInto('water_spinach', player, 'hand');
    expect(snare.tryExecuteCombination(spinach, undefined, 'add_plant_bait', session)).toBe(true);

    expect(snare.readProperty(missWeightId)!.value, '何も寄って来ない回が減る').toBeLessThan(before.miss);
    expect(snare.readProperty(herbivoreWeightId)!.value, '草食の卓が引かれやすくなる').toBeGreaterThan(
      before.herbivore,
    );
    expect(itemsOnGround(), '仕掛けた餌は物として残らない').toEqual(['snare']);
  });

  it('獲物が入っている間は速く傷み、壊れれば中身は土地へこぼれる', () => {
    // 放置の罰は獲物と罠の両方を失うこと（6.1節）。壊れた罠の中身は道連れにならず親へこぼれ、
    // 拘束のmodifyが消えるので警戒が戻る。
    open(CATCHES_FOWL);
    const empty = snare.readProperty(durabilityId)!.value;
    tick(1);
    const emptyRate = empty - snare.readProperty(durabilityId)!.value;

    const prey = tickUntilCaught();
    const occupied = snare.readProperty(durabilityId)!.value;
    tick(1);
    const occupiedRate = occupied - snare.readProperty(durabilityId)!.value;
    expect(occupiedRate, 'もがかれている間のほうが速い').toBeGreaterThan(emptyRate);

    tick(200);
    expect(itemsOnGround(), '罠は壊れ、獲物が地面に立っている').toEqual(['junglefowl']);
    expect(prey.parent, '中身は道連れにならず土地へこぼれる').toBe(grassland);
  });

  it('ヤケイを解体すると、肉と羽に分かれる', () => {
    // 鶏肉も獣肉も同じ生肉になり、骨も獲物の種類によらず出る（HuntingSystem.md 1.5節）。羽は
    // 使い道がまだ無いが、素材として溜まる（docs/world/Animals.md 10節）。
    open(CATCHES_FOWL);
    const prey = tickUntilCaught();
    const carcass = session.spawn(codex.objectNames.getId('junglefowl_carcass'));
    expect(carcass.moveToSlot(grassland, codex.slotNames.getId('items'))).toBeUndefined();
    prey.destroy();

    const knife = spawnInto('sharp_stone', player, 'hand');
    expect(carcass.tryExecuteCombination(knife, player, 'butcher', session)).toBe(true);

    expect(itemsOnGround()).toEqual(['snare', 'raw_meat', 'feather', 'small_bone']);
  });

  it('ネズミは解体せず、丸焼きにして食べると小さな骨が残る', () => {
    // 80gの体から肉の塊は取れないので、生肉を刻まずに丸ごと焼く（docs/world/Animals.md 3節）。
    // 小さすぎる肉のカードを作ると、料理で生肉と競合する（HuntingSystem.md 1.5節）。
    open(CATCHES_RAT);
    const carcass = tickUntilCaught();
    expect(carcass.def.name).toBe('rat_carcass');
    expect(
      carcass.def.combinations.map((combination) => combination.name),
      '解体はできない',
    ).toEqual([]);

    // 罠だけを起点に、刃物を1つも経由せず縫製の材料へ届く
    // （docs/world/SurvivalItems.md 1.2節の 繊維 → 罠 → 小動物 → 小骨 → 骨針）。
    const roasted = spawnInto('roasted_rat', player, 'hand');
    expect(roasted.tryExecuteAction('eat', player, session)).toBe(true);

    const inHand = player.tryGetSlot(codex.slotNames.getId('hand'))!.contents.map((o) => o.def.name);
    expect(inHand, '食べ終われば骨が残る').toContain('small_bone');
  });

  it('取り出せば暴れるが、閉じ込め続ければ落ち着く', () => {
    // 拘束はmodify（実効値への可逆な寄与）なので、罠から出せば消える。ただし警戒の実体値は
    // 罠の中でも-1/tickで引き続けるので、**長く閉じ込めた個体は出しても暴れない**——これが
    // 生かす罠から飼いならしへ続く道になる（TrapSystem.md 5.2節）。
    open(CATCHES_FOWL);
    const prey = tickUntilCaught();

    expect(prey.moveToSlot(grassland, codex.slotNames.getId('items'))).toBeUndefined();
    expect(prey.readProperty(warinessId)!.value, '掛かってすぐ出せば暴れる').toBeGreaterThan(0);

    tick(40);
    expect(prey.readProperty(warinessId)!.value, '時間が経てば落ち着く').toBe(0);
  });

  it('くくり罠は植物繊維だけから作れる', () => {
    // 繊維だけを起点にした浅い経路（docs/world/SurvivalItems.md 1.2節）。刃物を要らないので、
    // 狩猟の入口そのものは塞がらない。
    const def = codex.objects.get(codex.objectNames.getId('snare'));
    const [recipe] = def.recipes;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(1);
    expect(step!.requirements[0].requires(codex.objects.get(codex.objectNames.getId('plant_fiber')))).toBe(
      true,
    );
  });
});

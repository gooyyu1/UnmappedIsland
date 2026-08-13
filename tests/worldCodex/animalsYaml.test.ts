import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * animals.yamlの動物を、実ファイルの定義だけで検証する（docs/engine/HuntingSystem.md・
 * docs/world/Animals.md）。武器で殴る→怪我が刺さる→警戒が上がる→時間で引く、の一巡を通す。
 */
describe('animals.yamlの動物', () => {
  /** strikeで当たる側を引く重みの位置（当たり70 : 外れ30）。 */
  const HITS = 0.5;
  /** 同じくの外れる側。 */
  const MISSES = 0.95;

  let codex: WorldCodex;
  let session: WorldSession;
  let jungle: WorldObject;
  let player: WorldObject;
  let monkey: WorldObject;
  let warinessId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    warinessId = codex.propertyNames.getId('wariness');
  });

  beforeEach(() => {
    open(HITS);
  });

  /** 密林に立つプレイヤーと、その足元のサルから始める。rollはpickがどの候補を引くかを決める。 */
  function open(roll: number): void {
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
    jungle = spawnInto('jungle', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    monkey = spawnInto('monkey', jungle, 'items');
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  /** その動物に刺さっている怪我の識別子。 */
  function injuriesOf(animal: WorldObject): string[] {
    const slot = animal.tryGetSlot(codex.slotNames.getId('injuries'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** 尖った石を手に持たせ、それをサルへ重ねて殴る。 */
  function strikeWithSharpStone(): WorldObject {
    const stone = spawnInto('sharp_stone', player, 'hand');
    expect(monkey.tryExecuteCombination(stone, undefined, 'strike', session)).toBe(true);
    return stone;
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) monkey.tick(session);
  }

  /** bodyの実行中に告げられた出来事（signal、9.8節）を「誰の身に・何が」の形で並べる。 */
  function signalsOf(body: () => void): string[] {
    const seen: string[] = [];
    session.observeSignals((signal) => seen.push(`${signal.object.def.name}: ${signal.name}`), body);
    return seen;
  }

  it('サルはアイテムでもある動物として、土地のアイテムスロットに並ぶ', () => {
    // 動物を分けるのは「持ち運べるか」ではなく「動かせるか」（HuntingSystem.md 1.1節）。
    const def = codex.objects.get(codex.objectNames.getId('monkey'));

    expect(def.tags).toContain(codex.tagNames.getId('item'));
    expect(def.tags).toContain(codex.tagNames.getId('animal'));
    expect(monkey.parent, '土地のitemsスロットに居る').toBe(jungle);
  });

  it('野生のサルは警戒した状態で現れ、放っておけば落ち着く', () => {
    // 明滅（CardView.md 3節）は域だけで決まるので、現れた時点で安全域を外れていることが要件。
    expect(monkey.readProperty(warinessId)?.alert, '現れた時点で安全域ではない').not.toBe('safe');
    expect(monkey.readProperty(warinessId)?.worsensUpward, '増えるほど悪い').toBe(true);

    // 40からの-1/tickなので、21tick（5時間15分）で安全域へ落ちる。
    tick(21);

    expect(monkey.readProperty(warinessId)?.alert, '待てば落ち着く').toBe('safe');
  });

  it('尖った石をサルへ重ねると殴れて、切り傷が1つ刺さる', () => {
    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '傷は動物のinjuriesスロットへ入る').toEqual(['laceration']);
    expect(stone.parent, '武器は手元に残る').toBe(player);
    expect(session.world!.totalMinutes, 'durationの15分が経つ').toBe(15);
  });

  it('殴れば警戒が上がり、刃も摩耗する', () => {
    const before = monkey.getNumber(warinessId);

    const stone = strikeWithSharpStone();

    // 上げるのは25だが、殴るのに15分＝1tickかかるぶんの落ち着き（-1/tick）が同時に起きる。
    expect(monkey.getNumber(warinessId) - before).toBe(25 - 1);
    expect(stone.readProperty(codex.propertyNames.getId('durability'))?.value).toBe(960 - 20);
  });

  it('外した回は傷が付かないが、警戒と摩耗はそのまま起きる', () => {
    // 当たり外れによらない分を各候補へ複製している（animals.yaml、issue #415）ので、外れた側でも
    // 抜けていないことを確かめる。
    open(MISSES);
    const before = monkey.getNumber(warinessId);

    const stone = strikeWithSharpStone();

    expect(injuriesOf(monkey), '外れれば傷は付かない').toEqual([]);
    expect(monkey.getNumber(warinessId) - before, '殴られたこと自体で気は立つ').toBe(25 - 1);
    expect(stone.readProperty(codex.propertyNames.getId('durability'))?.value).toBe(960 - 20);
  });

  it('当たった回も外した回も、殴られた側の札の上で起きたことを告げる', () => {
    // 当たった傷は押して開くinjuriesスロットへ入り、外した回は世界の形が何も変わらないため、
    // どちらもレーンを見ているだけでは分からない（HuntingSystem.md 6.3節）。
    expect(signalsOf(strikeWithSharpStone)).toEqual(['monkey: hit']);

    open(MISSES);

    expect(signalsOf(strikeWithSharpStone)).toEqual(['monkey: missed']);
  });

  it('殴り続ければ危険域まで気が立つ', () => {
    // 段はワールド側の宣言なので、しきい値を刻み直したらここで落ちる。
    strikeWithSharpStone();
    expect(monkey.readProperty(warinessId)?.alert, '1発では警戒のまま').toBe('caution');

    strikeWithSharpStone();

    expect(monkey.readProperty(warinessId)?.alert).toBe('danger');
  });

  it('負わせた傷は時間で治り、治りきれば消える', () => {
    // 手負いの動物を追う時限（HuntingSystem.md 3節）が、怪我の側の自然治癒だけで成り立つ。
    strikeWithSharpStone();

    tick(479);
    expect(injuriesOf(monkey), '治りきる手前ではまだ残っている').toEqual(['laceration']);

    tick(1);

    expect(injuriesOf(monkey)).toEqual([]);
  });

  it('動物の傷は、キャラクタの怪我と同じ物である', () => {
    // 同じ定義を両方へ刺す（HuntingSystem.md 3節）。動物は痛みを持たないので、怪我が宣言している
    // 痛みへの寄与は宛先が無く効かない——怪我の側は相手を選ばない。
    strikeWithSharpStone();
    const wound = monkey.tryGetSlot(codex.slotNames.getId('injuries'))!.contents[0];

    expect(wound.def.tags).toContain(codex.tagNames.getId('injury'));
    expect(wound.readProperty(codex.propertyNames.getId('severity'))?.ratio).toBe(1);
    expect(monkey.readProperty(codex.propertyNames.getId('pain')), 'サルは痛みを持たない').toBeUndefined();

    expect(
      wound.moveToSlot(jungle, codex.slotNames.getId('items')),
      '負った本人から剥がせない（bound_to_owner）',
    ).toContain('離せません');
  });

  it('傷は押して開ける主要なスロットに入るので、カードを開けば並ぶ', () => {
    // キャラクタの怪我と同じ見え方にするための宣言（HuntingSystem.md 3節）。
    const def = codex.objects.get(codex.objectNames.getId('monkey'));

    expect(def.mainItemSlotGlobalId).toBe(codex.slotNames.getId('injuries'));
  });

  it('武器でない物を重ねても殴れない', () => {
    const stone = spawnInto('stone', player, 'hand');

    expect(monkey.findMatchingCombinations(stone), '素手の石はweaponタグを持たない').toEqual([]);
  });
});

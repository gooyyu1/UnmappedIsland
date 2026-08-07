import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import {
  loadYamlDirectory,
  loadYamlFile,
  SAMPLE_CHARACTER,
  worldCodexPath,
} from '../support/worldCodexFiles';

describe('liquid_containers.yamlの液体容器定義', () => {
  let codex: WorldCodex;
  let nextInstanceId: number;
  let hydrationId: number;
  let wakefulnessId: number;
  let weatherId: number;
  let hourId: number;
  let locationsSlotId: number;
  let contentSlotId: number;
  let sizeId: number;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlDirectory(loader, worldCodexPath('characters'));
    loadYamlFile(loader, worldCodexPath('liquid_containers.yaml'));
    codex = loader.build();

    hydrationId = codex.propertyNames.getId('hydration');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
    weatherId = codex.propertyNames.getId('weather');
    hourId = codex.propertyNames.getId('hour');
    locationsSlotId = codex.slotNames.getId('locations');
    contentSlotId = codex.slotNames.getId('content');
    sizeId = codex.propertyNames.getId('size');
  });

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function spawn(objectName: string): WorldObject {
    return new WorldObject(
      nextInstanceId++,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  /** 液体入りの容器。量は容器ではなく中身の液体がsizeとして持つ。 */
  function spawnContainer(containerName: string, liquidKind: string, size: number): WorldObject {
    const container = spawn(containerName);
    const content = spawn(`${liquidKind}_liquid`);
    content.setProperty(sizeId, size);
    content.moveToSlot(container, contentSlotId, codex.wellKnown);
    return container;
  }

  /** contentスロットの中身。空ならundefined（空の容器には中身のインスタンスが存在しない）。 */
  function contentOf(container: WorldObject): WorldObject | undefined {
    return container.tryGetSlot(contentSlotId)?.contents[0];
  }

  function amountIn(container: WorldObject): number {
    return contentOf(container)?.getNumber(sizeId) ?? 0;
  }

  function capacityOf(containerName: string): number | undefined {
    const def = codex.objects.get(codex.objectNames.getId(containerName));
    return def.enumerateSlotDefs().find((s) => s.name === 'content')?.capacity;
  }

  function requireContent(container: WorldObject): WorldObject {
    const content = contentOf(container);
    if (content === undefined) throw new Error(`'${container.def.name}' に中身がありません。`);
    return content;
  }

  /** hourは既定で昼（10-17時のdayステージ）。sunlightはhourとweatherの寄与の和で決まる。 */
  function spawnWorld(weather: string, hour = 12): WorldObject {
    const world = spawn('world');
    world.setProperty(weatherId, codex.symbolNames.intern(weather));
    world.setProperty(hourId, hour);
    return world;
  }

  function spawnEmptyUnderWorld(
    containerName: string,
    world: WorldObject,
    session: WorldSession,
  ): WorldObject {
    const container = spawn(containerName);
    container.moveToSlot(world, locationsSlotId, session.codex.wellKnown, true);
    return container;
  }

  function spawnContainerUnderWorld(
    containerName: string,
    liquidKind: string,
    size: number,
    world: WorldObject,
    session: WorldSession,
  ): WorldObject {
    const container = spawnContainer(containerName, liquidKind, size);
    container.moveToSlot(world, locationsSlotId, session.codex.wellKnown, true);
    return container;
  }

  it('容器はcontent経由で中身へ委譲されるラッパーで、量は持たない', () => {
    const canteen = codex.objects.get(codex.objectNames.getId('canteen'));

    expect(canteen.representedBySlotGlobalId).toBe(contentSlotId);
    expect(canteen.actions, '容器本体は中身の行動を持たない').toHaveLength(0);
    expect(
      canteen.getPropertyDef(sizeId),
      '量は中身が持つ。容器側にあるのは上限（capacity）だけ',
    ).toBeUndefined();
    expect(
      canteen.combinations,
      '空のときに受け取るためのpour_inだけは容器本体が持つ（代表が自分自身になるため）',
    ).toHaveLength(1);
  });

  it('容量は容器のcontentスロットのcapacityが決める', () => {
    expect(capacityOf('coconut_bowl'), 'ヤシの器は250mL').toBe(250);
    expect(capacityOf('canteen'), '水筒は1L').toBe(1000);
    expect(capacityOf('bottle'), '瓶は2L').toBe(2000);
    expect(capacityOf('jar'), '甕は4L').toBe(4000);
  });

  it('水を飲むと中身のsizeからactorのhydrationへ移る', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    actor.setProperty(hydrationId, 0);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.tryExecuteAction('drink', actor, session), '容器への操作は中身へ委譲される').toBe(true);

    expect(actor.getNumber(hydrationId)).toBe(250);
    expect(amountIn(canteen)).toBe(750);
  });

  it('水分が満水だと飲めず、理由not_thirstyを返す', () => {
    // 満水では0mLの何も起きない飲用になるため、実行自体をさせない（liquid_containers.yaml）。
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .getPropertyDef(hydrationId)!.range!.max;
    actor.setProperty(hydrationId, hydrationMax);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.actionUnmetRequirement('drink', actor)?.reasonName).toBe('not_thirsty');
    expect(canteen.tryExecuteAction('drink', actor, session)).toBe(false);
    expect(amountIn(canteen), '実行されないので量は変わらない').toBe(1000);
  });

  it('水分が満水の一歩手前なら飲め、入る分だけが移る', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const hydrationMax = codex.objects
      .get(codex.objectNames.getId(SAMPLE_CHARACTER))
      .getPropertyDef(hydrationId)!.range!.max;
    actor.setProperty(hydrationId, hydrationMax - 100);
    const canteen = spawnContainer('canteen', 'water', 1000);

    expect(canteen.actionUnmetRequirement('drink', actor)).toBeUndefined();
    expect(canteen.tryExecuteAction('drink', actor, session)).toBe(true);

    expect(actor.getNumber(hydrationId), 'あふれる分は飲まない').toBe(hydrationMax);
    expect(amountIn(canteen), '空き容量(100)の分だけ減る').toBe(900);
  });

  it('残りを飲み切ると、中身のインスタンスごと消えて空の容器へ戻る', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    actor.setProperty(hydrationId, 0);
    const canteen = spawnContainer('canteen', 'water', 100); // 1回分(250)より少ない

    expect(canteen.tryExecuteAction('drink', actor, session)).toBe(true);

    expect(actor.getNumber(hydrationId), '残っている分だけ飲む').toBe(100);
    expect(contentOf(canteen), 'tickを待たずに空へ戻る（0mLの水は存在しない）').toBeUndefined();
  });

  it('お茶を飲むと追加の効果も適用できる', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    actor.setProperty(hydrationId, 0);
    actor.setProperty(wakefulnessId, 0);
    const canteen = spawnContainer('canteen', 'tea', 1000);

    expect(canteen.tryExecuteAction('drink', actor, session)).toBe(true);

    expect(actor.getNumber(hydrationId)).toBe(250);
    expect(actor.getNumber(wakefulnessId)).toBe(200);
  });

  it('お茶のwakefulness効果は飲んだ量に比例する', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    actor.setProperty(hydrationId, 0);
    actor.setProperty(wakefulnessId, 0);
    const canteen = spawnContainer('canteen', 'tea', 125); // 1回分(250)の半分しか無い

    expect(canteen.tryExecuteAction('drink', actor, session)).toBe(true);

    expect(actor.getNumber(hydrationId), '在庫の分だけ飲む').toBe(125);
    expect(actor.getNumber(wakefulnessId), 'linked_addは実際に移った量に比例する').toBe(100);
  });

  it('油にはdrinkアクションが無い', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const canteen = spawnContainer('canteen', 'oil', 1000);

    expect(canteen.tryExecuteAction('drink', actor, session), '飲用不可の液体はdrinkを持たない').toBe(false);
  });

  /**
   * 中身のバーの色は液体自身が宣言する（ScreenLayout.md カードの状態バー節）。宣言し忘れた液体は
   * 灰色で出るだけで画面を見ても気付けないため、ここで全ての液体が持っていることを検査する。
   */
  it('液体はすべて自分の色を宣言している', () => {
    const colorId = codex.propertyNames.getId('color');
    const liquids = codex.objectDefNamesWithTag('liquid');
    expect(liquids.length, '検査対象が無い（liquidタグが変わっていないか）').toBeGreaterThan(0);

    const colors = liquids.map((name) => {
      const color = spawn(name).readProperty(colorId)?.value;
      expect(color, `'${name}' が色を宣言していない`).toBeDefined();
      return color;
    });
    expect(new Set(colors).size, '同じ色の液体は見分けが付かない').toBe(colors.length);
  });

  it('水は青、茶は茶緑、油は黄色に見える', () => {
    const colorId = codex.propertyNames.getId('color');
    const [water, tea, oil] = ['water', 'tea', 'oil'].map((kind) => {
      const color = spawn(`${kind}_liquid`).getNumber(colorId);
      return { red: (color >> 16) & 0xff, green: (color >> 8) & 0xff, blue: color & 0xff };
    });

    expect(water.blue, '水は青が最も強い').toBeGreaterThan(Math.max(water.red, water.green));
    expect(tea.green, '茶は緑が最も強い').toBeGreaterThan(Math.max(tea.red, tea.blue));
    expect(Math.min(oil.red, oil.green), '油は赤と緑が揃って強い＝黄色').toBeGreaterThan(oil.blue);
  });

  // 昼のsunlightは cloudy 7 / clear 10 / sunny 12 / scorching 15。
  it.each([
    ['cloudy', -1],
    ['clear', -1],
    ['sunny', -2],
    ['scorching', -3],
  ])('coconut_bowlの昼の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world, session);

    bowl.tick(session);

    expect(amountIn(bowl)).toBe(100 + expectedDelta);
  });

  it.each([
    ['cloudy', -2],
    ['clear', -4],
    ['sunny', -6],
    ['scorching', -8],
  ])('jarの昼の蒸発量は日差しの強さ(%s)で決まる', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 200, world, session);

    jar.tick(session);

    expect(amountIn(jar)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -1],
    ['jar', -2],
  ])('夜(%s)は日射の上乗せが消え、基礎の蒸発だけが残る', (containerName, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld('scorching', 0); // 夜はsunlightが0にクランプされる
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world, session);

    container.tick(session);

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  it.each([
    ['coconut_bowl', -2],
    ['jar', -6],
  ])('朝夕(%s)の日差しは昼より弱い', (containerName, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld('scorching', 7); // sunlight 12（昼のsunnyと同値）
    const container = spawnContainerUnderWorld(containerName, 'water', 200, world, session);

    container.tick(session);

    expect(amountIn(container)).toBe(200 + expectedDelta);
  });

  // 雨天は蒸発せず（蒸発の基礎は雨天を除外する）、代わりに降った分だけ増える。
  it.each([
    ['light_rain', 10],
    ['heavy_rain', 20],
    ['storm', 40],
  ])('coconut_bowlに溜まる雨の量は降り方(%s)で決まる', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world, session);

    bowl.tick(session);

    expect(amountIn(bowl)).toBe(100 + expectedDelta);
  });

  it.each([
    ['light_rain', 20],
    ['heavy_rain', 40],
    ['storm', 80],
  ])('jarに溜まる雨の量は降り方(%s)で決まる', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 100, world, session);

    jar.tick(session);

    expect(amountIn(jar)).toBe(100 + expectedDelta);
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)には雨が溜まらない', (objectName) => {
    const session = new WorldSession(codex);
    const world = spawnWorld('storm');
    const container = spawnContainerUnderWorld(objectName, 'water', 100, world, session);

    container.tick(session);

    expect(amountIn(container)).toBe(100);
  });

  it('雨で増えるのは水だけで、茶の入った容器は開いていても増えない', () => {
    const session = new WorldSession(codex);
    const world = spawnWorld('storm');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'tea', 100, world, session);

    bowl.tick(session);

    expect(amountIn(bowl)).toBe(100);
  });

  it('capacityを超えて降った分はあふれて失われる', () => {
    const session = new WorldSession(codex);
    const world = spawnWorld('storm'); // ヤシの器へ1tickに40mL
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 240, world, session);

    bowl.tick(session);

    expect(amountIn(bowl), '満杯(250)で止まる').toBe(250);
  });

  it('雨が降っていれば、空の容器に雨を貯め始められる', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world, session);

    expect(bowl.actionUnmetRequirement('collect_rain', actor)).toBeUndefined();
    expect(bowl.tryExecuteAction('collect_rain', actor, session)).toBe(true);

    expect(requireContent(bowl).def.name, '溜まるのは水').toBe('water_liquid');
    expect(amountIn(bowl), '最少の量で始まり、以後は降っている間に増える').toBe(1);
  });

  it('貯め始めた雨は、そのまま降り続けるぶんだけ増える', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world, session);

    bowl.tryExecuteAction('collect_rain', actor, session);
    bowl.tick(session);

    expect(amountIn(bowl)).toBe(1 + 10);
  });

  it('雨が降っていなければ貯められず、理由not_rainingを返す', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('clear');
    const bowl = spawnEmptyUnderWorld('coconut_bowl', world, session);

    expect(bowl.actionUnmetRequirement('collect_rain', actor)?.reasonName).toBe('not_raining');
    expect(bowl.tryExecuteAction('collect_rain', actor, session)).toBe(false);
    expect(contentOf(bowl), '空のまま').toBeUndefined();
  });

  it('中身の入った容器では雨を貯めるアクションが出ない（操作が中身へ委譲されるため）', () => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('light_rain');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world, session);

    expect(bowl.tryExecuteAction('collect_rain', actor, session)).toBe(false);

    expect(amountIn(bowl), '溜まり続けるのはpassiveの仕事で、操作は要らない').toBe(100);
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)は雨を貯めるアクション自体を持たない', (name) => {
    const session = new WorldSession(codex);
    const actor = spawn(SAMPLE_CHARACTER);
    const world = spawnWorld('storm');
    const container = spawnEmptyUnderWorld(name, world, session);

    expect(container.tryExecuteAction('collect_rain', actor, session)).toBe(false);
    expect(contentOf(container)).toBeUndefined();
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)は蒸発しない', (objectName) => {
    const session = new WorldSession(codex);
    const world = spawnWorld('scorching');
    const container = spawnContainerUnderWorld(objectName, 'water', 100, world, session);

    container.tick(session);

    expect(amountIn(container)).toBe(100);
  });

  it('蒸発で量が尽きると中身のインスタンスごと消える', () => {
    const session = new WorldSession(codex);
    const world = spawnWorld('clear');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 1, world, session);

    bowl.tick(session);

    expect(contentOf(bowl), '量が0の液体は存在しない（quantitativeの不変条件）').toBeUndefined();
  });

  it('中身の液体は器から出せない', () => {
    // bound_to_owner（7.9節）。器の無い水は存在しないので、別の器へ移すのはpour_inの仕事——
    // 液体のインスタンスを掴んで運ぶことはできない。
    const jar = spawnContainer('jar', 'water', 800);
    const empty = spawn('canteen');

    expect(requireContent(jar).moveToSlot(empty, contentSlotId, codex.wellKnown)).toContain('離せません');
    expect(amountIn(jar), '注ぎ元に残る').toBe(800);
    expect(contentOf(empty)).toBeUndefined();
  });

  it('空の容器へ注ぐと、その量の液体が注ぎ先に生まれる', () => {
    const session = new WorldSession(codex);
    const empty = spawn('canteen');
    const jar = spawnContainer('jar', 'water', 800);
    const poured = requireContent(jar);

    expect(empty.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(amountIn(empty), '全量が移る').toBe(800);
    expect(contentOf(jar), '空になった注ぎ元の中身は消える').toBeUndefined();
  });

  it('同じ種類の中身が入った容器へ注ぐと継ぎ足される', () => {
    const session = new WorldSession(codex);
    const canteen = spawnContainer('canteen', 'water', 400);
    const jar = spawnContainer('jar', 'water', 500);
    const receiver = requireContent(canteen);
    const poured = requireContent(jar);

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(amountIn(canteen)).toBe(900);
    expect(contentOf(jar)).toBeUndefined();
  });

  it('capacityに入りきらない量は注ぎ元に残る', () => {
    const session = new WorldSession(codex);
    const bowl = spawn('coconut_bowl'); // capacity 250
    const jar = spawnContainer('jar', 'water', 1000);
    const poured = requireContent(jar);

    expect(bowl.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(amountIn(bowl), '入る分だけ入る').toBe(250);
    expect(amountIn(jar), '残りは注ぎ元に留まる').toBe(750);
  });

  it('異なる種類の中身が入った容器へは注げない', () => {
    const session = new WorldSession(codex);
    const canteen = spawnContainer('canteen', 'tea', 400);
    const jar = spawnContainer('jar', 'water', 500);
    const receiver = requireContent(canteen);
    const poured = requireContent(jar);

    receiver.tryExecuteCombination(poured, undefined, 'pour_in', session);

    expect(amountIn(canteen), '混ざらない（contentのaccepts max:1が拒む）').toBe(400);
    expect(amountIn(jar)).toBe(500);
  });
});

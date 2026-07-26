import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { PropertyDef } from '../../src/domain/defs/PropertyDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlFile, worldCodexPath } from '../support/worldCodexFiles';

describe('liquid_containers.yamlの液体容器定義', () => {
  let codex: WorldCodex;
  let nextInstanceId: number;
  let hydrationId: number;
  let wakefulnessId: number;
  let weatherId: number;
  let locationsSlotId: number;
  let contentSlotId: number;
  let liquidAmountId: number;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlFile(loader, worldCodexPath('characters.yaml'));
    loadYamlFile(loader, worldCodexPath('liquid_containers.yaml'));
    codex = loader.build();

    hydrationId = codex.propertyNames.getId('hydration');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
    weatherId = codex.propertyNames.getId('weather');
    locationsSlotId = codex.slotNames.getId('locations');
    contentSlotId = codex.slotNames.getId('content');
    liquidAmountId = codex.propertyNames.getId('liquid_amount');
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

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.getPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }

  function liquidMarkerNameFor(liquidKind: string): string {
    return `${liquidKind}_liquid`;
  }

  function spawnContainer(containerName: string, liquidKind: string, liquidAmount: number): WorldObject {
    const container = spawn(containerName);
    container.setProperty(liquidAmountId, liquidAmount);
    const content = spawn(liquidMarkerNameFor(liquidKind));
    content.moveToSlot(container, contentSlotId, codex.wellKnown);
    return container;
  }

  function contentOf(container: WorldObject): WorldObject {
    const slot = container.tryGetSlot(contentSlotId);
    if (slot === undefined || slot.contents.length !== 1)
      throw new Error(`'${container.def.name}' のcontentスロットの中身がちょうど1つではありません。`);
    return slot.contents[0];
  }

  function spawnWorld(weather: string): WorldObject {
    const world = spawn('world');
    world.setProperty(weatherId, codex.symbolNames.intern(weather));
    return world;
  }

  function spawnContainerUnderWorld(
    containerName: string,
    liquidKind: string,
    liquidAmount: number,
    world: WorldObject,
    session: WorldSession,
  ): WorldObject {
    const container = spawnContainer(containerName, liquidKind, liquidAmount);
    container.moveToSlot(world, locationsSlotId, session.codex.wellKnown, true);
    return container;
  }

  function findOnlyMatchingCombinationName(self: WorldObject, dragged: WorldObject): string {
    const matches = self.findMatchingCombinations(dragged);
    expect(matches.length, 'この組み合わせでは候補が1つだけであることを前提にしている').toBe(1);
    return matches[0].name;
  }

  it('容器はcontent経由で中身へ委譲されるラッパーで、liquid_amountを持つ', () => {
    const canteen = codex.objects.get(codex.objectNames.getId('canteen'));

    expect(canteen.representedBySlotGlobalId).toBe(contentSlotId);
    expect(canteen.actions, '容器本体は中身の行動を持たない').toHaveLength(0);
    expect(canteen.combinations, '容器本体は注ぎ処理を持たない').toHaveLength(0);
    expect(
      canteen.getPropertyDef(codex.propertyNames.getId('liquid_amount')),
      '容器本体はliquid_amountを持つ',
    ).toBeDefined();
  });

  it.each([
    ['coconut_bowl', 1200],
    ['canteen', 4800],
    ['pot', 4800],
    ['bottle', 9600],
    ['jar', 19200],
  ])('%sは期待される液体容量%iを持つ', (containerName, expectedMax) => {
    const container = codex.objects.get(codex.objectNames.getId(containerName));
    const liquidAmount = propOf(container, 'liquid_amount');

    expect(liquidAmount.range).toBeDefined();
    expect(liquidAmount.range?.max).toBe(expectedMax);
  });

  it('水を飲むと容器からactorのhydrationへ委譲される', () => {
    const session = new WorldSession(codex);
    const actor = spawn('character');
    const canteen = spawnContainer('canteen', 'water', 3000);
    actor.setProperty(hydrationId, 0);

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed).toBe(true);
    expect(canteen.getNumber(liquidAmountId)).toBe(1800);
    expect(actor.getNumber(hydrationId)).toBe(1200);
  });

  it('お茶を飲むと追加の効果も適用できる', () => {
    const session = new WorldSession(codex);
    const actor = spawn('character');
    const canteen = spawnContainer('canteen', 'tea', 3000);
    actor.setProperty(hydrationId, 0);
    actor.setProperty(wakefulnessId, 0);

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed).toBe(true);
    expect(actor.getNumber(hydrationId)).toBe(1200);
    expect(actor.getNumber(wakefulnessId), 'お茶だけが持つ追加効果もrepresented_by経由で発動する').toBe(200);
  });

  it('お茶のwakefulness効果は飲んだ量に比例する', () => {
    const session = new WorldSession(codex);
    const actor = spawn('character');
    const canteen = spawnContainer('canteen', 'tea', 600);
    actor.setProperty(hydrationId, 0);
    actor.setProperty(wakefulnessId, 0);

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed).toBe(true);
    expect(actor.getNumber(hydrationId), '在庫(600)の分しか水分補給されない').toBe(600);
    expect(actor.getNumber(wakefulnessId), '飲んだ量(600)に比例した眠気改善: 200 * 600 / 1200 = 100').toBe(
      100,
    );
  });

  it('油にはdrinkアクションが無い', () => {
    const session = new WorldSession(codex);
    const actor = spawn('character');
    const canteen = spawnContainer('canteen', 'oil', 3000);

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed, '飲用不可の液体は自分でdrinkアクションを持たない').toBe(false);
  });

  it.each([
    ['cloudy', -1],
    ['clear', -2],
    ['sunny', -3],
    ['scorching', -4],
  ])('coconut_bowlの蒸発量は天気(%s)に依存する', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world, session);

    bowl.tick(session);

    expect(bowl.getNumber(liquidAmountId)).toBe(100 + expectedDelta);
  });

  it.each(['storm', 'heavy_rain', 'light_rain'])('coconut_bowlは雨天(%s)では蒸発しない', (weather) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 100, world, session);

    bowl.tick(session);

    expect(bowl.getNumber(liquidAmountId)).toBe(100);
  });

  it.each([
    ['cloudy', -2],
    ['clear', -4],
    ['sunny', -6],
    ['scorching', -8],
  ])('jarの蒸発量は天気(%s)に依存する', (weather, expectedDelta) => {
    const session = new WorldSession(codex);
    const world = spawnWorld(weather);
    const jar = spawnContainerUnderWorld('jar', 'water', 200, world, session);

    jar.tick(session);

    expect(jar.getNumber(liquidAmountId)).toBe(200 + expectedDelta);
  });

  it.each(['canteen', 'pot', 'bottle'])('密閉容器(%s)は蒸発しない', (objectName) => {
    const session = new WorldSession(codex);
    const world = spawnWorld('scorching');
    const container = spawnContainerUnderWorld(objectName, 'water', 100, world, session);

    container.tick(session);

    expect(container.getNumber(liquidAmountId)).toBe(100);
  });

  it('蒸発で液体が尽きるとliquid_amountは0で止まる', () => {
    const session = new WorldSession(codex);
    const world = spawnWorld('clear');
    const bowl = spawnContainerUnderWorld('coconut_bowl', 'water', 2, world, session);

    bowl.tick(session);

    expect(bowl.getNumber(liquidAmountId)).toBe(0);
  });

  it('空の容器へ注ぐと空マーカーが注いだ液体の種類に置き換わる', () => {
    const session = new WorldSession(codex);
    const self = spawnContainer('canteen', 'empty', 0);
    const dragged = spawnContainer('canteen', 'water', 3000);
    const combinationName = findOnlyMatchingCombinationName(self, dragged);

    const executed = self.tryExecuteCombination(dragged, undefined, combinationName, session);

    expect(executed).toBe(true);
    expect(contentOf(self).def.name).toBe('water_liquid');
    expect(self.getNumber(liquidAmountId)).toBe(3000);
    expect(dragged.getNumber(liquidAmountId)).toBe(0);
  });

  it('同じ中身の容器へ注ぐと種類を変えずに継ぎ足される', () => {
    const session = new WorldSession(codex);
    const self = spawnContainer('canteen', 'water', 500);
    const dragged = spawnContainer('canteen', 'water', 3000);

    const executed = self.tryExecuteCombination(dragged, undefined, 'pour_in', session);

    expect(executed).toBe(true);
    expect(contentOf(self).def.name).toBe('water_liquid');
    expect(self.getNumber(liquidAmountId)).toBe(3500);
    expect(dragged.getNumber(liquidAmountId)).toBe(0);
  });

  it('異なる中身の容器へ注ぐと何も起きずfalseを返す', () => {
    const session = new WorldSession(codex);
    const self = spawnContainer('canteen', 'oil', 500);
    const dragged = spawnContainer('canteen', 'water', 3000);

    const executed = self.tryExecuteCombination(dragged, undefined, 'pour_in', session);

    expect(executed).toBe(false);
    expect(contentOf(self).def.name).toBe('oil_liquid');
    expect(self.getNumber(liquidAmountId)).toBe(500);
    expect(dragged.getNumber(liquidAmountId)).toBe(3000);
  });
});

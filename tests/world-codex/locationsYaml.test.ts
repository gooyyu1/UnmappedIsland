import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { Path } from '../../src/domain/wrappers/Path';
import { pathsIn } from '../support/paths';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/** locations.yamlが定義する全土地。 */
const LAND_NAMES = [
  'sandy_beach',
  'rocky_coast',
  'cliff_coast',
  'grassland',
  'forest',
  'jungle',
  'rocky_field',
  'wasteland',
  'mountainside',
  'mountain_peak',
] as const;

describe('locations.yamlの土地・道定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // 土地の発見物（foods.yamlの食料等）・キャラクタ（characters/）への参照があるため、
    // 単体ファイルではなくディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function def(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

  it('すべての土地はlocationタグを持つ', () => {
    const locationTag = codex.tagNames.getId('location');
    for (const name of LAND_NAMES)
      expect(def(name).tags, `${name} はlocationタグ（location trait）を持つ`).toContain(locationTag);
  });

  it('すべての土地は期待されるスロットを持ち、キャラクタスロットは固定・単数である', () => {
    for (const name of LAND_NAMES) {
      const land = def(name);
      for (const slotName of ['items', 'fixtures', 'characters', 'undiscovered_fixtures'])
        expect(
          land.tryGetSlotDef(codex.slotNames.getId(slotName)),
          `${name} は ${slotName} スロットを持つ`,
        ).toBeDefined();

      // 探索でその場に湧く設置物は、宣言順で最初に受け入れたスロットへ入る（WorldObject.place）。
      // undiscovered_fixturesが先に来ると、湧いた設置物まで未発見側へ入って表示されなくなる。
      const slotNames = [...land.enumerateSlotDefs()].map((slot) => codex.slotNames.getName(slot.globalId));
      expect(
        slotNames.indexOf('fixtures'),
        `${name}: fixturesはundiscovered_fixturesより先に宣言されている`,
      ).toBeLessThan(slotNames.indexOf('undiscovered_fixtures'));

      const characters = land.tryGetSlotDef(codex.slotNames.getId('characters'));
      expect(characters?.cellCount, `${name} のキャラクタスロットは1枠`).toBe(1);

      const items = land.tryGetSlotDef(codex.slotNames.getId('items'));
      const fixtures = land.tryGetSlotDef(codex.slotNames.getId('fixtures'));
      expect(items?.capacity, `${name} のアイテムスロットにサイズ制限は無い`).toBeUndefined();
      expect(fixtures?.capacity, `${name} の設置物スロットにサイズ制限は無い`).toBeUndefined();
    }
  });

  it('すべての土地の探索率100%までの回数は10〜20の範囲に収まる', () => {
    const progressId = codex.propertyNames.getId('exploration_progress');
    for (const name of LAND_NAMES) {
      const progress = def(name).tryGetPropertyDef(progressId);
      expect(progress, `${name} は探索進捗プロパティを持つ`).toBeDefined();
      expect(progress?.range, `${name} の探索進捗はrangeを持つ`).toBeDefined();
      const max = progress?.range?.max ?? 0;
      expect(max, `${name} の探索率100%までの回数は10〜20`).toBeGreaterThanOrEqual(10);
      expect(max, `${name} の探索率100%までの回数は10〜20`).toBeLessThanOrEqual(20);
    }
  });

  it('すべての土地は探索のたびに進捗が+1され、100%到達後も探索を続けられる', () => {
    // 探索率100%（進捗=range.max）で探索が止まらないこと（ExplorationSystem.md 2節）を振る舞いで
    // 検証する。上限を超えた分はrangeの既定のクランプで吸収され、進捗はmaxに張り付く。
    const progressId = codex.propertyNames.getId('exploration_progress');
    const session = new WorldSession(codex, undefined, seededRng(1));

    for (const name of LAND_NAMES) {
      const land = session.spawn(codex.objectNames.getId(name));
      const max = land.def.tryGetPropertyDef(progressId)?.range?.max ?? 0;

      land.getProperty(progressId).setNumberWithoutEvents(max - 1);
      expect(land.tryGetAction('explore', undefined)?.tryExecute() === true, `${name}: 探索できる`).toBe(
        true,
      );
      expect(
        land.tryGetProperty(progressId)?.number ?? 0,
        `${name}: 探索1回で進捗が+1される（どの抽選候補でも）`,
      ).toBe(max);

      expect(
        land.tryGetAction('explore', undefined)?.tryExecute() === true,
        `${name}: 探索率100%でも探索は続けられる`,
      ).toBe(true);
      expect(land.tryGetProperty(progressId)?.number ?? 0, `${name}: 100%を超えた進捗は上限に張り付く`).toBe(
        max,
      );
    }
  });

  it('探索で見つかったものはitems/fixturesスロットへ正しく振り分けられる', () => {
    // 発見物のspawn（into: self）が、item/fixtureタグのacceptsによってitems/fixturesスロットへ
    // 正しく振り分けられることを、探索を回し切って確認する。
    const session = new WorldSession(codex, undefined, seededRng(7));
    const land = session.spawn(codex.objectNames.getId('grassland'));
    const view = new Location(land, codex);

    // 100%到達後も探索は続けられるため、回数を数えて探索率100%で止める。
    for (let i = 0; i < view.explorationProgressMax; i++) view.explore(undefined);

    expect(view.explorationProgress).toBe(view.explorationProgressMax);
    const itemTag = codex.tagNames.getId('item');
    const fixtureTag = codex.tagNames.getId('fixture');
    expect(
      view.items.every((o) => o.def.tags.includes(itemTag)),
      'itemsスロットにはitemタグの発見物だけが入る',
    ).toBe(true);
    expect(
      view.fixtures.every((o) => o.def.tags.includes(fixtureTag)),
      'fixturesスロットにはfixtureタグの発見物だけが入る',
    ).toBe(true);
  });

  it('金の聖杯は、同じ土地からは二度と見つからない', () => {
    // 見つかった候補が自分の重みを0にする（chalice_find、artifacts.yaml）。有限のアーティファクトが
    // 1つの土地から何個も出ないことを、重みを大きくして必ず当たる状態で確かめる。
    const session = new WorldSession(codex, undefined, seededRng(11));
    const land = session.spawn(codex.objectNames.getId('cliff_coast'));
    land.getProperty(codex.propertyNames.getId('chalice_find')).setNumberWithoutEvents(10000);
    const view = new Location(land, codex);

    for (let i = 0; i < 30; i++) view.explore(undefined);

    const chalice = codex.objectNames.getId('golden_chalice');
    expect(
      view.items.filter((object) => object.def.globalId === chalice),
      '見つかるのは1つだけ',
    ).toHaveLength(1);
  });

  it('探索→道の発見→移動が一連の流れとして機能する', () => {
    // 探索 → 進捗が必要値に達した道の発見（隠しスロット→公開スロット） → 移動、の一連の流れを
    // 実ファイルの定義だけで検証する（地形生成は使わず、道の配線はこのテストが手で行う）。
    const session = new WorldSession(codex, undefined, seededRng(42));
    const worldInstance = new WorldObject(0, def('world'), session);
    const worldView = new World(worldInstance, codex);
    session.adoptWorld(worldView);

    const grassland = session.spawn(codex.objectNames.getId('grassland'));
    const forest = session.spawn(codex.objectNames.getId('forest'));
    const character = session.spawn(codex.objectNames.getId(SAMPLE_CHARACTER));
    const pathToForest = session.spawn(codex.objectNames.getId('path'));

    const locationsSlotId = codex.slotNames.getId('locations');
    expect(grassland.moveToSlot(worldInstance.getSlot(locationsSlotId))).toBeUndefined();
    expect(forest.moveToSlot(worldInstance.getSlot(locationsSlotId))).toBeUndefined();
    expect(character.moveToSlot(grassland.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
    expect(
      pathToForest.moveToSlot(grassland.getSlot(codex.slotNames.getId('undiscovered_fixtures'))),
    ).toBeUndefined();

    pathToForest.getProperty(codex.propertyNames.getId('required_progress')).setNumberWithoutEvents(3);
    pathToForest.getProperty(codex.propertyNames.getId('travel_minutes')).setNumberWithoutEvents(90);
    pathToForest
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(forest.instanceId);

    const grasslandView = new Location(grassland, codex);
    const pathView = new Path(pathToForest, codex);

    // 進捗2までは道は見つからず、未発見の道は移動アクションも成立しない（in_slot: fixtures条件）。
    expect(grasslandView.explore(character)).toBe(true);
    expect(grasslandView.explore(character)).toBe(true);
    expect(pathsIn(grasslandView, codex), '進捗2ではまだ道は見つからない').toHaveLength(0);
    expect(pathView.travel(character), '未発見の道は移動できない').toBe(false);
    expect(character.parent).toBe(grassland);

    // 進捗3で道が発見される。
    expect(grasslandView.explore(character)).toBe(true);
    expect(pathsIn(grasslandView, codex), '進捗3（required_progress）で道が公開される').toContain(
      pathToForest,
    );

    // 発見済みの道で移動すると、プレイヤーは移動先のcharactersスロットへ移り、移動時間分だけ時間が進む。
    const minutesBefore = worldView.hour * 60 + worldView.minute;
    expect(minutesBefore, '草原の探索3回でduration 15分×3が経過している').toBe(15 * 3);
    expect(pathView.travel(character)).toBe(true);

    expect(character.parent, '移動で移動先の土地へ移る').toBe(forest);
    expect(new Location(forest, codex).characters, '移動先ではcharactersスロットに入る').toContain(character);
    expect(worldView.hour * 60 + worldView.minute, '移動時間（travel_minutes=90分）が経過する').toBe(
      minutesBefore + 90,
    );
  });
});

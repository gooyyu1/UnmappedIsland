import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { Path } from '../../src/domain/runtime/views/Path';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

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
    // 土地の発見物（foods.yamlの食料等）・キャラクタ（characters.yaml）への参照があるため、
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
      for (const slotName of ['items', 'fixtures', 'characters', 'undiscovered_paths', 'paths'])
        expect(land.getSlotDef(codex.slotNames.getId(slotName)), `${name} は ${slotName} スロットを持つ`).toBeDefined();

      const characters = land.getSlotDef(codex.slotNames.getId('characters'));
      expect(characters?.fixedPositions, `${name} のキャラクタスロットは固定型`).toBe(true);
      expect(characters?.unitCapacity, `${name} のキャラクタスロットのスタック数は1`).toBe(1);

      const items = land.getSlotDef(codex.slotNames.getId('items'));
      const fixtures = land.getSlotDef(codex.slotNames.getId('fixtures'));
      expect(items?.capacity, `${name} のアイテムスロットにサイズ制限は無い`).toBeUndefined();
      expect(fixtures?.capacity, `${name} の設置物スロットにサイズ制限は無い`).toBeUndefined();
    }
  });

  it('すべての土地の探索可能回数は10〜20の範囲に収まる', () => {
    const progressId = codex.propertyNames.getId('exploration_progress');
    for (const name of LAND_NAMES) {
      const progress = def(name).getPropertyDef(progressId);
      expect(progress, `${name} は探索進捗プロパティを持つ`).toBeDefined();
      expect(progress?.range, `${name} の探索進捗はrangeを持つ`).toBeDefined();
      const max = progress?.range?.max ?? 0;
      expect(max, `${name} の探索可能回数は10〜20`).toBeGreaterThanOrEqual(10);
      expect(max, `${name} の探索可能回数は10〜20`).toBeLessThanOrEqual(20);
    }
  });

  it('すべての土地は探索のたびに進捗が+1され、上限でちょうど止まる', () => {
    // exploreのconditionsのリテラル値がrange.maxと一致していること（value: max記法が未対応のための
    // 二重管理）を、値の照合ではなく振る舞いで検証する: max-1では実行でき（実行後ちょうどmaxになる）、
    // maxでは実行できない。リテラルがmaxよりずれていれば、このどちらかが必ず破れる。
    const progressId = codex.propertyNames.getId('exploration_progress');
    const session = new WorldSession(codex, undefined, new SeededRng(1));

    for (const name of LAND_NAMES) {
      const land = session.spawn(codex.objectNames.getId(name));
      const max = land.def.getPropertyDef(progressId)?.range?.max ?? 0;

      land.setProperty(progressId, max - 1);
      expect(land.tryExecuteAction('explore', undefined, session), `${name}: 進捗max-1ではまだ探索できる`).toBe(
        true,
      );
      expect(land.getNumber(progressId), `${name}: 探索1回で進捗が+1される（どの抽選候補でも）`).toBe(max);

      expect(land.tryExecuteAction('explore', undefined, session), `${name}: 進捗maxに達したらもう探索できない`).toBe(
        false,
      );
    }
  });

  it('探索で見つかったものはitems/fixturesスロットへ正しく振り分けられる', () => {
    // 発見物のspawn（into: self）が、item/fixtureタグのacceptsによってitems/fixturesスロットへ
    // 正しく振り分けられることを、探索を回し切って確認する。
    const session = new WorldSession(codex, undefined, new SeededRng(7));
    const land = session.spawn(codex.objectNames.getId('grassland'));
    const view = new Location(land, codex);

    while (view.explore(undefined, session)) {
      /* 探索できなくなるまで繰り返す */
    }

    expect(view.explorationProgress).toBe(view.explorationProgressMax);
    const itemTag = codex.tagNames.getId('item');
    const fixtureTag = codex.tagNames.getId('fixture');
    expect(view.items.every((o) => o.def.tags.includes(itemTag)), 'itemsスロットにはitemタグの発見物だけが入る').toBe(
      true,
    );
    expect(
      view.fixtures.every((o) => o.def.tags.includes(fixtureTag)),
      'fixturesスロットにはfixtureタグの発見物だけが入る',
    ).toBe(true);
  });

  it('探索→道の発見→移動が一連の流れとして機能する', () => {
    // 探索 → 進捗が必要値に達した道の発見（隠しスロット→公開スロット） → 移動、の一連の流れを
    // 実ファイルの定義だけで検証する（地形生成は使わず、道の配線はこのテストが手で行う）。
    const worldInstance = new WorldObject(0, def('world'), new WorldSession(codex));
    const worldView = new World(worldInstance, codex.propertyNames);
    const session = new WorldSession(codex, worldView, new SeededRng(42));

    const grassland = session.spawn(codex.objectNames.getId('grassland'));
    const forest = session.spawn(codex.objectNames.getId('forest'));
    const character = session.spawn(codex.objectNames.getId('character'));
    const pathToForest = session.spawn(codex.objectNames.getId('path'));

    const locationsSlotId = codex.slotNames.getId('locations');
    expect(grassland.moveToSlot(worldInstance, locationsSlotId, codex.wellKnown)).toBeUndefined();
    expect(forest.moveToSlot(worldInstance, locationsSlotId, codex.wellKnown)).toBeUndefined();
    expect(character.moveToSlot(grassland, codex.slotNames.getId('characters'), codex.wellKnown)).toBeUndefined();
    expect(
      pathToForest.moveToSlot(grassland, codex.slotNames.getId('undiscovered_paths'), codex.wellKnown),
    ).toBeUndefined();

    pathToForest.setProperty(codex.propertyNames.getId('required_progress'), 3);
    pathToForest.setProperty(codex.propertyNames.getId('travel_minutes'), 90);
    pathToForest.setProperty(codex.propertyNames.getId('destination_id'), forest.instanceId);

    const grasslandView = new Location(grassland, codex);
    const pathView = new Path(pathToForest, codex.propertyNames);

    // 進捗2までは道は見つからず、未発見の道は移動アクションも成立しない（in_slot: paths条件）。
    expect(grasslandView.explore(character, session)).toBe(true);
    expect(grasslandView.explore(character, session)).toBe(true);
    expect(grasslandView.paths, '進捗2ではまだ道は見つからない').toHaveLength(0);
    expect(pathView.travel(character, session), '未発見の道は移動できない').toBe(false);
    expect(character.parent).toBe(grassland);

    // 進捗3で道が発見される。
    expect(grasslandView.explore(character, session)).toBe(true);
    expect(grasslandView.paths, '進捗3（required_progress）で道が公開される').toContain(pathToForest);

    // 発見済みの道で移動すると、プレイヤーは移動先のcharactersスロットへ移り、移動時間分だけ時間が進む。
    const minutesBefore = worldView.hour * 60 + worldView.minute;
    expect(minutesBefore, '草原の探索3回でduration 30分×3が経過している').toBe(30 * 3);
    expect(pathView.travel(character, session)).toBe(true);

    expect(character.parent, '移動で移動先の土地へ移る').toBe(forest);
    expect(new Location(forest, codex).characters, '移動先ではcharactersスロットに入る').toContain(character);
    expect(worldView.hour * 60 + worldView.minute, '移動時間（travel_minutes=90分）が経過する').toBe(
      minutesBefore + 90,
    );
  });
});

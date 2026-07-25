import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { Path } from '../../src/domain/runtime/views/Path';
import { fromGameSession } from '../../src/game/PlayScreenView';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * プレイ中の画面の表示内容が、ワールドの実際の状態（現在地・そのスロットの中身・手持ち）から
 * 作られていることの自動テスト。
 */
describe('PlayScreenView(ゲーム状態から画面の表示内容を作る)', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');
  });

  it('開始直後は漂着地だけが出て、移動先・フィールドアイテムは空になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name, '現在地は命名処理が付けた漂着地の名前').toBe(
      game.map.nameOfInstance(game.startLocation.instance.instanceId),
    );
    expect(view.destinations, '未探索なので発見済みの道は無い').toEqual([]);
    expect(view.fieldItems, '未探索なので土地には何も落ちていない').toEqual([]);
    expect(view.elapsedDays).toBe(0);
    expect(view.hour).toBe(0);
    expect(view.minute).toBe(0);
  });

  it('手持ちは固定6枠ぶん並び、空きセルはundefinedになる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));
    expect(
      stone.moveToSlot(game.player.instance, codex.slotNames.getId('hand'), codex.wellKnown),
    ).toBeUndefined();

    const view = fromGameSession(game, codex, locale);

    expect(view.hand).toHaveLength(6);
    expect(view.hand[0], 'カード名は対応表から引いた表示文字列').toEqual({ icon: '📦', name: '石' });
    expect(view.hand.slice(1), '残りの枠は空きセルとして残る').toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('探索で見つかった発見物と道が、そのままレーンの内容になる', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    const location = game.startLocation;
    while (location.explore(game.player.instance, game.session)) {
      /* 探索できなくなるまで繰り返す */
    }

    const view = fromGameSession(game, codex, locale);

    expect(view.fieldItems.map((card) => card.name)).toEqual([
      ...location.items.map((item) => locale.object(item.def.name).displayName),
      ...location.fixtures.map((fixture) => locale.object(fixture.def.name).displayName),
    ]);
    expect(view.fieldItems.length, '探索し切れば何かしら見つかっている').toBeGreaterThan(0);

    expect(view.destinations.map((card) => card.name)).toEqual(
      location.paths.map((path) =>
        game.map.nameOfInstance(new Path(path, codex.propertyNames).destinationInstanceId),
      ),
    );
    expect(view.destinations.length, '探索し切れば全ての道が見つかっている').toBeGreaterThan(0);
  });

  it('現在地は移動に追従する', () => {
    const game = startNewGame(codex, 11, new SeededRng(1234));
    while (game.startLocation.explore(game.player.instance, game.session)) {
      /* 道が見つかるまで探索する */
    }
    const path = new Path(game.startLocation.paths[0], codex.propertyNames);
    expect(path.travel(game.player.instance, game.session)).toBe(true);

    const view = fromGameSession(game, codex, locale);

    expect(view.currentLocation.name).toBe(game.map.nameOfInstance(path.destinationInstanceId));
  });
});

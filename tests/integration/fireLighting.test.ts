import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { Slot } from '../../src/domain/Slot';
import type { WorldObject } from '../../src/domain/WorldObject';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { Localization } from '../../src/locale/Localization';
import { parseLocale } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { cardPlacesOf } from '../../src/game/view/cardPlaces';
import { recordChange } from '../../src/game/view/recording';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { fixedRng } from '../support/rng';

/**
 * 火起こしを、世界・映しの全段を繋いだまま通す試験。
 *
 * 各段が単体で正しくても、繋ぎ目で壊れることはある——ワールドは操作の実行時に一気に進み切り、画面は
 * その控えを実時間で追いかけるので、控える場所が1つでも漏れると「まだ起きていない結果」が経過中の
 * 画面に出る。ここはその噛み合わせだけを見るので、**実データ（fire.yaml）に依存する**。
 */
describe('火起こし（世界→映し 通し）', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale('ja.yaml', 'object_texts:\n  dry_grass:\n    display_name: 枯れ草\n');
  });

  it('経過中の控えは、行動の結果がまだ起きていない並びを映す', () => {
    // 行動の結果が、経過を見せている途中の画面に先に現れてはいけない。cardsInは呼んだ時点の
    // 生きたワールドを読むので、控えるときに焼き付けていないと未来が映る（withFrozenCards）。
    // 火起こしは成否を抽選する（fire.yaml）。見たいのは成功したときの控えなので、
    // シード任せにせず成功の枝を名指しで引く（fixedRng）。
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, fixedRng(0));
    const player = game.player.instance;
    const land = game.player.location!.instance;
    const put = (name: string, slot: Slot): WorldObject => {
      const object = game.session.createObject(codex.objectNames.getId(name));
      expect(object.moveToSlot(slot)).toBeUndefined();
      return object;
    };

    // 火起こしは30分かかり、成功すると火口が消えて火種が生まれる（fire.yaml）。手持ちと地面の
    // どちらに置いても、経過中の控えには火口が残っていなければならない。
    const handSlot = player.getSlot(codex.vocabulary.world.handSlotId);
    const itemsSlot = land.getSlot(codex.vocabulary.world.itemsSlotId);
    const drill = put('fire_drill', handSlot);
    const grass = put('dry_grass', itemsSlot);

    const recording = recordChange(game, codex, locale, undefined, () => {
      const light = grass.combinationsWith(drill, player).find((c) => c.name === 'light');
      expect(light?.tryExecute(), '火起こしが成立する').toBe(true);
    });

    expect(recording.ticks.length, '30分ぶんのtick境界がある').toBeGreaterThan(0);
    const places = cardPlacesOf(game.player, game.player.location!);
    for (const tick of recording.ticks) {
      const shown = tick.view.cardsIn(places('items')).map((card) => card?.objectGlobalId);
      expect(shown, `tick@${tick.minutes}は火口のまま`).toContain(codex.objectNames.getId('dry_grass'));
      expect(shown, `tick@${tick.minutes}に火種はまだ無い`).not.toContain(
        codex.objectNames.getId('burning_tinder'),
      );
    }
    expect(
      recording.changes.map((change) => change.object.def.name),
      '火口が消えて火種が生まれるのは、経過し切った時点',
    ).toEqual(['dry_grass', 'burning_tinder']);
  });
});

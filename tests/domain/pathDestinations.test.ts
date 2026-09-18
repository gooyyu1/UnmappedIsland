import { describe, expect, it } from 'vitest';
import type { Slot } from '../../src/domain/Slot';
import type { WorldObject } from '../../src/domain/WorldObject';
import { Location } from '../../src/domain/wrappers/Location';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * 土地が答える「道の行き先」（`Location.discoveredPathDestinations`・
 * `undiscoveredPathDestinations`）の自動テスト。
 *
 * 見るのは**どれを挙げてどれを挙げないか**だけ——道かどうか（pathタグ）・行き先が世界に居るか・
 * 見つかっているか。道の生成のされ方は地形生成の試験（tests/generation）が持つ。
 */

const WORLD = `
object_defs:
  # 未発見の道を持てる土地（skeletonのlandはfixturesしか持たない）。
  mapped_land:
    tags: [location]
    slots:
      fixtures: {cell: {accept: {tag: fixture}}}
      undiscovered_fixtures: {cell: {accept: {tag: fixture}}}

  road:
    tags: [fixture, path]
    props:
      destination_id: {value: 0}

  # 道ではない設置物。同じ枠に並ぶので、タグで見分けているかがここで出る。
  rock:
    tags: [fixture]
`;

/** 土地1つ（世界のlocationsへ入れる）。 */
function land(mini: MiniGame): WorldObject {
  return mini.createObject('mapped_land', mini.slot('locations', mini.game.world.instance));
}

/** その枠へ道を1本置き、destinationInstanceIdを行き先として名乗らせる。 */
function road(mini: MiniGame, into: Slot, destinationInstanceId: number): WorldObject {
  const path = mini.createObject('road', into);
  path.tryGetProperty(mini.codex.propertyNames.getId('destination_id'))?.setNumber(destinationInstanceId);
  return path;
}

describe('道の行き先', () => {
  it('発見済みと未発見を、道の居る枠で分けて答える', () => {
    const mini = miniGame(WORLD);
    const here = land(mini);
    const [near, far] = [land(mini), land(mini)];
    road(mini, here.getSlot(mini.codex.slotNames.getId('fixtures')), near.instanceId);
    road(mini, here.getSlot(mini.codex.slotNames.getId('undiscovered_fixtures')), far.instanceId);

    const location = new Location(here);
    expect(location.discoveredPathDestinations).toEqual([near]);
    expect(location.undiscoveredPathDestinations).toEqual([far]);
  });

  it('道でない設置物は挙げない', () => {
    const mini = miniGame(WORLD);
    const here = land(mini);
    const fixtures = here.getSlot(mini.codex.slotNames.getId('fixtures'));
    mini.createObject('rock', fixtures);
    const destination = land(mini);
    road(mini, fixtures, destination.instanceId);

    expect(new Location(here).discoveredPathDestinations).toEqual([destination]);
  });

  it('指す先が世界に居ない道は挙げない', () => {
    const mini = miniGame(WORLD);
    const here = land(mini);
    // 世界に居ない個体を指す道。絵も名前も引けないので、挙げても呼び出し側にできることが無い。
    road(mini, here.getSlot(mini.codex.slotNames.getId('fixtures')), 9999);

    expect(new Location(here).discoveredPathDestinations).toEqual([]);
  });
});

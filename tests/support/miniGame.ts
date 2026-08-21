import type { Rng } from '../../src/domain/Rng';
import type { Slot } from '../../src/domain/Slot';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { PlayerCharacter } from '../../src/domain/views/PlayerCharacter';
import { World } from '../../src/domain/views/World';
import { IslandMap } from '../../src/domain/generation/IslandMap';
import { NewGameSession } from '../../src/domain/generation/NewGame';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 層の責務だけを見る試験（単体試験）のための、**同梱のWorldCodexを読まない**ゲーム一式。
 *
 * 映しの層は入口がNewGameSessionなので、素直に組み立てようとすると地形生成まで通ることになり、
 * 実データ一式が前提に入る。そうすると、YAMLの宣言を変えただけで層の試験が赤くなり、赤を見て
 * どこを直すかが決まらない——それは通しの試験（tests/integration）と実データの試験
 * （tests/world-codex）の役目。ここは生成を通さず、世界・キャラクタ・土地を直に置く。
 *
 * 試験が書くYAMLは、下のSKELETONに継ぎ足される。**自分が確かめたい型だけを宣言すればよい。**
 */

/**
 * どの映しの試験にも要る最小の世界。ここに在るのは、映しが名前で引くもの（WorldVocabulary）だけ。
 *
 * - world: 時刻とtickの刻み、今の天気。時間を進める試験がこれを読む。
 * - land: 3つのレーンが映すスロット（items・fixtures）と、キャラクタの居場所。
 * - player: 手持ち・装備・怪我。プロパティを持つキャラクタが要る試験は、carrierを配った型を
 *   自分で宣言してplayerオプションで指す。
 */
const SKELETON = `
traits:
  # キャラクタが持ち歩くための枠（player_character.yamlと同じ形）。**自前のキャラクタを宣言する
  # 試験はこれを配る**——プロパティを足したいだけで、枠まで書き直すことにならないように。
  carrier:
    tags: [character]
    visible_slots: [equipment, injuries]
    slots:
      hand: {cell_count: 6, cell: {accept: {tag: item}}}
      # 上限の無いitemスロットなので、自動配置から外さないと行き先を全部吸い込む。
      equipment: {cell: {accept: {tag: item}}, placement: [manual]}
      injuries: {cell: {accept: {tag: injury}}}

object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick: {value: 15}
      minute: {value: 0, range: {min: 0, max: 60}, on_max: {add: {self: {minute: -60, hour: 1}}}}
      hour: {value: 0, range: {min: 0, max: 24}, on_max: {add: {self: {hour: -24, day: 1}}}}
      day: {value: 1}
      # 画面が識別子のまま読む（雨の演出が引くため、ScreenLayout.md 7.5.3節）。
      weather: {value: clear, stages: [{name: clear}, {name: storm}]}
    slots:
      locations: {cell: {accept: {tag: location}}}

  land:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
      fixtures: {cell: {accept: {tag: fixture}}}
      characters: {cell_count: 1, cell: {accept: {tag: character}}}

  player:
    traits: [carrier]
`;

/** miniGameが組み立てた一式。 */
export interface MiniGame {
  readonly codex: WorldCodex;
  readonly game: NewGameSession;

  /** 操作するキャラクタ。手持ち・装備・怪我を持つ。 */
  readonly player: WorldObject;
  /** プレイヤーが立っている土地。3つのレーンのうちitems・fixturesを持つ。 */
  readonly land: WorldObject;

  /** 名前でスロットを引く。hostを省くとプレイヤーのスロット。 */
  slot(name: string, host?: WorldObject): Slot;

  /** その型を1つ湧かせ、intoへ入れる（入らなければ投げる）。 */
  spawn(defName: string, into?: Slot): WorldObject;
}

/** miniGameの組み立て方を変えたいときだけ渡すもの。 */
export interface MiniGameOptions {
  /** 操作するキャラクタのobject_def名。省略するとSKELETONのplayer。 */
  readonly player?: string;
  /** pickの引きに関心があるとき（省略すると非決定）。 */
  readonly rng?: Rng;
}

/** 追加のYAML（試験が確かめたい型の宣言）を継ぎ足した世界を組み立てる。 */
export function miniGame(yaml = '', options: MiniGameOptions = {}): MiniGame {
  const loader = new WorldCodexYamlLoader();
  loader.load('skeleton.yaml', SKELETON);
  if (yaml.trim() !== '') loader.load('test.yaml', yaml);
  const codex = loader.build();

  // NewGame.startと同じ順序で組み立てる（worldインスタンスもセッションに属させるため）。
  const session = new WorldSession(codex, undefined, options.rng);
  const worldInstance = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
  const world = new World(worldInstance, codex);
  session.adoptWorld(world);

  const landInstance = session.spawn(codex.objectNames.getId('land'));
  if (landInstance.moveToSlot(worldInstance.getSlot(codex.slotNames.getId('locations'))) !== undefined)
    throw new Error('landをworldへ置けませんでした。');

  const playerInstance = session.spawn(codex.objectNames.getId(options.player ?? 'player'));
  if (playerInstance.moveToSlot(landInstance.getSlot(codex.slotNames.getId('characters'))) !== undefined)
    throw new Error('playerをlandへ置けませんでした。');

  const game = new NewGameSession(
    session,
    world,
    new PlayerCharacter(playerInstance, codex),
    new Location(landInstance, codex),
    new IslandMap('test', 0, [], []),
  );

  return {
    codex,
    game,
    player: playerInstance,
    land: landInstance,
    slot: (name, host = playerInstance) => host.getSlot(codex.slotNames.getId(name)),
    spawn: (defName, into) => {
      const object = session.spawn(codex.objectNames.getId(defName));
      if (into !== undefined && object.moveToSlot(into) !== undefined)
        throw new Error(`${defName}を置けませんでした。`);
      return object;
    },
  };
}

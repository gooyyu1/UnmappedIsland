import type { WorldCodex } from '../WorldCodex';
import { WorldObject } from '../WorldObject';
import { WorldSession } from '../WorldSession';
import type { Rng } from '../Rng';
import { World } from '../wrappers/World';
import { PlayerCharacter } from '../wrappers/PlayerCharacter';
import type { Location } from '../wrappers/Location';
import type { IslandMap } from './IslandMap';
import { generateIsland } from './TerrainGenerator';
import { spawnIslandIntoWorld, placePlayer, placePlayerAt } from './IslandSpawner';

/** NewGame.startNewGameが組み立てた、開始直後のゲーム一式。 */
export class StartedGame {
  readonly session: WorldSession;
  readonly world: World;
  readonly player: PlayerCharacter;

  private _startLocation: Location;

  /** 生成された島のレイアウト（土地の座標・名前・道のネットワーク。UI/デバッグ用）。 */
  readonly map: IslandMap;

  constructor(
    session: WorldSession,
    world: World,
    player: PlayerCharacter,
    startLocation: Location,
    map: IslandMap,
  ) {
    this.session = session;
    this.world = world;
    this.player = player;
    this._startLocation = startLocation;
    this.map = map;
  }

  /** プレイヤーが漂着した開始地点の土地。 */
  get startLocation(): Location {
    return this._startLocation;
  }

  /**
   * 開始地点を、渡したobject_def（locations.yamlの土地）の土地のうちindex順で最初のものへ移す。
   * プレイヤーもそこへ移る。その土地が島に1つも無ければfalseで、開始地点は変わらない。
   */
  startAt(locationDefGlobalId: number): boolean {
    const site = this.map.sites.find((s) => s.type!.objectDefGlobalId === locationDefGlobalId);
    if (site === undefined) return false;

    this._startLocation = placePlayerAt(this.session, this.map, this.player.instance, site);
    return true;
  }
}

/**
 * 開始時刻の範囲（その日の0:00からの経過分、両端を含む）。漂着してから動き出せる朝〜正午の間で、
 * 日没までの猶予がゲームごとに変わるようにする。実際の時刻はこの範囲からtick刻みで選ぶ
 * （World.rollTimeOfDay）。
 */
const START_TIME_EARLIEST_MINUTES = 8 * 60;
const START_TIME_LATEST_MINUTES = 12 * 60;

/**
 * 選べるプレイヤーキャラクタ（characterタグを持つobject_def）の識別子を宣言順で返す
 * （docs/world/Characters.md）。
 */
export function characterDefNames(codex: WorldCodex): readonly string[] {
  return codex.objectDefNamesWithTag(codex.vocabulary.world.characterTagId);
}

/**
 * セーブに残っている識別子から、実際に動かすキャラクタを決める。未知の識別子（識別子の改名・旧セーブ）は
 * 先頭のキャラクタで代替し、セーブが開けなくなることを避ける。
 */
export function resolveCharacterDefNameOrFirst(codex: WorldCodex, savedCharacterId: string): string {
  const names = characterDefNames(codex);
  return names.includes(savedCharacterId) ? savedCharacterId : names[0];
}

/**
 * 新しいゲームを開始する。**開始一式（world/プレイヤーの生成 → 地形生成 → 島の実体化 → プレイヤー
 * 配置）を1回の呼び出しに閉じ込める入口**で、呼び出し側は生成と配置の手順・順序を知らなくてよい。
 *
 * characterDefNameは操作するキャラクタのobject_defの識別子
 * （characterDefNames参照）。rngはpick抽選・初期値ロール・開始時刻用のWorldSession.rng（省略時は非決定。
 * 地形レイアウト自体はseedのみで決まり、rngには依存しない）。
 */
export function startNewGame(
  codex: WorldCodex,
  characterDefName: string,
  seed: number,
  rng?: Rng,
): StartedGame {
  // worldはinstanceId 0で直接生成する（WorldSession.createObjectの発行IDは1始まりのため衝突しない）。
  // セッションを先に作ってworldを後から結び付けるのは、WorldObjectの生成にsession（初期値ロール文脈）が
  // 必要で、World付きセッション自体がworldインスタンスを必要とするという相互依存を断つため
  // （WorldSession.adoptWorld）。**この順序にすると、worldインスタンスも他の物と同じセッションに属する。**
  const session = new WorldSession(codex, undefined, rng);
  const worldInstance = new WorldObject(
    0,
    codex.objects.get(codex.objectNames.getId(codex.vocabulary.world.worldObject)),
    session,
  );
  const world = new World(worldInstance, codex);
  session.adoptWorld(world);
  world.rollTimeOfDay(START_TIME_EARLIEST_MINUTES, START_TIME_LATEST_MINUTES, session.rng);

  spawnSingletonsAcceptedByWorld(session, worldInstance);

  const character = session.createObject(codex.objectNames.getId(characterDefName));

  const map = generateIsland(codex.generation, 'island', seed);
  spawnIslandIntoWorld(session, map);
  const startLocation = placePlayer(session, map, character);

  return new StartedGame(session, world, new PlayerCharacter(character, codex), startLocation, map);
}

/**
 * 世界にただ1つ在る型（`singleton: true`、15節）のうち、**worldが直に受け入れられるものを、世界を
 * 作った時点で1つずつ湧かせる**。島の外に最初から在る場所（海区・本土、docs/world/Voyage.md）が
 * これにあたり、型の名前で行き先を指す`move`の`to_object`（9.6節）が必ず解決できることを保証する。
 *
 * 何を最初から在らせるかを決めるのはworldのスロットの宣言（`locations`が受け入れる型）で、コードは
 * 型の名前を1つも知らない。キャラクタもsingletonだが、worldのどのスロットにも入らない（土地の
 * charactersスロットに入る物なので）ため、ここでは湧かない。
 */
function spawnSingletonsAcceptedByWorld(session: WorldSession, worldInstance: WorldObject): void {
  for (const globalId of session.codex.singletonGlobalIds()) {
    if (globalId === worldInstance.def.globalId) continue;

    const instance = session.createObject(globalId);
    if (!instance.moveIntoFirstAcceptingSlot(worldInstance)) instance.destroy();
  }
}

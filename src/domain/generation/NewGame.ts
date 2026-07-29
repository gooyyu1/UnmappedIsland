import type { WorldCodex } from '../defs/WorldCodex';
import { WorldObject } from '../runtime/WorldObject';
import { WorldSession } from '../runtime/WorldSession';
import type { Rng } from '../runtime/Rng';
import { World } from '../runtime/views/World';
import { PlayerCharacter } from '../runtime/views/PlayerCharacter';
import type { Location } from '../runtime/views/Location';
import type { IslandMap } from './IslandMap';
import { generate } from './TerrainGenerator';
import { populate, placePlayer, placePlayerAt } from './IslandSpawner';

/** NewGame.startが組み立てた、開始直後のゲーム一式。 */
export class NewGameSession {
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
 * 新しいゲームの開始一式（world/プレイヤーの生成 → 地形生成 → 島の実体化 → プレイヤー配置）を
 * 1回の呼び出しに閉じ込める入口。呼び出し側（Phaser側のシーン等）は「Codexとシードを渡す」
 * だけでよく、生成と配置の手順・順序を知らなくてよい（自分のことは自分でする、CLAUDE.md参照）。
 */

/**
 * 新しいゲームを開始する。rngはpick抽選・初期値ロール用のWorldSession.rng（省略時は非決定。
 * 地形レイアウト自体はseedのみで決まり、rngには依存しない）。
 */
export function start(codex: WorldCodex, seed: number, rng?: Rng): NewGameSession {
  // worldはinstanceId 0で直接生成する（WorldSession.spawnの発行IDは1始まりのため衝突しない）。
  // 生成用の一時セッションを使うのは、WorldObjectの生成にsession（初期値ロール文脈）が必要で、
  // World付きセッション自体がworldインスタンスを必要とするという相互依存を断ち切るため。
  const bootstrap = new WorldSession(codex);
  const worldInstance = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
  const world = new World(worldInstance, codex.propertyNames);

  const session = new WorldSession(codex, world, rng);
  const character = session.spawn(codex.objectNames.getId('character'));

  const map = generate(codex.generation, 'island', seed);
  populate(session, map);
  const startLocation = placePlayer(session, map, character);

  return new NewGameSession(session, world, new PlayerCharacter(character, codex), startLocation, map);
}

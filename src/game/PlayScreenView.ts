import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { Localization } from '../locale/Localization';
import type { LaneCard } from './ui/CardLane';

/** ステータスエリアに出す1件。ratioは0〜1。 */
export interface StatusEntry {
  readonly name: string;
  readonly ratio: number;
}

/**
 * プレイ中の画面が表示する内容。画面の組み立て（PlayScene）とゲーム状態の間を仕切る。
 *
 * 天候・条件・装備・怪我のように、ドメイン側にまだ表示できる形が無い項目はモック
 * （ScreenLayout_Mock.html）と同じ固定値を返す（fromGameSession参照）。
 */
export interface PlayScreenView {
  readonly characterName: string;
  /** 条件アイコン。複数同時に付き得るので件数は可変。 */
  readonly conditions: readonly string[];
  readonly equipmentIcon: string;
  readonly injuryIcon: string;
  /** 表示対象のステータスだけを並べた可変長リスト（ScreenLayout.md ステータスエリア節）。 */
  readonly statuses: readonly StatusEntry[];
  readonly elapsedDays: number;
  readonly hour: number;
  readonly minute: number;
  readonly weather: string;
  readonly currentLocation: LaneCard;
  readonly destinations: readonly LaneCard[];
  readonly fieldItems: readonly LaneCard[];
  /** 手持ちは固定枠スロットなので、空きセルはundefined（プレースホルダー）として並ぶ。 */
  readonly hand: readonly (LaneCard | undefined)[];
}

/** アイテムの画像がまだ無いため、種別ごとの絵文字を仮のアイコンとして使う。 */
const LOCATION_ICON = '🗺️';
const ITEM_ICON = '📦';
const FIXTURE_ICON = '🌳';

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/**
 * 生成済みのゲーム一式から画面の表示内容を作る。ロケーションレーン・フィールドアイテムレーン・
 * ハンドレーンは現在地とキャラクターのスロットの中身をそのまま映す。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;
  const cardOf = (instance: WorldObject, icon: string): LaneCard => ({
    icon,
    name: locale.object(instance.def.name).displayName,
  });

  return {
    characterName: locale.object(game.player.instance.def.name).displayName,
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '🪑',
    injuryIcon: '🩹',
    statuses: [
      { name: 'HP', ratio: 0.8 },
      { name: 'スタミナ', ratio: 0.65 },
      { name: '食料', ratio: 0.3 },
      { name: '精神', ratio: 0.55 },
    ],
    // dayは1始まり（GameElementDefinition.md 17節）なので、生存日数は0始まりへ直す。
    elapsedDays: game.world.day - 1,
    hour: game.world.hour,
    minute: game.world.minute,
    weather: '☀️ 灼熱の快晴',
    currentLocation: {
      icon: LOCATION_ICON,
      name: game.map.nameOfInstance(location.instance.instanceId) ?? UNNAMED_LOCATION,
    },
    destinations: location.paths.map((path) => ({
      icon: LOCATION_ICON,
      name:
        game.map.nameOfInstance(new Path(path, codex.propertyNames).destinationInstanceId) ??
        UNNAMED_LOCATION,
    })),
    fieldItems: [
      ...location.items.map((item) => cardOf(item, ITEM_ICON)),
      ...location.fixtures.map((fixture) => cardOf(fixture, FIXTURE_ICON)),
    ],
    hand: game.player.hand.map((item) => (item === undefined ? undefined : cardOf(item, ITEM_ICON))),
  };
}

import type { SaveData } from '../save/SaveData';
import type { LaneCard } from './ui/CardLane';

/** ステータスエリアに出す1件。ratioは0〜1。 */
export interface StatusEntry {
  readonly name: string;
  readonly ratio: number;
}

/**
 * プレイ中の画面が表示する内容。画面の組み立て（PlayScene）とゲーム状態の間を仕切る。
 *
 * ドメイン側には天候・条件・装備・怪我・手札・アイテムの表示名がまだ無いため、現状の実装は
 * モック（ScreenLayout_Mock.html）と同じ内容を返すプレースホルダー。ドメインが揃った時点で
 * この型を満たす実装へ差し替えれば、PlayScene側は変更しなくてよい。
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
  readonly hand: readonly LaneCard[];
}

const LOCATION_ICON = '🗺️';
const FIELD_ITEM_ICON = '🪓';
const HAND_ICON = '🍲';

/** モックと同じ内容。生存日数だけはセーブデータの実値を使う。 */
export function placeholderPlayScreenView(save: SaveData): PlayScreenView {
  return {
    characterName: '主人公',
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '🪑',
    injuryIcon: '🩹',
    statuses: [
      { name: 'HP', ratio: 0.8 },
      { name: 'スタミナ', ratio: 0.65 },
      { name: '食料', ratio: 0.3 },
      { name: '精神', ratio: 0.55 },
    ],
    elapsedDays: save.elapsedDays,
    hour: 10,
    minute: 15,
    weather: '☀️ 灼熱の快晴',
    currentLocation: { icon: LOCATION_ICON, name: '流木だらけの海岸線' },
    destinations: ['白砂の浜', '崩れかけた岩場の洞窟入口', '浅瀬', 'ヤシ林', '潮だまり', '濃霧の湿地帯'].map(
      (name) => ({ icon: LOCATION_ICON, name }),
    ),
    fieldItems: [
      '石斧',
      '未調理のヤギ肉のシチュー',
      '火打ち石',
      '雨水を集めた竹筒',
      'ロープ',
      '割れたコンパス',
      '枯れ枝の束',
    ].map((name) => ({ icon: FIELD_ITEM_ICON, name })),
    hand: ['焼き魚', '椰子の実スープ', '干し肉', '果実串', '貝の蒸し焼き', '塩ゆで芋'].map((name) => ({
      icon: HAND_ICON,
      name,
    })),
  };
}

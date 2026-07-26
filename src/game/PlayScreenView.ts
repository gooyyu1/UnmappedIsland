import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { Localization } from '../locale/Localization';
import type { CardContent } from './ui/Card';

/** ステータスエリアに出す1件。ratioは0〜1。 */
export interface StatusEntry {
  readonly name: string;
  readonly ratio: number;
}

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * アイテムのカード1枚。move・reorder・combinationOfが返す操作はワールドを変えるだけで、画面への
 * 反映（表示内容の作り直し）は呼び出し側の責務。
 *
 * moveとreorderは「その場所へ落とせるか」を、操作を返すか否かで答える。落とせない場所（設置物の間、
 * 前詰めレーンの空き枠など）ではundefinedになるので、呼び出し側は落とし先の枠を出す前に問い合わせられる。
 */
export interface ItemCard extends CardContent {
  /**
   * このカードが映しているワールド上のオブジェクト。PlayScreenViewの操作（combinationOf）へ
   * 渡すためだけのもので、画面の組み立て側は中身を見ない。
   */
  readonly object: WorldObject;

  /**
   * フィールドと手持ちの間で移す操作。atは移した先での置き場所で、省略すると空いている場所へ入る。
   * 移せない設置物にはない。手持ちが埋まっている等で移せなかった場合は何も起きない。
   */
  readonly move?: (at?: CardPlacement) => (() => void) | undefined;

  /**
   * 同じレーンの中で位置を変える操作。1枚が複数のインスタンスを表している場合はスタックごと動かす
   * （1個ずつでは元のスタックへ合流して戻ってしまうため、SlotSystem.md 3節）。
   */
  readonly reorder?: (at: CardPlacement) => (() => void) | undefined;
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
  readonly currentLocation: CardContent;
  /** 現在地の探索率（0〜1）。100%に達しても探索は続けられる（ExplorationSystem.md 2節）。 */
  readonly explorationRatio: number;
  readonly destinations: readonly CardContent[];
  readonly fieldItems: readonly ItemCard[];
  /** 手持ちは固定枠スロットなので、空きセルはundefined（プレースホルダー）として並ぶ。 */
  readonly hand: readonly (ItemCard | undefined)[];

  /**
   * draggedをtargetへ重ねたときに実行できるcombination（GameElementDefinition.md 12節）。
   * 実行できる組み合わせが無ければundefined。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、ここでは宣言順の先頭を採る。マッチはwithタグだけで判定するので、
   * conditionsを満たさず実行が空振りすることはある。
   */
  readonly combinationOf: (dragged: ItemCard, target: ItemCard) => (() => void) | undefined;
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
 *
 * ワールドの状態を写し取るだけなので、アクションでワールドが変わったら作り直す（PlayScene参照）。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;
  // 1枚のカードが複数のインスタンス（スタック）を表すことがあるため、識別子は先頭を代表とする集合で持つ。
  const cardOf = (instances: readonly WorldObject[], icon: string): ItemCard => ({
    icon,
    name: locale.object(instances[0].def.name).displayName,
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    object: instances[0],
  });

  // フィールドアイテムレーンは土地のitemsスロットの後ろへ設置物を並べたもの。設置物は別のスロットに
  // 居て動かせないため、アイテムの並びに関わる位置指定はここまでしか受け付けられない。
  const itemStacks = location.itemStacks;
  const gapInItems = (at: CardPlacement): number | undefined =>
    at.kind === 'cell' || at.index > itemStacks.length ? undefined : at.index;

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
    // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
    explorationRatio:
      location.explorationProgressMax === 0
        ? 0
        : location.explorationProgress / location.explorationProgressMax,
    destinations: location.paths.map((path) => ({
      icon: LOCATION_ICON,
      name:
        game.map.nameOfInstance(new Path(path, codex.propertyNames).destinationInstanceId) ??
        UNNAMED_LOCATION,
      identity: [path.instanceId],
    })),
    fieldItems: [
      ...itemStacks.map((stack) => ({
        ...cardOf(stack, ITEM_ICON),
        // 手持ちは固定枠なので、隙間も空き枠もそのまま行き先になる（落とせない場所が無い）。
        move: (at?: CardPlacement) =>
          at?.kind === 'cell'
            ? () => {
                game.player.takeIntoCell(stack[0], game.session, at.index);
              }
            : () => {
                game.player.take(stack[0], game.session, at?.index);
              },
        reorder: (at: CardPlacement) => {
          const gapIndex = gapInItems(at);
          return gapIndex === undefined
            ? undefined
            : () => {
                location.reorderItems(stack[0], gapIndex);
              };
        },
      })),
      ...location.fixtureStacks.map((stack) => cardOf(stack, FIXTURE_ICON)),
    ],
    hand: game.player.handStacks.map((stack) =>
      stack.length === 0
        ? undefined
        : {
            ...cardOf(stack, ITEM_ICON),
            move: (at?: CardPlacement) => {
              const gapIndex = at === undefined ? undefined : gapInItems(at);
              if (at !== undefined && gapIndex === undefined) return undefined;
              return () => {
                game.player.drop(stack[0], game.session, gapIndex);
              };
            },
            reorder: (at: CardPlacement) => () => {
              if (at.kind === 'cell') game.player.moveHandToCell(stack[0], at.index);
              else game.player.reorderHand(stack[0], at.index);
            },
          },
    ),
    combinationOf: (dragged, target) => {
      const [combination] = target.object.findMatchingCombinations(dragged.object);
      if (combination === undefined) return undefined;
      return () => {
        target.object.tryExecuteCombination(
          dragged.object,
          game.player.instance,
          combination.name,
          game.session,
        );
      };
    },
  };
}

import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { Path } from '../domain/runtime/views/Path';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { Localization } from '../locale/Localization';
import type { CardContent } from './ui/Card';
import type { PropertyTab } from './ui/PropertyWindow';
import type { StatusContent } from './ui/StatusBar';

/**
 * レーンの中でカードを置く場所。gapは枠と枠の隙間（indexは0が先頭の枠の前）、cellは空き枠そのもの
 * （indexはその枠の位置）。CardLaneのドロップ先（LaneDropTarget）と同じ形。
 */
export type CardPlacement =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };

/**
 * カードが並ぶ場所（＝ワールド上の1つのスロット）の名前。名前はスロット名そのもので、レーンと
 * 子ウィンドウの対応付けに使う。
 *
 * 今後コンテナ（箱・かご）の中身も同じ子ウィンドウで見せるため、ここに置き場所を足していけるよう
 * 移動の宛先は名前で指す（moveTo）。「どのレーンの隣か」という暗黙の対応は持たない。
 */
export type CardPlace =
  'fixtures' | 'items' | 'hand' | 'equipment' | 'injuries' | { readonly container: WorldObject };

/**
 * 2つの場所が同じか。コンテナの場所は映しているインスタンスで見分ける（同じ型のコンテナが複数あっても
 * 中身は別なので、型では一意に決まらない）。
 */
export function samePlace(a: CardPlace, b: CardPlace): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.container === b.container;
}

/**
 * 積み重なったカードの束（ドメインのObjectStackに対応する画面側の1まとまり）。
 *
 * スタックのメンバーはobjectsに全部入っていて、束ねているだけの表示上の都合で1枚に見えている
 * （CardContent.identityも全メンバーのID）。1枚しか無い束もこの形で表す。
 *
 * moveTo・reorder・combinationOfが返す操作はワールドを変えるだけで、画面への反映（表示内容の
 * 作り直し）は呼び出し側の責務。moveToとreorderは「そこへ落とせるか」を、操作を返すか否かで答える。
 * 落とせない場所（持ち歩けない設置物、前詰めの場所の空き枠、出し入れできない怪我など）ではundefinedに
 * なるので、呼び出し側は落とし先の枠を出す前に問い合わせられる。
 */
export interface ObjectCardStack extends CardContent {
  /**
   * この束が映しているワールド上のオブジェクト（先頭が代表）。表示に使う名前・絵は代表から採るが、
   * これは同じ束に入れる条件が「代表ObjectDef列の一致」（ObjectStack）だからで、個体ごとに違い得る
   * 値（プロパティ）を見るときはメンバーを1つずつ読む。
   */
  readonly objects: readonly WorldObject[];

  /** カードを押して開く子ウィンドウに出す説明文。localeに書かれていなければundefined。 */
  readonly description?: string;

  /** このカードで実行できるアクション（宣言順）。持たないオブジェクトでは空。 */
  readonly actions: readonly CardAction[];

  /** この束が今いる場所。 */
  readonly place: CardPlace;

  /**
   * 代表がコンテナ（containerタグ、containers.yaml）なら、その中身を映す場所。
   * 画面側はこれを持つカードをタップで開けるようにする。
   */
  readonly contents?: CardPlace;

  /**
   * 束のうち1つを別の場所へ移す操作。atは移した先での置き場所で、省略すると空いている場所へ入る。
   * 動かせない束（設置物・怪我）にはない。移せなかった場合（手持ちが埋まっている等）は何も起きない。
   */
  readonly moveTo?: (place: CardPlace, at?: CardPlacement) => (() => void) | undefined;

  /**
   * 同じ場所の中で位置を変える操作。こちらは束ごと動かす（1つずつでは元の束へ合流して戻ってしまうため、
   * SlotSystem.md 3節）。
   */
  readonly reorder?: (at: CardPlacement) => (() => void) | undefined;
}

/**
 * カード1枚だけで完結する操作（ActionSystem.md 1節のactions）。子ウィンドウにボタンとして並べるため、
 * 実行する手段だけでなく表示文字列も持つ（locale/ja.yamlのactions節、Localization.md）。
 */
export interface CardAction {
  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。時間を消費しない操作は0。 */
  readonly minutes: number;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;
}

/**
 * カードを重ねたときに実行できるcombination。何が起きるかをドラッグ中に見せるため、実行する手段だけで
 * なく表示文字列も持つ（locale/ja.yamlのcombinations節、Localization.md）。
 */
export interface CardCombination {
  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。時間を消費しない組み合わせは0。 */
  readonly minutes: number;
  /**
   * ドラッグされた側として使われるインスタンス。同じ束へ重ねたときは束の2つ目になるため、束の代表とは
   * 限らない。画面側は「掴んでいたカード」の行方を追う（CardMotion.MotionContext.released）のに使う。
   */
  readonly source: WorldObject;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;
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
  /**
   * ステータスエリアに出す候補（statusタグが付いたもの、ScreenLayout.md ステータスエリア節）。
   * このうち実際に出すのは、安全域を外れたものと固定表示にされたものだけ（statusRows参照）。
   */
  readonly statuses: readonly StatusContent[];

  /**
   * プロパティウィンドウのタブ一式（property_tagsの宣言順）。キャラクターが1つも持たないタグは
   * 空のタブになるだけなので落とす。
   */
  readonly propertyCategories: readonly PropertyTab[];
  readonly elapsedDays: number;
  readonly hour: number;
  readonly minute: number;
  readonly weather: string;
  readonly currentLocation: CardContent;
  /** 現在地のobject_defの識別子（表示名ではない）。土地ごとに変わるレーンの背景を選ぶ（laneArt参照）。 */
  readonly locationArt: string;
  /** 現在地の探索率（0〜1）。100%に達しても探索は続けられる（ExplorationSystem.md 2節）。 */
  readonly explorationRatio: number;
  /** 現在地の設置物（道・木・建物など、持ち歩けないもの）。 */
  readonly fixtures: readonly ObjectCardStack[];
  /** 現在地に落ちているアイテム（持ち歩けるもの）。 */
  readonly items: readonly ObjectCardStack[];
  /** 手持ちは固定枠スロットなので、空きセルはundefined（プレースホルダー）として並ぶ。 */
  readonly hand: readonly (ObjectCardStack | undefined)[];

  /**
   * 子ウィンドウに並べる、その場所の中身（装備・怪我・コンテナの中身）。前詰めスロットなので
   * 空きセルは無い。レーンで常に見えているfixtures/items/handはこちらでは扱わない。
   */
  readonly cardsIn: (place: CardPlace) => readonly ObjectCardStack[];

  /** 子ウィンドウのタイトルに出す、その場所の名前。 */
  readonly nameOf: (place: CardPlace) => string;

  /**
   * その場所がカードを受け入れるか（怪我のような読み取り専用の場所はfalse）。中身が空でも
   * 「落とせる場所かどうか」を見せるために、画面側が受け皿の空枠を出すかの判断に使う。
   */
  readonly acceptsCards: (place: CardPlace) => boolean;

  /**
   * draggedをtargetへ重ねたときに実行できるcombination（GameElementDefinition.md 12節）。
   * 実行できる組み合わせが無ければundefined。draggedとtargetが同じ束（その束の上の1枚を元の位置へ
   * 重ねた）なら、束の中の2つを組み合わせる。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、ここでは宣言順の先頭を採る。マッチはwithタグだけで判定するので、
   * conditionsを満たさず実行が空振りすることはある。
   */
  readonly combinationOf: (dragged: ObjectCardStack, target: ObjectCardStack) => CardCombination | undefined;
}

/** アイテムの画像がまだ無いため、種別ごとの絵文字を仮のアイコンとして使う。 */
const LOCATION_ICON = '🗺️';
const ITEM_ICON = '📦';
const FIXTURE_ICON = '🌳';
const INJURY_ICON = '🩹';

/** 命名処理が名前を付けていない土地（テスト用の最小Codex等）の代替表示。 */
const UNNAMED_LOCATION = '名もなき土地';

/**
 * ステータスエリアへ出す候補になるプロパティに付けるタグ（GameElementDefinition.md 6.7節）。
 * 健康・栄養といったカテゴリのタグと重ねて付ける（満腹度はstatusでありnutritionでもある）。
 */
const STATUS_TAG = 'status';

/**
 * 子ウィンドウのタイトルに出す場所の名前。子ウィンドウになるのはキャラクター自身のスロットだけで、
 * レーンで常に見えているfixtures/items/handは対象外。コンテナはその中身のオブジェクトの表示名を使う。
 */
const PLACE_NAMES: Partial<Record<CardPlace & string, string>> = {
  equipment: '装備',
  injuries: '怪我',
};

/** スロットの中身を、積み重なっているまとまりごとに分けたもの。 */
function stacksIn(
  dest: { owner: WorldObject; slotId: number } | undefined,
): readonly (readonly WorldObject[])[] {
  const slot = dest?.owner.tryGetSlot(dest.slotId);
  return slot === undefined ? [] : slot.cells.flatMap((cell) => (cell === undefined ? [] : [cell.members]));
}

/**
 * 生成済みのゲーム一式から画面の表示内容を作る。設置物レーン・アイテムレーン・ハンドレーンは
 * 現在地とキャラクターのスロットの中身をそのまま映す。
 *
 * ワールドの状態を写し取るだけなので、アクションでワールドが変わったら作り直す（PlayScene参照）。
 */
export function fromGameSession(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
): PlayScreenView {
  const location = game.player.location ?? game.startLocation;

  const characterTexts = locale.object(game.player.instance.def.name);
  /** タグが付いたキャラクターのプロパティを、表示名に直して並べる。未宣言のタグでは空。 */
  const entriesWithTag = (tagGlobalId: number | undefined): readonly StatusContent[] =>
    tagGlobalId === undefined
      ? []
      : game.player.instance.readPropertiesWithTag(tagGlobalId).map((reading) => ({
          key: reading.name,
          name: characterTexts.prop(reading.name).displayName,
          value: reading.value,
          ratio: reading.ratio,
          alert: reading.alert,
        }));

  // タグのIDは宣言順に振られる（WorldCodex.propertyTagNames）ため、昇順に見ればタブの並び順になる。
  const propertyCategories: PropertyTab[] = [];
  for (let tagGlobalId = 0; tagGlobalId < codex.propertyTagNames.count; tagGlobalId++) {
    const entries = entriesWithTag(tagGlobalId);
    if (entries.length > 0)
      propertyCategories.push({
        name: locale.propertyTag(codex.propertyTagNames.getName(tagGlobalId)).displayName,
        entries,
      });
  }

  const containerTagId = codex.tagNames.tryGetId('container');
  const contentsSlotId = codex.slotNames.tryGetId('contents');
  /** そのカードがコンテナなら、中身を映す場所。中身を持てるスロットが無いcodexではundefined。 */
  const contentsOf = (object: WorldObject): CardPlace | undefined =>
    containerTagId !== undefined && contentsSlotId !== undefined && object.def.tags.includes(containerTagId)
      ? { container: object }
      : undefined;

  /**
   * そのカードで実行できるアクション。宣言を読むのは操作対象の代表（represented_by、ActionSystem.md
   * 1節）で、実行はカードが映しているオブジェクト自身へ頼む（代表の解決はエンジン側が行う）。
   * 水筒のカードに、中身の水のdrinkがボタンとして出る。
   */
  const actionsOf = (instance: WorldObject): readonly CardAction[] => {
    const target = instance.resolveInteractionTarget();
    const texts = locale.object(target.def.name);
    return target.def.actions.map((action) => {
      const declared = texts.action(action.name);
      return {
        name: declared.displayName,
        description: declared.description,
        minutes: instance.actionMinutes(action.name, game.player.instance),
        execute: () => {
          instance.tryExecuteAction(action.name, game.player.instance, game.session);
        },
      };
    });
  };

  const stackOf = (instances: readonly WorldObject[], icon: string, place: CardPlace): ObjectCardStack => ({
    icon,
    name: locale.object(instances[0].def.name).displayName,
    identity: instances.map((instance) => instance.instanceId),
    count: instances.length,
    art: instances[0].def.name,
    objects: instances,
    description: locale.object(instances[0].def.name).description,
    actions: actionsOf(instances[0]),
    place,
    contents: contentsOf(instances[0]),
  });

  const pathTagId = codex.tagNames.tryGetId('path');
  /**
   * 道の設置物がカードに映すもの（道以外はundefinedで、設置物そのものの名前と絵をそのまま使う）。
   * 道は「どこへ繋がっているか」だけが意味を持つため、行き先の土地の名前を出す。
   */
  const destinationOf = (fixture: WorldObject): { icon: string; name: string } | undefined =>
    pathTagId !== undefined && fixture.def.tags.includes(pathTagId)
      ? {
          icon: LOCATION_ICON,
          name:
            game.map.nameOfInstance(new Path(fixture, codex.propertyNames).destinationInstanceId) ??
            UNNAMED_LOCATION,
        }
      : undefined;

  /**
   * 場所ごとの「どのオブジェクトのどのスロットか」。カードの移動はすべてこの表を引いた
   * スロット移動（WorldObject.moveToSlot*）で、場所ごとの特別扱いは持たない。コンテナ（箱・かご）
   * を足すときも、この表に1行増やすだけで移動もドラッグも動く。
   *
   * 怪我と設置物だけundefinedなのは「移動の宛先にならない」ことを表す（怪我はワールド側の効果だけが
   * 付け外しし、設置物は持ち歩けない）。どちらも同じ場所の中での並び替えはできる（reorder）。
   */
  const slotOf = (place: CardPlace): { owner: WorldObject; slotId: number } | undefined => {
    if (typeof place !== 'string') {
      return contentsSlotId === undefined ? undefined : { owner: place.container, slotId: contentsSlotId };
    }
    switch (place) {
      case 'items':
        return { owner: location.instance, slotId: location.itemsSlotId };
      case 'fixtures':
        return undefined;
      case 'hand':
        return { owner: game.player.instance, slotId: game.player.handSlotId };
      case 'equipment':
        return { owner: game.player.instance, slotId: game.player.equipmentSlotId };
      case 'injuries':
        return undefined;
    }
  };

  /** itemを場所placeへ入れる操作（そこへは入れられないならundefined）。 */
  const moveInto =
    (item: WorldObject, from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement): (() => void) | undefined => {
      const dest = slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;
      // 自分の中へは入れられない（籠を籠自身へ、また自分の子孫の中へ）。
      if (typeof place !== 'string' && item.contains(place.container)) return undefined;

      const wellKnown = game.session.codex.wellKnown;
      if (at === undefined) {
        return () => {
          item.moveToSlot(dest.owner, dest.slotId, wellKnown);
        };
      }

      if (at.kind === 'cell') {
        // 空き枠を指せるのは固定枠スロットだけ（前詰めスロットに空き枠は無い）。
        const fixed = dest.owner.tryGetSlot(dest.slotId)?.def.fixedPositions === true;
        return fixed
          ? () => {
              item.moveToSlotAtCell(dest.owner, dest.slotId, at.index, wellKnown);
            }
          : undefined;
      }

      return () => {
        item.moveToSlotAtGap(dest.owner, dest.slotId, at.index, wellKnown);
      };
    };

  /** itemを同じ場所の中で動かす操作（動かせない位置ならundefined）。今いるスロットの中だけで完結する。 */
  const reorderIn =
    (item: WorldObject) =>
    (at: CardPlacement): (() => void) | undefined => {
      if (at.kind === 'cell') {
        return () => {
          item.moveToCellInParentSlot(at.index);
        };
      }
      return () => {
        item.reorderInParentSlot(at.index);
      };
    };

  return {
    characterName: characterTexts.displayName,
    conditions: ['💭', '🥶', '😪', '🍽️'],
    equipmentIcon: '🪑',
    injuryIcon: '🩹',
    statuses: entriesWithTag(codex.propertyTagNames.tryGetId(STATUS_TAG)),
    propertyCategories,
    // dayは1始まり（GameElementDefinition.md 17節）なので、生存日数は0始まりへ直す。
    elapsedDays: game.world.day - 1,
    hour: game.world.hour,
    minute: game.world.minute,
    weather: '☀️ 灼熱の快晴',
    currentLocation: {
      icon: LOCATION_ICON,
      name: game.map.nameOfInstance(location.instance.instanceId) ?? UNNAMED_LOCATION,
    },
    locationArt: location.instance.def.name,
    // 探索できない土地（探索の語彙を持たないCodex）では上限が0になるため、0除算を避けて0%にする。
    explorationRatio:
      location.explorationProgressMax === 0
        ? 0
        : location.explorationProgress / location.explorationProgressMax,
    // 設置物は持ち歩けないのでmoveToを持たないが、並び方はプレイヤーが地形をどう捉えているかで
    // 変わるため、同じスロットの中での並び替えだけは許す。
    fixtures: location.fixtureStacks.map((stack) => ({
      ...stackOf(stack, FIXTURE_ICON, 'fixtures'),
      ...destinationOf(stack[0]),
      reorder: reorderIn(stack[0]),
    })),
    items: location.itemStacks.map((stack) => ({
      ...stackOf(stack, ITEM_ICON, 'items'),
      moveTo: moveInto(stack[0], 'items'),
      reorder: reorderIn(stack[0]),
    })),
    hand: game.player.handStacks.map((stack) =>
      stack.length === 0
        ? undefined
        : {
            ...stackOf(stack, ITEM_ICON, 'hand'),
            moveTo: moveInto(stack[0], 'hand'),
            reorder: reorderIn(stack[0]),
          },
    ),
    cardsIn: (place) => {
      // 怪我はワールド側の効果だけが付け外しするため、moveTo/reorderを持たせない。
      if (place === 'injuries')
        return game.player.injuryStacks.map((stack) => stackOf(stack, INJURY_ICON, 'injuries'));

      const stacks = place === 'equipment' ? game.player.equipmentStacks : stacksIn(slotOf(place));
      return stacks.map((stack) => ({
        ...stackOf(stack, ITEM_ICON, place),
        moveTo: moveInto(stack[0], place),
        reorder: reorderIn(stack[0]),
      }));
    },
    nameOf: (place) =>
      typeof place === 'string'
        ? (PLACE_NAMES[place] ?? place)
        : locale.object(place.container.def.name).displayName,
    acceptsCards: (place) => slotOf(place) !== undefined,
    combinationOf: (dragged, target) => {
      // ドラッグが動かすのはスタックのうち1つなので、同じカードへ重ねたときはスタックの中の2つを
      // 組み合わせる（石と石のように、自分自身とcombinationできる場合）。
      const [first, second] = target.objects;
      const source = dragged === target ? second : dragged.objects[0];
      if (source === undefined) return undefined;

      const [combination] = first.findMatchingCombinations(source);
      if (combination === undefined) return undefined;

      const texts = locale.object(first.def.name).combination(combination.name);
      return {
        name: texts.displayName,
        description: texts.description,
        minutes: first.combinationMinutes(source, game.player.instance, combination.name),
        source,
        execute: () => {
          first.tryExecuteCombination(source, game.player.instance, combination.name, game.session);
        },
      };
    },
  };
}

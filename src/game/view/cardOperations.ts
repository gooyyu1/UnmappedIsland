import type { WorldCodex } from '../../domain/WorldCodex';
import type { StartedGame } from '../../domain/generation/NewGame';
import type { WorldObject } from '../../domain/WorldObject';
import { putIntoSlot } from '../../domain/slotEntry';
import type { Localization } from '../../locale/Localization';
import { craftingActions } from './craftingView';
import type { CardPlace, CardPlacement } from './cardPlaces';

/**
 * カード1枚だけで完結する操作（ActionSystem.md 1節のactions）。子ウィンドウにボタンとして並べるため、
 * 実行する手段だけでなく表示文字列も持つ（locale/ja.yamlのactions節、Localization.md）。
 */
export interface CardAction {
  /**
   * 宣言の識別子（`actions`のキー）。画面が特定の操作を見分けるためのもので、表示には使わない
   * ——探索だけは、見つかったものを見せる手順が要るので画面側が実行を引き受ける（PlayScene）。
   * 画面の都合で足した操作（製作中オブジェクトのもの、craftingView）は持たない。
   */
  readonly key?: string;

  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。時間を消費しない操作は0。 */
  readonly minutes: number;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;

  /** 今この操作の要件（14節）を満たしているか。falseならボタンを押せなくする。 */
  readonly enabled: boolean;

  /** 満たしていない要件が宣言している理由の文言（14.6節）。宣言が無ければundefined。 */
  readonly reason: string | undefined;
}

/**
 * 札を落としたときに起きること1件。**画面は、宣言された組み合わせと枠へ入れる操作を区別しない**
 * ——どちらも名前と時間を吹き出しに出し、実行するだけ（CardInteraction.md 2節）。
 */
export interface CardDrop {
  /**
   * 吹き出しに出す名前。名前も時間も宣言していない枠ではundefined——ただ位置が変わるだけの移動に
   * 説明は要らない。
   */
  readonly name: string | undefined;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 起こすのにかかるゲーム内時間（分）。時間を消費しないものは0。 */
  readonly minutes: number;
  /**
   * まとめて起こせる最大数。**ドラッグ中に何枚ついてくるかを決める**のに使う（CardDragController）。
   * これを問うのは枚数が決まる前なので、返るのは「今の枚数で起きること」ではなく上限そのもの。
   */
  readonly maxCount: number;
  /**
   * 動く個体のID（先頭が指の掴んでいたもの）。画面の移動アニメーション（MotionContext.released）が
   * これを追う——ワールドが動かすものと画面が飛ばすものを食い違わせないため。
   */
  readonly movedIds: readonly number[];
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;
}

/**
 * カードを重ねたときに実行できるcombination（GameElementDefinition.md 12節）。宣言されている操作なので
 * 名前が必ずある。
 */
export interface CardCombination extends CardDrop {
  readonly name: string;
}

/**
 * 束のうち、まとめての操作が動かす先頭のcount個。**どの個体が動くのかはここだけが決める**——
 * 実際に動かす側（dropInto）と、動きを見せる側（movedIds）の両方がここを通る。
 */
function carriedOf<T>(stack: readonly T[], count: number): readonly T[] {
  return stack.slice(0, Math.max(1, count));
}

/**
 * 1枚の札が持つ操作一式（ObjectCardStackの操作の部分）。
 *
 * **どの個体が動くのかは、動かす側と見せる側で必ず一致する**——movedIdsが同じcarriedOfを通るのは
 * そのため（画面の移動アニメーションと、ワールドが実際に動かすものを食い違わせない）。
 */
export interface CardOperations {
  readonly actions: readonly CardAction[];
  readonly movedIds: (count: number) => readonly number[];
  readonly dropInto: (place: CardPlace, at?: CardPlacement, count?: number) => CardDrop | undefined;
  readonly reorderActionAt: (at: CardPlacement) => (() => void) | undefined;
}

/**
 * 札の上でプレイヤーが起こせること（ActionSystem.md・SlotSystem.md）。見た目（cardLooks）と違い、
 * **誰が・どのセッションで行うのか**が要る——実行にかかる時間も、要件を満たすかも、操作する本人で
 * 決まるため。gameから読むのは操作者（player.instance）・セッション・自動補充が探す現在地だけ。
 */
export interface CardOperationsFactory {
  /** その束を1枚の札として動かす操作。placeは今その束が居る場所。 */
  readonly forStack: (stack: readonly WorldObject[], place: CardPlace) => CardOperations;

  /**
   * その物で実行できる操作だけ。札にならないもの（キャラクタ自身・現在地）は動かせないので、
   * 場所を持たないこちらを使う。
   */
  readonly actionsOf: (instance: WorldObject) => readonly CardAction[];

  /**
   * selfが宣言しているcombinationsのうち、candidatesの先頭にマッチする先頭を実行する手段
   * （無ければundefined）。candidatesは`instrument`の役になる個体を運んできた順に並べたもの、movedは
   * 指が運んできた個体（演出で追う札）で、countはまとめて実行する個数。
   *
   * **candidatesとmovedは別物**——逆向きに成立した組み合わせでは、指が運んできた札のほうが`self`に
   * なるため、相手として渡す個体と画面上で動く個体が入れ替わる。
   */
  readonly combinationWith: (
    self: WorldObject,
    candidates: readonly WorldObject[],
    moved: readonly WorldObject[],
    count?: number,
  ) => CardCombination | undefined;
}

/** 今のゲームでの札の操作を作れるようにする。 */
export function cardOperationsOf(
  game: StartedGame,
  codex: WorldCodex,
  locale: Localization,
): CardOperationsFactory {
  /**
   * そのカードで実行できるアクション（ActionSystem.md 1節）。
   *
   * **ボタンにするのは`trigger: menu`だけ**（GameElementDefinition.md 11.1節）。時間の側が起こす
   * 操作（動物の1手）は、プレイヤーが押す機会を持たない。
   *
   * 製作中オブジェクトの操作（craftingView）も同じ並びに入る。**宣言から来たものと画面の都合で
   * 足したものを分けない**——ボタンにする側は、どちらも同じ1つの並びとして受け取る。
   */
  const actionsOf = (instance: WorldObject): readonly CardAction[] => {
    const texts = locale.object(instance.def.name);
    const fromDefinition = instance.menuActionsFor(game.player.instance).map((action) => {
      const declared = texts.interaction(action.name);
      const unmet = action.unmetRequirement();
      return {
        key: action.name,
        name: declared.displayName,
        description: declared.description,
        minutes: action.executionMinutes(),
        execute: () => {
          action.tryExecute();
        },
        enabled: unmet === undefined,
        reason: unmet?.reasonName === undefined ? undefined : locale.reason(unmet.reasonName),
      };
    });
    return [...craftingActions(instance, codex, game, locale), ...fromDefinition];
  };

  /**
   * itemを場所placeへ落としたときに起きること（そこへは落とせないならundefined）。入れられるかの判断は
   * すべてドメインに任せる（WorldObject.rejectionForMoveTo）——捻挫が身体から剥がれないのも、ヤシの木が
   * 手に持てないのも、画面が場所ごとに覚えている決まりではなくワールド側の宣言の帰結。
   *
   * **「落とせるか」「何と言うか」「何分か」「どう動かすか」を1つの問いで答える。** 別々に問うと、
   * 落とせないのに吹き出しだけ出る、といった食い違いが生まれる。
   */
  const dropInto =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement, count = 1): CardDrop | undefined => {
      if (place === from) return undefined;
      if (stack[0].rejectionForMoveTo(place) !== undefined) return undefined;

      // まとめて運んできたぶんも、1つずつ入れるのと同じことをする（時間も個数ぶんかかる）。
      // 入る個数を超えて頼まれても、超えたぶんは枠が断るだけ。
      const carried = carriedOf(stack, count);
      // 位置の指定が効くのは1つ目だけ。残りは同じ束へ合流するか、空いている枠へ入る。
      const put = (item: WorldObject, first: boolean): void => {
        item.moveToSlotOrRejection(place, first ? at : undefined);
      };

      const texts = locale.slot(place.def.name).putIn;
      const minutes = carried.reduce(
        (total, item) => total + place.putInMinutes(game.player.instance, item),
        0,
      );

      // 名乗りも値段も無い枠は、ただ位置が変わるだけなので何も言わない。
      const told =
        texts === undefined && minutes === 0
          ? undefined
          : {
              name: texts?.displayName ?? locale.slot(place.def.name).displayName,
              description: texts?.description,
            };

      return {
        name: told?.name,
        description: told?.description,
        minutes,
        maxCount: stack[0].acceptedCountForMoveToIncludingSelf(stack.slice(1), place),
        movedIds: carried.map((item) => item.instanceId),
        // 時間のかかる枠（手当てなど）はここで時間を進める。どの経路で入れても同じ値段になる。
        execute: () => {
          carried.forEach((item, index) =>
            putIntoSlot(item, place, game.player.instance, game.session, () => put(item, index === 0)),
          );
        },
      };
    };

  /**
   * selfが宣言しているcombinationsのうち、candidatesの先頭にマッチする先頭を実行する手段
   * （無ければundefined）。candidatesは`instrument`の役になる個体、movedは指が運んできた個体。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、宣言順の先頭を採る。
   *
   * **まとめて実行するのは、宣言が数を約束できる場合だけ**（`allow_multiple`、
   * GameElementDefinition.md 12.4節）。時間も個数ぶんかかる。
   */
  const combinationWith = (
    self: WorldObject,
    candidates: readonly WorldObject[],
    moved: readonly WorldObject[],
    count = 1,
  ): CardCombination | undefined => {
    const instrument = candidates.at(0);
    if (instrument === undefined) return undefined;

    const combination = self.combinationsWith(instrument, game.player.instance).at(0);
    if (combination === undefined) return undefined;

    const texts = locale.object(self.def.name).interaction(combination.name);
    const carried = carriedOf(candidates, count);
    return {
      name: texts.displayName,
      description: texts.description,
      minutes: carried.length * combination.executionMinutes(),
      maxCount: combination.acceptedCountIncludingSelf(candidates.slice(1)),
      movedIds: carriedOf(moved, count).map((instance) => instance.instanceId),
      execute: () => {
        combination.executeWithFollowers(carried.slice(1));
      },
    };
  };

  /** itemを同じ場所の中で動かす操作（動かせない位置ならundefined）。今いるスロットの中だけで完結する。 */
  const reorderIn =
    (item: WorldObject) =>
    (at: CardPlacement): (() => void) | undefined =>
      item.parent === undefined
        ? undefined
        : () => {
            item.reorderInParentSlot(at);
          };

  return {
    forStack: (stack, place) => ({
      actions: actionsOf(stack[0]),
      movedIds: (count) => carriedOf(stack, count).map((instance) => instance.instanceId),
      dropInto: dropInto(stack, place),
      reorderActionAt: reorderIn(stack[0]),
    }),
    actionsOf,
    combinationWith,
  };
}

import type { WorldCodex } from '../../domain/defs/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import type { WorldObject } from '../../domain/runtime/WorldObject';
import { putIntoSlot } from '../../domain/runtime/slotEntry';
import type { Localization } from '../../locale/Localization';
import { craftingActions } from './craftingView';
import type { CardPlace, CardPlaces, CardPlacement } from './cardPlaces';
import { samePlace } from './cardPlaces';

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
   * 指が掴んでいたインスタンス。同じ束へ重ねたときは束の2つ目になるため、束の代表とは限らない。
   * 画面側は「掴んでいたカード」の行方を追う（CardTable.MotionContext.released）のに使う。
   *
   * combinationを宣言している側（`self`）とは限らない——逆向きに成立した組み合わせでは、掴んだ札の
   * ほうが宣言している側になる（combinationOf参照）。
   */
  readonly held: WorldObject;
  /** 実行する。ワールドを変えるだけで、画面への反映は呼び出し側の責務。 */
  readonly execute: () => void;
}

/**
 * 物を枠へ入れる操作の見せ方（SlotDef.putInDuration・slot_textsのput_in）。かごへしまうのも怪我へ
 * 治療具を当てるのも同じこの1つの操作で、値段と呼び名は枠が決める。
 */
export interface CardPutIn {
  readonly name: string;
  /** 説明文。localeに書かれていなければundefined。 */
  readonly description: string | undefined;
  /** 入れるのにかかるゲーム内時間（分）。一瞬で入る枠は0。 */
  readonly minutes: number;
}

/**
 * そのスロットの枠の位置が安定しているか（`cell_count`、SlotSystem.md 3節）。空き枠を指した
 * ドロップを、枠そのものへ入れる操作として扱ってよいのはこちらだけ。
 */
function hasFixedCells(owner: WorldObject, slotGlobalId: number): boolean {
  return owner.tryGetSlot(slotGlobalId)?.def.cellCount !== undefined;
}

/**
 * 束のうち、まとめての操作が動かす先頭のcount個。**どの個体が動くのかはここだけが決める**——
 * 実際に動かす側（moveTo・putInto）と、動きを見せる側（movedIds）の両方がここを通る。
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
  readonly moveTo: (place: CardPlace, at?: CardPlacement, count?: number) => (() => void) | undefined;
  readonly acceptedCountAt: (place: CardPlace) => number;
  readonly putInto: (place: CardPlace, count?: number) => CardPutIn | undefined;
  readonly reorder: (at: CardPlacement) => (() => void) | undefined;
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
   * selfが宣言しているcombinationsのうち、draggedにマッチする先頭を実行する手段（無ければundefined）。
   * heldは指が掴んでいたインスタンス（CardCombination.held参照）。
   */
  readonly combinationWith: (
    self: WorldObject,
    dragged: WorldObject,
    held: WorldObject,
  ) => CardCombination | undefined;
}

/** 今のゲームでの札の操作を作れるようにする。placesは移動の宛先を解決する表。 */
export function cardOperationsOf(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
  places: CardPlaces,
): CardOperationsFactory {
  /**
   * そのカードで実行できるアクション。宣言を読むのは操作対象の代表（represented_by、ActionSystem.md
   * 1節）で、実行はカードが映しているオブジェクト自身へ頼む（代表の解決はエンジン側が行う）。
   * 水筒のカードに、中身の水のdrinkがボタンとして出る。
   *
   * `showMenu: never`のアクションはボタンにしない（GameElementDefinition.md 11.1節）。プレイヤーが
   * 押す機会が無い操作——動物の1手のように時間の側が起こすもの——のための宣言。
   *
   * 製作中オブジェクトの操作（craftingView）も同じ並びに入る。**宣言から来たものと画面の都合で
   * 足したものを分けない**——ボタンにする側は、どちらも同じ1つの並びとして受け取る。
   */
  const actionsOf = (instance: WorldObject): readonly CardAction[] => {
    const target = instance.resolveInteractionTarget();
    const texts = locale.object(target.def.name);
    const fromDefinition = target.def.actions
      .filter((action) => action.showMenu === 'always')
      .map((action) => {
        const declared = texts.interaction(action.name);
        const unmet = instance.actionUnmetRequirement(action.name, game.player.instance);
        return {
          key: action.name,
          name: declared.displayName,
          description: declared.description,
          minutes: instance.actionMinutes(action.name, game.player.instance),
          execute: () => {
            instance.tryExecuteAction(action.name, game.player.instance, game.session);
          },
          enabled: unmet === undefined,
          reason: unmet?.reasonName === undefined ? undefined : locale.reason(unmet.reasonName),
        };
      });
    return [...craftingActions(instance, codex, game), ...fromDefinition];
  };

  /**
   * プロパティを相手として指すときの表示（対応表の表示名と絵文字。プロパティは絵を持たない）。

  /**
   * itemを場所placeへ入れる操作（そこへは入れられないならundefined）。入れられるかの判断はすべて
   * ドメインに任せる（WorldObject.rejectionForMoveTo）——捻挫が身体から剥がれないのも、ヤシの木が
   * 手に持てないのも、画面が場所ごとに覚えている決まりではなくワールド側の宣言の帰結。
   */
  const moveInto =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, at?: CardPlacement, count = 1): (() => void) | undefined => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;
      if (stack[0].rejectionForMoveTo(dest.owner, dest.slotId) !== undefined) return undefined;

      // まとめて運んできたぶんも、1つずつ入れるのと同じことをする（時間も個数ぶんかかる）。
      // 入る個数を超えて頼まれても、超えたぶんは枠が断るだけ。
      const carried = carriedOf(stack, count);
      const put = (item: WorldObject, first: boolean): void => {
        // 位置の指定が効くのは1つ目だけ。残りは同じ束へ合流するか、空いている枠へ入る。
        if (at === undefined || !first) {
          item.moveToSlot(dest.owner, dest.slotId);
        } else if (at.kind === 'cell' && hasFixedCells(dest.owner, dest.slotId)) {
          item.moveToSlotAtCell(dest.owner, dest.slotId, at.index);
        } else {
          // 前詰めスロットの空き枠は末尾の受け皿だけなので、その位置の隙間へ落としたものとして扱う
          // （枠の位置がそのまま並びの終わりを指す）。
          item.moveToSlotAtGap(dest.owner, dest.slotId, at.index);
        }
      };

      // 時間のかかる枠（手当てなど）はここで時間を進める。どの経路で入れても同じ値段になる。
      return () => {
        carried.forEach((item, index) =>
          putIntoSlot(item, dest.owner, dest.slotId, game.player.instance, game.session, () =>
            put(item, index === 0),
          ),
        );
      };
    };

  /** stackのうち、placeへまとめて入れられる個数（入れられない場所では0）。 */
  const acceptedCountIn =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace): number => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return 0;

      return stack[0].acceptedCountForMoveTo(stack.slice(1), dest.owner, dest.slotId);
    };

  /**
   * itemをplaceへ入れるとどうなるか（吹き出しに出す文言と時間）。入れられない場所と、文言も時間も
   * 宣言していない枠ではundefined——ただ位置が変わるだけの移動には説明が要らない。
   */
  const putIntoTexts =
    (stack: readonly WorldObject[], from: CardPlace) =>
    (place: CardPlace, count = 1): CardPutIn | undefined => {
      const dest = places.slotOf(place);
      if (dest === undefined || samePlace(place, from)) return undefined;

      const slotDef = dest.owner.def.getSlotDef(dest.slotId);
      if (slotDef === undefined) return undefined;

      const texts = locale.slot(slotDef.name).putIn;
      // まとめて入れるなら時間も個数ぶん。1つずつ入れるのと同じことをするため（moveInto参照）。
      const minutes = carriedOf(stack, count).reduce(
        (total, item) => total + slotDef.putInMinutes(dest.owner, item, game.player.instance),
        0,
      );
      if (texts === undefined && minutes === 0) return undefined;
      return {
        name: texts?.displayName ?? locale.slot(slotDef.name).displayName,
        description: texts?.description,
        minutes,
      };
    };

  /**
   * selfが宣言しているcombinationsのうち、draggedにマッチする先頭を実行する手段（無ければundefined）。
   * heldは指が掴んでいたインスタンスで、self・draggedのどちらの役でもありうる（CardCombination.held参照）。
   *
   * 複数の組み合わせがマッチしたときにどれを実行するかの解決はUI層に委ねられている
   * （ActionSystem.md 1節）ため、宣言順の先頭を採る。
   */
  const combinationWith = (
    self: WorldObject,
    dragged: WorldObject,
    held: WorldObject,
  ): CardCombination | undefined => {
    const [combination] = self.findMatchingCombinations(dragged);
    if (combination === undefined) return undefined;

    const texts = locale.object(self.def.name).interaction(combination.name);
    return {
      name: texts.displayName,
      description: texts.description,
      minutes: self.combinationMinutes(dragged, game.player.instance, combination.name),
      held,
      execute: () => {
        self.tryExecuteCombination(dragged, game.player.instance, combination.name, game.session);
      },
    };
  };

  /** itemを同じ場所の中で動かす操作（動かせない位置ならundefined）。今いるスロットの中だけで完結する。 */
  const reorderIn =
    (item: WorldObject) =>
    (at: CardPlacement): (() => void) | undefined => {
      const parent = item.parent;
      const fixed =
        parent !== undefined && parent.getSlotByLocalId(item.parentSlotLocalId).def.cellCount !== undefined;
      if (at.kind === 'cell' && fixed) {
        return () => {
          item.moveToCellInParentSlot(at.index);
        };
      }
      return () => {
        item.reorderInParentSlot(at.index);
      };
    };

  return {
    forStack: (stack, place) => ({
      actions: actionsOf(stack[0]),
      movedIds: (count) => carriedOf(stack, count).map((instance) => instance.instanceId),
      moveTo: moveInto(stack, place),
      acceptedCountAt: acceptedCountIn(stack, place),
      putInto: putIntoTexts(stack, place),
      reorder: reorderIn(stack[0]),
    }),
    actionsOf,
    combinationWith,
  };
}

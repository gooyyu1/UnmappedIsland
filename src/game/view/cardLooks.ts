import type { AlertLevel } from '../../domain/defs/AlertLevel';
import type { ObjectDef } from '../../domain/defs/ObjectDef';
import type { WorldCodex } from '../../domain/defs/WorldCodex';
import type { WorldObject } from '../../domain/runtime/WorldObject';
import { currentStep, stepSupplyRatio } from '../../domain/runtime/crafting';
import { IN_PROGRESS_TAG, MATERIALS_SLOT, PROGRESS_PROPERTY } from '../../loader/inProgressObjects';
import type { Localization } from '../../locale/Localization';
import { artNameFor } from '../../art/objectArt';
import type { SlotRef } from '../../art/backgroundArt';
import { placeholderIconOf } from './characterCard';
import { recipeOf } from './recipeList';
import type { CardContent, CardCooking, CardGauge } from '../ui/Card';
import { COLOR } from '../looks/theme';
import type { CardKind } from '../looks/theme';

/**
 * 絵がまだ無い物の、種別ごとの代役アイコン（iconOf参照）。**種別はすべてここに行がある**
 * ——キャラクタも土地も、物の型が名乗るタグから決まる同じ種別の1つ（CardKind）。
 */
const KIND_ICONS: Readonly<Record<CardKind, string>> = {
  item: '📦',
  food: '🍎',
  container: '🧺',
  tool: '🔨',
  fixture: '🌳',
  injury: '🩹',
  animal: '🐾',
  character: '🧍',
  location: '🗺️',
};

/**
 * 中身のバー（液体の残量、CardView.md 8.2節）の塗り色を持つプロパティの名前
 * （LiquidContainerSystem.md 2節・4.1節）。
 *
 * UI側は「液体が`color`という名前で自分の色を宣言する」とだけ知っていて、液体の種類は知らない。
 * 宣言していない液体は灰色で出る。中身のバーはこの1本しか無く、1つの物が2つの`color`を持つことも
 * ありえない（プロパティ名は物ごとに一意）ので、タグにして数を数えられるようにする意味は無い。
 */
const COLOR_PROPERTY = 'color';

/**
 * 入れ物と中身の関係から出るバー（CardView.md 8節）の鍵。プロパティが宣言したゲージはプロパティ名
 * そのものを鍵にするので、**YAMLの識別子には現れない`@`で始めて**衝突しないようにする。
 */
const BUILTIN_GAUGE_KEYS = { fill: '@fill', capacity: '@capacity', material: '@material' } as const;

/** 良し悪しを言わない両端（中身のバーのように、色を別に渡すバーが使う）。 */
const NEUTRAL_ENDS = { atMin: 'neutral', atMax: 'neutral', worsensUpward: false } as const;

/**
 * 気を失っていることを言う覆い（overlayOf、CardView.md 9.1節・VitalsSystem.md 6節）を判定するために
 * 読むプロパティの名前。意識のバー自体は`gauge`宣言経由で汎用に出るが、覆いを出すかどうかは
 * `unconscious`という段の名前（UNCONSCIOUS_STAGE）と対で決まる仕組みなので、こちらは名前を直読みする。
 */
const CONSCIOUSNESS_PROPERTY = 'consciousness';

/**
 * カードの輪郭を明滅させるかを決めるプロパティの名前（animals.yaml・CardView.md 3節）。安全域を外れている間だけ明滅する。
 *
 * UI側は「この名前のプロパティが安全域を外れたら明滅する」とだけ知っていて、何がどれだけ危ないかは
 * 一切知らない（段のしきい値はワールド側の宣言）。
 */
const WARINESS_PROPERTY = 'wariness';

/**
 * 加熱の進みを持つプロパティの名前（animals.yaml・FireSystem.md 7節）。進んでいる間だけ、カードに
 * 覆いと残り時間が出る（CardView.md 15節）。
 *
 * **`gauge`宣言に乗せない唯一の理由は、常時出したくないこと。** 火にかかっているのは料理の間だけで、
 * 桟のバーは腐敗のように常に意味を持つ値のためのもの。名前を直読みするのは、意識の覆い
 * （CONSCIOUSNESS_PROPERTY）と同じく「出す/出さないの規則が宣言の外にある」場合に限る。
 */
const COOKING_PROPERTY = 'cooking_progress';

/**
 * 治療具を当てておくスロットの名前と、当たっているカードへ出す印
 * （injuries.yaml・CardView.md 9節 カードの印）。
 *
 * **手当ての有無で絵を差し替えない。** 差し替えると、怪我の部位 × 治療具の数だけ絵が要る。
 */
const TREATMENT_SLOT = 'treatment';
const TREATED_MARK = '🩹';

/**
 * 血が流れていることを言う印と、それを決めるプロパティの名前
 * （injuries.yaml・VitalsSystem.md 9節）。
 *
 * **負っている本人にも出す。** 傷のカードは開かないと見えないので、そこだけに出していると、
 * レーンを流し見しているあいだに失血が進む。手当てが要ることは、傷を開く前に分かる必要がある。
 *
 * 手当て済みの印より優先する。手当てをしてもまだ流れているなら、伝えるべきは「当ててある」ではなく
 * 「まだ止まっていない」のほう。
 */
const BLEEDING_PROPERTY = 'bleeding';
const BLEEDING_MARK = '🩸';

/**
 * 気を失っていることを言う覆いと、それを決める段の名前（VitalsSystem.md 6節）。
 *
 * UI側は「意識がこの名前の段に居たら覆いを出す」とだけ知っていて、何がどれだけ意識を奪ったかは
 * 知らない。段の名前を宣言しているのはワールドの側だけ（`load`の`too_heavy`と同じ分担）。
 */
const UNCONSCIOUS_STAGE = 'unconscious';

/**
 * 札の見た目（CardView.md）。**ワールドの今の状態だけから決まる**——誰が操作するのかも、今どこに
 * 居るのかも要らないので、Codexと対応表があれば作れる。
 *
 * 何を出すかはすべてワールド側の宣言から引く。ここが名前を直読みするプロパティ（意識・警戒・加熱）は、
 * 「出す/出さないの規則が宣言の外にある」ものだけ（各定数の注釈参照）。
 */
export interface CardLooks {
  /**
   * そのオブジェクト1つが映す札の見た目。束ねた枚数と識別子は含まない——それは束の側の話で、
   * 束が映すのは代表1つの姿だけ（ObjectCardStack参照）。
   */
  readonly contentOf: (object: WorldObject) => CardContent;

  /**
   * 型そのものを表す札。インスタンスを持たないので、まだ在るとは限らない物——枠が受け入れる素材
   * （LaneCell.accepts）——を見せるのに使う。
   */
  readonly typeContentOf: (objectGlobalId: number) => CardContent;

  /** そのオブジェクトの表示名。 */
  readonly nameOf: (object: WorldObject) => string;

  /** 絵がまだ無いオブジェクトの代替アイコン。 */
  readonly iconOf: (def: ObjectDef) => string;

  /** カードに映す絵の名前。 */
  readonly artOf: (def: ObjectDef, instance?: WorldObject) => string;

  /** カードに出す印（血・手当て）。どちらでもなければundefined。 */
  readonly markOf: (object: WorldObject) => string | undefined;

  /** カードの桟に積むバー。 */
  readonly gaugesOf: (object: WorldObject) => readonly CardGauge[];
}

/**
 * そのCodexと対応表での札の見た目を引けるようにする。minutesPerTickは加熱の残り時間に使う。
 *
 * instanceNameは、ワールドが**個体に**付けた名前を引く手段（土地の命名、IslandMap）。付いていない
 * 個体ではundefinedを返す。
 */
export function cardLooksOf(
  codex: WorldCodex,
  locale: Localization,
  minutesPerTick: number,
  instanceName: (instanceId: number) => string | undefined,
): CardLooks {
  /**
   * カードの下端に積むゲージ（プロパティの`gauge`宣言、CardView.md 8節）。耐久度・炉の残り薪・
   * 残っている傷・意識・工程の進捗はすべてこの1つの経路を通る——**UI側はプロパティの名前を1つも
   * 知らず**、「ゲージとして出す」と宣言されたものを宣言順に並べるだけ。
   *
   * 何本出るかも、どちらの端が良いかも、宣言の側が決める。1つも宣言していない物では空配列。
   */
  const declaredGaugesOf = (object: WorldObject): readonly CardGauge[] =>
    object.readGauges().flatMap((reading) => {
      // readGaugesはrangeを持つものだけを返す（ロード時に保証）ので、ここは実質always trueの絞り込み。
      if (reading.ratio === undefined || reading.gauge === undefined) return [];
      return [
        {
          key: reading.name,
          ratio: reading.ratio,
          atMin: reading.gauge.atMin,
          atMax: reading.gauge.atMax,
          worsensUpward: reading.gauge.worsensUpward,
        },
      ];
    });

  const consciousnessPropertyId = codex.propertyNames.tryGetId(CONSCIOUSNESS_PROPERTY);
  /** 気を失っているカードへ出す覆い（CardView.md 9.1節）。意識を持たない物・起きている物はundefined。 */
  const overlayOf = (object: WorldObject): string | undefined =>
    consciousnessPropertyId !== undefined && object.isInStage(consciousnessPropertyId, UNCONSCIOUS_STAGE)
      ? locale.stage(UNCONSCIOUS_STAGE)
      : undefined;

  const warinessPropertyId = codex.propertyNames.tryGetId(WARINESS_PROPERTY);
  /** 輪郭を明滅させる域。warinessを持たない物はundefined（明滅しない）。 */
  const alertOf = (object: WorldObject): AlertLevel | undefined =>
    warinessPropertyId === undefined ? undefined : object.readProperty(warinessPropertyId)?.alert;

  const treatmentSlotId = codex.slotNames.tryGetId(TREATMENT_SLOT);
  const bleedingPropertyId = codex.propertyNames.tryGetId(BLEEDING_PROPERTY);
  /** その物自身から血が流れているか。持たない物・止まった物はfalse。 */
  const isBleeding = (object: WorldObject): boolean =>
    bleedingPropertyId !== undefined && (object.readProperty(bleedingPropertyId)?.value ?? 0) >= 1;

  /**
   * カードに出す印。血が流れていれば🩸、そうでなく治療具が当たっていれば🩹、どちらでもなければundefined。
   *
   * 出血は**負っている本人まで届く**——傷そのものと、血が流れている傷を抱えている物の両方に出る。
   * UI側は怪我がどのスロットに入るかを知らず、「中に流れている物がいるか」だけを見る。
   */
  const markOf = (object: WorldObject): string | undefined => {
    if (isBleeding(object) || [...object.children()].some(isBleeding)) return BLEEDING_MARK;
    return treatmentSlotId !== undefined && (object.tryGetSlot(treatmentSlotId)?.contents.length ?? 0) > 0
      ? TREATED_MARK
      : undefined;
  };

  const colorPropertyId = codex.propertyNames.tryGetId(COLOR_PROPERTY);
  /**
   * 量として存在する中身（水・茶・油）のバー（LiquidContainerSystem.md 2節・4.1節）。
   *
   * 割合は中身自身の状態なので、代表（represented_by、7.6節）が量的オブジェクトかどうかだけで
   * 決まる。空の容器は代表が自分自身になるため、バーは出ない——映す中身がいない。UI側は容器の
   * スロット名を知らない。**色は良し悪しではなく中身そのものの色**なので、両端の見せ方ではなく
   * 中身が`color`として宣言した値をそのまま渡す（宣言していない液体は灰色）。
   */
  const fillGaugeOf = (object: WorldObject): CardGauge | undefined => {
    const content = object.tryGetRepresentative();
    if (content === undefined || !content.def.isQuantitative) return undefined;

    const ratio = content.fillRatioInParentSlot();
    if (ratio === undefined) return undefined;

    const color = colorPropertyId === undefined ? undefined : content.readProperty(colorPropertyId)?.value;
    return { ...NEUTRAL_ENDS, key: BUILTIN_GAUGE_KEYS.fill, ratio, color: color ?? COLOR.cardFillUnknown };
  };

  /**
   * 入れ物のカードに出す、中身が容量をどれだけ占めているか（ContainerSystem.md 1節）。入れ物として
   * 名乗っていない型（`storage`、GameElementDefinition.md 7.12節）と、上限（capacity）を持つスロットが
   * 1つも無い型ではundefined——あとどれだけ入るかが決まっていないものに、満たされ具合は無い。**満杯へ近づくほど物が入らなくなる**ので、空いている
   * 側がgood・満杯側がbad。
   *
   * 液体の容器はこのバーを持たない（storageを名乗らない）。上限は同じcapacityでも、量を持つのは
   * 中身の液体自身なので、中身のバー（fillGaugeOf）が中身の色で映す側になる
   * （LiquidContainerSystem.md 2節）。
   */
  const capacityGaugeOf = (object: WorldObject): CardGauge | undefined => {
    const ratio = object.storageFillRatio();
    if (ratio === undefined) return undefined;
    return { key: BUILTIN_GAUGE_KEYS.capacity, ratio, atMin: 'good', atMax: 'bad', worsensUpward: true };
  };

  const progressPropertyId = codex.propertyNames.tryGetId(PROGRESS_PROPERTY);
  const materialsSlotId = codex.slotNames.tryGetId(MATERIALS_SLOT);
  /**
   * 製作中オブジェクトのカードに出す材料の充足バー（RecipeSystem.md、CardView.md 10.1節）。
   * 製作中でない物、今の工程が無い物ではundefined。
   *
   * **今の工程が要求する分だけを数える。**「作業する」が押せるかと一致させるため、残りの工程まで
   * 数えない（残りを数えると、揃っているのに満たないバーが出る）。素材スロットの中身と今の工程の
   * 要求を突き合わせて出す値なので、プロパティの`gauge`宣言には乗らない（単一のプロパティの割合では
   * ないため）。**満ちた＝作業できる**を緑で言い切れるよう、満ちる側がgood。
   */
  const materialGaugeOf = (object: WorldObject): CardGauge | undefined => {
    if (progressPropertyId === undefined || materialsSlotId === undefined) return undefined;
    const recipe = recipeOf(object, codex);
    if (recipe === undefined) return undefined;

    const step = currentStep(recipe, object.getNumber(progressPropertyId));
    if (step === undefined) return undefined;
    const ratio = stepSupplyRatio(object, materialsSlotId, step);
    return { key: BUILTIN_GAUGE_KEYS.material, ratio, atMin: 'bad', atMax: 'good', worsensUpward: false };
  };

  const cookingPropertyId = codex.propertyNames.tryGetId(COOKING_PROPERTY);
  /**
   * その物自身の加熱の進み（CardView.md 15節）。`cooking_progress`を持たない物と、今は進んでいない物
   * ——火から出した肉、火の消えた炉の中身——ではundefined。
   *
   * **「火にかかっているか」を場所で判定しない。** 加熱を進めているのは炉の`heat`の段が宣言した
   * 寄与（FireSystem.md 7節）なので、その寄与が今効いているかどうかがそのまま答えになる。炉から
   * 出せば寄与が外れ、火が消えても外れる。UI側は炉のスロット名も火力の段も知らない。
   */
  const ownCookingOf = (object: WorldObject): CardCooking | undefined => {
    if (cookingPropertyId === undefined) return undefined;
    const ticks = object.ticksUntilOverflow(cookingPropertyId);
    if (ticks === undefined) return undefined;

    const ratio = object.readProperty(cookingPropertyId)?.ratio;
    return ratio === undefined ? undefined : { ratio, minutes: ticks * minutesPerTick };
  };

  /**
   * カードに出す加熱の進み。**自分が焼かれていればそれ、そうでなければ中で一番早く変わるもの**を出す。
   *
   * 火にかけた肉は炉のスロットの中に居るので、炉を押して開くまで見えない。放っておくと焦げる
   * （FireSystem.md 7.2節）ものを、開かずに気付けるようにする——出血の印が負っている本人まで
   * 上がるのと同じ理由（CardView.md 9.0節）で、辿るのは直下の子まで。
   */
  const cookingOf = (object: WorldObject): CardCooking | undefined => {
    const own = ownCookingOf(object);
    if (own !== undefined) return own;

    let soonest: CardCooking | undefined;
    for (const child of object.children()) {
      const cooking = ownCookingOf(child);
      if (cooking !== undefined && (soonest === undefined || cooking.minutes < soonest.minutes))
        soonest = cooking;
    }
    return soonest;
  };

  /**
   * カードが出すバーを、桟へ積む順に並べる（CardView.md 8節）。**プロパティが自分で宣言したゲージも、
   * 入れ物と中身の関係から出るバーも、ここで1本の並びに合流する**——カード側はどれが何かを知らない。
   *
   * 順は「材料 → プロパティの宣言順 → 中身 → 容量」。作りかけのカードでは材料が上、工程の進捗が下に
   * なる（同10.1節）。
   */
  const gaugesOfCard = (object: WorldObject): readonly CardGauge[] =>
    [
      materialGaugeOf(object),
      ...declaredGaugesOf(object),
      fillGaugeOf(object),
      capacityGaugeOf(object),
    ].filter((gauge): gauge is CardGauge => gauge !== undefined);

  const characterTagId = codex.tagNames.tryGetId('character');
  const locationTagId = codex.tagNames.tryGetId('location');
  const itemTagId = codex.tagNames.tryGetId('item');
  const fixtureTagId = codex.tagNames.tryGetId('fixture');
  const injuryTagId = codex.tagNames.tryGetId('injury');
  const animalTagId = codex.tagNames.tryGetId('animal');
  const foodTagId = codex.tagNames.tryGetId('food');
  const containerTagId = codex.tagNames.tryGetId('container');
  const liquidContainerTagId = codex.tagNames.tryGetId('liquid_container');
  const toolTagId = codex.tagNames.tryGetId('tool');
  const wipTagId = codex.tagNames.tryGetId(IN_PROGRESS_TAG);

  /** その型の表示名。インスタンスを見ないので、中身による差し替え（水入りの水筒）は含まない。 */
  const typeNameOf = (def: ObjectDef): string => {
    const texts = locale.object(def.name);
    // 製作中オブジェクトは自動生成なので対応表に載らない。完成品の名前から組み立てる。
    const product = codex.productOf(def);
    return product === undefined
      ? texts.displayName
      : texts.displayNameInProgress(locale.object(product.name).displayName);
  };

  /**
   * そのオブジェクトの表示名。**個体に名前が付いていればそれ**（土地）。付いていなければ型の名前で、
   * 中身を代表にしているもの（水入りの水筒）は中身の名前を差し込んだ名前になる（Localization.md）。
   * 代表がさらに中身を持つ入れ子は、内側から順に畳まれる。
   */
  const nameOf = (object: WorldObject): string => {
    // 個体に名前が付いていればそれ（土地の命名）。型の名前より優先する——同じ地形の土地が2つあっても
    // 別の場所として呼ばれる。
    const named = instanceName(object.instanceId);
    if (named !== undefined) return named;

    // 製作中オブジェクトも中身（材料）を持つが、名前は型のものをそのまま使う。
    if (codex.productOf(object.def) !== undefined) return typeNameOf(object.def);

    const content = object.tryGetRepresentative();
    return content === undefined
      ? typeNameOf(object.def)
      : locale.object(object.def.name).displayNameWithContent(nameOf(content));
  };

  /**
   * 絵がまだ無いオブジェクトの代替アイコン。**並ぶレーンではなく、その物の型から選ぶ**——
   * itemとfixtureを兼ねる編み籠は、地面へ据えてもアイテムのまま持ち歩けるので、レーンを移った
   * だけで別の物に見えては困る。持ち歩けるかどうかを先に見るのはそのため。
   */
  const kindOf = (def: ObjectDef): CardKind => {
    const has = (tagId: number | undefined): boolean => tagId !== undefined && def.tags.includes(tagId);
    // 人と場所は物の用途の並びに入らない（どちらも持ち歩く対象ではない）ので、先に見る。
    if (has(characterTagId)) return 'character';
    if (has(locationTagId)) return 'location';
    if (has(injuryTagId)) return 'injury';
    // 動物はitemも兼ねる（HuntingSystem.md 1.1節）ので、itemより先に見る。
    if (has(animalTagId)) return 'animal';
    // アイテムの用途（CardView.md 2節）。**兼ねる物は、生存の時計に近いほうを先に見る**——中に水を
    // 抱えた青いヤシの実は入れ物ではなく食事で、水があることは中身のバーが青で言う。
    if (has(foodTagId)) return 'food';
    if (has(containerTagId) || has(liquidContainerTagId)) return 'container';
    if (has(toolTagId)) return 'tool';
    if (has(itemTagId)) return 'item';
    if (has(fixtureTagId)) return 'fixture';
    return 'item';
  };

  /**
   * 作りかけの物か（RecipeSystem.md 5節のwipタグ）。**完成品のタグを引き継ぐ型なので、種別の判定より
   * 後から覆う**——作りかけの籠は入れ物の枠ではなく青写真の枠になる（CardView.md 10節）。
   */
  const inProgressDef = (def: ObjectDef): boolean => wipTagId !== undefined && def.tags.includes(wipTagId);

  /**
   * 絵がまだ無い物の代役アイコン。**型あての代役を先に、無ければ種別の代役**——キャラクタは絵が
   * 入るまで一人ずつ見分けたいので、型ごとの表（characterCard.ts）を持っている。
   */
  const iconOf = (def: ObjectDef): string => placeholderIconOf(def.name) ?? KIND_ICONS[kindOf(def)];

  /**
   * カードに映す絵の出所。製作中オブジェクトは完成品の絵を映す——作りかけであることは青の覆いが
   * 示すので、絵は何が出来つつあるのかを出せばよい（CardView.md 10節 製作中オブジェクトのカード）。
   * 自動生成される型（RecipeSystem.md）に絵を用意する道は無いため、これが唯一の出所でもある。
   *
   * instanceを渡すと、`art_by_stage`（GameElementDefinition.md 6.4節）が指す段の絵へ差し替える
   * （CardView.md 5.1節）。型だけのカード（instance無し）は個体の状態を持たないので常に型自身の絵。
   */
  const artOf = (def: ObjectDef, instance?: WorldObject): string =>
    artNameFor((codex.productOf(def) ?? def).name, instance?.artSuffix());

  /**
   * そのオブジェクトが今在るスロット（カードの地を引く先。CardView.md 7節）。
   *
   * **地はスロットだけで決まる。** 設置物なら土地の`fixtures`、怪我なら負った本人の`injuries`で、
   * どのスロットに何を敷くかは絵のファイル名が言う。ここに種別ごとの分岐は要らない。
   */
  const slotOfObject = (object: WorldObject): SlotRef | undefined => {
    const parent = object.parent;
    if (parent === undefined) return undefined;
    const slot = parent.getSlotByLocalId(object.parentSlotLocalId).def.name;
    return { owner: parent.def.name, slot };
  };

  /**
   * 型そのものを表すカード。インスタンスが1つも無くても作れるので、まだ在るとは限らない物
   * （枠が受け入れる素材）を見せるのに使う。個体ごとに違い得る値は持たない。
   */
  const cardOfType = (objectGlobalId: number): CardContent => {
    const def = codex.objects.get(objectGlobalId);
    return {
      icon: iconOf(def),
      name: typeNameOf(def),
      art: artOf(def),
      kind: kindOf(def),
      inProgress: inProgressDef(def),
    };
  };

  const contentOf = (object: WorldObject): CardContent => ({
    // 札が映している個体。**貸し出した札が帰る先の鍵**（ShownCards.returnBorrowed）なので、
    // 1個ぶんの札にも要る。束は全メンバーのIDで上書きする（stackOf）。
    identity: [object.instanceId],
    icon: iconOf(object.def),
    name: nameOf(object),
    kind: kindOf(object.def),
    // 作りかけかどうかは物の型が決める。設置物として地面に据わっていても手に持っていても、
    // 同じ「まだ物になっていない」カードとして出す。
    inProgress: inProgressDef(object.def),
    art: artOf(object.def, object),
    background: slotOfObject(object),
    gauges: gaugesOfCard(object),
    overlay: overlayOf(object),
    alert: alertOf(object),
    mark: markOf(object),
    cooking: cookingOf(object),
  });

  return {
    contentOf,
    typeContentOf: cardOfType,
    nameOf,
    iconOf,
    artOf,
    markOf,
    gaugesOf: gaugesOfCard,
  };
}

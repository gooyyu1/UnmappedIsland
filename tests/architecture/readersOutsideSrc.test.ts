import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE } from '../../scripts/settledDeclarations.mjs';
import { ROOT } from '../support/sourceFiles';

/**
 * **`src` に読み手が居ない公開**（`export` と `public` メンバ）の検査。読んでいるのは `src` の外
 * ——`tests/` と、ビルド用の `scripts/`——だけ、という宣言を集める。
 *
 * 隣の `exports.test.ts` が見るのは「どこからも輸入されない値の export」で、`tests/` は正当な輸入元
 * として数える。**その網の手前に、`src` の誰も使っていないのに公開のままのものが残る。** 公開は
 * 「外から使う」という宣言なので、外が試験と道具しか居ないなら、**そのために実装が歪んでいる**か、
 * **外へ開いていてよい読み取り口**かのどちらかで、混ざったまま置くと見分けが付かない。
 *
 * 倒し方は「**公開の入口から同じ契約を確かめられるか**」。確かめられるなら畳む——外の読み手は入口を
 * 通ればよく、そのぶん入口の側が守られる。確かめられないなら開いておく。確かめられない形は、
 * 入口が Phaser を要る（`sliceSpans`）・入口では別の面しか見えない（`combinationAt` は断る組み合わせ
 * まで返す唯一の口）・宣言そのものを数える材料になる（`ICON_NAMES`）、など。**回り道で同じ式を
 * 書けるだけでは「確かめられる」に数えない**——`Location.receiveItem` のように、回り道がその口の
 * 消した手順（どの枠へ入れるか）を呼び手へ戻すなら、開いておく側。
 *
 * **一覧に在ることは「開いていてよい」の証明ではない。** 証明はその宣言に付いた説明——型なら、
 * それを名乗る公開の署名——が持つ。
 *
 * **メンバを見るのは、exportしたクラスの中だけ。** ここが問うているのは「`private` へ戻すか」で、
 * インターフェースや型のフィールドにはその選択が無い（形そのものが契約）。**代わりに見落とすのは
 * 「`src` の誰も読まないフィールド」で、それは可視性ではなく死んだ宣言の問い**——同じ物差しでは
 * 倒せないので、ここでは見ない。そちらは `unreadFields.test.ts` が、**書きを除いて読みだけを
 * 数えて**見張る。
 *
 * **exportしていないクラスのメンバも落ちる。** そちらには `private` へ戻す選択が在るが、外から名前で
 * 辿れないぶん「外へ開いている」とは言いにくい。**取りこぼす側だと承知のうえで**、外から名指しできる
 * ものから倒す。
 *
 * **メンバの「`src` の読み手」には、同じファイルの、所属するクラスの外も入る。** メンバの可視性は
 * ファイルではなくクラスで閉じるので、同じファイルの別のクラスや関数が呼ぶメンバ（`Requirement.isMet`
 * を `Requirements` が呼ぶ）は `private` へ戻せない。**所属の中にしか読み手が居ないメンバは読み手が
 * 居ない側に数える**——そちらは `private` へ戻せる。
 *
 * **読み手がどこにも居ない公開は、別の一覧で見る**（{@link CALLED_WITHOUT_NAME}）。外に読み手が居る
 * ものとは倒し方が違う——入口から確かめられるかではなく、**名前を書かずに呼ぶ者が居るか**を問う。
 *
 * **数えているのは名前の一致で、型解決ではない**（`scripts/declarationInventory.mjs`）。ずれは両向きに
 * 出る——`src` のどこかに同じ名前の無関係な識別子が在れば現れず、逆に `tests/` 側の無関係な同名の
 * 識別子も「外の読み手」として数える。**確かなのは「`src` の他ファイルにも、同じファイルの所属の外にも
 * その名前が無い」ことだけ**なので、1件ずつ倒すときは現物の呼び手を見ること。
 */

/** 出力は`src`の量に比例して伸びるので、既定の上限（1MB）には頼らない。 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * この物差しを当てない置き場。
 *
 * **解析（`src/analysis/`）が出す数の読み手は stats レポートで、レポートは `tests/diagnostics/` に居る**
 * （`npm run stats:balance` などが走らせる）。この層では「`src` の外からしか読まれない」が既定なので、
 * 同じ物差しで数えると、表に列を1つ足すたびに一覧が伸びるだけになる。
 */
const OUT_OF_SCOPE = ['src/analysis/'];

/**
 * 今、`src` に読み手が居ない公開。**増やす前に、上の物差しで1件ずつ倒すこと。**
 *
 * 畳んだものはここから消す。消し忘れると、この検査が「まだ外にしか読み手が居ない」と言い続ける。
 */
const READ_ONLY_FROM_OUTSIDE = [
  'src/art/artFiles.ts locationNamesWithBackgroundArt',
  'src/art/iconArt.ts ICON_NAMES',
  'src/asset-pack/install.ts AssetPacks',
  'src/asset-pack/zip.ts ZipReadError',
  'src/codex-viewer/describe/Description.ts DescriptionWriter.toPlainText',
  'src/codex-viewer/networkLayout.ts LayoutEdge',
  'src/domain/CardFilter.ts CardFilter.tagGlobalIds',
  'src/domain/GeneratedTypes.ts GeneratedTypes.baseGlobalIdIfVariantOn',
  'src/domain/GlobalId.ts NotAGlobalId',
  'src/domain/ObjectDef.ts ObjectDef.artSuffixes',
  'src/domain/Pcg32.ts Pcg32.nextUint',
  'src/domain/PropertyDef.ts PropertyDef.alertDirection',
  'src/domain/PropertyValue.ts PropertyValue.registeredContributions',
  'src/domain/SlotDef.ts SlotDef.acceptsAtMostOne',
  'src/domain/SlotDef.ts SlotDef.hasPutInDuration',
  'src/domain/generation/AxisSampler.ts COASTAL_DISTANCE_AXIS_NAME',
  'src/domain/generation/GenerationScopeDef.ts GenerationScopeParams',
  'src/domain/generation/PathNetworkBuilder.ts TRAVEL_MINUTES_STEP',
  'src/domain/wrappers/Location.ts Location.fixtureStacks',
  'src/domain/wrappers/Location.ts Location.itemStacks',
  'src/domain/wrappers/Location.ts Location.receiveItem',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.equipmentStacks',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.handStacks',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.injuryStacks',
  'src/game/looks/PlayScreenLayout.ts PlayScreenLayout.informationContent',
  'src/game/looks/PlayScreenLayout.ts PlayScreenLayout.statusArea',
  'src/game/looks/theme.ts CARD_FRAME_KINDS',
  'src/game/ui/CardDragController.ts CardDragHandlers',
  'src/game/view/ShownCards.ts ShownCards.combinationAt',
  'src/game/view/ShownCards.ts ShownCards.edgeTargets',
  'src/game/view/cardMotionPlan.ts MotionInput',
  'src/game/view/daylight.ts SunlightHours.handworkLitAt',
  'src/loader/parseConditions.ts PROPERTY_OPS',
  'src/loader/parseSlots.ts RETIRED_SLOT_KEYS',
  'src/locale/Localization.ts bundledLocaleText',
  'src/locale/Localization.ts parseLocale',
  'src/locale/uiTexts.ts UI_TEXT_NAMES',
  'src/scenario/Scenario.ts parseScenario',
  'src/ui/nineSlice.ts sliceSpans',
];

/**
 * 今、読み手がどこにも居ない公開メンバ。**載せてよいのは、名前を書かずに呼ばれるもの**（枠組みが
 * 約束として呼ぶ、Phaser の `Scene` の `init` など）**だけ**——所属の中にしか呼び手が居ないなら
 * `private`（上書きさせるなら `protected`）へ戻す。
 */
const CALLED_WITHOUT_NAME = [
  'src/game/BootScene.ts BootScene.preload',
  'src/game/NewGameScene.ts NewGameScene.init',
  'src/game/PlayScene.ts PlayScene.init',
  'src/game/ShelfScene.ts ShelfScene.init',
];

/** `scripts/declarationInventory.mjs --json` の1件。読むのはこの検査が使う分だけ。 */
interface Declaration {
  readonly file: string;
  /** 所属。モジュール直下の宣言は`MODULE`。 */
  readonly owner: string;
  readonly name: string;
  /** `class`・`interface`・`function`・`ctor`など。メンバの所有者がどちらかを見るのに使う。 */
  readonly kind: string;
  readonly visibility: string;
  /** 自分のファイルの外で名前が現れるファイルの数。 */
  readonly referencingFiles: number;
  /** 自分のファイルの外の読み手が `src` の外（`tests/`・`scripts/`）にしか居ない。 */
  readonly referencedOnlyOutsideSrc: boolean;
  /** 同じファイルの、所属の外に読み手が居る。メンバだけが持つ。 */
  readonly referencedInOwnFileOutsideOwner?: boolean;
}

/** 一覧に並べる名前。所属を持つメンバだけが`所有者.名前`になる。 */
function labelOf(declaration: Declaration): string {
  const owner = declaration.owner === MODULE ? '' : `${declaration.owner}.`;
  return `${declaration.file} ${owner}${declaration.name}`;
}

/**
 * 可視性を選べる公開のうち、`src` の中で所属の外に読み手が居ないもの（{@link OUT_OF_SCOPE}を除く）。
 * どこに読み手が居るかは、呼び手の側で分ける。
 */
function publicWithoutReaderInSrc(): readonly Declaration[] {
  const reported = execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  const declarations = JSON.parse(reported) as readonly Declaration[];
  const topLevel = new Map(
    declarations.filter((each) => each.owner === MODULE).map((each) => [`${each.file}::${each.name}`, each]),
  );
  const visibilityIsAChoice = (declaration: Declaration): boolean => {
    if (declaration.owner === MODULE) return declaration.visibility === 'export';
    const owner = topLevel.get(`${declaration.file}::${declaration.owner}`);
    return declaration.visibility === 'public' && owner?.kind === 'class' && owner.visibility === 'export';
  };

  return declarations
    .filter((declaration) => declaration.referencingFiles === 0 || declaration.referencedOnlyOutsideSrc)
    .filter((declaration) => declaration.referencedInOwnFileOutsideOwner !== true)
    .filter((declaration) => !OUT_OF_SCOPE.some((dir) => declaration.file.startsWith(dir)))
    .filter(visibilityIsAChoice);
}

/**
 * 名前の一致では読み手を数えられないメンバ。**呼び手が名前を書かない**ので、物差しが何も言えない。
 *
 * - コンストラクタ: `new Foo()` が書くのはクラスの名前だけ。
 * - 計算された名前（`[Symbol.iterator]`）: 呼ぶのは構文（`for..of`）で、名前はどこにも書かれない。
 */
function isNamedByCallers(declaration: Declaration): boolean {
  return declaration.kind !== 'ctor' && !declaration.name.startsWith('[');
}

describe('`src` に読み手が居ない公開', () => {
  const found = publicWithoutReaderInSrc();

  it('`src` の外にしか読み手が居ないものが、一覧に無いまま増えていない', () => {
    expect(
      found
        .filter((declaration) => declaration.referencedOnlyOutsideSrc)
        .map(labelOf)
        .sort(),
      '`src` に読み手が居ない公開が動いた。増えたものは畳むか、開いておく理由を宣言へ書いて一覧へ足す。' +
        '減ったものは一覧から消す',
    ).toEqual([...READ_ONLY_FROM_OUTSIDE].sort());
  });

  it('読み手がどこにも居ないメンバが、一覧に無いまま増えていない', () => {
    expect(
      found
        .filter((declaration) => declaration.owner !== MODULE && declaration.referencingFiles === 0)
        .filter(isNamedByCallers)
        .map(labelOf)
        .sort(),
      '読み手がどこにも居ない公開メンバが動いた。増えたものは、所属の中にしか呼び手が居なければ' +
        '`private`（上書きさせるなら`protected`）へ戻す。名前を書かずに呼ばれるなら理由を書いて一覧へ足す。' +
        '減ったものは一覧から消す',
    ).toEqual([...CALLED_WITHOUT_NAME].sort());
  });
});

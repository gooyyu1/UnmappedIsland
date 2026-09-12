import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **テストからしか読まれていない公開**（`export` と `public` メンバ）の検査。
 *
 * 隣の `exports.test.ts` が見るのは「どこからも輸入されない値の export」で、`tests/` は正当な輸入元
 * として数える。**その網の手前に、`src` の誰も使っていないのに公開のままのものが残る。** 公開は
 * 「外から使う」という宣言なので、外がテストしか居ないなら、**テストのために実装が歪んでいる**か、
 * **テストへ開いていてよい読み取り口**かのどちらかで、混ざったまま置くと見分けが付かない。
 *
 * 倒し方は「**公開の入口から同じ契約を確かめられるか**」。確かめられるなら畳む——テストは入口を
 * 通ればよく、そのぶん入口の側が守られる。確かめられないなら開いておく。確かめられない形は、
 * 入口が Phaser を要る（`sliceSpans`）・入口では別の面しか見えない（`combinationAt` は断る組み合わせ
 * まで返す唯一の口）・宣言そのものを数える材料になる（`ICON_NAMES`）、など。
 *
 * **一覧に在ることは「開いていてよい」の証明ではない。** 証明はその宣言に付いた説明が持つ。
 *
 * **数えているのは名前の一致で、型解決ではない**（`scripts/declarationInventory.mjs`）。`src` のどこかに
 * 同じ名前の無関係な識別子——別のクラスの同名メンバ、ローカル変数——が1つでも在れば、その宣言はここに
 * 現れない。**外れるのは取りこぼす向きだけ**なので、一覧に載っているものは確かにテストしか読んでいない
 * が、**載っていないことは `src` に読み手が居ることの証明にはならない。**
 */

const ROOT = resolve(__dirname, '../..');

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
 * 今、テストからしか読まれていない公開。**増やす前に、上の物差しで1件ずつ倒すこと。**
 *
 * 畳んだものはここから消す。消し忘れると、この検査が「まだテスト専用だ」と言い続ける。
 */
const EXPOSED_TO_TESTS = [
  'src/art/iconArt.ts ICON_NAMES',
  'src/asset-pack/install.ts AssetPacks',
  'src/asset-pack/install.ts AssetPacks.matchesSetting',
  'src/asset-pack/zip.ts ZipEntry.method',
  'src/asset-pack/zip.ts ZipReadError',
  'src/codex-viewer/describe/Description.ts DescriptionLine.toPlainText',
  'src/codex-viewer/describe/Description.ts DescriptionWriter.toPlainText',
  'src/codex-viewer/networkLayout.ts LayoutEdge',
  'src/domain/CardFilter.ts CardFilter.tagGlobalIds',
  'src/domain/GeneratedTypes.ts GeneratedTypes.baseGlobalIdIfVariantOn',
  'src/domain/GlobalId.ts NotAGlobalId',
  'src/domain/Pcg32.ts Pcg32.nextUint',
  'src/domain/PropertyDef.ts PropertyDef.alertDirection',
  'src/domain/PropertyDef.ts PropertyRange.hasReached',
  'src/domain/PropertyValue.ts PropertyValue.registeredContributions',
  'src/domain/SlotDef.ts SlotDef.acceptsAtMostOne',
  'src/domain/SlotDef.ts SlotDef.hasPutInDuration',
  'src/domain/generation/GenerationScopeDef.ts GenerationScopeParams',
  'src/domain/generation/LocationTypeDef.ts AxisPreference.tolerance',
  'src/domain/wrappers/Location.ts Location.fixtureStacks',
  'src/domain/wrappers/Location.ts Location.itemStacks',
  'src/domain/wrappers/Location.ts Location.receiveItem',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.equipmentStacks',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.handStacks',
  'src/domain/wrappers/PlayerCharacter.ts PlayerCharacter.injuryStacks',
  'src/game/looks/PlayScreenLayout.ts PlayScreenLayout.informationContent',
  'src/game/looks/PlayScreenLayout.ts PlayScreenLayout.statusArea',
  'src/game/looks/rainStyle.ts RainStyle.drops',
  'src/game/looks/rainStyle.ts RainStyle.gusts',
  'src/game/ui/CardDragController.ts CardDragHandlers',
  'src/game/view/ShownCards.ts ShownCards.combinationAt',
  'src/game/view/ShownCards.ts ShownCards.edgeTargets',
  'src/game/view/cardMotionPlan.ts MotionInput',
  'src/game/view/cardMotionPlan.ts MotionPlan.discards',
  'src/game/view/daylight.ts SunlightHours.handworkLitAt',
  'src/loader/LoadReport.ts LoadProblem.attempted',
  'src/locale/Localization.ts LocaleSections.destroyReasons',
  'src/locale/Localization.ts bundledLocaleText',
  'src/locale/Localization.ts parseLocale',
  'src/locale/uiTexts.ts UI_TEXT_NAMES',
  'src/scenario/Scenario.ts Scenario.inside',
  'src/scenario/Scenario.ts parseScenario',
  'src/ui/nineSlice.ts sliceSpans',
];

/** `scripts/declarationInventory.mjs --json` の1件。読むのはこの検査が使う分だけ。 */
interface Declaration {
  readonly file: string;
  /** 所属するクラス・インターフェース。モジュール直下の宣言は`(モジュール)`。 */
  readonly owner: string;
  readonly name: string;
  readonly visibility: string;
  readonly referencedOnlyByTests: boolean;
}

/** 一覧に並べる名前。所属を持つメンバだけが`所有者.名前`になる。 */
function labelOf(declaration: Declaration): string {
  const owner = declaration.owner === '(モジュール)' ? '' : `${declaration.owner}.`;
  return `${declaration.file} ${owner}${declaration.name}`;
}

describe('テストからしか読まれない公開', () => {
  it('一覧に無いものが増えていない', () => {
    const reported = execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs'), '--json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    const found = (JSON.parse(reported) as readonly Declaration[])
      .filter((declaration) => declaration.referencedOnlyByTests)
      .filter((declaration) => ['export', 'public'].includes(declaration.visibility))
      .filter((declaration) => !OUT_OF_SCOPE.some((dir) => declaration.file.startsWith(dir)))
      .map(labelOf)
      .sort();

    expect(
      found,
      'テストからしか読まれない公開が動いた。増えたものは畳むか、開いておく理由を宣言へ書いて一覧へ足す。' +
        '減ったものは一覧から消す',
    ).toEqual([...EXPOSED_TO_TESTS].sort());
  });
});

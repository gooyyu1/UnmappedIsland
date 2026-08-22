# loader

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/asset-pack/AssetPack.ts | 16 | 11 | 1 | 0 | 4 | 0 |
| src/asset-pack/install.ts | 6 | 3 | 2 | 1 | 0 | 0 |
| src/asset-pack/zip.ts | 19 | 19 | 0 | 0 | 0 | 0 |
| src/loader/LoadReport.ts | 9 | 7 | 0 | 1 | 1 | 0 |
| src/loader/RawObjectDef.ts | 29 | 11 | 1 | 1 | 15 | 1 |
| src/loader/RawPatch.ts | 24 | 16 | 0 | 7 | 1 | 0 |
| src/loader/RawTrait.ts | 17 | 4 | 0 | 1 | 12 | 0 |
| src/loader/WorldCodexYamlLoader.ts | 25 | 16 | 6 | 0 | 3 | 0 |
| src/loader/YamlLoadError.ts | 2 | 1 | 0 | 1 | 0 | 0 |
| src/loader/axisVariants.ts | 8 | 6 | 0 | 2 | 0 | 0 |
| src/loader/errorMessage.ts | 1 | 0 | 0 | 1 | 0 | 0 |
| src/loader/generatedObjectDefs.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/loader/inProgressObjects.ts | 6 | 5 | 0 | 0 | 0 | 1 |
| src/loader/loadDefinitions.ts | 5 | 4 | 1 | 0 | 0 | 0 |
| src/loader/loadWorldCodex.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/loader/parseActionsAndCombinations.ts | 9 | 9 | 0 | 0 | 0 | 0 |
| src/loader/parseActiveEffects.ts | 26 | 25 | 0 | 1 | 0 | 0 |
| src/loader/parseCommon.ts | 6 | 5 | 1 | 0 | 0 | 0 |
| src/loader/parseConditions.ts | 17 | 13 | 0 | 0 | 4 | 0 |
| src/loader/parseGeneration.ts | 8 | 6 | 0 | 0 | 2 | 0 |
| src/loader/parsePassives.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/loader/parseProperties.ts | 7 | 5 | 0 | 1 | 1 | 0 |
| src/loader/parseRecipes.ts | 6 | 6 | 0 | 0 | 0 | 0 |
| src/loader/parseSlots.ts | 6 | 5 | 1 | 0 | 0 | 0 |
| src/loader/yamlMapping.ts | 21 | 0 | 0 | 21 | 0 | 0 |
| **合計** | **282** | **186** | **13** | **38** | **43** | **2** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| `AssetPack` | ZIPから読んだ1パックの在庫表として、パス→中身／URLを答える | `worldCodexTexts` `localeText` `objectArt` `backgroundArt`（「どのフォルダに何が入る規約か」の話で、規約の持ち主は loader・locale・art の3者） |
| `install.ts` | サンプルパックを取得して1つだけ入れ、入ったパックを答える | `assetPackMatches`（設定値との突き合わせ＝`SettingsScene` の判断） |
| `zip.ts` | ZIPのバイト列をパス→バイト列のマップへ展開する | （なし。ゲームの語彙を1つも持たない） |
| `LoadReport` | 致命でないロード上の問題を溜めて読み出せるようにする**と**、その場でコンソールへ出す | `add` のコンソール出力（記録の責務ではない）、`LOAD_REPORT`（アプリ全体で1つという配線の話） |
| `RawObjectDef` | object_def宣言の生の姿を保持する**と**、trait合成して `ObjectDef` を組み立てる | `resolve` の後半（`ObjectDef` の不変条件検証）、`node`・`readFields`（patchのための開口）、`namesIn`（汎用YAMLヘルパー） |
| `RawPatch` | patch宣言1件の中身（動詞・パス・値・目印・出所）を持つ | `report`（このpatchが失敗したときの報告先＝ロードセッションの持ち物）、`applyPatches` 以下11本（patch適用エンジンで、データ型と同居している） |
| `RawTrait` | trait宣言の生の姿を保持する | 12個の宣言フィールド全部（`RawObjectDef` と同じ11キーを二重に定義している） |
| `WorldCodexYamlLoader` | YAMLを読み溜めて `WorldCodex` を組み立てる**と**、6つの名前空間と地形生成宣言の蓄積を保持する | `generationAxes` `generationLocationTypes` `generationScopes`（parseGeneration.ts だけが読み書きする蓄積） |
| `parseProperties.ts` | props宣言1件を `PropertyDef` として読む | `parseProp` 末尾の2つの整合検査（gaugeの向きとstagesのalert、rangeとmixed）＝ `PropertyDef` 自身の不変条件 |
| `parseConditions.ts` | conditions宣言を `ConditionNode`/`Requirements` として読む | `*_CONDITION_ROOTS` 4本（文脈ごとに `ReferenceRoot` が実行時に解決できるかという domain の事実） |
| `parseGeneration.ts` | 地形生成の3ルートキーを読み、`GenerationDefs` を組み立てる | `resetGeneration`（loaderの内部を外から掃除する）、`buildGenerationDefs` の相互参照検証（`GenerationDefs` の不変条件） |
| `yamlMapping.ts` | YAMLノードから型を確かめて値を取り出す | （なし。ただし世界の語彙を1つも知らず、locale・scenario も使っている） |
| `inProgressObjects.ts` | レシピを持つ型から製作中オブジェクトのYAMLと座標を組み立てる | `inProgressObjectName` の export（生成型の名前規約を loader の外へ配っている） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/loader/RawTrait.ts#RawTrait ／ src/loader/RawObjectDef.ts#RawObjectDef | `props` `slots` `passives` `stackOrder` `visibleSlots` `isStorage` `artByStage` `boundToOwner` `notStackable` `actions` `combinations` `tags`（両クラスに各1つ、計24） | 所属 | 4 | 同じ11キーを読むフィールドと読み取りコードが2クラスに丸ごと重複しており、`RawTrait.readFields` のコメント自身が「読む側を2箇所に置かない」と書いているのに2箇所にある | 共通の `RawDeclarationBody`（混ぜ込める宣言一式）を作り、`RawObjectDef`/`RawTrait` がそれを1つ持つ | `RawObjectDef` は patch 後に `readFields()` で取り直す必要があり `node` を保持し続けるのに対し、`RawTrait` は構築時に1回読んで `node` を捨てる——ライフサイクルの違いを吸収する型が無いので、本体ごと両側へ写された | |
| src/loader/RawObjectDef.ts#RawObjectDef | `resolve()` | 所属 | 4 | 180行の後半が `ObjectDef` の不変条件検証（actions/combinations の名前衝突、visible_slots が自分の持つスロットを指すか、art_by_stage の指す先が stages を持つか、段のartを書けるのは art_by_stage のプロパティだけか）で、`ObjectDef` を作った**後**に呼び出し側が確かめている | `ObjectDef` のコンストラクタ（検証部分のみ） | 例外が `YamlLoadError` で、文言に `'型名'` とYAML上の節番号（6.4節・11節）が入る。domain へ移すとYAML由来のエラー型と出所文字列を domain が知ることになる | |
| src/loader/RawObjectDef.ts#RawObjectDef | `node` | 可視性 | 4 | 宣言ノードを public にしているのは `RawPatch.apply` が外から書き換えるためだけ | `RawObjectDef.applyPatch(...)` を生やして `node` を private に | patch のパス降下（`descendToMap`/`descendToSeq`）とマッチ判定が RawPatch.ts 側にあり、そこからノードへ直接触る構造になっている | |
| src/loader/RawObjectDef.ts#RawObjectDef | `readFields()` | 可視性 | 4 | public な理由は「patch がノードを書き換えた後に外から呼び直す」ためだけ（RawPatch.ts L151）。クラスのコメントは「取り直しはこのクラス自身が引き受ける」と書いているが、実際は呼び出し側が手順を覚えている | 同上（`applyPatch` の中で自分で呼ぶ） | 同上 | |
| src/loader/RawObjectDef.ts | `namesIn()` | 配置 | 5 | `YAMLSeq | undefined` を名前の配列にするだけの汎用ヘルパーで、`RawObjectDef` と一切関係が無い（`RawTrait` からも import されている） | `src/loader/yamlMapping.ts` | | |
| src/loader/RawObjectDef.ts#RawObjectDef | `globalId` | 所属 | 2 | 同一性のためのID。trait解決前に確定するので生の側が持つ必要がある | — | | |
| src/loader/RawObjectDef.ts | `concatSeqs()` | 配置 | 3 | 2つのYAMLノードを配列として連結するだけで、object_def の語彙を持たない | `src/loader/yamlMapping.ts` | | |
| src/loader/RawTrait.ts#RawTrait | `readFields()` | 所属 | 3 | private ヘルパーだが、中身は `RawObjectDef.readFields` の写し（上の行と同じ問題） | `RawDeclarationBody` | | |
| src/loader/RawPatch.ts#RawPatch | `report` | 所属 | 4 | 「この操作が失敗したときの報告先」はpatch1件の性質ではなく、ロードセッションの持ち物 | `applyPatches` の引数、または `WorldCodexYamlLoader` | patchは `load()` 呼び出しごとに（同梱ぶんは report 無し、パックぶんは report 有り）蓄積され、適用は `build()` までまとめて遅れる。どのpatchがどの報告先かを保つ場所が他に無い | |
| src/loader/RawPatch.ts | `applyPatches()` `descendToKey()` `descendToSeq()` `descendToMap()` `indexOfMatch()` `matches()` `keyHint()` | 配置 | 3 | patch適用エンジン（11本）が、patch宣言1件のデータ型と同じファイルに同居している。うち5本はYAMLノードの降下・部分一致という汎用処理 | `src/loader/applyPatches.ts`（降下系は `yamlMapping.ts`） | | |
| src/loader/WorldCodexYamlLoader.ts#WorldCodexYamlLoader | `generationAxes` `generationLocationTypes` `generationScopes` | 所属 | 4 | public readonly だが中身は可変で、コメント自身が「parseGeneration.tsの関数群だけが読み書きする」と認めている。loaderのフィールドでありながらloaderは一度も読まない | parseGeneration.ts 側の `GenerationSections`（蓄積クラス）を loader が1つ持つ | parseGeneration.ts は自由関数の集まりで蓄積の持ち主となるオブジェクトが無く、蓄積は `load`／`build`／`reset` のライフサイクルに乗る必要がある。モジュール変数にするとテスト間で漏れるので、既にライフサイクルを持つ loader へ吊るされた | |
| src/loader/WorldCodexYamlLoader.ts#WorldCodexYamlLoader | `objectNames` `propertyNames` `slotNames` `tagNames` `propertyTagNames` `symbolNames`（getter 6本） | 可視性 | 2 | `_x` private フィールド＋getter の対は、`reset()` が丸ごと差し替えられるようにしつつ外へは読み取り専用に見せるためのプログラム上の都合 | — | | |
| src/loader/parseGeneration.ts | `resetGeneration()` | 所属 | 4 | 引数の loader の内部蓄積を外から掃除する関数。CLAUDE.md の「自分のことは自分でする」に真っ向から反する形 | 上の `GenerationSections.reset()` | `generationAxes` 等が loader の public フィールドとして置かれているため、掃除も外からしか書けない | |
| src/loader/parseGeneration.ts | `buildGenerationDefs()` | 所属 | 4 | 中身の大半が `GenerationDefs` の相互参照検証（location_type が実在の軸／object_def を指すか、亜種が上書きするプロパティを土地の型が持つか）で、`GenerationDefs` を作る**前**に呼び出し側で確かめている | `GenerationDefs` のコンストラクタ（検証部分のみ） | 検証の文言に `loader.objectNames.getName()`／`propertyNames.getName()` によるID→名前の逆引きが要る。`GenerationDefs` は `NameRegistry` を持たないので、名前を出せるのは loader 側だけ | |
| src/loader/parseProperties.ts | `parseProp()` | 所属 | 4 | `new PropertyDef(...)` した**後**に、gaugeの向きとstagesのalertの向きの一致・rangeを持つプロパティのalertが単調かを検査している。どちらも `PropertyDef` が成立するための不変条件で、`def.alertDirection` という自分のgetterで判定している | `PropertyDef` のコンストラクタ（検査部分のみ） | 文言にYAML上の文脈文字列（`'型名'.props.'名前'`）と節番号が入り、例外型が `YamlLoadError`。`PropertyDef` に持たせるとYAML由来の語彙が domain へ入る | |
| src/loader/parseProperties.ts | `parseRangeEventEffect()` | 所属 | 3 | `parseActiveEffectBody` を固定引数で呼ぶだけの1行の別名 | `parseActiveEffectBody` を直接呼ぶ | | |
| src/loader/parseConditions.ts | `ACTION_CONDITION_ROOTS` `COMBINATION_CONDITION_ROOTS` `RECIPE_CONDITION_ROOTS` `PASSIVE_CONDITION_ROOTS` | 所属 | 4 | 各集合の理由がYAML文法ではなく**実行時に解決先を持つか**（「成果物のインスタンスがまだ無い」「actor/draggedは持続的な関係に紐づかない」）で書かれている。これは `ReferenceRoot` の性質であってパースの知識ではない | `src/domain/ReferenceRoot.ts` | 「どの評価文脈か」を表す型が domain に無く（action/combination/recipe/passive はそれぞれ別のクラスに散っている）、4つの集合を掛ける先が loader の呼び出し4箇所しか存在しない | |
| src/loader/parseCommon.ts | `parseScalarNumber()` | 所属 | 2 | 戻り値 `[number, boolean]` の2つ目が「シンボル名として登録されたか」であることは名前からもシグネチャからも読めない。呼び出し側（`parseProp`）が `isSymbolProperty` として使う | 戻り値を名前付きの形へ（`{value, isSymbol}`） | | ✔ |
| src/loader/parseSlots.ts | `parsePlacement()` | 所属 | 2 | `readonly string[]` を返し、呼び出し側が `.includes('auto')` / `.includes('manual')` で2つのbooleanへ畳んでいる。中間の文字列配列はプログラム上の都合だけの存在 | `{auto, manual}` を返すか、`SlotDef` が `placement` をそのまま受ける | | |
| src/loader/inProgressObjects.ts | `inProgressObjectName()` | 可視性 | 5 | 生成型の名前規約を export して `src/game/view/recipeList.ts`（映し）が同じ文字列を組み立て直している。同ファイルは28行上で `codex.variationsOf(def).get(RECIPE_AXIS)` を使っており、逆向きは `codex.tryResolveBecome(product, {recipe: recipe.name})` で既に引ける | export をやめてモジュール内に閉じる。映し側は `WorldCodex.tryResolveBecome` を使う | | |
| src/loader/inProgressObjects.ts | （`export { IN_PROGRESS_TAG } from '../domain/RecipeDef'` L13、インベントリ外） | 可視性 | 5 | domain の定数に loader 経由の第二の入口を作っているが、その入口を使う箇所は1つも無い | 削除（`domain/RecipeDef` から直に読む） | | |
| src/loader/LoadReport.ts | `LOAD_REPORT` | 配置 | 4 | アプリ全体で1つの可変シングルトンが、記録の型を定義するファイルに同居している。`loadDefinitions` は `report` を引数で受けるので、誰が1つ持つかは組み立ての判断 | `src/game/BootScene.ts` と `src/codex-viewer/CodexSource.ts` が共有する組み立て側（`src/main.ts` / `src/codex-viewer/main.ts`） | ゲームとビューアという2つの入口が同じ実体を必要とするのに、両者を束ねる組み立ての場が存在しない。モジュール変数がその代わりになっている | |
| src/loader/LoadReport.ts#LoadReport | `add()` | 所属 | 3 | 記録を溜めるだけでなく `console.warn` も行う。出力先の選択は記録の責務ではない | 出力は呼び出し側（組み立て）か、記録を読む側へ | | ✔ |
| src/loader/YamlLoadError.ts ／ src/loader/yamlMapping.ts | `YamlLoadError`、および `yamlMapping.ts` の全21宣言 | 配置 | 3 | 世界の語彙を1つも持たない汎用YAMLアクセスで、`src/locale/Localization.ts` と `src/scenario/Scenario.ts` も loader へ手を伸ばして使っている | `src/util/yaml.ts` ／ `src/util/YamlLoadError.ts`（Layers.md 4節の「層の外」） | | |
| src/loader/errorMessage.ts | `messageOf()` | 配置 | 3 | 例外から文字列を取り出すだけの汎用関数で、YAMLもロードも知らない。`src/game/errorReport.ts` には fallback 付きの同名の別実装がある | `src/util/errors.ts`（game 側の実装と統合） | | |
| src/loader/axisVariants.ts | `AxisDecl` / `AxisDecl.values` | 所属 | 3 | フィールド1つだけの型で、`Array<[string, AxisDecl]>` のタプル要素にしかならない。プログラム上の都合だけで存在する | 型ごと畳んで `Array<[string, readonly ObjectDef[]]>` に | | |
| src/loader/parseActiveEffects.ts | `oneOrMany<T>()` | 配置 | 3 | 「1個でも配列でも受ける」というYAMLの読み方一般の話で、active効果と関係が無い | `src/loader/yamlMapping.ts` | | |
| src/loader/loadDefinitions.ts#Definitions | `files` | 所属 | 2 | 「実際に読んだ定義YAMLのファイル名」は定義そのものではなく、読み込みの診断情報。プログラム上、外したパックを見分けるために要る | — | | |
| src/asset-pack/AssetPack.ts#AssetPack | `worldCodexTexts()` `localeText()` | 所属 | 4 | ZIP内の `world-codex/` と `locale/<言語>.yaml` という**読む側の規約**を、在庫表であるパックが知っている。同じ規約が同梱ぶん側（`loadWorldCodex.ts` の glob、`locale/Localization.ts`）にもあり、2箇所が暗黙に一致すべき状態になっている | `src/loader/loadWorldCodex.ts` ／ `src/locale/Localization.ts`（パックへはパス一覧と中身だけを聞く） | `files` と `text()` が private で、パス→中身を引く口が外に無い | |
| src/asset-pack/AssetPack.ts#AssetPack | `objectArt()` `backgroundArt()` | 所属 | 4 | 「どのファイルがどの絵か」は Layers.md 3節が素材（`src/art/`）の仕事と明示している規約。`objects/<識別子>.png`・`backgrounds/<持ち主>_<スロット>_<用途>.png` をパックが知っている | `src/art/objectArt.ts` ／ `src/art/backgroundArt.ts` | Blob URL のキャッシュ（`urls`）と `url()` が private なので、パス→URL を作れるのは `AssetPack` の中だけ | |
| src/asset-pack/AssetPack.ts#AssetPack | `urls` | 所属 | 2 | 同じ絵を2度要求されたときに1つのBlob URLで済ませるためのキャッシュ | — | | |
| src/asset-pack/install.ts | `assetPackMatches()` | 所属 | 3 | 引数 `loadsAssetPack` は `Settings` の値で、この関数は設定と現状の突き合わせという `SettingsScene` の判断そのもの。`installedAssetPack()` が既に公開されているので、ここに置いて守っているものは何も無い | `src/game/SettingsScene.ts` | | |
| src/asset-pack/install.ts | `SAMPLE_PACK_URL` `installed` | 所属 | 2 | 起動時に1回だけ入るモジュール状態と、その取得先。プログラム上必要な配線 | — | | |

## 移動先が書けなかったもの

| 対象 | 欠けている概念 |
|---|---|
| `*_CONDITION_ROOTS` 4本（判定4） | 移動先として `src/domain/ReferenceRoot.ts` を挙げたが、そこに置いても**「どの評価文脈か」を表す型**が domain に無いため、4つの集合は名前で区別された定数のまま残る。欠けているのは「評価文脈（action / combination / recipe解放 / passiveゲート）」を1つの型として表し、その型に「解決できる `ReferenceRoot`」を聞く口。これが無いので、実行時に解決できるかという domain の事実が、ロード時にしか読まれない定数として loader に住み続ける。 |
| `RawPatch.report`（判定4） | 「1回のロードセッション」を表す型が無い。`WorldCodexYamlLoader` は複数回の `load()` を跨いで蓄積するだけで、「このファイル群を、この報告先で読む」という単位が存在しないため、報告先が最小の粒（patch 1件）へ張り付いている。 |

## ファイル配置（層=配置）についての所見

- `src/loader/` は Layers.md 4節で「世界」の一部（`src/domain/` の定義を読む側）と位置づけられているが、実際には**世界の語彙を1つも知らない汎用YAML基盤**（`yamlMapping.ts` 21宣言・`YamlLoadError.ts`・`errorMessage.ts`）を抱えており、`src/locale/` と `src/scenario/` がそれを使うために loader へ import している。層の外の道具（`src/util/`）へ出せば、この2本の import は消える。担当範囲282宣言のうち23がこれに当たり、判定3の38件の大半を占める。
- `src/asset-pack/` は Layers.md の在処の表に載っていない。`AssetPack` が世界（`world-codex/`）・ことば（`locale/`）・素材（`objects/`・`backgrounds/`）3層ぶんのファイル規約を1クラスで抱えているのが、層の表に書けない理由そのもの。パックを「パス一覧＋パス→中身／URL」に絞り、規約は各層側へ戻せば、`src/asset-pack/` は `zip.ts` と同じ「層の外の道具」として置ける。
- `RawPatch.ts` は patch宣言のデータ型（8宣言）と patch適用エンジン（11宣言）が同居している。`parseCommon.ts` も、型マッチ規則・数値リテラル・シンボル判定という互いに無関係な3つの主題を「Common」の名前で束ねている。どちらもファイル分割で片づく。
- `src/loader/inProgressObjects.ts` と `axisVariants.ts`（生成器）は、`GeneratedObjectDefs` という1つの形で答えるところまで揃っており、配置としては妥当。問題は名前規約の export だけ。

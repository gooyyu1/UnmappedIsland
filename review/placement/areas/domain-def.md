# domain-def

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/domain/ActionDef.ts | 5 | 4 | 0 | 1 | 0 | 0 |
| src/domain/CombinationDef.ts | 8 | 5 | 1 | 2 | 0 | 0 |
| src/domain/GeneratedTypes.ts | 12 | 8 | 2 | 1 | 0 | 1 |
| src/domain/InteractionDef.ts | 15 | 10 | 2 | 3 | 0 | 0 |
| src/domain/NameRegistry.ts | 9 | 5 | 3 | 1 | 0 | 0 |
| src/domain/ObjectDef.ts | 35 | 24 | 7 | 4 | 0 | 0 |
| src/domain/PropertyDef.ts | 69 | 44 | 11 | 7 | 5 | 2 |
| src/domain/RecipeDef.ts | 21 | 14 | 3 | 4 | 0 | 0 |
| src/domain/Requirement.ts | 8 | 7 | 1 | 0 | 0 | 0 |
| src/domain/SlotDef.ts | 28 | 18 | 5 | 5 | 0 | 0 |
| src/domain/StackOrderDef.ts | 9 | 7 | 1 | 0 | 1 | 0 |
| src/domain/TypeMatchRule.ts | 13 | 10 | 2 | 0 | 0 | 1 |
| src/domain/WorldCodex.ts | 22 | 12 | 2 | 7 | 1 | 0 |
| src/domain/WorldVocabulary.ts | 63 | 7 | 55 | 1 | 0 | 0 |
| **合計** | **317** | **175** | **95** | **36** | **7** | **4** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| ActionDef | メニューから選ぶ操作の宣言。 | （なし） |
| CombinationDef | カードを重ねる操作の宣言と、相手が噛み合うかの判定。 | `with`（`acceptsDragged`・`triggerReading` と同じことを3通りで公開している） |
| GeneratedTypes | 生成型のグローバルIDと軸座標の相互引き。 | `baseAlong`（誰も引いていない） |
| InteractionDef | 操作1つの宣言を持ち、条件・時間・効果の順で実行する。 | `requirementDeclarations`（`unmetRequirement` と別口の読み上げ）、`InteractionTriggerReading`（下位クラス2種の形の合併が基底ファイルに居る） |
| NameRegistry | 名前とIDの相互引き。 | クラス全体（ゲームの語彙を1つも知らない汎用表） |
| ObjectDef | オブジェクト型1つの宣言をまとめて持ち、ローカル/グローバルIDで引かせる。 | `artSuffixes()`（絵のファイル名検査のための口） |
| ObjectDefTable | グローバルIDで ObjectDef を引く表。 | （なし） |
| PropertyDef | **プロパティ1つの宣言を持ち、かつ実行時の値に対する判定・適用を行う。**（接続詞＝責務2つ） | `checkRangeEvents`・`rollInitialValue`・`isExhausted`・`ratioOf`・`stageOnBarAt`・`inheritedContribution`（いずれも「今の値」の話。下表参照） |
| GaugeDef / PropertyRange / PropertyStage | ゲージの端／値域／段の宣言。 | （なし） |
| RecipeDef | レシピ1つの工程と解放条件の宣言。 | `icon`（絵の話）、`unmetUnlockRequirement`（`unlock` の素通し） |
| Requirement / Requirements | 要件の宣言と、最初に落ちた要件の特定。 | （なし） |
| SlotDef | スロット1つの受け入れ規則と枠数の宣言。 | `autoPlacement`/`manualPlacement`（`allows()` と二重）、`hasPutInDuration`/`acceptsAtMostOne`（テストしか読まない） |
| StackOrderDef | 重ね順の宣言。 | `insertionIndexOf`（実行時の WorldObject 列への挿入位置決め） |
| TypeMatchRule | 型の指定（タグ or 型名）と、その型に当たるかの判定。 | `acceptSpec`（宣言をYAMLの形へ書き戻す） |
| WorldCodex | 全定義とその索引の入口。 | `baseOf`/`isGenerated`/`variationsOf`/`tryResolveBecome`（`generatedTypes` への素通し）、`singletonGlobalIds`（ObjectDefTable の走査） |
| WorldVocabulary | コードがYAMLの単語へ寄せている依存の一覧。 | （なし。1文で書けている） |

## 明細（判定2以上）

### PropertyDef.ts（重点）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/domain/PropertyDef.ts#PropertyDef | `rollInitialValue(rng)` | 所属 | 4 | 「生成時にこの値をいくつで始めるか」は値の初期化そのもので、唯一の呼び手は `PropertyValue` の構築子。 | `PropertyValue`（構築子） | `initialValueRange`（private）を公開しないため。公開すれば `PropertyValue` が自分で抽選できるが、宣言の格納形が外へ出る | |
| src/domain/PropertyDef.ts#PropertyDef | `checkRangeEvents(number, owner)` | 所属 | 4 | 引数が `PropertyValue` の全状態（`_number` と `owner`）で、やることは `owner.applyActiveEffect` の実行——定義が実行時の世界を書き換えている。 | `PropertyValue`（`add`/`tick` の中） | `onMax`/`onMin`（既定クランプで補完済みの実効的な効果、private）を公開しないため | |
| src/domain/PropertyDef.ts#PropertyDef | `isExhausted(rawValue)` | 所属 | 4 | 「尽きたか」は今の値の状態で、唯一の呼び手は `PropertyValue.exhaustedStage`。 | `PropertyValue` | `declaredOnMin`（既定補完**前**の、著者が書いた宣言。private）を公開しないため。`onMin` は補完済みなので代用できない | |
| src/domain/PropertyDef.ts#PropertyDef | `stageOnBarAt(effectiveValue)` | 所属 | 4 | 値に依存しない `stageBoundaries()`（刻み）と値依存の段判定が1つの口に混ざっており、呼び手は `PropertyValue.stageOnBar` だけ。 | 刻みは `PropertyDef` に値なしの口として残し、段の特定は `PropertyValue` へ | `spanOf`/`stageBoundaries`（private）を公開しないため。両者は宣言だけで決まるので本来は値を渡す必要がない | ✓ |
| src/domain/PropertyDef.ts#PropertyDef | `ratioOf(value)` | 所属 | 4 | 中身は `(clamp(v)-min)/(max-min)` で、`PropertyRange` の算術そのもの。 | `PropertyRange` | `range` が `undefined` になりうる分岐をここで吸収しているため。`PropertyRange` へ移すと undefined 判定が呼び出し側（`PropertyValue.ratio`・`stageBoundaries`）へ散る | |
| src/domain/PropertyDef.ts#PropertyDef | `inheritedContribution(owner)` | 所属 | 5 | `inherit`・`globalId` とも public で、**private を1つも読まない**——`owner` の祖先を辿るだけの処理が定義側に居る理由が無い。 | `PropertyValue.getEffectiveValue`（唯一の呼び手）または `WorldObject` | | |
| src/domain/PropertyDef.ts#PropertyDef | `declaredOnMax` | 可視性 | 5 | 構築子で代入されるだけで、`src`・`tests` のどこからも読まれていない（`declaredOnMin` は `isExhausted` が読む）。 | (なし＝読み手が居ない) | | |
| src/domain/PropertyDef.ts#PropertyDef | `hasRangeEventMatching(matches)` | 所属 | 3 | public な `rangeEvents()` に `.some()` を掛けただけで、何も隠していない。唯一の呼び手は codex-viewer。 | `src/codex-viewer/describe/describeObjectDef.ts` | | |
| src/domain/PropertyDef.ts | `AlertDirection` | 可視性 | 3 | `export` だが `src`・`tests` のどこからも参照されていない。 | 非exportへ | | |
| src/domain/PropertyDef.ts#PropertyDef | `fallbackStage`, `deriveAlertDirection`, `stageBoundaries`, `spanOf` | 所属 | 3 | 構築子・`stageAt`・`stageOnBarAt` のためだけの private ヘルパー（`stageBoundaries`/`spanOf` は値に依存しないのに毎回組み立てる）。 | 同クラス内で可（位置は妥当） | | |
| src/domain/PropertyDef.ts | `defaultClampTo` | 所属 | 3 | 構築子専用のモジュール内ヘルパー。 | 同ファイル内で可 | | |
| src/domain/PropertyDef.ts#PropertyDef | `stageAt`, `alertOf`, `isInStage` | 所属 | 2 | 値を引数に取る形は `PropertyValue` 以外（`analysis/balanceTables`・世界YAMLのテスト）も使うので、定義側の口として要る。 | | | |
| src/domain/PropertyDef.ts#PropertyDef | `initialValueReading`, `artSuffixes()` | 可視性 | 2 | 格納形（`initialValueRange`・`stages[].art`）を出さずに済ませる「問いの形」の読み上げ口。 | | | |
| src/domain/PropertyDef.ts#PropertyDef | `hasStageArt`, `declaredOnMin` | 所属 | 2 | ローダの検証（`RawObjectDef`）と `isExhausted` のためだけに、構築子で事前計算・別保持している。 | | | |
| src/domain/PropertyDef.ts#PropertyDef | `globalId` | 所属 | 2 | 同一性と密配列の添字のため。 | | | |
| src/domain/PropertyDef.ts | `GAUGE_ENDS`, `InitialValueReading`, `GaugeDef.hasDirection` | 所属 | 2 | 型の実行時列挙（ローダの検証用）と、読み上げ用の投影型。 | | | |

**PropertyDef の全体像**: 判定4の5件は、いずれも「**引数に値（と owner）を受け取って、今の状態について答える／実行する**」という同じ形をしている。守っているものも4種類しかない——`initialValueRange` / `onMax`・`onMin` / `declaredOnMin` / `spanOf`・`stageBoundaries`。つまり `PropertyDef` は「宣言を持つ」責務のほかに「実行時の値を判定して WorldObject を書き換える」責務を抱えており、後者は `PropertyValue` 側に居るのが自然。`inheritedContribution` に至っては private を1つも読んでおらず、守るものが無いまま Def 側に置かれている（＝5）。

### その他のファイル

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/domain/WorldCodex.ts#WorldCodex | `admitsBroughtObjects(slotDef)` | 所属 | 4 | 引数も答えも `SlotDef` の話だが、判定に全型の走査が要るため Codex 側に居る。 | `SlotDef`（全型を走査する索引を渡す形へ） | `SlotDef` から `ObjectDefTable` への逆参照を作らないため | ✓ |
| src/domain/StackOrderDef.ts#StackOrderDef | `insertionIndexOf(obj, members)` | 所属 | 4 | 実行時の `WorldObject` 列を走査する挿入位置決めで、唯一の呼び手は `ObjectStack`。 | `ObjectStack` | `propertyGlobalId`/`ascending`（private）を公開せずに並べ替えるため。ただし `reading` getter が同じ2値を既に公開しており、盾になっていない | |
| src/domain/TypeMatchRule.ts#TypeMatchRule | `acceptSpec(names)` | 所属 | 5 | 宣言をYAMLの形へ書き戻す処理で、呼び手は `src/loader/inProgressObjects.ts` のみ。`reading` が同じ2値を公開済みなので何も守っていない。 | `src/loader/inProgressObjects.ts` | | ✓ |
| src/domain/GeneratedTypes.ts#GeneratedTypes | `baseAlong(def, axis)` | 可視性 | 5 | public だが `src`・`tests` のどこからも呼ばれていない。 | (なし＝呼び手が居ない) | | ✓ |
| src/domain/WorldCodex.ts#WorldCodex | `baseOf`, `isGenerated`, `variationsOf`, `tryResolveBecome` | 可視性 | 3 | `generatedTypes` フィールド自体が public なので、同じ問いへの口が2通りある（CodeStructure.md の「素通しを生やすと線がぼやける」に当たる）。 | `GeneratedTypes` へ一本化 | | |
| src/domain/WorldCodex.ts#WorldCodex | `singletonGlobalIds()`, `objectDefNamesWithTag()` | 所属 | 3 | 中身は `this.objects` の全走査で、Codex の他のフィールドをほぼ使わない。 | `ObjectDefTable` | | |
| src/domain/WorldCodex.ts#WorldCodex | `symbolicPropertyIds` | 所属 | 3 | `symbolicProperties` getter 専用の遅延キャッシュ。 | 同クラス内で可 | | |
| src/domain/WorldCodex.ts#WorldCodex | `recipeCategoryTagIds`, `symbolicProperties` | 所属 | 2 | 全型走査の結果をロード時／初回に畳んだ索引で、宣言そのものではない。 | | | |
| src/domain/ObjectDef.ts#ObjectDef | `slotDefs`(public) と `enumerateSlotDefs()` | 可視性 | 3 | 同じ配列に口が2つあり、しかも `propertyDefs` は private＋`enumeratePropertyDefs()` という逆の作りで非対称。 | どちらか一方へ寄せる | | |
| src/domain/ObjectDef.ts#ObjectDef | `artSuffixes()` | 所属 | 3 | `tryGetPropertyDef(artByStagePropertyGlobalId)?.artSuffixes()` の素通しで、呼び手は絵のファイル名検査テストのみ。 | `tests/art/objectArt.test.ts` 側で組み立てる | | |
| src/domain/ObjectDef.ts#ObjectDef | `placementSlots` | 所属 | 3 | `placementSlotDefs()` 専用に構築子で作る事前索引。 | 同クラス内で可 | | |
| src/domain/ObjectDef.ts#ObjectDef | `propertyLayout`, `slotLayout` | 可視性 | 2 | ローカル/グローバルID対応の**格納形**が public で、`WorldObject` が `toLocal` を直に叩いている（問いの形になっていない）。 | | | |
| src/domain/ObjectDef.ts#ObjectDef | `globalId`, `visibleSlotGlobalIds`, `artByStagePropertyGlobalId` | 所属 | 2 | 同一性のID、および画面のために宣言から畳んだ問いの形の口。 | | | |
| src/domain/ObjectDef.ts#ObjectDefTable | `tryGet`, `[Symbol.iterator]` | 所属 | 2 | `get` の例外なし版と反復用の口。 | | | |
| src/domain/SlotDef.ts#SlotDef | `autoPlacement`, `manualPlacement` | 可視性 | 3 | `allows(placement)` という口があるのに格納形も public で、`manualPlacement` は `src` 内に読み手が居ない（テストのみ）。 | private化し `allows()` に一本化 | | |
| src/domain/SlotDef.ts#SlotDef | `hasPutInDuration`, `acceptsAtMostOne` | 可視性 | 3 | public だが読み手は `tests/world-codex/putInDuration.test.ts` だけ。 | テスト側で `putInDurationReading`/`cellsToKeep` から導く | | |
| src/domain/SlotDef.ts | `ANY_CELL` | 所属 | 3 | `sharedCell` 未指定時の既定値としてのみ使うモジュール内定数。 | 同ファイル内で可 | | |
| src/domain/SlotDef.ts#SlotDef | `cellsToKeep`, `cellsReading`, `putInDurationReading` | 所属 | 2 | `cellDefs`/`sharedCell`/`putInDuration` の格納形を出さずに済ませる問いの形の口。 | | | |
| src/domain/RecipeDef.ts | `RECIPE_AXIS`, `IN_PROGRESS_TAG` | 配置 | 3 | 「コードがYAMLの単語へ寄せている依存」なのに、その一覧である `WorldVocabulary` に載っていない。 | `src/domain/WorldVocabulary.ts` | | |
| src/domain/RecipeDef.ts#RecipeDef | `unlock`(public) と `unmetUnlockRequirement()` | 可視性 | 3 | `unmetUnlockRequirement` は `unlock?.firstUnmet(...)` の素通しで、`unlock` 自体も public のため codex-viewer が `unlock!.declarations` を直に読んでいる。 | どちらか一方へ寄せる | | |
| src/domain/RecipeDef.ts#RecipeDef | `icon` | 配置 | 2 | 絵のファイル識別子が世界の定義に直接入っている（CodeStructure.md では「どのファイルがどの絵か」は素材側）。 | `src/art/` 側での対応付け | | |
| src/domain/RecipeDef.ts | `RecipeStepDef.requires`, `RecipeDef.requires` | 所属 | 2 | 3階層で同名の畳み込み（`RecipeRequirementDef` → `RecipeStepDef` → `RecipeDef`）。 | | | |
| src/domain/InteractionDef.ts#InteractionDef | `requirementDeclarations` | 可視性 | 3 | `unmetRequirement` と同じ private フィールドへの2つ目の口で、読み手は codex-viewer のみ。 | `Requirements`（`declarations` は既に public） | | |
| src/domain/InteractionDef.ts | `InteractionTriggerReading` | 配置 | 3 | 下位クラス2種の形の合併が基底ファイルに居るため `InteractionDef.ts` → `ActionDef.ts` の型importが生じ、しかも宣言が import 群の途中に挟まっている。 | 型だけの共通ファイル、または import 群の後ろへ | | |
| src/domain/InteractionDef.ts#InteractionDef | `read`, `durationReading` | 所属 | 2 | `effect`/`duration` を出さない読み上げ口（CodeStructure.md 5節の `EffectReader` の形）。 | | | |
| src/domain/ActionDef.ts | `ShowMenuMode` | 配置 | 3 | 基底の `InteractionTriggerReading` が下位クラスのこの型を輸入しており、定義位置が上下逆。 | `InteractionDef.ts` または共通の型ファイル | | |
| src/domain/CombinationDef.ts#CombinationDef | `with` | 可視性 | 3 | public だが `src` 内の読み手が無く（`trigger.with` は `triggerReading` の方）、`acceptsDragged`・`triggerReading` と合わせて同じ規則に口が3つある。 | private化 | | |
| src/domain/CombinationDef.ts#CombinationDef | `acceptsDragged(draggedDef)` | 所属 | 3 | `with.matches(draggedDef)` の薄い包み。 | 呼び出し側で `TypeMatchRule.matches` を使う | | |
| src/domain/CombinationDef.ts#CombinationDef | `acceptedCount(...)` | 所属 | 2 | 宣言（`with`・`allowMultiple`）から実行時の候補列を数える処理で、定義と実行の境目にある。 | | | |
| src/domain/NameRegistry.ts | `NameRegistry`（クラス全体） | 配置 | 3 | ゲームの語彙を1文字も知らない汎用の文字列インターン表で、`src/domain/` に居る意味論的な理由が無い（利用者が近いだけ）。 | `src/util/` | | |
| src/domain/NameRegistry.ts#NameRegistry | `getId`/`tryGetId`, `tryGetName` | 所属 | 2 | 例外あり／なしの対を4本持つのはプログラム上の都合。 | | | |
| src/domain/GeneratedTypes.ts | `keyOf` | 所属 | 3 | `byKey` の鍵を作るモジュール内ヘルパー。 | 同ファイル内で可 | | |
| src/domain/GeneratedTypes.ts | `NO_AXIS_VALUE`, `GeneratedTypes.byKey` | 所属 | 2 | 「軸の値なし」の番人文字列と、逆引き専用の二重索引。 | | | |
| src/domain/TypeMatchRule.ts#TypeMatchRule | `key`, `TypeMatchReading` | 所属 | 2 | Map の鍵にするための文字列化と、private 2値の読み上げ投影。 | | | |
| src/domain/StackOrderDef.ts#StackOrderDef | `reading` | 所属 | 2 | private 2値をそのまま公開する投影（`insertionIndexOf` の盾を無効化している側面あり）。 | | | |
| src/domain/Requirement.ts#Requirement | `reasonName` | 所属 | 2 | 条件が落ちた理由を画面へ出すための表示用の名前。 | | | |
| src/domain/WorldVocabulary.ts#WorldRuleVocabulary | クラス全体 | 配置 | 3 | この世界のYAML固有の語43個をエンジン層の `src/domain/` が抱えている（利用者が `domain/views`・`domain/generation`・`analysis` と近いだけ）。設計理由はクラスの doc に明記されているので歪みは意図的。 | 世界別の語彙として `src/assets/` 側の宣言から生成 | | |
| src/domain/WorldVocabulary.ts | `PROGRESS_PROPERTY` 他2件、`EngineVocabulary` の9フィールド、`WorldRuleVocabulary` の43フィールド | 所属 | 2 | 「コードがYAMLの単語へ寄せている依存の一覧」という、プログラム上の都合で1箇所に集めた表。 | | | |

## 移動先が書けなかったもの

| 名前 | 欠けている概念 |
|---|---|
| `PropertyDef.declaredOnMax` | 読み手が居ない。`declaredOnMin` と対で「著者が書いたか／既定の補完か」を区別する概念があるのに、上限側だけその区別を使う場所が無い。**「宣言された効果」と「補完後の効果」を分ける型**（例: `RangeEvent { declared, effective }`）があれば、対称性を保ったまま両方に読み手が付く。 |
| `GeneratedTypes.baseAlong` | 呼び手が居ない。「ある軸に沿って素の型へ戻る」という問いを誰も持っていない。 |

## ファイル配置（層=配置）についての所見

14ファイルはすべて `src/domain/` 直下で、CodeStructure.md の「世界＝`src/domain/`」に沿う。ただし直下が平らすぎて、
性格の違う3種が混ざっている: (a) 宣言そのもの（`ObjectDef`・`PropertyDef`・`SlotDef`・`RecipeDef`）、
(b) 索引・語彙（`WorldCodex`・`NameRegistry`・`GeneratedTypes`・`WorldVocabulary`）、
(c) 値オブジェクト（`TypeMatchRule`・`Requirement`・`StackOrderDef`）。`src/domain/generation/`・`src/domain/views/`
というサブディレクトリが既にある以上、`src/domain/def/` を切る余地はある。

個別には2点。`NameRegistry` はゲームの語彙を一切知らない汎用の表で、`src/util/` が自然（判定3）。
`RecipeDef.icon` と `PropertyStage.art` は絵のファイル識別子で、CodeStructure.md が「どのファイルがどの絵かは素材（`src/art/`）」
と書いている線と一致していない——ただし宣言YAMLに書かれている値をそのまま保持しているだけなので、
歪みは `src/art/` 側の対応付けが薄いことの裏返し。

# loader / codex — 判定3の再点検

対象は `private` メソッド・`private` getter（担当範囲に0件）・export されていないモジュール関数の
**169本**。第1波で判定1・2としたものも含む。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/asset-pack/AssetPack.ts | 6 | 4 | 2 |
| src/asset-pack/install.ts | 1 | 1 | 0 |
| src/asset-pack/zip.ts | 3 | 3 | 0 |
| src/loader/RawObjectDef.ts | 3 | 2 | 1 |
| src/loader/RawPatch.ts | 10 | 1 | 9 |
| src/loader/RawTrait.ts | 1 | 0 | 1 |
| src/loader/WorldCodexYamlLoader.ts | 3 | 3 | 0 |
| src/loader/axisVariants.ts | 4 | 1 | 3 |
| src/loader/inProgressObjects.ts | 2 | 0 | 2 |
| src/loader/parseActionsAndCombinations.ts | 1 | 0 | 1 |
| src/loader/parseActiveEffects.ts | 20 | 10 | 10 |
| src/loader/parseCommon.ts | 1 | 1 | 0 |
| src/loader/parseConditions.ts | 6 | 3 | 3 |
| src/loader/parseGeneration.ts | 5 | 0 | 5 |
| src/loader/parsePassives.ts | 2 | 0 | 2 |
| src/loader/parseProperties.ts | 5 | 1 | 4 |
| src/loader/parseRecipes.ts | 2 | 0 | 2 |
| src/loader/parseSlots.ts | 3 | 2 | 1 |
| src/loader/yamlMapping.ts | 2 | 2 | 0 |
| **loader 小計** | **80** | **34** | **46** |
| src/codex-viewer/CodexView.ts | 4 | 3 | 1 |
| src/codex-viewer/balancePage.ts | 22 | 18 | 4 |
| src/codex-viewer/craftingGraph.ts | 2 | 1 | 1 |
| src/codex-viewer/main.ts | 11 | 10 | 1 |
| src/codex-viewer/networkLayout.ts | 7 | 7 | 0 |
| src/codex-viewer/networkPage.ts | 8 | 7 | 1 |
| src/codex-viewer/pages.ts | 21 | 18 | 3 |
| src/codex-viewer/describe/conditionTokens.ts | 1 | 1 | 0 |
| src/codex-viewer/describe/describeEffect.ts | 1 | 0 | 1 |
| src/codex-viewer/describe/describeObjectDef.ts | 2 | 0 | 2 |
| src/codex-viewer/describe/describePassive.ts | 2 | 1 | 1 |
| src/codex-viewer/describe/describeProperty.ts | 1 | 0 | 1 |
| src/codex-viewer/describe/describeRecipe.ts | 2 | 0 | 2 |
| src/codex-viewer/describe/describeRequirement.ts | 1 | 0 | 1 |
| src/codex-viewer/describe/describeSlot.ts | 1 | 0 | 1 |
| src/codex-viewer/describe/effectQueries.ts | 3 | 2 | 1 |
| **codex 小計** | **89** | **68** | **21** |
| **合計** | **169** | **102** | **67** |

## 主語が他にあるヘルパー

同じ B・同じ不足・同じ阻害要因のものは1行にまとめた（ヘルパー欄に複数名）。

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| parseActiveEffects.ts | `parseActiveTargetRoot` `parseObjectTargetRoot` `parseSpawnTargetRoot` `parseMoveSubject` `parseMoveDestination` | `ReferenceRoot`（domain） | 「**この評価文脈でこのrootは解決先を持つか**」を問う口。5本とも switch か allowlist で同じ事実を書き分けている | **消える。** 判定の本体は全部消え、YAMLの文字列→rootの読み取りだけが残る | 無い。同じ形の述語 `ObjectRef.needsInteraction()` が既に domain に在り、`parseMove` はそれを呼んでいる——**domain に置けないという理屈は既に破れている** |
| parsePassives.ts | `parsePassiveOperationInto` | 同上 | 同上（self/parent/child/ancestor を許し agent を黙って `continue` する switch） | 同上 | 同上。`agent` を例外送出ではなく読み飛ばしている点は、5本の中でここだけ挙動が違う |
| describe/effectQueries.ts | `writesTo` | 同上 | 「`target=self` の効果は宣言元自身のプロパティしか指さない」という root の意味論。**ビューア側にも同じ知識が出ている** | 消える | 無い（純粋な述語で表示の語彙を持たない） |
| parseSlots.ts | `parsePlacement` | `Placement`（domain/SlotDef.ts） | union 型に対応する**値リスト**。`ALERT_LEVELS`・`GAUGE_ENDS` は domain が値リストを export していて loader の `oneOf` がそれを使うのに、`Placement` だけ loader が `PLACERS` を再宣言している | **消える。** `PLACEMENTS` を domain へ置けば `oneOf` 1行になる | 無い（既存の2例が反例） |
| parseConditions.ts | `parseConditionValues` `parsePropertyComparison` | `ConditionOp`（domain/ConditionNode.ts） | 「この演算子は複数値を取るか」。`op === 'in' \|\| op === 'not_in'` が2本に**同じ形で二度**書かれている。加えて `PROPERTY_OPS` が値リストの再宣言 | 検査は消える。YAMLの値ノードの読み分けは残る | 無い |
| parseConditions.ts | `parseConditionLeaf` | `ConditionNode` | 「主語（prop/slot/無し）ごとに使える演算子」の表。doc コメントに表として書いてあるが、コードは loader 側にしかない | 消えない（YAMLのキー走査が本体）。表だけが domain へ移る | 主語と演算子の組を表す型が domain に無い |
| parseGeneration.ts | `parseAxis` `parseGeneratorLayer` `parseVariants` `parseLocationType` `parseGenerationScope` | `AxisDef` `GeneratorLayer` `LocationVariantDef` `LocationTypeDef` `AxisPreference` `AxisLimit` `GenerationScopeDef` `GuaranteeDef` | 自分の不変条件。`parseGeneratorLayer` と `parseGenerationScope` は **`new` した後に B 自身の getter（`layer.octaves`・`scope.interiorBias` 等）で検査**していて、第1波が `parseProp` で見つけた形とまったく同型 | 検査は消える（各コンストラクタへ）。YAMLの読み取りは残る | 例外型が `YamlLoadError` で、文言に YAML 上の文脈文字列と節番号が入る |
| parseProperties.ts | `parseGauge` `parseOptionalRangeEvent` `parseStage` | `PropertyDef` `PropertyStage` | 「gauge には range が要る」「on_max/on_min には range が要る」「シンボル型の段に min は書けない」。どれも B の成立条件で、B の外から `range` を引数で持ち回って確かめている | 検査は消える。`range` を引数に持ち回る必要も消える | 同上 |
| parseProperties.ts | `parsePropertyTags` | `NameRegistry` | 「未宣言ならエラー」。`getId` が既に例外を投げるのに、文言を差し替えるために `tryGetId`＋自前 throw をしている | 消える（例外の文言を受け取れる `getId` があれば） | 例外型と文言（節番号つき）が loader のもの |
| parseRecipes.ts | `parseRequirement` `parseStep` | `RecipeRequirementDef` `RecipeStepDef` | 不変条件（count≧1、requires≧1件、duration>0） | 検査は消える | 同上 |
| parseActiveEffects.ts | `parsePickList` `parseTransfer` `parseSpawn` `parseMove` | `PickCandidateDef` `TransferEffect` `SpawnEffect` `MoveEffect` | 不変条件（weight必須、to_amount>0、count≧1の整数、rangeイベント内でagent/instrumentを指せない） | 検査は消える | 同上。`parseMove` だけは既に `subject.needsInteraction()` を呼んでおり、**この形が可能なことを自分で示している** |
| parsePassives.ts | `buildGate` | `PassiveEffectGate` | 「プロパティ名と段名は組で1つ」。片方だけを渡された場合に段を捨てる判断を外がしている | 消える（`PassiveEffectGate` が組で受ければ） | 同上 |
| parseActionsAndCombinations.ts | `parseInteractionBody` | `InteractionDef` | `ActionDef`/`CombinationDef` が共有する中身（requirements・effect・duration）を組み立てる口。戻り値の `InteractionBody` は `InteractionDef` の3フィールドの写しで、**プログラム上の都合だけで在る型** | 消えない（YAMLの読み取りは残る）。中間の型は消える | `InteractionDef` の共通部分を表す型が domain に無い |
| RawPatch.ts | `apply` `addValue` `setValue` `removeValue` `descendToKey` | `RawObjectDef` | 「自分の宣言ノードを patch で書き換え、書き換えたらフィールドを取り直す」。**取り直し（`def.readFields()`）を呼び出し側が覚えている**——クラスのコメントは「取り直しはこのクラス自身が引き受ける」と書いているのに | **消える。** `RawObjectDef.applyPatch(...)` があれば `node`・`readFields` を private に戻せる | patch のパス降下とマッチ判定が RawPatch.ts 側にあり、そこからノードへ直接触る構造 |
| RawPatch.ts | `matches` `descendToMap` `descendToSeq` `keyHint` | `yamlMapping.ts` | 「パスでノードを降りる」「書いたキーだけを見る部分一致」「持っているキーを列挙して助言する」——どれも YAML アクセス一般の話で patch の語彙を持たない | 消える（ファイルを跨いで移るだけ） | 無い |
| RawObjectDef.ts / parseActiveEffects.ts | `concatSeqs` `oneOrMany` | 同上 | 「2つの配列ノードを連結する」「1個でも配列でも受ける」 | 消える | 無い |
| RawTrait.ts | `readFields` | 共通の宣言本体（**存在しない型**） | `RawObjectDef.readFields` と同じ11キーを読む。コメント自身が「読む側を2箇所に置かない」と書いているのに2箇所にある | 消える（`RawDeclarationBody` を作れば） | `RawObjectDef` は patch 後に取り直すため `node` を持ち続け、`RawTrait` は1回読んで捨てる——ライフサイクル差を吸収する型が無い |
| axisVariants.ts | `readAxes` `variantBody` `valueTraitNames` | `RawObjectDef` | 「自分の `variation_axes` を読む」「自分の宣言を写して一部のキーを落とす」「自分が `traits` しか宣言していないか」。**11キーは `readFields` が自分で読むのに、`variation_axes` だけ外から読まれている** | 消える（3本とも `RawObjectDef` のメソッドで書ける） | `node` が public であることに依存しており、上の `applyPatch` と同じ開口を使っている |
| inProgressObjects.ts | `inProgressObjectDef` `requirementCells` | `RecipeDef` | 「全工程の所要時間の合計」と「型ごとに合計した要求数」。前者は `src/analysis/craftingSteps.ts` にも同じ `reduce` がある | 合計の計算だけ消える。YAML の組み立ては残る | `RecipeDef` は3階層すべてに `requires()` を持っており、この種の問いを持てないわけではない |
| AssetPack.ts | `artUnder` `mediaType` | `src/art/`（objectArt / backgroundArt） | 「どのファイルが絵か」（拡張子 png/webp、名前は拡張子を落としたもの）。**2本が同じ拡張子リストを別々に持っている** | 消える（パックはパス一覧と中身だけを答える） | `files` と `url()` が private で、パス→中身／URL を引く口が外に無い |
| CodexView.ts | `propertyTexts` | `Localization` | 「持ち主が分からないときは default だけを引く」。`locale.object(objectName ?? '')` の `?? ''` がその規約。private なので `pages.ts` の `propertiesHtml` は同じ式を自前で書き直している | 消える（`locale.prop(owner \| undefined, name)` があれば） | 無い |
| pages.ts | `propertiesHtml` | 同上 | 同上（上の private が届かないための写し） | 消える | 無い |
| pages.ts | `slotCellsHtml` | `SlotDef` | `!slotDef.autoPlacement` を直接見ている。`SlotDef.allows(placement)` が既に在るのに使っていない | 判定は消える。注記の文言は残る | 無い |
| pages.ts | `variantsSection` | `LocationTypeDef` + `Localization` | 「土地の型の亜種は `location_texts` が名前を持つ」という**ことばの規則**。`CodexView.locationTypeOf`（generation の逆引き）とセットで使う | 消えない（表の組み立てが本体） | `Localization` を純粋な対応表のまま保つため |
| describe/describeObjectDef.ts | `matchingInteractions` | `ObjectDef` | 「述語に当てはまる宣言（actions・combinations）を列挙する」。**`PropertyDef.hasRangeEventMatching(matches)` は domain に在るのに、`ObjectDef` には対応物が無い**——同じ問いの片側だけが domain に居る | 消える。`creates`・`usesInRecipes`（第1波の判定3）も同時に畳める | 無い。domain 側に同型の先例がある |
| describe/describeObjectDef.ts | `describeMatchingRangeEvents` | `PropertyDef` | 「述語に当てはまる range イベントだけを名前つきで並べる」——`hasRangeEventMatching` と `rangeEvents()` を外で組み合わせている | 書き出しは残る。二度走査（`hasRangeEventMatching` の後に `rangeEvents()` を回す）は消える | 層のテスト（VIEWER_FREE）が定義に表示の語彙を持たせない |
| describe/describeProperty.ts | `stageTokens` | `PropertyStage` | 自分がどのプロパティの段かを知らないため、`propertyGlobalId` を外から持ち回っている。「シンボル型の段は名前が値そのもの」の再判定もここ | 引数の持ち回りは消える。書き出しは残る | 同上 |
| describe/describeSlot.ts / describeRecipe.ts / describeRequirement.ts / describeEffect.ts / describePassive.ts | `cellTokens` `describeRecipeStep` `recipeRequirementTokens` `requirementTokens` `objectRefTokens` `gateTokens` | `CellDef` `RecipeStepDef` `RecipeRequirementDef` `Requirement` `ObjectRefReading` `GateReading` | 自分を書き表す口。第1波が判定4にした `describeXxx` 5本の**内側**にも同じ形が6本ある | `describe` を定義側へ移せば一緒に移る（消えるのではなく引っ越す） | 同上（層のテスト） |
| craftingGraph.ts | `countLabelOf` | `CraftingStep` の出力（src/analysis） | 「個数が一定か・その値は何か」。`counts` の走査は解析の問いで、`×N` の書式だけが表示 | 走査は消え、`×N` の1行だけが残る | 辺に生の個数を持たせず文字列に畳んでいる |
| networkPage.ts | `collectHighlight` | `CraftingNetwork` | 「あるノードの上流・下流の到達集合」。隣接表の構築＋BFSで、描画の話ではない。隣接表の構築は `networkLayout.buildNeighbors` にも別実装で在る | 消える（`CraftingNetwork` の問いになる） | 無い |
| balancePage.ts | `placeHtml` `menuHtml` | `ChainRoute`（src/analysis/balanceTables） | 「数えられる経路か／使える経路か」。`!untimed`・`!untimed && !blocked` の絞り込みが**このファイルだけで3箇所**（L147・L148・L197）、さらに `wireBalanceMenu`（L559）に4箇所目。**`menuHtml` は絞り込み後の添字を `<option value>` に埋め、`wireBalanceMenu` が同じ絞り込みを再現して解釈する**ため、2箇所が暗黙に一致していないと選択が別の経路を指す | 消える（`usableRoutes()` / `countedRoutes()` を B に置けば） | 無い |
| balancePage.ts | `gapLabel` | `Gap`（同上） | `Gap.label` は文字列1つで、それが型の識別子なのかタグ指定なのかを持たない。ビューアは `view.objectDef(label) === undefined` で**名前を引いて種類を推測している**。同じファイルの `RoutePrerequisite` は `label` と `objectName` を別々に持っており、同じ解析モジュールが同じものを二通りにモデル化している | 消える（`Gap` が `objectName` を持てば） | 集計時（balanceTables.ts L547-552）に `prerequisite.label` でグループ化して `objectName` を捨てている |
| balancePage.ts | `placeLabel` | `PlaceBalance`（同上） | 「この場所は型か、島全体か」。`name === WHOLE_ISLAND` の比較で判別している（`PlaceBalance` は `location?.name ?? WHOLE_ISLAND` で作られ、そこで区別が消える） | 消える | 上と同じ「作るときに区別を落としている」形 |
| main.ts | `renderRoute` | `CodexView` の `objectHref`/`tagHref`/`slotHref`/`propertyHref` | URLの語彙。組み立てが `CodexView`、解釈が `renderRoute` に割れていて、両者が暗黙に一致していないとリンクが死ぬ | 消えない（分岐は残る）。組み立てと解釈が1つのモジュールに揃う | 無い |

## 同じ B に対して複数の A が補っているもの

**優先度順**。上ほど「B へ1つ足せば消える箇所」が多い。

### 1. `src/domain/ReferenceRoot.ts` — 9箇所（loader 8 + codex 1）

「**この文脈でこの root は解決先を持つか**」という同じ事実が、9箇所に別々の形で書かれている。

| A | 形 |
|---|---|
| `parseConditions.parseSubjectRoot`（export） | switch＋`allowedRoots` の照合 |
| `parseConditions` の `ACTION_/COMBINATION_/RECIPE_/PASSIVE_CONDITION_ROOTS` | 集合の定数4本 |
| `parseActiveEffects.parseActiveTargetRoot` | switch＋`allowInstrument`/`selfOnly` の旗2つ |
| `parseActiveEffects.parseObjectTargetRoot` | 上を呼んで `ancestor` を後から弾く |
| `parseActiveEffects.parseSpawnTargetRoot` | 別の union（`SpawnTargetRoot`）への switch |
| `parseActiveEffects.parseMoveSubject` | `'self'/'agent'/'instrument'` の allowlist |
| `parseActiveEffects.parseMoveDestination` | `'self'/'parent'` の allowlist |
| `parseActiveEffects.parsePassiveTransfers`（export） | `'agent'` だけを名指しで拒否 |
| `parsePassives.parsePassiveOperationInto` | switch。`agent` は例外ではなく黙って読み飛ばす |
| `describe/effectQueries.writesTo`（codex） | 「`self` は宣言元自身のプロパティしか指さない」 |

第1波は `*_CONDITION_ROOTS` 4本だけを判定4とし、阻害要因を「評価文脈を表す型が domain に無い」と書いた。
**それは阻害要因ではない。** `parseMove` は同じ性質の述語 `ObjectRef.needsInteraction()`（domain）を
呼んでいる——`ReferenceRoot` の意味論を domain 側の述語で答える形は**既に1つ実在している**。
足りないのは型ではなく、その述語が1つしか無いこと。

### 2. 定義側コンストラクタの不変条件 — private 14本 ＋ export 4本

`new B(...)` の**前後**で B の成立条件を確かめる形。第1波は「3箇所で同型」と報告したが、実際は18箇所。

- **後**で確かめる（B自身の getter を使う）: `parseProp`（gauge/stages の向き、range と mixed）、
  `parseGeneratorLayer`（octaves・frequency）、`parseGenerationScope`（interiorBias・maxSitesPerType・
  crowdingPenalty）、`RawObjectDef.resolve`（名前衝突・visible_slots・art_by_stage）、`buildGenerationDefs`（相互参照）
- **前**で確かめる（引数を持ち回る）: `parseGauge`・`parseOptionalRangeEvent`（`range` を引数で運ぶ）、
  `parseStage`（`isSymbolProperty` を引数で運ぶ）、`parseRequirement`・`parseStep`・`parseTransfer`・
  `parseSpawn`・`parsePickList`・`buildGate`・`parseVariants`・`parseAxis`・`parseLocationType`

阻害要因は全部同じ1つ：**例外型が `YamlLoadError` で、文言に YAML 上の文脈文字列と節番号が入る**。
つまり18箇所を止めているのは「domain が YAML 由来の語彙を知らない」という**1本の制約**で、そこを
（例えば検証結果を返して loader が文言を付ける形に）解けば18箇所が同時に動く。

### 3. `RawObjectDef`（の宣言ノード） — 8箇所

`RawPatch.ts` の5本（`apply`・`addValue`・`setValue`・`removeValue`・`descendToKey`）と
`axisVariants.ts` の3本（`readAxes`・`variantBody`・`valueTraitNames`）が、`raw.node` へ外から触る。
`RawObjectDef` に `applyPatch(...)` と `variationAxes` の読み口、`copyBodyWithout(...)`、
`declaresOnlyTraits()` を足せば、`node`・`readFields()` を private に戻せて8本すべてが消える。
第1波は `node`／`readFields` の可視性（判定4）としてこれを2件と数えていたが、**開口を使っている側は8本**。

### 4. 定義自身の `describe` — 11箇所

第1波が判定4にした `describeObjectDef`・`describeProperty`・`describeSlot`・`describeRecipe`・
`describeInteraction` の5本の**内側**に、同じ形の private が6本ある（`cellTokens`・`stageTokens`・
`describeRecipeStep`・`recipeRequirementTokens`・`requirementTokens`・`describeMatchingRangeEvents`）。
定義側へ `describe` を移すなら移動するのは5本ではなく11本。

### 5. `yamlMapping.ts` — 6箇所

`matches`・`descendToMap`・`descendToSeq`・`keyHint`（RawPatch.ts）、`concatSeqs`（RawObjectDef.ts）、
`oneOrMany`（parseActiveEffects.ts）。世界の語彙を1つも持たない YAML アクセスが、
patch・trait合成・効果パースの3ファイルに散っている。阻害要因は無い（純粋な移動）。

### 6. `src/analysis/balanceTables.ts` の結果型 — 4箇所

`ChainRoute`（`placeHtml`・`menuHtml`＋export の `wireBalanceMenu`）、`Gap`（`gapLabel`）、
`PlaceBalance`（`placeLabel`）。共通するのは「**解析が答えを作るときに区別を落とし、ビューアが
名前や旗から復元している**」こと。`Gap` は `objectName` を捨て、`PlaceBalance` は「島全体か」を
文字列の一致に畳んでいる。`ChainRoute` は絞り込み規則そのものが持ち出されている。

### 7. domain の union 型に値リストが無い — 5箇所

`ALERT_LEVELS`（AlertLevel.ts）と `GAUGE_ENDS`（PropertyDef.ts）は domain が値リストを export し、
loader は `oneOf` で1行で読んでいる。同じ形になっていないのは `Placement`（`parsePlacement` が
`PLACERS` を再宣言）、`ConditionOp`（`PROPERTY_OPS` と `in`/`not_in` 判定が2本）、`GuaranteePick`
（`parseGenerationScope` の switch）、ジェネレータ種別（`parseGeneratorLayer` の switch）、
`SpawnTargetRoot`（`parseSpawnTargetRoot`）。**分けている差は無い**——2つは既に揃っている。

### 8. `ObjectDef` の宣言列挙 — 3箇所（codex）

`PropertyDef.hasRangeEventMatching(matches)` は domain に在るのに、`ObjectDef` には
「述語に当てはまる宣言を列挙／存在判定する」対応物が無い。そのため `matchingInteractions`（private）と
`creates`・`usesInRecipes`（export、第1波の判定3）がビューア側に立っている。3本とも同じ1つのメソッドで畳める。

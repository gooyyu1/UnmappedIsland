# analysis — 判定3の再点検

対象は private メソッド・private getter・export されていないモジュール関数。
（private フィールド・非export の const/type/interface は数えていない。非exportのクラス
`OutcomeReader`・`TickDeltaCollector` は、その private メンバだけを数えた。）

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/analysis/CraftingStep.ts | 1 | 1 | 0 |
| src/analysis/balanceTables.ts | 43 | 25 | 18 |
| src/analysis/craftingSteps.ts | 8 | 5 | 3 |
| src/analysis/effectOutcomes.ts | 1 | 1 | 0 |
| src/analysis/rangeCycles.ts | 2 | 0 | 2 |
| src/analysis/rangeEvents.ts | 0 | 0 | 0 |
| src/analysis/staticValue.ts | 0 | 0 | 0 |
| src/analysis/tickDeltas.ts | 1 | 1 | 0 |
| src/save/SaveData.ts | 1 | 1 | 0 |
| src/save/SaveSlotIndexError.ts | 0 | 0 | 0 |
| src/save/SaveSlots.ts | 1 | 1 | 0 |
| src/save/Settings.ts | 2 | 2 | 0 |
| src/save/Shelf.ts | 0 | 0 | 0 |
| src/save/newGameInput.ts | 0 | 0 | 0 |
| src/scenario/Scenario.ts | 10 | 4 | 6 |
| **合計** | **70** | **41** | **29** |

`src/analysis/staticValue.ts` と `src/analysis/rangeEvents.ts` はヘルパー0だが、これは
「ヘルパーが無い」のではなく**ファイルまるごとが B の代役**だからである（後述）。
`src/save/newGameInput.ts` も同じ形で、6つの関数が全部 export されているためこの census には
1件も現れない。

## 主語が他にあるヘルパー

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| balanceTables.ts | `inInitialStage()` | `PropertyDef` | 「**初期値がどの段に入るか**」。`isInStage(value, name)` と `initialValue` は別々にあるが、両者を繋ぐ口が無い | 消える | inherit のプロパティは定義だけでは初期値が確定せず、`staticValueOf(def, id, outer)` に外部文脈を渡さないと答えが出ない。`PropertyDef` は文脈を受ける引数を持たない |
| balanceTables.ts | `destroysWhenEmpty()` | `PropertyDef` | 「`on_min` が自分を消すか」 | 消える | `hasRangeEventMatching` はラベルを渡せず `on_min` に限定できない。効果の中身は `EffectReader` 越しにしか読めず、domain 側にその読み手が無い |
| balanceTables.ts | `isLocation()`, `isCharacter()`, `Acquisition.isAlwaysAtHand()`, `explorableLocationsOf()` | `WorldCodex` | 「**この型は土地か・キャラクタか・探索できるか**」。`vocabulary.world.locationTagId` は生の ID だけを出しており、判定は利用側が書く | 4つとも消える | `Location`／`PlayerCharacter` ビューは `WorldObject`（実行時インスタンス）を包む形で、**定義に同じ問いを立てる口が無い**。`isLocation` の「製作中オブジェクトは除く」という但し書きも、そのため他所へ写せず1箇所に閉じている |
| balanceTables.ts | `allDefs()` | `ObjectDefTable` | 全型の反復。`count`/`get` しか無いので `for (globalId...)` を利用側が書く | 消える | `ObjectDefTable` が格納の形（添字と個数）だけを公開し、反復子を持たない |
| balanceTables.ts#Acquisition | `candidatesOf()` | `WorldCodex` | 「そのタグを持つ型の globalId 一覧」。`objectDefNamesWithTag` は**名前**しか返さない | 消える | 既存の口が名前を返す形で固まっており、ID で引きたい利用側が走査を書き直している |
| balanceTables.ts | `ancestorContext()`, `bestAncestorContext()`, `withBestDragged()` | `staticValue.ts`（`StaticValueResolver`） | 「祖先（土地）・重ねる相手（武器）が入れる値」を埋める resolver の作り方 | 消える（`staticValue.ts` へ移すだけ） | `staticValue.ts` が「埋め方はレポートの都合」と宣言して自分では持たず、埋め方の実体が利用者側に残った |
| balanceTables.ts | `expectedSpawns()`, `expectedDeltas()` | `CraftingStep`（同package別ファイル） | 「分岐の確率で重み付けした期待産出／期待増減」。`collectOutputs` は**型の一覧**だけを畳み、量は畳まない | 2つとも消える | 無し。`CraftingStep.ts` の `collectOutputs` の隣に置けるものが、利用者の居る側に置かれているだけ |
| balanceTables.ts | `totalOf()`, `addCost()`, `scaleCost()` | `Cost`（同ファイルの interface） | 値オブジェクトとしての演算（合計・加算・スケール） | 3つとも消える | `Cost` がメソッドを持てない素の interface として宣言されている |
| balanceTables.ts | `externalTickDeltasOn()` | `WorldCodex` | 「**どの型がどの型の隣に立てるか**」の逆引き（枠の受け入れ関係） | 消えない。`externalTickDeltasOf` の呼び分けは残る | `WorldCodex.admitsBroughtObjects(slotDef)` が「持ち込める物があるか」の真偽しか返さず、相手の型を返さない。`rangeCycles` は「誰の隣に立てるかは答えない」と明示的に降りている |
| balanceTables.ts | `lifetimeOf()` | `rangeCycles.ts` | 「その型が朽ちるまでの時間」。`RangeCycle[]` だけを見る | 消える（`rangeCycles.ts` へ移すだけ） | 無し |
| craftingSteps.ts | `selfMovesOf()` | `PropertyDef`／`PropertyValue` | 「**値を動かした先はいくつか**」。実行時は `PropertyValue.add`／`setNumber` が自分でやって `checkRangeEvents` まで呼ぶが、定義側には対応物が無い | 消えない。`withTriggeredRangeEvents` 側に「分岐の確率で畳む」部分が残る | 定義には実体値が無いので、`staticValueOf` に外部文脈（`outer`）を渡した「そう置いた場合の値」しか作れない。その文脈を受ける引数が `PropertyDef` に無い |
| craftingSteps.ts | `totalMinutesOf()` | `RecipeDef` | 「全工程を通した所要時間」。`RecipeStepDef.durationMinutes` の和 | 消える | 無し。`domain/crafting.ts` が同じ和を別に取っている |
| craftingSteps.ts | `minutesOf()` | `InteractionDef` | 「**定義だけの文脈での所要時間（分）**」。`durationMinutes(self, actor, dragged)` は WorldObject を3つ要求する | 消える（`durationReading` を resolver で解く口を足せば） | ドメイン版の口が `WorldObject` を3つ取る形で固まっており、定義だけの文脈から呼べない。`durationReading` を公開して利用側に `Math.trunc` まで書かせることで回避している |
| rangeCycles.ts | `tickAmountsOf()` | `tickDeltas.ts` | 「**そのプロパティのtick毎の速さ**（段は除く、条件つきは最遅／最速の幅）」。実行時の `PropertyValue.changePerTick()` に当たるもの | 消える | `tickDeltasOf(def)` が全プロパティぶんの列しか返さず、プロパティ単位で問えない。そのため呼ぶたびに全走査し直している |
| rangeCycles.ts | `ticksWhileGateHolds()` | `tickDeltas.ts`（`TickGate`） | 「**このゲートが落ちるまで何tickか**」。実行時の `PropertyValue.ticksUntilMax()` に当たるもの | 消える | `TickGate` が `watchedSelfProperties`（IDの列）しか持たず、値も速さも自分で解けない。解くには定義に値を訊く口（`staticValueOf`）が要り、`tickDeltas.ts` はそれを import していない |
| Scenario.ts | `objectIdOf()`, `slotIdOf()`, `propertyIdOf()` | `NameRegistry` | 「**解決できない名前を、読み手が決めた例外で返す**」。`getId` は自前の `Error` を投げ、`tryGetId` は undefined を返すだけ | 3つとも消える（`yamlMapping` に共通の包みを置けば） | `NameRegistry.getId` が投げる例外の型を利用側が選べない。loader 側も同じ包みを別に持っている |
| Scenario.ts | `resolveValue()` | `loader/parseCommon.ts` | 「**未知の名前を作らずに**、整数かシンボル名かを解釈する」 | 消える（intern するかを引数にすれば） | `parseScalarNumber` が未知の名前を `intern` して作ってしまう。誤記を弾きたいシナリオでは使えない |
| Scenario.ts | `place()` | `NewGameSession`／`PlayerCharacter` | 「**このスロット名を持つのはキャラクタか土地か**」（`PLAYER_SLOTS` の配列がその代役）と「名前で指定したスロットへ1つ置く」 | 消える | `PlayerCharacter.handSlotId` ほかは ID を1つずつ getter で出すだけで、「キャラクタ自身のスロットの集合」を名乗る口が無い。`WorldVocabulary` も同様 |
| Scenario.ts | `placeInside()` | `domain/views/Location` | 「開始地点にあるこの型の設置物を1つ取る」 | 消えない。エラー文言の組み立ては残る | `Location.fixtures` が列を返すだけで、型で引く口が無い |

## 同じ B に対して複数の A が補っているもの

### 1. B = ObjectDef／PropertyDef —「定義に、実行時インスタンス無しで問いを立てる口が無い」

**この1つの不足が、担当範囲で 13 個の private ヘルパーを生んでいる。**

| A（現在地） | ヘルパー | 実行時の対応物（B が持っている口） |
|---|---|---|
| balanceTables.ts | `inInitialStage` | `PropertyDef.isInStage(effectiveValue, name)` |
| balanceTables.ts | `destroysWhenEmpty` | `PropertyDef.checkRangeEvents(value, owner)` |
| balanceTables.ts | `ancestorContext` | `PropertyDef.inheritedContribution(owner)` |
| balanceTables.ts | `bestAncestorContext` | 同上 |
| balanceTables.ts | `withBestDragged` | `WeightSpec.resolve(self, actor, dragged)` |
| balanceTables.ts | `isLocation` | `domain/views/Location`（`WorldObject` を包む） |
| balanceTables.ts | `isCharacter` | `domain/views/PlayerCharacter`（同上） |
| balanceTables.ts | `explorableLocationsOf` | `Location.explorationProgress` |
| balanceTables.ts#Acquisition | `isAlwaysAtHand` | 上2つの合成 |
| craftingSteps.ts | `selfMovesOf` | `PropertyValue.add` / `setNumber` |
| craftingSteps.ts | `minutesOf` | `InteractionDef.durationMinutes(self, actor, dragged)` |
| rangeCycles.ts | `tickAmountsOf` | `PropertyValue.changePerTick()` |
| rangeCycles.ts | `ticksWhileGateHolds` | `PropertyValue.ticksUntilMax()` |

ヘルパーの外にも同じ不足が出ている。**export されているせいで census に入らないだけで、
存在理由は同一**:

- `src/analysis/staticValue.ts` の**全部**（`StaticValueResolver`・`staticResolverOf`・
  `staticValueOf`・`trackingResolverOf`・`TrackingResolver`・`resolveWeight` の6宣言）。
  これは `PropertyValue.getEffectiveValue()` の inherit 部分を、実体値抜きで作り直したものである。
- `src/analysis/rangeEvents.ts` の `rangeEventAt`（＝`PropertyDef.checkRangeEvents` の判定部）と
  `ticksToRangeEnd`（＝`PropertyValue.ticksUntilMax` の一般化）。
- `CraftingStep.hasUnresolvedReferences` フィールドと `TrackingResolver.unresolved`。
  「解けなかった」という状態そのものが、**この不足があるからだけ**存在する印である。

**打ち手の形**: B（`PropertyDef`・`InteractionDef`・`ObjectDef`）の既存メソッドは
`WorldObject`／`(self, actor, dragged)` を受け取る。ここを「値を答える関数」1つを受け取る形
（`StaticValueResolver` 相当）へ**引数だけ**変え、実行時側は `WorldObject` から作った resolver を
渡すようにすれば、定義側と実行時側が同じ口を通る。`checkRangeEvents` は判定と効果適用が一体なので、
「どちらの端か」を返す部分を切り出す必要がある（CLAUDE.md の「1つの仕組みで100%」がそのまま当たる）。

### 2. B = WorldCodex／ObjectDefTable —「全型の走査と、そこからの絞り込み」

担当範囲で 7 ヘルパー（`allDefs`・`isLocation`・`isCharacter`・`explorableLocationsOf`・
`isAlwaysAtHand`・`candidatesOf`・`externalTickDeltasOn`）。担当範囲の外でも同じ走査が写っている:

- `src/domain/WorldCodex.ts` 自身が L87・L142・L157・L169 の**4箇所**で `for (globalId...)` を書いている
- `src/codex-viewer/CodexView.ts` L66、`src/codex-viewer/craftingGraph.ts` L120、
  `src/game/view/recipeList.ts` L55 がそれぞれ独自に走査
- `src/game/view/cardLooks.ts` L312-313 が `character`／`location` タグを**文字列から引き直して**
  同じ判定をしている（`vocabulary.world.characterTagId` があるのに使っていない）

`ObjectDefTable` に反復を、`WorldCodex` に「タグ→ObjectDef」「この型は土地か／キャラクタか」を
足せば、担当範囲の7つに加えて上記6箇所も消える。

### 3. B = CraftingStep —「分岐を確率で畳む」演算の置き場

`expectedSpawns`／`expectedDeltas`（balanceTables）は、`CraftingStep.ts` の `collectOutputs` と
同じ畳み込みの、量つき版である。`collectOutputs` だけが B 側に居て、量を出す2つが A 側に居るのは
利用者の場所以外に理由が無い。この2つは balanceTables の中で `supplyRows`・`routeCandidates`・
`gainsOf`・`prerequisitesOf`・`deviceRows`・`objectCosts`・`Acquisition.relax`・
`Acquisition.missingInputsFor` の**8箇所**から呼ばれており、B へ移すと analysis 全体で共有できる。

### 4. B = tickDeltas.ts／rangeCycles.ts —「集めた列に問いを立てる口」

`tickDeltasOf(def)` は列を返すだけなので、`tickAmountsOf`（プロパティ単位の速さ）・
`ticksWhileGateHolds`（ゲートの寿命）・`lifetimeOf`（型の寿命）・`tickAmountsByName`（名前ごとの合計）・
`dailyNeedsOf` の前半が、いずれも「返ってきた列を利用側が畳み直す」形になっている。
`tickAmountsOf` は呼ばれるたびに `tickDeltasOf` を丸ごと呼び直しており、二重走査になっている。

### 5. B = NameRegistry —「解決できない名前を、読み手の例外で返す」

`Scenario.ts` の `objectIdOf`／`slotIdOf`／`propertyIdOf` は3つとも同じ形
（`tryGetId` → undefined なら `YamlLoadError`）。`src/loader/` 側にも同じ包みがある。
`NameRegistry.getId` が投げる例外の型を呼び出し側が選べないため、名前の種類の数だけ包みが増える。

### 6. B = Rng —「候補から1つ引く」と「シードの値域」（src/save/）

`src/save/newGameInput.ts` の `randomIslandName`・`randomCharacter` は、どちらも
`items[rng.nextInt(0, items.length)]` を書いている。`Rng.ts` は `pickWeighted` を持つのに
**重みなしの1つ引き**を持たない（`domain/generation/NameAssigner.ts` L47 も自前で書いている）。

`randomSeed`／`parseSeed` は `SEED_MAX = 4294967295` を使うが、これは `Pcg32` が `seed >>> 0` で
扱う値域であって**セーブ形式の制約ではない**（`SaveData.ts` のコメント自身がそう書いている）。
`Rng`／`Pcg32` が「種として妥当な値の範囲」も「乱数から種を1つ作る」口も持たないため、
save 側が Pcg32 の内部規約を数値で写している。

なお `src/save/` に「domain の型の復元手順を代わりに知っている」形は**見つからなかった**。
`toSaveData` は domain の型を一切知らず、復元は `PlayScene`（L440-442）が行っている。
save が代わりに知っているのは domain ではなく**逆方向の2つ**——`Pcg32` の値域（上記）と、
地図ウィンドウのカード位置の形（`MapCardPosition` と、その検査 `isMapCardPosition`）である。

## 主語が自分だったヘルパー（41件）の内訳

参考までに、ファイル別の内訳だけ記す。個別には書かない。

- `balanceTables.ts` 25件: 表の組み立て（`consumptionRows`・`supplyRows`・`placeBalances`・
  `objectCosts`・`deviceRows`・`propertyChains`・`propertyRoute`・`buildRoute`・`gapsOf`）、
  求解（`Acquisition` の `importable`・`cheapestCandidate`・`inputCost`・`relax`）、
  献立（`greedyMenu`・`addEntry`）など。いずれも analysis 自身の概念（`ChainRoute`・`Cost`・
  `StepRef`・`DailyMenu`）を組み立てるもので、B は無い。
  ただし `conditionLabel` だけは主語が自分（`TickGate`）でありながら**日本語の文を組み立てており**、
  第1波の判定5（見せ方が解析に混じっている）がそのまま当たる。
- `craftingSteps.ts` 5件、`Scenario.ts` 4件（YAML の形の読み下し）、`Settings.ts` 2件、
  `CraftingStep.ts`・`effectOutcomes.ts`・`tickDeltas.ts`・`SaveData.ts`・`SaveSlots.ts` 各1件。

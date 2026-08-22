# analysis

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/analysis/CraftingStep.ts | 35 | 29 | 1 | 5 | 0 | 0 |
| src/analysis/balanceTables.ts | 190 | 154 | 6 | 14 | 9 | 7 |
| src/analysis/craftingSteps.ts | 9 | 7 | 0 | 0 | 1 | 1 |
| src/analysis/effectOutcomes.ts | 22 | 17 | 3 | 0 | 0 | 2 |
| src/analysis/rangeCycles.ts | 18 | 18 | 0 | 0 | 0 | 0 |
| src/analysis/rangeEvents.ts | 8 | 6 | 0 | 0 | 2 | 0 |
| src/analysis/staticValue.ts | 8 | 7 | 0 | 0 | 1 | 0 |
| src/analysis/tickDeltas.ts | 17 | 16 | 1 | 0 | 0 | 0 |
| src/save/SaveData.ts | 18 | 13 | 3 | 1 | 1 | 0 |
| src/save/SaveSlotIndexError.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/save/SaveSlots.ts | 10 | 7 | 2 | 1 | 0 | 0 |
| src/save/Settings.ts | 12 | 7 | 0 | 5 | 0 | 0 |
| src/save/Shelf.ts | 6 | 5 | 0 | 1 | 0 | 0 |
| src/save/newGameInput.ts | 8 | 1 | 0 | 0 | 5 | 2 |
| src/scenario/Scenario.ts | 32 | 18 | 2 | 10 | 1 | 1 |
| **合計** | **395** | **307** | **18** | **37** | **20** | **13** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| CraftingStep | 定義から読んだ「1回の工程」の形を定める | `UNCHANGED_OUTCOMES`, `scaleOutcomes`, `combineOutcomes`, `collectOutputs`, `mergeSpawns`（型ではなく確率分岐の代数演算） |
| balanceTables | 定義から時間あたりの収支表を組み立てる**と**、全型の入手時間を解く**と**、コーデックスへの定義単位の問い合わせを提供する | 接続詞2つ＝責務3つ。`Acquisition`一族（求解器）、`allDefs`/`isLocation`/`isCharacter`/`explorableLocationsOf`/`allSteps`/`stepsAt`（コーデックス問い合わせ）、`ancestorContext`/`bestAncestorContext`/`withBestDragged`（解決器の組み立て）、`WHOLE_ISLAND`/`conditionLabel`（見せ方） |
| Acquisition | 1つの文脈で各型を1個得るのに要する時間を解く | `prerequisites`（表示用ラベルの連結を含む）、`candidatesOf`（タグ→型の逆引き＝コーデックスの問い） |
| craftingSteps | 型の宣言（操作・レシピ・周期）を工程の形へ読み直す | `totalMinutesOf`（レシピ自身の総所要時間） |
| effectOutcomes | 効果の読み上げを確率つきの結果へ畳む | `Readable`（読み上げられるものの型そのもの） |
| rangeCycles | tick毎に動く値が端へ届く周期と、そこで起こることを読む | （なし） |
| rangeEvents | range系イベントが端で何をするかを実行時オブジェクト無しで読む | `ticksToRangeEnd`（端まで何tickかの計算で、イベントの読み出しではない） |
| staticValue | 定義だけから値を解く手立てと、その埋め方の近似を与える | （なし。`ancestorContext`等がbalanceTablesに居るのは逆に不足） |
| tickDeltas | passivesのtick毎の増減を定義から集める | （なし） |
| SaveData | 1スロットのセーブ形式を定め、壊れた値から読み直す | `SEED_MAX`（Pcg32の値域）、`MapCardPosition`（地図ウィンドウの語彙） |
| SaveSlots | 4スロットのセーブデータを保存先へ出し入れする | （なし） |
| Settings | 設定を保存先へ出し入れする**と**、機能ごとの設定項目を名前で提供する | `loadsAssetPack`, `openedTab`, `rememberOpenedTab`（個別機能の語彙） |
| Shelf | 周回をまたぐ棚の中身を保存先へ出し入れする | （なし） |
| newGameInput | 新規ゲーム画面の入力を作り・解釈し、セーブデータへ変換する | `createSaveData`以外の全部（画面の入力の話でセーブ形式ではない） |
| Scenario | 同梱シナリオを索引し**、**YAMLから読み**、**新規ゲームへ適用する | 接続詞2つ＝責務3つ。`FILES`/`SCENARIO_TEXTS`/`scenarioNames`/`bundledScenario`（索引）、`applyScenario`/`place`/`placeInside`/`resolveValue`/`PLAYER_SLOTS`（適用） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/analysis/balanceTables.ts | `TICKS_PER_DAY`, `MINUTES_PER_TICK`, `MINUTES_PER_DAY` | 所属 | 5 | `minutes_per_tick: 15` は `core.yaml` のワールド宣言そのもので、解析は `staticValueOf` で読めるのに数値で写している | `WorldVocabulary.minutesPerTickId` 経由でワールド定義から読む | | |
| src/analysis/balanceTables.ts | `WHOLE_ISLAND` | 所属 | 5 | 表示文字列が識別子の場に混じっており、`balancePage` が `name === WHOLE_ISLAND` で `objectLabel` を特例回避している | `codex-viewer/balancePage` | | |
| src/analysis/balanceTables.ts | `conditionLabel()`, `ConsumptionRow.condition` | 所属 | 5 | 「段 x=y（輸送・在庫がある間）」という日本語の文を組み立てており、冒頭の「見せ方は持たない」に反する | `codex-viewer/balancePage`（行は `TickGate` をそのまま持つ） | | |
| src/analysis/balanceTables.ts#Acquisition | `candidatesOf()` | 所属 | 5 | タグを持つ型の全走査は `WorldCodex.objectDefNamesWithTag` と同一で、返すのが名前かIDかしか違わない | `WorldCodex`（タグ→globalIdの口） | | |
| src/analysis/balanceTables.ts | `isLocation()`, `isCharacter()`, `explorableLocationsOf()`, `Acquisition.isAlwaysAtHand()` | 所属 | 4 | 「この型は土地か・キャラクタか・探索できるか」はワールドの語彙の話で、近似ではない | `WorldCodex` | ドメインの土地・キャラクタの口（`domain/views/Location`・`PlayerCharacter`）は WorldObject 前提で、**定義**に同じ問いを立てる口が無い | |
| src/analysis/balanceTables.ts | `allDefs()` | 所属 | 4 | `WorldCodex` が自分の中で3回書いている全型走査（`symbolicProperties`・`objectDefNamesWithTag`・`singletonGlobalIds`）の4つ目 | `WorldCodex` / `ObjectDefTable` | `ObjectDefTable` が `count`/`get` だけを公開し反復を持たないため、利用側が毎回組み立てている | |
| src/analysis/balanceTables.ts | `destroysWhenEmpty()` | 所属 | 4 | 「`on_min` が自分を消すか」は宣言そのもので、読み方の近似ではない | `PropertyDef` | `hasRangeEventMatching` はラベルを渡せず `on_min` に限定できず、効果の中身は `EffectReader` 越しにしか読めない | |
| src/analysis/balanceTables.ts#Acquisition | `prerequisites()`, `RoutePrerequisite.label`, `Gap.label` | 所属 | 4 | 「宣言名 → 実際に使う型」の連結は見せ方で、解析の出力に文字列として焼き込まれている | `codex-viewer/balancePage` | 表側が宣言名と実際に使う型を別々に受ける口を持たず、1本の文字列で受けているため | |
| src/analysis/balanceTables.ts | `ancestorContext()`, `bestAncestorContext()`, `withBestDragged()` | 配置 | 3 | どれも `StaticValueResolver` を作る関数で、`staticValue.ts` の「定義だけから値を解く手立てと、その周りの近似」がそのまま宛先 | `src/analysis/staticValue.ts` | | |
| src/analysis/balanceTables.ts | `totalOf()`, `addCost()`, `scaleCost()`, `Cost`(export) | 所属/可視性 | 3 | `Cost` の演算が `Cost` の外に自由関数として散っており、`Cost` 自体は外部から参照されていない | `src/analysis/Cost.ts`（値オブジェクト化して非export） | | |
| src/analysis/balanceTables.ts | `externalTickDeltasOn()`, `lifetimeOf()` | 配置 | 3 | 前者は `externalTickDeltasOf` の、後者は `RangeCycle[]` だけを見る関数で、どちらも rangeCycles の続き | `src/analysis/rangeCycles.ts` | | |
| src/analysis/balanceTables.ts | `allSteps()`, `stepsAt()` | 配置 | 3 | 収支表ではなく「全型の工程を並べる」問いで、`craftingSteps`/`rangeCycles` を束ねる層 | `src/analysis/steps.ts`（新設） | | |
| src/analysis/balanceTables.ts | `Acquisition`(class) | 配置 | 3 | 241行の求解器が収支表の組み立てと同居し、1328行の主因になっている | `src/analysis/Acquisition.ts` | | |
| src/analysis/balanceTables.ts#Acquisition | `costByObject`, `producedObjects` | 可視性 | 3 | 可変の `Map`/`Set` をそのまま公開しており、Layers.md の「格納の形ではなく問いの形で足す」に反する | 同クラスに `costOf(id)` / `produces(id)` を置く | | |
| src/analysis/balanceTables.ts | `KEY_SEPARATOR`, `splitKey()` | 所属 | 2 | 組（プロパティ名, 条件）を文字列で連結して後で割り直す、表を畳むためだけの都合 | （同ファイル内。組をそのまま持てば消える） | | |
| src/analysis/balanceTables.ts | `menuFor()` | 可視性 | 2 | 表の組み立て関数のうちこれだけ公開だが、ビューアが経路を差し替えて再計算するのに要る | | | |
| src/analysis/balanceTables.ts | `EPSILON`, `SupplyRow.unresolved`, `Acquisition.islandWide` | 所属 | 2 | 浮動小数の比較・確定しない参照の印・親文脈への参照で、いずれも計算を成り立たせるための都合 | | | |
| src/analysis/CraftingStep.ts | `UNCHANGED_OUTCOMES`, `scaleOutcomes()`, `combineOutcomes()`, `collectOutputs()`, `mergeSpawns()` | 配置 | 3 | 工程の**形**を定めるファイルに、確率分岐の代数演算が同居している | `src/analysis/outcomes.ts`（新設）または `effectOutcomes.ts` | | |
| src/analysis/CraftingStep.ts#CraftingStep | `hasUnresolvedReferences` | 所属 | 2 | 工程の性質ではなく「この数値は定義だけからは確定しない」という計算側の印 | | | |
| src/analysis/craftingSteps.ts | `totalMinutesOf()` | 所属 | 5 | 全工程の所要時間の和はレシピ自身の性質で、`domain/crafting.ts` が同じ和を2箇所で取っている | `RecipeDef`（総所要時間の口） | | |
| src/analysis/craftingSteps.ts | `minutesOf()` | 所属 | 4 | `Math.trunc(duration.resolve(...))` は `InteractionDef.durationMinutesFor` と同じ計算 | `InteractionDef`（`durationReading` を数値へ解く口） | ドメイン版は self/actor/dragged の WorldObject を要求し、定義だけの文脈からは呼べない | |
| src/analysis/effectOutcomes.ts | `Readable`, `Readable.read` | 所属 | 5 | `domain/EffectReader.ts` の `EffectDeclaration` と1文字も違わない再宣言 | `src/domain/EffectReader.ts#EffectDeclaration`（既存） | | |
| src/analysis/effectOutcomes.ts#OutcomeReader | `move()`, `become()`, `signal()` | 所属 | 2 | 中身は空で、読み上げの動詞を取りこぼさないための実装義務（Layers.md 6節） | | | |
| src/analysis/rangeEvents.ts | `rangeEventAt()` | 所属 | 4 | `value >= range.max` / `<= range.min` の端判定は `PropertyDef.checkRangeEvents` と同じ規則 | `PropertyDef`（値→ラベルの問い） | ドメイン側は判定と効果適用が一体（`owner.applyActiveEffect`）で、WorldObject 無しに「どちらの端か」だけを訊けない | |
| src/analysis/rangeEvents.ts | `ticksToRangeEnd()` | 所属 | 4 | 距離÷速度で端までのtick数を出す計算は `PropertyValue.ticksUntilMax` と同じ | `PropertyDef` | ドメイン版は実体値と `changePerTick()` を実行時オブジェクトから取るため、定義だけでは呼べない | |
| src/analysis/staticValue.ts | `staticValueOf()` | 所属 | 4 | 「inherit なら祖先の値を足す」は `PropertyDef.inheritedContribution` と同じ規則 | `PropertyDef`（祖先の値を引数で受ける形） | ドメイン版は `owner.findAncestorWithProperty` を通るので WorldObject が要る | |
| src/analysis/tickDeltas.ts#TickDelta | `capped` | 所属 | 2 | 「輸送なので在庫がある間だけ」という、量の解釈に要る印 | | | |
| src/save/SaveData.ts | `SEED_MAX` | 所属 | 4 | 符号なし32bitという値域は Pcg32 の都合で、セーブ形式の制約ではない（コメント自身がそう書いている） | `src/domain/Rng.ts` | Rng 側が種の値域を公開せず `seed >>> 0` の暗黙規約になっているため、利用側が数値を持つしかない | |
| src/save/SaveData.ts | `MapCardPosition` | 所属 | 3 | 「サイトindexと0〜1の正規化座標」は地図ウィンドウの語彙で、セーブはそれを運んでいるだけ | 映し側（地図ウィンドウ）で型を定め、save は輸入する | | |
| src/save/SaveData.ts | `SAVE_SCHEMA_VERSION`, `ISLAND_NAME_MAX_LENGTH`, `SaveData.schemaVersion` | 所属 | 2 | 概念ではなく、形式の変化と入力制限を保存側で決めるために要る | | | |
| src/save/SaveSlots.ts, src/save/Settings.ts, src/save/Shelf.ts | `KEY_PREFIX`×2, `KEY` | 所属 | 3 | `unmapped-island:` という保存領域の名前空間の規約が3ファイルに散っており、暗黙に一致すべき箇所が3つある | `src/save/storageKeys.ts`（新設） | | |
| src/save/SaveSlots.ts | `SLOT_COUNT`(export), `keyOf()` | 可視性/所属 | 2 | 前者は一覧UIが枠数を要るため公開、後者は鍵を作るついでに添字の範囲検査もする（名前は鍵のことしか言っていない） | | | 〇（`keyOf`） |
| src/save/Settings.ts | `loadsAssetPack`(get/set), `openedTab()`, `rememberOpenedTab()` | 所属 | 3 | 保存先の薄い包みに、アセットパックとタブという機能ごとの語彙が直接生えている | 各機能側（`asset-pack` / `game/ui`）が鍵を持ち、Settings は汎用の読み書きだけを担う | | |
| src/save/Shelf.ts | `contents`(壊れたJSONの扱い) | 所属 | (3に計上済) | 「壊れた値は無かったことにする」規則が `SaveSlots.read` と2箇所に同じ形である | 共通の読み出しヘルパ | | |
| src/save/newGameInput.ts | `NAME_ADJECTIVES`, `NAME_NOUNS` | 配置 | 5 | 日本語の語彙はデータで、Layers.md 4節が「データファイルはどの層にも属さず `src/assets/`」と決めている | `src/assets/` | | |
| src/save/newGameInput.ts | `randomIslandName()`, `randomSeed()`, `randomCharacter()`, `parseSeed()`, `normalizeIslandName()` | 配置 | 4 | 島名の抽選と入力欄の解釈は新規ゲーム**画面**の話で、セーブ形式の知識ではない（利用者は NewGameScene だけ） | `src/game/newGameInput.ts` | NewGameScene は Phaser 側でテストできないため、純関数だけを層の外へ出している（Layers.md 2節と同じ形） | |
| src/scenario/Scenario.ts | `PLAYER_SLOTS` | 所属 | 5 | 「hand/equipment/injuries はキャラクタ自身の枠」は `WorldVocabulary.handSlotId`ほかが既に宣言している | `WorldVocabulary` / `PlayerCharacter` | | |
| src/scenario/Scenario.ts | `resolveValue()` | 所属 | 4 | 「整数か、さもなくばシンボル名」の解釈は `loader/parseCommon.ts` の `SYMBOL_PATTERN` と同じ規則 | `src/loader/parseCommon.ts` | loader 版は未知の名前を `intern` して作ってしまい、誤記を弾きたいシナリオでは使えない | |
| src/scenario/Scenario.ts | `FILES`, `SCENARIO_TEXTS`, `scenarioNames()`, `bundledScenario()` | 配置 | 3 | 同梱ファイルの索引で、YAMLの読み方とも適用とも別の話 | `src/scenario/bundledScenarios.ts` | | |
| src/scenario/Scenario.ts | `applyScenario()`, `place()`, `placeInside()` | 配置 | 3 | 読み取り（parse）と適用（世界を作る）が1ファイルに同居している | `src/scenario/applyScenario.ts` | | |
| src/scenario/Scenario.ts | `objectIdOf()`, `slotIdOf()`, `propertyIdOf()` | 所属 | 3 | `NameRegistry.getId` が既に例外を投げており、違いは `YamlLoadError` と日本語の文脈だけ | `src/loader/yamlMapping.ts`（名前解決を YamlLoadError で包む共通口） | | |
| src/scenario/Scenario.ts | `names()` | 所属 | 2 | 「seqを読む」だけの名前だが、実際は個数指定（`stone x100`）の展開まで行う | | | 〇 |
| src/scenario/Scenario.ts | `MAX_COUNT` | 所属 | 2 | 書き間違いで100万個作らせないための上限で、シナリオの概念ではない | | | |

## 移動先が書けなかったもの

判定4・5はすべて移動先を書けた。ただし2つ、**移動先の概念そのものが無いために新設が要る**ものがある。

- **保存領域のキー名前空間**: `SaveSlots`/`Settings`/`Shelf` が `unmapped-island:` を各自で書き、壊れたJSONの扱いも各自で実装している。「この製品がブラウザに持つ保存領域はこれだけ」を1箇所で言う場所（`src/save/storageKeys.ts`）が無い。
- **表の行が持つ「条件」の構造**: `ConsumptionRow.condition` は日本語の文であって、`TickGate`（段・条件つき・輸送）の構造をそのまま運ぶ型が無いため、解析側で文にするしかなくなっている。

## ファイル配置（層=配置）についての所見

- `src/analysis/` の8ファイルのうち7つは粒度が揃っているが、`balanceTables.ts`（190宣言・1328行）だけが**収支表・入手時間の求解器（`Acquisition`）・コーデックスへの定義単位の問い合わせ・解決器の組み立て**の4つを抱えている。判定3の大半はこの1ファイルの分割で解ける。
- 解析→ドメインの一方通行は守られており、`EffectReader`/`PassiveReader` 経由の読み上げという設計（Layers.md 6節）も概ね機能している。破れているのは**近似ではない規則の写し**の側で、`MINUTES_PER_TICK`（core.yaml の宣言）、`Readable`（`EffectDeclaration` の再宣言）、`candidatesOf`（タグ走査）、`PLAYER_SLOTS`（語彙）が代表。
- `src/save/` は「セーブ形式の知識」と「復元される domain の型の知識」の境界がよく保たれている（`toSaveData` は domain の型を一切知らない）。はみ出しているのは逆向きの2つ——domain の都合（`SEED_MAX`＝Pcg32 の値域）と、映しの都合（`MapCardPosition` の正規化座標）が save 側に置かれている点。
- `src/save/newGameInput.ts` はファイルごと配置の問題で、セーブ形式ではなく新規ゲーム画面の入力を扱っている。`src/scenario/Scenario.ts` も索引・パース・適用の3責務が1ファイルにあり、パース部分だけを見れば `src/loader/` の同類（`yamlMapping` を使う YAML 読み取り）である。

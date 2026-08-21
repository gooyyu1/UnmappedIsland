# 兄弟の不揃い・薄いラッパーの棚卸し（作業中の控え）

リポジトリ全体（`src/` 約37,000行）を調べて出た指摘を、4つのPRに割ったもの。**全部終わったらこの
ファイルごと消す。** 次にやることを訊かれたら、上から順に未完のものへ着手する。

見つけ方は3種類——**兄弟なのに名前・引数が揃っていない**／**存在意義の薄いラッパー**／**docが現実と
ずれている**。乱れは全体に散っているのではなく、次の4つの継ぎ目に固まっている。

- `InteractionDef` / `CombinationDef`（効果・要件・所要時間の3系統が接する所）
- 定義↔インスタンスの対（`PropertyDef` ↔ `PropertyValue`）
- loader の共有ヘルパー層（`yamlMapping` と `parseCommon` の境界）
- `PlayScene` の組み立て部分（`build*`/`add*`/`show*`）

## PR 1: 実害のあるもの ✅ 完了

- [x] `ObjectWindow` のプロパティのタブが、ウィンドウを開いた時点の値を出す
- [x] `unresolvable`・`minutesFor`・`unmetRequirement`・`tryExecute` の引数順が `(self, dragged, actor)` と `(self, actor, dragged)` に割れている
- [x] `ChainRoute.deviceCount` の中身が「1日あたりの労働（分）」で、名前が個数を指している
- [x] `ShownCards.sameSpot` の2つの分岐が同じ式（何も見分けていない）

## この一覧は「上位だけ」であること

**6つの調査を上限8件で打ち切ったため、48件はその上限そのもの。** 6人全員が上限に達し、各自が
「8件に入らなかったもの」を別に挙げている（下の「上限からこぼれた分」）。**下のPR 2〜4を終えても
片付いたことにはならない**——終わったら「再チェック」の節に従ってもう一度調べる。

## PR 2: 死んでいるものの削除と、docの取り残し ✅ 完了

呼び元ゼロ（削除前に `rg` で再確認済み）:

- [x] `Slot.findMatchingStack`（`indexOfStack` のdocからの言及も外した）
- [x] `analysis/effectOutcomes.outcomesOf`
- [x] `CodexView.propertyDescription`
- [x] `PlayerCharacter.drop`
- [x] `PlayerCharacter.take` / `Location.receiveItem` が受け取る未使用の `session`
- [x] `Location.reorderItems` / `Location.reorderFixtures` / `PlayerCharacter.reorderHand`
      （テストは `WorldObject.reorderInParentSlot` を直接呼ぶ形にした）
- [x] `CardLooks.markOf` / `CardLooks.gaugesOf`（契約から外した。内側では今も使う）
- [x] `LocationTypeMatcher.normalizedDistance`（`export` を外した。モジュール内では使う）

docコメントの取り残し 14件（全部直し、残り0を機械的に確認）:

- [x] `ObjectDef.ts` 3件 / `PropertyDef.ts` 2件 / `PassiveEffect.ts` / `views/Animal.ts` /
      `loader/inProgressObjects.ts` / `PlayScene.ts` 3件 / `ui/Card.ts` / `ui/ProgressRing.ts` /
      `view/PlayScreenView.ts`

実在しないメンバーを指すdoc参照 5件:

- [x] `ObjectWindow` の `decideHeight` / `CardTable` の `CardLane.adoptCard` /
      `CardDragController` の `CardLane.setCards` / `CardLane` の `Card.identity` /
      `effectOutcomes` の `craftingSteps.track`

現実とずれた説明:

- [x] `ObjectWindow` の「スロットのタブは右の段を使い切る」と `decideWidth` の「見える枚数を増やす」
- [x] `CodexView.tagLabel` の「タグは表示文字列を持たない」（`tag_texts` は在る、と書き直した。
      **表示を識別子から表示名へ変えるかは仕様判断なので手を付けていない**——変えるなら別途）

予防:

- [x] `tests/docs/docComments.test.ts`（docコメントが2連続していたら落ちる。壊して落ちることも確認済み）

## PR 3: 二重化を1つに畳む

- [ ] `tryGetNode` が `loader/parseCommon.ts` と `loader/yamlMapping.ts` に同名同シグネチャ
      （「生のyaml APIを触るのはこのモジュールだけ」という宣言が破れている）
- [ ] 「未知のキーを弾く」が `parseRecipes.rejectUnknownKeys` と `parseGeneration.checkUnknownKeys`
      ＋直書き5箇所（`parseSlots`・`parsePassives`・`parseActiveEffects`×3）。本体は文字ごと同一
- [ ] 時刻の分解（総分→日・時・分）が `PlayScene.showClock` と `PlayScene.clockText` に別々。
      同じ時計へ `showInformation` からの経路も含めて3通りの入力がある（`looks/durationText` へ寄せる）
- [ ] `view/statusChanges.allStatuses`（と `allEntries`）と `ShownStatuses.all()`（と `entries()`）が
      同じ「先勝ちで畳む」を2実装
- [ ] `MINUTES_PER_TICK` が `analysis/rangeCycles.ts` と `analysis/balanceTables.ts` に2つ
      （`codex-viewer/balancePage.ts` には「1 tick = 15分」の直書きもある）
- [ ] `ACTION_HEIGHT` が同名別値（`looks/childWindowLayout.ts`=`SIZE.iconButton` と `ui/ModalDialog.ts`=72）。
      `RecipeWindow`・`ModalDialog` が共通の寸法トークンに乗っていない
- [ ] レーンの幅の式が `ExplorationPane.width` と `ObjectWindow.laneWidthFor` に2つ
- [ ] `objectLinkHtml` が `codex-viewer/pages.ts` と `codex-viewer/balancePage.ts` に2実装（差は絵の有無だけ）
- [ ] `analysis/staticValue.ts` の `staticValueOf` が `declaredValueOf` への素通し
- [ ] `PropertyValue.registerPassiveEffect` → `RegisteredPassiveEffect.registerInto` の2段中継
- [ ] `inProgressObjectsYaml` と `axisVariantsYaml` の呼び元（`WorldCodexYamlLoader.build`）に同型14行のコピー

## PR 4: 兄弟の名前と引数を揃える

- [ ] loader のパーサが `(loader, context, node)` 30本に対し `(loader, node, context)` 5本
      （`parseCommon.parseTypeMatchRule`・`parseSlots.parsePutIn`/`parseCell`/`parsePlacement`・`parseRecipes.rejectUnknownKeys`）
- [ ] `codex-viewer/describe/` の `describe*` が「行を書く」12本と「断片を返す」9本の2契約に同じ接頭辞。
      `*Tokens` 6本と役目が同じ。`describeStage` だけ対象固有の引数が `names` の後ろ
- [ ] `ui/Card.ts` の `show*` が受け取り方4形（content全体／1フィールド／引数なし／計算済み配列）。
      `showOverlay` が `applyContent` からではなく `showMark` の中から呼ばれている
- [ ] `ui/Card.ts` のモジュール関数が `create*`/`add*`/`place*` の3系統（`createAlertOutline` と
      `emptyOutline` は引数も戻り値も同型）
- [ ] `ObjectWindow` の `lane` / `cardLane` / `foundLane`（並べて使うのに1つだけ無修飾。フィールド名とも不一致）
- [ ] ウィンドウを畳むのが `close()` 4つに対し `RecipeWindow.destroy()`。「閉じる」ボタンの契約も
      `RecipeWindow` だけ自分を畳まず呼び元に任せる
- [ ] `PlayScene` のアイコンボタン4本（`addSlotButton`/`slotButtonPaper`/`slotButtonIcon`/`addIconButton`/
      `barIcon`/`iconButtonStyle`）。`slotButtonIcon` と `barIcon` は本体もdocの1行目も同じで、差は寸法2値だけ
- [ ] `PlayScene` の窓を開く3本（`openSlotWindow`/`openCharacterWindow`/`openLocationWindow`）。
      前2つはどちらもキャラクタ自身の窓で、差は `actions: []` と `opensPlace` の2点
- [ ] `view/operationSteps.ts` の `elapseSteps` と `elapsedSteps`（型も `ElapseStep`/`ElapsedStep`。
      「d」1文字違いで、取り違えても型が同じ文字列配列）
- [ ] 静的ファクトリが `ObjectRef.ofX` / `WeightSpec.fromX` / `TypeMatchRule.tag`・`object` の3流儀。
      `ObjectRef.ofObjectDef` と `TypeMatchRule.object` は同じものを別語彙で呼ぶ
- [ ] `acceptedCount` が `acceptedCount` / `acceptedCountOf` / `acceptedCountForMoveTo` の3流儀
      （`InteractionDef.acceptedCountOf` は呼び元1・引数を並べ替えずに渡すだけ）
- [ ] `PropertyValue` の派生読み6つがゲッターとメソッドに割れ、`PropertyDef` 側の語彙ともずれる
      （`alert` ↔ `alertLevelOf`、`artSuffix()` ↔ `artSuffixOf`）
- [ ] `CardLane.slotRect`（クラス全体は cell の語彙。`slot` はワールド側の別概念）と `addPinnedSlot`
- [ ] `art/backgroundArt.ts` の `laneTexture` と `cardBackgroundTexture`（`Use` 列挙の2値ぶんを手書き）
- [ ] `PlayScene.cardsAt` が `view.cardsIn` への1行委譲。`ShownCards` への受け口
      `stacksIn: (place) => this.cardsAt(place)` / `places: (screen) => this.place(screen)` が
      DesignNotes「層をまたぐ転送」の `(...asked)` 形になっていない
- [ ] `views/Location.slotStacks` と `views/PlayerCharacter.stacksOf`（本体が同一で名前だけ違う）
- [ ] `PlayScene.cellsAt` / `portraitCells` / `laneCells.foundCells` の3つの名前の作り

## 上限からこぼれた分（未着手。再チェックの起点にする）

調査時に各担当が「重要度で8件に入らなかった」として挙げたもの。**証拠の確認まではしていない**ので、
着手前に本体と呼び元を見ること。

### domain

- `matches` が定義引き（`TypeMatchRule.matches(ObjectDef)`）と個体引き（`ObjectStack.matches(WorldObject)`）の
  両方に使われる。さらに「受け入れるか」が `CellDef.accepts` / `SlotDef.acceptsAnywhere` / `Slot.canAccept` の3語

### loader / generation

- 生成の段関数の粒度が不揃い（`place`/`sample`/`build` と `assignTypes`/`assignNames`/`triangulate`）
- `AxisSampler.sample` と `ValueNoise.sample` の同名衝突が、`TerrainGenerator` での別名輸入（`sampleNoise`）を強いる
- 共通引数の順が揃わない（`sample(axes, sites, seed, scope)` / `assignTypes(defs, scope, sites)` / `build(sites, edges, scope)`）
- `WorldCodexYamlLoader.parseObjectDef`（呼び元1、引数を並べ替えて `new RawObjectDef` するだけ）
- `parseProperties.parseRangeEventEffect`（呼び元1、`parseActiveEffectBody` にフラグを2つ足すだけ）
- `messageOf` が3重定義（`loadDefinitions` と `RawPatch` は同一、`game/errorReport` は別シグネチャ）
- passives を溜める配列の受け渡しが `parsePassive(loader, output, …)` と `parseProp(loader, …, passives)` で名前も位置も違う
- `RawObjectDef.readFields()` と `WorldCodexYamlLoader.parseTrait()` が同じ11キーを別々に読む

### カード・レーン

- `released` が「手を離した矩形」と「放したインスタンス一式」の2つの意味で同じ呼び出し連鎖に出る
- `CardLane.beginScroll`/`scrollByDrag` が `ScrollArea.beginDrag`/`dragBy` への1行委譲で、対の語彙が入れ替わる
- `ScrollIndicator.setScroll(scrollX, minScrollX)` が実装する契約 `ScrollReadout.setScroll(offset, minOffset)` と引数名がずれる

### ウィンドウ

- `MapWindow.placementOf` が `centerPointOf` と同じ2行を書いてから正規化している（畳める）
- `ObjectWindow.tabKeys()` と `addTabs()` の labels が、タブの並びと条件を2箇所に持ち、`showTab` が添字の一致を暗黙に前提にする
- `ObjectWindow.openTab` は `this.select(tab)` だけの1行。`addButtonRow` が `close` を受け取るのは同一性比較のためだけ

### Scene / view / looks

- `TitleScene.addMenuButton` と `NewGameScene.addFooterButton` が同型で、同じものを `content`/`label` と呼び分ける
- 同じ行スタイルが `ScenarioSelectScene`・`SlotSelectScene`（2箇所）・`SettingsScene` に写され、
  `Math.max(1, metrics.px(2))` は `src/game` 全体で14箇所（置き場は `looks/theme.ts`）
- 1つの概念に3つの名前: `cardOfType` → `CardLooks.typeContentOf` → `PlayScreenView.cardOfType`。`gaugesOfCard` → `gaugesOf` も同型
- `PlayScene.record()` の doc 冒頭2段落が `view/recording.recordChange` の doc とほぼ逐語で重複

### analysis / codex-viewer

- `codex-viewer/main.ts` の `scrollToTagSection`/`scrollToNetworkNode`/`scrollToBalanceSection` が同形3本で、
  対応する id 生成も `tagSectionId`/`balanceSectionId`/`networkNodeDomId` と語形が不揃い
- `newGameInput.ts` の `parseSeed` と `normalizeIslandName` が同じ役目に別の動詞
- `balanceTables.tickAmountsByName` が `プロパティ名 :: 条件` の連結キーを返し、`splitKey` で分解する暗黙の規約が2箇所にある

## 再チェック（PR 2〜4 を終えてから）

**目的**: 上限で打ち切られた分と、そもそも6人の目に留まらなかった分を拾う。

### 1. まず機械的に全数を出す（エージェントより先にこちら）

数え上げで済むものは、意見ではなく全数が出る。スクリプトは `scripts/` へ置き、続くものは
`tests/docs` の見張りにする。

- **docコメントの2連続**——`*/` で終わる行の直後に `/**` が来る箇所。初回は14件（PR 2 でテスト化）
- **export しているのに外部から呼ばれていない関数**——初回はこれで4件見つかった（`findMatchingStack`・
  `outcomesOf`・`propertyDescription`・`normalizedDistance`）
- **doc 中の `Xxx.yyy` 参照のうち、その名前が存在しないもの**——初回は5件
- **1行委譲の一覧**（本体が `return 何か(...)` 1文だけの関数）＋その呼び元数。呼び元1〜2のものが候補
- **同じ関数名が複数モジュールで定義されているもの**——`tryGetNode`・`objectLinkHtml`・`messageOf` がこれで出る
- **同じ型の引数が2つ以上並ぶ関数**（`WorldObject | undefined` が2つ、など）——取り違えても
  型検査を通る場所の一覧。PR 1 の `unresolvable` はここに居た

### 2. そのうえで、残りをエージェントで見る

初回と同じ6分割（`domain` トップ／`domain` 配下＋`loader`／`game/ui` カード・レーン系＋`ui`＋`art`／
`game/ui` ウィンドウ系／`game/*.ts`＋`view`＋`looks`／`analysis`＋`codex-viewer`＋その他）。
探すのは4種類——兄弟なのに名前・引数が揃っていない／存在意義の薄いラッパー／同名だが別物・同概念に別名／
docが現実とずれている。

初回との違いとして次を指示する。

- **上限を外す**（または「上位8件」ではなく「全部挙げ、重要度を付ける」に変える）
- **このファイルに載っている項目は除外**して、新しいものだけ挙げさせる
- 呼び元の数は必ず `rg` で数え、本体を読んでから書く（推測で書かない）
- 除外してよいもの: Phaser を持ち込まずに試験するための切り出し、`(...asked) => this.view.f(...asked)`
  形の転送、契約を定めるだけの型、`src/ui` が汎用ゆえの語彙の違い

### 3. 報告は鵜呑みにしない

初回も、実装してみると指摘が不完全だったものがあった（プロパティのタブは「控えを持たせる」だけでは
直らず、世界が変わるたびに渡し直す必要があった）。**着手前に必ず本体と呼び元を自分で見る。**

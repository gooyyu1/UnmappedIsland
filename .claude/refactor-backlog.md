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

## PR 2: 死んでいるものの削除と、docの取り残し

呼び元ゼロ（調査時に `rg` で確認済み）:

- [ ] `Slot.findMatchingStack`（`indexOfStack` のdocからの言及も外す）
- [ ] `analysis/effectOutcomes.outcomesOf`
- [ ] `CodexView.propertyDescription`
- [ ] `PlayerCharacter.drop`
- [ ] `PlayerCharacter.take` / `drop` / `Location.receiveItem` が受け取る未使用の `session`
- [ ] `Location.reorderItems` / `Location.reorderFixtures` / `PlayerCharacter.reorderHand`（3つとも本体は
      `member.reorderInParentSlot(at)` の1行。本番の呼び元は0で、UIは `cardOperations` から直に呼ぶ）
- [ ] `CardLooks.markOf` / `CardLooks.gaugesOf`（外部から0）
- [ ] `LocationTypeMatcher.normalizedDistance`（export しているが外部から0）

docコメントが隙間なく2連続する箇所（機械的に14件。上の説明が直下の宣言と対応していない）:

- [ ] `ObjectDef.ts`（3件。うち2件は今は無いメソッドの説明）
- [ ] `PropertyDef.ts`（2件。1件は「順不同でよい」と「宣言順に」が矛盾）
- [ ] `PassiveEffect.ts` / `views/Animal.ts` / `loader/inProgressObjects.ts`
- [ ] `PlayScene.ts`（3件。消えたウィンドウの説明・`rebuildFieldArea` が無説明）
- [ ] `ui/Card.ts`（バーの説明が「本数固定」だった頃のまま） / `ui/ProgressRing.ts`（クラスdocが定数に付いている）
- [ ] `view/PlayScreenView.ts`（`stackOf` の説明が `placeOfObject` の上）

実在しないメンバーを指すdoc参照:

- [ ] `ObjectWindow` の `decideHeight` / `ui/CardTable.ts` の `CardLane.adoptCard` /
      `ui/CardDragController.ts` の `CardLane.setCards` / `ui/CardLane.ts` の `Card.identity` /
      `analysis/effectOutcomes.ts` の `craftingSteps.track`

現実とずれた説明:

- [ ] `ObjectWindow` の「スロットのタブは右の段を使い切る」（実際は中段の全幅）と、`decideWidth` の
      「領域いっぱいまで広げて見える枚数を増やす」（`LANE_CELLS_MAX` で4枠に頭打ち）
- [ ] `CodexView.tagLabel` の「タグは表示文字列を持たない」（`tag_texts` は既にあり、ゲームは棚の見出しに使う）

予防:

- [ ] docコメントが2連続していないことを `tests/docs` で見張る（今回14件を機械的に見つけた方法）

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

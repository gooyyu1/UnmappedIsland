# 兄弟の不揃い・薄いラッパーの棚卸し（作業中の控え）

リポジトリ全体（`src/` 約37,000行）を調べて出た指摘を、PRに割ったもの。**全部終わったらこの
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
「8件に入らなかったもの」を別に挙げていた（PR 5 で片付けた分）。**上限を外した再チェックで、
さらに約150件が出た**（下の「再チェック」）。

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

## PR 3: 二重化を1つに畳む ✅ 完了

- [x] `tryGetNode` の複製を消し、`yamlMapping` の1本へ寄せた（輸入元6モジュール）
- [x] 「未知のキーを弾く」を `yamlMapping.requireKnownKeys` 1本へ。`rejectUnknownKeys`・
      `checkUnknownKeys` と直書き12箇所を畳んだ（調査時の「直書き5箇所」は数え漏れで、実際は12）
- [x] 時刻の分解を `looks/durationText.clockParts` へ。`showClock` と `clockText` が同じ1本を通る
      （`showInformation` はワールドが持つ日・時・分を出す別経路なので触っていない）
- [x] 「先勝ちで畳む」を `statusChanges.mergedStatuses` 1本へ（`allStatuses` と `ShownStatuses.all`）
- [x] `MINUTES_PER_TICK` は `balanceTables` の1つに。`balancePage` の「1 tick = 15分」も定数から出す
- [x] レーンの幅の式を `laneCells.laneWidthForCells` 1本へ（`ExplorationPane.width` と `laneWidthFor`）
- [x] `objectLinkHtml` を `pages.ts` の1本に。絵を出すかは引数
- [x] `staticValueOf` の素通しを畳み、`declaredValueOf` を消した
- [x] `PropertyValue.registerPassiveEffect` → `RegisteredPassiveEffect.registerInto` の2段中継を外し、
      `PassiveEffect.register` が対象のプロパティ値へ直接 `registerInto` する形にした
- [x] 生成器2種を `GeneratedObjectDefs`（yamlと座標の組）で揃え、呼び元の同型14行を
      `WorldCodexYamlLoader.loadGenerated` 1本へ。名前から座標を復元する経路（`inProgressCoordinateOf`）は不要になった
- [x] `ACTION_HEIGHT` の同名衝突 — **畳まずに改名した。** `childWindowLayout` は自ら「子ウィンドウ
      （探索・スロット・オブジェクト・プロパティ）で共通の寸法」と宣言していて、`ModalDialog` は
      `StartScreen_Mock.html` に由来する別系統。値を揃えると見た目が変わるうえ、由来の違いが消える。
      同名だけを解消し（`PLATE_*`・`BUTTON_*`）、台紙を指す `card` も `plate` へ改めた。
      **共通トークンへ寄せるかどうかは仕様判断なので未着手**——やるならボタンの高さが 72 → 88 になる。

## PR 4: 兄弟の名前と引数を揃える ✅ 完了

- [x] loader のパーサ5本を多数派の `(loader, context, node)` へ寄せた
- [x] `describe*` のうち**断片を返す9本を `*Tokens` へ改名**（`conditionTokens`・`typeMatchTokens`・
      `cellTokens` ほか）。これで `describe*` は「行を書く」11本だけになり、名前から戻り値が読める。
      `stageTokens` の引数順も他と同じ「対象固有の引数 → names」へ
- [x] `ui/Card.ts` の `show*` を**全部 `content` 先頭**に揃え（`showStackCount`・`showCooking`）、
      `showOverlay` を `showMark` の中からではなく `applyContent` から直接呼ぶようにした。
      窓の矩形と余白は `applyContent` で1度だけ求めて両方へ渡す
- [x] `ui/Card.ts` のモジュール関数を `create*` に統一（`createEmptyOutline`・`createPaper`・
      `createArtImage`）。主題を末尾に置く引数順へ（`createIconText`・`createArtImage`）
- [x] `ObjectWindow` のレーンを `contentLane` / `cardLane` / `foundLane` で揃え、フィールド名も一致させた
- [x] `RecipeWindow.destroy` → `close`。「閉じる」ボタンも他の4つと同じく自分を畳んでから通知する
      （2度呼ばれても壊れないようにした）
- [x] `PlayScene` の `slotButtonIcon` と `barIcon` を `buttonIcon` 1本へ。差は敷く寸法と絵文字の
      大きさの2値だけだった
- [x] `openSlotWindow` を `openCharacterWindow(opensPlace?)` へ畳んだ（どちらもキャラクタ自身の窓で、
      差は「そのタブから開くか」と「アクションを出すか」の2点）
- [x] `elapseSteps` / `elapsedSteps` → `playbackSteps` / `afterPlaybackSteps`（型も同様）
- [x] 静的ファクトリを `ofX` に統一（`TypeMatchRule.ofTag`/`ofObjectDef`・`WeightSpec.ofLiteral`/`ofPath`）。
      `ObjectRef` の内部フィールドも `objectGlobalId` へ揃えた（読み上げのキーと同じ語彙）
- [x] `InteractionDef.acceptedCountOf` を削除（`effect` を `protected` にして直に訊く）
- [x] `PropertyValue` の派生読みをゲッターへ揃え（`artSuffix`・`exhaustedStage`）、`PropertyDef` 側も
      `alertOf`（`alert` と語幹を一致）・`isExhausted(rawValue)` へ
- [x] `CardLane.slotRect` → `cellRect`、`addPinnedSlot` → `addPinnedCell`（クラス全体の cell の語彙へ）
- [x] `art/backgroundArt` を `laneBackgroundTexture` / `cardBackgroundTexture` の対に
- [x] `PlayScene.cardsAt` を畳み、`ShownCards` への受け口を規約どおりの `(...asked)` 形にした
- [x] `views/Location.slotStacks` を `stacksOf` へ（`PlayerCharacter` と同じ名前に）
- [x] `cellsAt` / `portraitCells` / `foundCells` — **揃えなかった。** 前者はワールドの場所の枠、後の2つは
      画面だけの置き場（ポートレイト・発見物）の枠で、答えている問いが違う。`xxxCells` と `cellsAt` の
      作り分けはその違いを表している

**畳まなかったもの（理由つき）**

- `addSlotButton` と `addIconButton` の受け渡しの向き（片方は結線して捨てる、片方は `Button` を返す）。
  返す側は呼び元がボタンを持ち続けて状態を切り替えるためで、差に理由がある
- `WorldObject.acceptedCountForMoveTo` の名前。対になる `rejectionForMoveTo` と語形が揃っており、
  組み合わせの `acceptedCount` とは訊いている相手が違う
- `ConditionNode` の裸の名詞のファクトリ（`property`・`all`・`not` ほか）。数が多く、宣言の語彙と
  1対1で対応している

## PR 5: 上限からこぼれた分 ✅ 完了

調査時に各担当が「重要度で8件に入らなかった」として挙げた22件。**着手前に本体と呼び元を全部
自分で見た**——数の食い違いも含め、下は確認した後の姿。

直したもの:

- [x] `messageOf` の3重定義を `loader/errorMessage.ts` 1本へ（`loadDefinitions`・`RawPatch`）。
      `game/errorReport` の同名は引数も戻りも別物なので触っていない
- [x] `WorldCodexYamlLoader.parseObjectDef` を唯一の呼び元へインライン化（`new RawObjectDef` するだけだった）
- [x] `WorldCodexYamlLoader.parseTrait` を削除し、11キーの読み取りを `RawTrait.readFields` へ移した
      （`RawObjectDef` と同じく「自分のことは自分でする」形になった）
- [x] passives を溜める配列の名前を `output` → `passives` に揃えた（`parsePassive` / `parseProp`）
- [x] `ValueNoise.sample` → `noiseAt`（`AxisSampler` の別名輸入 `sampleNoise` が消えた）。
      1オクターブ側も `sampleSingle` → `octaveAt` へ
- [x] `Slot.canAccept` → `rejectionFor`。理由を返す関数が `WorldObject.rejectionForMoveTo` /
      `rejectionForLoopOrDetach` と語形で揃った（`can*` は真偽を返すように読める）
- [x] `CardDragController` の `released: Rect` → `releasedRect`（`MotionContext.released` は
      「放した個体一式」で別物。同じ呼び出し連鎖に2つの意味の `released` が居た）
- [x] `ScrollIndicator.setScroll(scrollX, minScrollX)` → `(offset, minOffset)`。実装している契約
      `ScrollReadout` と同じ語彙にし、`ui/scroll.ts` 側（`scrollThumbSpan`・`clampScroll`）も揃えた
- [x] `MapWindow.placementOf` が `centerPointOf` を呼ぶようにした（同じ2行を書いていた）
- [x] `ObjectWindow` のタブの並びを `tabs()` 1本に。`tabKeys()` と `addTabs()` の2箇所が持っていた
      「並びと出す条件」が1箇所になり、`showTab` の添字の一致も同じ並びから出る
- [x] `TitleScene.addMenuButton` の引数 `content` → `label`（`NewGameScene.addFooterButton` と同型）
- [x] `CardLooks.typeContentOf` → `cardOfType`、`gaugesOfCard` → `gaugesOf`。
      1つの概念が3つの名前で受け渡されていたのが1つになった
- [x] `codex-viewer/main.ts` の `scrollTo*` 3本を `scrollToSection(parts, route, domId, options?)` 1本へ。
      `networkNodeDomId` → `networkNodeId` で id 生成側の語形も揃えた
- [x] `PlayScene.record()` の doc から、`recording.recordChange` と逐語で重なる2段落を落として参照にした
- [x] `Math.max(1, metrics.px(n))` 35箇所 → `ScreenMetrics.linePx(n)`。「線は1px未満にすると消える」を
      寸法を知っている側が持つ（`fontPx` の隣）
- [x] 一覧の行の台紙を `looks/theme.rowPlateStyle(metrics)` 1本へ（シナリオ選択・保存スロット2箇所・設定）

**直さなかったもの（理由つき）**

- `matches` が定義引き（`TypeMatchRule`）と個体引き（`ObjectStack`）の両方に居るのは、どちらも
  「この鍵に合うか」で問いが同じ。`CellDef.accepts` / `SlotDef.acceptsAnywhere` / `Slot.rejectionFor` の
  3語も、訊いている相手（この枠／どれかの枠／今この個体）が違う
- `parseProperties.parseRangeEventEffect`（呼び元1）。`parseActiveEffectBody` に真偽2つを足すだけだが、
  その2つに名前を与えているのがこの関数の値打ち
- `ObjectWindow.openTab`（`select` への1行）。外から押す入口と内部の選択を分けている
- `CardLane.beginScroll` / `scrollByDrag`（`ScrollArea` への1行委譲）。`ScrollArea` は private なので、
  これを外すと呼び元が中身を知ることになる
- `newGameInput.parseSeed` と `normalizeIslandName`。parse は型が変わり、normalize は同じ型のまま
  整えるので、動詞が違うのは差そのもの
- 生成の段関数の粒度と引数順（`place`/`sample`/`build` と `assignTypes`/`assignNames`/`triangulate`）。
  段ごとに要る材料が違い、揃えると使わない引数を配ることになる
- `balanceTables.tickAmountsByName` の連結キーと `splitKey`。規約は1モジュールの中で閉じている

## 再チェック ✅ 調査完了（PR 6 で一部着手）

**やったこと**: 機械的な全数出し（数え上げ）→ 6分割のエージェント調査（上限なし・既出は除外）。
挙がったのは約150件で、**PR 6 では「機械的な分」と「docが現実とずれている分」だけを直した**。
残りは下の PR 7〜9 に割ってある。着手前に必ず本体と呼び元を自分で見ること（報告の数え間違いが実際にあった）。

### PR 6 で直した分 ✅

- 数え上げ: コメントが指す今は無い名前8件（`tests/docs/docMemberReferences.test.ts` で見張る）、
  モジュール内でしか使わない export 3件、死んでいた `FLY_EASE`、`scalarText` の重複
- docの現実合わせ: spawnの「強制配置（force）」4箇所（実装は親へこぼれて消える）、生成の宣言の
  スケール4件、今は無い名前を指す説明6件、「画面が名前で指せる5つ」→3つ、`autoFillMaterials` の
  探索順の決めごとを呼び元へ、`tabObjects`/`openedTab` の削除、
  errorReport の行き先が `[object Object]` になっていた不具合、`docComments.test.ts` の判定を
  「空行を挟んだ2連続」まで拡張

### PR 7: 名前と引数順を揃える ✅ 完了

- **domain**: `ObjectDef.getPropertyDef`/`getSlotDef` → `tryGet*`（`WorldObject` 側の `get`=投げる、
  `tryGet`=undefined の規約に揃えた）／`Slot.trySetManualPosition` → `tryMoveStackToCell`／
  `WorldObject.artSuffix`・`exhaustedStage` をゲッターへ／`WorldCodex.symbolName` を足した／
  `WorldSession.recordSignal(object, name)`／`PickEffect.selectWeighted(owner, session, actor, dragged)`／
  `crafting.advanceCrafting(inProgress, materialsSlotGlobalId, recipe, …)`／
  `SlotDef.putInMinutes(owner, actor, item)`・`Slot.putInMinutes(actor, item)`（PR 1 の残り）／
  `TransferEffect.collectInfluences` → `collectTransferInfluences`
- **game**: `ProgressRing.setProgress` → `setRatio`／`StatusBar.show(content, y)`／
  `PlayScene.cardsOf` → `stacksOf`／`theme.fillColorFor` → `statusFillColorFor`／
  `errorReport.stackOf` → `stackTraceOf`／`FlipCalendar.addCardPaper` → `createDigitPaper`／
  `Card.addStackBadge` → `createStackBadge`／`MapWindow.traySlot` → `trayCell`／
  `separatorAt` → `horizontalSeparatorAt`（3つ目の引数名も両方 `thickness` へ）／
  `ExplorationPane.noteFor` → `noteOf`／`openObjectWindow` の `opensPlace` → `opensFirstSlot`
- **codex-viewer / analysis**: `CodexView.objectNamesWithTag` → `objectsWithTag`／
  `objectGridOf` → `matchingObjectsHtml`／`identifierLine` の引数順を `headingIdentifier` へ揃えた／
  `pillNodeHtml` → `tagNodeHtml`（引数7つ→3つ）／`describeCondition.ts`ほか3ファイルを `*Tokens.ts` へ／
  `balanceSectionId` の引数名／`addTokens` の `names` を末尾へ／`ticksToRangeEnd(propertyDef, value, perTick)`／
  `balanceTables.Requirement` → `DailyNeed`（`.dailyNeed` は `.amount` へ）／`ImportedCost` を `StepCost` へ
- **loader**: `requireKnownKeys(node, known, context, note?)`（24箇所）／`seqAt` → `descendToSeq`／
  `parse*TargetKey` → `parse*TargetRoot`／`axisVariantsYaml`・`readAxes` の `loader` を先頭へ／
  `tryGetBool` の必須fallbackを外し、既定値は呼び元の `?? false` に統一

### PR 8: 畳む ✅ 完了

- `CardTable.carry` を `flyTo` へ（あふれた札の帰りも、ついてくる札と同じ1本の便で飛ぶ）
- `Location.stacksOf`/`PlayerCharacter.stacksOf` の同一実装を `Slot.stacks` へ
- 対象キーの解決3箇所（`resolveReferenceRoot`・`WorldObject.resolveEffectTarget`・
  `PassiveEffectGate.resolve`）を1本へ。ゲートは actor/dragged を持たない文脈として同じ関数を通る
- `WorldObject.clampToRange` を消して `PropertyRange.clamp` へ
- `unmetRequirement` を基底の public 1本に（`ActionDef`/`CombinationDef` の派生2つを削除）
- 呼び元ゼロ・素通しの削除: `statusChanges.allStatuses`・`PlayScreenView.contentsOf`・
  `cardLooks.inProgressDef`・`ShownCards.dropAction`・`RecipeDef.isUnlocked`・
  `PropertyDef.hasInitialValueRoll`・`InteractionDef.draggedReading`（`triggerReading` から読む）・
  `PickEffect` の転送2本・`Modify`/`AccumulateEffect` の素通しコンストラクタ・`CardTable.startFlight`・
  `CardDragController.cardTarget`。`Button.boxWidth`/`boxHeight` は private へ
- `Card` の veil 2本を `createVeil` 1本へ
- `writesToProperty`/`passiveWritesToProperty` の二重実装を `effectQueries` の1モジュールへ（判定も共有）
- `describeRequirements` を `readonly Requirement[]` 受けにして `describeInteraction` も乗せた
- `divideCost` → `scaleCost(1/n)`／キー名の列挙を `yamlMapping.keysOf` 1本へ（4箇所）
- loader: 「1件か配列か」を `oneOrMany` 1本へ（spawn・transfer・move）／「候補と突き合わせる」を
  `yamlMapping.oneOf` 1本へ（gauge・alert）／`parseGeneration` の context 二重組み立て（3組）／
  `RawPatch` の add/set/remove が同じ `descendToKey` を通る
- ウィンドウ: 「閉じるの行」を `closeRow` 1本へ（ステータス詳細も合流）／`Button.textButtonBoxStyle`・
  `tabBoxStyle` で既定の補完と選択中の塗りを1箇所に／760 の相互参照を
  `childWindowLayout.MIN_WINDOW_WIDTH` へ／`RecipeWindow` の覆いを後片付けの並びへ

### PR 9: 自分のことは自分でする（構造）

- **`ProgressBar.setRatio`/`resetRatio` の呼び分けを、呼び元3箇所が同じ手順で覚えている**
  （`if (showChange && 見えていた) setRatio else resetRatio`）→ バー自身が決める
- `CardDragController` の private 7本で `gesture` を渡す/引き直すが割れている
- `MapWindow`・`ObjectWindow`・`WeatherPanel`・`FlipCalendar` が、持っている `scene`/`metrics` を
  private メソッドへ渡している
- `StatusBar.createLabel` が metrics から引ける数値3つを受け取る
- `PassiveEffectGate` の `propertyGlobalId`/`stageName` を1つの `stage` に（`!` が消える）
- `EffectReader.add` の三つ組を `LinkedAddReading` に寄せる（同じファイルに同じ形の型が在る）
- `Localization` のコンストラクタ10引数（同型4つ）→ 節のオブジェクト1つ
- `zip.contentOf` の末尾4数値 → 中央ディレクトリ1エントリの型
- `NewGameScene` の高さが2通りに計算されている／`WeatherOverlay.addLayer` が style の5値を別引数で上書き
- 層（depth）の階梯が `PlayScene`・`DustPuff`・`CardTable`（無名の1）に散っている

### 相談した8件（PR 6 で7件を反映済み）

- ✅ タブの記憶（並んでいるタブならどれでも復元する）／地図の黒枠の角丸（Cardへ揃えた）／
  `deviceCount` の式／型の絵の在庫表の改名／`RecipeWindow` の寸法の合流／天候の引き直し
- ⏸ **`Pcg32.nextInt`（閉区間）と `Rng.nextInt`（半開区間）が同名で逆。** `seededRng` は Pcg32 を
  包むのに委譲できず式を組み直している。改名だけなら安全、契約を揃えると地形のシード再現性が
  変わる。**全部終わってからもう一度訊く**
- ✅ `rangeCyclesOf` の「解けなかった印」が宣言順に依存していた（`staticValue.trackingResolverOf`
  へ寄せ、読み出し1回ぶんに閉じた）。`snare.durability.on_min` に誤って付いていた印が消えた

### 調査のやり方（次に繰り返すとき）

数え上げ → 6分割のエージェント（`domain`直下／`domain`配下＋`loader`／カード・レーン＋`ui`＋`art`／
ウィンドウ／`game`直下＋`view`＋`looks`／`analysis`＋`codex-viewer`ほか）。**上限を付けない・
このファイルの既出を除外・呼び元は必ず `rg` で数える**を指示に入れる。報告は鵜呑みにしない
（今回も件数の食い違いと、誤検出が複数あった）。

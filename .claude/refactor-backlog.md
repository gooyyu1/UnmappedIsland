# 兄弟の不揃い・薄いラッパーの棚卸し（作業中の控え）

リポジトリ全体（`src/` 約37,000行）を調べて出た指摘を、5つのPRに割ったもの。**全部終わったらこの
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
「8件に入らなかったもの」を別に挙げていた（PR 5 で片付けた分）。**PR 1〜5を終えても
片付いたことにはならない**——「再チェック」の節に従ってもう一度調べる。

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

## 再チェック（PR 1〜5 を終えてから。**次はここ**）

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

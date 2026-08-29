# game-view / shared — 判定3の再点検

対象は担当範囲（`src/game/view/` `src/game/looks/` `src/locale/` `src/ui/` `src/art/` `src/util/`）の
**private メソッド・private static・export されていないモジュール関数**の全件（42件）。
private フィールドと private readonly は対象外（状態であって手続きではない）。

「主語」は**そのヘルパーが値を読み書きしている対象**で判定した。自クラス／自モジュールのフィールドや
定数しか触っていなければ「自分」、引数で受け取った他の型 B の中身を組み立て直している・問い直して
いるものを「他（B）」とした。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/game/looks/PlayScreenLayout.ts | 5 | 3 | 2 |
| src/game/looks/theme.ts | 1 | 0 | 1 |
| src/game/view/PlayScreenView.ts | 1 | 0 | 1 |
| src/game/view/ShownCards.ts | 5 | 3 | 2 |
| src/game/view/ShownStatuses.ts | 3 | 1 | 2 |
| src/game/view/cardOperations.ts | 1 | 1 | 0 |
| src/game/view/craftingView.ts | 3 | 0 | 3 |
| src/game/view/elapsePlayback.ts | 1 | 1 | 0 |
| src/game/view/recipeList.ts | 1 | 0 | 1 |
| src/game/view/recording.ts | 1 | 0 | 1 |
| src/game/view/slotCells.ts | 1 | 1 | 0 |
| src/game/view/statusRows.ts | 1 | 0 | 1 |
| src/game/view/tickProgress.ts | 3 | 2 | 1 |
| src/locale/Localization.ts | 6 | 6 | 0 |
| src/ui/holdRepeat.ts | 1 | 1 | 0 |
| src/ui/nineSlice.ts | 2 | 1 | 1 |
| src/ui/shapes.ts | 3 | 0 | 3 |
| src/art/backgroundArt.ts | 3 | 2 | 1 |
| （ヘルパー0件のファイル 34件） | 0 | 0 | 0 |
| **合計** | **42** | **22** | **20** |

ヘルパーが1件も無いファイルが34件（`cardLooks.ts` `cardMotionPlan.ts` `characterCard.ts` `Rect.ts`
`scrollArea.ts` `util/*` ほか）。これらは「本体だけで書き切っている」のであって、補い方の問題が
無いという意味ではない（`cardLooks.ts` は本体の中に世界の識別子を直書きしている。第1波の指摘のまま）。

## 主語が他にあるヘルパー

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| src/game/view/tickProgress.ts#TickProgress | `static markUpTo` | `WorldSession.advanceWorldTime` / `World`（世界の時計） | 「開始時刻から duration の間に tick が回る瞬間はいつか」を答える口。世界は tick を**回す**が、いつ回るかは誰にも言わない | 消える。区切りの列を世界（または `Recording`）から受け取れば、`marks` は引数になる | 世界側に「時間を進めずに境界だけ数える」入口が無い。今は `advanceWorldTime` の中の剰余算を映しが写している |
| src/game/view/craftingView.ts | `locationItems` | `domain/views/Location` | **足りていない機能は無い。`Location.items` が既に在る** | 消える。`game.player.location?.items ?? []` で済む | 阻害要因なし。`.instance` へ降りた時点で view を捨てているだけ |
| src/game/view/craftingView.ts | `contentsOf` | `WorldObject` / `Slot` | 「その枠の中身。枠を持たなければ空」の1本。`tryGetSlot` が `undefined` を返すので毎回受け側が畳む | 消える | 無し（下の「同じBに複数のA」参照。`Location`・`PlayerCharacter` が同じものを private で持っている） |
| src/game/view/craftingView.ts | `progressOf` | `domain/crafting.ts` | 製作中オブジェクトの進捗を**オブジェクトから**読む口。`crafting.ts` は `progress` を数値の引数でしか受けず、誰かが `vocabulary.engine.progressId` を引く役を負う | 消える。`currentStep(recipe, object)` の形にすれば引数からも消える | 無し |
| src/game/view/PlayScreenView.ts | `stacksIn` | `Slot` | 空き枠を保ったままの束（`slot.cells.map(c => c?.members)`）。`Slot.stacks` は前詰めで空き枠を落とす | 消える | 無し |
| src/game/view/recipeList.ts | `actorOnly` | `RecipeDef.unmetUnlockRequirement` | 「まだ実体が無いので actor しか解決できない」という**ドメインの規則**（GameElementDefinition.md 13.3節）を、B が自分で持てない。B は汎用の `resolveRoot` を要求する | 消える。`unmetUnlockRequirementFor(actor)` を足せば呼び出しは1行 | 無し。`unmetUnlockRequirement` の呼び出し元は src 内でここ1箇所だけ |
| src/game/view/recording.ts | `shownPlacesOf` | `src/game/view/cardPlaces.ts`（`ScreenPlace`） | `ScreenPlace` は3値の union だが**全件の並び**を持たない。`fixtures→items→hand` の順を使う側が書き写す | 消える | 無し（`ShownCards.edgeTargets` も同じ並びを書き写している） |
| src/game/view/statusRows.ts | `groupOf` | `domain/AlertLevel` | 深刻さの**順序**を答える口。`ALERT_LEVELS` は「ロード時の検証用」の配列で、順序はコメントにしか無い | 半分消える。`safe` を最後尾へ回すのは並べ方（映しの話）なので残るが、`watch`/`caution`/`danger`/`fatal` の手書きの分岐は消える | 無し |
| src/game/view/ShownStatuses.ts#ShownStatuses | `shown` | `game/ui/StatusBar.StatusContent` | 「世界が言う1行」と「ステータスエリアが上に載せる飾り（`pinned`・`midAction`・`change`・`ratioBefore`・操作口）」が1つの interface に同居していて、後者は全部 optional。映しが全行に spread で押し直すしかない | 消える。飾りを別の型（`StatusRow = { content, decoration }`）にすれば、押し直しではなく組み立てになる | `StatusBar` が1つの型で受ける契約なので、分けると部品側の口も変わる |
| src/game/view/ShownStatuses.ts#ShownStatuses | `entries` | `game/ui/PropertiesPane.PropertyCategory` | タブ全部の行を平らに読む口 | 消える | 無し（`statusChanges.mergedStatuses` が近いことをしている） |
| src/game/view/ShownCards.ts | `awaitingStack` | `ObjectCardStack`（`PlayScreenView.ts`） | 「顔だけで操作を持たない束」を作る口。B は interface なので構築の手立てを持たず、A が7フィールドを手で並べる | 消える（`PlayScreenView.ts` へ移る。A からは消える） | B が interface で、`game/ui/cardFace.ts` の `cardFace` は `CardContent` までしか作れない（`ObjectCardStack` は映しの型なので `game/ui/` からは組めない） |
| src/game/view/ShownCards.ts | `awaitingMark` | `CardContent` / `game/ui/cardFace.ts` | 同上。`cardFace` の隣に「identity を空にした印」が無い | 消える（`cardFace.ts` へ移る） | 同上 |
| src/game/looks/PlayScreenLayout.ts | `horizontalSeparatorAt`, `verticalSeparatorAt` | `src/ui/Rect.ts` | `Rect` は4フィールドの interface で**演算を1つも持たない**。「span の中心に幅 h の帯」は純粋な幾何 | 消える | 無し |
| src/game/looks/theme.ts | `gaugeEndColor` | `domain/PropertyDef.GaugeEnd` | **足りていない。が、足すべきでない**（色は意匠の語彙で、世界が持ってはいけない） | 消えない。ここに在るのが正しい | 層の境界そのもの（CodeStructure.md 3節）。真の判定3 |
| src/ui/shapes.ts | `fittingRadius` | Phaser `Graphics.fillRoundedRect` | 幅が丸みの2倍より狭いと弧が矩形の外へ膨らむ（Phaser の不具合）。B に丸みのクランプが無い | 消えない | B が外部ライブラリ。`src/ui/` は「Phaser の足りない分・間違っている分を埋める」場所なので、これは正しい配置 |
| src/ui/shapes.ts | `strokeDashedBox`, `dashedLine` | Phaser `Graphics` | 破線のストロークが無い | 消えない | 同上 |
| src/ui/nineSlice.ts | `addSliceFrames` | Phaser `NineSlice` / `Textures` | `NineSlice` が Canvas レンダラを持たない（`renderCanvas` が NOOP） | 消えない | 同上 |
| src/art/backgroundArt.ts | `ownerOf` | 世界のスロット名・object_def 名 | 「スロット名にも用途にも `_` は入らない」という**世界側の識別子への制約**を、B が保証も検査もしない | 消えない（ファイル名の分解自体は素材の仕事） | 世界の宣言に「識別子に `_` を使わない」規則が無いので、破られたら黙って別の持ち主として読む |

### ヘルパーではないが、同じ形のもの

判定の対象は private/非 export に限ったが、**public でも A が B の不足を補っている**ものが同じ形で
見つかったので併記する（第1波の `MINUTES_PER_DAY` と同種）。

| 現在地 | 名前 | 主語(B) | Bに足りない機能 |
|---|---|---|---|
| src/game/looks/durationText.ts | `MINUTES_PER_DAY = 24 * 60`（非 export の定数） | `domain/views/World` | `World.totalMinutes` は `((day-1)*24 + hour)*60 + minute` と**同じ 24 と 60** を持つが、逆向き（総分→日時分）の分解を持たない。暦の形が世界と意匠の2箇所にある |
| src/game/looks/theme.ts | `statusFillColorFor`（export） | `domain/AlertLevel` | `ALERT_LEVELS.indexOf(alert) / (length-1)` で深刻さを0〜1に直している。B に `severityOf` が無い |
| src/game/looks/skyTint.ts | `BRIGHTEST = 16`, `NEUTRAL_BRIGHTNESS = 11` | `WorldCodex` / core.yaml | `ambient_brightness` の宣言上の range は `{min:-6, max:17}` で、**実際に届く最大**（太陽高度+16 と天気0 の和）は宣言から機械的に出せない。意匠がコメントで手計算している。`NEUTRAL_BRIGHTNESS = 11` も core.yaml の `bright` ステージの `min: 11` と手で一致している |
| src/art/artFiles.ts | `locationDefNames`（export） | `WorldCodex` | 「入っていく土地か」を名乗る印が宣言側に無い（`location` タグは筏にも付く）ので、**背景の絵を持つか**を代用にしている。素材の有無が世界の分類を決めている |
| src/locale/Localization.ts | `parseLocale` 内の10回の繰り返し | `src/loader/yamlMapping.ts` | 「1つの節を `Map<string, T>` に読む」形が10回インラインで書かれている。`entriesInOrder`+`asMap`+パーサの組を1つにする口が loader に無い（同じ形は `src/loader/` 側にも散っている） |

## 同じ B に対して複数の A が補っているもの

### 1. B = `Slot` / `WorldObject`（枠の中身と束の読み出し）— A が4つ、ヘルパー5本

| A | ヘルパー | 実体 |
|---|---|---|
| `src/game/view/PlayScreenView.ts` | `stacksIn` | `slot?.cells.map(c => c?.members) ?? []` |
| `src/domain/views/PlayerCharacter.ts` | `handStacks`（public） | `slot === undefined ? [] : slot.cells.map(c => c?.members ?? [])` |
| `src/domain/views/PlayerCharacter.ts` | `private stacksOf` | `tryGetSlot(id)?.stacks ?? []` |
| `src/domain/views/Location.ts` | `private stacksOf` | `tryGetSlot(id)?.stacks ?? []`（PlayerCharacter と**完全に同一**） |
| `src/domain/views/Location.ts` | `private slotContents` | `tryGetSlot(id)?.contents ?? []` |
| `src/game/view/craftingView.ts` | `contentsOf` | `tryGetSlot(id)?.contents ?? []`（`slotContents` と同一） |

**B へ足すのは2つだけ。** `Slot` に「空き枠を保った束」（`cells` を畳んだもの、`stacks` の空き枠あり版）、
`WorldObject` に「その枠が無ければ空として読む」3本（`contentsIn` / `stacksIn` / `cellStacksIn`）。
これで上の6本すべてが消え、**ドメインの2つの view クラスに在る同名の重複（`stacksOf` が2つ）も同時に
消える**。優先度が最も高いのはここで、映しの1本を直す話ではなくドメイン側の重複がまとめて畳める。

### 2. B = `domain/AlertLevel`（深刻さの順序）— A が3つ

| A | 場所 | 実体 |
|---|---|---|
| `src/game/looks/theme.ts` | `statusFillColorFor`（export） | `ALERT_LEVELS.indexOf(alert) / (ALERT_LEVELS.length - 1)` |
| `src/game/view/statusRows.ts` | `groupOf`（非 export） | `safe→3` / `watch|caution→2` / それ以外→1 の**手書きの表** |
| `src/domain/PropertyDef.ts` | `private static deriveAlertDirection` | `ALERT_LEVELS.indexOf(stage.alert)` を並べて単調性を見る |

`ALERT_LEVELS` の doc は「ロード時の検証用。並びは軽い順」と書いてあり、**順序であることは
コメントにしか無い**。`severityOf(alert): number` を1つ足せば、3箇所の `indexOf` と手書きの表が
全部それ経由になる。`groupOf` の「`safe` を最後尾へ回す」だけが映しの都合として残る。

### 3. B = 世界の宣言に「印」が無い — A が3つ（第1波の指摘と地続き）

| A | 代用しているもの |
|---|---|
| `src/game/view/PlayScreenView.ts` | `EXPLORE_ACTION = 'explore'`（アクション名の一致で「探索か」を見分ける） |
| `src/art/artFiles.ts` | `locationDefNames`（**背景の絵を持つか**で「入る土地か」を見分ける） |
| `src/game/view/cardLooks.ts` | 7つのプロパティ名・スロット名・段名の直書き |

同じ「宣言側に印が無い」という1つの欠落を、映しは**名前の一致**で、素材は**絵の有無**で代用している。
素材（`src/art/`）が世界の分類を絵の在庫で決めているのは、第1波が「素材をゲーム側へ引っ張る依存」と
呼んだものの最も強い形。

### 4. B = `src/game/view/cardPlaces.ts`（常設3レーンの並び）— A が2つ

`recording.shownPlacesOf` と `ShownCards.edgeTargets` が、どちらも
`places('fixtures'), places('items'), places('hand')` を書き写している。`ScreenPlace` の全件と
その上下関係を `cardPlaces.ts` が持てば、`shownPlacesOf` は消え、`edgeTargets` は並びの参照になる。

### 5. B = 世界の時計（`World` / `WorldSession`）— A が2つ

`tickProgress.markUpTo` が tick 境界の並びを剰余算で作り直し、`durationText` が日・時・分の分解を
`24 * 60` で作り直している。世界は tick を回し（`advanceWorldTime`）、総分を合成する
（`World.totalMinutes`）が、**どちらも逆向きを持たない**。
とくに `markUpTo` は、同じ境界の時刻を `recording.ts` が
`observeTicks` 経由で `RecordedView.minutes` として**既に世界から受け取っている**——
`ElapsePlayback.dueAt` はその2つ（世界が言う時刻と、映しが計算した目盛り）を突き合わせて控えを出す
ので、**両者が一致することが再生の正しさの前提**になっている。同じ事実の2通りの導出が、
1つの比較式の左右に並んでいる。

## `src/locale/` についての結果（依頼の名指しぶん）

`Localization.ts` の private ヘルパー6本（`format` `member` `merged<T>` `parseEntry`
`parseVariationNames` `parseTexts`）は、**主語がすべて自分**だった。`WorldCodex` を主語にするものは
1つも無い。

`WorldCodex` を主語にしている処理は `Localization` に確かに在るが、それは private ヘルパーではなく
**public な `locationName`（`LocationName` の3フィールドを組み立てる）と、外の
`typeDisplayName`（`codex.variationsOf` / `codex.baseOf` を畳む）**の2つ——どちらも「引く」ではなく
「組み立てる」で、片方はクラスの中、片方はクラスの外に在る。第1波が「引く／読む」の2責務と見た
分割線は、ヘルパーの層では起きていない。

したがって locale については「B の機能不足を A が private で補っている」形は無く、第1波の
判定（責務の同居と、名前組み立ての二分）がそのまま最終の答えでよい。

## 阻害要因の分布

「消えない」と答えた6本のうち5本は **B が Phaser または層の境界**だった
（`shapes.ts` 3本・`nineSlice.ts` 1本・`theme.gaugeEndColor`）。これらは `src/ui/` と
`src/game/looks/` の存在理由そのものなので、真の判定3として動かさなくてよい。

残り14本は**すべて B が自分たちのコード**（domain 7本・view/ui の型 5本・`src/ui/Rect.ts` 2本）で、
阻害要因を書けたのは3本だけ（`ShownStatuses.shown` の型分割、`awaitingStack`/`awaitingMark` の
配置先）。**11本は「B に足せば消える。何も阻んでいない」**——第1波が判定3として通した
「利用者が近くにいるので置かれている」の実体は、その大半が「B が答えられないので A が代わりに
答えている」だった。

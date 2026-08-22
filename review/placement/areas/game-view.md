# game-view

対象: `src/game/view/`（映し）と `src/game/looks/`（意匠）。28ファイル / 423宣言。
判定は Layers.md 3節（「何が出ているか」なら映し／「どう見せるか」なら意匠／座標・ミリ秒・Phaser表示物なら部品）を全宣言へ一度ずつ当てたもの。

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/game/looks/PlayScreenLayout.ts | 34 | 30 | 1 | 3 | 0 | 0 |
| src/game/looks/ScreenMetrics.ts | 15 | 13 | 0 | 2 | 0 | 0 |
| src/game/looks/cardFlight.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/game/looks/childWindowLayout.ts | 8 | 7 | 0 | 1 | 0 | 0 |
| src/game/looks/durationText.ts | 5 | 4 | 0 | 1 | 0 | 0 |
| src/game/looks/heatHaze.ts | 8 | 8 | 0 | 0 | 0 | 0 |
| src/game/looks/rainStyle.ts | 22 | 21 | 0 | 1 | 0 | 0 |
| src/game/looks/screenDepth.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/game/looks/skyTint.ts | 10 | 10 | 0 | 0 | 0 | 0 |
| src/game/looks/theme.ts | 23 | 20 | 1 | 1 | 1 | 0 |
| src/game/view/PlayScreenView.ts | 63 | 54 | 5 | 1 | 3 | 0 |
| src/game/view/ShownCards.ts | 42 | 30 | 6 | 6 | 0 | 0 |
| src/game/view/ShownStatuses.ts | 22 | 16 | 6 | 0 | 0 | 0 |
| src/game/view/cardLooks.ts | 19 | 7 | 2 | 9 | 1 | 0 |
| src/game/view/cardMotionPlan.ts | 34 | 31 | 3 | 0 | 0 | 0 |
| src/game/view/cardOperations.ts | 28 | 28 | 0 | 0 | 0 | 0 |
| src/game/view/cardPlaces.ts | 5 | 5 | 0 | 0 | 0 | 0 |
| src/game/view/changedInstances.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/game/view/characterCard.ts | 5 | 2 | 0 | 3 | 0 | 0 |
| src/game/view/craftingView.ts | 10 | 7 | 0 | 3 | 0 | 0 |
| src/game/view/elapsePlayback.ts | 15 | 15 | 0 | 0 | 0 | 0 |
| src/game/view/operationSteps.ts | 7 | 4 | 3 | 0 | 0 | 0 |
| src/game/view/recipeList.ts | 6 | 0 | 0 | 2 | 3 | 1 |
| src/game/view/recording.ts | 13 | 13 | 0 | 0 | 0 | 0 |
| src/game/view/slotCells.ts | 4 | 3 | 0 | 0 | 1 | 0 |
| src/game/view/statusChanges.ts | 6 | 6 | 0 | 0 | 0 | 0 |
| src/game/view/statusRows.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/game/view/tickProgress.ts | 11 | 8 | 0 | 0 | 3 | 0 |
| **合計** | **423** | **350** | **27** | **33** | **12** | **1** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| PlayScreenLayout | 画面の寸法から、各区画の矩形を1回だけ決める | `metrics`（引数を持ち直して40ファイルの入口になっている）、`DISPLAY_PADDING`（寸法トークンだけが外へ出ている） |
| ScreenMetrics | 画面の実寸とu単位の換算を答える | `LANE_MIN_CARDS`/`LANE_MIN_CARDS_WIDTH`（「5枚見せる」は換算ではなくレイアウトの規約） |
| theme | 画面の色と寸法のトークンを1箇所に置く | `CardKind`（世界の物の分類）、`mixColor`（汎用の色補間）、`rowPlateStyle`（部品の契約の組み立て） |
| rainStyle | 天気を雨の見え方（本数・傾き・速さ）へ直す | `RAIN_STYLES` のキー（`light_rain` などの世界の語彙） |
| durationText | ゲーム内時間を画面に出す字面にする | `clockParts`（字面ではなく時刻の分解。時計とエラー報告が使う） |
| PlayScreenView | ワールドの今の断面を、札・枠・ステータスとして1つの型にまとめる**と**、その上の操作を引ける口を持つ（接続詞＝責務2つ） | `ObjectCardStack` の `dropInto`/`movedIds`/`reorder`/`contentsFor`（操作の側）、`LOCATION_ICON`・`UNNAMED_LOCATION`・`EXPLORE_ACTION`・`STATUS_TAG`（絵文字・語・世界の識別子） |
| ShownCards | 画面に出ている札の並び**と**、その上の操作の意味を答える（接続詞＝責務2つ） | `takeFound`/`found`/`returnFound`/`foundCards`（探索の発見物という第3の話）、`edgeTargets`（レーンの上下関係という画面の規約） |
| ShownStatuses | ステータスエリアに出す行を選んで並べる | `pinned`/`togglePin` と `onPinned`/`onOpenDetail`（固定表示の操作。行の選択とは別） |
| cardLooks | ワールドの今の状態だけから、札1枚の見た目を作る | `KIND_ICONS`・`TREATED_MARK`・`BLEEDING_MARK`（絵文字＝意匠）、7つのプロパティ名/スロット名の定数（世界の語彙の直書き） |
| cardMotionPlan | 前後の並びの差から、どの札がどこへ飛ぶかを決める | `delaySteps`・`puffs`（飛ばし方・土埃という見せ方の細目） |
| cardOperations | 札の上でプレイヤーが起こせることを、実行手段つきで答える | （漏れなし） |
| cardPlaces | 画面の区画が今映しているスロットを解決する | （漏れなし） |
| craftingView | 製作中オブジェクトの操作と、材料の充足を答える | `contentsOf`・`locationItems`（スロットの中身を辿るドメインの引き方） |
| recipeList | レシピ一覧に並べる棚を組み立てる**と**、製作中オブジェクトのレシピを同定する（接続詞＝責務2つ） | `recipeOf`（純粋なドメイン照会）、`LOCKED`/`OTHER`/`PRODUCT_ICON`（語と絵文字） |
| slotCells | スロットの宣言と中身から、レーンに並べる枠を作る | `materialCells` の `borderColor`（色そのものを選んでいる） |
| tickProgress | tickの区切りに合わせて、経過の進み具合を答える | `ADVANCE_RATIO`・`ACCELERATION_RATIO`・`eased`（加速の形＝時間の見せ方） |
| characterCard | 開始画面に出すキャラクタ1人の札を作る | `PLACEHOLDER_ICONS`・`UNKNOWN_CHARACTER_ICON`（絵文字＝意匠） |
| elapsePlayback / operationSteps / recording / statusChanges / statusRows / changedInstances | それぞれ、経過の再生・手順・控え・差分・行の並び・変化した個体を答える | （漏れなし） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/view/slotCells.ts | `materialCells()` | 所属 | 4 | 映しが `COLOR.cellCurrentStep`/`cellLaterStep` を引いて枠の縁の色そのものを決めている | `src/game/ui/laneCells.ts`（`LaneCell` が色ではなく「今の工程か」を受ける） | `LaneCell.borderColor` が意味ではなく色（number）を要求しているので、映しが色を選ばされている | |
| src/game/view/tickProgress.ts | `ADVANCE_RATIO`, `ACCELERATION_RATIO`, `eased()` | 配置 | 4 | 加速して動き出し減速して止まる形は「時間の見せ方」＝意匠（`looks/cardFlight.ts` の `FLY_EASE_OUT` と同種） | `src/game/looks/cardFlight.ts` | 区切りの中の位置（`segmentAt` の `within`）が private な区切り計算からしか出ないので、形だけ意匠へ出すと区間の内部を公開することになる | |
| src/game/view/PlayScreenView.ts | `UNNAMED_LOCATION` | 所属 | 4 | 画面に出す日本語の語が映しに直書きされている | `src/locale/` | `Localization` は宣言された要素の語しか引かないので、「名前が付いていない」という宣言に無い語の置き場が locale に無い | |
| src/game/view/recipeList.ts | `LOCKED`, `OTHER` | 所属 | 4 | 同上（解放条件の代わりの1行、どのタグにも当たらない棚の見出し） | `src/locale/` | 同上（宣言に対応しない語の口が locale に無い） | |
| src/game/view/PlayScreenView.ts | `EXPLORE_ACTION` | 所属 | 4 | 「探索する操作か」を映しがアクション名の文字列で見分けている | `src/domain/`（ObjectDef のアクション宣言側の印） | 宣言側が「探索」を印で名乗らないので、名前で見分けるしかない | |
| src/game/view/PlayScreenView.ts | `LOCATION_ICON` | 配置 | 4 | 絵文字は意匠。同じ字が `cardLooks.KIND_ICONS.location` にもあり、2箇所が暗黙に一致すべきになっている | `src/game/looks/`（`KIND_ICONS` へ一本化） | `KIND_ICONS` は `ObjectDef` の種別から引くので、オブジェクトを持たない札（道）からは引けない | |
| src/game/view/cardLooks.ts | `KIND_ICONS` | 配置 | 4 | 種別ごとの代役の絵文字は「どう見せるか」＝意匠 | `src/game/looks/theme.ts`（`CARD_FRAME_FACE` の隣） | `CardKind` を網羅する表なので、種別の判定（`kindOf`）と同じ場所に置いてある | |
| src/game/view/recipeList.ts | `recipeCategories()` | 所属 | 4 | 映しが `Rect`（座標）を引数の型に担いでいる | `src/game/PlayScene.ts`（矩形は組み立て側で埋める） | `RecipeEntry.onSelect` が飛び先の矩形を渡す契約なので、素通しのために `Rect` を輸入している | |
| src/game/looks/theme.ts | `CardKind` | 配置 | 4 | 物の分類（location/fixture/item/food/…）は世界の語彙で、意匠が持つものではない | `src/game/ui/Card.ts`（`CardContent.kind` の契約） | `CARD_FRAME_FACE` の網羅性を型で保証するため、列挙を色表と同じ場所に置いている | |
| src/game/view/recipeList.ts | `recipeOf()` | 所属 | 5 | `codex.variationsOf`/`baseOf` を読むだけの純粋なドメイン照会で、画面の話が1つも無い。公開範囲の障害も無い | `src/domain/crafting.ts` | | |
| src/game/view/cardLooks.ts | `COLOR_PROPERTY`, `CONSCIOUSNESS_PROPERTY`, `WARINESS_PROPERTY`, `COOKING_PROPERTY`, `BLEEDING_PROPERTY`, `TREATMENT_SLOT`, `UNCONSCIOUS_STAGE` | 所属 | 3 | 世界のプロパティ名・スロット名・段の名を映しが文字列で名指ししている（出す規則が宣言の外にあるためだが、識別子そのものは世界のもの） | `src/domain/`（既知の名前の宣言、またはタグ） | | |
| src/game/view/cardLooks.ts | `TREATED_MARK`, `BLEEDING_MARK` | 配置 | 3 | 印に使う絵文字は意匠 | `src/game/looks/theme.ts` | | |
| src/game/view/cardLooks.ts | `BUILTIN_GAUGE_KEYS`, `NEUTRAL_ENDS` | 所属 | 2 | ゲージの契約（`CardGauge`）側の既定値・予約キーを映しが持っている | `src/game/ui/Card.ts` | | |
| src/game/view/characterCard.ts | `PLACEHOLDER_ICONS`, `UNKNOWN_CHARACTER_ICON` | 配置 | 3 | 代役の絵文字は意匠（絵が入れば消える繋ぎ） | `src/game/looks/` または `src/art/` | | |
| src/game/view/characterCard.ts | `characterIcon()` | 可視性 | 3 | `export` だがプロダクトコードからの利用は無く、テストだけが呼ぶ | （非公開化） | | |
| src/game/view/recipeList.ts | `PRODUCT_ICON` | 配置 | 3 | 絵が無いときの代替絵文字は意匠 | `src/game/looks/` | | |
| src/game/view/recipeList.ts | `actorOnly()` | 所属 | 3 | `ReferenceRoot` を解決する手順はドメインの語彙 | `src/domain/ReferenceRoot` 周辺 | | |
| src/game/view/craftingView.ts | `contentsOf()`, `locationItems()`, `progressOf()` | 所属 | 3 | スロットの中身・現在地のアイテム・進捗をドメインから引き直す手順で、画面の話ではない | `src/domain/crafting.ts` | | ○（`contentsOf` は「誰の何の中身か」が名前から出ない） |
| src/game/view/PlayScreenView.ts | `STATUS_TAG` | 所属 | 3 | プロパティタグ名という世界の語彙 | `src/domain/`（既知タグの宣言） | | |
| src/game/view/PlayScreenView.ts | `ObjectCardStack.dropInto`, `movedIds`, `reorder`, `contentsFor` | 所属 | 2 | 「札1枚が映すもの」の型に、操作（`CardOperations`）の側が同居している | `cardOperations.ts`（`CardOperations` として分けたまま持つ） | | |
| src/game/view/PlayScreenView.ts | `withFrozenCards()` | 配置 | 2 | 型定義のファイルに、映しを加工して返す関数が同居している | `recording.ts`（唯一の利用者） | | |
| src/game/view/ShownCards.ts | `CardSource` とその5フィールド | 所属 | 2 | 映しが自分の入力口を自分で定義し、`PlayScreenView` がそれを満たす形になっている | （現状維持で可。`PlayScreenView` 側の口として一本化する余地） | | |
| src/game/view/ShownCards.ts | `foundCards`, `takeFound()`, `found`, `returnFound()` | 所属 | 3 | 探索の発見物は「並びと操作」から外れる第3の話（`returnBorrowed` で一括返却するために同居） | `ShownFound`（新設）または探索ウィンドウ側 | | |
| src/game/view/ShownCards.ts | `edgeTargets()`, `edgeMove()` | 所属 | 3 | レーンの上下関係（設置物→アイテム→手持ち）という画面の並びの規約で、札の並びの話ではない | `cardPlaces.ts` | | |
| src/game/view/ShownStatuses.ts | `StatusSource` とその5フィールド | 所属 | 2 | 同上（映しが自分の入力口を定義し、`onPinned`/`onOpenDetail` で組み立てへ折り返す） | （現状維持で可） | | |
| src/game/view/cardMotionPlan.ts | `PlannedFlight.delaySteps`, `PlannedFlight.puffs`, `MotionPlan.puffs` | 所属 | 2 | 何がどこへ飛ぶかの計画に、遅らせ方と土埃という見せ方の細目が混ざっている | `src/game/looks/cardFlight.ts`（遅延の刻み）／部品側（土埃） | | |
| src/game/view/operationSteps.ts | `Activity`, `runsOperation()`, `isMidAction()` | 所属 | 2 | `PlayScene` が今何をしているかの状態の型で、操作の手順とは別（同じファイルに2つの塊がある） | `PlayScene.ts` に近い別モジュール | | |
| src/game/looks/theme.ts | `mixColor()` | 配置 | 3 | 2色の線形補間は汎用の色演算で、このゲームの配色と無関係 | `src/util/` または `src/ui/` | | |
| src/game/looks/theme.ts | `rowPlateStyle()` | 所属 | 2 | 意匠が部品の契約（`BoxStyle`）を組み立てて返している | （現状維持で可。Layers.md 2節どおり部品が意匠を引く形） | | |
| src/game/looks/PlayScreenLayout.ts | `DISPLAY_PADDING` | 配置 | 3 | 寸法トークンはこれだけが `SIZE` の外に `export` されている | `src/game/looks/theme.ts` の `SIZE` | | |
| src/game/looks/PlayScreenLayout.ts | `horizontalSeparatorAt()`, `verticalSeparatorAt()` | 配置 | 3 | 中心線と幅から矩形を作る汎用の幾何で、この画面の話ではない | `src/ui/Rect.ts` | | |
| src/game/looks/PlayScreenLayout.ts | `metrics` | 可視性 | 2 | 計算に使った引数をそのまま公開し、40ファイルがここ経由で `ScreenMetrics` を読んでいる | （各所が `ScreenMetrics` を直に受け取る） | | |
| src/game/looks/ScreenMetrics.ts | `LANE_MIN_CARDS`, `LANE_MIN_CARDS_WIDTH` | 所属 | 3 | 「レーンに5枚見せる」は換算ではなくレイアウトの規約 | `PlayScreenLayout.ts` または `theme.ts` | | |
| src/game/looks/childWindowLayout.ts | `ACTION_HEIGHT` | 配置 | 3 | `SIZE.iconButton` の別名を作っているだけ | `theme.ts` の `SIZE`（直接参照） | | |
| src/game/looks/durationText.ts | `clockParts()` | 所属 | 3 | 総分を日・時・分へ割るだけの計算で、見せ方を1つも含まない（エラー報告も使う） | `src/util/` | | |
| src/game/looks/rainStyle.ts | `RAIN_STYLES` | 所属 | 3 | 意匠が `light_rain`/`heavy_rain`/`storm` という世界の語彙をキーに持っている | （下記「移動先が書けなかったもの」参照） | | |

## 移動先が書けなかったもの

- **`RAIN_STYLES`（rainStyle.ts）** — 天気の識別子ごとに見せ方を並べた表。天気そのものは `src/assets/` の
  宣言（core.yaml）が持つのに、**その天気を「どう見せるか」を宣言するデータの居場所が無い**ため、
  意匠のコードが世界の語彙を写し取る形になっている。欠けているのは「宣言に対する見せ方の宣言」という
  データの層（絵の対応表 `src/art/` に相当するものの、演出版）。`heatHaze`・`skyTint` が数値の閾値で
  済んでいるのに `rainStyle` だけ語彙を持つのは、天気が連続値ではなく識別子だから。
- **`UNNAMED_LOCATION` / `LOCKED` / `OTHER`（PlayScreenView.ts・recipeList.ts）** — いずれも
  「宣言に対応しないことば」。`src/locale/` は宣言された要素（オブジェクト・プロパティ・タグ）に語を
  与える口しか持たないので、**画面が自分で言うことばの置き場という概念が欠けている**。
- **`EXPLORE_ACTION`（PlayScreenView.ts）** — 移動先は `src/domain/` だが、受け皿になる宣言が無い。
  欠けているのは「このアクションは探索である」という**宣言側の印**（タグ相当）で、それが無いために
  映しが名前一致で判定している。

## ファイル配置（層=配置）についての所見

- ディレクトリ2つの分担そのものは、ほぼ守られている。**映し→Phaserの依存は1本も無く**、寸法・座標を
  映しへ持ち込んでいるのは `recipeList.ts` の `Rect` 1箇所だけ、色を持ち込んでいるのは
  `slotCells.ts` と `cardLooks.ts` の2箇所だけだった。逆向き（意匠が世界を知る）も
  `theme.ts` の `AlertLevel`/`GaugeEnd` 輸入と `RAIN_STYLES` のキーに限られる。
- 崩れているのは**絵文字とことば**の一点。`KIND_ICONS`・`PLACEHOLDER_ICONS`・`LOCATION_ICON`・
  `PRODUCT_ICON`・`TREATED_MARK`・`BLEEDING_MARK` が映しの4ファイルに散っていて、しかも
  `🗺️` は `PlayScreenView` と `cardLooks` の2箇所に同じ字がある。「絵が無いときの代役」は
  1つの意匠なので、`looks/` の1箇所（または `src/art/` の対応表）へ集められる。
- `view/cardLooks.ts` はファイル名が `looks` でありながら `view/` に居る。中身は
  「何が出ているか」（名前・絵・ゲージの値）が主で置き場所は妥当だが、上の絵文字と `COLOR` 参照を
  抜けば名前と実体のずれも消える。
- `looks/` 内部では、寸法トークンが `theme.SIZE` と `childWindowLayout` と `PlayScreenLayout` の
  `DISPLAY_PADDING` の3箇所に分かれている。層としては正しいので優先度は低いが、
  `DISPLAY_PADDING` だけが export されているのは不揃い。

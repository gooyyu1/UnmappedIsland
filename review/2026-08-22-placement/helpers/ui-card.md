# ui-card — 判定3の再点検

対象は private メソッド・private getter・export されていないモジュール関数。
（担当範囲に private getter は無い。`presentIds`/`holdsCard`/`cardObjects`/`hazeSurface`/`count`/`rect` は
すべて public。）

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/game/ui/Card.ts | 36 | 14 | 22 |
| src/game/ui/CardLane.ts | 6 | 2 | 4 |
| src/game/ui/CardTable.ts | 11 | 5 | 6 |
| src/game/ui/CardDragController.ts | 13 | 9 | 4 |
| src/game/ui/LaneHaze.ts | 4 | 2 | 2 |
| src/game/ui/cardFace.ts | 0 | 0 | 0 |
| src/game/ui/laneCells.ts | 0 | 0 | 0 |
| **合計** | **70** | **32** | **38** |

内訳（Card.ts の36件 = private メソッド25件〈Card 24 + CellOverlay 1〉+ 非exportモジュール関数11件）。

**「主語は自分」と数えたものの性格**: `applyContent`・`showAlert`・`showName`・`showEdge`・
`showStackCount`・`showMark`・`showOverlay`・`settleOverlay`・`showCooking`・`barsFor`・
`makeInteractive`・`makeTappable`・`startEdgeRepeat`・`cancelEdgeRepeat`（Card）、`applyCells`・
`addBackground`（CardLane）、`retarget`・`dropFlight`・`step`・`land`・`makeCard`（CardTable）、
`begin`・`update`・`decide`・`startDragging`・`follow`・`trackCarry`・`carryOne`・`end`・`cancel`
（CardDragController）、`focusOn`・`apply`（LaneHaze）。いずれも自分のフィールド（表示物・控え・
ジェスチャ）を動かすもので、本来の判定3（近くに置いてあるだけ）で正しい。

## 主語が他にあるヘルパー

### src/game/ui/Card.ts

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| Card.ts#Card | `showBars` | 桟（`RailMetrics`＋`ProgressBar`の列。クラスが無い） | 積まれたバー列へ「位置・枠の色・値」を一度に流し込む機能 | 消える（`rail.show(colors, showChange, hold)` の1行になる） | 桟が実体を持つには `ProgressBar` の所有を Card から移す必要があり、`gaugeBars` の鍵付き再利用（差し替えをまたいで同じバーを使い、変化の帯を切らさない）も一緒に動く |
| Card.ts#Card | `edgeActionFor` | `CardContent` | 「その向きの端の操作」を引く索引。`edges` は配列で、向きから引く規則を型が持っていない | 消える | `CardContent` は Card.ts の中の素の interface で、関数を置く場所（`cardContent.ts`）が無い |
| Card.ts#Card | `gaugeBarFor` の `fillColor` クロージャ | 意匠（`looks/theme.ts`）／`CardGauge` | ゲージ宣言から**塗りの色の引き方**（`(ratio) => color`）を返す機能。今は `atMin`/`atMax` を部品が抱えて `gaugeColorFor` を毎回自分で呼んでいる | 大半消える。残るのは `gaugeBars` の鍵引きと `moveBelow`（重なり順） | wave1 が判定4に挙げた「色は割合ごとに引き直すので映しが1色に解決できない」は、theme が `gaugeFill(gauge): (ratio)=>number` を返せば消える。そうすれば `CardGauge.atMin`/`atMax` も部品の契約から落ちる |
| Card.ts#Card | `drawFrame` `drawRoadArrow` `createStackBadge` `addRailBar` | 意匠 | 札1枚ぶんの意匠（枠の引き方・矢印の形・丸の寸法・桟のバーの寸法）。触っている自分のフィールドは `this.frame`（前2つ）だけで、残りは全部 寸法と色 | 消える。残るのは「引いた結果を自分の Graphics/Container へ入れる」1行 | 置き場所（`looks/cardLook.ts`）が無い。`drawFrame` は `this.frame` へ直接引くので、意匠側は「Graphics を受け取って引く」形にする必要がある |
| Card.ts#CellOverlay | `makeBadge` | 意匠 | 「暗い板に明るい文字」の板の寸法・色。触っているのは `this.scene` だけ | 消える | 同上（置き場所が無い） |
| Card.ts | `createAlertOutline` `createEmptyOutline` `createPaper` `createNameText` `createVeil` `createIconText` | 意匠 | 表示物の組み立てと、その寸法・色 | 消える | 同上。`createPaper` だけは `CARD_FRAME_TEXTURE` の有無で図形へ落とすので、素材の存在確認まで意匠側へ移る |
| Card.ts | `createArtImage` | `src/art/objectArt` | 「その絵をカード幅に合わせる倍率」。基準（`CARD_ART_WIDTH`）は objectArt にあるのに、それを使う規則だけ部品側にある | 消える | なし（`objectArt` に `cardArtScale(width)` を足せばよい） |
| Card.ts | `windowSpan` `windowRect` `railMetrics` `paperStroke` | 意匠（札の幾何） | 札の中の領域割り。Phaser に一切触らない純粋関数が部品側にある | 消える | `paperRect`/`PAPER_RADIUS` を MapWindow が輸入しているので、移動先は公開モジュールでなければならない（`looks/cardGeometry.ts`） |
| Card.ts#Card | `showArt` | 映し（`cardFace`／`view/ShownCards`） | object_def識別子・`SlotRef` からテクスチャキーを解決する機能 | **消えない**。残るのは「同じものを出し続ける間は作り直さない」差分更新 | 絵は後から届く（`swapArtWhenLoaded`）ので、識別子を捨てると貼り替え対象を引き直せない（wave1 判定4と同じ） |
| Card.ts#Card | `swapArtWhenLoaded` | `src/art`（LocationArtLoader / objectArt） | 「このテクスチャが届いたら知らせる」購読口。今は Phaser のイベント名（`ADD_KEY + texture`）を部品が自分で組み立て、破棄時の解除まで書いている | 消える | `src/art` 側は Phaser の TextureManager を知らない（scene を持たない）。購読口を置くには scene を渡す入口が要る |
| Card.ts#Card | `addEdge` | 意匠 ＋ 操作の規則 | 端のオーバーレイと矢印の見た目、押せる範囲の比（`EDGE_RATIO`。CardLane の `CARD_EDGE_RATIO` と対） | 半分消える。残るのは `onPressRelease` の配線と `edgeRepeated` の管理 | 見た目の矩形と当たり判定の矩形が同じ計算を共有しているので、分けると同じ式が2箇所になる |

### src/game/ui/CardLane.ts

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| CardLane.ts#CardLane | `resetDecorations` | `LaneCell` | 「その枠が出す装飾」を枠自身が答える機能。今はレーンが `card === undefined` / `borderColor` / `overlay` の3分岐を読み分けて `EmptyCard`・`CellHighlight`・`CellOverlay` を作っている | 消える（`cell.decorations(...)` を層へ入れるだけになる） | `LaneCell` は素の interface。装飾3クラスが Card.ts に居るので、`laneCells.ts` → `Card.ts` の向きの依存が増える（今は `CardContent` の型輸入だけ） |
| CardLane.ts#CardLane | `slideTo` | `Card` | 「所定の位置へ滑って移る」（既にそこなら何もしない、を含む）。触っているのは `this.scene` と `this.pitch` だけ。`SLIDE_MS`/`SLIDE_EASE` は意匠 | 消える | なし。tween の主は動く当人（`card.slideToX(x)`） |
| CardLane.ts#CardLane | `addPinnedCell` | 意匠（レーンの割り付け） | 「ピン留め部の幅の内訳」（`margin + cardWidth + gap + dividerWidth`）を名前で持つこと。constructor がこの式を `pinnedWidth` として立て、`addPinnedCell` が同じ4つを引き直し、区切り線の x で3度目を書いている | 半分消える。残るのは背景板・カード・区切り線を `objects`/`hazeTargets` へ登録する部分 | 畳むには「ピン留め部の割り付け」という名前付きの値が要る。今は同じ意味の局所変数が2箇所にある |
| CardLane.ts | `sharesIdentity` | `CardContent` | 「2枚が同じものを映しているか」。同じ規則の別の半分（`presentIds`・`absorb`）は Card に居る | 消える | `edgeActionFor` と同じ——`CardContent` に関数を置く場所（`cardContent.ts`）が無い |

### src/game/ui/CardTable.ts

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| CardTable.ts | `idsOf` `rectOf` | `Card` | `get ids` / `get rect`。`rectOf` は `CarriedCard.get rect` が呼んでおり、Card にあれば委譲すら要らない | 消える | なし |
| CardTable.ts#CardTable | `fadeIn` | `Card` | 「その場で現れる」。触っているのは `this.scene` だけで、`FADE_MS` は意匠 | 消える | なし（`card.appear(instant)`） |
| CardTable.ts#CarriedCard | `returnToSource` | `Card` | 「破棄済みなら黙って無視する `absorb`」。同じ `isAlive(...)` の前置きが CardTable に4箇所ある（L183・L286・L369・L542） | 消える | `isAlive` は `src/ui/lifetime` の汎用関数。「死んでいても呼べる」契約を Card 側に置くのが妥当かは、Phaser の破棄済みオブジェクトの扱い方の方針で決まる |
| CardTable.ts | `placedCards` | `CardLane` | 「並んでいる札を (札, 添字, 矩形) の組で挙げる」。`cardObjects` と `cellRect(index)` を外から組み合わせている | 消える | `PlacedCard<C,R>` は cardMotionPlan の総称型。CardLane が返すには `Card`/`Rect` で閉じた非総称の形が要る |
| CardTable.ts | `releasedIdsOf` | `MotionContext` / `view/cardMotionPlan` | `released` の形が `{grabbed, followers}` と `{ids}` の2つで二重に立っている | 消える（`MotionContext.released` を `ids` に揃える） | `grabbed` を分けているのは `CardTable.hold` が「掴んだ1つ」を先頭に置くため。`ids` の先頭が掴んだ1つ、と決めれば阻害は消えるが、それは名前で表していた規約を暗黙の位置規約へ戻すことになる |

### src/game/ui/CardDragController.ts

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| CardDragController.ts#CardDragController | `locate` | `CardLane` | 「この表示物はこのレーンの何番目か」。`cardObjects.indexOf(object as Card)` と、`Card` への as キャストを外から書いている | 消える（`lane.indexOf(object)`） | なし |
| CardDragController.ts#CardDragController | `dropAt` | レーンの集合（クラスが無い） | 「この点を受け取るレーンと、そこでの落とし先」。`this.lanes` を線形に舐める処理が `locate`・`dropAt`・`showAcceptingCards` の3箇所にある | 消える | `lanes` の実体は PlayScene が作った配列で `setLanes` で差し替わる。集合に名前を付けると、所有者を CardDragController と PlayScene のどちらにするかを決める必要がある |
| CardDragController.ts#CardDragController | `showAcceptingCards` | `CardLane` ＋ 意匠 | 前半は「並んでいる (添字, 札, 矩形)」の列挙（`placedCards` と同じ不足）、後半は「ふちの光」の描き方（`GLOW_LAYERS` の3重ストロークで滲みを作る） | 両方消える。残るのは `describeDrop` への問い合わせ | 光は1つの `Graphics` へ重ね描きしているので、意匠側は「矩形の列を受け取って光らせる」形になる |
| CardDragController.ts | `sameTarget` | `LaneDropTarget` | 等価判定。型の定義側が持たないので、利用側が `to`・`kind`・`index` の3つを並べて比べている | 消える | なし |

### src/game/ui/LaneHaze.ts

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| LaneHaze.ts#LaneHaze | `ensureMap` | 意匠（`looks/heatHaze.ts`） | 陽炎の**形**（波の細かさ `WAVE_ACROSS`/`WAVE_DOWN`、縁のぼかし `EDGE_FADE`、横縦比 `HORIZONTAL_RATIO`）。強さ・速さだけが heatHaze にあり、形は部品側に残っている。触っているのは `this.scene` だけ | 半分消える。残るのは `scene.textures.createCanvas` への登録 | looks を純粋なまま保つなら、移せるのは「位置→RGB」を返す関数まで。画素を書く側は Phaser の CanvasTexture が要る |
| LaneHaze.ts | `edgeFade` | 意匠（`looks/heatHaze.ts`） | 同上 | 消える | なし |

## 同じ B に対して複数の A が補っているもの

### 1. B = `CardLane`：「並んでいる札を (添字, 札, 矩形) で挙げる」が無い

| A | ヘルパー | 書いていること |
|---|---|---|
| CardTable | `placedCards` | `cardObjects.forEach` + `cellRect(index)` で全レーンを畳む |
| CardDragController | `locate` | `cardObjects.indexOf(object as Card)` |
| CardDragController | `showAcceptingCards` | `cardObjects.forEach` + `cellRect(index)` |
| CardDragController | `begin` | `found.lane.cardObjects[found.index]?.holdsCard` と、レーン越しに札へ手を伸ばす |
| （範囲外）PlayScene | `cardShowing` L936-945 | `cardObjects.findIndex(...)` + `cellRect(index)` で同じ組を作る |

`cardObjects` が `readonly (Card|undefined)[]` として開いているために、**「札と枠の対応」を組み立てる
コードが4クラス5箇所に散っている**。CardLane が `entries()`（添字・札・矩形の組）と
`indexOf(object)` と `cardAt(index)` を持てば、この5箇所とも消える。担当範囲で最も優先度が高い。

### 2. B = `Card`：札自身が答えるべきことを、周りが組み立てている

| A | ヘルパー | 不足している機能 |
|---|---|---|
| CardTable | `idsOf` `rectOf` | `get ids` / `get rect` |
| CardTable | `fadeIn` | `appear(instant)` |
| CarriedCard | `returnToSource` | 破棄済みなら黙って無視する `absorb`（`isAlive` の前置きが4箇所） |
| CardLane | `slideTo` | `slideToX(x)`（所定の位置へ滑る） |

いずれも「値を取り出して外で組み立てる／状態を確かめてから呼ぶ」形で、CLAUDE.md の
「自分のことは自分でする」に真正面から当たる。`rectOf` に至っては `CarriedCard.get rect` が
モジュール関数へ委譲しており、**Card にあるべき getter が2段ずれている**。

### 3. B = 意匠（部品1つぶんの looks モジュールが無い）

| A | ヘルパー |
|---|---|
| Card | `drawFrame` `drawRoadArrow` `createStackBadge` `addRailBar` `create*`(6) `windowSpan` `windowRect` `railMetrics` `paperStroke` `addEdge`の前半 `gaugeBarFor`の色 |
| CellOverlay | `makeBadge` |
| CardLane | `slideTo`の時間 `addPinnedCell`の割り付け |
| CardDragController | `showAcceptingCards`の光 `follow`の枠 |
| LaneHaze | `ensureMap` `edgeFade` |

wave1 が定数について指摘したのと同じ欠落が、**関数の側でも同じだけ起きている**。定数44個の
移動先が無いのではなく、「この部品の意匠」という単位そのものが無いため、寸法を使う計算も
一緒に部品へ溜まっている。

### 4. B = `CardContent`（型の定義側に関数を置く場所が無い）

| A | ヘルパー | 不足している機能 |
|---|---|---|
| Card | `edgeActionFor` | 向きから端の操作を引く |
| CardLane | `sharesIdentity` | 2枚が同じものを映しているか |

`cardFace`/`borrowedFace` は既に `cardFace.ts` へ出ているので、**`CardContent` に付く関数の置き場は
半分だけ存在している**。契約（`CardContent`・`CardGauge`・`CardCooking`・`CardEdgeAction`）を
`cardContent.ts` へ出せば、この2つと `cardFace.ts` が1箇所に揃う。

### 5. B = `LaneDropTarget` / `LaneCell`（それぞれ A は1つ）

`sameTarget`（等価判定）と `resetDecorations`（枠の装飾）は、どちらも素の interface が
振る舞いを持てないことによる。上の4と同じ原因の、利用者が1つの版。

## 補足

`laneCells.ts` は非exportの関数を持たないが、`laneWidthForCells` は `PEEK_WIDTH`・`SIZE.cardWidth`・
`SIZE.gap`・`SIZE.margin` から幅を出す**寸法の計算**で、主語は意匠。export されているためこの表の
対象外だが、上の3（部品1つぶんの意匠が無い）と同じ性格のものとして数に入れてよい。

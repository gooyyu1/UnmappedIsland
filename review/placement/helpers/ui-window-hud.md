# ui-window / ui-hud — 判定3の再点検

対象は private メソッド・private getter・export されていないモジュール関数。private getter は
担当範囲に**0件**（`grep '^  private get '` で全ファイル該当なし）。

数え方: 「主語は自分」＝自分のフィールドを読み書きするために存在するもの。「主語は他（B）」＝
引数で受け取った別の型・別のモジュールの話しか書いていないもの、および `this` を1フィールドだけ
触って残りは全部 B の話であるもの。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/game/ui/DescriptionPane.ts | 1 | 0 | 1 |
| src/game/ui/ExplorationPane.ts | 2 | 0 | 2 |
| src/game/ui/MapWindow.ts | 16 | 9 | 7 |
| src/game/ui/ModalDialog.ts | 2 | 0 | 2 |
| src/game/ui/ObjectWindow.ts | 7 | 4 | 3 |
| src/game/ui/ObjectWindowPane.ts | 0 | 0 | 0 |
| src/game/ui/PropertiesPane.ts | 2 | 0 | 2 |
| src/game/ui/RecipeWindow.ts | 4 | 3 | 1 |
| src/game/ui/SlotPane.ts | 0 | 0 | 0 |
| src/game/ui/StatusDetailWindow.ts | 8 | 0 | 8 |
| src/game/ui/TextInput.ts | 0 | 0 | 0 |
| src/game/ui/Tooltip.ts | 2 | 1 | 1 |
| **ui-window 小計** | **44** | **17** | **27** |
| src/game/ui/Button.ts | 2 | 1 | 1 |
| src/game/ui/Curtain.ts | 0 | 0 | 0 |
| src/game/ui/DustPuff.ts | 2 | 2 | 0 |
| src/game/ui/FlipCalendar.ts | 4 | 1 | 3 |
| src/game/ui/GainParticles.ts | 2 | 0 | 2 |
| src/game/ui/LocationArtLoader.ts | 3 | 0 | 3 |
| src/game/ui/ProgressBar.ts | 3 | 2 | 1 |
| src/game/ui/ProgressRing.ts | 1 | 0 | 1 |
| src/game/ui/ScreenAlertFrame.ts | 0 | 0 | 0 |
| src/game/ui/ScreenHeader.ts | 0 | 0 | 0 |
| src/game/ui/ScreenSkyTint.ts | 0 | 0 | 0 |
| src/game/ui/ScrollIndicator.ts | 2 | 2 | 0 |
| src/game/ui/StatusBar.ts | 7 | 4 | 3 |
| src/game/ui/WeatherOverlay.ts | 4 | 3 | 1 |
| src/game/ui/WeatherPanel.ts | 2 | 1 | 1 |
| src/game/ui/signalLabel.ts | 0 | 0 | 0 |
| **ui-hud 小計** | **32** | **16** | **16** |
| **合計** | **76** | **33** | **43** |

## 主語が他にあるヘルパー

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| StatusDetailWindow.ts#StatusDetailWindow | `drawStageTicks` | `ProgressBar` | バーの上に、比率位置の目盛りを刻む口。 | **消える。** 窓が控えている `barRect`（`{x:left,y,width:contentWidth,height:barHeight}`＝バーに渡したのと同じ4値）も一緒に消える | 目盛りを `ProgressBar` が持つと、`marks` の生成順（バーより後＝手前）をバー自身が決めることになる。今はそこを窓が「バーを作った直後に marks を作る」という手順で守っている |
| StatusDetailWindow.ts#StatusDetailWindow | `drawStageBox` | `ProgressBar`／`src/ui/shapes.ts` | (1) バーの上の区間を明るい面と太い囲みで示す口。(2) `ProgressBar` の角の丸みを答える口——**`ProgressBar.radius = height / 4`（L142）が private なので、窓が `const radius = box.height / 4`（L406）と同じ式を書き直している**。 | **消える。** 中身は `drawBox` の fill+border+radius そのもので、`fillStyle/fillRoundedRect/lineStyle/strokeRoundedRect` を手で並べ直しているだけ（隣の `drawStagePlate` は同じことを `drawBox` で書いている） | なし。`drawBox` は `fittingRadius` で丸みを辺に収めるので、細い段でも今より正しくなる |
| StatusDetailWindow.ts#StatusDetailWindow | `drawStagePlate` | `src/ui/shapes.ts` | 「しっぽ（三角）付きの角丸矩形」＝吹き出しの形。`drawBox` は板だけを描き、しっぽは窓が `fillTriangle` で足している。 | 板としっぽは消える。残るのは「しっぽの根元を板の中に収める」クランプで、これも `BoxStyle` に `tail: {x}` を足せば入る | なし |
| StatusDetailWindow.ts | `plateWidth`（module） | 同上（段の名札という部品の不在） | 名札の寸法を答える口。今は `Text` を受け取って `label.width + padding*2` を返すだけの関数が、クラスの外に落ちている。 | 名札が部品になれば消える | 名札は「寸法が決まる前に作り、決まった後に置く」ので、生成と配置を分けられる形でないと部品にできない |
| StatusDetailWindow.ts#StatusDetailWindow | `buildSection` | `readonly StatusInfluence[]` | 「影響の一覧（見出し＋格子）」という部品。列数の算出・最低行数の確保・後から位置を渡す `place` を全部この窓が持っている。 | 消える（`InfluenceTiles` を新設した場合） | 高さを先に返して位置を後から渡す形が必要で、既存の部品にその作法を持つものが無い |
| StatusDetailWindow.ts#StatusDetailWindow | `buildTile` | `StatusInfluence`／`src/art` | (1) 「絵が届いていれば絵、無ければ代用」を答える口。(2) 影響1件の枠という部品。 | 消える | 後片付けが窓の `this.objects` に相乗りしており、枠が自分の寿命を持たない |
| StatusDetailWindow.ts#StatusDetailWindow | `addTileLabel` | `StatusInfluence` | 「絵が無ければ絵文字、それも無ければ表示名」という**代用の規則**。同じ規則を `StatusBar.createLabel`（L404〜）も別々に書いている。 | 消える | 代用の規則が契約（`StatusInfluence`）側にも意匠側にも置き場を持たない |
| StatusDetailWindow.ts | `markOf`（module） | `looks/theme.ts` | 「増減の記号（形と色）」の対応表。`statusFillColorFor` が既に居る場所。`StatusBar.showChange`（L384）が同じ規則の別実装。 | 消える | 記号の**形**は `markOf`、**色**は `buildTile` と、1つの規則が2箇所に割れている（`worsens` を読むのが色側だけ） |
| MapWindow.ts#MapWindow | `centerPointOf` | `Card` | 「今の拡大率込みの中心点」を答える口。`Card` は `cardWidth`/`cardHeight` を公開するが、**自分に掛かっている倍率を込みにした寸法・中心を答えない**ので、窓が `CARD_SCALE * this.zoom` を掛け直している（同じ掛け直しが `applyTransform`・`clampTopLeft`・`openingPlacement` にもある）。 | 消える | なし（倍率を与えているのは窓自身なので、`card.scaleX` から答えられる） |
| MapWindow.ts#MapWindow | `drawDottedArc` | `src/ui/shapes.ts` | 「曲線に沿って等間隔に点を打つ」。**直線版の `dashedLine` は既に shapes.ts に居るが private**で、破線は `strokeDashedBox` からしか使えない。 | 弧長の測り方と点打ちは消える。残るのは `ROAD_*`（点の太さ・間隔）と `bendSign` の選び方だけ | なし |
| MapWindow.ts | `drawIslandOutline`（module） | 変換を持つ入れ物（`src/ui/panZoom.ts` 相当の不在） | ズーム・パンを掛けた座標系。今は `zoom, panX, panY` を引数で受け取り、**128点すべてを自分で変換している**。 | 変換が入れ物側に立てば、輪郭は等倍のまま1回描けばよくなり、`applyTransform` からの描き直しごと消える | 札がドラッグと `bringToTop` のためシーン直下に居る必要があり、地図全体を1つのコンテナに包めない |
| MapWindow.ts#MapWindow | `addPan`, `addZoom`, `zoomAt` の受け口 | Phaser の入力／`src/ui/` の汎用部品 | ホイール・ピンチ・パンをまとめて受ける口。 | 消える（`src/ui/panZoom.ts` を新設した場合） | 上と同じ。変換を札1枚ずつへ書き戻しているため、汎用の入れ物に載せられない |
| MapWindow.ts#MapWindow | `listenScene` | `src/ui/lifetime.ts` | 「シーンの入力を購読して、後でまとめて外す」。今は `sceneListeners` 配列と `close` の外し忘れ防止を窓が自前で持っている。 | 消える | なし（`lifetime.ts` は「破棄されたか」しか答えず、購読の寿命を扱う概念が無いだけ） |
| MapWindow.ts | `touchPointer`（module） | Phaser の型 | `input.pointer1/2` は `addPointer` するまで存在しないのに、型は非省略可と言っている。 | **消えない。** B が外部ライブラリなので直せない | 関数自身のコメントが「Phaserの型の嘘をここで受ける」と自称しており、`src/ui/` に置くべき型のシム。担当範囲の中では唯一「B を直す道が無い」もの |
| ModalDialog.ts#ModalDialog | `addPortrait` | `Card` | 「高さを指定して札を作る／その実寸を答える」口。今は窓が `setScale(PORTRAIT_HEIGHT / SIZE.cardHeight)` を掛け、**同じ比率をもう一度使って `portraitWidth = SIZE.cardWidth * PORTRAIT_HEIGHT / SIZE.cardHeight` を計算し直している**（L96）。 | 消える | なし |
| ModalDialog.ts#ModalDialog | `addAction` | `Button`（`TextButtonStyle`） | ボタンの**役割**（default/primary/danger/disabled）。`TextButtonStyle` は生の色3つしか受けないので、役割→色の対応を呼び出し側が持つ。同じ対応を `ObjectWindow.addButtonRow`（L500）・`NewGameScene`・`SettingsScene`・`TitleScene` も別々に書いている。 | 消える | 役割名は意匠（`theme.ts`）の語彙だが、`Button.ts` は `src/game/ui/` に居て意匠を引ける側なので実際には阻害なし |
| ObjectWindow.ts#ObjectWindow | `addTabs`（＋`replacePane` の3行） | `Button`（タブ列という部品の不在） | 「選択状態を持つタブ列」。`Button` が出すのは `setBoxStyle` と `tabBoxStyle(metrics, active)` だけなので、**選択が変わったら全ボタンに `setBoxStyle` を呼び直す**手順を呼び出し側が覚えている。`PropertiesPane.select` が同じ3行を持つ。 | 消える | なし（CLAUDE.md の「呼んだ後に別のメソッドも呼ばないと壊れる」そのもの） |
| ObjectWindow.ts#ObjectWindow | `addButtonRow` | `looks/childWindowLayout.ts` | 「1行を n 個へ等分・上限つき・中央寄せで割る」。**1個版の `closeRow` は既にそこに居る**（同じ `ACTION_MAX_WIDTH` と中央寄せ）が、n 個版が無い。 | 矩形の算出は消える。残るのは「押せる／押せない」「閉じるだけ色が違う」の判断 | なし |
| ObjectWindow.ts#ObjectWindow | `tooltipHandlers` | `ObjectWindowAction`／映し | 「この操作を吹き出しで説明すると何になるか」。触る `this` は `this.tooltip` の1つだけで、残りは全部 action の話（`reason ?? CANNOT_DO_NOW`、`durationText(minutes)`、押せないなら待たせない）。 | 内容の組み立ては消える（`ObjectWindowAction` が `TooltipContent` を答える／映しが埋める） | `reason` を `undefined` のままにできる契約を保つため、既定文を窓が持たざるを得ない |
| PropertiesPane.ts#PropertiesPane | `select` | `Button`（同上） | 上の `addTabs` と同じ。 | 消える | 同上 |
| PropertiesPane.ts#PropertiesPane | `buildRows` | `src/ui/scrollArea.ts` | 「受け面と入れ物を用意した送れる領域」を作る口。`ScrollArea` は「中身は持ちません」と宣言しており、呼び出し側が **(1) `addPanel` を敷く → (2) `container` を作る → (3) `ScrollArea` に渡す → (4) `setContentLength`** の4手順と「面は中身より先に」の順序規約を覚える。 | 消える（`createScrollViewport(scene, rect)` 相当の入口を足せば） | `ScrollArea` は「既にある表示物へ振る舞いを足す道具」を自称しており、中身を所有する形とは相容れない。ただし入口を1つ足すのは矛盾しない |
| RecipeWindow.ts#RecipeWindow | `fillCategories` | `src/ui/scrollArea.ts` | 同上。**同じ4手順と、ほぼ同じ注意書きコメント**（「ドラッグとホイールを受ける面は、中身より先に敷く」）を持つ。 | 消える | 同上 |
| DescriptionPane.ts | `addText`（module） | `src/ui/labels.ts` の `addLabel` | `LabelStyle` に **折り返し幅** と **行間** が無い。今は `addLabel(...).setLineSpacing(...)` の後に `setWordWrapCallback(wrapByCharacter(w))` を呼ぶ2手順。 | 消える | なし |
| Tooltip.ts#Tooltip | `addText` | 同上 | 同上。ここは `addLabel` を通らず `scene.add.text` に `FONT_FAMILY`・`fontPx`・`cssColor` を直に組んでいる（折り返しと行間を足すために書き下したもの）。 | 消える | なし |
| ExplorationPane.ts | `percentOf`（module） | `looks/`（意匠） | 数を表示文字列にする口。`looks/durationText.ts` が前例で、そこに `percentText` が無いだけ。 | 消える | なし |
| ExplorationPane.ts | `noteOf`（module） | `ExplorationContent`／映し | 探索率から**世界の話**（「隠された道はすべて見つけた」）を言い分ける機能。部品が世界の語彙を持たされている。 | 消える（`ExplorationContent` が文を運ぶ） | なし |
| StatusBar.ts | `createLabel`（module） | `src/ui/labels.ts`／代用の規則 | (1) `addLabel` を通っていない（`FONT_FAMILY`・`fontPx`・`cssColor` を手で組む）。(2) 「絵が無ければ表示名」という代用の規則が `StatusDetailWindow.addTileLabel` と二重。 | 消える | `this` を使わないためモジュール関数へ出ているが、実体は行の見出しなので行の側に戻せる |
| StatusBar.ts | `fitted`（module） | `src/ui/textLayout.ts` | 「欄に収まらない文字を**縮めて**収める」。同じ関心の `truncateToWidth`（末尾省略）は既にそこに居る。収め方が違うだけ。 | 消える | なし。名前からは「縮めて収める」と読めない（名前不一致） |
| StatusBar.ts#StatusBar | `showChange` | `looks/theme.ts` | 「増減の記号（▲▼）と、良し悪しの色」の対応表。`StatusDetailWindow.markOf`＋`buildTile` が同じ規則の別実装。 | 記号と色の決定は消える。残るのは `changeMark.setText/setColor` の1行 | なし |
| FlipCalendar.ts#FlipCalendar | `addDigit`, `addColon` | `src/ui/labels.ts` の `addLabel` | 足りない機能は**無い**。`addLabel` は size/bold/color を受けるのに通っておらず、`scene.add.text` に `FONT_FAMILY`・`fontPx`・`cssColor(COLOR.text)` を手で組んでいる。 | 文字の生成は消える。残るのは桁の位置決め（下端揃え）だけ | なし |
| FlipCalendar.ts | `createDigitPaper`（module） | `Card.ts` の `createPaper` | 「絵があれば貼り、無ければ図形で描く紙」。**コメントが自ら「Card.tsのcreatePaperと同じ流儀」と書いている**が、その流儀は共有されていない。 | 消える（紙の生成を1つの仕組みへ畳めば） | 貼る絵とフォールバックの図形が部品ごとに違うので、テクスチャキーと図形の描き方をパラメータにする必要がある |
| GainParticles.ts | `pointOnEdge`（module） | `src/ui/Rect.ts` | 「中心から見た角度方向に、縁までの距離／縁の点」。純粋な矩形の幾何。 | 幾何は消える。残るのは `SPAWN_MARGIN_*` のばらつき | なし |
| GainParticles.ts | `arcControl`（module） | `src/ui/`（2次ベジェの不在） | 「2点の中点から法線方向へずらした制御点」と、その曲線上の点。**`MapWindow.drawDottedArc`（L374〜381）が同じ式を独立に書いている**。Phaser にも `Phaser.Curves.QuadraticBezier` があるが、どちらも使っていない。 | 消える | なし |
| ProgressRing.ts#ProgressRing | `fillSector` | `src/ui/shapes.ts` | 「ドーナツ状の扇形を塗る」。太線の円弧では半透明の重なりが縞になるという理由まで含めて、汎用の描画の下働き。 | 消える。触る `this` は `graphics`/`inner`/`outer` の3つだけで、ゲームの語彙は無い | なし |
| ProgressBar.ts | `alertBorderColor`（module） | `looks/theme.ts` | 「域→警戒の枠の色」の対応表。同種の `statusFillColorFor` は既に theme.ts に居る。 | 消える | なし |
| Button.ts | `textButtonBoxStyle`（module） | `looks/theme.ts` | 「文字ボタンの台紙」という意匠トークンの組（塗り・縁・線幅・丸み）。6ファイルがここへ色を訊きに来ている。 | 消える | `addTextButton` と `tabBoxStyle` の両方がこれを通す約束を、同一ファイル内であることで担保している |
| WeatherPanel.ts#WeatherPanel | `showSky` | `src/ui/shapes.ts` | 「絵を矩形いっぱいに敷いて、はみ出しを切る（cover）」。**`addTiledImage` が既に「絵を矩形いっぱいに敷く」を名乗っている**が、そちらは高さに合わせて横へ繰り返す方式で、cover+crop が無い。 | 敷き方は消える。残るのは「右上を合わせる」という意匠の選択と、絵が無いときの単色板 | `setCrop` を使う理由（WebGL の無い環境でマスクが効かない）が汎用側の知識になるが、それはむしろ汎用側にあるべき |
| WeatherOverlay.ts | `scatter`（module） | `src/util/` | 種から決まる乱数列（mulberry32）。雨とは無関係で、担当範囲どころか `src` 全体でここにしか無い。 | 消える | なし。名前からは乱数列を返すと読めない（名前不一致） |
| LocationArtLoader.ts#LocationArtLoader | `load`, `pump`, `settle` | Phaser の Loader（`scene.load`） | (1) ローダ実行中に足した分を待たせてまとめて渡すキュー。(2) 完了と失敗を1つの「決着」として扱う口。**3つとも土地の語彙を1つも持たない**（土地を知るのは `request`/`loaded`/`onceLoaded` だけ）。 | **B は直せない。** ただし3つまとめて `src/ui/` の汎用な遅延ロードへ出せば、このクラスからは消える | B が外部ライブラリ。クラスが「土地の薄い皮＋Phaserローダの汎用な芯」の2層になっている |

## 同じ B に対して複数の A が補っているもの

優先度順。上ほど「B へ1つ足せば消える箇所が多い」。

### 1. `src/ui/labels.ts` の `LabelStyle` に折り返し幅・行間が無い（範囲内6ファイル8箇所＋範囲外1）

`addLabel(...)` の後に `setWordWrapCallback(wrapByCharacter(w))`（と `setLineSpacing`）を呼ぶ、という
**2手順を全員が覚えている**。`LabelStyle` に `wrapWidth` と `lineSpacing` を足すだけで全部消える。

| A | 場所 |
|---|---|
| `DescriptionPane.addText` | DescriptionPane.ts L102-104 |
| `Tooltip.addText` | Tooltip.ts L143-150 |
| `StatusDetailWindow`（説明文） | StatusDetailWindow.ts L148-149 |
| `StatusDetailWindow.addTileLabel` | StatusDetailWindow.ts L470 |
| `ModalDialog`（題・本文の2箇所） | ModalDialog.ts L80, L84 |
| `ExplorationPane`（補足） | ExplorationPane.ts L101 |
| `ObjectWindow`（題） | ObjectWindow.ts L223 |
| （範囲外）`NewGameScene` | NewGameScene.ts L376-377 |

### 2. `addLabel` をそもそも通っていない（範囲内4ファイル）

`FONT_FAMILY` / `metrics.fontPx()` / `cssColor(COLOR.text)` を各自が手で組んでいる。1 を直すときに
同時に通せば片付く。`StatusBar` が最多で、1つのファイルに5箇所ある。

`StatusBar.createLabel`（L417, L428）と `StatusBar` の ctor（L236, L264, L288）、
`FlipCalendar.addDigit`（L120）・`addColon`（L140）、`Tooltip.addText`（L143）、`GainParticles`（L88）。

### 3. `src/ui/shapes.ts` に「描く」の下働きが足りない（範囲内6件）

`shapes.ts` が持つのは角丸矩形（`drawBox`）と敷き詰め（`addTiledImage`）だけで、曲線・円弧・
しっぽ・cover が無い。**`dashedLine` は既に居るが private** で、破線が `strokeDashedBox` 経由でしか
使えないのが象徴的。

| A | Bに足りないもの |
|---|---|
| `StatusDetailWindow.drawStageBox` | （足りていない訳ではなく）`drawBox` の手写し |
| `StatusDetailWindow.drawStagePlate` | しっぽ付きの角丸矩形 |
| `ProgressRing.fillSector` | ドーナツ扇形の塗り |
| `MapWindow.drawDottedArc` | 曲線に沿った点線（直線版は private で存在） |
| `MapWindow.drawIslandOutline` | 揺らした円のパス |
| `WeatherPanel.showSky` | cover（`addTiledImage` の隣に無い） |

### 4. `Button.ts` に「タブ列」と「役割名」が無い（範囲内4件）

- **タブ列**: `ObjectWindow.addTabs`＋`replacePane` と `PropertiesPane`（ctor＋`select`）が、
  「選択が変わったら全ボタンへ `setBoxStyle(tabBoxStyle(...))` を呼び直す」という同じ3行を持つ。
  第1波が「タブ列が2回実装されている」と書いた差は、**選択状態を `Button` 側が持たない**という1点。
- **役割名**: `TextButtonStyle` が生の色3つなので、default/primary/danger/disabled → 色の対応を
  `ModalDialog.addAction`・`ObjectWindow.addButtonRow` が別々に書いている（範囲外にも3箇所）。

### 5. `src/ui/scrollArea.ts` が受け面と入れ物を用意しない（範囲内2件＋範囲外1）

`PropertiesPane.buildRows`・`RecipeWindow.fillCategories`（＋範囲外 `CardLane`）が、
**同じ4手順と、ほぼ同じ注意書きコメント**（「面は中身より先に敷く」）を持つ。同じ規約が3箇所に
写されている状態で、`ScrollArea` 側に入口を1つ足せば規約ごと1箇所へ集まる。

### 6. `looks/theme.ts` に「増減の記号」が無い（範囲内2件）

`StatusBar.showChange`（▲▼＋良し悪しの色）と `StatusDetailWindow.markOf`＋`buildTile`
（▲▼＋＋−、色は `buildTile` 側）。**形と色が別の場所に割れているのは詳細ウィンドウ側だけ**で、
同じ規則が2ファイル3箇所に散っている。`statusFillColorFor` の隣が空いている。

### 7. 「絵が届いているか」を答える口が無い（範囲内5件）

`scene.textures.exists(...)` を各部品が直に訊いて、届いていないときの代用を自分で書いている:
`StatusDetailWindow.buildTile`・`FlipCalendar.createDigitPaper`・`WeatherPanel.showSky`・
`DustPuff.burst`・`WeatherOverlay.drawTile`（範囲外に `Card.createPaper`・`CardLane`・`LaneHaze`・
`PlayScene` 2箇所）。`src/art/` は「絵の名前とURL」までしか答えず、**「今この場面に届いているか」を
答えない**ため、代用の判断が部品の数だけ増える。

### 8. 2次ベジェが無い（範囲内2件）

`MapWindow.drawDottedArc`（L374-381）と `GainParticles.arcControl`＋`emitGainParticles` の
`onUpdate`（L107-108）が、制御点の求め方も曲線の展開式も独立に書いている。

---

### 補足: なぜ `this` を使わない private が `StatusDetailWindow` に4件集中するのか

このウィンドウだけが、**既存の部品に載らない小部品を2つ組んでいる**から。

- 段の目盛り・囲み・名札は「`ProgressBar` の上に重ねるもの」だが、`ProgressBar` にそれを受ける口が
  無い。だから窓が (a) バーの矩形を控え直し (b) バーの角の丸み `height/4` を写し (c) バーの直後に
  `marks` を作って重なりを守る、という3つの手順を引き受けている。
- 影響の枠は `Card` でも `StatusBar` でもない3つ目の札で、置き場が無い。

他の窓は既存の部品（`Card`・`CardLane`・`ProgressBar`・`StatusBar`・`Button`）を並べるだけなので、
描画の下働きを自前で持つ必要が無い。つまり「`this` を一度も参照しない private メソッド」は、
**B の機能が足りていない箇所を指す構文上のサイン**として実際に機能している。

判定3（利用者が近くにいるので置かれている）と判定4（何かを守るためにそこに居る）の間に、
**「B が足りないので代わりに書いている」という第3の型**があり、担当範囲76件のうち43件がこれに当たる。
このうち **B を直せないのは `MapWindow.touchPointer`（Phaser の型）だけ**で、
`LocationArtLoader` の3件は B（Phaser の Loader）を直せない代わりに丸ごと汎用へ出せる。
残りはすべて B 側に足す口が具体的に書ける。

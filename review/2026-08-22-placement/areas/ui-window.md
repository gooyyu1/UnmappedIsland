# ui-window

採点の基準（迷ったときの倒し方）:

- 窓は層ではなく**組み立て**（CodeStructure.md 2節）。「どの部品をどこへ置くか」「映しの答えを誰へ渡すか」は
  判定1。**判断・世界の語彙・描画そのもの・配色の決定**が混じっていたら 3以上。
- そのファイルからしか使わない**寸法定数**は 3 に留めた。`childWindowLayout.ts` に
  「個々のウィンドウ固有の寸法は各ウィンドウが持つ」と明示があり、寸法だけを理由に 4 にはしない。
- **色**は別扱い。配色は `looks/theme.ts` の `COLOR` に集約されており、窓が生の16進を持つのは
  `src/game/ui/` 全体で MapWindow だけ（他は WeatherOverlay のみ）。
- 状態を触る private メソッドは 1。**純粋な計算・描画・文言**だけの private/module ヘルパーが 3。

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/game/ui/DescriptionPane.ts | 12 | 6 | 2 | 3 | 1 | 0 |
| src/game/ui/ExplorationPane.ts | 19 | 13 | 2 | 3 | 0 | 1 |
| src/game/ui/MapWindow.ts | 53 | 23 | 0 | 11 | 19 | 0 |
| src/game/ui/ModalDialog.ts | 22 | 14 | 0 | 6 | 2 | 0 |
| src/game/ui/ObjectWindow.ts | 68 | 52 | 2 | 3 | 11 | 0 |
| src/game/ui/ObjectWindowPane.ts | 8 | 8 | 0 | 0 | 0 | 0 |
| src/game/ui/PropertiesPane.ts | 29 | 21 | 2 | 6 | 0 | 0 |
| src/game/ui/RecipeWindow.ts | 32 | 26 | 0 | 5 | 1 | 0 |
| src/game/ui/SlotPane.ts | 13 | 10 | 3 | 0 | 0 | 0 |
| src/game/ui/StatusDetailWindow.ts | 45 | 10 | 0 | 26 | 9 | 0 |
| src/game/ui/TextInput.ts | 10 | 9 | 0 | 0 | 1 | 0 |
| src/game/ui/Tooltip.ts | 26 | 13 | 3 | 9 | 1 | 0 |
| **合計** | **337** | **205** | **14** | **72** | **45** | **1** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| DescriptionPane | 借りた札と説明文を左右に並べる | `NO_DESCRIPTION`（説明が無いときの言い分＝映しの文言） |
| ExplorationPane | 探索率のバーと発見物のレーンを並べる | `noteOf`（率から**世界の話**を言い分ける）、`percentOf`（数の見せ方） |
| MapWindow | 土地の札を置いた地図を見せ**、拡大縮小と平行移動を受け付け**、道と島の輪郭を**描く** | 接続詞が2つ＝責務が3つ。`zoom`/`pan*`/`pinch*`/`addPan`/`addZoom`/`zoomAt`/`touchPointer`（視野の操作）、`drawDottedArc`/`drawIslandOutline`/`ROAD_*`/`CHART_*`（海図の絵） |
| ModalDialog | 題・本文・札・ボタンを1枚の板に組む | `BUTTON_HEIGHT`/`BUTTON_GAP`（子ウィンドウの `ACTION_HEIGHT`/`ACTION_GAP` と同じ意味で値だけ違う） |
| ObjectWindow | オブジェクト1つの窓を組み立て、タブで面を差し替え**、最下段の操作と吹き出しを出す** | `properties`/`exploration`/`setProperties`/`setExploration`（面が居ない間の**内容の控え**＝映しの持ち物）、`CANNOT_DO_NOW`、`*_LABEL`、`*_TAB` |
| ObjectWindowPane | 窓に差し込む面の契約 | なし |
| PropertiesPane | カテゴリのタブを出し**、選ばれたカテゴリのバーを縦に送る** | `tabButtons`/`select`/`CATEGORY_*`（ObjectWindow のタブ列と同じ仕掛けの二重実装） |
| RecipeWindow | レシピの棚を積んで送る | `lockedReason`（**押せない理由を名前に織り込む**のが窓の側） |
| SlotPane | スロットの中身のレーンを1本置く | なし |
| StatusDetailWindow | ステータス1件の詳細を組み立て**、段の名札と影響の枠を描く** | `build*`/`draw*`/`plateWidth`/`markOf`/`STAGE_*`/`TILE_*`（**2つの小部品そのもの**） |
| TextInput | Phaserに無い文字入力欄をDOMで足す | クラス全体（ゲームの語彙を1つも持たない） |
| Tooltip | 題・本文・補足の吹き出しを出す | `bringToTop`（**重なりの直し方を呼び出し側に覚えさせる**） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| ExplorationPane.ts | `noteOf()` | 所属 | 5 | 探索率から「この土地に隠された道はすべて見つけた」と**世界の話を言い分けている**——部品は世界の語彙を知らない側 | `ExplorationContent` に文を持たせ、映し（PlayScreenView）が組み立てる | | |
| MapWindow.ts | `CHART_PAPER`, `CHART_LINE`, `ROAD_INK` | 所属 | 4 | `src/game/ui/` で生の16進を持つ唯一の窓。配色を決めるのは意匠 | `looks/theme.ts` の `COLOR` | `COLOR` は docs/ui のモックのCSSと値を対応させる約束（theme.ts 冒頭）で、モックに無い地図窓の3色を足せない | |
| MapWindow.ts#MapWindow | `zoom`, `panX`, `panY`, `pinchDistance`, `pinchMid`, `panLast`, `sceneListeners`, `addPan()`, `addZoom()`, `zoomAt()`, `listenScene()` / module `MAX_ZOOM`, `WHEEL_ZOOM_BASE`, `touchPointer()` | 配置 | 4 | ホイール・ピンチ・パンの受け口と倍率の保持は**ゲームを消しても1文字も変わらない**（`touchPointer` は「Phaserの型の嘘を受ける」と自称しており、CodeStructure.md 4節が汎用と呼ぶそのもの） | `src/ui/panZoom.ts`（汎用） | 変換をコンテナに掛けず**カード1枚ずつへ書き戻している**（`applyTransform`）。札はドラッグ入力と `bringToTop` のためシーン直下に居る必要があり、汎用の入れ物に包めない | |
| MapWindow.ts | `drawDottedArc()`, `drawIslandOutline()` | 所属 | 4 | ベジェ弧の等間隔打点と、正弦波で揺らした円——**地図の絵**であって組み立てではない | `src/game/ui/MapChart.ts`（新設）／弧の打点は `src/ui/shapes.ts` | ズーム・パンの値を持つのが窓だけで、変換のたびに描き直す必要がある | |
| MapWindow.ts#MapWindow | `unplacedCount()` | 所属 | 3 | 名前は「置かれていない数」だが、実体は**この窓が今までに `placements` へ入れた**うち保存に無い件数＝待機列の次の番号 | `trayCell` 側へ番号を渡す形に畳む | | ○ |
| MapWindow.ts#MapWindow | `applyTransform()`, `drawRoads()`, `centerPointOf()`, `clampTopLeft()`, `trayCell()` / `CARD_SCALE`, `ROAD_DOT_RADIUS`, `ROAD_DOT_SPACING`, `ROAD_BEND_RATIO`, `CURRENT_BORDER_WIDTH` | 所属 | 3 | 視野と海図の道具立て。上の2件が出れば一緒に動くが、単体では利用者が近い | 同上（`panZoom` / `MapChart`） | | |
| ModalDialog.ts | `BUTTON_HEIGHT`, `BUTTON_GAP` | 所属 | 4 | 子ウィンドウの `ACTION_HEIGHT`(=88)/`ACTION_GAP`(=24) と**同じ意味で値だけ違う**（72/16）。同じことを2箇所が別々に決めている | `looks/childWindowLayout.ts` | モーダルは `centerWindow`/`closeRow` の枠組みに乗っておらず、子ウィンドウ専用と書かれた定数群を引けない | |
| ModalDialog.ts | `PLATE_MAX_WIDTH`, `PLATE_PADDING`, `PLATE_GAP`, `PORTRAIT_HEIGHT`, `addPortrait()`, `addAction()` | 所属 | 3 | 板の寸法と生成ヘルパー。利用者がこのクラスだけ | 同上 | | |
| ObjectWindow.ts#ObjectWindow | `properties`, `exploration`, `setProperties()`, `setExploration()` | 所属 | 4 | **今見せていない内容の控え**を窓が抱えている。「次に何を見せるか」は映しの答え（CodeStructure.md 1節） | `ObjectWindowOptions` を `properties: () => …` の問い合わせ口にし、控えは映し側（PlayScreenView）が持つ | 面はタブを開くたび作り直されるので、面が居ない間に届いた内容を誰かが持っていないと落ちる | |
| ObjectWindow.ts | `DESCRIPTION_TAB`, `PROPERTIES_TAB`, `EXPLORATION_TAB` | 所属 | 4 | タブ識別子の名前空間が**暗黙の規約**（`@` 印でスロットの `key` と衝突を避ける）で、片方の生成元は外（映し） | タブの識別子を型で表す（`{kind:'slot',key}` / `{kind:'description'}` …） | スロットの `key` を決めるのは映しなので、衝突しない印は文字列規約として窓側で足すしかない | |
| ObjectWindow.ts | `CANNOT_DO_NOW` | 所属 | 4 | 「今はできない。」は**なぜ押せないか**の既定文＝映しの言い分 | 映しが `reason` を常に埋める | `ObjectWindowAction.reason` を `undefined` のままにできる契約を保つため | |
| ObjectWindow.ts / DescriptionPane.ts / StatusDetailWindow.ts | `DESCRIPTION_LABEL`, `PROPERTIES_LABEL`, `EXPLORATION_LABEL`, `NO_DESCRIPTION`（2ファイルに同一文字列）, `NO_INFLUENCE` | 配置 | 4 | 画面のことばがファイルごとに散っている。`NO_DESCRIPTION` は2ファイルで**同じ文を二重に持つ** | (なし。末尾に記載) | 表示文字列の対応表（`src/locale/`）はワールド定義の語を引く仕組みで、UIの地の文を置く口が無い | |
| ObjectWindow.ts#ObjectWindow | `openedTab`, `cardRect` | 可視性 | 2 | 記憶・飛ばし元の起点として外から要る問い | | | |
| ObjectWindow.ts | `TAB_HEIGHT`, `lastCardRect`, `decideWidth()` | 所属 | 3 | 寸法と、面を捨てる前に控える枠 | `looks/childWindowLayout.ts` | | |
| PropertiesPane.ts | `CATEGORY_WIDTH`, `CATEGORY_HEIGHT`, `CATEGORY_GAP`, `ROW_GAP`, `NAME_WIDTH`, `ROWS_SHOWN` | 所属 | 3 | 寸法。`CATEGORY_HEIGHT` はタブ列の高さで、ObjectWindow の `TAB_HEIGHT` と同じ話 | `looks/childWindowLayout.ts` | | |
| PropertiesPane.ts#PropertiesPane | `static height()`, `lanes`(空配列) | 所属 | 2 | 面を作る前に高さが要る／レーンを持たない面であることの表明 | | | |
| RecipeWindow.ts#RecipeEntry | `lockedReason` | 所属 | 4 | 窓が `${name}（${lockedReason}）` と**名前を作り直している**——何と出すかは映しの答え | 映しが `card.name` に織り込み、契約は「押せるか」だけにする | `CardContent` は札の見た目の契約なので、画面ごとに違う名前を映しに作らせると「札の名前」が一意でなくなる | |
| RecipeWindow.ts | `TITLE_SIZE`, `HEADING_SIZE`, `CARD_GAP`, `WINDOW_COLUMNS`, `WINDOW_MAX_WIDTH` | 所属 | 3 | 寸法。`TITLE_SIZE`(28) は StatusDetailWindow の同名(34)と別物 | `looks/childWindowLayout.ts` | | |
| SlotPane.ts / ExplorationPane.ts / DescriptionPane.ts | `static width()`, `static height()`, `refresh()`(何もしない面) | 所属 | 2 | 面を作る前に窓の寸法を決めるための静的な問い／契約の空実装 | | | |
| StatusDetailWindow.ts#StatusDetailWindow | `drawStagePlate()`, `drawStageBox()`, `drawStageTicks()` / module `plateWidth()` | 所属 | 4 | バーに段の目盛り・囲み・しっぽ付きの名札を重ねる**独立した小部品** | `src/game/ui/StageMarks.ts`（`ProgressBar` の隣） | 表示順＝生成順なので、板・目盛り・文字・バーを**1つの生成順**で並べる必要があり、窓が全部を持たないと重なりが崩れる（ctor のコメントが明示） | |
| StatusDetailWindow.ts#StatusDetailWindow | `buildSection()`, `buildTile()`, `addTileLabel()` | 所属 | 4 | 影響の枠（絵・記号・押せる領域）は再利用できる札の部品 | `src/game/ui/InfluenceTile.ts` | 寸法が決まるまで置けないため生成と配置を分けて `place` を返しており、後片付けも窓の `objects` に相乗りしている | |
| StatusDetailWindow.ts | `markOf()` | 所属 | 3 | `reversible`/`increases` から記号を引く対応表。契約（`StatusInfluence`）の側が自然 | `src/game/ui/StatusBar.ts` | | |
| StatusDetailWindow.ts | `HEADER_ICON_SIZE`, `TITLE_SIZE`, `DESCRIPTION_SIZE`, `DESCRIPTION_LINE_GAP`, `BAR_HEIGHT`, `STAGE_*`(9), `SECTION_*`(2), `TILE_*`(8), `INACTIVE_ALPHA`, `MIN_TILE_ROWS` | 所属 | 3 | 25個の寸法・濃さ。上の2部品が出れば大半は一緒に動く | `StageMarks` / `InfluenceTile` | | |
| TextInput.ts | `class TextInput`（ファイルごと） | 配置 | 4 | ゲームの語彙を1つも持たず、**Phaserにキャンバス上の文字入力が無い**ことだけを埋めている＝CodeStructure.md 4節の汎用部品そのもの | `src/ui/textInput.ts` | `COLOR`/`SIZE`/`FONT_FAMILY` をCSS文字列へ直に埋めており、汎用側へ出すには `setLabelDefaults` に相当する差し替え口が要る | |
| Tooltip.ts#Tooltip | `bringToTop()` | 所属 | 4 | 「ボタンを作り直したら吹き出しを持ち上げ直す」手順を**呼び出し側に覚えさせている**（ObjectWindow.setActions） | `looks/screenDepth.ts` の `SCREEN_DEPTH` に吹き出しの層を足す | 子ウィンドウの中の重なりが `SCREEN_DEPTH` に載っておらず生成順だけで決まっているため、順序を自分で守る手段が無い | |
| Tooltip.ts | `PADDING`, `LINE_GAP`, `CARD_GAP`, `TITLE_SIZE`, `BODY_SIZE`, `NOTE_SIZE`, `NOTE_ALPHA`, `MAX_WIDTH`, `addText()` | 所属 | 3 | 寸法と、`ui/labels.ts` の `addLabel` を折り返し・行間つきで書き直した private ヘルパー | `looks/` ／ `addText` は `src/ui/labels.ts` へ口を足す | | |
| Tooltip.ts#Tooltip | `shown`, `width`, `height` | 所属 | 2 | 同じ文言なら作り直さない・置き場所を測るために要る控え | | | |
| DescriptionPane.ts | `TEXT_SIZE`, `LINE_SPACING`, `addText()` | 所属 | 3 | 寸法と、ctor と `static height` の両方から呼ぶ生成ヘルパー | `looks/` | | |
| ExplorationPane.ts | `percentOf()`, `BAR_HEIGHT`, `NOTE_HEIGHT` | 所属 | 3 | 数を表示文字列にするのは意匠側の仕事（`looks/durationText.ts` が前例） | `looks/`（`percentText`） | | |

## 移動先が書けなかったもの

- **画面のことば（UI文言）の置き場が無い。** `NO_DESCRIPTION`（DescriptionPane と StatusDetailWindow に
  **同一の文字列が2つ**）、`DESCRIPTION_LABEL`/`PROPERTIES_LABEL`/`EXPLORATION_LABEL`、`NO_INFLUENCE`、
  および宣言になっていない直書き——`'閉じる'`（MapWindow・ObjectWindow・RecipeWindow・StatusDetailWindow の
  4箇所）、`'地図'`、`'与えている影響'`/`'受けている影響'`、`'カードを動かして、自分だけの地図を作る…'`。
  `src/locale/` はワールド定義の語（オブジェクト名・変種）を引く仕組みで、UIの地の文を持つ口が無い。
  欠けている概念は「**ワールド定義に由来しない画面の文字列を1箇所で持つ対応表**」。
  そこが決まらない限り、同じ文が窓ごとに増え続ける。

## ファイル配置（層=配置）についての所見

- 12ファイルが `src/game/ui/` に居ることは CodeStructure.md 1節の「ウィンドウは部品と同じ場所に置く」に
  合っている。例外は **TextInput**（ゲームの語彙ゼロ・Phaserの欠落を埋めるだけ＝`src/ui/` の定義に一致）と、
  **MapWindow の中の視野操作**（同じ理由）。
- 窓とペインが1ディレクトリに混在しているが、`*Window.ts` と `*Pane.ts` で読み分けられており、
  ペイン契約（`ObjectWindowPane.ts`）が独立ファイルなので同居の害は小さい。
- **重なりの決め方が2系統ある。** `looks/screenDepth.ts` が「重なりの順序は1箇所にだけ書く」と宣言している
  一方、子ウィンドウ4つは「表示順は生成順で決まる」を前提にコメントで注意書きを配っている
  （ObjectWindow・StatusDetailWindow の ctor、PropertiesPane・RecipeWindow の「面は中身より先に敷く」、
  Tooltip.bringToTop）。ここが一番、**同じ規約が5箇所に散っている**状態。
- **タブ列が2回実装されている。** ObjectWindow（`addTabs`/`tabButtons`/`tabBoxStyle`）と
  PropertiesPane（`select`/`tabButtons`/`tabBoxStyle`）。差は「並べる幅の決め方」だけに見える。
- 同名で値の違う定数がファイルをまたいで並ぶ（`TITLE_SIZE` 28/34、`BAR_HEIGHT` 72/52、`CARD_GAP` 12/16）。
  それぞれ別物なので誤りではないが、寸法が窓ごとに閉じている今の方針の帰結として記録しておく。

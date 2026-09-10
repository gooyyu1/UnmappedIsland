# ui-card

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/game/ui/Card.ts | 175 | 75 | 28 | 61 | 11 | 0 |
| src/game/ui/CardDragController.ts | 60 | 48 | 6 | 6 | 0 | 0 |
| src/game/ui/CardLane.ts | 54 | 37 | 5 | 5 | 7 | 0 |
| src/game/ui/CardTable.ts | 75 | 57 | 6 | 6 | 6 | 0 |
| src/game/ui/LaneHaze.ts | 25 | 16 | 4 | 5 | 0 | 0 |
| src/game/ui/cardFace.ts | 2 | 1 | 1 | 0 | 0 | 0 |
| src/game/ui/laneCells.ts | 10 | 8 | 0 | 2 | 0 | 0 |
| **合計** | **401** | **242** | **50** | **85** | **24** | **0** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| Card | 1枚の札の紙・絵・桟・端の操作を描き、**かつ**今その枠に在るインスタンスの集合を覚える（接続詞＝責務2つ） | `paperRect`/`windowRect`/`windowSpan`/`railMetrics`/`paperStroke`（札の幾何の計算）、45個の寸法・配色・時間の定数（意匠）、`create*` 7関数（表示物の組み立て） |
| EmptyCard / CellHighlight / CellOverlay | 枠そのものの装飾（空き枠の破線・縁の強調・重ねる文字）を描く | Card.ts に同居していること自体（Cardの札を描く責務とは別物） |
| CardContent（契約） | 札1枚に何を出し、何を押せるかを部品へ渡す | `art`・`background`（世界の識別子）、`atMin`/`atMax`（ゲージ宣言の両端） |
| CardLane | 枠の並びの幾何を決め、**かつ**背景板を敷き、**かつ**横スクロールを持ち、**かつ**落とし先を答える（責務4つ） | `dropTargetAt`/`isCardBody`/`dropIndicatorRect`（ドラッグ側の問い）、`beginScroll`/`scrollByDrag`（ScrollAreaの中継）、`hazeSurface`/`hazeTargets`（陽炎） |
| CardDragController | レーンをまたぐカードのドラッグを、掴む・運ぶ・落とすに翻訳する | グロー・インジケータの意匠定数 |
| CardTable | 場に出ている札の実体を所有し、枠の外に在る間の移動を進める | `MotionContext`（差し替えのきっかけ＝映しの語彙）、`CarriedCard`（指が運ぶ札）、`idsOf`/`rectOf`（Cardの中身の外からの組み立て） |
| CarriedCard | 指の下にある札の束を持ち、枚数の増減と行き先を扱う | （なし。ただし置き場所がCardTable.ts） |
| LaneHaze | 渡された面に陽炎の変位フィルタを掛け続ける | 波の細かさ・横縦比・縁のぼかし（陽炎の見え方＝意匠） |
| cardFace | CardContentから見た目のぶんだけを取り出す | — |
| laneCells | 枠の契約（LaneCell）と、**かつ**画面の側が決める枠数・レーン幅（責務2つ） | `PEEK_WIDTH`・`LANE_CELLS_MAX`（寸法・上限） |

## 明細（判定2以上）

### src/game/ui/Card.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| Card.ts | `EMPTY_FRAME_ALPHA` `EMPTIED_ALPHA` `PAPER_INSET` `PAPER_RADIUS` `BORDER_WIDTH` `ALERT_OUTLINE_WIDTH` `ALERT_BLINK_DURATION_MS` `ALERT_BLINK_MIN_ALPHA` `FRAME_SIDE` `FRAME_HEAD` `WINDOW_RADIUS` `NAME_SIZE` `ROAD_ARROW_*`(3) `PRESSED_BORDER_WIDTH` `EDGE_OVERLAY_ALPHA` `EDGE_ARROW_SIZE` `STACK_BADGE_*`(3) `MARK_SIZE` `MARK_MARGIN` `OVERLAY_*`(5) `STACK_COUNT_SIZE` `CELL_*`(5) `IN_PROGRESS_VEIL_ALPHA` `COOKING_*`(6) `RAIL_*`(3) | 配置 | 3 | 色・寸法・不透明度・アニメ時間は意匠（CodeStructure.md 1節）だが、唯一の利用者が同ファイルなので置かれている（計44件） | `looks/theme.ts`（または部品1つぶんの意匠 `looks/cardLook.ts`） | | |
| Card.ts | `EDGE_RATIO` | 所属 | 3 | 「札のどこを押したら端か」は操作の規則で、寸法ではない。CardLaneの`CARD_EDGE_RATIO`（左右1/4）と対の規約が2ファイルに分かれている | `CardLane.ts`（左右の規則と同居）か映し側 | | |
| Card.ts | `CARD_FRAME_TEXTURE` | 配置 | 2 | 素材のキーだが、BootSceneが読むための口として部品側に置く既存の統一規約（DustPuff・Button・FlipCalendarも同型） | （現状維持でよい） | | |
| Card.ts | `EDGE_DIRECTIONS` | 可視性 | 2 | 型の全列挙を回すためだけの配列。PlaySceneが回す用途に限る | （現状維持でよい） | | |
| Card.ts | `CardEdgeAction` `CardGauge` `CardCooking` `CardContent` | 配置 | 3 | 15ファイルが型として輸入する最も広い契約が、1586行のPhaser実装と同じファイルに同居している | `cardContent.ts`（`cardFace.ts`の隣） | | |
| Card.ts#CardGauge | `atMin` `atMax` | 所属 | 4 | 塗りの色をここから引く（`gaugeColorFor`）ため、ゲージ宣言（domain/PropertyDef.GaugeEnd）の語彙が部品の契約に入っている | 映しが解決した`color`だけを渡す／`looks/theme.ts` | 塗りの色は帯が動いている**最中の割合ごと**に引き直す（`gaugeBarFor`の`fillColor`はratioを引数に取るコールバック）ので、映しが一度だけ決めた1色では渡せない | |
| Card.ts#CardGauge | `key` `worsensUpward` | 所属 | 2 | `key`は差し替えをまたいでバーを同一視する鍵、`worsensUpward`は帯の向き。どちらも表示の都合 | — | | |
| Card.ts#CardContent | `art` `background` | 所属 | 4 | object_def識別子とスロット（owner+slot名）という**世界の語彙**を部品が持ち、テクスチャの解決（`objectTexture`/`cardBackgroundTexture`）まで部品が行っている | 映しがテクスチャキー（string）まで解決して渡す | 絵は後から届く（アセットパック・LocationArtLoader）。届いた時点で貼り替える`swapArtWhenLoaded`が部品側にあるため、識別子のまま持たないと貼り替え対象を引き直せない | |
| Card.ts#CardContent | `identity` `awaited` | 所属 | 2 | インスタンスIDは映しの語彙だが、差し替え時の同一視（reconcile・absorb）にプログラム上必要 | — | | |
| Card.ts#CardContent | `road` `midAction` | 所属 | 2 | 世界の概念（pathタグ・行動の途中）を真偽値1つに落とした表示フラグ。部品は矢印を出すか・帯を止めるかしか見ない | — | | |
| Card.ts#Card | `setPresence` `presentIds` `absorb` `holdsCard` | 所属 | 2 | 「今この枠に在るインスタンス」は部品が持ってよい状態（CodeStructure.md 1節）。CardTableが台帳を二重に持たないための唯一の在処 | — | | |
| Card.ts#Card | `cancelTap` | 可視性 | 2 | ドラッグに転じた指でタップを起こさせないための、CardDragControllerからの1点の口 | — | | |
| Card.ts#Card | `overlayText` `overlayTween` `alertBlink` `shownArt` `shownIcon` `shownBackground` `shownEdgeDirections` `shownGauges` `gaugeBars` | 所属 | 2 | 「前回何を出したか」の控え。差分更新とtweenの後始末というプログラム上の都合 | — | | |
| Card.ts#Card | `edgeRepeated` `tapCancelled` `present` `emptied` | 所属 | 2 | 入力の状態と在籍の控え。いずれも一般概念ではないが実装上要る | — | | |
| Card.ts | `createAlertOutline` `createEmptyOutline` `createPaper` `createArtImage` `createNameText` `createVeil` `createIconText` | 配置 | 3 | Card・EmptyCard・CellOverlayが共有する表示物の組み立て。同ファイル内に利用者が居るために置かれている | `cardParts.ts`（+ 寸法は意匠へ） | | |
| Card.ts | `paperRect` `windowSpan` `windowRect` `railMetrics` `paperStroke` `RailMetrics` `RailBar` | 配置 | 3 (RailBar/RailMetricsは2) | 札の中の領域割り（紙・窓・桟）を出す純粋な幾何。Phaserに触っていないので意匠に置ける。`paperRect`/`PAPER_RADIUS`はMapWindowが輪郭を重ねるために輸入していて、2箇所で同じ形を再現する規約になっている | `looks/cardGeometry.ts`（新設）または`looks/theme.ts` | | |
| Card.ts | `EmptyCard`(+ctor) `CellHighlight`(+ctor) `CellOverlay`(+ctor,`makeBadge`) | 配置 | 4 | 札を描くCardとは別の表示物（空き枠・縁の強調・枠に重ねる文字）が、Card.tsに同居して1586行にしている。利用者はCardLane（とShelfScene） | `CellDecorations.ts` / `EmptyCard.ts` | 紙の輪郭・空き枠の描き方をCardと共有するモジュール内関数（`createPaper`・`createEmptyOutline`・`paperStroke`）と`CELL_*`定数を、公開せずに使うため | |

### src/game/ui/CardLane.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| CardLane.ts#CardLane | `dropTargetAt` `isCardBody` `dropIndicatorRect` | 所属 | 4 | 「この点はどのカードの何か」「印をどこへ出すか」はドラッグ側の問いで、レーンは枠の幾何を持っているだけ | `CardDragController`（レーンは座標→添字だけを答える） | スクロール量・`originX`・`pitch`・`cardY`というレーン内部の座標系を公開せずに済ませるため | |
| CardLane.ts#CardLane | `beginScroll` `scrollByDrag` | 所属 | 4 | どちらもScrollAreaへの素通しで、レーン自身は何も判断していない | `ScrollArea`をドラッグ側へ直接渡す | 保持している`ScrollArea`（切り抜き・ホイール・慣性も持つ）を外へ出さないため | |
| CardLane.ts#CardLane | `hazeSurface` `hazeTargets` | 所属 | 4 | 「何を1枚の空気ごしに歪ませるか」はLaneHazeの問い。レーンが陽炎の語彙（HazeSurface/HazeTarget）を抱えている | `LaneHaze`（表示物の一覧を受け取る側で組む） | 背景板・ピン留め・区切り線を含むレーンの表示物リストを公開しないため | |
| CardLane.ts | `INSERT_MARK_WIDTH` `SLIDE_MS` `SLIDE_EASE` | 配置 | 3 | 寸法とアニメ時間＝意匠。とくに`SLIDE_MS`は`looks/cardFlight.ts`の`FLY_MS`が「滑りより少しだけ長く」と参照している相手で、対で決まる値が層をまたいで別々に居る | `looks/cardFlight.ts` | | |
| CardLane.ts | `CARD_EDGE_RATIO` | 所属 | 3 | 「カード本体か周りか」の操作の規則。Card.tsの`EDGE_RATIO`（上下1/6）と同種の判断が2ファイルに分かれている | Card.tsの`EDGE_RATIO`と1箇所へ | | |
| CardLane.ts | `sharesIdentity` | 所属 | 3 | `CardContent.identity`の同一視規則の実装。同じ規則の別の半分（`presentIds`・`absorb`）はCard側にある | `cardContent.ts`（契約と同じ場所） | | |
| CardLane.ts | `LaneDropTarget` `LaneUpdate` | 配置 | 2 | 前者はドラッグ側との、後者はCardTableとの受け渡しのためだけの形 | （`LaneDropTarget`はドラッグ側でもよい） | | |
| CardLane.ts#CardLane | `CardLaneOptions.clip` `CardLaneOptions.depth` `objects` | 所属 | 2 | 切り抜き・層・破棄漏れ対策という、いずれもPhaser上の都合 | — | | |

### src/game/ui/CardTable.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| CardTable.ts | `MotionContext`(+`origins` `released` `vanished` `born`) | 所属 | 4 | 中身は世界の変化ログの語彙（changedInstances）そのもので、映しの`MotionInput`とほぼ同じ形が部品側に二重に立っている。`released`だけ形が違う（`{grabbed, followers}` 対 `{ids}`）ため、変換関数`releasedIdsOf`が要る | `view/cardMotionPlan.ts`（`MotionInput`へ寄せる） | `MotionInput<C,R>`は総称で、実体の札と矩形を知る側でしか組めない。PlaySceneに総称を触らせないための非総称の入口として部品側に置かれている | |
| CardTable.ts | `CarriedCard`（クラスの置き場所） | 配置 | 4 | 「指が運んでいる札の束」はドラッグの概念で、CardTableは場の札の所有者。利用者はCardDragController | `CarriedCard.ts` | CardTableの飛行層（`layer`）と自由な札の台帳（`adoptFreed`）へ、公開を増やさずに触るため | |
| CardTable.ts | `FADE_MS` `GAP_MS` | 配置 | 3 | 現れる時間・飛び立つ間隔＝時間の見せ方（意匠）。同種の`FLY_MS`/`FLY_EASE_OUT`は`looks/cardFlight.ts`に居る | `looks/cardFlight.ts` | | |
| CardTable.ts | `idsOf` `rectOf` | 所属 | 3 | Cardの中身（`content.identity`・`x`/`y`/`cardWidth`）を外から組み立てている。Card自身が答えるべき（CarriedCardには既に`get rect`がある） | `Card`（`get ids` / `get rect`） | | |
| CardTable.ts | `placedCards` `releasedIdsOf` | 配置 | 3 | 計画（映し）の入力へ直すだけの詰め替え。利用者が同ファイルなので置かれている | `view/cardMotionPlan.ts`側の入口を1つにすれば消える | | |
| CardTable.ts#CardTable | `hold` `settleFreed` `adoptFreed` `flyTo` `tracked` | 所属 | 2 | 自由な札を「経過を見せ切るまで発たせない」ための状態と口。一般概念ではないが実装上要る | — | `hold`は本体を読むまで「何を止めるのか」が分からない |
| CardTable.ts | `CarryHandle` | 配置 | 2 | 便を外から打ち切るためだけの1メソッドの形 | — | | |

### src/game/ui/CardDragController.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| CardDragController.ts | `INDICATOR_BORDER` `INDICATOR_FILL_ALPHA` `GLOW_LAYERS` `GLOW_PULSE_MS` `GLOW_PULSE_ALPHA` | 配置 | 3 | 落とし先の枠とグローの太さ・不透明度・脈動の時間＝意匠 | `looks/theme.ts`（または`looks/dragLook.ts`） | | |
| CardDragController.ts | `sameTarget` | 所属 | 3 | 比べているのは`LaneDropTarget`の等価性。型の定義側が答えるのが自然 | `CardLane.ts`（`LaneDropTarget`と同じ場所） | | |
| CardDragController.ts | `MOVE_THRESHOLD` `CARRY_REST_SLOP` | 所属 | 2 | 「掴んだとみなす距離」「止まったとみなす距離」は部品が抱える規則としてCodeStructure.md 4節が認めているもの | — | | |
| CardDragController.ts | `CardDropInfo`(+`tooltip` `maxCount`) `CardDragHandlers` | 配置 | 2 | 組み立て（PlayScene）へ問い返すための形。ドラッグ以外からは使わない | — | | |

### src/game/ui/LaneHaze.ts / cardFace.ts / laneCells.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| LaneHaze.ts | `WAVE_ACROSS` `WAVE_DOWN` `HORIZONTAL_RATIO` `EDGE_FADE` `edgeFade` | 配置 | 3 | 陽炎の見え方の値。強さ・速さ（`HeatHaze`）は`looks/heatHaze.ts`に居るのに、波の細かさと縁のぼかしだけ部品側に残っている | `looks/heatHaze.ts` | | |
| LaneHaze.ts | `MAP_SIZE` `MAP_KEY` `applied` `refocusing` | 所属 | 2 | 変位マップのテクスチャ登録とフィルタの後始末という、Phaser上の都合 | — | | |
| cardFace.ts | `borrowedFace` | 所属 | 2 | 「借りた札は識別子だけ引き継ぐ」は子ウィンドウの札の運びかた（映しの判断）だが、扱う対象は部品の契約なのでここに居る | `view/ShownCards.ts`側でもよい | | |
| laneCells.ts | `LANE_CELLS_MAX` | 可視性 | 3 | exportだが他ファイルからの参照が無い（`laneWidthForCells`の内部でしか使われない） | 非公開に落とす | | |
| laneCells.ts | `PEEK_WIDTH` | 配置 | 3 | 覗かせる幅＝寸法（意匠） | `looks/theme.ts` | | |

## 移動先が書けなかったもの

判定4はすべて移動先が書けた。ただし**判定3の大半（Card.tsの44定数・CardLaneの3定数・CardDragControllerの5定数・LaneHazeの4定数）に、そのまま入る箱が無い**。`looks/theme.ts` は画面全体で共有する `COLOR`/`SIZE`/`FONT_FAMILY` の置き場で、「**部品1つぶんの意匠**」（この札の紙の余白、この覆いの濃さ、この印の大きさ）を置く単位が存在しない。`looks/cardFlight.ts`・`looks/heatHaze.ts`・`looks/rainStyle.ts` は既にその単位で切られているので、欠けているのは概念そのものではなく**カード・レーン・ドラッグのぶんの意匠モジュール**（例: `looks/cardLook.ts`）。これが無い限り、部品の中に意匠が溜まり続ける。

## ファイル配置（層=配置）についての所見

7ファイルすべて `src/game/ui/`（このゲームの部品）に居るのは妥当で、ディレクトリ違いは無い。問題は**ファイル内の同居**に集中している。

- `Card.ts` は (1) 契約4つ（CardContent一式、15ファイルが輸入）、(2) 札の実装、(3) 別の表示物3クラス（EmptyCard・CellHighlight・CellOverlay）、(4) 幾何の関数群、(5) 意匠の定数44個——の5つを1ファイルに抱えている。1586行の内訳はほぼこれで説明でき、(1)(3)(5) を出すだけで半分近くが減る。
- 世界の語彙の持ち込みは、`CardContent.art`（object_def識別子）と `background: SlotRef`（owner+スロット名）の2つに絞られている。どちらも部品の中で `src/art/` に解決させており、レシピ・プロパティ名は入っていない。CodeStructure.md の線としては薄い越境だが、越えているのはこの2点だけ。
- 層をまたいで対で決まっている値が3組ある（`SLIDE_MS`↔`FLY_MS`、`GAP_MS`↔`REPEAT_MIN_MS`、`EDGE_RATIO`↔`CARD_EDGE_RATIO`）。うち2組はコメントで「揃えている」と書かれているだけで、置き場所が離れている。

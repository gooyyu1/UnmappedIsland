# game-core

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/game/BootScene.ts | 7 | 5 | 0 | 2 | 0 | 0 |
| src/game/DeviceScreen.ts | 12 | 9 | 2 | 0 | 1 | 0 |
| src/game/NewGameScene.ts | 50 | 26 | 2 | 17 | 5 | 0 |
| src/game/PlayScene.ts | 181 | 122 | 4 | 41 | 13 | 1 |
| src/game/ResponsiveScene.ts | 6 | 5 | 1 | 0 | 0 | 0 |
| src/game/ScenarioSelectScene.ts | 7 | 4 | 0 | 3 | 0 | 0 |
| src/game/SettingsScene.ts | 12 | 5 | 0 | 7 | 0 | 0 |
| src/game/ShelfScene.ts | 17 | 12 | 0 | 4 | 1 | 0 |
| src/game/SlotSelectScene.ts | 11 | 8 | 0 | 3 | 0 | 0 |
| src/game/TitleScene.ts | 10 | 5 | 0 | 5 | 0 | 0 |
| src/game/errorReport.ts | 32 | 28 | 2 | 2 | 0 | 0 |
| **合計** | **345** | **229** | **11** | **84** | **20** | **1** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| BootScene | 定義とアセットを読み込んでレジストリへ置き、タイトルへ移る | `WORLD_CODEX_KEY`, `LOCALIZATION_KEY`（置く側ではなく、シーン間の受け渡しの規約の話） |
| DeviceScreen | 表示先の大きさと画素密度に合わせてPhaserのキャンバスを作り、追従させる | （漏れなし。問題はクラスではなく置き場所） |
| NewGameScene | 新規ゲームの3項目を入力させ、セーブを作ってプレイ画面へ移る | `labelHeight`ほか高さ・幅の見積り6件（画面の寸法の話）、`startGame` の検証順（入力の妥当性の話） |
| PlayScene | プレイ中の画面を組み立て、**操作を世界へ渡し**、**結果を見せる** — 接続詞が2つ入る＝責務が3つ | 世界へ問うもの（`pathDestinationNames`・`currentLandArt`・`locationCards`）、映しの判断（`laneCards`・`foundSince`・`initialTab`・`leaveLocation`）、意匠（時間・粒・余白の定数、`iconButtonStyle`）、部品（`slotButtonPaper`・`buttonIcon`）、セーブの更新（`savePinnedStatuses`・`placeMapCard`） |
| ResponsiveScene | 画面寸法が変わったら、表示物を捨てて画面を組み立て直す | （漏れなし） |
| ScenarioSelectScene | 同梱シナリオを並べ、選んだものでプレイ画面へ入る | 一覧の寸法3定数 |
| SettingsScene | 設定項目を行として並べ、変更を保存して戻る | 行の寸法5定数、`leave`（読み込み直しが要るかの判断）、`label`（オン/オフの表示語） |
| ShelfScene | アーティファクトの棚を、型の宣言順に札と空枠で並べる | `ARTIFACT_TAG`（世界の語彙）、`cardOf`（札の中身の組み立て）、寸法3定数 |
| SlotSelectScene | セーブスロット4つを並べ、選択・削除・新規作成へ振り分ける | 寸法3定数 |
| TitleScene | ロゴとメニューを並べ、行き先のシーンへ移る | 寸法5定数、`drawBackground`（グラデーションの敷き方） |
| errorReport | 実行時エラーと直前の操作を**控え**、そのまま貼れる報告として**画面に出す** — 接続詞1つ | `ErrorOverlay`（DOMのウィジェットそのもの） |

## 明細（判定2以上）

### 全ファイル横断（意匠の定数が組み立てに置かれている）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/NewGameScene.ts | `BODY_PADDING` `BODY_PADDING_LANDSCAPE_X` `FIELD_GAP` `LABEL_GAP` `INPUT_HEIGHT` `RANDOM_BUTTON_SIZE` `CHARACTER_OPTION_PADDING` `FOOTER_BUTTON_HEIGHT` `FOOTER_PADDING_Y` `CHARACTER_DESCRIPTION_SIZE` `CHARACTER_DESCRIPTION_LINES` `FIELD_LABEL_SIZE` `COLUMN_GAP` `FIELD_COLUMN_MIN_WIDTH` | 配置 | 3 | 寸法は意匠（Layers.md 4節）だが、使う側がこのファイルにしか居ないので置かれている | `src/game/looks/`（`theme.ts` の `SIZE`、または `NewGameScreenLayout`） | | |
| src/game/PlayScene.ts | `BAR_PADDING` `OPTIONS_BAR_PADDING_X` `FILTER_BAR_PADDING_X` `STATUS_PADDING` `PAPER_BUTTON_SHADOW` `ICON_BUTTON_GLYPH` | 配置 | 3 | 同じ性質の `DISPLAY_PADDING` は既に `looks/PlayScreenLayout` に居り、線が引かれていない | `src/game/looks/PlayScreenLayout.ts` / `theme.ts` | | |
| src/game/PlayScene.ts | `REAL_MS_PER_GAME_MINUTE` `REAL_MS_MAX` `realMsFor` `MATERIAL_CYCLE_MS` `BRIGHTEN_MS` `DARKEN_MS` `INSTANT_GAIN_SPREAD_MS` | 配置 | 3 | 「時間の見せ方」は意匠と明記されている（Layers.md 4節）のに組み立てが持っている | `src/game/looks/`（`durationText.ts` の隣） | | |
| src/game/PlayScene.ts | `PARTICLES_PER_FULL` | 配置 | 3 | 満タンの何割を何粒で表すかは見せ方の値 | `src/game/looks/` または `ui/GainParticles.ts` | | |
| src/game/PlayScene.ts | `SLOT_BUTTON_ICONS` `CHARACTER_SLOT_BUTTONS` `OPTION_ICONS` `FILTER_ICONS` | 配置 | 3 | ボタンの姿（絵・絵文字・染め）の表で、コメント自身が「画面の意匠」と言っている | `src/game/looks/`（例 `barIcons.ts`） | | |
| src/game/PlayScene.ts | `BarIcon` | 配置 | 3 | 「バーに何を渡せば描けるか」は部品の都合＝契約は部品側が定める（Layers.md 4節） | `src/game/ui/Button.ts` | | |
| src/game/ScenarioSelectScene.ts, src/game/SettingsScene.ts | `LIST_PADDING` `ITEM_HEIGHT` `ITEM_PADDING_X` | 配置 | 3 | 2ファイルに同名・同値で重複しており、暗黙に一致すべき規約が2箇所にある | `src/game/looks/theme.ts`（`rowPlateStyle` の隣） | | |
| src/game/SettingsScene.ts | `SWITCH_WIDTH` `SWITCH_HEIGHT` | 配置 | 3 | スイッチの寸法は意匠 | `src/game/looks/theme.ts` | | |
| src/game/ShelfScene.ts | `PADDING` `CARD_GAP` `CARD_HEIGHT` `ARTIFACT_ICON` | 配置 | 3 | 棚の余白・札の縮尺・仮アイコンはいずれも見せ方 | `src/game/looks/`（アイコンは `src/art/`） | | |
| src/game/SlotSelectScene.ts | `GRID_PADDING` `SLOT_PADDING` `DELETE_BUTTON_SIZE` | 配置 | 3 | 同上 | `src/game/looks/theme.ts` | | |
| src/game/TitleScene.ts | `MENU_BUTTON_HEIGHT` `MENU_BUTTON_GAP` `MENU_MAX_WIDTH` `LOGO_MENU_GAP` `HORIZON_RATIO` | 配置 | 3 | 同上（`HORIZON_RATIO` は背景の絵の作り方そのもの） | `src/game/looks/theme.ts` | | |

### src/game/BootScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/BootScene.ts | `WORLD_CODEX_KEY`, `LOCALIZATION_KEY` | 配置 | 3 | 4つのシーンがこの2つの文字列のためだけに BootScene を輸入している（組み立て→組み立ての依存） | `src/game/sceneRegistry.ts`（レジストリの鍵だけを置く） | | |

### src/game/DeviceScreen.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/DeviceScreen.ts | `DeviceScreen` | 配置 | 4 | シーンでもウィンドウでもないのに `src/game/` 直下に居る。ゲームの語彙を1つも持たず、このゲームを消しても1文字も変わらない＝汎用部品の条件（Layers.md 3節）を満たす。唯一の利用者も `src/main.ts` で `src/game/` の外 | `src/ui/`（`DeviceScreen.ts`） | `src/ui/` の他の部品は「シーンの中で使う表示物」だが、これはゲーム全体（`Phaser.Game`）を作る側。同じ棚に置くと `src/ui/` の意味が二重になるため、行き場が無く組み立ての棚に残っている | |
| src/game/DeviceScreen.ts#DeviceScreen | `width`, `height` | 所属 | 2 | 「直前に反映した寸法」の控えで、変化が無いのに作り直さないためだけに要る | | | |

### src/game/NewGameScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/NewGameScene.ts#NewGameScene | `labelHeight()`, `characterDescriptionHeight()`, `textFieldHeight()`, `textFieldsHeight()`, `characterFieldHeight()` | 所属 | 4 | 画面をどう割るかの見積り＝意匠。PlayScene には同じ役の `PlayScreenLayout` があり、この画面だけ組み立てが自分で計算している | `src/game/looks/NewGameScreenLayout.ts` | `labelHeight`/`characterDescriptionHeight` が Phaser の Text を作って実測しており（`addLabel` → `height` → `destroy`）、他の3つはその値を含む同じ式。意匠は Phaser に触れないので、実測値を引数で受ける形に変えない限り出せない | |
| src/game/NewGameScene.ts#NewGameScene | `characterRowWidth()`, `characterOptionWidth()` | 所属 | 3 | `metrics` と人数だけで決まる純粋な寸法計算で、実測に依らない | `src/game/looks/NewGameScreenLayout.ts` | | |
| src/game/NewGameScene.ts#NewGameScene | `startGame()` | 所属 | 3 | 3項目を順に検査して**どの文言を出すか**まで決めており、検証は `save/newGameInput.ts` が既に半分持っている | `src/save/newGameInput.ts`（検証結果と理由を返す） | | |
| src/game/NewGameScene.ts#NewGameScene | `characters` | 所属 | 2 | codex から引いた一覧の控え。init 時点で固めるためだけに持つ | | | |
| src/game/NewGameScene.ts#NewGameScene | `characterOptionsOrigin` | 所属 | 2 | 選択肢だけを作り直すために、置き場所を覚えておくためのプログラム上の控え | | | |

### src/game/PlayScene.ts — 世界／映しの判断が組み立てに残っているもの

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/PlayScene.ts#PlayScene | `pathDestinationNames()` | 所属 | 5 | `codex.vocabulary.world.pathTagId` でタグを見分け、`new Path(...)` を組んで行き先を導いている。**結線ではなく世界の読み**で、Layers.md 3節が「読んだ値から答えを組み立てているなら、それは映しのものではない」と名指しした形そのもの | `PlayScreenView`（「今の土地から行ける土地の名前」を問いの形で足す）／`domain/views/Path` | | |
| src/game/PlayScene.ts#PlayScene | `currentLandArt` | 所属 | 3 | `player.location ?? startLocation` という世界の分岐を組み立てが持っている | `PlayScreenView`（現在地の識別子） | | |
| src/game/PlayScene.ts#PlayScene | `locationCards` | 所属 | 3 | 「設置物＋アイテムに出ている束」は映しの断面で、`view.cardsIn` を2回呼んで組み立て側が合成している | `PlayScreenView` / `ShownCards` | | |
| src/game/PlayScene.ts#PlayScene | `requestLocationArt()` | 所属 | 3 | `gameSession.player.location.fixtures` / `undiscoveredFixtures` を映しを飛ばして直に読む | `PlayScreenView`（絵が要る土地の名前を答える） | | |
| src/game/PlayScene.ts#PlayScene | `laneCards()` | 所属 | 4 | 札に「押せる／掴める／どの端が出る／途中の値か」を付ける＝**何が出ていて、その上の操作が何を意味するか**で、映しの定義そのもの（Layers.md 1節） | `src/game/view/cardLooks.ts` / `ShownCards` | 付ける `onTap` が `whileIdle`＝`activity`（演出中か）に依存し、`activity` は組み立てだけが持つ状態。映しへ出すには `ShownStatuses` の `midAction: () => …` と同じ形で演出中かを渡す必要がある | |
| src/game/PlayScene.ts#PlayScene | `shownInstanceIds()`, `foundSince()` | 所属 | 4 | 「今回の探索で新しく現れた個体だけ」を数える判断。どの札が発見物かは映しの答えで、`view/changedInstances.ts` が既に同種の計算を持つ | `ShownCards`（`takeFound` の入力を自分で作る） | 差分を取るには探索**前**に出ていたIDの控えが要るが、映しは行動のたびに作り直されて履歴を持たない。控えを持てる場所が組み立てにしか無い | |
| src/game/PlayScene.ts#PlayScene | `showGains()` | 所属 | 4 | `property.range` と `locale.…prop().icon` を直に読み、粒数を `sqrt` で決めている。どのプロパティを何粒で見せるかは映し＋意匠の判断 | `src/game/view/`（増加を粒の数へ直す）＋ `looks/`（`PARTICLES_PER_FULL`） | 飛ばす先（ポートレイトの矩形）と発生源の矩形は画面の事実なので、粒数だけを出すと1つの演出が2箇所に割れる | |
| src/game/PlayScene.ts#PlayScene | `initialTab()` | 所属 | 4 | 「指定 ＞ 型ごとの記憶 ＞ 説明」という優先順位＝順序に意味のある判断で、`operationSteps` と同じ性質 | `src/game/view/`（優先順位だけを持つ関数） | 記憶の置き場が `Settings`（localStorage）で、映しへ出すと映しが保存先を知ることになる。記憶を引数で受ける形にしない限り出せない | |
| src/game/PlayScene.ts#PlayScene | `leaveLocation()` | 所属 | 3 | 「持ち主がプレイヤー自身でない場所の窓は移動後に残せない」は映しの判断 | `ShownCards` / `PlayScreenView`（移動後も残る場所か） | | |
| src/game/PlayScene.ts#PlayScene | `advanceMaterialCycle()` | 所属 | 3 | 「出す型が2つ以上あるときだけ進める」を `view.slotViewOf(...).materials` を読んで組み立てが決めている | `src/game/view/slotCells.ts` | | |
| src/game/PlayScene.ts#PlayScene | `draggableLanes` | 所属 | 3 | 「覆われているレーンを落とし先から外す」は重なりの規則で、ドラッグの相手を決める側（部品）の話 | `src/game/ui/CardDragController.ts` | | |
| src/game/PlayScene.ts#PlayScene | `cardEdges()` | 所属 | 3 | 端の操作の有無は `shown.edgeMove` が答えるが、その包み方と文言をここで組んでいる | `src/game/view/cardOperations.ts` | | |

### src/game/PlayScene.ts — 経路が二重になっているもの

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/PlayScene.ts#PlayScene | `explore()` | 所属 | 4 | `applyToWorld` と同じ手順（控え→`requestLocationArt`→`passTime`→`afterPlaybackSteps` の switch）をもう1本持っている。「操作を運ぶ手順は1本」という `operationSteps` の狙いが、探索だけ外れている | `applyToWorld`（`found` を渡せる1本の経路にする） | `applyToWorld` には「この操作は探索だ」を伝える引数が無く、`activity` に `'exploring'` を立てる必要もあるため、同じ手順を複製している | |
| src/game/PlayScene.ts#PlayScene | `placeOf()`, `spotOf()` | 所属 | 4 | レーン→場所の対応を `===` の連鎖で持ち、末尾に `?? this.place('items')` というつじつま合わせがある。同じ対応は `laneViews` にもう一度書かれており、**2箇所が暗黙に一致すべき規約**になっている | `LaneView` に場所を持たせ、レーンと場所の対を1つの表にする | レーンは Phaser の表示物、場所は映しの語彙で、その対を持つ入れ物が組み立てに無いため2つの表に割れている | |
| src/game/PlayScene.ts | `MENU_ICON` | 所属 | 4 | 押した先を表に持たせず、`spec === MENU_ICON` の参照同一性で判別するためだけに切り出された定数（CLAUDE.md の「プログラミング上の都合だけで存在するオブジェクト」） | `OPTION_ICONS` の各要素へ行き先を持たせ、この定数を吸収する | `OPTION_ICONS` を「姿だけの表」（＝意匠）に保つため、行き先を表に入れられない | |
| src/game/PlayScene.ts#PlayScene | `artWait` | 所属 | 4 | 「捨てた待ちを無効にする世代番号」。呼び出し側が番号の一致を覚えていないと壊れる＝カプセル化が呼び出し側へ漏れている | `src/game/ui/LocationArtLoader.ts`（待ちのハンドルを返して取り消せるようにする） | `LocationArtLoader.onceLoaded` に取り消しが無いため、無効化の手立てが呼び出し側にしか無い | |

### src/game/PlayScene.ts — 部品・意匠・保存へ出るもの

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/PlayScene.ts#PlayScene | `slotButtonPaper()`, `buttonIcon()` | 所属 | 4 | 紙を敷く・絵か絵文字かを選ぶ＝Phaserの表示物を作る仕事で、部品の定義そのもの。テクスチャキー `SLOT_BUTTON_PAPER_TEXTURE` は既に `ui/Button.ts` が持っている | `src/game/ui/Button.ts`（紙のボタンとして） | `Button` は汎用の箱で、地を差し込む口が `addContent` しか無い。中身を作る側が外に居ないと組み立てられない | |
| src/game/PlayScene.ts#PlayScene | `iconButtonStyle()` | 所属 | 3 | `BoxStyle` を組み立てる関数。同じ役の `rowPlateStyle` は既に `looks/theme.ts` に居る | `src/game/looks/theme.ts` | | |
| src/game/PlayScene.ts#PlayScene | `addSlotButtonColumn()` | 所属 | 3 | ボタンの表を作る部分の他に、余白・間隔の配分（意匠）を抱えている | 配分は `src/game/looks/PlayScreenLayout.ts` | | |
| src/game/PlayScene.ts#PlayScene | `statusRowsX`, `statusRowsY`, `statusRowsWidth`, `statusRowGap` | 所属 | 3 | 領域＋間隔をばらした4つのスカラで、名前付きの矩形として意匠が答えるべきもの | `src/game/looks/PlayScreenLayout.ts`（`statusRows: Rect` と間隔） | | |
| src/game/PlayScene.ts#PlayScene | `savePinnedStatuses()`, `placeMapCard()` | 所属 | 3 | `SaveData` を作り直す処理で、セーブの中身を知っているのは `src/save/` の側 | `src/save/SaveSlots.ts`（この周回のセーブを更新する口） | | |
| src/game/PlayScene.ts#PlayScene | `childWindowTabs` | 所属 | 3 | 「どのスロットがタブとして並ぶか」は映しの断面（`view.slotViewOf` の結果を持ち回っているだけ） | `PlayScreenView` / `ShownCards` | | |
| src/game/PlayScene.ts#PlayScene | `placeText()`, `dropLabel()`, `clockText()` | 所属 | 3 | 報告用の文言だが、場所の呼び名・落とし方の種別・時刻の書式はそれぞれ映し／意匠が持つ語彙 | `view/cardPlaces.ts`・`ShownCards`・`looks/durationText.ts` | | |
| src/game/PlayScene.ts | `withOrigins()` | 所属 | 3 | 出どころの表を重ねるだけの関数。コメント自身が `cardMotionPlan` の `origins` を指している | `src/game/view/cardMotionPlan.ts` | | |
| src/game/PlayScene.ts | `ACTIVITY_NAMES` | 配置 | 3 | `Activity` の全ケースに名前を与える表なのに、型の定義から離れている（動詞を足したときの取りこぼしが起きる位置） | `src/game/view/operationSteps.ts` | | |
| src/game/PlayScene.ts | `SCENARIO_CHARACTER` | 配置 | 3 | 「シナリオはこのキャラクタで動かす」はシナリオの決めごと | `src/scenario/Scenario.ts` | | |
| src/game/PlayScene.ts | `scenarioPlayData()` | 所属 | 4 | `Scenario` から仮の `SaveData` を組む変換で、シナリオ側かセーブ側の仕事。プレイ画面の組み立てとは無関係 | `src/scenario/Scenario.ts` または `src/save/` | 戻り値の型 `PlaySceneData` が `PlayScene` にあるため、外へ出すと `src/scenario/`（層の外）が組み立てを輸入することになる | |
| src/game/PlayScene.ts#PlayScene | `childWindowDef` | 所属 | 2 | タブの記憶を引く鍵としてだけ要る | | | |
| src/game/PlayScene.ts#PlayScene | `statusDetailKey` | 所属 | 2 | 作り直し後に同じ窓を開き直すための控え | | | |
| src/game/PlayScene.ts#PlayScene | `portraitRect` | 所属 | 2 | 粒の行き先としてだけ持つ矩形の控え | | | |
| src/game/PlayScene.ts#PlayScene | `mapPositions` | 所属 | 2 | セーブデータの値の作業用の複製 | | | |

### src/game/ResponsiveScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/ResponsiveScene.ts#ResponsiveScene | `rebuildOnResize()` | 所属 | 2 | Phaserが1回の向き変更で複数回RESIZEを出すことへの対処で、概念上は要らないがプログラム上は要る | | | |

### src/game/SettingsScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/SettingsScene.ts#SettingsScene | `leave()` | 所属 | 3 | 「設定と実際に入っているパックが食い違えば読み込み直す」というパック側の決めごとを画面が持っている | `src/asset-pack/`（差異と対処を答える） | | |
| src/game/SettingsScene.ts | `label()` | 所属 | 3 | オン／オフの表示語。この画面固有ではなく、他のトグルが増えれば同じ語が要る | `src/game/looks/` または `src/ui/labels.ts` | | 名前が値と結び付かず、本体を読むまで何のラベルか分からなかった |

### src/game/ShelfScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/ShelfScene.ts | `ARTIFACT_TAG` | 所属 | 4 | 「何をアーティファクトと見なすか」は世界の語彙。同種のタグID（`pathTagId` ほか）は `WorldVocabulary` が持っている | `src/domain/WorldVocabulary.ts` | `WorldVocabulary` はロード時に解決したIDを持つ仕組みで、名前の文字列を受け取る口は `codex.objectDefNamesWithTag(name)` しか無い。名前で引く経路がある限り、名前の定数はその外に残る | |
| src/game/ShelfScene.ts#ShelfScene | `cardOf()` | 所属 | 3 | 型の名前から `CardContent` を組む＝映しの仕事。同じ役の `characterCardContent` は `view/characterCard.ts` に居る | `src/game/view/`（`artifactCard.ts`） | | |

### src/game/TitleScene.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/TitleScene.ts#TitleScene | `drawBackground()` | 所属 | 3 | 行ごとに色を混ぜて縦グラデーションを敷く汎用の描画。ゲームの語彙を持たず、色だけ外から来る | `src/ui/shapes.ts`（`addPanel` の隣に `addGradient`） | | |

### src/game/errorReport.ts

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因 | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/errorReport.ts | `ErrorOverlay` | 配置 | 3 | 「控えて文面を組む」モジュールに、DOMのウィジェット85行が同居している | `src/game/ErrorOverlay.ts` | | |
| src/game/errorReport.ts | `seconds()` | 所属 | 3 | ミリ秒を秒の文字列にするだけの汎用の書式化 | `src/util/` | | |
| src/game/errorReport.ts#Reported | `count` | 所属 | 2 | 同じエラーを1件にまとめるための可変フィールド | | | |
| src/game/errorReport.ts#ErrorOverlay | `refreshedAt` | 所属 | 2 | 貼り直しの間引きのための控え | | | |

## 移動先が書けなかったもの

- 該当なし（判定4・5はすべて移動先候補を書けた）。ただし1つだけ、**移動先の「棚」が概念として欠けている**ものがある。
  - `DeviceScreen`（判定4）: Layers.md 4節の在処の表には「起動」の行が無い。`src/game/` は組み立て（`*Scene.ts` と `ui/*Window.ts`）と定義されており、`Phaser.Game` を作って端末の解像度に追従させる層は、世界・映し・意匠・部品・組み立てのどれでもない。`src/main.ts` と `DeviceScreen` が属する「起動」という区分が表に無いことが、置き場所が決まらない原因になっている。

## ファイル配置（層=配置）についての所見

- `src/game/` 直下は Layers.md 4節で「組み立て（`*Scene.ts` と `ui/*Window.ts`）」＋例外として `errorReport.ts` と定められている。11ファイル中9つはシーンで、この定義に合っている。外れているのは `DeviceScreen.ts`（シーンでも横断の道具でもない起動側）と、抽象基底の `ResponsiveScene.ts`（シーンの土台なので許容範囲）。
- ただし**中身の層は守れていない**。意匠（寸法・色・時間の見せ方）の定数が全10シーンに散っており、担当範囲の判定3の 84 件中 46 件がこれ。`looks/theme.ts` と `looks/PlayScreenLayout.ts` という受け皿が既にあるのに、`DISPLAY_PADDING` だけが looks 側、`STATUS_PADDING`/`BAR_PADDING` は PlayScene 側、という線の引かれ方になっている。
- `BootScene.ts` の `preload()` は、`INFORMATION_ART`/`SEPARATOR_ART`/`ICON_ART`/`WEATHER_ART` を `src/art/` から引く一方、`card_frame.png`・`flip_digit.png`・`slot_button_paper.png`・`dust_puff.png` の4枚だけは URL を直に輸入している。「どのファイルがどの絵か」は素材（`src/art/`）の答えるべきこと（Layers.md 3節）なので、この4枚だけが素材の棚を素通りしている。
- `PlayScene.ts` は 2366 行・宣言 181 件で、判定1が 122 件（67%）＝大半は本当に結線。問題は残る 3〜5 の 55 件が「世界へ直に訊く」「映しの判断を持つ」「部品を組み立てる」の3方向へ散っていることで、`operationSteps` / `elapsePlayback` が示した「順序の判断を Phaser に触らない側へ出す」延長として、次に出せるのは `laneCards`（映し）・`foundSince`＋`shownInstanceIds`（映し）・`initialTab`（映し）・`slotButtonPaper`＋`buttonIcon`（部品）・`pathDestinationNames`（映し／世界）の5組。

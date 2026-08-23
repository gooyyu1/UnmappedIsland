# src/game・game/view・game/looks・src/ui 全855件

A（名前をなぞるだけ）: 782件 / B: 66件 / C: 7件

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `ui/labels.ts` | `(モジュール)::FontScale` | B | u単位をピクセルへ直せる相手（`px`と`fontPx`を持つ） | フォント専用ではなく、長さ一般の単位変換器であること。実体は`ScreenMetrics` | `UnitScale` |
| `ui/labels.ts` | `LabelStyle::wrapWidth` | B | 折り返す幅（**ピクセル**） | 同じ型の`size`・`lineGap`がu単位なのに、これだけピクセル | `wrapWidthPx` |
| `ui/nineSlice.ts` | `(モジュール)::addSliceFrames` | B | 9断片のフレームを、まだ無いときだけ足す | 2度目以降は何もしない（冪等）こと。呼び手が回数を気にしなくてよい契約 | `ensureSliceFrames` |
| `ui/scroll.ts` | `(モジュール)::WHEEL_DELTA_PIXELS` | B | `deltaMode`（ピクセル・行・ページ）で引く、delta1あたりのピクセル数の表 | 配列が`deltaMode`の索引になっていること | `PIXELS_PER_DELTA_BY_MODE` |
| `ui/scrollArea.ts` | `ScrollArea::dragBy` | C | ドラッグ開始時点からの**累積**移動量を送り量へ反映する | `By`は増分を示すが、渡すのは累積量。増分のつもりで繰り返し呼ぶと二重に動く | `dragTo`（引数名`distanceFromDragStart`） |
| `ui/scrollArea.ts` | `ScrollArea::origin` | B | 送り量0のときの中身の位置（座標） | Phaserの`setOrigin`（正規化した基準点）と同語で、別物であること | `contentPositionAtScrollZero` |
| `ui/scrollArea.ts` | `ScrollAreaOptions::surfaces` | B | ドラッグ・ホイールを受け取る表示物 | 「面」が入力を受ける役目であること（渡さないと送れない） | `inputSurfaces` |
| `ui/shapes.ts` | `(モジュール)::addPanel` | B | 塗った矩形を置き、**必ず入力を遮る**（`setInteractive`） | 入力を遮ること。同ファイルの`addTiledImage`は遮らないので、呼び分けの根拠が名前に無い | `addInputBlockingPanel` |
| `ui/shapes.ts` | `(モジュール)::addTiledPanel` | B | 絵を敷いた背景板を置き、入力を遮る | 同上（`addTiledImage`との差が「遮るか」なのに、名前の差は`Panel`/`Image`） | `addInputBlockingTiledPanel` |
| `ui/shapes.ts` | `BoxStyle::border` | B | 枠線の**色** | 色であること（`borderWidth`と対だが、`number`だけでは太さとも読める）。同ファイルの`LabelStyle::color`とも語彙がずれる | `borderColor` |
| `ui/shapes.ts` | `BoxStyle::fill` | B | 塗りの**色** | 同上（`fillAlpha`から推測させている） | `fillColor` |
| `ui/shapes.ts` | `BoxStyle::shadow` | B | 落ち影のずらし幅（px） | 有無や色ではなく距離であること | `shadowOffset` |
| `ui/shapes.ts` | `ShapeDefaults::shadowLayers` | B | 影1枚ごとの「ずらし幅の倍率」と「不透明度」の組 | タプル`[number, number]`の2つが何か。位置で意味が決まる暗黙の規約 | 要素を名前付き型へ（`ShadowLayer { offsetScale, alpha }`） |
| `game/looks/alertBlink.ts` | `(モジュール)::ALERT_BLINK_MS` | B | 明滅の**片道**の時間 | 往復（周期）ではなく片道であること | `ALERT_BLINK_HALF_CYCLE_MS` |
| `game/looks/heatHaze.ts` | `(モジュール)::SWAY_MS` | B | ゆらぎの**片道**の時間 | 同上 | `SWAY_HALF_CYCLE_MS` |
| `game/looks/heatHaze.ts` | `HeatHaze::swayMs` | B | ゆらぎの**片道**の時間 | 同上 | `swayHalfCycleMs` |
| `game/looks/childWindowLayout.ts` | `(モジュール)::centerWindow` | B | 領域の中央（かつ画面内）へ置いた矩形を**返す** | 何も動かさない計算であること。動詞形なので配置する処理に読める | `centeredWindowRect` |
| `game/looks/durationText.ts` | `(モジュール)::durationText` | B | 「かかる時間 1時間30分」という**見出し付きの1行**（0分ならundefined） | 「かかる時間」という文言が付くこと。単なる時間の文字列だと思って他の場所で使うと語が二重になる | `timeCostLine` |
| `game/looks/durationText.ts` | `(モジュール)::minutesText` | B | 分を「1時間30分」へ直す | 60分以上は時間へ繰り上げること（名前は「分の表記」しか言っていない） | `hoursAndMinutesText` |
| `game/looks/PlayScreenLayout.ts` | `(モジュール)::DISPLAY_PADDING` | B | **キャラクター表示エリア**の内側余白 | どのエリアの余白か。同ファイルの`CHARACTER_DISPLAY_*`と語彙が揃っていない | `CHARACTER_DISPLAY_PADDING` |
| `game/looks/PlayScreenLayout.ts` | `(モジュール)::PAGE_TOP_PORTRAIT` | C | 縦型で、ページの上辺に見せる**縁の幅** | 名前は上辺のy座標を指すが、値は幅 | `PAGE_TOP_EDGE_WIDTH_PORTRAIT` |
| `game/looks/PlayScreenLayout.ts` | `PlayScreenLayout::statusRows` | C | ステータスの**バーを並べられる範囲**（矩形1つ） | 複数形だが`Rect`1つ。行の配列に読める（同クラスの`lanes`・`laneSeparators`は実際に配列） | `statusRowsArea` |
| `game/looks/theme.ts` | `(モジュール)::BAND_FADE` | B | 「増えた分の帯」を塗りからトラック寄りへ薄める割合 | どの帯のことか（増加分の帯に限った値） | `GAIN_BAND_FADE` |
| `game/looks/theme.ts` | `(モジュール)::fadedFill` | B | 「増えた分の帯」の色 | 汎用の淡色化ではなく、増加分の帯のための色であること | `gainBandFill` |
| `game/looks/theme.ts` | `(モジュール)::CARD_FRAME_FACE` | B | 分類ごとの、枠の**面と縁**の色 | 縁（`line`）も入っていること。名前は面だけを指す | `CARD_FRAME_BASE_COLORS` |
| `game/looks/theme.ts` | `(モジュール)::GAUGE_HALF_RATIO` | B | ゲージが琥珀へ寄り切る位置 | そこで何が起きるか。名前は値0.5を言い換えただけ | `GAUGE_AMBER_RATIO` |
| `game/view/cardMotionPlan.ts` | `PlannedFlight::face` | B | 便が見た目を借りるカード（常に`into`と同じ値） | 隣の`into`と同じものを指していること。名前が違うぶん別物に見える（実装上も両方`to.card`） | `into`へ寄せて統合。残すなら`faceOf`ではなく理由を名前に |
| `game/view/cardOperations.ts` | `CardOperations::reorder` | B | 並べ替えが**できるならその手段**を返す（できなければundefined） | 呼んでも並べ替わらないこと（返るのは実行用の関数） | `reorderActionAt` |
| `game/view/cardPlaces.ts` | `(モジュール)::ScreenPlaces` | B | 画面の区画からスロットを**引く関数**の型 | 場所の集合ではなく関数であること | `ScreenPlaceResolver` |
| `game/view/changedInstances.ts` | `(モジュール)::originInstances` | B | 「インスタンス→出どころのインスタンス」の対応表 | 集合ではなく写像であること | `originInstanceByInstance` |
| `game/view/elapsePlayback.ts` | `ElapseFrame::minutes` | B | 時計に出す**絶対時刻**（ゲーム内の総経過分） | 隣の`elapsedMinutes`（開始からの相対値）との差 | `clockMinutes` |
| `game/view/elapsePlayback.ts` | `ElapsePlayback::finish` | B | まだ見せていない控えを**全部返す** | 返り値があること（片付けるだけに読める） | `takeRemaining` |
| `game/view/elapsePlayback.ts` | `ElapsePlayback::shown` | B | ここまで出した控えの**個数** | 数であること（配列や真偽値に読める） | `shownCount` |
| `game/view/elapsePlayback.ts` | `ElapsePlayback::ticks` | B | tick境界ごとの**控え**（`RecordedView`の並び） | 時刻の並びではなく表示内容の控えであること | `recordedTicks` |
| `game/view/operationSteps.ts` | `(モジュール)::runsOperation` | C | 今ワールドを変える操作を**受け付けてよいか** | 名前は「操作を実行する」と読める。判定であることが逆向きに伝わる | `acceptsOperation` |
| `game/view/PlayScreenView.ts` | `MapRoadView::a` | B | 道の一方の端のサイトindex | サイトのindexであること | `siteA` |
| `game/view/PlayScreenView.ts` | `MapRoadView::b` | B | 道のもう一方の端のサイトindex | 同上 | `siteB` |
| `game/view/PlayScreenView.ts` | `ObjectWindowView::slots` | B | タブに並べる`visible_slots` | 同じものを`ObjectCardStack::visibleSlots`と呼んでいる（語彙の揺れ） | `visibleSlots` |
| `game/view/PlayScreenView.ts` | `SlotView::cells` | B | 空けておく**枠数**（または`'grows'`） | 枠そのものではなく数であること。ドメイン側の`SlotDef.cellsToKeep`とも名前がずれる | `cellsToKeep` |
| `game/view/recording.ts` | `(モジュール)::recordChange` | C | ワールドを変える操作を**実行し**、その経過を控える | ワールドが実際に進む（副作用がある）こと。名前は記録だけに読める | `runAndRecordChange` |
| `game/view/recording.ts` | `Recording::changes` | B | **経過し切った時点で**見せる分の出入り | 「最後の分だけ」であること。`RecordedView::changes`（tick中の分）と同名で意味が違う | `changesAtEnd` |
| `game/view/recording.ts` | `Recording::signals` | B | 経過し切った時点で見せる分の出来事 | 同上 | `signalsAtEnd` |
| `game/view/ShownCards.ts` | `(モジュール)::awaitingMark` | B | 帰りを待つ印だけを持つ**札を返す** | 印そのものではなく、印を付けた札が返ること | `cardWithAwaitingMark` |
| `game/view/ShownCards.ts` | `(モジュール)::awaitingStack` | B | 帰りを待つ印だけを持つ**束を返す** | 同上 | `stackWithAwaitingMark` |
| `game/view/ShownCards.ts` | `ShownCards::movedBy` | B | そのドロップで手から放したもの（掴んだ1つと、ついてきたもの） | 「動かされた」の受け身形からは、掴んだ個体と追随分に分かれて返ることが読めない | `releasedBy`（`MotionContext.released`と揃う） |
| `game/view/ShownCards.ts` | `ShownCards::restackWindow` | B | 貸している1枚を、今のワールドで引き直す | 積み直しではなく引き直しであること。世界から消えていればundefined | `reborrowedCard` |
| `game/view/ShownCards.ts` | `ShownCards::edgeMove` | B | その向きへ移せるなら**その手段**を返す | 呼んでも移動しないこと（`CardOperations::reorder`と同じ形） | `edgeMoveAction` |
| `game/view/ShownCards.ts` | `ShownCards::showing` | B | その束のうち画面に出ている分（0件か1件の配列） | 現在分詞形からは何が返るか読めない。兄弟の`shownCard`と語形も揃わない | `shownStacksOf` |
| `game/view/ShownStatuses.ts` | `ShownStatuses::entries` | B | プロパティのタブに並ぶ行（タブの並び順） | タブ由来の行だけであること。`all()`との差が名前に無い | `categoryRows` |
| `game/view/ShownStatuses.ts` | `ShownStatuses::note` | B | 行動の前後を比べ、増減を控える | 何を控えるのか。`note`だけでは対象が読めない | `noteChangesSince` |
| `game/view/ShownStatuses.ts` | `ShownStatuses::shown` | B | 1行分に増減・固定表示・経過中かを添えた見え方を**返す** | 形容詞形からは、1件を受け取って加工して返すことが読めない | `shownRowOf` |
| `game/view/tickProgress.ts` | `TickProgress::markUpTo` | B | 経過し切るまでの目盛りを**並べて返す** | 単数形・動詞形だが返るのは目盛りの配列 | `marksUpTo` |
| `game/DeviceScreen.ts` | `DeviceScreen::width` | B | **直前に反映した**物理ピクセル幅 | 今の幅ではなく、最後に適用した値であること（変化検出のために持つ） | `appliedWidth` |
| `game/DeviceScreen.ts` | `DeviceScreen::height` | B | 直前に反映した物理ピクセル高 | 同上 | `appliedHeight` |
| `game/errorReport.ts` | `(モジュール)::seconds` | B | 起動からの経過を「12.3」という**文字列**にする | 数値ではなく表示用文字列であること。`durationText`・`elapsedText`の語彙とも揃わない | `secondsText` |
| `game/SettingsScene.ts` | `SettingsScene::leave` | B | タイトルへ戻る。設定が食い違っていれば読み込み直す | 行き先がタイトルであること、場合によってはページごと読み込み直すこと | `returnToTitle` |
| `game/ShelfScene.ts` | `ShelfScene::addCaption` | B | 一行を置き、**使った高さを返す** | 返り値があること（呼び出し側は`y += `で使う） | `addCaptionReturningUsedHeight` |
| `game/NewGameScene.ts` | `NewGameScene::addTextField` | B | 1項目を置き、占有した高さを返す | 同上 | `addTextFieldReturningUsedHeight` |
| `game/NewGameScene.ts` | `NewGameScene::characterOptionsOrigin` | C | キャラクター選択肢を置く**領域**（`Rect`） | 名前は基準点（Phaserの`origin`）を指すが、値は矩形 | `characterOptionsArea` |
| `game/NewGameScene.ts` | `NewGameScene::characterId` | B | 選んでいるキャラクタの**型の識別子** | `characterCard.ts`では同じものを`characterDefName`と呼ぶ（語彙の揺れ） | `characterDefName` |
| `game/PlayScene.ts` | `(モジュール)::ICON_BUTTON_GLYPH` | B | ボタンに載せる絵文字の**大きさ**（u単位） | 大きさであること（絵文字そのものに読める。同ファイルの`MENU_ICON`等は絵文字を持つ） | `ICON_BUTTON_GLYPH_SIZE` |
| `game/PlayScene.ts` | `PlayScene::artWait` | B | 絵待ちの**世代番号**（古い待ちを無効にするための連番） | 数であること・世代であること | `artWaitGeneration` |
| `game/PlayScene.ts` | `PlayScene::currentLandArt` | B | 今の土地の識別子（絵の遅延ロードの単位） | 絵の名前ではなく土地の識別子であること（コメントが「札の絵とは別物」と断っている） | `currentLandArtKey` |
| `game/PlayScene.ts` | `PlayScene::discardSave` | B | セーブを消し、**スロット選択画面へ移る** | 画面遷移まで行うこと。消すだけの`deleteSave`と名前で区別が付かない | `deleteSaveAndLeave` |
| `game/PlayScene.ts` | `PlayScene::dropChildWindow` | C | 子ウィンドウを閉じ、借りていた札の**出どころを返す** | ①`drop`はこのファイルではカードを落とす操作の語（`dropOf`・`applyDrop`・`dropLabel`）②`closeChildWindow`との差が名前に無い③返り値がある | `closeChildWindowReturningOrigins` |
| `game/PlayScene.ts` | `PlayScene::refreshChildWindow` | B | 子ウィンドウの札を引き直し、**出どころを返す** | 返り値があること（`dropChildWindow`と同じ形） | `refreshChildWindowReturningOrigins` |
| `game/PlayScene.ts` | `PlayScene::laneCards` | B | カードに端の操作とドラッグを付けて返す | 操作を付ける加工であること。名詞形なので「レーンのカード」を引くだけに読める | `laneCardsWithEdgeActions` |
| `game/PlayScene.ts` | `PlayScene::motion` | B | カードの動きを実行する`CardTable` | 保持しているのが`CardTable`であること（`motionOf`は`MotionContext`を返すので、同じ語が別物を指している） | `cardTable` |
| `game/PlayScene.ts` | `PlayScene::place` | B | 画面の区画が今映している場所を引く | 動詞にも読める（同クラスに`placeMapCard`がある）。兄弟の`placeOfTab`とも語形が揃わない | `placeOfScreen` |
| `game/PlayScene.ts` | `PlayScene::record` | B | ワールドを変える操作を**実行し**、控えを取る | ワールドが実際に進むこと（`recordChange`と同じ） | `runAndRecord` |
| `game/PlayScene.ts` | `PlayScene::rectShowing` | B | その物、または**それを抱えている親**を映している札の枠 | 自分の札が無ければ親の札で代表すること | `rectOfNearestShownOwner` |
| `game/PlayScene.ts` | `PlayScene::situation` | B | 状況エリアの`WeatherPanel` | 保持しているのが表示物（パネル）であること。他のフィールドは`fieldPanel`・`weatherOverlay`と物を名乗っている | `situationPanel` |
| `game/PlayScene.ts` | `PlayScene::startVisit` | B | 作り直しをまたいで持つものを、このプレイのぶんとして構え直す | 「始める」ではなく、使い回されるシーンの持ち物を仕切り直すこと | `resetForNewVisit` |

## 判定を保留したもの

| 現在地 | 名前 | 迷った理由 |
| ------ | ---- | ---------- |
| `game/view/cardMotionPlan.ts` | `MotionInput::left` | 「居なくなったカード（画面上）」で、`vanished`（世界から出たインスタンス）と対になる。どちらも「消えた」としか読めず紛らわしいが、`left`＝札・`vanished`＝インスタンスという層の違いは型（`{card, ids}[]` と `number[]`）で見えているため、B にするか迷った。 |
| `game/view/ShownCards.ts` | `ShownCards::firstOf` | 返るのは要素ではなく「先頭1個だけを映す束」。`ObjectCardStack`を返すことは型で分かるが、「束から1個を切り出す」意味は名前に無い。`singleFirstOf`まで書くかは好みの範囲と判断した。 |
| `game/looks/skyTint.ts` | `(モジュール)::DIM_CURVE` | 値は累乗の指数（`DIM_EXPONENT`が正確）。ただし「効き方の曲線」を指す語としては通り、意匠定数として読み違えは起きにくい。 |
| `game/looks/PlayScreenLayout.ts` | `(モジュール)::DASHBOARD_MIN_HEIGHT_PORTRAIT` | `dashboard`は`SIZE.dashboardColumn`・モック（`ScreenLayout_Mock.html`）から来た既存語彙だが、縦型に「ダッシュボード列」は存在しない。仕様書側の呼び名（状況エリア＋情報エリア）と揃えるなら改名だが、語彙の出所が別なので保留。 |
| `game/looks/cardFlight.ts` | `(モジュール)::FLY_EASE_OUT` | 関数なのに定数の書式（SCREAMING_CASE）。責務と名前は一致しており、命名規約の話なのでこの観点では挙げなかった。 |
| `game/view/statusRows.ts` | `(モジュール)::groupOf` | 返るのは「表示順のまとまりの番号（小さいほど上）」。順序を持つことは名前に無いが、`groupOf`が番号を返すのは自然とも読める。 |

## 補足（名前より先に構造を疑ったほうがよいもの）

- `PlannedFlight::face` と `into` は**常に同じ値**（`planMotion`内で両方とも`to.card`）。改名より、片方を消すかどうかを先に決めたほうがよい。
- 「できるなら実行用の関数を返す」形が3か所ある（`CardOperations::reorder`・`ObjectCardStack::reorder`・`ShownCards::edgeMove`）。個別に改名するより、この形に共通の語（`...Action`）を決めて一斉に揃えるほうが効く。
- 「置いて、使った高さを返す」形も2か所（`ShelfScene::addCaption`・`NewGameScene::addTextField`）。こちらも語を揃えるのが先。

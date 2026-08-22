# game-core — 判定3の再点検

数えたのは、担当11ファイルの **private メソッド・private getter・export されていないモジュール関数**
（コンストラクタは除く）。合計 151 件。

判定の基準は「そのヘルパーの主語（＝そのヘルパーが値を組み立てている対象の型）」で、
自クラスのフィールドを触っていても、**引数か `this.view` / `this.metrics` 経由で受け取った他の型 B の
話しかしていないものは「主語は他」**とした。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/game/BootScene.ts | 1 | 0 | 1 |
| src/game/DeviceScreen.ts | 4 | 4 | 0 |
| src/game/NewGameScene.ts | 19 | 8 | 11 |
| src/game/PlayScene.ts | 106 | 60 | 46 |
| src/game/ResponsiveScene.ts | 1 | 1 | 0 |
| src/game/ScenarioSelectScene.ts | 1 | 0 | 1 |
| src/game/SettingsScene.ts | 3 | 0 | 3 |
| src/game/ShelfScene.ts | 3 | 2 | 1 |
| src/game/SlotSelectScene.ts | 4 | 2 | 2 |
| src/game/TitleScene.ts | 2 | 0 | 2 |
| src/game/errorReport.ts | 7 | 4 | 3 |
| **合計** | **151** | **81** | **70** |

第1波が判定3とした84件のうち46件は定数（＝ヘルパーではない）なので、この表とは母集団が違う。
**残り38件に相当するヘルパーを追い直した結果が、この70件**。

## 主語が他にあるヘルパー

同じ B の同じ不足を埋めているものは1行にまとめた（B 単位で数えたいため）。

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| PlayScene | `placeOf` `spotOf` `stacksOf` `dropOf` `laneViews` `openLanes` `draggableLanes` | `ui/CardLane` + `ui/CardTable.LaneView` | **そのレーンが映している場所（`CardSpot`）**。`LaneView` は `{lane, cells}` しか持たず、レーンは自分がどこを映しているか知らない | 消える。7つとも「レーン→場所」か「場所→レーン」の変換で、対を1箇所に持てば全部が表引きになる | `CardLane` は 部品（`CardPlace`＝`domain/Slot` を知ってはいけない）。**対を持つ入れ物が組み立てに無い**ので、対応が `===` の連鎖（`placeOf`）と `laneViews` の並びの2箇所に割れている |
| PlayScene | `rectOfInstance` `cardShowing` `rectShowing` `dropChildWindow` | `ui/CardLane` / `ui/ObjectWindow` | **「そのインスタンスを映している札の枠」**。`cardObjects` と `cellRect(index)` を公開するだけなので、探索は呼び出し側が書く | 消える。`CardLane.rectOfInstance(id)` を足せば `cardShowing` は消え、`rectOfInstance` は「レーンを順に訊く」だけになる | 現在地カードだけ `cardObjects` に入らない（`pinnedRect` が別建て）。**`addPinnedCell` が札を `objects` へ入れて `cardObjects` から外している**ことが、外側の特別扱いを1行生んでいる |
| PlayScene | `buildInformationDividers` `buildCharacterDisplay` `addSlotButtonColumn` `buildOptionsBar` `buildFilterBar` | `looks/PlayScreenLayout` | **区画の中の位置**。`PlayScreenLayout` は区画の矩形と**区切りの帯**（`laneSeparators` `optionsBarSeparator` `situationSeparator` `fieldLeftSeparator` `sidebarSeparator`）まで持つのに、**仕切り線・ポートレイト・ボタン列・バーの中のボタン**の矩形だけ持たない | 消える。とくに `buildInformationDividers` は、同じ「区切りの矩形」なのに5種類が looks 側・1種類が PlayScene 側という線の引かれ方 | 無し。`horizontalSeparatorAt`/`verticalSeparatorAt` という同じ形の private 関数が既に `PlayScreenLayout` にあり、そこへ2本足すだけで済む。`buildOptionsBar`/`buildFilterBar` は縦横分岐まで含めて同型の式を2本持っている |
| PlayScene | `buttonIcon` `slotButtonPaper` `iconButtonStyle` `addConditionRow` | `ui/Button` | **中身を自分で置く口**。`addContent(...GameObject[])` しか無いので、「中央にアイコン1つ」「紙を敷く」「押されている状態」を呼び出し側が毎回組む | 消える。`SLOT_BUTTON_PAPER_TEXTURE` も `PRESSED_SHADE` も既に `Button.ts` に居るので、紙の地は Button の style の1つになる | 無し（下の「同じBを複数のAが補う」参照。5ファイル・7箇所で同じ形が繰り返されている） |
| PlayScene | `locationCards` `shownInstanceIds` `foundSince` `requestLocationArt` `currentLandArt` `pathDestinationNames` | `view/PlayScreenView` | **現在地についての断面**——「今そこに出ている札」「絵が要る土地の名前」「行ける土地」。`cardsIn(place)` を2回呼んで合成する、`player.location ?? startLocation` を組み立てが分岐する、`codex.vocabulary.world.pathTagId` でタグを見分けて `new Path` を組む | `locationCards`/`shownInstanceIds`/`currentLandArt`/`pathDestinationNames` は消える。`foundSince` は残る（下段参照） | `pathDestinationNames` は 世界 の読み（Layers.md 3節の「読んだ値から答えを組み立てている」に該当）で、`domain/views/Location` に「ここから行ける土地」が無いこと自体が原因。`foundSince` は探索**前**の控えが要り、映しは行動のたびに作り直されて履歴を持てない |
| PlayScene | `laneCards` `cellsAt` `laneArt` `cardEdges` `describeDrop` `advanceMaterialCycle` `actionButtons` `initialTab` `leaveLocation` | `view/ShownCards` / `view/slotCells` / `SlotView` | **札と枠に「その上の操作が何を意味するか」まで付けた形**。B は素材（束・枠・端の行き先・アクション）までで止まり、`onTap`・`draggable`・`midAction`・端の文言・タブの優先順位は A が付ける | 大半は消える。`advanceMaterialCycle` の「出す型が2つ以上あるときだけ進める」は `slotCells` が答えられる。`describeDrop`/`dropLabel` は**同じ分類を2度している**（片方は吹き出し、片方はログ） | `onTap` が `whileIdle`＝`activity` に依存し、`activity` は組み立てだけが持つ。`ShownStatuses` が `midAction: () => …` を受けているのと同じ形で渡せば外せる。`initialTab` は記憶の置き場が `Settings`（localStorage） |
| PlayScene | `placeText` `dropLabel` `clockText` `realMsFor` | `SlotView` / `looks/durationText` | **文言と書式**。`SlotView.label` は「持ち主は込めません」と明言して持ち主を落としているので、報告用の `持ち主#ID の キー` はどこにも無い。`durationText` は `clockParts` までで、`N日 HH:MM` の字面は無い | 消える | `durationText.ts` の `clockParts` のコメント自身が「**別々に書くと時計とエラー報告の時刻がずれる**」と言っているのに、**分け方だけを共有して字面は共有していない**（`clockText` と `showClock` が同じ `clockParts` から別々に組む）。守っているものは無い |
| PlayScene | `savePinnedStatuses` `placeMapCard` | `save/SaveSlots` | **1項目だけ更新する口**（と、スロット番号を握ったハンドル）。`read/write/delete` が全体の読み書きしか持たないので、A が `this.save` の作業用複製を持ち、丸ごと組み直して書く | 消える。`this.save` と `this.mapPositions`（セーブの値の複製）も要らなくなる | シナリオ起動の `slotIndex = -1` を、`writeSave` と `deleteSave` の**2箇所**が `>= 0` の番兵で守っている。「スロットを持たない周回」を表せる型が `save/` に無い |
| PlayScene | `explore` | `view/operationSteps` | **再生の「前」の段**。`afterPlaybackSteps` は後段だけを持ち、前段（控え→絵のロード→`activity` を立てる→`passTime`）は組み立てが2本（`explore` と `applyToWorld`）持っている | 消える | `applyToWorld` に「この操作は探索だ」を伝える引数が無い。`operationSteps` が後段しか持たないため、**「操作を運ぶ手順は1本」という狙いが探索だけ外れている** |
| PlayScene | `showGains` | `view/` + `looks/` | **増加を粒の数へ直す判断**。`property.range` と `locale.…prop().icon` を直に読み、`sqrt` で粒数を決めている | 粒数の決定だけ消える。飛ばす矩形（発生源→ポートレイト）は画面の事実なので残る | 出すと1つの演出が2箇所（粒数＝映し、矩形＝組み立て）へ割れる |
| PlayScene | `revealWhenLocationArtLoaded` | `ui/LocationArtLoader` | **待ちの取り消し**。`onceLoaded` にハンドルが無いので、A が `artWait` という世代番号を持ち、呼び出し側が一致を覚えていないと壊れる | 消える。`onceLoaded` が取り消せるものを返せば `artWait` ごと消える | 無し（CLAUDE.md の「呼んだ後に呼び出し側が手順を覚えていないと壊れる＝呼ばれる側へ移すサイン」そのもの） |
| PlayScene | `addDivider` | `src/ui/shapes` | **仕切り線を1本引く**。`addPanel`/`drawBox`/`addTiledImage` はあるが線が無い | 消える | `CardLane.addPinnedCell` が同じ線（太さ `px(4)`・`COLOR.laneDivider`・不透明度 `0.35`）を別に描いており、**同じ意匠が2箇所に居る**（PlayScene のコメント自身が「見た目は CardLane.addPinnedCell と同じ」と言っている） |
| PlayScene | `withOrigins` | `view/cardMotionPlan` | **2つの `origins` を重ねる**。コメント自身が `cardMotionPlan` の `origins` を指している | 消える | 無し |
| NewGameScene | `characterRowWidth` `characterOptionWidth` `textFieldHeight` `textFieldsHeight` `characterFieldHeight` `footerHeight` | `looks/`（`NewGameScreenLayout` が無い） | **画面の割り方**。`PlayScene` には `PlayScreenLayout` があるが、この画面だけ組み立てが自分で計算する | `characterRowWidth`/`characterOptionWidth`/`footerHeight` は消える。残り3つは実測値を含む | `textFieldHeight` 系が `labelHeight()` の**実測**を含む。意匠は Phaser に触れないので、実測値を引数で受ける形にしない限り出せない（＝下の行の不足が、この行の阻害要因になっている） |
| NewGameScene | `labelHeight` `characterDescriptionHeight` | `src/ui/labels` | **文字を作らずに1行の高さを答える口**。`addLabel` は表示物を返すだけなので、A が「見本を作る→`height` を読む→`destroy`」を2箇所で書いている | 消える。**そして消えると、上の行の阻害要因も消える** | 無し |
| NewGameScene | `addRandomButton` `addFooterButton` | `ui/Button` | 上の `buttonIcon` と同じ（中央へ中身を置く口） | 消える | 無し |
| NewGameScene | `startGame` | `save/newGameInput` | **3項目をまとめて検証し、どれが駄目かを答える口**。`normalizeIslandName`/`parseSeed` は個別の変換だけで、検証の順序と文言は A が持つ | 検証と理由は消える。画面遷移は残る | 無し（`createSaveData` が既に3つを受ける側に居る） |
| SlotSelectScene | `addSavedSlot` `addDeleteButton` | `ui/Button` / 一覧の行の部品 | 同上＋**札＋表題＋副題を並べた押せる帯**の部品が無い | 消える | 無し |
| ScenarioSelectScene | `addItem` | 同上 | 同上（`rowPlateStyle` で地の style だけ共有し、中身の並べ方は各画面が持つ） | 消える | 無し |
| SettingsScene | `addToggle` | `ui/`（トグルの部品が無い） | **入／切のつまみ**。`Graphics` と `drawBox` で画面が自分で描いている | 消える | 無し |
| SettingsScene | `leave` | `asset-pack/install` | **食い違いに対する処置**。`assetPackMatches` は真偽を答えるだけで、「読み込み直す」を画面が決めている | 消える | 無し |
| SettingsScene | `label` | `src/ui/labels` または `looks/` | **オン／オフの表示語**。トグルが増えれば同じ語が要る | 消える | 無し（名前が値と結び付いておらず、本体を読むまで何のラベルか分からない） |
| ShelfScene | `cardOf` | `view/characterCard` | **型の名前から札を組む口**。`characterCardContent(name, locale)` が同じ形（`{icon, name, art, kind}`）を既に持つが、`kind: 'character'` に固定されている | 消える。`kind` を引数にすれば `cardOf` と `ARTIFACT_ICON` の置き場所が同時に片付く（`placeholderIconOf` の表へ入る） | 無し。**同じモジュールに `placeholderIconOf(objectDefName)` という汎用の口が既にあり**、キャラクタ以外へ開いていないだけ |
| TitleScene | `drawBackground` | `src/ui/shapes` | **縦グラデーションを敷く**。Phaser の `fillGradientStyle` が WebGL 専用で使えないため行ごとに自分で混ぜている——これは Layers.md 5節が言う「Phaser の足りない分を埋める＝`src/ui/`」の型 | 消える | 無し |
| TitleScene | `addMenuButton` | `ui/Button` | 上の `buttonIcon` と同じ | 消える | 無し |
| BootScene | `showMessage` | `src/ui/labels` | **`ScreenMetrics` を持たない場面で文字を置く口**。`addLabel` は `metrics` 必須なので、`BootScene`（`ResponsiveScene` ではない）は使えず、`this.add.text` と `FONT_FAMILY`/`cssColor` を自分で組んでいる | 消える | `addLabel` の `size` が u 単位で、u を持たない場面のための既定倍率が無い |
| errorReport | `messageOf` `stackTraceOf` `seconds` | `Error` / `src/util` | 前2つは `Error` の読み方（B は他所の型で足せない）、`seconds` は汎用の書式化 | `seconds` のみ消える | `messageOf`/`stackTraceOf` は標準の `Error` が主語なので、置き場所は `src/util/` しかない |

## 同じ B に対して複数の A が補っているもの

**B へ1つ足せば複数箇所が消える**組を、消える件数の多い順に。

### 1. `src/game/ui/Button.ts` — 中身を自分で置けない（7箇所／5ファイル）

`Button` の口は `addContent(...GameObject[])` だけで、**中央へアイコンや文字を1つ置く**という
最も多い使い方を持たない。結果、5ファイルが同じ2行（`addLabel(...).setOrigin(0.5)` を `addContent`）を
書いている。

- `PlayScene.buttonIcon`（絵か絵文字かの分岐つき）、`PlayScene.addConditionRow`
- `NewGameScene.addRandomButton`、`NewGameScene.addFooterButton`
- `SlotSelectScene.addDeleteButton`
- `TitleScene.addMenuButton`
- （担当範囲外）`src/game/ui/ScreenHeader.ts:37` も同じ形

紙として置かれるボタン（`slotButtonPaper` / `iconButtonStyle`）も同じ B の話で、
`SLOT_BUTTON_PAPER_TEXTURE`・`SLOT_BUTTON_PAPER_FRAME`・`PRESSED_SHADE` は**既に `Button.ts` に居る**。
`PAPER_BUTTON_SHADOW` と `COLOR.paperButtonBorder` だけが PlayScene 側に残っている。

### 2. `src/game/looks/PlayScreenLayout.ts` — 区画までで止まる（5箇所／1ファイル）

`PlayScreenLayout` は区画の矩形に加えて**区切りの帯を5種類**持っている
（`laneSeparators` `optionsBarSeparator` `situationSeparator` `fieldLeftSeparator` `sidebarSeparator`）。
にもかかわらず、区画の**中**の位置は1つも持たない。

- `buildInformationDividers` — 6種類目の区切りだけが PlayScene 側（`STATUS_PADDING` もそのために PlayScene に居る）
- `buildCharacterDisplay` — `portraitRect` とボタン列の矩形
- `addSlotButtonColumn` — 列の中の4つの矩形（余白の残りを間隔に回す式）
- `buildOptionsBar` / `buildFilterBar` — **縦横分岐まで含めてほぼ同型の式が2本**。差は `padding` 定数と、
  中央寄せ（オプション）か上詰め（フィルター）かだけ
- `buildStatusArea` が持つ `statusRowsX/Y/Width/Gap` の4スカラも同じ B の不足

### 3. レーンと場所の対（7箇所／1ファイル）

第1波が `placeOf`/`spotOf` について挙げたものの実際の広がり。`LaneView` が `{lane, cells}` しか持たないため、
**同じ対応が3箇所**（`placeOf` の `===` 連鎖、`laneViews` の並び、`openLanes` の並び）に書かれ、
さらに `spotOf`・`stacksOf`・`dropOf`・`draggableLanes` がその上に乗る。

`draggableLanes` だけは別の B の不足でもある——`CardDragController.dropAt` が
「重なりを見ず最初に当たったレーン」を選ぶため（コメントに明記）、**手前から並べ替えた配列を
呼び出し側が渡さないと壊れる**。`CardDragController` が深度を見れば、この getter の半分は消える。

### 4. 「そのインスタンスの札はどこか」を誰も答えない（4箇所）

`CardLane` は `cardObjects` と `cellRect(index)` を公開するだけ、`ObjectWindow` は `cardRect` と
`laneOf('found')` を公開するだけなので、**探索と対応付けは全部呼び出し側**にある
（`cardShowing`・`rectOfInstance`・`rectShowing`・`dropChildWindow`）。
現在地カードだけ `cardObjects` に入らない（`addPinnedCell` が `objects` へ入れている）ことが、
`rectOfInstance` の末尾の特別扱い1行を生んでいる。

### 5. `src/ui/labels.ts` — 高さを訊けない（3箇所）

`NewGameScene.labelHeight` と `characterDescriptionHeight` が「見本を作る→測る→捨てる」を書き、
`BootScene.showMessage` は逆に `metrics` が無いので `addLabel` を使えていない。
**この不足は連鎖している**——実測が組み立てにしか置けないことが、`textFieldHeight` 系6件を
`NewGameScreenLayout`（意匠）へ出せない理由になっている。1つ足すと2段が同時に片付く。

### 6. `src/save/SaveSlots.ts` — 1項目だけ更新できない（4箇所）

`savePinnedStatuses`・`placeMapCard` が `SaveData` を丸ごと組み直し、`writeSave`・`deleteSave` が
`slotIndex >= 0` の番兵を**2箇所**に持つ。スロット番号を握ったハンドル（-1 では何もしないもの）を
`save/` が持てば、PlayScene の `save`・`slotIndex`・`mapPositions` の3フィールドごと消える。

### 7. `src/game/looks/durationText.ts` — 字面を持たない（2箇所）

`clockParts` のコメントが「**時計に出すのも記録へ添える文字にするのも同じ分け方**——別々に書くと
片方だけ直したときに時計とエラー報告の時刻がずれる」と、まさにこの危険を名指ししている。
それでも共有しているのは**分け方だけ**で、`N日 HH:MM` という字面は `PlayScene.clockText` が持ち、
`showClock` は `clockParts` から別に組む。B へ `clockText(totalMinutes)` を1つ足せば、名指しした
ずれ方そのものが構造として塞がる。

### 8. 一覧の行の部品が無い（4箇所／3ファイル）

`ScenarioSelectScene.addItem`・`SettingsScene.addToggle`・`SlotSelectScene.addSavedSlot`/`addEmptySlot` が、
いずれも「押せる帯＋左に札やアイコン＋表題＋副題」を別々に組んでいる。共有されているのは
`looks/theme.rowPlateStyle`（地の style）だけで、**中身の並べ方と `ITEM_PADDING_X` は各画面が持つ**
（第1波が指摘した `LIST_PADDING`/`ITEM_HEIGHT`/`ITEM_PADDING_X` の2ファイル重複は、この部品の不在の影）。

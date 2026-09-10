# src/game/ui 全1,012件

A（名前をなぞるだけ）: 981件 / B: 23件 / C: 8件

判定は名前とシグネチャで行い、`doc` は「名前が言えていないことが書かれていないか」の確認にだけ使った。
本体を読んだのは、下表のうち実装で裏を取ったもの（`dropAt`・`release`・`dropFlight`・`hold`・`puffs`・
`absorb`・`barsFor`・`gaugeBarFor`・`disband`/`dissolve`・`rest`・`isShowingChange`・`showContent`・
`highlight`・`settle`・`shrunkToWidth`）のみ。

## C（名前が別のものを指している）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `CardDragController.ts` | `CardDragController::dropAt` | C | 今のポインタ位置で成立するドロップ候補と、そこで起きることを**返す** | 動詞句なので「そこへ落とす」と読めるが、落とさない。`follow`（毎フレームの表示更新）から呼ばれる純粋な問い合わせ | `dropCandidateAt` |
| `CardTable.ts` | `CardTable::release` | C | 宙に在る便と自由な札を**すべて破棄する**（画面の作り直し前） | 同じファイルの `CarriedCard::release` は「指が離した＝自由な札として置く」で、ほぼ逆の意味。同名で意味が2つある | `destroyLooseCards` |
| `CardTable.ts` | `CardTable::dropFlight` | C | 便を打ち切り、飛んでいた札を破棄する | このファイル群の `drop` は「カードを落とす操作」（`CardDrop`・`onDrop`・`dropTargetAt`）。ここだけ「捨てる」の意味で使っている | `abortFlight` |
| `CardTable.ts` | `CardTable::hold` | C | 待たせている自由な札に対して、**実際に運ぶインスタンスIDを確定する**だけ | 「置いたままにする」処理は `FreedCard.waiting` が別に担っており、このメソッドは `freed.ids` を書き換えるだけ。名前は保持の実行を約束している | `confirmHeldIds` |
| `CardTable.ts` | `Flight::puffs` | C | この便が着いたときに砂埃を立てるか（`boolean`） | 同じファイルで `plan.puffs` は「砂埃を立てる矩形の配列」。同じ語で型も意味も違う | `raisesDust` |
| `Card.ts` | `CardContent::background` | C | このカードが今在る**スロットの参照**（そこから地の絵のテクスチャを引く） | 値は背景そのものではなく `SlotRef`。`shownBackground` はテクスチャキーで、こちらとは別物 | `backgroundSlot` |
| `StatusBar.ts` | `StatusBar::isShowingChange` | C | この行を**渡した内容にしたとき**、まだ見せ終わっていない変化が残るか | 名前は引数のない現在状態の問い合わせに読めるが、実際は `content` を仮定した問い | `wouldShowChangeFor` |
| `ObjectWindow.ts` | `ObjectWindow::opened` | C | 今開いているタブの識別子（`string`） | `opened` は真偽値に読める。同じクラスの getter `openedTab` が同じ値を返しており、名前の情報量が逆転している | `openedTabKey` |

## B（一言が名前から読み取れない）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `Card.ts` | `Card::absorb` | B | 帰り着いたインスタンスIDを、今この枠に在るIDへ合流させる（`setPresence` を呼び直す） | 何を吸収するのか（IDの集合）と、在庫の言い直しになること | `absorbReturnedIds` |
| `Card.ts` | `Card::barsFor` | B | 映すバーの控え（`shownGauges`）を差し替え、**映さなくなったバーを隠し**、今出すバーを上から並べる | 問い合わせに見えて、状態を3つ書き換える | `takeRailBarsFor` |
| `Card.ts` | `Card::gaugeBarFor` | B | 鍵でバーを引き、**無ければ作って層順を整え**、`worsensUpward` を渡し直す | 呼ぶと表示物が増えること | `gaugeBarForOrCreate` |
| `CardTable.ts` | `CarriedCard::disband` | B | 元の枠へ**飛んで帰り**、着いた時点で合流して消える | 「解散」だけでは、次の `dissolve` と区別が付かない。動きを伴う側だと分からない | `flyBackToSource` |
| `CardTable.ts` | `CarriedCard::dissolve` | B | その場で即座に合流して消える（画面の作り直しで続けられない） | 同上。`disband` との違いが「飛ぶ / 飛ばない」であることが名前に無い | `mergeBackImmediately` |
| `CardTable.ts` | `CarriedCard::rest` | B | 元の枠に残っている個体のID群 | `ids`（運んでいるID）との対で読ませたいのに、`rest` は「休息」（ゲーム内概念）とも読める。IDの集合だと分からない | `remainingIds` |
| `CardTable.ts` | `CarryHandle` | B | `flyTo` が返す、**飛んでいる便**を外から打ち切る手立て | このファイルの `Carry`／`Carried` は「指が運ぶ札」の語。飛翔の制御であることが読めない | `FlightHandle` |
| `CardLane.ts` | `CardLane::objects` | B | strip に属さず、**自分で破棄しないと残る**表示物（背景板・ピン留め部分） | 名前が型名の言い換えでしかなく、所有・破棄責任という唯一の存在理由が読めない | `ownedObjects` |
| `ExplorationPane.ts` | `ExplorationPane::objects` | B | 同上（面を捨てるときに自分で破棄する表示物） | 同上 | `ownedObjects` |
| `MapWindow.ts` | `MapWindow::objects` | B | 同上 | 同上 | `ownedObjects` |
| `ModalDialog.ts` | `ModalDialog::objects` | B | 同上 | 同上 | `ownedObjects` |
| `ObjectWindow.ts` | `ObjectWindow::objects` | B | 同上（開いている間ずっと在る台紙・見出し・タブ） | 同上。同クラスの `actionObjects` は用途を名前に持っており、こちらだけ落ちている | `ownedObjects` |
| `PropertiesPane.ts` | `PropertiesPane::objects` | B | 同上 | 同上 | `ownedObjects` |
| `RecipeWindow.ts` | `RecipeWindow::objects` | B | 同上 | 同上 | `ownedObjects` |
| `StatusDetailWindow.ts` | `StatusDetailWindow::objects` | B | 同上 | 同上 | `ownedObjects` |
| `StatusBar.ts` | `StatusBar::showContent` | B | 内容を控え、**域・固定表示の印・増減の記号**を反映する（値そのものは触らない） | 兄弟の `applyContent`（値を反映してからこれを呼ぶ）と名前が入れ替わっても読めてしまう | `showAlertAndMarks` |
| `ScrollIndicator.ts` | `ScrollIndicator::highlight` | B | 濃くしたうえで、**間を置いて控えめな濃さへ薄れる tween を掛け直す** | 濃くするだけでなく、戻るところまでを1回で仕込むこと | `highlightThenFade` |
| `LocationArtLoader.ts` | `LocationArtLoader::settle` | B | 1枚の完了・失敗を受けて `inFlight` から外し、**揃った待ち手を呼ぶ** | 待ち手への通知まで含むこと。`settle` は Promise の語でもあり、対象が1枚なのか全体なのかも読めない | `onFileSettled` |
| `ExplorationPane.ts` | `ExplorationPane::content` | B | 探索の内容を**引き直すための関数**（`() => ExplorationContent`） | 名詞なので値に見える。読むたびに最新を取る仕掛けだと分からない | `readContent` |
| `PropertiesPane.ts` | `PropertiesPane::source` | B | カテゴリ一覧を**引き直すための関数**（`() => PropertyCategory[]`） | 同上。加えて `source` は何の source かを言っていない | `readCategories` |
| `FlipCalendar.ts` | `FlipCalendar::build` | B | 桁の枠を左から並べ、**占有した幅を返す** | 戻り値の `number` が何かが読めない（兄弟の `addColon` も同じ規約だが、あちらは doc に明記） | `layOutDigits` |
| `CardLane.ts` | `CardLane::tiles` | B | 絵を敷いた背景板のうち、**カードと同じだけ横へ送る**もの | 送る対象であること（＝ピン留め部分の板は含まない）が読めない。`hazeSurface` の有無判定にも使われる | `scrollingBackgroundTiles` |
| `StatusBar.ts` | `shrunkToWidth` | B | 渡された `Text` を**その場で縮め**、同じものを返す | 過去分詞形は派生物を返す純関数に読めるが、引数を書き換える | `shrinkToWidth` |

## 判定を保留したもの

| 現在地 | 名前 | 迷った理由 |
| ------ | ---- | ---------- |
| `Card.ts` | `CellOverlay` | 一言は「枠がカードの上へ重ねる**短い文字**」で、名前からは「文字」が読めない。ただし `CellHighlight` と対で CardView.md 11節の層の名前（1層目/3層目）として揃っており、層の語彙としてはAとも読める。改名するなら `CellHighlight` 側と揃えて一組で扱うべきで、単独では判定できなかった |
| `CardDragController.ts` | `CardDragController::begin` | Phaser の `dragstart` を受けるが、**まだ何も始めない**（押下位置を控えて動き出しを待つ）。ジェスチャの記録自体は始まっているのでAとも取れる。`end`・`update`・`cancel` と語彙が揃っている点も込みで保留 |
| `Card.ts` | `FRAME_HEAD` / `FRAME_SIDE` | 前者はタイトルの板の**高さ**、後者は桟の**幅**。どちらの名前にも寸法の軸が無いので、値を読み替える側は doc に頼ることになる。ただし枠の部位名として一貫しており、`_HEIGHT`/`_WIDTH` を足すと冗長にもなる |
| `CardTable.ts` | `GAP_MS` | 「1枚ずつ間を置いて飛び立つときの間隔」。`_MS` で時間だと分かるが、何と何の gap かは名前に無い（`TAKEOFF_GAP_MS` なら読める）。モジュール内で1つしか無いため実害は小さい |

## 名前以外に気付いた点（参考）

`StatusDetailWindow.ts` 30〜32行目で、`/** 説明がまだ用意されていないステータスに出す、代わりの1行。 */`
というコメントが**空行を挟んで** `const BAR_HEIGHT = 52;` の前に置かれている。`BAR_HEIGHT` は
120行目でバーの高さとして使われるだけで、コメントの内容とは無関係。説明していた宣言が消えて
コメントだけが取り残されたものと思われる。`BAR_HEIGHT` という名前自体はAだが、読み手はこの
コメントを `BAR_HEIGHT` の説明として読むので、誤解の量はCと変わらない。

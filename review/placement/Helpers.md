# 判定3の再点検 — B の不足を A が補っているもの

判定3は当初「意味論的にはそこである必要はないが、利用者が近くにいるので置かれている」で片付けていた。
それでは足りない。**A が B を利用しているとき、本来は B の役目なのに、B の機能が足りないから A が
private ヘルパーで代わりに書いている**という形があり、これは「近くに置いてあるだけ」とは別物で、
**B 側を直せば A から消える**。

そこで全 private ヘルパー（private メソッド・private getter・export されていないモジュール関数）に、
次の4つを問い直した。

1. このヘルパーの**主語**は誰か。自クラス自身の状態か、引数で受け取った他の型 B か。
2. B が主語なら、**B に無いどの機能**を A が代わりに書いているのか。
3. **B に足せば A から消えるか。** 消えないなら何が残るのか。
4. 消せないなら**何が阻んでいるのか**。

領域別の明細は [`helpers/`](./helpers/) にある。

## 結果

| 領域 | ヘルパー総数 | 主語は自分 | **主語は他（B）** |
| ---- | ------------ | ---------- | ----------------- |
| domain-def / domain-effect | 20 | 6 | **14** |
| domain-state / domain-gen-views | 73 | 34 | **39** |
| ui-card | 70 | 32 | **38** |
| ui-window / ui-hud | 76 | 33 | **43** |
| game-core | 151 | 81 | **70** |
| game-view / shared | 42 | 22 | **20** |
| loader / codex | 169 | 102 | **67** |
| analysis | 70 | 41 | **29** |
| **合計** | **671** | **351** | **320** |

**private ヘルパーの約半数（320/671）は、主語が自クラスではなかった。**

構文解析で「`this` を一度も参照しない private メソッド」を先に抽出したときは13件しか出なかった。
主語が他にあることは、`this` を使っているかどうかでは分からない——**自分の1フィールドだけ触って、
残りは全部 B の話**という形が本命だった。

## 1つ足せば複数消えるもの

B へ1つ足すと、それに寄りかかっていたヘルパーがまとめて消える組。多い順。

### H-1. loader が B のコンストラクタの不変条件を代わりに確かめている — 18箇所

`new` した**後**に呼び出し側が検査する形。第1波は3箇所と報告したが、再点検で **18箇所**（private 14＋
export 4）。加えて `new` の後に B 自身の getter で検査する形（`layer.octaves`・`scope.interiorBias`・
`def.alertDirection`）が5箇所。

止めているのは「例外型が `YamlLoadError` で、文言に YAML の文脈文字列と節番号が入る」という**1本だけ**。
ここを解くと18箇所が同時に動く。

### H-2. 定義に、実行時インスタンス無しで問いを立てる口が無い — 13＋8箇所

ドメインの口が `WorldObject` 前提のため、解析が同じ規則を書き直している。private ヘルパーだけで13個
（`inInitialStage` `destroysWhenEmpty` `ancestorContext` `bestAncestorContext` `withBestDragged`
`isLocation` `isCharacter` `explorableLocationsOf` `isAlwaysAtHand` `selfMovesOf` `minutesOf`
`tickAmountsOf` `ticksWhileGateHolds`）。それぞれ `PropertyValue.changePerTick` / `ticksUntilMax` / `add`、
`PropertyDef.isInStage` / `checkRangeEvents` / `inheritedContribution`、`InteractionDef.durationMinutes` と
**1対1で対応する**。

export されているせいで上の集計に出ない形でも同じ不足が出ている——`staticValue.ts` は**6宣言まるごと**が
`PropertyValue.getEffectiveValue()` の inherit 部の作り直し、`rangeEvents.ts` の `rangeEventAt` /
`ticksToRangeEnd` も同様。`CraftingStep.hasUnresolvedReferences` という印は、この不足があるからだけ存在する。

打ち手: **B の引数を `WorldObject` から `StaticValueResolver` 相当の関数1つへ変える。**
定義側と実行時側が同じ口を通るようになる。

### H-3. `ReferenceRoot` の「この文脈でこの root は解決先を持つか」— 9箇所

switch 5本・集合定数4本・allowlist 2本・名指しの拒否1本（codex 側にも1本）。

**第1波が挙げた阻害要因は、再点検で反例により破れた。** 第1波は「評価文脈を表す型が domain に無いから
loader に住み続けている」と説明したが、`parseMove` は同じ性質の述語 `ObjectRef.needsInteraction()`
（domain 側）を実際に呼んでいる。domain に置けないという理由は成立しない。

### H-4. `ui/labels.ts` の `LabelStyle` に折り返し幅と行間が無い — 6ファイル8箇所

`addLabel(...)` の後に `setWordWrapCallback(wrapByCharacter(w))` を呼ぶ、という2手順を呼び出し側が
覚えている。**B へ2フィールド足すだけで全部消える。単独では最大の畳み込み。**

CLAUDE.md の「あるクラスの公開メソッドを呼んだ後、呼び出し側が『この後あのメソッドも呼ばないと壊れる』を
覚えておく必要があるなら、その手順は呼ばれる側へ移すべきサイン」に、そのまま当てはまる。

### H-5. `ui/Button` が「中央に中身を1つ置く」口を持たない — 5ファイル7箇所

`addContent(...GameObject[])` しか無いため、同じ2行を `buttonIcon`・`addConditionRow`・`addRandomButton`・
`addFooterButton`・`addDeleteButton`・`addMenuButton`＋`ScreenHeader` が書いている。
紙のボタンの `slotButtonPaper` / `iconButtonStyle` も同じ B で、テクスチャキーと押下の濃さは
**既に `Button.ts` に居る**。

### H-6. `WorldCodex` / `ObjectDefTable` に全型走査が無い — 7＋4＋4箇所

`ObjectDefTable` が `count` / `get` だけを公開して反復を持たないため、利用側が毎回組み立てている。
解析の7ヘルパーに加え、`WorldCodex` 自身の4箇所、`CodexView`・`craftingGraph`・`recipeList`・`cardLooks`。
`cardLooks` は `vocabulary.world.characterTagId` があるのにタグ名を文字列から引き直している。

### H-7. `Slot` / `WorldObject` の「枠の中身・束の読み出し」— 4クラス6本

`PlayScreenView.stacksIn`・`craftingView.contentsOf`・`Location.slotContents` / `stacksOf`・
`PlayerCharacter.stacksOf` / `handStacks`。**`Location.stacksOf` と `PlayerCharacter.stacksOf` は
1文字違わぬ同一実装。** `Slot` に「空き枠を保った束」、`WorldObject` に「枠が無ければ空」を足すだけで
6本すべてが消える。

### H-8. `Card` に getter が無い — 5本＋前置き4箇所

`Card` が `get ids` / `get rect` / `appear` / `slideToX` / 破棄済みでも安全な `absorb` を持たないため、
`idsOf`・`rectOf`・`fadeIn`・`slideTo`・`returnToSource` を周りが代わりに書いている（`isAlive` の
前置きが4箇所）。`CarriedCard.get rect` はモジュール関数へ委譲していて、**あるべき getter が2段ずれている**。

### H-9. `CardLane.cardObjects` が開いている — 4クラス5箇所

開いているために「札と枠の対応を組み立てる」コードが `CardTable.placedCards`・
`CardDragController.locate` / `showAcceptingCards` / `begin`・`PlayScene.cardShowing` に散っている。
`CardLane` に「添字・札・矩形の組」と `indexOf` を足せば全部消える。

### H-10. `resolveEffectTargetOrAncestor` の直後に同じ id を2回渡す — 10箇所

`owner.resolveEffectTargetOrAncestor(root, id, …)?.tryGetProperty(id)` という形が
`ActiveEffect.ts` 6・`ConditionNode` 2・`PassiveEffect` 2。`WorldObject.tryResolveProperty(...)` 1本で
全部1行になる（既定値の決定は呼び手ごとに違うので B には持たせない）。

### H-11. `resolveReferenceRoot` が `'ancestor'` を扱わない — 5箇所

同じ解決3行が5箇所に散っており、うち `WeightSpec.resolve`（`PickEffect.ts` L85）は
`WorldObject.resolveEffectTargetOrAncestor` と**本体が完全に同一**。
`PropertyPath` に解決の口を1つ足せば4箇所が消える。

### H-12. 「枠1つ」を表すオブジェクトが無い — 5本＋外から1本

`_cells[i]` と `def.cellAt(i)` の**添字の暗黙の一致**を結び直すために `Slot` の private ヘルパー5本が
存在し、同じ「枠の残り数」計算を `autoFill` が `Slot` の外から書いている。
`ObjectStack.tryInsert` が `max` を守れず `Slot` に守らせているのも同じ原因。

CLAUDE.md の「暗黙の位置規約（先頭が特別、など）は名前付きフィールドへ直す」に該当する。

### H-13. `PropertyStage` が述語を1つも持たない — 5箇所

裸のデータクラスであることが `PropertyDef` の private ヘルパー3件（`deriveAlertDirection` /
`stageBoundaries` / `spanOf`）＋`stageAt`＋構築子を生んでいる。
**第1波が `PropertyDef` の判定4として並べた5件は、「段の並びに主が居ない」という1つの欠落に畳める。**

### H-14. `StatusDetailWindow` の4件は `ProgressBar` の欠落を補っている

バーに目盛り・区間を重ねる口が無いため、窓がバーの矩形を控え直し、**private な
`ProgressBar.radius = height/4` と同じ式を `drawStageBox` に書き写している**。
さらに `drawStageBox` は隣の `drawStagePlate` が使っている `drawBox` を手で展開し直している。

構文解析で見つけた「`this` を使わない private メソッド」13件のうち4件がこのクラスに集中していた理由が
これ。**このウィンドウだけが既存部品に載らない小部品を2つ組んでいる。**

### H-15. `Button` が選択状態を持たない — 2箇所

「選択が変わったら全ボタンへ `setBoxStyle(tabBoxStyle(...))` を呼び直す」3行を `ObjectWindow` と
`PropertiesPane` が別々に持つ。第1波が「タブ列が2回実装されている」と書いた差の正体はこの1点。
同型の規約写しが `ScrollArea`（受け面と入れ物を呼び出し側に用意させる）にも、**注意書きコメントごと
3箇所に複製**されている。

### H-16. `LaneView` が場所を持たない — 7箇所・同じ対応表が3箇所

第1波が指摘した `placeOf` / `spotOf` の `===` 連鎖の実体。`LaneView` に場所を持たせれば1箇所に畳める。

### H-17. `PlayScreenLayout` が区画の中の位置を1つも持たない

区切りの帯を5種類持つのに、6種類目の仕切り線（`buildInformationDividers`）だけが `PlayScene` 側にある。
**同じ形の private 関数が既に Layout にあり、阻害要因は無い。**
`buildOptionsBar` / `buildFilterBar` は縦横分岐まで含めてほぼ同型の式を2本持つ。

## 阻害要因なしで、今すぐ動かせるもの

B 側に不足が無く、単に書き直されているだけのもの。

| 現在地 | ヘルパー | 本来の主 |
| ------ | -------- | -------- |
| `craftingView.locationItems` | `.instance` へ降りて書き直し | `Location.items`（既に在る） |
| `Location.stacksOf` / `PlayerCharacter.stacksOf` | 完全に同一の実装 | どちらか一方（または `WorldObject`） |
| `LocationTypeMatcher.normalizedDistance` / `passesHardLimits` | 読むのは `site.axisValues` だけ | `LocationTypeDef`（`appliesTo` の隣） |
| `NameAssigner.shuffled` | `pickWeighted` は既に `Rng.ts` に居る | `Rng.ts` |
| `recipeList.actorOnly` | 13.3節「解放条件は actor しか参照できない」という**ドメインの規則**を映しが持っている | `RecipeDef`（`src` 内の呼び出し元はここ1箇所だけ） |
| `PlayerCharacter.mainland` | `WorldObject.findAncestorWithTag` が無いだけ | `WorldObject` |

## 第1波の判定を変えたもの

再点検で、第1波が挙げた阻害要因が**実在しない**と分かったもの。

| 対象 | 第1波の阻害要因 | 再点検 |
| ---- | --------------- | ------ |
| `LocationTypeMatcher.normalizedDistance` / `passesHardLimits` | 「Def が `Site` を知らずに済ませるため」 | **成立しない。** 両関数が読むのは `site.axisValues` だけで、引数を `ReadonlyMap<string, number>` にすれば依存は生まれない |
| loader の `*_CONDITION_ROOTS` | 「評価文脈を表す型が domain に無い」 | **反例で破れている。** `parseMove` は同性質の述語 `ObjectRef.needsInteraction()`（domain）を実際に呼んでいる |
| `src/locale/Localization.ts` の private 6本 | （`WorldCodex` 主語を疑わせた） | **主語はすべて自分。** 第1波の判定をそのまま維持 |

逆に、再点検が第1波の未解決を説明したもの:
**`Path.returnPathInstanceId` に本番の呼び出し元が無い**理由は、`Location.reveal` /
`revealInOwnLocation` が `this.instance` を触らず他の土地を操作し、`Path.returnPathInstanceId` と
`Path.destination` の実装を**その場で書き直している**ため。

## 解析とビューアの間で、区別を落として復元している — 4件

`balancePage.ts` の `menuHtml` は「使える経路」で絞った後の**添字**を `<option value>` に埋め、
`wireBalanceMenu` が同じ絞り込み（`!untimed && !blocked`）を再現して解釈している。
**2箇所が暗黙に一致していないと選択が別の経路を指す。**

同種の絞り込みはこのファイルだけで4箇所。`Gap.label`（型かタグかを名前引きで推測）・
`PlaceBalance.name`（島全体かを文字列一致で判別）と合わせて、
**解析側が答えを作るときに区別を落とし、ビューアが復元している**という同じ形が4件ある。

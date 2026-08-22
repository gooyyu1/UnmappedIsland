# リファクタリング候補

判定4（296件）・判定5（41件）を、**打ち手の単位**でまとめ直したもの。宣言ごとの明細は
[`areas/`](./areas/) にある。この文書は「どこから手を付けるか」を決めるためのもの。

優先順位の考え方は1つ。**1つ直すと何件消えるか。** 判定4は「実装上の別の何かを守るためにそこに居る」
なので、守っているものを1つ外すと、それに寄りかかっていた宣言がまとめて動ける。

## 概観

| 打ち手の種類 | 規模 | 性質 |
| ------------ | ---- | ---- |
| A. 欠けている概念を作る | 12種 | 移動先が無い。作れば複数箇所の置き場が同時に決まる |
| B. 1つの阻害要因を外す | 8束 | 束ごとに3〜24件が同時に動ける |
| C. そのまま移す | 20件 | 阻害要因が無い。単独で完結する |
| D. 可視性を絞る | 7件＋89件 | 移動不要。`private` 化・`export` 外しだけ |

判定4の阻害要因を数えると、**表形式で拾えた147件のうち31件が「B の `private` を開けたくない」**、
13件が「意匠の値を部品が直に引いている」、9件が「ドメインの口が `WorldObject` 前提」、5件が層のルール、
4件がテスト。最も多いのは B の非公開を守るための歪みで、これは B 側に問いの形の口を足せば解ける種類のもの。

## A. 欠けている概念

移動先を書けなかったもの。**置き場所が無い＝概念そのものが欠けている**という別種の発見なので、
作るべきものを名前で書いた。上から、解決する箇所が多い順。

### A-1. 画面のことばの置き場 — 3領域が独立に同じものを指した

`src/locale/` はワールド定義の語（オブジェクト名・変種・タグ）に語を与える口しか持たず、
**ワールド定義に由来しない画面の地の文**を持つ場所が無い。

- `NO_DESCRIPTION`（`DescriptionPane` と `StatusDetailWindow` に**同一の文字列が2つ**）
- `DESCRIPTION_LABEL` / `PROPERTIES_LABEL` / `EXPLORATION_LABEL` / `CANNOT_DO_NOW` / `NO_INFLUENCE`
- 宣言にすらなっていない直書き: `'閉じる'`（MapWindow・ObjectWindow・RecipeWindow・StatusDetailWindow の**4箇所**）、`'地図'`、`'与えている影響'` / `'受けている影響'`
- 映し側の `UNNAMED_LOCATION`（`PlayScreenView`）、`LOCKED` / `OTHER`（`recipeList`）

`ui-window`・`game-view`・横断チェックの3つが、互いを知らないまま同じ欠落に行き着いた。
**ここが決まらない限り、同じ文が窓ごとに増え続ける。**

### A-2. 部品1つぶんの意匠 — 4領域が指した

`looks/theme.ts` は画面全体で共有する `COLOR` / `SIZE` / `FONT_FAMILY` の置き場で、
**「この札の紙の余白」「この覆いの濃さ」「この印の大きさ」という部品1つぶんの意匠**を置く単位が無い。

- `Card.ts` の意匠定数 **44個**、`CardLane` 3個、`CardDragController` 5個、`LaneHaze` 4個
- 全10シーンに散る寸法・色・時間の見せ方（`game-core` の判定3のうち **46件**）
- `src/ui/shapes.ts` の `SHADOW_LAYERS` / `DASH_LENGTH_RATIO`（汎用部品が意匠の値を抱えている）

`looks/cardFlight.ts` / `heatHaze.ts` / `rainStyle.ts` は既にその単位で切られているので、
欠けているのは概念ではなく**モジュールの粒**（例: `looks/cardLook.ts`）。
併せて、汎用部品（`src/ui/`）へ意匠を差し込む口が `labels.ts` の `setLabelDefaults` にしか無いので、
同じ形の口（`setShapeDefaults` 相当）が要る。

### A-3. 観測の器（`WorldObservation` 相当）

`WorldSession` の**26宣言中15**が「世界の出来事を、囲った範囲のあいだだけ観測口へ流す」ためのもので、
tick・変化・signal・gain の4種が**同じ形を4回コピー**している（保存→差し替え→try/finally→復帰）。
差はフィールドとコールバック型だけ。「観測口を1つ差し込んで、抜けたら戻す」という概念に名前が無いため、
種類が増えるたびに `WorldSession` が2宣言ずつ太る。

### A-4. 中身から受ける寄与（ContainerSystem）の置き場

`WorldObject.containerContributionTo` ＋ `effectiveWeight` ＋ `collectContainerInfluence` ＋
`storageFillRatio` は **weight/load の導出という同じ1つの仕組みの4面**だが、
`WorldObject`・`PropertyValue`・`PropertyInfluence` の3ファイルに散っている。まとめる先のクラスが無い。
`WorldObject` が `weight` と `load` という特定のプロパティ名だけに効く算術を直書きしている状態。

### A-5. 入れ子を読み上げる語彙

`docs/engine/Layers.md` 6節の「効果の木を外へ出さない」方針が、**再帰する3箇所でだけ破れている**
（`ConditionReader.all` / `any` / `not`、`GateReading.conditions`、`PickCandidateReading.effect`）。
現在の Reader は「1回の呼び出し＝1つの葉の宣言」を前提にしており、入れ子を表す語彙が無い。
これが入れば、方針が例外なしで成立する。

### A-6. 描き替えを跨いで生き残るページのインスタンス

codex ビューアのページは `render(view) => string` の関数だけで、**ページを表すオブジェクトが無い**。
そのため描き替えを跨いで残る状態がモジュール変数になっている（`balancePage.lastTables`、
`main.ts` の `networkZoom`）。これが在れば `lastTables`・`networkZoom`・配線関数・`wireObjectFilter` の
置き場が同時に決まる。

### A-7. 実体化された島

`IslandMap` は「`WorldObject` に一切触れない純粋な計算結果」と自称しながら、
`siteInstanceIds` / `nameOfInstance` で**実体化後の instanceId 対応表**を持っている。
生成結果と世界のインスタンスの対応を持つ概念が無いため、純粋計算の結果が実体化後の状態も兼ねている。

### A-8. 決着（エンディング）

`PlayerCharacter.hasReachedMainland` / `broughtArtifacts` の移動先が無い。
死・脱出・持ち帰りをまとめて答える概念が無いため、キャラクタのビューが決着の判定まで抱えている。

### A-9. 評価文脈の型

loader の `*_CONDITION_ROOTS` 4本。「どの評価文脈か（action / combination / recipe解放 / passiveゲート）」を
表す型が domain に無いため、**実行時に解決できるかという domain の事実が、ロード時にしか読まれない定数として
loader に住み続けている**。

### A-10. 保存領域のキー名前空間

`SaveSlots` / `Settings` / `Shelf` が `unmapped-island:` を各自で書き、壊れた JSON の扱いも各自で実装している。
「この製品がブラウザに持つ保存領域はこれだけ」を1箇所で言う場所（`src/save/storageKeys.ts` 相当）が無い。

### A-11. 宣言に対する「見せ方の宣言」

`rainStyle.ts` の `RAIN_STYLES` は天気の識別子ごとの見せ方の表。天気そのものは `src/assets/` の宣言
（`core.yaml`）が持つのに、**それを「どう見せるか」を宣言するデータの居場所が無い**ため、意匠のコードが
世界の語彙を写し取っている。`heatHaze` / `skyTint` が数値の閾値で済んでいるのに `rainStyle` だけ語彙を
持つのは、天気が連続値ではなく識別子だから。

### A-12. 「起動」という区分

`docs/engine/Layers.md` 4節の在処の表に「起動」の行が無い。`Phaser.Game` を作って端末の解像度に追従させる
`src/main.ts` と `DeviceScreen` は、世界・映し・意匠・部品・組み立てのどれでもない。
**表に区分が無いことが、置き場所が決まらない原因**になっている。

### A-13. 周りの物を候補にする `pick`

`src/domain/views/Animal.ts` は「動物に1手を与える」ための wrapper に見えるが、中身は
**エンジンの表現力不足を肩代わりしたもの**。`takeTurn` が呼ぶ `aim` は
「候補を作り、重み付きで1つ選び、その数と対象をプロパティへ書く」——**YAML の `pick` そのもの**で、
TypeScript 側にあるのは `pick` が**周りの物（足元のアイテム、伸びている道）を候補として列挙できない**
ため。

3回の呼び出しの差は、突き詰めると**3つのパラメータだけ**だった。

| | 出所 | 絞り込み | 重み |
| ---- | ---- | -------- | ---- |
| loot | `location.items` | `quarry` タグでない | `volume` |
| smash | `location.items` | `fragile` タグ | `volume` |
| escape | `location.paths` | なし | 一律 1 |

`lootTargets` と `smashTargets` は既に `bumpableTargets(location, matches)` を共有していて、
差は述語1つ。`lootables` / `smashables` / `escapeRoutes` という動物固有の名詞は
**3つの種類ではなく、1つの仕組みの3つの引数**にあたる。

汎用語彙の導入を保留した結果として動物に特化した名詞が入っているので、**語彙の汎用化のときに
まとめて解く**。それまで `Animal` は wrapper の基底（`ObjectWrapper`）に乗せない——形は wrapper だが、
中身は解体される予定のものなので、共通の親に取り込むと解体しにくくなる。

## B. 1つの阻害要因を外すと複数が動くもの

### B-1. `RawObjectDef` と `RawTrait` の宣言本体が二重 — 24件

同じ11キー（`name` `source` `tags` `props` `slots` `passives` `stackOrder` `visibleSlots` `artByStage`
`actions` `combinations`）のフィールドと読み取りコードを丸ごと二重に持っている。
`RawTrait.readFields` のコメント自身が「（`RawObjectDef.readFields` と対）」と書いており、
**読む側を2箇所に置かない**という意図がありながら2箇所にある。

打ち手: 共通の「混ぜ込める宣言一式」（`RawDeclarationBody` 相当）を1つ作り、両者がそれを1つ持つ。

### B-2. `WorldSession` の観測口 — 16件

A-3 と同じもの。阻害要因は「世界の中の物（`WorldObject`・`PropertyValue`）が持っている外部への経路が
`session` ただ1本」であること。別クラスへ出すと `session.observation.recordChange(...)` の2段の道か、
全オブジェクトへの2本目の参照が要る。

### B-3. 定義（Def）に問いを立てる口が無い — 9件

ドメインの口が `WorldObject`（実行時インスタンス）前提のため、解析が同じ規則を書き直している。

| 解析側が書き直しているもの | 本来の主 |
| -------------------------- | -------- |
| `rangeEvents.rangeEventAt()` | `PropertyDef`（値→ラベルの問い） |
| `rangeEvents.ticksToRangeEnd()` | `PropertyDef` |
| `staticValue.staticValueOf()` | `PropertyDef`（inherit の加算） |
| `balanceTables.isLocation()` / `isCharacter()` / `explorableLocationsOf()` / `Acquisition.isAlwaysAtHand()` | `WorldCodex` |
| `craftingSteps.minutesOf()` | `InteractionDef` |
| `balanceTables.destroysWhenEmpty()` | `PropertyDef` |

**この1つの不足が、解析側に9件の書き直しを生んでいる。**

### B-4. `CardLane` が内部座標系・`ScrollArea`・表示物リストを公開しない — 7件

`dropTargetAt` / `isCardBody` / `dropIndicatorRect` / `beginScroll` / `scrollByDrag` / `hazeSurface` は、
それらを公開しないためにレーン側へ寄せられた**他所の問い**。

### B-5. `describe` をドメインの契約にしない層のテスト1つ — 5件

`describeObjectDef` / `describeProperty` / `describeSlot` / `describeRecipe` / `describeInteraction` は
定義の公開フィールドをなぞるだけで、定義自身が持つのが自然。止めているのは
「`DescriptionWriter` をドメインの契約にしない」という層のテスト1つだけ。

なお `DefNames` は本来 `WorldCodex` が実装できるのに、値をトークンで返す `propertyValue` が1つ混ざって
いるためドメインへ戻せない。コメントは今も「実装は `WorldCodex`」と書いており、
`DescriptionWriter`・`CodexView` 冒頭と合わせて**3箇所が describe をドメインに置いていた頃の記述のまま**。

### B-6. 意匠の色トークンを直に引く1点 — 3クラス

`Button` / `Curtain` / `ScrollIndicator` は中身が汎用で、`src/ui/` へ出せない理由は
**意匠の色トークンを直に引いている1点ずつだけ**。A-2 の「差し込む口」が入れば同時に解ける。

あわせて: `docs/engine/Layers.md` が「`Button` は汎用に見えてスロットボタンの紙のテクスチャキーを持つ」を
汎用/固有の判定例に挙げているが、**`SLOT_BUTTON_PAPER_TEXTURE` は `Button.ts` のモジュール定数で、
`Button` クラス自身は一度も参照していない**（読むのは BootScene と PlayScene）。ドキュメントの例が
実装とずれているので、直すときに例も更新が要る。

### B-7. 効果クラスが内部を非公開に保つための歪み — 4件が同型

`AddEffect.applyScaled`（transfer の按分）・`TransferEffect.collectTransferInfluences`（`active` を
呼び出し側から受け取る）・`SpawnEffect` の公開3フィールド（`WorldObject.executeSpawn` が読む）・
`PropertyPassiveEffect.activeAmount`（`RegisteredPassiveEffect` の素通し先）。
**同型なので、1つの仕組みでまとめて解ける見込みがある。**

### B-8. パース結果の不変条件を、作った後に呼び出し側が確かめる — 3箇所が同型

`parseProp` → `PropertyDef` の gauge/alert 整合、`RawObjectDef.resolve` → `ObjectDef` の名前衝突・
`art_by_stage` 検証、`buildGenerationDefs` → `GenerationDefs` の相互参照。
阻害要因はいずれも「エラー文言に YAML の文脈文字列と節番号が要る」の**一点**。

## C. そのまま移せるもの（判定5）

阻害要因が無く、単独で完結する。

| 現在地 | 対象 | 移動先 |
| ------ | ---- | ------ |
| `src/domain/PickEffect.ts` | `WeightSpec` ほか8宣言 | `src/domain/WeightSpec.ts`（名前も `ValueSpec` 等へ）。pick 専用ではなく `SlotDef.putInDuration` と3種の `duration` が使う汎用の数値指定 |
| `src/domain/PropertyDef.ts` | `inheritedContribution(owner)` | `PropertyValue`。`inherit` `globalId` とも public で、private を1つも読まない |
| `src/domain/PropertyDef.ts` | `declaredOnMax` | 読み手が居ない（A の欠落あり） |
| `src/domain/TypeMatchRule.ts` | `acceptSpec(names)` | `src/loader/inProgressObjects.ts`（唯一の呼び手） |
| `src/domain/GeneratedTypes.ts` | `baseAlong(def, axis)` | 呼び手が居ない |
| `src/domain/generation/Pcg32.ts` | `Pcg32` `RandomPurpose` | `src/domain/Pcg32.ts` または `src/util/`。`Rng.ts` と `src/save/SaveData.ts` が使う汎用実装が生成配下に居る |
| `src/analysis/effectOutcomes.ts` | `Readable` `Readable.read` | 既存の `src/domain/EffectReader.ts#EffectDeclaration` の**完全な再宣言** |
| `src/analysis/balanceTables.ts` | `MINUTES_PER_TICK=15` ほか | `core.yaml` のワールド宣言そのもの。`WorldVocabulary` 経由で読む |
| `src/analysis/balanceTables.ts` | `WHOLE_ISLAND` `conditionLabel()` | `codex-viewer/balancePage`。冒頭で「見せ方は持たない」と宣言しながら表示文字列を焼き込んでいる |
| `src/analysis/craftingSteps.ts` | `totalMinutesOf()` | `RecipeDef`。`domain/crafting.ts` が同じ和を2箇所で取っている |
| `src/save/newGameInput.ts` | `NAME_ADJECTIVES` `NAME_NOUNS` | `src/assets/`。日本語の語彙はデータ |
| `src/scenario/Scenario.ts` | `PLAYER_SLOTS` | `WorldVocabulary` / `PlayerCharacter`（既に宣言済み） |
| `src/codex-viewer/CodexView.ts` | `escapeHtml()` `EMPTY_HTML` `inlineArtHtml()` | `src/codex-viewer/html.ts`（新設）。4ファイルが `./CodexView` から輸入している |
| `src/game/view/recipeList.ts` | `recipeOf()` | `src/domain/crafting.ts`。純粋なドメイン照会で画面の話が1つも無い |
| `src/game/PlayScene.ts` | `pathDestinationNames()` | `PlayScreenView` / `domain/views/Path`。結線ではなく世界の読み |
| `src/game/ui/Button.ts` | `SLOT_BUTTON_PAPER_TEXTURE` `SLOT_BUTTON_PAPER_FRAME` | `src/art/` |
| `src/game/ui/StatusBar.ts` | `StatusInfluence` `StatusStage` `StatusDetail` | `StatusDetailWindow.ts`。`StatusBar` は一度も読まない |
| `src/game/ui/ProgressBar.ts` | `alertBorderColor` | `looks/theme.ts`（同種の `statusFillColorFor` が既にある） |
| `src/game/ui/ExplorationPane.ts` | `noteOf()` | 映しへ。部品が世界の話を言い分けている |
| `src/loader/RawObjectDef.ts` | `namesIn()` | 汎用ヘルパーで `RawObjectDef` と無関係 |

## D. 可視性だけの問題

移動不要。そこに居ること自体は正しく、**公開されている理由だけが無い**。

| 対象 | 打ち手 |
| ---- | ------ |
| `Slot.hasFixedCells` | `private` 化（クラス内12箇所で使用、外部呼び出し元なし） |
| `Slot.tryInsertAtGap` / `tryInsertAtCell` / `tryMoveStackToGap` | `private` 化（`src` `tests` ともに参照ゼロ） |
| `PropertyValue.changePerTick` | `private` 化（`ticksUntilMax` の内部でしか使われない） |
| `PropertyValue.incoming` | 判定4へ修正（[`Calibration.md`](./Calibration.md)）。テスト1本のために公開が2段連鎖している |
| `Localization.LocaleSections` | `export` を外す（メンバーの型が非公開なので外からは1つも作れない） |
| `inProgressObjects.ts` の `export { IN_PROGRESS_TAG }` | 削除（domain の定数への第二の入口だが、使う箇所が1つも無い） |
| `inProgressObjectName()` | `export` をやめる。映し側は `WorldCodex.tryResolveBecome` を使う |

さらに、`src` の他ファイルから一度も参照されず `tests/` からのみ参照される公開が
**export 17件・public メンバ 20件**、誰からも参照されない export が **72件**ある
（[`CrossCutting.md`](./CrossCutting.md) の A・B）。

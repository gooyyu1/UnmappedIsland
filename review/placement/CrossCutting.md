# 横断チェック（親が実施：各担当の範囲に閉じないと見えないもの）

## A. テストからしか使われていない公開

`src` の他ファイルからは一度も参照されず、`tests/` `scripts/` からのみ参照される公開。
**テスト可能性を守るために公開されている＝判定4**の候補。

### A-1. export（module-level）

| 現在地 | 種別 | 名前 |
|---|---|---|
| `src/analysis/balanceTables.ts` | interface | `RouteStep` |
| `src/analysis/balanceTables.ts` | interface | `RoutePrerequisite` |
| `src/analysis/balanceTables.ts` | interface | `PropertyChains` |
| `src/art/iconArt.ts` | const | `ICON_NAMES` |
| `src/asset-pack/zip.ts` | class | `ZipReadError` |
| `src/codex-viewer/networkLayout.ts` | interface | `LayoutEdge` |
| `src/game/looks/theme.ts` | type | `CardFrameKind` |
| `src/game/ui/laneCells.ts` | const | `LANE_CELLS_MAX` |
| `src/game/view/cardMotionPlan.ts` | interface | `MotionInput` |
| `src/game/view/characterCard.ts` | function | `characterIcon` |
| `src/game/view/slotCells.ts` | function | `plainCells` |
| `src/game/view/slotCells.ts` | function | `materialCells` |
| `src/locale/Localization.ts` | const | `LOCALE_FILE` |
| `src/locale/Localization.ts` | function | `bundledLocaleText` |
| `src/locale/Localization.ts` | function | `parseLocale` |
| `src/scenario/Scenario.ts` | function | `parseScenario` |
| `src/ui/nineSlice.ts` | function | `sliceSpans` |

### A-2. public メンバ

| 現在地 | 種別 | 名前 |
|---|---|---|
| `src/codex-viewer/describe/Description.ts`#DescriptionLine | method | `toPlainText` |
| `src/codex-viewer/describe/Description.ts`#DescriptionWriter | method | `toPlainText` |
| `src/domain/PropertyValue.ts`#PropertyValue | getter | `incoming` |
| `src/domain/Slot.ts`#Slot | method | `tryMoveStackToCell` |
| `src/domain/SlotDef.ts`#SlotDef | field | `manualPlacement` |
| `src/domain/SlotDef.ts`#SlotDef | getter | `hasPutInDuration` |
| `src/domain/SlotDef.ts`#SlotDef | getter | `acceptsAtMostOne` |
| `src/domain/generation/Pcg32.ts`#Pcg32 | method | `nextUint` |
| `src/domain/views/Location.ts`#Location | getter | `itemStacks` |
| `src/domain/views/Location.ts`#Location | method | `receiveItem` |
| `src/domain/views/Location.ts`#Location | getter | `fixtureStacks` |
| `src/domain/views/Path.ts`#Path | getter | `returnPathInstanceId` |
| `src/domain/views/PlayerCharacter.ts`#PlayerCharacter | getter | `hp` |
| `src/domain/views/PlayerCharacter.ts`#PlayerCharacter | getter | `satiety` |
| `src/domain/views/PlayerCharacter.ts`#PlayerCharacter | getter | `handStacks` |
| `src/domain/views/PlayerCharacter.ts`#PlayerCharacter | getter | `equipmentStacks` |
| `src/domain/views/PlayerCharacter.ts`#PlayerCharacter | getter | `injuryStacks` |
| `src/game/view/ShownCards.ts`#ShownCards | method | `combinationAt` |
| `src/game/view/ShownCards.ts`#ShownCards | method | `edgeTargets` |
| `src/loader/LoadReport.ts`#LoadReport | getter | `problems` |

## B. 誰からも参照されていない公開

`src` からも `tests/` `scripts/` からも参照されない export。`export` を外せる（＝可視性の判定3〜4）。
ただし同名の識別子が一度も現れないという粗い判定なので、型として構造的にのみ使われている場合を含む。

| 現在地 | 種別 | 名前 |
|---|---|---|
| `src/analysis/CraftingStep.ts` | interface | `CraftingOutput` |
| `src/analysis/CraftingStep.ts` | interface | `PropertyDelta` |
| `src/analysis/CraftingStep.ts` | interface | `PropertyAssignment` |
| `src/analysis/CraftingStep.ts` | interface | `SpawnedCount` |
| `src/analysis/balanceTables.ts` | interface | `Cost` |
| `src/analysis/balanceTables.ts` | interface | `ConsumptionRow` |
| `src/analysis/balanceTables.ts` | interface | `SupplyRow` |
| `src/analysis/balanceTables.ts` | interface | `MenuEntry` |
| `src/analysis/balanceTables.ts` | interface | `DailyMenu` |
| `src/analysis/balanceTables.ts` | interface | `DeviceRow` |
| `src/analysis/balanceTables.ts` | interface | `Gap` |
| `src/analysis/balanceTables.ts` | interface | `RouteSummary` |
| `src/analysis/balanceTables.ts` | interface | `DailyNeed` |
| `src/analysis/effectOutcomes.ts` | interface | `Readable` |
| `src/analysis/rangeEvents.ts` | interface | `RangeEventReadout` |
| `src/analysis/staticValue.ts` | interface | `TrackingResolver` |
| `src/codex-viewer/networkLayout.ts` | interface | `LayoutResult` |
| `src/domain/PropertyDef.ts` | type | `AlertDirection` |
| `src/domain/PropertyDef.ts` | type | `InitialValueReading` |
| `src/domain/PropertyDef.ts` | interface | `StageSpan` |
| `src/domain/PropertyInfluence.ts` | type | `InfluenceCounterpart` |
| `src/domain/PropertyInfluence.ts` | interface | `InfluenceEdge` |
| `src/domain/SlotDef.ts` | type | `CellsReading` |
| `src/domain/generation/AxisDef.ts` | type | `GeneratorLayerType` |
| `src/domain/generation/Pcg32.ts` | type | `RandomPurpose` |
| `src/game/NewGameScene.ts` | interface | `NewGameSceneData` |
| `src/game/PlayScene.ts` | interface | `PlaySceneData` |
| `src/game/ShelfScene.ts` | interface | `ShelfSceneData` |
| `src/game/looks/skyTint.ts` | interface | `SkyTint` |
| `src/game/ui/Button.ts` | interface | `TextButtonStyle` |
| `src/game/ui/CardDragController.ts` | interface | `CardDragHandlers` |
| `src/game/ui/CardLane.ts` | interface | `CardLaneOptions` |
| `src/game/ui/CardLane.ts` | interface | `LaneUpdate` |
| `src/game/ui/CardTable.ts` | interface | `CarryHandle` |
| `src/game/ui/MapWindow.ts` | interface | `MapWindowOptions` |
| `src/game/ui/ModalDialog.ts` | type | `DialogActionStyle` |
| `src/game/ui/ModalDialog.ts` | interface | `DialogAction` |
| `src/game/ui/ModalDialog.ts` | interface | `ModalDialogOptions` |
| `src/game/ui/ObjectWindow.ts` | interface | `ObjectWindowTarget` |
| `src/game/ui/ObjectWindow.ts` | interface | `ObjectWindowOptions` |
| `src/game/ui/RecipeWindow.ts` | interface | `RecipeWindowOptions` |
| `src/game/ui/StatusBar.ts` | interface | `StatusStage` |
| `src/game/ui/StatusBar.ts` | type | `StatusLabel` |
| `src/game/ui/StatusBar.ts` | interface | `StatusBarOptions` |
| `src/game/ui/StatusDetailWindow.ts` | interface | `StatusDetailWindowOptions` |
| `src/game/ui/TextInput.ts` | interface | `TextInputOptions` |
| `src/game/ui/WeatherPanel.ts` | interface | `WeatherPanelContent` |
| `src/game/view/ShownCards.ts` | interface | `CardSource` |
| `src/game/view/ShownStatuses.ts` | interface | `StatusSource` |
| `src/game/view/cardLooks.ts` | interface | `CardLooks` |
| `src/game/view/cardMotionPlan.ts` | interface | `PlannedFlight` |
| `src/game/view/cardMotionPlan.ts` | interface | `ShownCard` |
| `src/game/view/cardMotionPlan.ts` | interface | `MotionPlan` |
| `src/game/view/cardOperations.ts` | interface | `CardOperationsFactory` |
| `src/game/view/operationSteps.ts` | type | `PlaybackStep` |
| `src/game/view/operationSteps.ts` | type | `AfterPlaybackStep` |
| `src/loader/LoadReport.ts` | interface | `LoadProblem` |
| `src/loader/loadDefinitions.ts` | interface | `Definitions` |
| `src/locale/Localization.ts` | class | `SlotTexts` |
| `src/locale/Localization.ts` | class | `ObjectTexts` |
| `src/locale/Localization.ts` | class | `LocationTexts` |
| `src/locale/Localization.ts` | interface | `LocaleSections` |
| `src/save/SaveData.ts` | interface | `MapCardPosition` |
| `src/scenario/Scenario.ts` | type | `SlotContents` |
| `src/ui/labels.ts` | interface | `LabelStyle` |
| `src/ui/labels.ts` | interface | `FontScale` |
| `src/ui/labels.ts` | interface | `LabelDefaults` |
| `src/ui/nineSlice.ts` | interface | `SliceSpan` |
| `src/ui/scroll.ts` | interface | `ThumbSpan` |
| `src/ui/scrollArea.ts` | interface | `ScrollReadout` |
| `src/ui/scrollArea.ts` | interface | `ScrollAreaOptions` |
| `src/ui/tap.ts` | interface | `TapHandlers` |

## C. 同じ概念が複数箇所に分かれている

各担当は自分の範囲しか見ないので、ここは親が全インベントリに対して名前で束ねた結果。

### C-1. 同じ名前・同じ値の定数が複数ファイルにある（暗黙に一致すべき規約が2箇所以上にある）

CLAUDE.md の「2箇所が暗黙に一致すべき規約は1箇所へ集める」に直接あたる。

| 名前 | 値 | 現在地 | 所見 |
|---|---|---|---|
| `NO_DESCRIPTION` | `'これについて分かっていることはまだ無い。'` | `src/game/ui/DescriptionPane.ts`, `src/game/ui/StatusDetailWindow.ts` | 同一の**表示文言**が2箇所。`src/locale/` があるのに部品側にある。 |
| `PADDING` | `24` | `src/codex-viewer/networkLayout.ts`, `src/game/ShelfScene.ts`, `src/game/ui/Tooltip.ts` | 3箇所。ただし codex ビューアとゲームは別アプリなので、一致は偶然の可能性がある。 |
| `HOLD_MS` | `400` | `src/game/ui/Button.ts`, `src/ui/holdRepeat.ts` | 汎用部品(`src/ui/`)とゲーム部品の両方に同じ長押し時間。汎用側が持つべき。 |
| `BLINK_DURATION_MS` | `450` | `src/game/ui/ProgressBar.ts`, `src/game/ui/ScreenAlertFrame.ts` | 「警告の点滅」という同一の意匠が2箇所。`BLINK_MIN_ALPHA` も同じ2ファイルに（値は別）。 |
| `ITEM_PADDING_X` | `24` | `src/game/ScenarioSelectScene.ts`, `src/game/SettingsScene.ts` | 一覧シーン2つで同じ寸法。`LIST_PADDING`(`20`) も同じ2ファイル。 |
| `LIST_PADDING` | `20` | `src/game/ScenarioSelectScene.ts`, `src/game/SettingsScene.ts` | 同上。「一覧シーンの寸法」という単位で意匠へ出せる。 |

### C-2. 同じ名前で中身が違う（名前の衝突）

| 名前 | 現在地 | 所見 |
|---|---|---|
| `CardDrop` (interface) | `src/game/ui/CardDragController.ts`（部品）, `src/game/view/cardOperations.ts`（映し） | **別の型が同名**。部品側は「どのレーンからどのレーンへ何枚」、映し側は「吹き出しに出す名前と説明」。層をまたいで同じ名前が別の意味で使われており、読み手が同一視する危険がある。どちらかを改名するか、片方が他方を含むべき。 |
| `messageOf` (function) | `src/game/errorReport.ts`(private), `src/loader/errorMessage.ts`(export) | 同じ「例外から表示文字列を作る」処理が2実装。`src/util/` に1つあれば足りる。 |
| `MINUTES_PER_DAY` (const) | `src/analysis/balanceTables.ts`(`TICKS_PER_DAY * MINUTES_PER_TICK` から導出), `src/game/looks/durationText.ts`(`24 * 60` の直書き) | **1日の長さという世界の事実が、意匠の中で直書きされている。** 世界側の定数から導くべきで、意匠が独自に定義してよい値ではない。 |
| `FILES` (const) | `src/art/backgroundArt.ts`, `iconArt.ts`, `objectArt.ts`, `weatherArt.ts`, `src/loader/loadWorldCodex.ts`, `src/scenario/Scenario.ts` | 6箇所。`src/art/` の4つは「素材の一覧」で同型なので、1つの仕組みに畳める可能性が高い（`ART` も同様に2箇所）。 |
| `place` (function) | `src/domain/generation/SitePlacer.ts`, `src/scenario/Scenario.ts` | 名前が広すぎて、どちらも何を置くのか名前から分からない。 |

### C-3. 色リテラルを意匠の外で抱えている

`src/game/looks/theme.ts` の `COLOR` が配色の一箇所であるにもかかわらず、以下は部品側に色を直書きしている。

| 現在地 | 名前 | 値 |
|---|---|---|
| `src/game/ui/MapWindow.ts` | `CHART_PAPER` | `0xf3ead4` |
| `src/game/ui/MapWindow.ts` | `CHART_LINE` | `0xcdbb92` |
| `src/game/ui/MapWindow.ts` | `ROAD_INK` | `0x8a6f4f` |

（`src/ui/labels.ts` の `defaults.color = 0x000000` は汎用部品の既定値なので対象外。
`src/asset-pack/zip.ts` と `src/domain/generation/Pcg32.ts` の 16進定数は色ではない。）

なお `src/game/ui/` には UPPER_SNAKE の module-level 定数が **228個** あり、`src/game/looks/`（意匠）の
49個を大きく上回る。ただし `docs/engine/Layers.md` は部品が寸法を持つこと自体は禁じていない
（部品が知ってはいけないのは「世界の語彙」）ので、**数の多さそのものは指摘にしない**。
指摘になるのは上の C-1（複数箇所で一致すべきもの）と C-3（色）に絞られる。

### C-4. 表示文言が locale の外にある

`src/locale/` に地域化の仕組みがあるが、日本語文字列を直接抱える module-level 定数が以下にある。

| ディレクトリ | 件数 | 例 |
|---|---|---|
| `src/game/ui` | 7 | `DescriptionPane.NO_DESCRIPTION`, `ObjectWindow.DESCRIPTION_LABEL` / `PROPERTIES_LABEL` / `EXPLORATION_LABEL` / `CANNOT_DO_NOW`, `StatusDetailWindow.NO_DESCRIPTION` / `NO_INFLUENCE` |
| `src/codex-viewer` | 6 | `balancePage.GAPS_SECTION` ほか節見出し（codex ビューアは開発者向けなので対象外の可能性あり） |
| `src/game/view` | 3 | `PlayScreenView.UNNAMED_LOCATION`, `recipeList.LOCKED` / `OTHER` |
| `src/game` | 1 | `PlayScene.ACTIVITY_NAMES` |
| `src/loader` | 3 | `axisVariants.AXIS_VARIANT_SOURCE` ほか（YAML断片であって文言ではない可能性が高い） |

「プレイヤーに見える文言か、開発者向けか」で線を引く必要がある。プレイヤーに見えるものは locale へ。

## D. 非TSファイルの配置

`src/assets/` 配下は `world-codex/`（世界の宣言）・`scenarios/`・`locale/`・画像（`objects/`
`backgrounds/` `icons/` `weather/` `ui/`）に分かれており、**コードとデータの分離として妥当**。
`src/codex-viewer/codex.css` も利用者の隣にあり妥当（判定3）。**非TSファイルの配置に指摘は無い。**

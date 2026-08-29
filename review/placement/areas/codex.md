# codex

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/codex-viewer/CodexSource.ts | 6 | 6 | 0 | 0 | 0 | 0 |
| src/codex-viewer/CodexView.ts | 44 | 21 | 1 | 9 | 10 | 3 |
| src/codex-viewer/balancePage.ts | 32 | 25 | 0 | 3 | 4 | 0 |
| src/codex-viewer/craftingGraph.ts | 14 | 11 | 0 | 0 | 3 | 0 |
| src/codex-viewer/describe/Description.ts | 34 | 30 | 2 | 0 | 2 | 0 |
| src/codex-viewer/describe/codexNames.ts | 1 | 0 | 0 | 0 | 1 | 0 |
| src/codex-viewer/describe/conditionTokens.ts | 15 | 15 | 0 | 0 | 0 | 0 |
| src/codex-viewer/describe/describeEffect.ts | 19 | 19 | 0 | 0 | 0 | 0 |
| src/codex-viewer/describe/describeInteraction.ts | 1 | 0 | 0 | 0 | 1 | 0 |
| src/codex-viewer/describe/describeObjectDef.ts | 6 | 2 | 0 | 2 | 2 | 0 |
| src/codex-viewer/describe/describePassive.ts | 10 | 10 | 0 | 0 | 0 | 0 |
| src/codex-viewer/describe/describeProperty.ts | 4 | 2 | 0 | 0 | 2 | 0 |
| src/codex-viewer/describe/describeRecipe.ts | 3 | 2 | 0 | 0 | 1 | 0 |
| src/codex-viewer/describe/describeRequirement.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/codex-viewer/describe/describeSlot.ts | 3 | 1 | 0 | 0 | 2 | 0 |
| src/codex-viewer/describe/effectQueries.ts | 36 | 33 | 0 | 3 | 0 | 0 |
| src/codex-viewer/describe/stackOrderTokens.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/codex-viewer/describe/typeMatchTokens.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/codex-viewer/main.ts | 15 | 12 | 0 | 1 | 2 | 0 |
| src/codex-viewer/networkLayout.ts | 23 | 22 | 0 | 1 | 0 | 0 |
| src/codex-viewer/networkPage.ts | 20 | 18 | 0 | 2 | 0 | 0 |
| src/codex-viewer/pages.ts | 31 | 28 | 0 | 3 | 0 | 0 |
| **合計** | **321** | **261** | **3** | **24** | **30** | **3** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| `CodexSource` | ゲーム本体と同じローダーで読んだ定義一式を持つ | （なし） |
| `CodexView` | 参照（識別子）を表示名とリンク付きHTMLへ変換する**とともに**、一覧に出す定義を絞り込み、**さらに**ページのURLを組み立てる（責務3つ） | `objectDefs` `objectsWithTag` `objectsWithProperty` `objectsWithSlot` `hasProperty` `objectDef` `tagNames`（定義の索引の話）、`objectHref` `tagHref` `slotHref` `propertyHref`（ルーティングの話）、`locationTypeOf`（generation の逆引きの話） |
| `CodexView.ts`（モジュール直下） | — | `escapeHtml` `EMPTY_HTML` `inlineArtHtml`（HTMLの下ごしらえで、CodexViewとは無関係） |
| `DescriptionToken`/`DescriptionWriter` | 定義が自分を書き表した断片を、行と入れ子として集める | （なし） |
| `DefNames` | グローバルIDを識別子へ戻す | `propertyValue`（IDではなく**値**を、しかも文字列でなくトークンで返す） |
| `describe/*`（describeXxx群） | 定義の宣言を、識別子参照を残したまま読める行へ書き出す | `effectQueries` の3関数・`creates`・`usesInRecipes`（書き出しではなく逆引きの問い） |
| `craftingGraph` | object_def群からクラフトの入力→工程→出力グラフを組む | `countLabel` `countLabelOf`（辺に添える**表示文字列**の話） |
| `balancePage` | 収支ページのHTMLを組み立てる**とともに**、直前の表を覚えてDOMへ配線する | `lastTables` `wireBalanceMenu` `wireImportFilter` |
| `networkPage` | クラフトネットワークのSVGページを組み立てる | `isInCraftingNetwork`（グラフへの所属判定）、`svgText`（汎用のSVGテキスト） |
| `pages` | ルートごとに1ページ分のHTML文字列を返す | `section` `card` `errorPage`（どのページでも使うHTMLの器） |
| `networkLayout` | ノードの寸法と辺だけから階層レイアウトの座標を決める | （なし。ゲームもビューアも知らない純アルゴリズム） |
| `main` | ハッシュを読んでページを描き替え、描いた後のDOMを配線する | `networkZoom`（描き替えを跨いで残す倍率） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| describe/describeObjectDef.ts | `describeObjectDef()` `describeInfluencesOn()` | 所属 | 4 | 型の宣言をそのまま読み上げるだけで、書き出しの相手は `ObjectDef` 自身 | `ObjectDef.describe()` | ドメインが `DescriptionWriter`/`DescriptionToken` を引数に取ると表示の語彙がドメインの契約になる（`tests/architecture/layers.test.ts` の VIEWER_FREE が型輸入も含めて禁止） | |
| describe/describeProperty.ts | `describeProperty()` `initialValueTokens()` | 所属 | 4 | 同上（`PropertyDef` の宣言をそのまま読む） | `PropertyDef.describe()` | 同上 | |
| describe/describeSlot.ts | `describeAccept()` `putInDurationTokens()` | 所属 | 4 | 同上（`SlotDef` の受け入れ条件と所要時間の宣言） | `SlotDef.describe()` | 同上 | |
| describe/describeRecipe.ts | `describeRecipe()` | 所属 | 4 | 同上（`RecipeDef` の工程の並び） | `RecipeDef.describe()` | 同上 | |
| describe/describeInteraction.ts | `describeInteraction()` | 所属 | 4 | 同上（`InteractionDef` のきっかけ→要件→効果） | `InteractionDef.describe()` | 同上 | |
| describe/Description.ts | `DefNames` | 配置 | 4 | IDから識別子へ戻すだけの窓口で、実装できるのは名前空間を持つ `WorldCodex` だけ（doc も「実装は WorldCodex」と書いている） | `src/domain/WorldCodex.ts` | 同居する `propertyValue` が `DescriptionToken` を返すため、この形のままドメインへ置くと表示の語彙が入る | |
| describe/Description.ts#DefNames | `propertyValue()` | 所属 | 4 | 「IDから名前へ戻す係」に値の書き表しが混ざっている。返り値だけトークン | `Description.ts` の値専用の窓口 or `DescriptionToken` の 'value' 種別 | describe群には codex を渡さず `DefNames` 1つだけを渡す取り決めを守るため、シンボル型かの判定を持てる口がここしかない | ✓ |
| describe/codexNames.ts | `defNamesOf()` | 配置 | 4 | `codex.objectNames.getName` 等をそのまま束ねるだけの薄い実装 | `WorldCodex`（自分の名前空間を DefNames として差し出す） | `propertyValue` が表示の語彙を返す（コメントに明記されている通り） | |
| describe/Description.ts | `DescriptionLine.toPlainText()` `DescriptionWriter.toPlainText()` | 可視性 | 2 | 呼び手はテストのみ。表示に使わない出口だが、比較のためにプログラム上は要る | （現状維持） | | |
| describe/effectQueries.ts | `writesToProperty()` `passiveWritesToProperty()` `spawnsObject()` | 配置 | 3 | 説明を作らない逆引きの問いが `describe/` に同居している。主な呼び手が隣の `describeObjectDef` なので置かれている | `src/codex-viewer/queries/` へ分離、または `EffectDeclaration` 側の問い | | |
| describe/describeObjectDef.ts | `creates()` `usesInRecipes()` | 配置 | 3 | 同上（真偽値を返す述語で、書き出しではない）。呼び手は `pages.ts` | 同上 | | `creates` |
| CodexView.ts#CodexView | `objectDefs()` `objectsWithTag()` `objectsWithProperty()` `objectsWithSlot()` `objectDef()` `tagNames()` `hasProperty()` | 所属 | 4 | 「見せ方だけを担う」と宣言したクラスに、定義の索引が7つ入っている。`objectsWithTag` は `WorldCodex.objectDefNamesWithTag` とほぼ同じ問い | `CodexIndex`（新設。`CodexSource` の隣） | `objectDefs` の除外規則（生成型・製作中オブジェクトを一覧に出さない）はビューアの一覧方針なので、ドメイン側の同種クエリに寄せると方針がドメインの契約になる | `objectDefs` |
| CodexView.ts#CodexView | `objectDisplayName()` `objectDescription()` `locationTypeOf()` | 所属 | 4 | 土地の型は表示名・説明を `location_texts` が持つ、という**ことばの規則**をビューアが実装している。`locationTypeOf` は `generation.locationTypes` の逆引きそのもの | `src/locale/typeDisplayName.ts` の隣（codex を受け取る表示名モジュール） | `Localization` を純粋な対応表のまま保つため（この規則を入れると Localization が `WorldCodex`/`generation` を知る） | |
| CodexView.ts | `escapeHtml()` `EMPTY_HTML` `inlineArtHtml()` | 配置 | 5 | どれも `CodexView` と無関係なHTMLの下ごしらえで、4ファイルが `./CodexView` から輸入している | `src/codex-viewer/html.ts`（新設） | | |
| CodexView.ts#CodexView | `objectHref()` `tagHref()` `slotHref()` `propertyHref()` | 所属 | 3 | URLの語彙を組み立てるのはここ、解釈するのは `main.ts` の `renderRoute`——一致すべき規約が2箇所に割れている | `routes.ts`（組み立てと解釈を1箇所に） | | |
| CodexView.ts#CodexView | `symbolLabel()` `signalLabel()` `tagLabel()` `tokenHtml()` | 可視性 | 3 | クラス外から呼ばれていない public。`tagLabel` は名前に反して対応表を引かず識別子を返す | `private` へ | | `tagLabel` |
| CodexView.ts#CodexView | `isUntranslated()` | 所属 | 3 | `identifier === displayName` の比較だけで `this` を使わない。呼び手は `pages.ts` の1箇所 | `pages.ts` の `untranslatedBadge` 内 | | |
| CodexView.ts#CodexView | `defNames` | — | 2 | 概念的には要らないが、`defNamesOf` の作り直しを避けるメモ化として要る | （現状維持） | | |
| craftingGraph.ts | `buildCraftingNetwork()` | 配置 | 4 | 定義から構造を導く関数で、`src/analysis` の `craftingSteps` を読んでいる。呼び手はビューアだがテストは `tests/analysis/` にある | `src/analysis/craftingNetwork.ts`（型3つも一緒に） | 辺が `countLabel`（表示文字列）を持つため、解析へ移すと解析が表示の語彙を持つ | |
| craftingGraph.ts#NetworkEdge | `countLabel` | 所属 | 4 | 辺のデータに描画用の文字列（「×2」）が混ざっている | `networkPage.ts` の `edgeHtml` 側で組み立てる | 辺に生の個数（`counts`）を持たせず文字列に畳んでいるため、描画側で作るには個数の公開が要る | |
| craftingGraph.ts | `countLabelOf()` | 所属 | 4 | 上と同じ理由でここに居る書式化 | `networkPage.ts` | 同上 | |
| balancePage.ts | `lastTables` | 所属 | 4 | ページ描画とDOM配線の間を、モジュール変数が繋いでいる | `BalancePage` クラス（描いた表と配線を1つのインスタンスが持つ） | `renderXxx` が文字列だけを返しDOMを持たない設計を守るため、描いた結果の置き場がモジュール変数しかない | |
| balancePage.ts | `wireBalanceMenu()` `wireImportFilter()` | 配置 | 4 | 「DOMには触らず文字列を返すだけ」というページ側の取り決めに反する2つ。配線は `main.ts` にも同種のものがある | `main.ts` の配線群、または `BalancePage` | `lastTables` を要するため `main.ts` へ出せない（`main.ts` は表を持たない） | |
| balancePage.ts | `SAMPLE_CHARACTER` | 所属 | 4 | 「誰の1日で測るか」という世界の設定値が、ページのモジュール定数になっている（`tests/support` にも同名の定数、`PlayScene` にも `SCENARIO_CHARACTER` として同じ値がある） | 世界定義側の宣言（代表キャラクタのタグ）または `src/analysis` の既定値 | 解析は近似の前提を自分で決めない（`buildBalanceTables` が引数で要求する）ため、呼び手のこちらが持つしかない | |
| balancePage.ts | `tableHtml()` `formatNumber()` `signed()` | 配置 | 3 | 収支と無関係な汎用の表組み・数値整形。利用者がこのファイルだけなので置かれている | `html.ts` / `src/util` | | |
| main.ts | `networkZoom` `wireNetworkZoom()` | 所属 | 4 | ネットワーク図の倍率という1ページの状態を、入口のモジュール変数が持っている | （なし。末尾の節参照） | `render()` が毎回 `innerHTML` を作り直すため、ページ側に状態を置くと描き替えで消える | |
| main.ts | `wireObjectFilter()` | 配置 | 3 | 一覧ページの配線だけが入口にあり、収支ページの配線は `balancePage.ts` にある——同じ種類のものが2箇所に割れている | `pages.ts` 側へ寄せる（または全配線を `main.ts` へ） | | |
| networkPage.ts | `isInCraftingNetwork()` | 配置 | 3 | グラフへの所属判定であってページの組み立てではない。呼び手（`pages.ts`）が近いだけで、ネットワーク全体を組み直して1件を調べている | `craftingGraph.ts` | | |
| networkPage.ts | `svgText()` | 配置 | 3 | 文字幅を見積もって縮める汎用のSVGテキスト。ネットワーク図と関係がない | `html.ts` | | |
| pages.ts | `section()` `card()` `errorPage()` | 配置 | 3 | どのページでも使うHTMLの器。`balancePage`・`networkPage` は同じ器を自前で書いている | `html.ts` | | |
| networkLayout.ts | `layoutLayered()` | 配置 | 3 | ゲームもビューアも知らない純アルゴリズム（依存ゼロ）。唯一の利用者が隣に居るのでここに在る | `src/util/layoutLayered.ts` | | |

## 移動先が書けなかったもの

- `main.ts` の `networkZoom`／`wireNetworkZoom`（判定4）。倍率は「ネットワークページの状態」だが、
  このビューアには**ページを表すオブジェクトが無い**（ページは `render(view) => string` の関数だけ）。
  描き替えを跨いで残る状態の置き場がモジュール変数しか無いのは、`balancePage.lastTables` と同じ症状で、
  欠けている概念は「**描き替えを跨いで生き残るページのインスタンス**」1つ。これが在れば、
  `lastTables`・`networkZoom`・配線関数・`wireObjectFilter` の置き場が同時に決まる。

## ファイル配置（層=配置）についての所見

- `src/codex-viewer/` は `docs/CodeStructure.md` 1節の在処の表に**載っていない**。
  層の外の道具（`src/save/` などと同列）として扱うなら、表に1行足すのが筋。境界は
  `tests/architecture/layers.test.ts` の VIEWER_FREE だけが見張っている状態。
- 逆向きの参照は無い。`src/game/`・`src/analysis/`・`src/domain/` から `src/codex-viewer/` への
  import は1件も無く（`grep` で確認）、ビューア側からの参照も `domain`／`locale`／`art`／`analysis`／
  `loader` への一方通行。ただし **`describe/` はテストからビューア外の用途で使われている**
  （`tests/world-codex/`・`tests/loader/`・`tests/asset-pack/` が `DescriptionWriter` と
  `describeInteraction` などを輸入）。「宣言を読める形にする」道具は、実質ビューア専用ではない。
- `describe/` の中身は3種類に割れている。(a) ドメインの読み上げ口越しに書き出すもの
  （`describeEffect`・`describePassive`・`conditionTokens`・`typeMatchTokens`・`stackOrderTokens`）は、
  木を外へ出さないというドメインの設計の必然でここに在る（判定1）。(b) 定義の公開フィールドを
  そのまま読むだけのもの（`describeObjectDef`・`describeProperty`・`describeSlot`・`describeRecipe`・
  `describeInteraction`）は、定義自身が持つのが自然で、止めているのは層のテスト1つ（判定4）。
  (c) 説明を作らない逆引き（`effectQueries`・`creates`・`usesInRecipes`）は、そもそも `describe/` の
  住人ではない（判定3）。
- コメントの参照先が現実から3箇所ずれている。`Description.ts` の `DefNames` は「実装は
  [`WorldCodex`](./WorldCodex.ts)」、`DescriptionWriter` は「`describe`を持つ定義は…」、
  `CodexView` の冒頭は「定義自身（`describe`、domain/Description.ts）が知っている」——いずれも
  **describe がドメインに在った頃の記述**で、現在は定義に `describe` は無く、実装は
  `codex-viewer/describe/codexNames.ts` にある。判定4群がどこから来たかの証跡でもある。
- `CodexView.ts`（356行）と `pages.ts`（526行）は、名前が示すもの以外を抱えている。前者は
  HTMLエスケープ・空表示の定数・絵の埋め込み、後者はページ共通の器。`html.ts` を1つ作れば
  両方から剥がれ、`balancePage`・`networkPage` の自前の器も寄せられる。

# 棚卸しで決着した宣言

[宣言の棚卸し](./README.md)で**今のままでよいと決めた宣言**の一覧。**次の回が除外する材料はここ**
——日付のフォルダは当時の答えで書き換えないので、決着だけをここへ移す（`README.md` 5節）。

**この一覧は、次の回が採点する一覧そのものへ載る。** `node scripts/declarationInventory.mjs` が
ここに在る宣言へ `決着済み(<問い>)` を付ける（`--json` では `settled`）ので、**渡し忘れが起きない。**

- **節は問いごと**（`README.md` 2節）。決着はその問いの中でだけ効く——名前で決着した宣言も、置き場の
  問いでは新しく挙がりうる。節の見出しがそのまま印の中身になるので、問いを短く名乗る。
- **1行に並べてよいのは、同じ理由で決着した宣言だけ。** 書き方は `` `<ファイル>` の `<名前>` `` で、
  同じファイルの複数件は `・` で続ける。
- **覆すときは行を落とす。** なぜ覆したかは、その回の記録（日付のフォルダ）が持つ。
- **同じ宣言が2行に現れたら、決着が渡らないまま再び挙がったということ。**
  [`tests/docs/reviewSettled.test.ts`](../tests/docs/reviewSettled.test.ts) が、それと、行が指す宣言が
  消えたこと（改名・削除）を落とす。

## 名前

**名前が責務を言い切っているか**（`README.md` 2.2節）の問いで、Aとして決着したもの。

| 宣言 | 今の名前でよいと決めた理由 | 出どころ |
| ---- | -------------------------- | -------- |
| `src/codex-viewer/describe/Description.ts` の `text` | `〜Ref` は世界の宣言名を指す参照の印で、これは参照ではない（引数はそのまま出す文字列）。suffix の有無がその差を言っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/codex-viewer/balancePage.ts` の `signed`・`formatNumber` | `Description.ts` の `signedNumber` とは答えている問いが違う（宣言に書かれた増減を素で出す／集計した実数を桁を決めて出す）。統合すると表示が変わる | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/domain/ObjectDef.ts` の `visibleSlotGlobalIds` | 並びが宣言順のまま意味を持つ宣言は同じクラスに並んでおり（`recipesProducingThis`・`variants`）、順序を名前へ出す規約がこのリポジトリに無い | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/domain/PropertyDef.ts` の `PropertyStage.eq` | 宣言の語そのままで（`GameElementDefinition.md` 6.4節の `stages` の `eq`）、`min` と対。doc が戒めている誤用は「シンボル型かを訊く口はどれか」の話で、改名では消えない | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/domain/LocalIndexByGlobalId.ts` の `missing` | 呼び形が `local === LocalIndexByGlobalId.missing` の1つだけで、そこでは述語に読める | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/asset-pack/zip.ts` の `ZipEntry.method` | ZIP仕様側の語。仕様に合わせるほうが読み手には近い | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/loader/WorldCodexYamlLoader.ts` の `engine` | 返すのは `EngineVocabulary` で、`WorldVocabulary` の同じ語と揃っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/domain/WorldVocabulary.ts` の `destinationIdId`・`returnPathIdId` | クラス全体が `<プロパティ名>Id` の規約で、`destination_id` というYAML側の名前がそのまま出ているだけ。ここだけ外すと、どのプロパティのIDかが読めなくなる | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/analysis/balanceTables.ts` の `Acquisition.islandWide` | private で、型が `Acquisition` を言っている。クラス名を足すと同語反復になる | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/locale/uiTexts.ts` の `source` | モジュールが持つ唯一の出どころで、モジュール名と型（`Localization`）が何の出どころかを言っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/codex-viewer/main.ts` の `source` | 同上（型は `CodexSource`） | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/game/view/cardMotionPlan.ts` の `MotionInput.left` | 作る側の `LaneUpdate` の `entered`・`left` と対で、片方だけ動かすと組が割れる。`vanished` との層の違いは型が言っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/game/view/ShownCards.ts` の `firstOf` | 返るのが要素ではなく束であることは戻り値の型（`ObjectCardStack`）が言っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/game/view/statusRows.ts` の `groupOf` | 呼び形が比較関数の中の `groupOf(a) - groupOf(b)` だけで、そこでは順序として読める | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) || `src/game/ui/Card.ts` の `CellOverlay` | `CellHighlight` と対で、`CardView.md` 11節の層の名前として揃っている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/game/ui/CardDragController.ts` の `begin` | `end`・`update`・`cancel` と揃った語彙で、ジェスチャの記録自体はここで始まっている | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |
| `src/game/looks/PlayScreenLayout.ts` の `DASHBOARD_MIN_HEIGHT_PORTRAIT` | 縦型にもダッシュボードは在り、定数が足しているものも縦型のダッシュボードの中身と一致する（無いのは「列」のほうで、そう書いていたコメントを落とした） | [#2191](https://github.com/gooyyu1/UnmappedIsland/pull/2191) |

# analysis・codex-viewer・locale・save 他 全1,086件

対象: `src/analysis`・`src/codex-viewer`・`src/codex-viewer/describe`・`src/locale`・`src/save` の全宣言と、
`src/loader`・`src/scenario`・`src/art`・`src/asset-pack`・`src/util` のコメント付き宣言（`kind: ctor` を除く）。

A（名前をなぞるだけ）: 1,051件 / B: 34件 / C: 1件

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `analysis/rangeEvents.ts` | `RangeEventReadout::returnedToSelf` | C | そのイベントが自分の値へ戻す**期待量**（確率で重み付けした和） | 型が `number` なのに過去分詞の名前で、隣の `destroysSelf: boolean` と並ぶため真偽値に読める。コメントも「returnedToSelfが**正なら**」と書いており、名前だけでは量だと分からない | `expectedReturnToSelf` |
| `analysis/balanceTables.ts` | `(モジュール)::ancestorContext` | B | 「置かれている土地が宣言している値」を答える `StaticValueResolver` を作る | 何を返すのか（値の解決器）も、答えるのが祖先の**宣言値**であることも `Context` からは出てこない | `ancestorValueResolver` |
| `analysis/balanceTables.ts` | `(モジュール)::bestAncestorContext` | B | 全土地のうち**最も高く宣言している値**を答える解決器を作る | `best` が何について最良か（最大値を採る想定）が読めない | `highestDeclaredAncestorValueResolver` |
| `analysis/balanceTables.ts` | `Acquisition::relax` | B | 全工程を走査して入手時間を下げるのを、**変化が止まるまで**繰り返す | 最短路の緩和という語の借用で、何を下げるのか・収束まで回すのかが名前に無い | `lowerCostsUntilStable` |
| `analysis/balanceTables.ts` | `Acquisition::importable` | B | 入力1件を**他の土地から持ち込んだ場合**の型と値段を返す（島全体の文脈では undefined） | 形容詞の名前だが返るのは可否ではなく `{objectGlobalId, cost}` | `importedInputCost` |
| `analysis/balanceTables.ts` | `(モジュール)::lifetimeOf` | B | **置いておくだけで**朽ちるまでの時間。外から押されて消える周期（焼き上がり・失血死）は数えない | 「寿命」に何を含めないかが名前に無い。含めるつもりの呼び手が黙って違う数字を得る | `decayLifetimeOf` |
| `analysis/balanceTables.ts` | `PropertyRoute::deviceCount` | B | 1日ぶんを賄うのに**同時に**要る設備の数 | 「同時に」が抜けており、延べ数・所有数と読める | `simultaneousDeviceCount` |
| `analysis/balanceTables.ts` | `SupplyRow::unresolved` | B | 所要時間か分岐の重みが、定義だけでは確定しない工程か | 何が未解決なのかが無い。同じ意味の兄弟が `CraftingStep::hasUnresolvedReferences` と名乗っているのに揃っていない | `hasUnresolvedReferences` |
| `analysis/craftingSteps.ts` | `(モジュール)::selfMovesOf` | B | 1つの分岐の後、自分の各プロパティが**いくつになるか**（プロパティID → 動いた先の値） | 返るのが差分ではなく**行き先の値**であること。`moves` は move 効果とも読める | `selfPropertyValuesAfterOf` |
| `analysis/staticValue.ts` | `TrackingResolver::unresolved` | B | そこまでに解けない参照へ当たったか | 「この解決器が未解決」と読める。実際は「解けない参照に当たった記録」 | `hitUnresolvedReference` |
| `art/backgroundArt.ts` | `(モジュール)::ART` | B | パックのぶんを重ねられる**可変**の在庫表（公開する `BACKGROUND_ART` はこれの読み取り専用の別名） | 同じモジュールに `BACKGROUND_ART` があり、両者の違い（可変か否か）が名前で分かれていない | `MUTABLE_BACKGROUND_ART` |
| `art/objectArt.ts` | `(モジュール)::ART` | B | 同上（公開名は `ART_BY_OBJECT_NAME`） | 同上。鍵が object_def 識別子である点も公開名だけが言っている | `MUTABLE_ART_BY_OBJECT_NAME` |
| `asset-pack/install.ts` | `(モジュール)::assetPackMatches` | B | 実際に入っているかが、**設定の言う通りか** | 何と突き合わせるのかが無い。引数が `loadsAssetPack: boolean` なので、呼び出し式を見ないと意味が取れない | `assetPackInstallMatchesSetting` |
| `codex-viewer/CodexView.ts` | `CodexView::label` | B | `namingMode` に従って、識別子と表示名のどちらを出すかを選ぶ | 選択そのものが責務であること。公開の `objectLabel`/`slotLabel` 群と同じ語なので同類の引き当てに見える | `identifierOrDisplayName` |
| `codex-viewer/balancePage.ts` | `(モジュール)::methodHtml` | B | 「計測方法」（tickの長さ・按分しない理由など）の折りたたみを描く | `method` がメソッドとも読め、何の方法かが無い | `measurementMethodHtml` |
| `codex-viewer/balancePage.ts` | `(モジュール)::indexHtml` | B | 場所ごとの節へ飛ぶチップの並び（目次）を描く | `index` が索引・添字・index.html のどれとも読める | `placeIndexHtml` |
| `codex-viewer/pages.ts` | `(モジュール)::card` | B | 見出しと中身を `div.card` へ包んだHTML | 同ファイルの兄弟20件超が `objectCardHtml`・`artHtml` のように `Html` で終わるのに揃っていない | `cardHtml` |
| `codex-viewer/pages.ts` | `(モジュール)::section` | B | 節のHTML。**中身が空（または`（なし）`）なら見出しごと空文字を返す** | `Html` が無いことに加え、空を返しうるという契約が名前に無い | `sectionHtmlOrEmpty` |
| `codex-viewer/pages.ts` | `(モジュール)::variantsSection` | B | 土地の型の亜種の節のHTML（亜種が無ければ空文字） | 同上（`tagSectionHtml` と同じ形なのに接尾辞が無い） | `variantsSectionHtml` |
| `codex-viewer/pages.ts` | `(モジュール)::untranslatedBadge` | B | 未翻訳のときだけ出す印のHTML（それ以外は空文字） | 同上 | `untranslatedBadgeHtml` |
| `codex-viewer/pages.ts` | `(モジュール)::headingIdentifier` | B | 見出しの脇へ添える識別子のHTML（見出しと同じなら空文字） | 同上 | `headingIdentifierHtml` |
| `codex-viewer/pages.ts` | `(モジュール)::identifierLine` | B | 見出しの下の識別子の行のHTML（出すものが無ければ空文字） | 同上 | `identifierLineHtml` |
| `codex-viewer/describe/effectQueries.ts` | `(モジュール)::Finder` | B | **どの動詞も無視する** `EffectReader` の既定実装。具象は要る受け口だけ上書きする | 名前は「探す物」だが、このクラス自身は何も探さない。`found` を持つだけの空実装であることが読めない | `IgnoringEffectReader` |
| `codex-viewer/describe/effectQueries.ts` | `PropertyWriterFinder::check` | B | その書き込みが探しているプロパティに当たれば `found` を立てる | 何を調べるのかも、真偽を**返さず状態を書き換える**ことも読めない | `markIfWritesToWantedProperty` |
| `codex-viewer/describe/effectQueries.ts` | `PassivePropertyWriterFinder::check` | B | 同上（持続効果版） | 同上 | `markIfWritesToWantedProperty` |
| `loader/parseCommon.ts` | `(モジュール)::built` | B | `build` の中で投げられた誤りへ、**YAML上のどこか**を添えて投げ直す | 呼び出し（`built('世界全体', () => new WorldCodex(...))`）の見た目が「組み立てる」だけで、値打ちである文脈付与が名前に無い | `withYamlContext` |
| `loader/parsePassives.ts` | `(モジュール)::parsePassive` | B | 1ブロックを読み、`passives` 配列へ**追記する** | 追記が名前に無い。兄弟の `parsePassiveOperationInto` は `Into` で言っている | `parsePassiveInto` |
| `loader/parseProperties.ts` | `(モジュール)::parseStage` | B | 段1つを読んで返し、**併せて `passives` へ追記する** | 戻り値のほかに配列へ書き足すことが名前に無い | `parseStageAppendingPassives` |
| `loader/parseProperties.ts` | `(モジュール)::parseProp` | B | props の1エントリを読んで返し、**併せて `passives` へ追記する** | 同上 | `parsePropAppendingPassives` |
| `loader/RawPatch.ts` | `(モジュール)::matches` | B | `where` の当てはめ。**書いたキーだけを見る部分一致**（配列だけは並びと個数まで一致を求める） | 部分一致であることが読めない。完全一致と思って書いた patch が黙って別の要素に当たる | `matchesWhere` |
| `loader/RawDeclarationBody.ts` | `RawDeclarationBody::read` | B | 宣言から各フィールドを取り直す | 責務が `RawObjectDef::readFields` と同一（コメントの文言まで同じ）なのに名前が揃っていない | `readFields` |
| `loader/WorldCodexYamlLoader.ts` | `WorldCodexYamlLoader::build` | B | WorldCodexを組み立てて返し、**このインスタンスの蓄積状態を初期化する** | 呼ぶと積んだ定義が消えることが名前に無い。2度目の `build` が空の世界を返す | `buildAndReset` |
| `locale/Localization.ts` | `(モジュール)::merged` | B | 2つの節を重ねる。**同じ識別子が両方にあればエラー** | 後勝ちでも先勝ちでもなくエラーにするという要点が名前に無い | `mergedRejectingDuplicates` |
| `save/newGameInput.ts` | `(モジュール)::normalizeIslandName` | B | 前後の空白を落とし、**長さが範囲外なら undefined**（受理判定を兼ねる） | 弾くことがあるのが読めない。`normalize` だけなら必ず文字列が返ると読む | `normalizedIslandNameOrUndefined` |
| `save/Shelf.ts` | `Shelf::add` | B | 棚へ収め、**実際に新しく収まった識別子を返す** | 戻り値があること自体が読めない（`readonly string[]` を返す `add`） | `addReturningNewlyAdded` |

## 判定を保留したもの

| 現在地 | 名前 | 迷った理由 |
| ------ | ---- | ---------- |
| `codex-viewer/describe/Description.ts` | `(モジュール)::text` | 断片を作る兄弟が `objectRef`・`slotRef`・`tagRef` と `〜Ref` で揃っているなか、これだけ `text`。単独で `textToken` へ変えると不揃いになり、揃えるなら `objectRefToken` まで含めた一括改名の話になる |
| `analysis/balanceTables.ts` | `Acquisition::islandWide` | 形容詞の名前で `Acquisition \| undefined` を持つ。`islandWideAcquisition` のほうが読めるが、クラス内で「島全体の自分」を指す語として通っており誤読の実害が見えない |
| `loader/RawDeclarationBody.ts` | `(モジュール)::onlyDeclaration` | コメントの一言は「自分が指定していないフィールドを trait から引き継ぐ」で、名前は「唯一の宣言」。シグネチャ（候補列 → `T \| undefined`）を見れば名前どおりでもあり、Bと言い切れなかった |
| `locale/uiTexts.ts`・`codex-viewer/main.ts` | `(モジュール)::source` | どちらもモジュール内の可変な保持先。漠然としているが、モジュール名と併せれば読める範囲 |
| `codex-viewer/balancePage.ts` | `(モジュール)::signed`・`formatNumber` | `signed` は戻り値が文字列である点が名前に無いが、`describe/Description.ts` の `signedNumber` と重複気味で、揃えるならそちらとの統合が先 |

## 見方のメモ

- `analysis/` は宣言の8割が「表の1行・1列」を表すフィールドで、コメントが長い代わりに**名前は短くて足りている**ものが多い（`craftMinutes`・`exploreMinutes`・`perDay` など）。B・Cが集中したのは、**含めないもの**を決めている宣言（`lifetimeOf`・`deviceCount`・`unresolved`）。
- `codex-viewer/pages.ts` と `balancePage.ts` は `〜Html` で揃った語彙が既にあり、そこから外れた6件がそのままBになった。**新しい規則を作る必要は無く、既にある兄弟へ寄せるだけ**で済む。
- `describe/` の `Describer` 系と `locale/` はほぼ全件A。読み手インタフェースの受け口名（`add`・`spawn`・`pick` など）はインタフェース側の語彙をそのまま実装しており、単独で改名する対象ではないためAとした。

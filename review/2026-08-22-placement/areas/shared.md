# shared

対象: `src/locale/` `src/ui/` `src/art/` `src/util/` — 24ファイル / 248宣言。

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/art/artFiles.ts | 7 | 6 | 0 | 0 | 1 | 0 |
| src/art/backgroundArt.ts | 14 | 8 | 2 | 3 | 1 | 0 |
| src/art/iconArt.ts | 5 | 3 | 0 | 1 | 1 | 0 |
| src/art/informationArt.ts | 5 | 2 | 0 | 0 | 3 | 0 |
| src/art/objectArt.ts | 9 | 5 | 3 | 1 | 0 | 0 |
| src/art/packArt.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/art/separatorArt.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/art/weatherArt.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/locale/Localization.ts | 99 | 87 | 1 | 2 | 8 | 1 |
| src/locale/typeDisplayName.ts | 1 | 0 | 0 | 0 | 1 | 0 |
| src/ui/Rect.ts | 5 | 5 | 0 | 0 | 0 | 0 |
| src/ui/clip.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/ui/holdRepeat.ts | 12 | 10 | 0 | 1 | 1 | 0 |
| src/ui/labels.ts | 12 | 9 | 3 | 0 | 0 | 0 |
| src/ui/lifetime.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/ui/nineSlice.ts | 7 | 4 | 0 | 2 | 1 | 0 |
| src/ui/scroll.ts | 8 | 8 | 0 | 0 | 0 | 0 |
| src/ui/scrollArea.ts | 27 | 26 | 1 | 0 | 0 | 0 |
| src/ui/shapes.ts | 18 | 13 | 0 | 3 | 2 | 0 |
| src/ui/tap.ts | 5 | 5 | 0 | 0 | 0 | 0 |
| src/ui/textLayout.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| src/util/arrays.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/util/cssColor.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/util/int32.ts | 2 | 2 | 0 | 0 | 0 | 0 |
| **合計** | **248** | **205** | **10** | **13** | **19** | **1** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| Localization | 識別子から表示文字列を引く。 | `locationName`（LocationNameを1つの名前へ組み立てる＝合成であって引き当てではない）、`mergedWith`（読み込み時にパックを重ねる話） |
| Localization.ts（モジュール） | **表示文字列を引く**「と」**localeのYAMLを読む**——接続詞で繋がる。631行の後半112行（`parseLocale`）＋`parseEntry`/`parseVariationNames`/`parseTexts`/`LocaleSections`/`loadLocalization`/`bundledLocaleText`/`LOCALE_FILE`/`LOCALE_TEXTS`/`LANGUAGE` が後半の責務。 | 上記9宣言（引く側とは読み手が別） |
| Texts / SlotTexts / ObjectTexts / LocationTexts | 1つの対象の表示文字列を、宣言が無ければ識別子へ落として答える。 | （漏れなし） |
| typeDisplayName | 生成型の表示名を、素の型の名前へ軸ごとの書式を畳んで組み立てる。 | モジュールごと `Localization` の同種処理（`locationName`）と別居している |
| backgroundArt | ファイル名の規約から、そのスロットの背景の絵を答える。 | `SlotRef`（絵の話ではなく「どのカードが何を映しているか」の語彙） |
| artFiles | 絵を、起動時に読む分と土地ごとに遅らせる分へ分ける。 | `locationDefNames`（WorldCodex を引数に取り `'location'` タグを判定する＝ワールドへの問い合わせ） |
| iconArt | ファイル名の規約から、アイコンの絵を答える。 | `ICON_NAMES`（このゲームの画面にどのボタンが在るかの一覧） |
| informationArt | 情報エリアの背景画像を1枚登録する。 | `INFORMATION_BORDER_PX` / `INFORMATION_OVERLAP_PX` / `INFORMATION_PAPER_INSET`（寸法＝意匠） |
| objectArt | object_defの識別子から絵とテクスチャキーを答える。 | （`CARD_ART_WIDTH` は絵の基準幅なので漏れない） |
| ui/shapes | 角丸矩形・敷き詰め・背景板をPhaserへ描く。 | `SHADOW_LAYERS` / `DASH_LENGTH_RATIO`（濃さ・破線長＝意匠の値） |
| ui/holdRepeat | 押し続けている間、加速しながら1つずつ繰り返す。 | `REPEAT_MIN_MS` の**公開**（外は最高速度を知る必要が無い） |
| ui/scrollArea, ui/scroll | 渡された表示物の位置だけを、ドラッグとホイールで送る。 | （漏れなし。Phaser抜きの算術を`scroll.ts`へ分ける形は CodeStructure.md 2節の方針どおり） |
| ui/labels, ui/textLayout, ui/tap, ui/clip, ui/lifetime, ui/nineSlice, ui/Rect | Phaserの足りない分・間違っている分を埋める。 | （漏れなし） |
| util/* | 型・言語レベルの変換と操作。 | （漏れなし） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/locale/Localization.ts | `parseLocale()`, `parseEntry()`, `parseVariationNames()`, `parseTexts()` | 配置 | 4 | YAMLを読むのは `src/loader/` の仕事で、引く側と読み手が別（CodeStructure.md 1節）。 | `src/locale/parseLocale.ts` | 組み立て先の `DeclaredTexts`・`ObjectTextsEntry`・`SlotTextsEntry`・`LocationTextsEntry` がモジュール内に閉じており、別ファイルへ出すと4つとも export することになる | |
| src/locale/Localization.ts | `LocaleSections` | 可視性 | 5 | export されているが、メンバーの型（`ObjectTextsEntry` ほか）が非公開なので**外からは1つも作れない**。他ファイルからの参照も無い。 | `export` を外す | | |
| src/locale/Localization.ts | `LOCALE_FILE`, `bundledLocaleText()` | 可視性 | 4 | src 内の利用者は同ファイルの `loadLocalization` だけで、export の実利用者は `tests/world-codex/bundledLocale.test.ts` のみ。 | `loadLocalization` の内部へ畳む | 同梱YAMLの中身と、エラーメッセージに出る出所ラベルを、テストが本番と同じ組で読み直すため | |
| src/locale/Localization.ts#Localization | `locationName(name: LocationName)` | 所属 | 4 | 「引く」ではなく「組み立てる」——`LocationName`（型・亜種・通し番号）の構造を知っており、そのために `src/domain/generation/IslandMap` を import している。 | `typeDisplayName` と同じ場所（`src/locale/displayNames.ts`） | `ordinalSuffix` と亜種の解決順を公開せずに済ませるため | |
| src/locale/typeDisplayName.ts | `typeDisplayName()` | 所属 | 4 | `locationName` と**同じ形の名前組み立て**なのに、片方はクラス内・片方はモジュール外に居る。 | `Localization`、または `locationName` と同居 | `Localization` が `WorldCodex`（世界）を知らずに済ませるため。ただし `LocationName` は既に import しており、この線は一貫していない | |
| src/locale/Localization.ts#Localization | `mergedWith(other, label)` | 所属 | 4 | パックを重ねるのは読み込み時の話で、引く側の責務ではない。 | `loadLocalization` | 10個の節フィールドがすべて private で、外から重ねるには全部を公開しなければならない | |
| src/locale/Localization.ts#Localization | `static empty()` | 可視性 | 2 | 「テスト用」と書かれているが、`parseLocale` が空YAMLの戻り値として本番でも使う。 | (現状維持。コメントが実態と食い違う) | | ✔ |
| src/locale/Localization.ts | `loadLocalization()` | 配置 | 3 | 読み込みの入口。引く側（`Localization`）とは責務が別だが、`parseLocale` の隣に居る。 | `src/locale/parseLocale.ts` | | |
| src/locale/Localization.ts | `format()` | 所属 | 3 | 汎用の `{name}` 差し込み。`SlotTexts` と `ObjectTexts` からしか呼ばれない。 | `src/util/format.ts`（後述の所見参照） | | |
| src/art/informationArt.ts | `INFORMATION_BORDER_PX`, `INFORMATION_OVERLAP_PX` | 配置 | 4 | 素材は「どのファイルがどの絵か」を答える場所で、px の寸法は意匠（CodeStructure.md 1節・3節）。 | `src/game/looks/PlayScreenLayout.ts` | 絵を切り出す道具（`recipes/information_background.json` の crop / fade）が従うべき寸法そのもので、絵の登録と同じ場所に置くことで一致を保っている | |
| src/art/informationArt.ts | `INFORMATION_PAPER_INSET` | 配置 | 4 | `edge: 24` は「表紙の縁に載らない程度の余白」＝絵から測れないレイアウト値。読むのは `PlayScreenLayout` と `theme.ts` だけ。 | `src/game/looks/PlayScreenLayout.ts` | `field` が絵の縁（BORDER−OVERLAP）から導かれるため、1つのオブジェクトに「絵の寸法」と「純粋な余白」が同居し、`edge` まで素材側へ引き寄せられている | |
| src/art/iconArt.ts | `ICON_NAMES` | 所属 | 4 | このゲームの画面にどのボタンが在るかの一覧（`filter_cook`・`diary` など）。「どのファイルがどの絵か」ではない。src 内に他の参照は無く、実利用者はテストのみ。 | `src/game/ui/`（ボタンを並べる側） | 絵が実在するかを Phaser 抜きで検査する（`tests/art/iconArt.test.ts`）には、名前の一覧が在庫表（`ICON_ART`）と同じ場所に要る | |
| src/art/iconArt.ts | `IconName` | 所属 | 3 | `ICON_NAMES` から導く型。`ICON_NAMES` が動けば一緒に動く。 | 同上 | | |
| src/art/artFiles.ts | `locationDefNames(codex)` | 所属 | 4 | 素材のモジュールが `WorldCodex` を引数に取り、`'location'` タグというワールドの語彙で絞り込む。しかも名前に反して**背景を持つ土地だけ**を返す。 | `src/game/LocationArtLoader`（または `BootScene`） | 「起動時に読む分＝全部から土地の分を除いた残り」という1つの規則の両半分（除く側 `locationDefNames` と除かれる側 `commonArtFiles`）を1箇所に保つため | ✔ |
| src/art/backgroundArt.ts | `SlotRef` | 配置 | 4 | 「どのカードがどのスロットを映しているか」という映しの語彙。実際の利用者は `view/PlayScreenView`・`view/cardLooks`・`ui/Card` で、背景の絵はその1つの読み手にすぎない。 | `src/game/view/PlayScreenView.ts`（契約側） | 背景ファイル名の規約 `<持ち主>_<スロット名>_<用途>.png` がこの型の形そのもので、型を離すと規約が2箇所に分かれる | |
| src/art/backgroundArt.ts | `ART` / `BACKGROUND_ART` | 可視性 | 2 | 可変の実体と読み取り専用の窓口を同じ中身に2つの名前で持つ（`objectArt.ts` も同型）。 | (現状維持) | | |
| src/art/backgroundArt.ts | `backgroundTexture()`, `ownerOf()` | 所属 | 3 | このファイル内からしか呼ばれない private ヘルパー。 | (現状維持) | | |
| src/art/backgroundArt.ts | `found()` | 所属 | 3 | 同上。ただし名前が真偽を返しそうで、実際は「在ればテクスチャキー、無ければ undefined」。 | (現状維持。`textureKeyIfPresent` 等へ改名) | | ✔ |
| src/art/objectArt.ts | `ART` / `ART_BY_OBJECT_NAME` | 可視性 | 2 | `backgroundArt` と同型の2重名。 | (現状維持) | | |
| src/art/objectArt.ts | `CARD_ART_WIDTH` | 配置 | 2 | 数値だが「ゲーム画面の寸法」ではなく**絵が描かれた基準幅**なので素材でよい。ただし `tools/comfyui/card_art.py` の `CARD_WIDTH` と手で二重管理されている。 | (現状維持) | | |
| src/art/objectArt.ts | `MULTIPLY_SUFFIX` | 所属 | 3 | `objectMultiplyTexture` からしか使われない private。 | (現状維持) | | |
| src/ui/shapes.ts | `SHADOW_LAYERS`, `DASH_LENGTH_RATIO` | 配置 | 4 | **汎用の部品が意匠の値を定数で抱えている**（影の濃さ 0.3/0.12・色 `0x000000`・破線長は線幅の6倍）。`BoxStyle.shadow` の説明が「濃さと広がりは drawBox が決める」と明言しており、見た目の決定が `src/ui/` に居る。`labels.ts` には `setLabelDefaults` という差し替え口があるのに、こちらには無い。 | `src/game/looks/theme.ts`（`setLabelDefaults` と同じ「起動時に外から入れる」形） | `BoxStyle` に濃さ・広がり・破線長の口を足すと、`drawBox` の14箇所すべてが毎回指定することになるため、既定値をここに固定している | |
| src/ui/shapes.ts | `fittingRadius()`, `strokeDashedBox()`, `dashedLine()` | 所属 | 3 | `drawBox` からしか呼ばれない private ヘルパー。 | (現状維持) | | |
| src/ui/holdRepeat.ts | `REPEAT_MIN_MS` | 可視性 | 4 | 汎用部品の内部調律値を export し、`src/game/ui/CardTable.ts` が `const GAP_MS = REPEAT_MIN_MS` としてゲームの演出間隔に流用している。**ゲーム側の時間の見せ方が `src/ui/` の定数に固定されている**。 | `src/game/looks/`（札の飛ぶ間隔として自前で持つ） | 「押し続けたときの最高速度」と「札が飛ぶ間隔」を一致させたいが、両者を繋ぐ概念（意匠側の1つの値）が無いため、部品側の定数を直接指している | |
| src/ui/holdRepeat.ts#HoldRepeat | `schedule()` | 所属 | 3 | private ヘルパー。 | (現状維持) | | |
| src/ui/nineSlice.ts | `sliceSpans()`, `SliceSpan` | 可視性 | 4 / 3 | src 内の利用者は同ファイルの2関数だけで、export の実利用者は `tests/ui/nineSlice.test.ts` のみ。 | 非公開化＋`addNineSlice` の内部へ | 「辺が短いとき端どうしを重ねない」という境界を Phaser 抜きで確かめるため。`addNineSlice` はテクスチャ付きの `Phaser.Scene` を要求する | |
| src/ui/nineSlice.ts | `frameNameOf()`, `addSliceFrames()` | 所属 | 3 | このファイル内からしか呼ばれない private。 | (現状維持) | | |
| src/ui/labels.ts | `FontScale`, `defaults`, `setLabelDefaults()` | 所属 | 2 | 汎用部品が意匠を import できないための反転（`fontPx` は `ScreenMetrics` を型で受けずに受け取る）。CodeStructure.md 1節が明示する形そのもの。 | (現状維持) | | |
| src/ui/scrollArea.ts | `ScrollReadout` | 所属 | 2 | `ScrollIndicator` を知らずに送り具合を映すための反転インタフェース。 | (現状維持) | | |

## 移動先が書けなかったもの

無し。判定4・5のすべてに具体的な移動先を書けた。

なお `src/ui/shapes.ts` の `SHADOW_LAYERS` については、移動先（`theme.ts`）はあるものの、**汎用部品へ意匠を差し込む口が `labels.ts` の `setLabelDefaults` にしか無い**ことが根本にある。同じ形の口（`setShapeDefaults` 相当）か、意匠の既定値をまとめて渡す1つの概念が欠けている。

## ファイル配置（層=配置）についての所見

**`src/ui/`（汎用）の判定** — 「このゲームを消しても1文字も変わらないか」を全98宣言に当てた結果、**変わるのは3箇所だけ**だった。(1) `shapes.ts` の `SHADOW_LAYERS`・`0x000000`・`DASH_LENGTH_RATIO`（配色・寸法を定数で抱えている、差し替え口なし）、(2) `holdRepeat.ts` の `REPEAT_MIN_MS`（ゲーム側の演出間隔がこの定数を直接指している）、(3) コメント上の語彙（`scrollArea.ts` の「レーンの地の絵」「CardDragController」、`labels.ts` の「ScreenMetrics」、`clip.ts` の「飛んでいる札」）。(3) は宣言ではないので採点していないが、**契約の説明が具体的なゲーム画面を名指ししている**点は (1)(2) と同根。逆に `scroll.ts` の `WHEEL_DELTA_PIXELS`・`nineSlice.ts` の `'nine:'`・`labels.ts` の `sans-serif`/`0x000000` はブラウザ仕様・名前空間・「意匠が無くても読める既定値」であり、CodeStructure.md 1節が認める形なので汎用のままでよい。

**`src/art/`** — 8ファイル中5つ（`objectArt`・`backgroundArt`・`iconArt`・`weatherArt`・`separatorArt`）は「ファイル名の規約から絵を答える」で統一されていて、置き場所として正しい。歪んでいるのは残り3つの向きが違う点で、`informationArt.ts` は**素材ではなく寸法（意匠）を3つ抱え**、`artFiles.ts` は**ワールド（`WorldCodex`）を引数に取り**、`iconArt.ts` は**ゲーム画面のボタン一覧を持つ**。素材が codex ビューアからも使われる（CodeStructure.md 3節）ことを踏まえると、この3つは素材をゲーム側へ引っ張る向きの依存になっている。

**`src/locale/`** — `Localization.ts` 631行は「引く」と「読む」の2責務が1ファイルに同居しており、後者（`parseLocale` ほか9宣言）を分けるのが最大の改善。加えて、名前を組み立てる処理が `Localization.locationName`（クラス内）と `typeDisplayName.ts`（クラス外）に**同じ形で二分**されている。片方は `domain/generation/IslandMap` を import し、もう片方は `WorldCodex` を避けるために外へ出ており、線の引き方が一貫していない。両方を `src/locale/displayNames.ts` へ寄せると、`Localization` は「識別子→文字列」の1文に収まる。

**`src/util/`** — 4宣言（`removeWhere`・`cssColor`・`INT32_MAX/MIN`）はいずれも「型・言語レベルで、ゲームの語彙もPhaserも持たない」という同じ基準を満たしており、なぜこれだけかは説明が付く（`cssColor` は `src/ui/` と `src/game/` の両方から、`INT32_*` は `domain` と `loader` の両方から使われる＝**層をまたぐから util に在る**）。散っている候補は `src/locale/Localization.ts` の `format()`（`{name}` の差し込み。ICU 風の汎用書式で、ゲームもPhaserも知らない）1件のみ。ただし現状の利用者が同ファイル内2箇所なので、移すのは2人目の利用者が出てからでよい。`src/ui/textLayout.ts` の文字列処理は `Phaser.GameObjects.Text` の実測に依存するため util ではない。

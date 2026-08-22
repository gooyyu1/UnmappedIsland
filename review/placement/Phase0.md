# 段0の決定案

[`Plan.md`](./Plan.md) の段0（コードを書かずに決める）の案。**合意を取るためのもので、まだ実装しない。**

調べた結果、**4件のうち2件は「新しい概念は要らない」という結論**になった。
[`Candidates.md`](./Candidates.md) A-11・A-12 の見立てを訂正する。

| 決めること | 結論 |
| ---------- | ---- |
| A-1 画面のことばの置き場 | **新設が要る。** 既存の locale の仕組みに1節足し、起動時注入で配る |
| A-2 意匠の線 | **新設は要らない。線を書き下す。** ただし A-2 の元の記述は誤りだったので訂正 |
| A-11 見せ方の宣言 | **却下。** 方針は既にコードに書かれている。Layers.md に参照を1行足すだけ |
| A-12 「起動」の区分 | **却下。** 新しい層も新しいディレクトリも要らない。組み立ての一番外側として1行足す |

---

## 決定1（A-1）: 画面のことばは locale の1節にし、起動時に注入する

### 現状

- `src/assets/locale/ja.yaml` は既に9節を持ち、冒頭に「キーは WorldCodex の識別子で、値が画面に出す
  文字列。WorldCodex 側は識別子だけを持ち、表示文字列はこのファイルにだけ書く」と書いてある。
- ところが**窓は `Localization` を1つも持っていない。** `'閉じる'` は `MapWindow`・`ObjectWindow`・
  `RecipeWindow`・`StatusDetailWindow` の4箇所に直書きされている（`errorReport.ts` にもう1つ）。
- 一方 `src/main.ts` は既に `setLabelDefaults({ fontFamily, color })` を呼んでいて、
  **「汎用の部品は意匠を知らないので、この画面の書体と文字色をここで入れる」**という注入の形が確立している。
  `labels.ts` 側は既定値を持つので、注入しなくても文字は消えない。

### 案

1. `ja.yaml` に **`ui_texts:` 節**を足す。キーは WorldCodex の識別子ではなく画面側の名前
   （`close` `map` `no_description` `no_influence` `cannot_do_now` …）。
2. `src/locale/uiTexts.ts` に **`setUiTexts()` / `uiText(name)`** を置く。既定値を持ち、
   注入しなくても英数字の名前がそのまま出るだけで壊れない。
3. `src/main.ts` が `setLabelDefaults` の隣で `setUiTexts(...)` を呼ぶ。
4. 窓は `uiText('close')` を呼ぶだけ。**コンストラクタ引数は増えない。**

層のテストは `src/locale` に「Phaser へ到達しない」しか課しておらず、`src/game/ui/` → `src/locale/` は
禁じていない（禁じているのは `src/ui/` → `src/game/`）。`uiText` は文字列を返すだけなので抵触しない。

### 却下した案

- **`Localization` を窓へ配る。** 12ファイルのコンストラクタ引数が増え、組み立て（`PlayScene`）が
  全部へ配ることになる。得られるものは同じ。**配線のコストだけが増える。**
- **`src/locale/uiTexts.ts` に定数表をコードで持つ（YAML にしない）。** 表示文字列の置き場が
  YAML とコードの2つになる。`ja.yaml` の冒頭が「表示文字列はこのファイルにだけ書く」と宣言している
  以上、2つ目を作るのは宣言を破ることになる。アセットパックからの差し替え（`pack.localeText`）も効かなくなる。

### 決まると確定するもの

`NO_DESCRIPTION`（同一文字列が2ファイル）、`'閉じる'` ×4、`'地図'`、`'与えている影響'`/`'受けている影響'`、
`DESCRIPTION_LABEL` / `PROPERTIES_LABEL` / `EXPLORATION_LABEL` / `CANNOT_DO_NOW` / `NO_INFLUENCE`、
映し側の `UNNAMED_LOCATION` / `LOCKED` / `OTHER` の行き先。

---

## 決定2（A-2）: 色は例外なく `theme.ts`、寸法は共有するものだけ

### まず訂正

Candidates.md A-2 は「`theme.ts` は**画面全体で共有する**トークンの置き場で、部品1つぶんの意匠を
置く単位が無い」と書いた。**これは誤り。** 実測すると:

| | キー数 | 1ファイルからのみ使用 | 2ファイル以上 |
| --- | --- | --- | --- |
| `COLOR` | 79 | **49（62%）** | 23 |
| `SIZE` | 17 | 6 | 11 |

`COLOR` の6割は単一の部品しか使っていない（`cardInProgress` は `Card.ts` だけ、`flipDigit` は
`FlipCalendar.ts` だけ、`progressRing*` 4つは `ProgressRing.ts` だけ…）。
**`theme.ts` は既に「部品1つぶんの色」の置き場として使われている。** 欠けていたのは単位ではなく、
線が書かれていないことだった。

実際の運用は**色と寸法で正反対**になっている——色は利用者が1つでも `theme.ts` へ集約、
寸法は `src/game/ui/` に228個のローカル定数。どちらにも例外がある。

### 案: 線を「見渡す必要があるか」で引き、現状の運用をそのまま明文化する

1. **色は例外なく `theme.ts` の `COLOR`。利用者が1つでも置く。**
   配色は画面全体の調和で決まるので、**1箇所で見渡せること自体に値打ちがある**。
   → `MapWindow.ts` の `CHART_PAPER` / `CHART_LINE` / `ROAD_INK` を回収する（現状唯一の例外）。
2. **寸法・時間は、その部品の外が知る必要があるものだけ `SIZE` または `looks/` の話題別モジュール。
   部品の中で閉じるものはローカルのまま。**
   隣り合う部品との関係でだけ効くので、見渡す必要が無い。`Card.ts` の44定数は**そのままでよい**。
   → 複数箇所で一致すべきものだけ出す: `HOLD_MS`(400) `BLINK_DURATION_MS`(450)
   `ITEM_PADDING_X`(24) `LIST_PADDING`(20) `PADDING`(24)。
3. **不透明度（`*_ALPHA`）は寸法と同じ扱い**（`COLOR` は `number` の色値だけを持つ）。現状維持。
4. **汎用部品（`src/ui/`）は意匠を一切持たず、起動時に注入する。**
   `labels.ts` の `setLabelDefaults` と同じ形を `shapes.ts` にも作る（`setShapeDefaults`）。
   → `SHADOW_LAYERS` / `DASH_LENGTH_RATIO` が出せ、B-6 の `Button` / `Curtain` / `ScrollIndicator` が
   `src/ui/` へ移せるようになる。

### 却下した案

- **「部品1つぶんの意匠モジュール」（`looks/cardLook.ts` 等）を新設する。**
  これは Candidates.md A-2 が挙げた案だが、**上の実測により前提が崩れた。**
  `theme.ts` が既にその役を果たしているのに3段目を作ると、同じ種類の値の置き場が3つになる。
- **色も寸法も「使う部品が1つならローカル」に揃える。** 一見きれいだが、`COLOR` の49キーが
  部品側へ散ることになり、配色を見渡せなくなる。**色と寸法で扱いが違うのは、既存実装の惰性ではなく
  「見渡す必要があるか」という差**なので、パラメータではなく線として残してよい。

### ついでに見つかった死んだトークン

`COLOR.weatherPanelBorder` と `COLOR.slotPortrait` は `src` `tests` のどこからも参照が無い。
（`statusBarFillSafe` `statusBarFillFatal` `durabilityFull` `durabilityHalf` `durabilityEmpty` は
`theme.ts` 内の `statusFillColorFor` / `gaugeColorFor` が使っているので**生きている**。
一度「未使用7件」と数えたが、`theme.ts` 自身を除外した数え方の誤りだった。）

---

## 決定3（A-11）: 却下。方針は既に書かれている

Candidates.md A-11 は「宣言に対する見せ方の宣言というデータの層が無いため、意匠のコードが世界の語彙を
写している」とした。しかし `src/game/looks/rainStyle.ts` の冒頭が既にこう書いている。

> 見え方は WorldCodex ではなく UI が持つ。WorldCodex は表示に関わる値を一切持たない方針
> （Localization.md）で、液体の色（LiquidContainerSystem.md 4.1節）のようにドメインが意味を持つ値でも
> ないため。

さらに `RAIN_STYLES` は「**ここに無い天気では雨を降らせない**ので、天気が増えても画面は壊れない」と
増えたときの振る舞いまで決めている。**方針も、その帰結も、既に決まっている。**

欠けているのは概念ではなく、`Layers.md` にこの方針が載っていないことだけ。
→ `Layers.md` 3節の「意匠か素材か」に1行足して `rainStyle.ts` を指す。**コード変更なし。**

## 決定4（A-12）: 却下。「起動」は層ではなく組み立ての一番外側

`src/main.ts` は22行で、やっているのは「エラー報告を張る → アセットパックを入れる →
意匠を汎用部品へ注入する → シーン一覧を渡して `DeviceScreen.startGame`」。
これは Layers.md 2節が言う組み立て——「どの部品をどこへ置き、映しの答えを誰へ渡すかを決める」——
そのもので、その一番外側にあたる。

→ 2節の「`PlayScene`・各 `Scene`・各 `Window` がこれにあたり」に **`src/main.ts` と `DeviceScreen` を
足す**。1行。**新しい層も、新しいディレクトリ（`src/boot/` 等）も作らない。**

却下した案: **表に5行目「起動」を足す。** 層を1つ増やすことになるが、`main.ts` が知ってよい範囲は
組み立てとまったく同じ（全部知ってよい）。**区別しても何も変わらないので、増やす理由が無い。**

---

## `docs/engine/Layers.md` への反映

段0で片付くのは、[`Architecture.md`](./Architecture.md) の10件のうち5件。

| 項目 | 直し方 |
| ---- | ------ |
| 2-1 `Button` の判定例が実装とずれている | **事実の誤りなので最初に直す。** `SLOT_BUTTON_PAPER_TEXTURE` は `Button.ts` のモジュール定数で、`Button` クラスは参照していない。判定例を実在するものへ差し替える |
| 2-2 「起動」の区分 | 決定4。2節に1行 |
| 2-5 `src/domain/views/` が「映し」と名前衝突 | 4節の表に「`src/domain/views/` は映しではない」を書き添える（改名は段4以降の判断） |
| 2-6 意匠の粒 | 決定2の4つの線を3節に書く |
| 2-8 見せ方の宣言 | 決定3。3節に1行 |

残る5件（2-3 入れ子の語彙、2-4 `DescriptionWriter` を認めるか、2-7 画面のことば＝決定1で解消、
2-9 重なりの2系統、2-10 `src/domain/` の平置き）は、コードの設計と不可分なので段2以降で扱う。

---

## この4件が決まると

段1・段2の**移動先が確定する**。特に:

- 決定1 → 画面のことば13件以上の行き先が決まり、段2 ui レーンで H-4 と一緒に片付けられる
- 決定2 → `MapWindow` の色3件と、複数箇所で一致すべき定数5件の行き先が決まる。
  さらに `setShapeDefaults` が段2の前提になり、B-6 の3クラスが段4を待たずに `src/ui/` へ出せる
- 決定3・4 → **段4 の作業が2件減る**

判断をもらえれば、`scripts/declarationInventory.mjs` の投入と合わせて段1に入れる。

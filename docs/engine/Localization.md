# ローカライゼーション

画面に出す文字列（アイテム名・説明文など）の持ち方を記述します。

## 方針: WorldCodexは識別子だけを持つ

WorldCodex（`src/assets/world-codex/*.yaml`）は**表示文字列を一切持ちません**。`object_defs` のキーは
`coconut` のような識別子であり、それを画面にどう出すかは言語ごとの対応表
（`src/assets/locale/{言語}.yaml`）だけが知っています。

分けている理由は、WorldCodexが言語に依存しないデータであるべきだからです。言語を増やす作業が
WorldCodexの編集を伴うと、パック作成者が新しい言語を足すたびにゲームデータ本体へ手を入れることになり、
「ファイル追加だけで拡張できる」（[GameElementDefinition.md](./GameElementDefinition.md) 2節）が
崩れます。

## 対応表の形式

`object_texts` の下に、object_defの識別子をキーとして並べます。各エントリはそのオブジェクト自身の
`display_name`/`description` と、メンバー（`props`・`interactions`）ごとの同じ組を持てます。
いずれも省略可能です。

**操作はきっかけで分けず、`interactions` に
まとめて書きます。** 操作の名前は元から1つの名前空間だからです
（[`GameElementDefinition.md`](./GameElementDefinition.md) 11節）。

```yaml
object_texts:
  coconut:
    display_name: ヤシの実
    description: 硬い殻に覆われた実。
    props:
      freshness:
        display_name: 鮮度
    interactions:
      eat:                      # actions の操作
        display_name: かじる
        description: 殻を割って中身を食べる。
      pour_in:                  # combinations の操作も同じ節へ
        display_name: 注ぎ移す
```

## icon: 名前の代わりに置ける絵

`display_name` と並べて `icon` を書けます。**名前を出す場所が、代わりにこれを出せる**という宣言で、
今読んでいるのはステータスの行だけです（[`StatusArea.md`](../ui/StatusArea.md) 3 節）。

```yaml
object_texts:
  default:
    props:
      hydration:
        display_name: 水分
        icon: 💧
```

**無ければ表示名に戻ります。** 絵は一度に揃うものではないので、書いていないプロパティが混じっても
行は名無しになりません。今の値は絵文字ですが、これは絵が用意できるまでの仮の姿です。

言語に依らない値でありながら言語ごとの対応表にあるのは、**名前とその代わりを1箇所に置くため**です。
別の節や WorldCodex 側に分けると、同じプロパティの見せ方が2つのファイルに散り、
新しい言語を足すときに「名前は書いたが絵は別の場所」という食い違いが起こります。

## defaultエントリ: メンバーの共通の文字列

同じ名前のプロパティ・アクションを多くのオブジェクトが共有するため（`exploration_progress` は
すべての土地が、`eat` はすべての食料が持つ）、「特に断らなければこの文字列」を `default` という
識別子のエントリへ1回だけ書けます。

```yaml
object_texts:
  default:
    props:
      exploration_progress:
        display_name: 探索の進み具合
    interactions:
      eat:
        display_name: 食べる
  coconut:
    interactions:
      eat:
        display_name: かじる   # このオブジェクトだけ言い方を変える
```

メンバーは **そのオブジェクト自身の定義 → `default` の定義 → 識別子** の順に解決します。
`default` に書いた `display_name`/`description`（オブジェクト自身の組）は使いません。使ってしまうと
未登録のオブジェクトがすべて同じ名前で表示されるため、`default` はメンバーのフォールバック専用です。

## 書式のプレースホルダは名前で書く

差し込みのある書式（次の 2 つ）は、`{container}` のように**名前で**書きます。TypeScript には組み込みの
書式規約が無いので、JS で広く使われている ICU MessageFormat 系の書き方に倣っています。位置で書く
`%1`/`%2` は、翻訳する側が「2 番目は何だったか」を調べないと語順を変えられないため採りません。

差し込みは 1 回で走らせます。順に置き換えると、先に差し込んだ名前の中の `{...}` まで置換対象に
なるためです。書式に知らない名前が書かれていたら、空文字にせずそのまま残します——書き間違いに
気付けるようにするためです。

## slot_texts: スロットの名前

スロットは必ず持ち主のものなので、名前も 2 通り持てます。`display_name` はスロットだけを指す短い
言い方（「装備」）、`display_name_with_owner` は持ち主込みの言い方（「マルコの装備」）です。
子ウィンドウの見出しが後者を使います（[`Windows.md`](../ui/Windows.md) 1 節）。

```yaml
slot_texts:
  default:
    display_name_with_owner: '{owner}の{slot}'   # 装備 + マルコ → マルコの装備
  contents:
    display_name: 中身                            # 中身 + 編み籠 → 編み籠の中身
  equipment:
    display_name: 装備
```

**書式だけは `default` エントリを参照します**（次節の `variation_names` と同じ理由）。
`{slot}` は各スロット自身の名前から埋まるので、共通の書式を書いてもすべてが同じ名前にはなりません。

`put_in` は、**そこへ物を入れる操作**の呼び名と説明です。ドラッグ中の吹き出しに出ます
（[`CardInteraction.md`](../ui/CardInteraction.md) 2 節）。スロットの名前が場所を指す
名詞（「手当て」）なのに対し、こちらは行為の名前（「手当てする」）なので、別の文字列として持ちます。

```yaml
slot_texts:
  treatment:
    display_name: 手当て
    put_in:
      display_name: 手当てする
      description: 治療具を当てる。当てている間だけ効き、外せば効き目も消える。
```

書かなければ吹き出しは出ません（ただ位置が変わるだけの移動には説明が要らないため）。ただし枠が
時間を要求している場合（`put_in: {duration: ...}`、GameElementDefinition.md 7.10節）は、値段を伏せる
わけにいかないので、スロットの名前を見出しにして時間だけを出します。

## variation_names: 変種の名前

ロード時に生成された型（[GameElementDefinition.md](./GameElementDefinition.md) 3.5節）は、自分の
エントリを持てません。**素の型の名前から始めて、動いた軸のぶんだけ書式を重ねて組み立てます。**
書式は軸の名前ごとに `variation_names` へ書き、**`{base}` が素の型の名前、`{value}` がその軸の値の
名前**に置き換わります。

```yaml
object_texts:
  default:
    variation_names:
      content: '{value}入りの{base}'   # 甕 + 水 → 水入りの甕
      recipe: '{base}'                 # 作りかけの斧も「石斧」（CardView.md 10節）
```

**作りかけも中身入りも、扱いは同じ1つの畳み込みです。** 違うのは軸の名前と、その名前に紐づく書式
だけで、どちらか一方のための分岐はありません。

**この書式だけは `default` エントリを参照します。** `display_name` を `default` から採らないのは、
未登録のオブジェクトがすべて同じ名前になってしまうからですが、こちらは名前ではなく書式で、`{base}` は
素の型の表示名から埋まります。共通の書式を1回書けば済み、言い方を変えたい型だけが自分のエントリで
上書きします。

その軸の書式が無ければ、素の型の名前のままです。

## property_tag_texts: プロパティのカテゴリ名

プロパティのタグ（[GameElementDefinition.md](./GameElementDefinition.md) 6.7節）は、どのオブジェクトにも
属さない独立した識別子なので、`object_texts` とは別のトップレベルの節に書きます。

```yaml
property_tag_texts:
  nutrition:
    display_name: 栄養
```

## tag_texts: object_defのタグの文言

`object_def` のタグ（[GameElementDefinition.md](./GameElementDefinition.md) 4.1節）の文言です。値は
文字列 1 つで、説明文は持ちません。

```yaml
tag_texts:
  tool: 道具
```

**書くのは画面へ出るタグだけです。** タグの大半は枠の `accept` やドラッグ型の相手を探すための
ものでプレイヤーの目に触れないので、網羅する必要はありません。今この節を読むのはレシピ一覧の棚の
見出し（[`Windows.md`](../ui/Windows.md) 9.2節）だけです。

## symbol_texts: シンボル型プロパティの値

シンボル型プロパティ（[GameElementDefinition.md](./GameElementDefinition.md) 6.6節）の値——天気の
`scorching`、季節の `dry` など——も、どのオブジェクトにも属さない独立した名前空間
（`WorldCodex.symbolNames`）にあるので、独立した節に書きます。

```yaml
symbol_texts:
  scorching:
    display_name: 灼熱
```

天気の名前は状況エリアの空の窓に出ます（[`ScreenLayout.md`](../ui/ScreenLayout.md) 5 節）。絵だけでは
晴天どうしを見分けられないため、名前が区別を引き受けます。

## reason_texts: 操作を実行できない理由

`conditions` の要素が宣言する `reason`（[GameElementDefinition.md](./GameElementDefinition.md) 14.6節）も、
どのオブジェクトにも属さない独立した識別子なので、独立した節に書きます。値は説明文だけなので、
`display_name` を持たず**1行の文字列そのもの**を書きます。

```yaml
reason_texts:
  too_heavy: 荷が重すぎて歩けない。まず何かを置いていく必要がある。
```

同じ理由を複数の操作が使えるよう、オブジェクトやアクションの下ではなくここへ集めます（「重すぎて
歩けない」は道以外の操作でも起こりえます）。未登録の識別子は理由を出さない扱いになるため、綴り間違いは
自動テスト（`tests/locale/localization.test.ts`）が捕まえます。

## stage_texts: 画面に出る段の文言

段（[GameElementDefinition.md](./GameElementDefinition.md) 6.4節の`stages`）のうち、**UIが名前を読んで
画面に出すもの**の文言です。`reason_texts` と同じく1行の文字列そのものを書きます。

```yaml
stage_texts:
  unconscious: 気絶
```

出るのはカードの上（[CardView.md](../ui/CardView.md) 9.1節の覆い）なので、**離れて見ても読める短い語**を
選びます。長い語は幅に合わせて縮むため、大きく出て気付かせる効果が薄れます。長さの上限も、未登録の
識別子も、自動テスト（`tests/locale/localization.test.ts`）が捕まえます。

段の名前はプロパティごとの名前空間ですが、対応表は平らに持ちます——同じ名前の段は同じ言葉で出します。

## destroy_reason_texts: 消し方の名乗りの文言

`destroy` が添える `reason`（[GameElementDefinition.md](./GameElementDefinition.md) 9.3節）の文言です。
死亡ダイアログが死因として出します（[VitalsSystem.md](./VitalsSystem.md) 6節）。`reason_texts` と同じく
1行の文字列そのものを書きます。

```yaml
destroy_reason_texts:
  dehydrated: 渇き
```

**`stage_texts` とも `reason_texts` とも別の名前空間です。** 命を絶つ値の段と死因に同じ語を当てることは
できますが、揃っている必要はありません——段は「今どこに居るか」、消し方の名乗りは「どう消したか」で、
決めているものが違います。名前を揃える規約にはしません。**揃っていることを検査で守っても、
揃えられない死に方（段を通らない即死）が現れた時点で破れます。**

未登録なら識別子がそのまま出ます（`signal_texts` と同じ）——消滅は既に起きているので、文言の欠けを
黙って握り潰すと**名乗らずに消えた場合と見分けが付かなくなります**。付け忘れも改名の取り残しも、
自動テスト（`tests/world-codex/bundledLocale.test.ts`）が捕まえます。

## signal_texts: 告げられた出来事の文言

`signal`（[GameElementDefinition.md](./GameElementDefinition.md) 9.8節）が告げる出来事の識別子も、
どのオブジェクトにも属さないので独立した節に書きます。`reason_texts` と同じく**1行の文字列そのもの**です。

```yaml
signal_texts:
  missed: 空振り
```

出るのはカードの上に一瞬だけなので（[CardView.md](../ui/CardView.md) 14節）、**離れて見ても読める短い語**を
選びます。長さの上限も、未登録の識別子も、自動テスト（`tests/locale/localization.test.ts`）が捕まえます——
理由（`reason`）と違い、未登録でも識別子がそのまま札に出ます。

## location_texts: 土地の名前

土地の名前は、生成のたびに**型と亜種の識別子の組み合わせ**として決まります
（[TerrainGeneration.md](./TerrainGeneration.md) 3.6節）。生成側（`IslandMap`）が持つのは識別子だけで、
文字列の組み立てはこちらが行います。`object_texts` とは別の節にするのは、亜種が `object_def` ではなく
`location_type` のメンバーだからです。

```yaml
location_texts:
  default:
    ordinal_suffix: '（第{n}）'   # 亜種を使い切ったときだけ名前に付く通し番号の書式
  sandy_beach:
    display_name: 砂浜            # 島にこの型が1つだけのときの名前
    variants:
      palm: {display_name: ヤシの浜}
      white_sand: {display_name: 白砂の浜}
```

**亜種の名前は型の名前へ足すのではなく、置き換えます。** 「砂浜のヤシの浜」ではなく「ヤシの浜」です。
`ordinal_suffix` が使われるのは亜種が足りないときだけで、これが画面に出たら
`terrain_generation.yaml` へ亜種を足すべき合図です。

## ui_texts: 画面そのもののことば

ここまでの節はすべて**WorldCodexの識別子**に文字列を与えるものですが、画面には
**ワールド定義に由来しないことば**もあります——「閉じる」「地図」「今はできない。」のように、
どんなYAMLを載せ替えても画面が言う語です。これを `ui_texts` に置きます。

```yaml
ui_texts:
  close: 閉じる
  map: 地図
  cannot_do_now: 今はできない。
```

**キーはWorldCodexの識別子ではなく、画面側が名指しする名前です。** コードが名指しする名前の一覧は
`src/locale/uiTexts.ts` の `UiTextName` に並びます——「この語をlocaleから消したら何が変わるか」を
1箇所で答えられるようにするためで、`WorldVocabulary` と同じ考え方です。

**引き方が2つあります。**

- `Localization` を持っている側（映し・組み立て）は `locale.uiText('close')` を直に呼びます。
- **窓（`src/game/ui/`）は `Localization` を持ちません。** 持たせると12ファイルのコンストラクタ引数が
  増え、組み立てが全部へ配ることになります。そこで、書体と文字色（`setLabelDefaults`）と同じく
  起動時に1度だけ入れ（`setUiTexts`）、`uiText('close')` を呼びます。答えを決めるのは
  どちらも `Localization.uiText` の1箇所です。

起動より前に描かれるもの（`errorReport` の「閉じる」）は、まだ対応表が読まれていないため対象外です。

## 引き方と欠落時の扱い

`Localization`（`src/locale/Localization.ts`）が対応表を保持します。`object(識別子)` で1つの
オブジェクトの窓口を得て、そこから自身の文字列とメンバーの文字列を引きます。

```ts
locale.object('coconut').displayName          // 'ヤシの実'
locale.object('coconut').description          // '硬い殻に覆われた実。' / 未定義ならundefined
locale.object('jar').displayNameWithContent('水')   // '水入りの甕'
locale.object('coconut').action('eat').displayName
locale.object('coconut').prop('freshness').displayName
locale.object('captain').prop('hydration').icon          // '💧' / 宣言が無ければundefined
locale.object('coconut').combination('pour_in').displayName
locale.propertyTag('nutrition').displayName   // '栄養'
locale.symbol('scorching').displayName        // '灼熱'
locale.location('sandy_beach').displayName    // '砂浜'
locale.location('sandy_beach').variant('palm').displayName  // 'ヤシの浜'
locale.locationName(name)                     // 生成された土地の名前（LocationName）を1つの文字列へ
```

**`displayName` は、対応表に無ければ識別子そのものを返します。** 表示文字列の欠落でゲームが止まるより、
画面に `thick_branch` と出て気付ける方がよいためです。`description` は無ければ `undefined` を返し、
呼び出し側が「説明が無い」ことを区別できるようにします。

知らない節・キーは無視するため、実装が追いつく前に対応表へ節を足しても壊れません。

同梱の対応表については、カードに並ぶ型（`item`/`fixture` タグを持つ `object_def`）・土地（型・亜種）・
シンボルが漏れなく表示名を持つこと、キャラクタのプロパティが漏れなく `icon` を持つこと、および
存在しない識別子のエントリが残っていないことを自動テストで検証します
（`tests/locale/localization.test.ts`）。

**検証の対象外（props・interactions など）の抜けは、閲覧ビューアで探すのが一番早いです。** 表示名が識別子の
ままの対象には「未翻訳」の印が付くため、`npm run dev:codex` で開いて眺めれば漏れが目に入ります。

## 言語の切り替え

現状は日本語固定です（`Localization.LANGUAGE`）。対応表は `src/assets/locale/<言語>.yaml` に置き、
`import.meta.glob` がビルド時に中身を埋め込みます。`BootScene` は起動時にそのうち1つを読んで
レジストリへ置きます。切り替えUI・実行中の再読み込みは今後の課題です。

## 対象外・今後の課題

- UIの固定ラベル（「装備」「怪我」など）は各画面のコードに直接書かれたままです。`object_texts` と
  並ぶ別の節として集約できるよう、トップレベルを最初から節で区切っています。

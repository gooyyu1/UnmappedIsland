# ローカライゼーション

画面に出す文字列（アイテム名・説明文など）の持ち方を記述します。

## 方針: WorldCodexは識別子だけを持つ

WorldCodex（`public/world-codex/*.yaml`）は**表示文字列を一切持ちません**。`object_defs` のキーは
`coconut` のような識別子であり、それを画面にどう出すかは言語ごとの対応表
（`public/locale/{言語}.yaml`）だけが知っています。

分けている理由は、WorldCodexが言語に依存しないデータであるべきだからです。言語を増やす作業が
WorldCodexの編集を伴うと、MOD作成者が新しい言語を足すたびにゲームデータ本体へ手を入れることになり、
「ファイル追加だけで拡張できる」（[GameElementDefinition.md](./GameElementDefinition.md) 2節）が
崩れます。

## 対応表の形式

`object_texts` の下に、object_defの識別子をキーとして並べます。各エントリはそのオブジェクト自身の
`display_name`/`description` と、メンバー（`props`・`actions`・`combinations`）ごとの同じ組を持てます。
いずれも省略可能です。

```yaml
object_texts:
  coconut:
    display_name: ヤシの実
    description: 硬い殻に覆われた実。
    props:
      freshness:
        display_name: 鮮度
    actions:
      eat:
        display_name: かじる
        description: 殻を割って中身を食べる。
    combinations:
      pour_in:
        display_name: 注ぎ移す
```

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
    actions:
      eat:
        display_name: 食べる
  coconut:
    actions:
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

**書式だけは `default` エントリを参照します**（次節の `display_name_with_content` と同じ理由）。
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

## display_name_with_content: 中身がいるときの名前

`represented_by`（[GameElementDefinition.md](./GameElementDefinition.md) 7.6節）で中身を代表にしている
オブジェクトは、中身がいる間だけ名前が変わります。書式を `display_name_with_content` に書き、
**`{container}` が入れ物自身の表示名、`{content}` が中身の名前**に置き換わります。

```yaml
object_texts:
  default:
    display_name_with_content: '{content}入りの{container}'   # 水筒 + 水 → 水入りの水筒
```

**この書式だけは `default` エントリを参照します。** `display_name` を `default` から採らないのは、
未登録のオブジェクトがすべて同じ名前になってしまうからですが、こちらは名前ではなく書式で、`{container}` は
各オブジェクト自身の表示名から埋まります。中身を持つ入れ物はどれも同じ言い方でよいので、共通の
書式を1回書けば済み、言い方を変えたい入れ物だけが自分のエントリで上書きします。

書式が無ければ名前は変わりません（中身の有無で名前が動かない）。中身がさらに中身を持つ入れ子は、
内側から順に畳んで1つの名前にします。

## property_tag_texts: プロパティのカテゴリ名

プロパティのタグ（[GameElementDefinition.md](./GameElementDefinition.md) 6.7節）は、どのオブジェクトにも
属さない独立した識別子なので、`object_texts` とは別のトップレベルの節に書きます。

```yaml
property_tag_texts:
  nutrition:
    display_name: 栄養
```

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

## 引き方と欠落時の扱い

`Localization`（`src/locale/Localization.ts`）が対応表を保持します。`object(識別子)` で1つの
オブジェクトの窓口を得て、そこから自身の文字列とメンバーの文字列を引きます。

```ts
locale.object('coconut').displayName          // 'ヤシの実'
locale.object('coconut').description          // '硬い殻に覆われた実。' / 未定義ならundefined
locale.object('canteen').displayNameWithContent('水')   // '水入りの水筒'
locale.object('coconut').action('eat').displayName
locale.object('coconut').prop('freshness').displayName
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
シンボルが漏れなく表示名を持つこと、および存在しない識別子のエントリが残っていないことを自動テストで
検証します（`tests/locale/localization.test.ts`）。

## 言語の切り替え

現状は日本語固定です（`Localization.LANGUAGE`）。読み込むファイルのパスは言語名から組み立てており、
`BootScene` が起動時に1ファイルだけ読んでレジストリへ置きます。切り替えUI・実行中の再読み込みは
今後の課題です。

## 対象外・今後の課題

- UIの固定ラベル（「装備」「怪我」など）は各画面のコードに直接書かれたままです。`object_texts` と
  並ぶ別の節として集約できるよう、トップレベルを最初から節で区切っています。

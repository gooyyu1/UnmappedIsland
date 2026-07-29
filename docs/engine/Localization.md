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

## property_tag_texts: プロパティのカテゴリ名

プロパティのタグ（[GameElementDefinition.md](./GameElementDefinition.md) 6.9節）は、どのオブジェクトにも
属さない独立した識別子なので、`object_texts` とは別のトップレベルの節に書きます。

```yaml
property_tag_texts:
  nutrition:
    display_name: 栄養
```

## 引き方と欠落時の扱い

`Localization`（`src/locale/Localization.ts`）が対応表を保持します。`object(識別子)` で1つの
オブジェクトの窓口を得て、そこから自身の文字列とメンバーの文字列を引きます。

```ts
locale.object('coconut').displayName          // 'ヤシの実'
locale.object('coconut').description          // '硬い殻に覆われた実。' / 未定義ならundefined
locale.object('coconut').action('eat').displayName
locale.object('coconut').prop('freshness').displayName
locale.object('coconut').combination('pour_in').displayName
locale.propertyTag('nutrition').displayName   // '栄養'
```

**`displayName` は、対応表に無ければ識別子そのものを返します。** 表示文字列の欠落でゲームが止まるより、
画面に `driftwood` と出て気付ける方がよいためです。`description` は無ければ `undefined` を返し、
呼び出し側が「説明が無い」ことを区別できるようにします。

知らない節・キーは無視するため、実装が追いつく前に対応表へ節を足しても壊れません。

同梱の対応表については、カードに並ぶ型（`item`/`fixture` タグを持つ `object_def`）が漏れなく表示名を
持つこと、および存在しない識別子のエントリが残っていないことを自動テストで検証します
（`tests/locale/localization.test.ts`）。

## 言語の切り替え

現状は日本語固定です（`Localization.LANGUAGE`）。読み込むファイルのパスは言語名から組み立てており、
`BootScene` が起動時に1ファイルだけ読んでレジストリへ置きます。切り替えUI・実行中の再読み込みは
今後の課題です。

## 対象外・今後の課題

- 土地の名前は例外的に地形生成側（`location_types` の `display_name`、
  [TerrainGeneration.md](./TerrainGeneration.md) 3.6節）が持ったままです。「東の草原」のように
  方角・重複の序数と組み合わせて生成時に確定するため、この対応表へ移すには生成した名前を
  「方角＋型＋序数」の構成要素として持ち回る作りへ変える必要があります。
- UIの固定ラベル（「装備」「怪我」など）は各画面のコードに直接書かれたままです。`object_texts` と
  並ぶ別の節として集約できるよう、トップレベルを最初から節で区切っています。

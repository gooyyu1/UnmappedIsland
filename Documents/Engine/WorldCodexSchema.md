# WorldCodex YAMLスキーマ定義

## 概要

本ドキュメントは、YAML文法の唯一のリファレンスである `GameElementDefinition.md`（`traits`/`object_defs`/`props`/
`slots`/`passives`/`active`/`pick`/`actions`/`combinations`/`recipes` 等の文法をすべて集約したもの)をもとに、
`WorldCodex` の YAML ファイルの形式的なスキーマ定義（[JSON Schema](https://json-schema.org/) Draft 2020-12、
`WorldCodex.schema.json`）を作成・保守した結果をまとめたものです。個別の世界描写（`ClimateSystem.md`・`RecipeSystem.md`・
`ContainerSystem.md`・`ActionSystem.md`・`TerrainGeneration.md`・`ExplorationSystem.md`）の内容そのものはスキーマの
対象外で、それらが使う文法の妥当性のみを検証します。

スキーマの正は**ローダーの実装**（`Assets/Scripts/Loader/WorldCodexYamlLoader.*.cs`）です。本スキーマはローダーが
受け付ける文法の機械的な近似であり、乖離を見つけたらローダーに合わせてスキーマを直します。

## 1. 検証方法

`WorldCodex.schema.json` は以下の観点で検証済みです。

- **スキーマ自体の妥当性**: `jsonschema` ライブラリの `Draft202012Validator.check_schema` により、Draft 2020-12として
  構文的に正しいスキーマであることを確認
- **実データ全ファイルの受理**: `Assets/StreamingAssets/WorldCodex/` の全YAMLファイル（`core.yaml`・`locations.yaml`・
  `containers.yaml`・`foods.yaml`・`characters.yaml`・`terrain_generation.yaml`）が、実際にゲームがロードしている
  ままの内容でスキーマを満たすことを確認（ローダーで読み込めるファイルはスキーマも通る、が維持基準）
- **不正な記述の拒否**: `set`/`add`/`destroy`/`spawn`/`transfer`/`move` と `pick` を同時に指定する、identifier の
  命名規則に反するキーを使う、未定義の比較演算子を使う、`set`/`add` に未対応の対象キー（`sibling`/`child` など)を
  使う、`destroy` の対象に `ancestor` を使う、`accepts` に `tag` と `object` を同時指定する（またはどちらも省略する）、
  `combinations` に `with` を書き忘れる、廃止済みの `active:` 入れ子を使う、`passives` を配列でなく単一マッピングで
  書く、`conditions` の葉に `slot` と `prop` を同時指定する、`conditions` の `value` に未対応の `max`/`min` を使う、
  `in`/`not_in` に配列でない `value` を渡す、`move` の `object` に `actor` 以外を使う、pick候補が active動詞と
  `pick` を同時に持つ、といった誤った記述が拒否されることを確認

## 2. スキーマの範囲

### 2.1 含めたもの

- ルート構造（`object_defs`/`traits`。地形生成の3ルートキーは2.2節参照）
- `object_defs`/`traits`（3〜5節。`tags`・`singleton`・`represented_by`・`stack_order` を含む）
- `props`（固定値・シンボル値・生成時1回ロールの範囲値・`range`とoverflow/shortfall・`stages`・`on_min`・`on_max`、
  6節。シンボル型プロパティの `stages` は `min` を持たず `name` 自体が比較対象になるため、`min` は任意項目）
- rangeイベント（`on_min`/`on_max`/`on_overflow`/`on_shortfall`）の中身: active動詞、またはその代わりの `pick`
  （9.7節・10節）、または空のmapping（`on_shortfall: {}` の「宣言だけして何もしない」、6.3節）
- `passives`（`conditions`/`modify`/`accumulate`を上位、対象（`self`/`parent`/`child`/`ancestor`）を下位に持つ辞書の
  配列、8節。常に配列で単一マッピングでの省略記法はなし。オブジェクトレベル・プロパティレベル・stage内の3箇所）
- `conditions`（プロパティ比較 `{object, prop, op, value}`・スロット位置判定 `{object, in_slot}`・スロット中身判定
  `{object, slot, tag}`・タグ判定 `{object, tag}` の4種の葉を持ち、`all`/`any`/`not`で入れ子にできる条件木、14節。
  `value` はリテラル・`in`/`not_in` 用の配列・`{object, prop}` 参照の三択）
- `active`（`set`/`add`/`destroy`/`spawn`/`transfer`/`move` を上位、対象を下位に持つ辞書、9節。`set` の値は
  リテラル（整数・真偽値・シンボル名）か `{object, prop}` 参照）
- `pick`（重み付き確率分岐、active動詞の代替キー、10節。`weight` はリテラルかプロパティ参照。候補のネスト可）
- `actions`（`showMenu`・`conditions`・`duration`・active動詞・`pick`、11節）
- `combinations`（`with`・`conditions`・active動詞・`pick`、12節。使い分け方針は`ActionSystem.md`）
- `recipes`（`steps`/`requires`/`duration`、13節。内部設計は`RecipeSystem.md`）
- `slots`（`accepts`（`tag` または `object`）・`capacity`・`weight_rate`・`stackable`・`unit_capacity`・
  `fixed_positions`、7節）

### 2.2 対象だが中身を検証しないもの・ローダー未実装のもの

- **地形生成（`axes`/`location_types`/`generation_scopes`、`TerrainGeneration.md`）**: ローダーは実装・ロード済み
  （`WorldCodexYamlLoader.Generation.cs`、`terrain_generation.yaml`）。本スキーマはこの3ルートキーを**許容するが
  中身は検証しない**（`true` スキーマ）。詳細スキーマ化は今後の課題。
- **`covers`/`layer`/`recipes`（object_def直下）・`unit`（prop直下）**: 文法として文書化済みでスキーマにも
  含めているが、ローダーは現時点でこれらのキーを解釈しない（読み飛ばす）。
- **文脈依存の制約**: rangeイベント内は対象が `self` のみ・`move` 不可、`dragged` は combinations 内のみ、
  passivesのゲートの `object` は `self`/`parent`/`ancestor` のみ、といった「どの文脈で書かれたか」に依存する制約は、
  スキーマでは表現せずローダーのロード時チェックに委ねる（スキーマは全文脈の和集合を受理する）。
- **`derived`（導出値、16節・17節）**: 採否そのものが未決定のため含めていません。
- **YAML定義のマージ・上書き規則（3.3節・5節）**: 本スキーマは単一ファイルの構造のみを検証します。trait合成・
  ファイル横断の整合性（参照先idの実在等）はロード時の検証に相当し、対象外です。

## 3. スキーマ化にあたって見つけた既存ドキュメントとの矛盾・気づき（修正済み）

スキーマ化・刷新の過程で以下の矛盾が見つかり、いずれもドキュメント側を修正して解消済みです。

- **タグ判定の葉が文法リファレンス未記載**: `conditions` の葉のうち `{object, tag}`（オブジェクト自身のタグ判定）は
  ローダー（`ConditionNode.ObjectTag`）に実装済みでしたが、`GameElementDefinition.md` 14節に記載がありませんでした。
  刷新時に 14.4節として追記しました（複合ノードは 14.5節へ繰り下げ）。

- **防具サンプルの `item:` フィールド**: `GameElementDefinition.md` 8.1節の防具サンプルには、`object_defs` のキーとは
  別に `item: armor_leather` というフィールドが残っていました。これは 4節で確定している「識別子は `object_defs` の
  キーとして表現する（値ではない）」という規約より前の記法の名残でした。サンプルを `object_defs: { armor_leather: {...} }`
  という形に修正し、規約と一致させました。
- **地形生成の `id` フィールド方式**: `TerrainGeneration.md` の `Axis`/`LocationType`/`generation_scope` サンプルは
  「配列＋`id`フィールド」で書かれており、他の概念すべてが採用している「識別子をキーとする辞書」とは異なる形式でした。
  3.1節・3.2節・4.7節のサンプルを、それぞれ `axes:`/`location_types:`/`generation_scopes:` という識別子キーの辞書形式に
  修正し、他の概念と表記を統一しました。

## 4. スキーマ化にあたって判断した細部（ドキュメント上は未確定・省略されていた点）

以下は、各ドキュメントの記述からは一意に決まらなかったものの、スキーマとして形にするために暫定的に判断した点です。
実装時に見直してください。

- `recipes.*.steps[].requires[].consume` と `slots.*.accepts[].consume` は、既存サンプルが常に明示している（省略例が
  ない）ため、必須項目としました（`accepts[].consume` はローダー上は省略可・既定false）。`quantity` の省略時
  デフォルト（`RecipeSystem.md` 5節で未決定）はスキーマ上も任意項目のままにしています。
- `slots.*.accepts[].max` は、ローダーが必須としているため必須項目としました。
- `actions.*.showMenu` の値は、現時点で確認されている `always` のみを列挙型にしています（ローダーも `always` 以外を
  エラーにします）。
- `weight_rate` の上限は設けていません（`ContainerSystem.md` 4節で「1.0を超えるケースを想定するか」が未決定のため）。
- シンボル型プロパティかどうかは `value` の形（識別子形の文字列）でしか判別できないため、「シンボル型の `stages` に
  `min` を書いたらエラー」「数値型の `value` にシンボルは書けない」といったプロパティ単位の整合はスキーマでは
  検証できず、ロード時チェックに委ねています（2.2節の文脈依存制約と同じ扱い）。

## 5. 使い方

`WorldCodex.schema.json` は JSON Schema Draft 2020-12 準拠です。YAML ファイルをパースして得られるオブジェクトに対して、
一般的な JSON Schema バリデータ（Python の `jsonschema`、Node.js の `ajv` 等）でそのまま検証できます。

```bash
python3 -c "
import json, yaml, jsonschema
schema = json.load(open('Documents/Engine/WorldCodex.schema.json'))
v = jsonschema.Draft202012Validator(schema)
for e in v.iter_errors(yaml.safe_load(open('Assets/StreamingAssets/WorldCodex/core.yaml'))):
    print(list(e.absolute_path), e.message)
"
```

## 6. 未決事項・今後の検討課題

- 地形生成（`axes`/`location_types`/`generation_scopes`）の中身の詳細スキーマ化（2.2節。現在はキーの許容のみ）
- スキーマ検証をCI（テストスイート）へ組み込み、ローダーとスキーマの乖離を自動検知するかどうか
- 本スキーマは単一ファイル内の構造のみを検証するため、「参照している `object` や `trait` の id が実在するか」
  といった、ファイル横断的な整合性チェックは対象外（別途のバリデーションステップ、ロード後の検証に相当）
- `GameElementDefinition.md`・`ActionSystem.md`・`RecipeSystem.md`・`ContainerSystem.md` 側の未決事項
  （各ドキュメントの該当節を参照）が確定するたびに、本スキーマも追随して更新する必要がある

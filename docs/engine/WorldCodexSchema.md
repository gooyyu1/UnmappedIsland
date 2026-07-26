# WorldCodex YAMLスキーマ定義

## 概要

本ドキュメントは、YAML文法の唯一のリファレンスである `GameElementDefinition.md` をもとにした、`WorldCodex` の
YAML ファイルの形式的なスキーマ定義（[JSON Schema](https://json-schema.org/) Draft 2020-12、
`WorldCodex.schema.json`）の保守方針をまとめたものです。個別の世界描写（`ClimateSystem.md`・`RecipeSystem.md`・
`ContainerSystem.md`・`ActionSystem.md`・`TerrainGeneration.md`・`ExplorationSystem.md`）の内容そのものは
スキーマの対象外で、それらが使う文法の妥当性のみを検証します。

スキーマの正は**ローダーの実装**（`src/loader/WorldCodexYamlLoader.ts` と関連する `parse*.ts` モジュール群）です。本スキーマはローダーが
受け付ける文法の機械的な近似であり、乖離を見つけたらローダーに合わせてスキーマを直します。

## 1. 検証方法

`WorldCodex.schema.json` は以下の観点で検証済みです。

- **スキーマ自体の妥当性**: `jsonschema` ライブラリの `Draft202012Validator.check_schema` により、Draft 2020-12として
  構文的に正しいスキーマであることを確認
- **実データ全ファイルの受理**: `public/world-codex/` の全YAMLファイル（`core.yaml`・`locations.yaml`・
  `liquid_containers.yaml`・`containers.yaml`・`foods.yaml`・`characters.yaml`・`terrain_generation.yaml`）が、実際にゲームがロードしている
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

`GameElementDefinition.md` の3〜14節が定める文法全体（ルート構造・`object_defs`/`traits`・`props`・rangeイベント・
`passives`・`conditions`・`active`・`pick`・`actions`・`combinations`・`recipes`・`slots`）。
例外は2.2節を参照。

### 2.2 対象だが中身を検証しないもの・ローダー未実装のもの

- **地形生成（`axes`/`location_types`/`generation_scopes`、`TerrainGeneration.md`）**: ローダーは実装・ロード済み
  （`parseGeneration.ts`、`terrain_generation.yaml`）。本スキーマはこの3ルートキーを**許容するが
  中身は検証しない**（`true` スキーマ）。詳細スキーマ化は今後の課題。
- **`covers`/`layer`/`recipes`（object_def直下）・`unit`（prop直下）**: 文法として文書化済みでスキーマにも
  含めているが、ローダーは現時点でこれらのキーを解釈しない（読み飛ばす）。
- **文脈依存の制約**: rangeイベント内は対象が `self` のみ・`move` 不可、`dragged` は combinations 内のみ、
  passivesのゲートの `object` は `self`/`parent`/`ancestor` のみ、といった「どの文脈で書かれたか」に依存する制約は、
  スキーマでは表現せずローダーのロード時チェックに委ねる（スキーマは全文脈の和集合を受理する）。
- **`derived`（導出値、16節・17節）**: 採否そのものが未決定のため含めていません。
- **YAML定義のマージ・上書き規則（3.3節・5節）**: 本スキーマは単一ファイルの構造のみを検証します。trait合成・
  ファイル横断の整合性（参照先idの実在等）はロード時の検証に相当し、対象外です。

## 3. スキーマ化にあたって判断した細部（ドキュメント上は未確定・省略されていた点）

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

## 4. 使い方

`WorldCodex.schema.json` は JSON Schema Draft 2020-12 準拠です。YAML ファイルをパースして得られるオブジェクトに対して、
一般的な JSON Schema バリデータ（Python の `jsonschema`、Node.js の `ajv` 等）でそのまま検証できます。

```bash
python3 -c "
import json, yaml, jsonschema
schema = json.load(open('docs/engine/WorldCodex.schema.json'))
v = jsonschema.Draft202012Validator(schema)
for e in v.iter_errors(yaml.safe_load(open('public/world-codex/core.yaml'))):
    print(list(e.absolute_path), e.message)
"
```

## 5. 未決事項・今後の検討課題

- 地形生成（`axes`/`location_types`/`generation_scopes`）の中身の詳細スキーマ化（2.2節。現在はキーの許容のみ）
- スキーマ検証をCI（テストスイート）へ組み込み、ローダーとスキーマの乖離を自動検知するかどうか
- 本スキーマは単一ファイル内の構造のみを検証するため、「参照している `object` や `trait` の id が実在するか」
  といった、ファイル横断的な整合性チェックは対象外（別途のバリデーションステップ、ロード後の検証に相当）
- `GameElementDefinition.md`・`ActionSystem.md`・`RecipeSystem.md`・`ContainerSystem.md` 側の未決事項
  （各ドキュメントの該当節を参照）が確定するたびに、本スキーマも追随して更新する必要がある

# WorldCodex YAMLスキーマ定義

## 概要

本ドキュメントは、これまでの設計議論（`GameElementDefinition.md`・`TerrainGeneration.md`・`ClimateSystem.md`・
`PickSystem.md`・`ActionSystem.md`・`RecipeSystem.md`・`ContainerSystem.md`）をもとに、`WorldCodex` の YAML ファイルの
形式的なスキーマ定義（[JSON Schema](https://json-schema.org/) Draft 2020-12、`WorldCodex.schema.json`）を作成した結果を
まとめたものです。

本ドキュメントは検討結果であり、確定仕様書ではありません。スキーマ自体も、各ドキュメントに残る未決事項がそのまま
反映された、現時点のスナップショットです。

`passive`/`active`/`on_zero`（`destroy`/`spawn` を束ねていた `lifecycle` 入れ子の廃止を含む）への刷新後の
`GameElementDefinition.md`・`ActionSystem.md`・`ClimateSystem.md`・`PickSystem.md`・`RecipeSystem.md` に合わせて
本スキーマも追随済みです。

## 1. 検証方法

`WorldCodex.schema.json` は以下の観点で検証済みです。

- **スキーマ自体の妥当性**: `jsonschema` ライブラリの `Draft202012Validator.check_schema` により、Draft 2020-12として
  構文的に正しいスキーマであることを確認
- **既存サンプルの受理**: 各ドキュメントに掲載されている実際のYAMLサンプル（`eat`/`move` アクション、`world` シングルトン、
  防具・耐久値（`passive`の`accumulate`＋`on_zero`の`destroy`）・細菌感染、`traits`、`combinations` の `chop`
  （`active` の `spawn`＋`destroy`）、`pick` を使った攻撃・生水・探索、レシピ、`slots` の `accepts`/`capacity`/`weight_rate`）を
  抽出し、すべてスキーマを満たすことを確認
- **不正な記述の拒否**: `active` と `pick` を同時に指定する、identifier の命名規則に反するキーを使う、未定義の
  比較演算子を使う、`passive`/`active` に未定義の対象キー（`sibling` など）を使う、`combinations` に `with` を書き忘れる、
  `active` の対象キーに `add`/`destroy`/`spawn` を1つも指定しない、廃止済みの `lifecycle` 入れ子を使う、pick候補が
  `active` と `pick` を同時に持つ、といった誤った記述が、想定通り拒否されることを確認

## 2. スキーマの範囲

### 2.1 含めたもの

- ルート構造（`object_defs`/`traits`、専用ルートキーなし）
- `object_defs`/`traits`（3〜5節）
- `props`（固定値・範囲値・overflow・stages・`on_zero`、6節）
- `passive`（対象をキーとする辞書、`when`、`modify`/`accumulate`、8.2〜8.3節）
- `active`（対象をキーとする辞書、`add`/`destroy`/`spawn`、8.2〜8.3節）
- `pick`（重み付き確率分岐、`active` の代替キー、`PickSystem.md`）
- `actions`（`showMenu`・`conditions`・`active`/`pick`、8.1節）
- `combinations`（`with`・`conditions`・`active`/`pick`、`ActionSystem.md`）
- `recipes`（`steps`/`requires`/`duration`、`RecipeSystem.md`）
- `slots`（`accepts`/`capacity`/`weight_rate`、7.1節・`RecipeSystem.md`・`ContainerSystem.md`）
- `singleton`・`covers`/`layer`（9節・7.2節）

### 2.2 意図的に対象外としたもの

- **地形生成（`Axis`/`LocationType`/`StructureType`/`generation_scope`、`TerrainGeneration.md`）**: サンプルの表記は
  `object_defs`/`traits`/`actions`/`combinations`/`recipes` と同じ「識別子をキーとする辞書」形式に統一済みです（3節）が、
  `TerrainGeneration.md` 自体が「実装・詳細スキーマ化は本書を土台に別途進める」と明記している検討中の段階であり、
  フィールド名・型・軸空間マッチングの詳細などがまだ確定していません。この状態で無理にスキーマ化すると、他の部分
  より不確かな内容に過剰な確からしさを与えてしまうため、今回は対象外としました。
- **`derived`（導出値、6.5節）**: 採否そのものが未決定のため含めていません。
- **`ancestor`/`sibling`/`descendant`（`target`拡張、8.2節）**: 必要性が生じた時点で改めて検討するとされているため
  含めていません。
- **ステージのedge-triggered効果（`on_enter`的なもの、6.4節）**: 将来検討事項として保留中のため含めていません。
- **YAML定義のマージ・上書き規則（3.4節）**: 「別途仕様書で定義する」とされている未着手事項のため、複数ファイルに
  またがる結合の挙動はスキーマの対象外です（本スキーマは単一ファイルの構造のみを検証します）。

## 3. スキーマ化にあたって見つけた既存ドキュメントとの矛盾・気づき（修正済み）

スキーマ化の過程で以下の2点の矛盾が見つかり、いずれもドキュメント側を修正して解消済みです。

- **防具サンプルの `item:` フィールド**: `GameElementDefinition.md` 11.1節の防具サンプルには、`object_defs` のキーとは
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
  ない）ため、必須項目としました。`quantity` の省略時デフォルト（`RecipeSystem.md` 9節で未決定）はスキーマ上も
  任意項目のままにしています。
- `slots.*.accepts[].max` は、既存サンプルが常に明示しているため必須項目としました。
- `actions.*.showMenu` の値は、現時点で確認されている `always` のみを列挙型にしています。将来値が増える場合は
  スキーマの拡張が必要です（8.1節の想定通り）。
- `weight_rate` の上限は設けていません（`ContainerSystem.md` 6節で「1.0を超えるケースを想定するか」が未決定のため）。

## 5. 使い方

`WorldCodex.schema.json` は JSON Schema Draft 2020-12 準拠です。YAML ファイルをパースして得られるオブジェクトに対して、
一般的な JSON Schema バリデータ（Python の `jsonschema`、Node.js の `ajv` 等）でそのまま検証できます。

## 6. 未決事項・今後の検討課題

- 地形生成（`Axis`/`LocationType`等）のスキーマ化（2.2節・3節参照。記法の統一が先決）
- 複数ファイルにまたがる同一IDのマージ・上書き規則が確定した後、その挙動をスキーマ、あるいはスキーマとは別の
  ロード時バリデーションのどちらで表現するか
- 本スキーマは単一ファイル内の構造のみを検証するため、「参照している `object` や `trait` の id が実在するか」
  といった、ファイル横断的な整合性チェックは対象外（別途のバリデーションステップ、3.3節で言及されている
  ロード後の検証に相当）
- `GameElementDefinition.md`・`ActionSystem.md`・`PickSystem.md`・`RecipeSystem.md`・`ContainerSystem.md` 側の未決事項
  （各ドキュメントの該当節を参照）が確定するたびに、本スキーマも追随して更新する必要がある

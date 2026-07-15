# WorldCodex YAMLスキーマ定義

## 概要

本ドキュメントは、これまでの設計議論（`GameElementDefinition.md`・`TerrainGeneration.md`・`ClimateSystem.md`・
`PickSystem.md`・`ActionSystem.md`・`RecipeSystem.md`・`ContainerSystem.md`）をもとに、`WorldCodex` の YAML ファイルの
形式的なスキーマ定義（[JSON Schema](https://json-schema.org/) Draft 2020-12、`WorldCodex.schema.json`）を作成した結果を
まとめたものです。

本ドキュメントは検討結果であり、確定仕様書ではありません。スキーマ自体も、各ドキュメントに残る未決事項がそのまま
反映された、現時点のスナップショットです。

## 1. 検証方法

`WorldCodex.schema.json` は以下の観点で検証済みです。

- **スキーマ自体の妥当性**: `jsonschema` ライブラリの `Draft202012Validator.check_schema` により、Draft 2020-12として
  構文的に正しいスキーマであることを確認
- **既存サンプルの受理**: 各ドキュメントに掲載されている実際のYAMLサンプル（`eat`/`move` アクション、`world` シングルトン、
  防具・耐久値・細菌感染、`traits`、`combinations` の `chop`、`pick` を使った攻撃・生水・探索、レシピ、`slots` の
  `accepts`/`capacity`/`weight_rate`）を抽出し、すべてスキーマを満たすことを確認
- **不正な記述の拒否**: `effects` と `pick` を同時に指定する、identifier の命名規則に反するキーを使う、未定義の
  比較演算子を使う、`effects` に未定義の対象キー（`sibling` など）を使う、`combinations` に `with` を書き忘れる、
  `lifecycle` に動詞を1つも指定しない、trait が他の trait を参照する、といった誤った記述が、想定通り拒否されることを確認

## 2. スキーマの範囲

### 2.1 含めたもの

- ルート構造（`object_defs`/`traits`、専用ルートキーなし）
- `object_defs`/`traits`（3〜5節）
- `props`（固定値・範囲値・overflow・stages、6節）
- `effects`（対象をキーとする辞書、`when`、`modify`/`add`/`lifecycle`、8.2〜8.3節）
- `pick`（重み付き確率分岐、`effects` の代替キー、`PickSystem.md`）
- `actions`（`showMenu`・`conditions`・`effects`/`pick`、8.1節）
- `combinations`（`with`・`conditions`・`effects`/`pick`、`ActionSystem.md`）
- `recipes`（`steps`/`requires`/`duration`、`RecipeSystem.md`）
- `slots`（`accepts`/`capacity`/`weight_rate`、7.1節・`RecipeSystem.md`・`ContainerSystem.md`）
- `singleton`・`covers`/`layer`（9節・7.2節）

### 2.2 意図的に対象外としたもの

- **地形生成（`Axis`/`LocationType`/`StructureType`/`generation_scope`、`TerrainGeneration.md`）**: このドキュメント自体が
  「実装・詳細スキーマ化は本書を土台に別途進める」と明記している検討中の段階であり、加えて 3 節で確認した通り、
  掲載されているサンプルが「配列＋`id`フィールド」という形式で書かれています。これは `object_defs`/`traits`/`actions`/
  `combinations`/`recipes` が徹底している「識別子をキーとして表現する」という規約（3節）と矛盾しており、地形生成側の
  記法をどちらに揃えるかがまだ解決していません。この状態で無理にスキーマ化すると、他の部分より不確かな内容に
  過剰な確からしさを与えてしまうため、今回は対象外としました。
- **`derived`（導出値、6.5節）**: 採否そのものが未決定のため含めていません。
- **`ancestor`/`sibling`/`descendant`（`target`拡張、8.2節）**: 必要性が生じた時点で改めて検討するとされているため
  含めていません。
- **ステージのedge-triggered効果（`on_enter`的なもの、6.4節）**: 将来検討事項として保留中のため含めていません。
- **YAML定義のマージ・上書き規則（3.4節）**: 「別途仕様書で定義する」とされている未着手事項のため、複数ファイルに
  またがる結合の挙動はスキーマの対象外です（本スキーマは単一ファイルの構造のみを検証します）。

## 3. スキーマ化にあたって見つけた既存ドキュメントとの矛盾・気づき

- **防具サンプルの `item:` フィールド**: `GameElementDefinition.md` 11.1節の防具サンプルには、`object_defs` のキーとは
  別に `item: armor_leather` というフィールドが残っています。これは 4節で確定している「識別子は `object_defs` の
  キーとして表現する（値ではない）」という規約より前の記法の名残とみられ、本スキーマでは `item` フィールドを
  定義せず、識別子は `object_defs` のキー（例: `object_defs.armor_leather`）で表現する前提にしています。サンプル側の
  表記を後で揃えることをお勧めします。
- **地形生成の `id` フィールド方式**: 2.2節で述べた通り、`TerrainGeneration.md` の `Axis`/`LocationType` サンプルは
  「配列＋`id`フィールド」で書かれており、他の概念すべてが採用している「識別子をキーとする辞書」とは異なる形式です。
  地形生成のスキーマ化を進める際は、他と揃えて辞書形式にするか、あるいは地形生成だけ配列形式を維持する理由を
  明確にするか、どちらかを決める必要があります。

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

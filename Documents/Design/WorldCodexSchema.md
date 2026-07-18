# WorldCodex YAMLスキーマ定義

## 概要

本ドキュメントは、YAML文法の唯一のリファレンスである `GameElementDefinition.md`（`traits`/`object_defs`/`props`/
`slots`/`passives`/`active`/`pick`/`actions`/`combinations`/`recipes` 等の文法をすべて集約したもの）をもとに、
`WorldCodex` の YAML ファイルの形式的なスキーマ定義（[JSON Schema](https://json-schema.org/) Draft 2020-12、
`WorldCodex.schema.json`）を作成した結果をまとめたものです。個別の世界描写（`ClimateSystem.md`・`RecipeSystem.md`・
`ContainerSystem.md`・`ActionSystem.md`・`TerrainGeneration.md`）の内容そのものはスキーマの対象外で、それらが使う
文法の妥当性のみを検証します。

本ドキュメントは検討結果であり、確定仕様書ではありません。スキーマ自体も、`GameElementDefinition.md` に残る
未決事項がそのまま反映された、現時点のスナップショットです。

## 1. 検証方法

`WorldCodex.schema.json` は以下の観点で検証済みです。

- **スキーマ自体の妥当性**: `jsonschema` ライブラリの `Draft202012Validator.check_schema` により、Draft 2020-12として
  構文的に正しいスキーマであることを確認
- **既存サンプルの受理**: 各ドキュメントに掲載されている実際のYAMLサンプル（`eat`/`move` アクション、`world` シングルトン、
  防具・耐久値（`passives`の`accumulate`＋`on_min`の`destroy`）・細菌感染、`traits`、`combinations` の `chop`
  （`spawn`＋`destroy`）、`pick` を使った攻撃・生水・探索、レシピ、`slots` の `accepts`/`capacity`/`weight_rate`）を
  抽出し、すべてスキーマを満たすことを確認
- **不正な記述の拒否**: `set`/`add`/`destroy`/`spawn` と `pick` を同時に指定する、identifier の命名規則に反する
  キーを使う、未定義の比較演算子を使う、`passives`/`set`/`add` に未定義の対象キー（`sibling` など）を使う、
  `combinations` に `with` を書き忘れる、廃止済みの `active:`/`lifecycle` 入れ子を使う、`passives` を配列でなく
  単一マッピングで書く、`conditions` の葉に `slot` と `prop` を同時指定する、廃止済みの `path:`/`when:` 記法を
  使う、pick候補が `set`/`add`/`destroy`/`spawn` と `pick` を同時に持つ、といった誤った記述が、想定通り
  拒否されることを確認

## 2. スキーマの範囲

### 2.1 含めたもの

- ルート構造（`object_defs`/`traits`、専用ルートキーなし）
- `object_defs`/`traits`（3〜5節）
- `props`（固定値・範囲値・overflow/shortfall・stages・`on_min`・`on_max`、6節）
- `passives`（`conditions`/`modify`/`accumulate`を上位、対象を下位に持つ辞書の配列、8節。常に配列で単一マッピング
  での省略記法はなし。オブジェクトレベル・プロパティレベルの`passives:`キー。stage内も`name`/`min`と並ぶ兄弟キー
  として同じ`passives:`（配列）を持つ、6.4節）
- `conditions`（`{object, prop, op, value}`のプロパティ比較か`{object, slot}`のスロット判定を葉に持ち、
  `all`/`any`/`not`で入れ子にできる条件木、14節。トップレベルは常に配列で暗黙のall。actions/combinationsの
  一度きりの判定とpassivesの持続的なゲートの両方がこの同じ形を共用する）
- `active`（`set`/`add`/`destroy`/`spawn`を上位、対象を下位に持つ辞書、9節。専用のYAMLキーは持たず、
  actions/combinations/pickの各エントリへ他の兄弟キーと対等に直接展開する）
- `pick`（重み付き確率分岐、`set`/`add`/`destroy`/`spawn`の代替キー、10節）
- `actions`（`showMenu`・`conditions`・`set`/`add`/`destroy`/`spawn`・`pick`、11節）
- `combinations`（`with`・`conditions`・`set`/`add`/`destroy`/`spawn`・`pick`、12節。使い分け方針は`ActionSystem.md`）
- `recipes`（`steps`/`requires`/`duration`、13節。内部設計は`RecipeSystem.md`）
- `slots`（`accepts`/`capacity`/`weight_rate`、7節。内部設計は`RecipeSystem.md`・`ContainerSystem.md`）
- `singleton`・`covers`/`layer`（15節・7.5節）

### 2.2 意図的に対象外としたもの

- **地形生成（`Axis`/`LocationType`/`StructureType`/`generation_scope`、`TerrainGeneration.md`）**: サンプルの表記は
  `object_defs`/`traits`/`actions`/`combinations`/`recipes` と同じ「識別子をキーとする辞書」形式に統一済みです（3節）が、
  `TerrainGeneration.md` 自体が「実装・詳細スキーマ化は本書を土台に別途進める」と明記している検討中の段階であり、
  フィールド名・型・軸空間マッチングの詳細などがまだ確定していません。この状態で無理にスキーマ化すると、他の部分
  より不確かな内容に過剰な確からしさを与えてしまうため、今回は対象外としました。
- **`derived`（導出値、16節・17節）**: 採否そのものが未決定のため含めていません。
- **`ancestor`/`sibling`/`descendant`（対象キーの拡張、8.1節・9.1節・17節）**: 必要性が生じた時点で改めて検討する
  とされているため含めていません。
- **ステージのedge-triggered効果（`on_enter`的なもの、6.4節・17節）**: 将来検討事項として保留中のため含めていません。
- **YAML定義のマージ・上書き規則（3.3節）**: 「別途仕様書で定義する」とされている未着手事項のため、複数ファイルに
  またがる結合の挙動はスキーマの対象外です（本スキーマは単一ファイルの構造のみを検証します）。

## 3. スキーマ化にあたって見つけた既存ドキュメントとの矛盾・気づき（修正済み）

スキーマ化の過程で以下の2点の矛盾が見つかり、いずれもドキュメント側を修正して解消済みです。

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
  ない）ため、必須項目としました。`quantity` の省略時デフォルト（`RecipeSystem.md` 5節で未決定）はスキーマ上も
  任意項目のままにしています。
- `slots.*.accepts[].max` は、既存サンプルが常に明示しているため必須項目としました。
- `actions.*.showMenu` の値は、現時点で確認されている `always` のみを列挙型にしています。将来値が増える場合は
  スキーマの拡張が必要です（`GameElementDefinition.md` 11.1節の想定通り）。
- `weight_rate` の上限は設けていません（`ContainerSystem.md` 4節で「1.0を超えるケースを想定するか」が未決定のため）。

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
- `GameElementDefinition.md`・`ActionSystem.md`・`RecipeSystem.md`・`ContainerSystem.md` 側の未決事項
  （各ドキュメントの該当節を参照）が確定するたびに、本スキーマも追随して更新する必要がある

# 世界記述YAML仕様書

## 1. 目的・概要

本ドキュメントは、UnmappedIsland のゲーム内世界を記述する YAML ファイルの構造について、
設計者と AI アシスタントの議論を通じて固まった方針を正式な仕様として整理したものです。

`GameElementDefinition.md` が定める「ハードコードしない」「汎用エンジンに任せる」「ファイル追加だけで拡張できる」という方針の下、
型定義（`ObjectDef`）・実行時インスタンス（`ObjectInstance`）・世界全体（`WorldCodex`）という 3 つの概念のうち、
本仕様では **`ObjectDef` 側の構造**を先に固めます。`ObjectInstance` 側の詳細フォーマットは未着手です。

本ドキュメントは検討結果であり、確定仕様書ではありません。「確定事項」は議論済みの決定としてそのまま記載しますが、
「未決事項」は結論が出ていないため、各節および末尾の一覧に **TODO: 未決定** として明記し、選択肢のみを提示します。
また、元の議論メモに含まれていたサンプル YAML のうち、他節の確定事項と矛盾していた箇所は、
本仕様に合わせて整えた上で **修正メモ** として明示しています。

## 2. 全体方針

### 2.1 ルート構造

- ファイル全体が 1 つの `WorldCodex` を表します。**専用のルートキーは置きません**（ファイル自体が `WorldCodex` です）。

### 2.2 命名規則

- 構造キーワード（`props`、`traits`、`actions` など）・型名・プロパティ名は、**すべて snake_case** で統一します。非プログラマも編集するため、camelCase との混在を避けます。
- id（型名・プロパティ名・トレイト名・アクション名・スロット名に共通）の命名規則は次の正規表現に従います。

  ```
  ^[a-z][a-z0-9_]*$
  ```

### 2.3 パーサ要件（重複キーの扱い）

YAML 仕様上マッピングキーは一意であるべきですが、多くのパーサ実装（素の PyYAML 等）は重複キーをエラーにせず後勝ちで上書きします。
これは MOD 由来の記述ミスなどを静かに握りつぶす危険があるため、以下の二重の安全策を仕様として明記します。

- ローダーは重複キー検出でエラーを出す**厳格モード**を使用する
- 加えて、ロード後に別途**バリデーションステップ**を設ける

## 3. object_defs（型定義）

型定義は `object_defs` の下に、識別子を**キーとして**表現します（値ではありません）。

```yaml
object_defs:
  stone:
    props:
      weight:
        value: 10
```

## 4. traits（mixin）

記述量削減のため、複数の `object_def` で共有するプロパティ群を `traits` として定義できます。

- **多重継承は禁止**: trait が他の trait を参照することはできません（1 階層のみ）。
- **プロパティ衝突はエラー**: 複数の trait が同名プロパティを宣言していた場合、暗黙の優先順位で解決せずエラーとします（安全側に倒す）。
- **値の扱い**:
  - trait 側で `value` を持たないプロパティ = object_def 側で値を与えることが必須
  - trait 側で `value` を持つプロパティ = デフォルト値。object_def 側で省略可、上書きも可
  - object_def 側で一部属性（例: `value`）だけを上書きした場合、残りの属性（`unit` など）は trait 側の値を引き継ぐ

```yaml
traits:
  perishable:
    props:
      shelf_life:      # valueなし→継承先で必須
        unit: days
      decay_rate:
        value: {min: 1, max: 3}   # valueあり→デフォルト値(範囲値は5節参照)

object_defs:
  apple:
    traits: [perishable]
    props:
      shelf_life:
        value: 7
```

## 5. props（固定値・範囲値・overflow）

### 5.1 固定値

最も単純な形は、`value` に固定値を 1 つ持つだけの形です（3 節の `stone.props.weight` を参照）。

### 5.2 範囲値（ランダム再ロール）

固定値の代わりに `{min, max}` の範囲を `value` に持たせ、**毎 tick ごとに範囲内でランダムに値を再ロール**できる仕組みを持ちます。
腐敗速度・天候の持続時間など、複数の用途で共有する汎用プリミティブとして設計します。

```yaml
props:
  decay_rate:
    value: {min: 1, max: 3}   # 毎tick、この範囲でロールした量を減算する
```

> **TODO: 未決定** — 天候の遷移そのもの（いつ・どの天候に切り替わるか）のランダム性の仕組みは未検討です。
> 持続時間を `{min, max}` の範囲値として表現すること自体は本節の仕組みを流用できますが、
> 「どの天候に遷移するか」の選択ロジック（重み付き抽選など）は別途検討が必要です。

### 5.3 overflow（周回・上限のあるプロパティ）

時刻のように上限に達したら折り返す（あるいは繰り上げる）プロパティのため、`range` と `on_overflow` を持たせます。
`value` の `{min, max}`（5.2 節、毎 tick 再ロールする範囲）とは異なる仕組みである点に注意してください。
`range` は値が取りうる上下限、`on_overflow` は上限到達時の挙動を表します。

```yaml
props:
  minute_of_day:
    value: 0
    range: {min: 0, max: 1439}
    on_overflow: {mode: wrap, carry_to: day}   # 1440でdayに+1して0に戻る
  sequence:
    value: 0
    on_overflow: {mode: none}                   # 上限なし
```

> **TODO: 未決定** — `day` は上限なく増え続ける想定か、年単位で wrap し `year` プロパティを別途持つ想定か、未決定です。
> - 案A: `day` は無制限に加算され続ける（`on_overflow: {mode: none}`）
> - 案B: `day` は年単位（例: 360 日）で `year` に繰り上げて wrap する（`on_overflow: {mode: wrap, carry_to: year}`）

## 6. derived（導出値）※必要性は未確定

「他の props から計算される値」という概念（derived）を検討しましたが、**必要性はまだ十分に納得されていません**。
本節全体を **TODO: 未決定** として扱い、安易に採用せず、検討中の案として軽く触れるに留めます。

議論の中では、明るさの 3 段階化（暗い/手元作業可/明るい）について、連続値を tick ごとに加算し続けるより、
`minute_of_day` から都度算出する方が非線形な変化（閾値での切り替え）を扱いやすいという意見が出ました。
この用途に限り、次のような「段階テーブル」形式が候補として挙がっていますが、確定ではありません。

```yaml
# 検討中の案(未確定)
light_stage:
  derived_from: minute_of_day
  rule:
    type: stage_table
    stages:
      - {until: 359, value: dark}
      - {until: 1079, value: bright}
      - {until: 1439, value: dim}
```

季節についても「暑い寒い」「乾季雨季」のような荒い段階分けが望ましいとされましたが、同様に derived を使うかどうかは未確定です。

> **TODO: 未決定**
> - 案A: derived という概念自体を採用しない（`light_stage` 等も通常の `props` として tick ごとに直接更新する）
> - 案B: derived を採用し、`derived_from` + `rule`（`stage_table` など）で他 props からの導出式を宣言する

## 7. actions と条件式

- アクション（`eat`、`move` など）は、能動的に何かを書き換える「effect」システムではなく、**宣言的な条件リスト**を持つだけの受動的な仕組みとします。
- アクションは `object_defs` および `traits` の中に配置します（トップレベル独立キーにはしません）。これにより、traits 経由でアクションもまとめて配布できます（例: `eatable` trait が `eat` アクションと関連 props をセットで提供する）。

```yaml
traits:
  eatable:
    props:
      satiety_restore:
        value: 10
    actions:
      eat:
        conditions:
          - {path: self.satiety, op: lt, value: max}
```

明るさで移動可否を制御する例です。

```yaml
object_defs:
  world:
    singleton: true
    props:
      light_stage:
        value: bright   # 6節の議論次第でderivedになる可能性あり(未確定)

  character:
    props:
      hp:
        value: 100
    actions:
      move:
        conditions:
          - {path: world.light_stage, op: in, value: [bright, dim]}
```

> **修正メモ**: 元の議論メモでは `move` アクションがトップレベルの `actions:` キー直下に記載されていましたが、
> これは「アクションは object_defs / traits の中に配置し、トップレベル独立キーにはしない」という本節の確定事項と矛盾します。
> 本仕様では `move` を `object_defs.character.actions` の下に配置する形に修正しています。

条件式は `{path, op, value}` の形を取ります。`path` は参照ルートから始まるドット区切りのパスです。
現時点で定義されている参照ルートは `self`（行動主体自身）と `world`（環境シングルトン、8 節参照）の 2 つです。

> **TODO: 未決定**
> - 条件式の参照パスのルートとして `self` / `world` 以外に、`target`（対象オブジェクト）が必要か（例:「相手が眠っていたら攻撃できない」）
> - 比較演算子は `lt` / `lte` / `gt` / `gte` / `eq` / `neq` / `in` / `not_in` で十分か、`between` 等の追加が必要か

## 8. slots

`character` のように、ステータスバー表示用の `props`（HP 等のステータス、スキル）に加えて、装備品・所持品・怪我などを格納する
**子スロット（slots）**という、props とは別種の概念を持つオブジェクトがあります。props は値の入れ物、slots は他オブジェクトを格納するコンテナです。

```yaml
object_defs:
  character:
    props:
      hp:
        value: 100
    slots:
      equipment: {}
      inventory: {}
      injuries: {}
```

> **TODO: 未決定**
> - slot に容量・サイズ制限を設けるか。設けるとして、slot 単位で持つか、親オブジェクト（character）側で一括管理するか
>   （複数 slot が同じ制約（例: 重量上限）を共有するなら親側、slot ごとに独立なら slot 側、という判断基準が候補に挙がっている）
> - slot に格納可能なオブジェクトの型制約の指定方法
> - `slots` は character 専有の概念か、コンテナ全般（宝箱等）で使い回す汎用概念か

## 9. singletonオブジェクト（world）の扱い

ゲーム動作に必須ないくつかの情報（日時、天候、明るさ等）を持つ、唯一のインスタンスを想定しています。
「インスタンスが 1 つだけ存在すべき」という制約は、専用のルートキーを作るのではなく、`object_defs` のエントリに小さなフラグ（`singleton: true`）を追加することで表現します。

```yaml
object_defs:
  world:
    singleton: true
    props:
      sequence:
        value: 0
        on_overflow: {mode: none}
      day:
        value: 1
        on_overflow: {mode: none}   # TODO: 未決定。年単位でのwrapについては5.3節を参照
      minute_of_day:
        value: 0
        range: {min: 0, max: 1439}
        on_overflow: {mode: wrap, carry_to: day}
      weather:
        value: clear
```

> **修正メモ**: 元の議論メモでは `datetime` という 1 つの prop の下に `{sequence, day, minute_of_day}` をまとめた
> compound value として記載されていました。しかし本文では「`sequence`・`day`・`minute_of_day` の 3 つを**分けて持つ**」と明記されており、
> かつ 5.3 節の overflow 機構は prop 単位（`range` / `on_overflow`）で定義される仕組みです。
> compound value の内側の要素それぞれに overflow 設定を紐づける手段は定義されていないため、本仕様では 3 つを独立した props として展開しています。

日時・天候はオブジェクトから直接参照されるのではなく、**環境がオブジェクトに影響を与える**という位置づけです（例: 明るさによって行動可否が変わる）。
直接のプロパティ参照経路（`world.xxx` のようなパス表記）は 7 節の action 条件式で使う想定です。

## 10. terrain / 島生成

地形は `object_defs` の一種として表現しますが、島の自動生成アルゴリズムが必要とする属性群があります。
これは新しい構造を作らず、**trait として必須 props を宣言する**ことで表現します。

```yaml
traits:
  terrain_candidate:
    props:
      generation_weight: {}   # valueなし→object_def側で必須

object_defs:
  forest:
    traits: [terrain_candidate]
    props:
      generation_weight:
        value: 5
```

> **修正メモ**: 元の議論メモでは `generation_weight:` の下に何も続かず（YAML 上は `null` になる）記載されていましたが、
> 4 節の「value なしプロパティ」は空のマッピング（`{}`）として表現する形に統一されているため、本仕様でもそれに揃えています。

## 11. 未決事項一覧

以下は、本仕様書内で TODO として挙げた未決定事項の再掲です。いずれもまだ結論が出ていないため、
実装時にはここで挙げた選択肢の中から改めて議論・決定してください。

- 天候遷移自体（いつ・どの天候に切り替わるか）のランダム性の仕組み（5.2 節）
- `day` の上限（無制限のまま加算し続けるか、年単位で wrap して `year` プロパティを持つか）（5.3 節）
- derived の採用可否、および採用する場合の仕様詳細（6 節）
- action 条件式の参照パスのルートとして `target`（対象オブジェクト）が必要か（7 節）
- action 条件式の比較演算子セット（`lt`/`lte`/`gt`/`gte`/`eq`/`neq`/`in`/`not_in`）の過不足（7 節）
- slot の容量制限の持たせ方（slot 単位 or 親オブジェクト単位）、および型制約の指定方法（8 節）
- `slots` 概念が character 専用か、汎用コンテナ概念か（8 節）

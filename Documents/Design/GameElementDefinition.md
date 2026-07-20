# WorldCodex YAML 文法リファレンス

## 1. 位置づけ

本ドキュメントは、`WorldCodex`（ゲーム内のあらゆる要素を定義する YAML）の**文法そのもの**を体系的にまとめた、唯一の
リファレンスです。`traits`・`object_defs`・`props`・`stages`・`slots`・`combinations`・`recipes`・`passives`・`active`・
`modify`・`accumulate`・`add`・`destroy`・`spawn`・`pick`・`actions`・`conditions` など、YAML 上のキーワードの意味と
書き方はすべてここに集約します。

本書が定めるのは**文法**だけです。その文法を使って気候・レシピ・重さ・カード間の相互作用といった**具体的なゲーム内容を
どう表現するか**は、以下の別ドキュメントに切り出しています。

- `ClimateSystem.md` — 季節・天候
- `RecipeSystem.md` — アイテムの製作
- `ContainerSystem.md` — コンテナの容量・重さ
- `ActionSystem.md` — カード間相互作用（`actions`/`combinations`）の使い分け方針
- `TerrainGeneration.md` — 地形生成

形式的なスキーマ定義（[JSON Schema](https://json-schema.org/)）は `WorldCodex.schema.json`（メタ情報は
`WorldCodexSchema.md`）を参照してください。本書はスキーマの人間向け解説を兼ねますが、機械的な検証はスキーマ側が担います。

本書は現時点の確定した文法を記述します。未決定の論点は個別に触れず、17 節にまとめています。

## 2. 設計原則

- **統一的な実行エンジン**: あらゆる概念を共通の枠組み・単一の汎用エンジンで表現し、概念ごとの専用ロジックを増やしません。
- **tick 駆動**: 時間経過にともなう変化は、すべて tick ごとの独立変数への加減算（`accumulate`）で表現します。計算式による
  導出（`derived`）は採用していません（17 節）。
- **範囲による状態決定**: 数値プロパティの値域から状態（`stages`）を決定する仕組みを型定義レベルで共通化します。
- **ハードコードしない／ファイル追加だけで拡張できる**: 挙動は YAML 定義に置き、MOD 作成者がファイル追加だけで新要素を
  導入・上書きできるようにします。

## 3. ファイル構造とロード

### 3.1 ルート構造

ファイル全体が 1 つの `WorldCodex` を表します。専用のルートキーは置かず、`object_defs` と `traits` の 2 つだけを
トップレベルキーとして持ちます。

### 3.2 命名規則

- 構造キーワード（`props`、`traits`、`actions` など）・型名・プロパティ名は、すべて **snake_case** で統一します。
- 識別子（型名・プロパティ名・トレイト名・アクション名・スロット名・タグ名に共通）は次の正規表現に従います。

  ```
  ^[a-z][a-z0-9_]*$
  ```

### 3.3 ロードとバリデーション

- YAML ファイルは所定のディレクトリ以下のすべてのファイルが自動的に読み込まれます。ゲーム本体の定義と MOD の定義は
  別ディレクトリに配置し、双方を混在させずに管理します（例: ゲーム本体は `core`/`terrains`/`foods`/`tools` など
  複数ファイルに分割し、ユーザー定義は別途の外部ディレクトリに置く）。
- マッピングキーの重複は、ローダーの**厳格モード**でエラーにします（多くの YAML パーサはデフォルトで重複キーを
  後勝ちで黙って上書きするため、明示的な安全策として必要です）。
- ロード後に別途**バリデーションステップ**を設けます。
- 同じ ID を持つ定義が複数のファイルに存在する場合のマージ・上書き規則:
  - **同一ディレクトリ内**（同一の情報源、例: ゲーム本体の `core.yaml` と `foods.yaml`）での重複はエラーとします。
  - **異なるディレクトリ間**（例: ゲーム本体のディレクトリと MOD のディレクトリ）では、後から読み込んだ
    ディレクトリの定義が同名の定義を上書きします。MOD がゲーム本体の定義を差し替えられるようにするためです。

## 4. object_defs（型定義）

型定義は `object_defs` の下に、識別子を**キーとして**表現します（値ではありません）。

```yaml
object_defs:
  stone:
    props:
      weight:
        value: 10
```

### 4.1 tags

`tags` に文字列の配列を書くと、その `object_def` にタグを付けられます。`traits`（5節）も同じ `tags` フィールドを
持て、その trait を参照するあらゆる `object_def` へタグが合成されます（tags 自体は `props`/`slots` のような
識別子をキーとする構造ではなく単純な集合なので、複数の trait 間・trait と object_def 自身の間で同じタグが
重複しても衝突エラーにはなりません）。

```yaml
traits:
  location:
    tags: [location]
object_defs:
  forest:
    traits: [location]   # traitのtagsが合成され、locationタグを持つ
  beach:
    tags: [location]     # locationトレイトを一切参照しなくても、直接同じタグを宣言できる
```

タグは、`slots.accepts`（7.2節）・`combinations.with`（12.1節）が型・グループを指定する唯一の手段です。
`object_defs` の id や trait 名では直接マッチングしません（trait は合成後に消えてしまう存在であり、外部から
参照すべきではないため）。同一の trait を参照していない `object_def` 同士でも、同じタグさえ共有していれば
同じように受け入れられます（`beach` の例のように、`location` trait を経由しなくても `tags: [location]` を
直接書けば `forest` と同じ扱いを受けられます）。

## 5. traits（mixin）

複数の `object_def` で共有するプロパティ・アクション等を `traits` として定義します。

- **多重継承は禁止**: trait が他の trait を参照することはできません（1 階層のみ）。
- **プロパティ衝突はエラー**: 複数の trait が同名プロパティを宣言していた場合、暗黙の優先順位で解決せずエラーとします。
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
        value: {min: 1, max: 3}

object_defs:
  apple:
    traits: [perishable]
    props:
      shelf_life:
        value: 7
```

`props`（6 節）以外にも、`actions`・`combinations`・`recipes`・`slots`・`passives`・`tags`（4.1 節）を trait 経由で
まとめて配布できます。`value` を持たないプロパティは、5 節のルール通り空のマッピング（`{}`）として表現します。

## 6. props（プロパティ）

数値プロパティの値は **32bit 整数**として扱います。小数を必要とする属性は登場しない前提であり、`value`/`range`/
`modify`/`accumulate`/`add` など、数値を扱うすべての場所で整数のみを想定します。

### 6.1 固定値

最も単純な形は、`value` に固定値を 1 つ持つだけの形です（4 節の `stone.props.weight` を参照）。

### 6.2 範囲値（毎 tick 再ロール）

固定値の代わりに `{min, max}` の範囲を `value` に持たせると、**毎 tick ごとに範囲内でランダムに値を再ロール**します。

```yaml
props:
  decay_rate:
    value: {min: 1, max: 3}   # 毎tick、この範囲でロールした量を減算する
```

### 6.3 range / on_overflow / on_shortfall（周回・上下限）

上限・下限に達したら折り返す（あるいは繰り上げる）プロパティは、`range`（取りうる上下限）と、`on_overflow`
（上限超過時の挙動）・`on_shortfall`（下限未満時の挙動、`on_overflow` の下限側の鏡像）を持たせます。`value` の
`{min, max}`（6.2 節、毎 tick 再ロールする範囲）とは別の仕組みです。

`on_overflow`/`on_shortfall` は `on_min`（6.5 節）と全く同じ型の `active`（9 節）内容をそのまま流用しますが、
対象は現時点で `self` のみに限定されます（未対応: `parent`/`actor`/`dragged`、ロード時にエラー）。

- `on_overflow` は、値が `range` の上限を超えた瞬間に、著者が指定した内容を一度だけ適用します。
- `on_shortfall` は、値が `range` の下限を下回った瞬間に、著者が指定した内容を一度だけ適用します。
- どちらも `range` が定義されていて著者が明示的に書かなかった場合、**自分自身を境界値（`on_overflow` なら
  `range.max`、`on_shortfall` なら `range.min`）へ `set` する**という既定の内容が自動的に補われます。これにより、
  著者は `range` を書くだけで、レンジ型プロパティの上限・下限のクランプを実装できます（`on_overflow`/
  `on_shortfall` を明示するのは、繰り上げ・繰り下げのような特別な挙動が要る場合だけで構いません）。

```yaml
props:
  minute_of_day:
    value: 0
    range: {min: 0, max: 1439}
    on_overflow:
      add:
        self:
          minute_of_day: -1440   # 1440溢れたら自分を1440引いて0に戻す
          day: 1                 # 同時にdayへ+1する
  # on_shortfallを省略しているため、下限(0)を下回った場合は既定の
  # `set: {self: {minute_of_day: 0}}` が自動的に適用される（単純なクランプ）。

  hp:
    value: 100
    range: {min: 0, max: 100}
    # on_overflow/on_shortfallをどちらも省略しているため、単純に[0, 100]へクランプされるだけの
    # プロパティになる（毎tick再計算するmodify/accumulateの結果が範囲をはみ出した場合の後始末）。
```

- `range` は `on_overflow`/`on_shortfall` を使う場合に必須です。`range` 自体を省略すると（`day` のように上限・
  下限なくaccumulateし続けたい場合）、`on_overflow`/`on_shortfall` の仕組み自体を持ちません。
- `add` に書けるプロパティは、自分自身（折り返し）に限らず、同じ object_def 内の他のプロパティ
  （繰り上げ・繰り下げ先）も指定できます。存在しないプロパティ名を書いた場合は `on_min`/`add` と同様に
  黙って無視されます。
- 自分自身の折り返し・繰り下げには、絶対値を代入する `set`（9.2 節）ではなく `add` を使ってください。後述の
  通り `on_overflow`/`on_shortfall` はループしないため、1 tick で `range` の幅を複数回分飛び越えることがあります。
  `set` で固定値へ代入するとその超過分を失いますが、`add` なら差分を保ったまま反映されるため、こちらのほうが
  堅牢です（`set` は、超過分を気にせず絶対値へ揃えたい別の用途向けの機能で、既定のクランプ動作自体もこの
  `set` を使っています）。
- `on_overflow`/`on_shortfall` はループしません。1 tick につき、条件を満たしたプロパティ 1 つあたり最大 1 回
  だけ適用されます（`accumulate` の通常の反映・`on_min` と同じ扱いです）。そのため:
  - 1 tick で `range` の幅を複数回分飛び越えた場合、1 回の適用では収まりきらず、残りは次回以降の tick に
    持ち越されます（例: 通常より大きい `add` が1回だけ発生した場合）。
  - 繰り上げ・繰り下げ先自身がさらに範囲外へ出る場合（分→時→日のように連鎖する場合）、同じ tick 内で解決
    されるかどうかは `props` の宣言順に依存します。あるプロパティの `on_overflow`/`on_shortfall` が加算する
    繰り上げ・繰り下げ先が、それより後に宣言されていれば、そのプロパティも同じ tick 内で正しく折り返されます。
    先に宣言されている場合は、次の tick まで持ち越されます。そのため、繰り上げ・繰り下げの連鎖がある `props`
    は、繰り上げ・繰り下げ元→先の順（例: `minute`→`hour`→`day`）で宣言することを推奨します。
- 1 回の判定内での適用順は `on_max`（6.6 節）→ `on_min`（6.5 節）→ `on_overflow` → `on_shortfall` です。
  `on_max`/`on_min` は値を書き換えない「観測者」（境界に達しているという事実をそのまま報告するだけ）、
  `on_overflow`/`on_shortfall` は値を書き換える「補正者」（circular に折り返すプロパティの後始末）という
  役割の違いがあるため、観測者を先に、補正者を後に評価します。
  この順序が重要なのは、circular（自身を折り返す）プロパティが 1 tick で `range` の幅を一気に飛び越えた
  場合です。`on_overflow`/`on_shortfall` の折り返しは境界ちょうどには着地しないことが多く（例:
  0-100 を循環するプロパティが 150 まで加算された場合、折り返し後は 50 に着地し、100 ちょうどにはなりません）、
  もし `on_max`/`on_min` を補正の**後**に判定すると、値はすでに `range` 内へ戻ってしまっており、「この瞬間
  確かに境界へ到達していた」という事実そのものを見逃してしまいます。観測者を先に評価することで、折り返しの
  有無や着地点によらず、`on_max`/`on_min` は境界へ到達した瞬間を必ず捉えます。

### 6.4 stages（段階）

数値プロパティは `stages` を持つことができ、現在値がどの段階にあるかによって、有効になる `passives`（8 節）が
切り替わります。

- 段階の区間定義は **`min`（下限）のみ**を指定します。上限は次の段階の `min` によって自動的に決まります
  （半開区間、`[min, 次のminより手前]`）。この方式により、区間の隙間や重複が構造的に発生しません。
- 最下段の段階は `min: null`（または省略）とし、それより下の残り全ての値を拾います。
- **シンボル型プロパティ（6.8 節）の場合は `min` を書きません。** シンボル型の値は `NameRegistry` への登録順で
  決まるだけの整数であり、大小関係そのものに意味が無いため、`min`（半開区間、大小関係が前提）は使えません
  （書いた場合はロード時エラー）。代わりに、**段階の `name` 自体がそのまま比較対象の値になります**（値が
  `name` と完全一致する場合だけその段階、というシンボル名同士の比較）。シンボル値自体が既に「名前の付いた
  離散値」であるため、ステージ名と比較値を別々に書く理由がありません。

  ```yaml
  props:
    weather:
      value: clear
      stages:
        - name: storm
        - name: clear
          passives:
            - modify:
                self:
                  sunlight: 5
  ```

  数値プロパティの「最下段（min省略）＝フォールバック」という概念は、シンボル型プロパティには存在しません。
  シンボル値は列挙可能な有限集合であり、著者が `stages` に書かなかった値は単に「該当する段階が無い」
  （`ResolveStage` が `null` を返す）だけで、"それ以外の残り全部を拾う段"という受け皿は不要だからです。
  数値型と同じ受け皿を用意する新たな語彙（フォールバック専用のキー等）を追加するほどのニーズが無い以上、
  シンボル型プロパティにはフォールバックという概念自体を持ち込みません。そのため `ResolveStage` は
  シンボル型プロパティに対して `null` を返すことがあり、呼び出し側（`WhenOwnStage` ゲートを含む）は
  必ず `null` チェックを行う前提とします（`Runtime.WorldObject.IsInStage` 参照）。
  複数のシンボル値を1つの段階名にまとめたい（例:「雨」として storm/heavy_rain/light_rain をひとまとめに
  したい）場合は、`stages` ではなく利用側の `conditions` の `in`（14.1 節）で表現します。`stages` はあくまで
  1つのプロパティ自身の値と段階名を1対1で対応させる仕組みであり、複数値のグルーピングは対象外です。
- 現在値に基づいて常に一意に段階を決定します。ヒステリシス（上昇時・下降時で閾値をずらす仕組み）は採用しません。
- ステージの `passives` はレベルトリガー（そのステージにいる間ずっと有効）のみです。ステージ切替の瞬間だけ発火する
  edge-triggered な仕組み（`on_enter`/`on_exit` 的なもの）は導入していません。「下限に達した瞬間」という実際に
  必要なケースは、専用の `on_min`（6.5 節）で表現します。
- ステージは `name`/`min` という固有の属性を持つため、ステージ自体を配列の要素にはできません。そのため
  `passives:` は `name`/`min` と対等な兄弟キーとして、専用にネストしたキーのまま持ちます（オブジェクトレベル・
  プロパティレベルの `passives:` と同じく常に配列です、8 節）。
- ステージの `passives` ブロックには `conditions` も併記できます。この場合、「現在値がこの段階の区間内に
  あること」（`WhenOwnStage`）と `conditions` の両方を満たす間だけ有効になります（AND、8.2 節）。例えば
  「装備している間、かつ耐久値が intact ステージの間だけ」のような組み合わせ条件を表現できます。

```yaml
props:
  progress:
    stages:
      - name: none
        min: 0
      - name: mild
        min: 20
        passives:
          - accumulate:
              parent:
                temperature: 1
      - name: feverish
        min: 50
        passives:
          - accumulate:
              parent:
                temperature: 2
                hydration: -1
```

### 6.5 on_min（下限以下である間、毎tick実行される内容）

`on_min` は、プロパティが**`range` の下限以下である間、毎 tick 実行される `active`（9 節）内容**です（旧称
`on_zero`。比較対象を固定の 0 ではなく `range.min` へ一般化し、0 以外の下限を持つプロパティにも「底を突いた」
判定を使えるようにしたものです）。`passives` の `modify`/`accumulate` と同じレベルトリガーの考え方を、
`set`/`add`/`destroy`/`spawn`（一時的な命令）に適用したものです。「跨いだ瞬間だけ」を検出する仕組み（前 tick
との比較）は持たず、現在値だけで判定します。

- 毎 tick 実行されても安全なのは、典型的な用途が自己終端するためです。`destroy` は既に破棄済みのオブジェクトに
  対して繰り返し実行しても安全（冪等）です。`spawn` を伴う場合は、同じ `on_min` 内で `destroy` と組み合わせるのが
  基本形であり、破棄後はそのオブジェクト自体が tick の対象でなくなるため、2回目以降の実行は起こりません。`destroy`
  を伴わずに `spawn` だけを書くと、下限以下である間 tick 毎に生成し続けてしまう点に注意してください。
- `on_min` の中身は `active`（9 節）と全く同じ型をそのまま持ちますが、対象は現時点で `self` のみに限定されます
  （未対応: `parent`/`actor`/`dragged`、ロード時にエラー）。`range.min` を参照するため、`range` は `on_min` を
  使う場合に必須です（`on_overflow`/`on_shortfall` と同じ制約）。
- `on_overflow`/`on_shortfall`（6.3 節）とは異なり、`on_min` は著者が明示的に書かない限り既定の自動生成は
  行われません。「底を突いたら破棄する」のような挙動は用途ごとに大きく異なるため、単純なクランプを前提にした
  既定値がなじまないからです。

```yaml
props:
  durability:
    value: 100
    range: {min: 0, max: 100}
    passives:
      - accumulate:
          self:
            durability: -1
    on_min:
      destroy: self
    stages:
      - name: intact
        min: 1
      - name: broken
        min: null
```

### 6.6 on_max（上限以上である間、毎tick実行される内容）

`on_max` は、プロパティが**`range` の上限以上である間、毎 tick 実行される `active`（9 節）内容**です。`on_min`
（6.5 節）の上限側の鏡像です。「跨いだ瞬間だけ」を検出する仕組み（前 tick との比較）は持たず、現在値だけで
判定します。

- `on_min` と同様に、毎 tick 実行されても安全な用途（自己終端する `destroy` や `spawn`＋`destroy` の組み合わせ）
  が基本形です。`destroy` を伴わずに `spawn` だけを書くと、上限以上である間 tick 毎に生成し続けてしまう点に
  注意してください。
- `on_max` の中身は `active`（9 節）と全く同じ型をそのまま持ちますが、対象は現時点で `self` のみに限定されます
  （未対応: `parent`/`actor`/`dragged`、ロード時にエラー）。`range.max` を参照するため、`range` は `on_max` を
  使う場合に必須です（`on_overflow`/`on_shortfall`/`on_min` と同じ制約）。
- `on_overflow`/`on_shortfall`（6.3 節）とは異なり、`on_max` は著者が明示的に書かない限り既定の自動生成は
  行われません。

```yaml
props:
  pressure:
    value: 0
    range: {min: 0, max: 100}
    passives:
      - accumulate:
          self:
            pressure: 1
    on_max:
      destroy: self
```

### 6.7 inherit（祖先からの値の継承）

`inherit: true` を指定すると、**自分の直接の親から遡り、この名前のプロパティを定義している最初の祖先**
（8.6 節の `ancestor` と同じ探索ロジック）の実効値を、自分の実効値へ加算します（`GetEffectiveValue`、
可逆）。該当する祖先が最後まで見つからない場合、寄与は 0 です（見つからない場合の既定「寄与0/常に0」と
同じ規約）。

- 直接の親（`parent`）固定ではなく、祖先を遡る（`ancestor`）固定である理由: 直接の親がこのプロパティを
  持たない場合に対応するためです（例: アイテムの直接の親はプレイヤーだが、`ambient_temperature` は部屋が
  持つ）。途中の親がこのプロパティを定義していれば、そこで探索が止まり、そこより上（例えば部屋）までは
  遡りません。これにより、断熱容器のように「途中で値を変えて中継する」表現も、`inherit` とは別に、その
  容器自身が`range`・`modify` 等で自分の値を作ればそのまま実現できます。
- worldは唯一のシングルトンであり、すべてのオブジェクトは最終的にworldの子孫であるため（7.1 節）、
  途中に誰も定義していなければ必ずworldまで遡ります。「本当に世界固有の概念かどうか」を著者が事前に
  区別する必要はありません。

```yaml
object_defs:
  room:
    props:
      ambient_temperature:
        value: 20
  food:
    props:
      ambient_temperature:
        value: -2      # 自分のオフセット
        inherit: true  # 祖先(通常はroom)のambient_temperatureを加算する
```

### 6.8 シンボル型の値

数値プロパティの値は 32bit 整数ですが、`value` に整数にも真偽値にもならない識別子（`^[a-z][a-z0-9_]*$`、
3.2 節と同じ命名規則）を書くと、その識別子を**シンボル名**として自動的に整数へ変換します（`object_defs`/
`props`/`slots`/`tags` の名前と同じ、文字列↔整数の相互変換の仕組みを、シンボル名専用にもう1つ用意した
だけです）。専用の宣言（`symbol: true` 等）は不要で、`value` の書き方だけで区別できます。

```yaml
props:
  content:
    value: water   # 整数にも真偽値にもならないため、シンボル名として登録される
```

液体の種類のような「離散した状態」を、専用の仕組み（enum 型・タグ付きの子オブジェクト等）を新設せず、
既存の `props`/`conditions`/`set` の語彙だけで表現するために導入しました。値の比較・代入は 9.2 節・14.1 節の
通り、他の数値プロパティと全く同じように書けます。

- シンボル名同士の大小関係（`lt`/`gt` 等）は、登録順に依存する恣意的なものであり意味を持ちません。
  シンボル型のプロパティは `eq`/`neq`/`in`/`not_in` で比較する用途を想定しています。
- `range`/`on_overflow`/`on_shortfall`/`stages` はいずれも数値の大小関係を前提にした仕組みのため、
  シンボル型のプロパティと組み合わせても意味のある結果にはなりません。

## 7. slots（親子関係とコンテナ）

### 7.1 基本構造

- オブジェクト間の所属関係はツリー構造で表現します。1 つの子オブジェクトは必ず 1 つの親に属します。
- 親オブジェクトは複数の「スロット」（配列）を持ちます（例: `inventory`、`equip`、`fixtures`）。
- 子オブジェクトは逆引き用のキャッシュフィールドを持ちますが、正の情報源はあくまで親側のスロット配列です。
- スロット間の移動は `move_to_slot` という単一の汎用操作に集約します。親側スロット配列と子側の逆引きキャッシュの
  整合性は、この操作の中でのみ保証します。
- スロットに「種類タグ（kind）」は設けません。スロット名を直接参照します。
- すべてのオブジェクトは、唯一のシングルトンである `world`（15 節）を根とするこのツリーのどこかに、必ず所属します。
  そのため「世界に存在するすべてのオブジェクト」を別途一覧として管理する必要はなく、**このツリーに繋がっている
  こと自体が「世界に存在すること」を意味します**。`destroy`（9.3 節）は親スロットからの切り離し、`spawn`（9.4 節）
  は生成とこのツリーへの接続として表現できるのはこの前提のためです。

```yaml
object_defs:
  character:
    props:
      hp:
        value: 100
    slots:
      equip: {}
      inventory: {}
      injuries: {}
```

### 7.2 accepts（型・数量の制約）

`accepts` を書くと、スロットに格納できるオブジェクトの型と上限数を制約できます。省略時は無制限です。

```yaml
object_defs:
  wood:
    tags: [wood_material]
  stone_knife:
    tags: [stone_knife_material]
  character:
    slots:
      inventory: {}          # 制約なし
      materials:
        accepts:
          - {tag: wood_material, max: 2, consume: true}
          - {tag: stone_knife_material, max: 1, consume: false}
```

- `consume: true` は素材として消費される、`consume: false` は道具として存在確認のみ行うことを表します。
- `capacity`（7.3 節）とは独立した仕組みで、1 つのスロットが両方を同時に持てます。
- `accepts` の各エントリは、`tag` か `object` のどちらか一方を指定します（両方または どちらもなしはエラー）。
  - `tag`: `tags`（4.1 節）で宣言したタグ名を指定します。そのタグを持つあらゆる型（MOD 追加分も含む）を
    まとめて受け入れられます（例: `{tag: location, max: 9999}` で、`location` タグを持つあらゆる場所オブジェクトを
    受け入れる。`location` タグは trait 経由で配っても、object_def 自身に直接書いてもよい）。
  - `object`: `object_defs` の id そのものを指定します。まさにその型だけを受け入れたい場合（例: レシピ制作中
    オブジェクトが特定の素材の型だけを受け入れたい場合）に、そのためだけの単発タグを新設せずに書けます。
    trait 名では直接マッチングしません（trait は合成後に消えてしまう存在であり、外部から参照すべきではないため。
    trait 経由でタグ付けしたい場合は `tags` を使います）。
  - 1 つの `slots.accepts` の中で `tag` と `object` のエントリを混在させられます。

  ```yaml
  object_defs:
    stew_in_progress:
      slots:
        ingredients:
          accepts:
            - {object: raw_meat, max: 1}
            - {tag: spice, max: 4}
    raw_meat: {}
    salt:
      tags: [spice]
  ```

### 7.3 capacity（合計サイズの制約）

`capacity` を書くと、スロット内のアイテムの合計サイズ（各アイテムの `size` プロパティの総和）が上限を超えないよう
制約できます。`move_to_slot` が「現在の中身のサイズ合計＋新しいアイテムのサイズ ≤ capacity」を検証し、超える場合は
移動を拒否します。

```yaml
slots:
  inventory:
    capacity: 50

props:
  size:
    value: 3
```

### 7.4 weight_rate（重さの伝播率）

コンテナ自体の重さは、中に入っているアイテムの重さの影響を受けます。`move_to_slot` は、アイテムがスロットに
出入りするたびに、そのアイテムの実効重量を、スロットの持ち主の `weight` プロパティへ**伝播率 `weight_rate` を
掛けて**加算・減算します（省略時は 1.0）。

```yaml
object_defs:
  character:
    slots:
      equip:
        weight_rate: 0.5    # 身につけると重さが半分に感じる
      inventory:
        weight_rate: 1.0    # 手荷物はそのまま

  cart:
    props:
      weight:
        value: 20
    slots:
      storage:
        weight_rate: 0.1    # 中身の重さの10%しか伝播しない
```

入れ子（アイテム→バッグ→バックパック）も、この仕組みが再帰的に働くことで自然にカスケードします。

### 7.5 装備の排他制御（covers / layer）

- `equip` スロットには複数のアイテムを同時に格納できます。排他制御はスロットの数ではなく、アイテムが持つ属性で
  行います。
- アイテムは `covers`（覆う部位のタグの配列。例: `[torso]`）と `layer`（重ね着の階層。例: `base`、`outer`）を
  持ちます。
- 競合判定は、同じ `(covers要素, layer)` の組が、既に `equip` スロットに入っている他アイテムと重複する場合に
  装備不可とします。
- 競合解決は「ブロック型」です。競合するアイテムがある場合、プレイヤーが先に既存の装備を外す必要があります
  （自動退避は採用しません）。

```yaml
object_defs:
  armor_leather:
    covers: [torso]
    layer: base
```

### 7.6 スタック表示

同種オブジェクトをまとめて1つの視覚的なまとまり（スタック）として表示するための設定です。ほとんどの場合、
これは単なる表示上の見た目の話であり、世界の実体（`slots`の中身が個々のオブジェクトの集まりであること）
そのものは変わりません。`Slot`の中身（`Contents`）は、常に「表示上の並び順」そのものを表す実データとして
維持されます。同種オブジェクトは常に連続した区間（run）としてまとまり、run内は次で説明する`stack_order`
（無ければ挿入順）で並びます。

**スロット側**（`slots`の各エントリに指定）:

- **`stackable`**（既定`true`）: 同種オブジェクトを1つの単位としてまとめるか。`false`なら同種でも個体ごとに
  別単位として数える（例: かまどの投入口。同じ種類の燃料を2つ入れても2枠消費する）。
- **`unit_capacity`**（既定なし=無制限）: このスロットに同時に存在できる「単位」の上限。単位の意味は
  `stackable`に従う（`true`なら異なる型の種類数、`false`なら個体数そのもの）。`capacity`（7.3節、サイズ合計）
  とは独立した、種類数/個数ベースの別軸の制約です。
- **`fixed_positions`**（既定`false`）: 前詰めしないか。`true`の場合、型ごとに固定番号（0始まり、
  `unit_capacity`個まで）が割り当てられ、空いた番号を保持したまま詰めません。新しい型が（`same_slot`経由の
  spawnではなく）通常の手段で初めて登場した際は、空いている最小番号へ自動的に割り当てられます。プレイヤーは
  手動で番号を入れ替えられます（例: プレイヤー手持ちの6枠。Card Survivalの手持ちUIと同じ、前詰めしない
  固定枠の挙動）。`same_slot`経由での新規登場は、下記「`spawn`との関係」で説明する別の割り当てルールに従います。

```yaml
object_defs:
  character:
    slots:
      hand:
        stackable: true
        unit_capacity: 6
        fixed_positions: true
      furnace_intake:
        stackable: false
        unit_capacity: 2
```

**オブジェクト側**（`object_defs`の各エントリに指定）:

- **`stack_order`**: `{property, ascending}`。スタック内での並び順を、指定したプロパティの値で決めます。
  「手前に重ねたいものほどリストの末尾に並ぶ」という規約のもとで、`ascending: false`は値が小さいものほど
  末尾（劣化アイテムなら寿命が短いものほど手前に）、`ascending: true`は値が大きいものほど末尾（液体容器なら
  中身が少ないものほど手前に、というよりも中身の量に対する扱いは今後要検討）を表します。省略時は並び順が
  未定義で、新規インスタンスは常にスタックの末尾（挿入順）へ追加されます。劣化する液体など、複数のプロパティが
  絡む並び順のパターンは今後の検討課題です（12.1節参照）。

```yaml
object_defs:
  wet_log:
    props:
      freshness:
        value: 100
    stack_order: {property: freshness, ascending: false}
```

- `stack_order`は、この`ObjectDef`の新規インスタンスがスタックへ加わる際の並び位置決定にのみ使います。
  一度並んだ後、値の変化に追従した再ソートは行いません。これは、同種は同じ速度で変化する（`accumulate`は
  `ObjectDef`ごとに一定量、8.4節）という前提のもとでのみ正しく、挿入時点の相対順序がその後も保たれます。

**`spawn`（9.4節）との関係**: `into`を省略（`same_slot`）した置き換えは、`destroy`を`spawn`より先に実行し
（9.3節・9.4節参照）、破棄されたオブジェクトが占めていた位置を新しいオブジェクトへそのまま引き継がせます。
一般のスロットではリストの位置、`fixed_positions`のスロットでは固定番号がこれにあたります。これにより、種類が
変わるアイテムが、周囲のスタックの並び順を崩したり、`fixed_positions`のスロットで新しい枠にはみ出したりする
ことなく、同じ位置で置き換わります。`destroy`を伴わない場合（生き残ったまま増やす場合）は、新しいオブジェクトは
自分の直後へ挿入されます。

新しい型を挿入する必要があり（合流できる既存スタックが無く）、かつ自分自身の位置をそのまま再利用できない場合
（`destroy`しない、または`destroy`しても同種が残る場合）、挿入位置は「自分の隣」です。一般のスロットでは
これは単純な挿入（自分の直後）で済みますが、`fixed_positions`のスロットでは、**まず自分の固定番号+1の位置
（右側）から空いている番号を探し**、間にいる他の型をすべて+1して押し出してから割り込ませます。右側に空きが
見つからなければ、**今度は自分の固定番号-1の位置（左側）から空いている番号を探し**、間にいる他の型をすべて
-1して押し出してから割り込ませます（「右が空いている限り右に、そうでなければ左に生まれる」）。いずれの方向も
前詰めはせず、押し出された型同士の相対順序は変わりません（押し出しは型単位で行うため、押し出される型が
スタック（同種複数個）であっても中身がバラけることはありません）。どちらの方向にも空きが見つからない場合
（`unit_capacity`分すべてが埋まっている場合）は配置に失敗し、必ず起点自身の親へ強制的に伝播します
（`fallback`が無いのと同じ扱い）。

例（`unit_capacity: 4`、`_`は空き番号）: `A(0) _(1) B(2) _(3)` の状態で `A` から `C` が生まれると（`destroy`
なし）、空いている1番へそのまま入り `A C B _` になります。続けて `A` から `D` が生まれると、1番は`C`で
埋まっているため、2番以降で最初に空いている3番までの間（`C`・`B`）を+1して押し出し、`A D C B` になります
（`C`と`B`の相対順序は変わりません）。さらに `A` から `E` が生まれても、4枠すべてが埋まっており押し出す先が
無いため配置に失敗し、起点自身の親へ強制的に伝播します。なお、生まれた側が元々のスタックと合流できる型
（例: `A` から `A` が生まれる場合）は、新しい固定番号を消費せず既存のスタックへそのまま加わるため、
このあふれの心配はありません。

右側に空きが無い場合の例: `_(0) _(1) A(2) B(3)` の状態で `A` から `C` が生まれると、右側（3番以降）は`B`で
埋まっているため、左側（1番以前）を探し、空いている1番へそのまま入って `_ C A B` になります。続けて `B`
から `D` が生まれると、右側（4番）はスロットの外なので即座に左側を探すことになり、2番（`A`）は埋まっている
ため1番以前を探し、空いている0番までの間（`C`・`A`）を-1して押し出し、`C A D B` になります
（`C`と`A`の相対順序は変わりません）。

## 8. passives（持続する影響）

`passives` は、`self`/`parent`/`child` の関係とゲート（常時／`conditions`／プロパティの stage）に紐づいて
登録され、**その関係が続く限り評価され続ける**、持続する影響を表します。次の 3 つのレベルで定義でき、いずれも
同一の記法・実行原理を用います。

1. **オブジェクトレベル**（例: 防具そのものが持つ複数の恩恵の束）
2. **プロパティレベル**（例: アイテムの重量プロパティが持ち主の負荷に寄与する）
3. **プロパティのステージレベル**（6.4 節）

`passives` は常に配列です（`conditions`/`stages`/`accepts`/`pick` と同じ規約で、要素が1つの場合も配列で書きます）。
配列の各要素が独立した1つのブロック（`conditions`/`modify`/`accumulate`）で、複数のブロックを並べることで、
`conditions` ごとに異なる効果を与えられます（8.5 節）。

### 8.1 文法: 操作が上位、対象が下位

`passives` の各要素は、操作（`conditions`/`modify`/`accumulate`）をキーとする辞書型です。`modify`/`accumulate`
の中には、効果の対象を識別子とする対象キーの辞書がぶら下がります。対象キーとして定義するのは `self`（自分自身）・
`parent`（親）・`child`（子）・`ancestor`（祖先、8.6 節）の 4 つです（`actor` は持続的な関係に紐づかないため未対応）。

```yaml
object_defs:
  armor_leather:
    covers: [torso]
    layer: base
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 5
            speed: 3
            accuracy: 2
```

### 8.2 conditions（ゲート）

- `conditions`（14 節と同じ文法・木構造）が真である間、継続的に有効（レベルトリガー）です。1 つのブロック全体
  （`modify`/`accumulate` に含まれるすべての対象）に対して、共通の `conditions` を 1 つだけ持ちます。
- `conditions` を省略すれば「常時（無条件）」を意味します。
- `self`/`parent` 対象の効果は、両方とも「このブロックを宣言したオブジェクト自身が今どのスロットに入っている
  か」という同じ物理的な実体を指すため、`conditions` の `object` を省略（既定値 `self`）して書くのが自然です
  （例: `{in_slot: equip}` は「自分自身が親の `equip` スロットに入っている間」を意味します）。`child` 対象の効果
  （親がdeclareし、子がゲート対象になるケース）では、`object: child` を使って子自身のスロット位置やプロパティを
  参照できます。

### 8.3 modify

条件が真である間だけ計算式に寄与する、**可逆的な**修飾子です。条件が偽になった瞬間に寄与は自動的に消えます。値
そのものを書き換えるのではなく、実効値を都度導出するための入力として扱います。

- 同一プロパティに対する複数の `modify` は単純加算で合成します。
- 合成結果の上限・下限（min/max）はプロパティ側の `range`（6.3 節）に持たせます。

### 8.4 accumulate

条件が真である tick 毎に、対象プロパティの実体値へ直接・**不可逆**に加減算します（例: 出血中の血液量減少、耐久値の
毎 tick 減少）。`modify` と全く同じ登録・ゲートの仕組みを使い、違いは可逆か不可逆かだけです。

### 8.5 複数ブロック（conditions の使い分け）

同じ対象（例: `parent`）に対して、状況によって異なる効果を与えたい場合は、`passives` に複数のブロックを並べます。
典型例は、装備するスロットによってボーナス量を変えたい武器です。

```yaml
object_defs:
  sword:
    passives:
      - conditions:
          - {in_slot: main_hand}
        modify:
          parent:
            attack: 5
      - conditions:
          - {in_slot: off_hand}
        modify:
          parent:
            attack: 2
```

各ブロックは独立して登録・評価されます。同じ対象・同じプロパティに対して複数のブロックが同時に有効になった
場合（例えば `conditions` を持たない=常時有効なブロックと、`conditions` 付きのブロックが両方成立する場合）、
`modify` は 8.3 節の通り単純加算で合成されます。`accumulate` も同様に、有効な全ブロックの量がそれぞれ tick 毎に
反映されます。

### 8.6 ancestor（祖先を辿る対象）

`ancestor` は、**このpassivesを宣言したオブジェクト自身の直接の親から遡り、対象プロパティを定義している
最初の祖先**を対象にします（見つからなければこの効果は何も起きません）。`parent`（1階層固定）と異なり、
途中の親がそのプロパティを持たない場合でも、さらに上の祖先へ自然に届きます。

典型例は、部屋に置かれた暖炉が、その部屋（自分の直接の親とは限らない）の気温を上げる効果です。

```yaml
object_defs:
  fireplace:
    passives:
      - conditions:
          - {prop: lit, value: 1}
        modify:
          ancestor:
            ambient_temperature: 5
```

暖炉自身がカート等（`ambient_temperature` を持たない容器）の中に置かれていても、その容器を素通りして、実際に
`ambient_temperature` を持つ部屋（あるいはさらに上の祖先）に効果が届きます。祖先を辿った先のオブジェクトが後で
移動した場合（例えば暖炉を運ぶカート自身が別の部屋へ移動した場合）、その移動をきっかけに再解決され、
新しい祖先へ効果が自動的に切り替わります。

`ancestor` はconditions（14 節）の `object` としても、`inherit`（6.7 節）の探索ロジックとしても使われる、
共通の1つの祖先探索です。

## 9. active（一時的な命令）

`active` は、アクション・組み合わせ・確率分岐の結果が確定した瞬間に、**無条件で1回だけ**適用される命令を指す
概念です。持続する条件を表す `conditions`/ゲートは持たず、`modify`/`accumulate` のような登録の仕組みにも乗りません。

`active` という語自体は、YAML 上の専用キーとしては書きません。この節で説明する `set`・`add`・`destroy`・
`spawn`・`transfer` を、それが書ける場所（9.6 節: `actions`/`combinations` の各エントリ、`pick` の各候補、`props` の
`on_min`/`on_overflow`/`on_shortfall`/`on_max`）の中に、`showMenu`/`conditions`/`with`/`weight`/`pick` と
対等な兄弟キーとして直接書きます。専用のラップを挟まないことで、動詞（`set`/`add`/`destroy`/`spawn`）が
`pick` と並列に並び、「実行結果は直接書くか、`pick` で確率分岐するかのどちらか」という構造がそのまま
YAML の見た目に表れます。

### 9.1 文法: 操作が上位、対象が下位

`set`・`add`・`destroy`・`spawn` という操作をキーとして直接書きます。`set`/`add` の中には、`self`/`parent`/
`ancestor`（8.6 節と同じ祖先探索。`self`の直接の親から遡り、対象プロパティを定義している最初の祖先へ
書き込む）/`actor` を対象キーとする辞書がぶら下がります（`combinations`（12 節）の中では、これに加えて
**`dragged`**（ドラッグされてきたカード）も使えます）。`destroy`はオブジェクトそのものを指す（プロパティを
持たない）ため、`ancestor`は対象として使えません（未対応、ロード時エラー）。

```yaml
actions:
  eat:
    add:
      actor:
        satiety: 10
    destroy: self
```

### 9.2 set / add

どちらも対象プロパティの実体値へ、その場で一度だけ不可逆に反映します。

- `set` は指定した**絶対値**をそのまま代入します。
- `add` は指定した量を既存の値へ**加減算**します。

`conditions`/常時の継続的な加算は `accumulate`（8.4 節）が担うため、`set`/`add` は一時的な命令専用です。

`set` の値は、**リテラル**（整数・真偽値・シンボル名、6.8 節）か、**`{object, prop}` 参照**
（`conditions` の値参照・`weight` の path 参照と同じ二択）のいずれかです。参照の場合、その参照先の現在の
実効値をそのままコピーします（他のプロパティの値を、値を知らないまま複製する用途、例: 別の容器から
注がれた液体の種類をそのまま引き継ぐ）。

```yaml
set:
  self:
    content: {object: dragged, prop: content}   # draggedの現在のcontentをそのままselfへコピーする
```

`add` は加減算量が常に量そのもの（差分）であり、他のプロパティの値をそのままコピーする用途に当てはまらない
ため、参照はまだ用意していません。

### 9.3 destroy

削除したい対象を直接指定します。単一の対象なら `destroy: self` のようにスカラーで、複数の対象を同時に削除する
なら `destroy: [self, dragged]` のようにリストで書きます。すべてのオブジェクトは必ずworldを根とするツリーに
所属するため（7.1 節）、`destroy` は「現在の親スロットから切り離す」こととして表現できます。繰り返し実行しても
安全（冪等）です。`spawn` と同時に指定した場合、`destroy` は `spawn` より先に実行されます（9.4節参照）。

### 9.4 spawn

`{object, into}` を指定すると、新規オブジェクトを生成し、指定した場所へ配置します。`spawn` は常に **`self`
（この `active` を宣言したオブジェクト自身）が実行するもの**とみなすため、`set`/`add`/`destroy` のような対象
キーのラップを挟みません。`destroy` と同時に指定でき（`{spawn: {...}, destroy: self}`）、「新しいオブジェクトを
生成しつつ、自分自身は消滅させる」という組み合わせを1つのエントリで表現できます。この場合、`destroy`が先に
実行されます。破棄によって実際に位置が空いてから配置することで、スタック表示（7.6節）における位置の引き継ぎが
素直に実現できるためです。

挿入先の**スロット名を書く必要はありません**。生成物を受け取るオブジェクト（後述の`into`が指す起点）が持つ
スロットを**宣言順に走査し、最初に配置できたスロットへ入れます**。型ごとに用意されたスロット（アイテム用・
設備用など）へ自然に振り分けられるため、著者はスロット名を知る必要がありません。

**`into`（配置先の起点）** は、以下のいずれかです。

- **省略、または`same_slot`**: この`set`/`add`/`destroy`/`spawn`を宣言したオブジェクト（`self`）が今いる、
  まさにその場所（親と、`self`が現在占めているのと同じスロット）へそのまま配置します。クラフト・腐敗など、
  「同じ場所で別の物に置き換わる」場合に使う既定動作です。スロットの走査は行いません（`self`の現在の所属先が
  一意に決まるため）。`same_slot`は省略時と全く同じ意味を持つ、明示したい場合のためのキーワードです。
- **`self`/`actor`**: このいずれかを起点に、その対象が持つスロットを宣言順に走査します。`actor`
  （アクション実行者）は、アクション実行文脈でのみ解決できます。`on_min`/`on_overflow`/`on_shortfall`/`on_max`
  には`actor`が存在しないため使えません（配置は行われません）。

```yaml
spawn: {object: rotten_wood}
destroy: self
```

```yaml
spawn: {object: item_coconut, into: actor}
```

`into`が指す起点のどのスロットにも`accepts`/`capacity`が合わず配置できなかった場合、**`fallback`はYAML上に
存在せず**、必ずその起点自身の親へ伝播します。伝播先では`accepts`/`capacity`を無視し、先頭のスロットへ強制的に
配置します（すべてのオブジェクトは必ずどこかの親に属さなければならないため）。スロットの指定が不要になった
ことで、配置パターンは「起点を1つ選べば、そこに入らなければ自動的にその親へ」という単一のルールで尽くせます。
たとえば上の`into: actor`の例は、収穫したアイテムをまずプレイヤーの手持ち（`actor`）へ入れようとし、手持ちの
スロットがすべて埋まっていれば、actorが今いる場所（`actor`の親）へ必ず配置する、という「取得アイテムの
置き場所」パターンを、著者が親を明示することなく表現します。

伝播先の親も存在しない場合（起点が`world`直下など）、`into`への配置に失敗すると、そのオブジェクトはどこにも
配置されないまま消えます（生成自体はされますが、worldツリーに繋がらないため、存在しなかったのと同じ扱いに
なります。7.1 節参照）。

### 9.5 transfer

`set`/`add` は固定の値・量しか書けないため、「在庫に応じて実際に動く量が変わる」移送（例: 容器に入っている
分だけ回復する水分補給）を表現できません。`transfer` は、`from` が指すプロパティの実体値のうち、実際に
出せる量（0未満にはならない量）と `amount` の小さい方だけを、`to` が指すプロパティへ移す専用の動詞です。

```yaml
actions:
  drink:
    transfer:
      amount: 2000
      from_prop: water_amount
      to_object: actor
      to_prop: hydration
```

- **`from_object`**（省略可、既定値 `self`）・**`to_object`**（省略可、既定値 `self`）: 参照ルート。
  `set`/`add` の対象キー（9.1 節）と同じ許可範囲（`self`/`parent`/`ancestor`/`actor`、`combinations` 内は
  `dragged` も）。
- **`from_prop`**・**`to_prop`**: それぞれ移送元・移送先のプロパティ名。
- **`amount`**: 一度に移送を試みる量の上限。
- **`allow_overflow`**（省略可、既定値 `false`）: `to` の `range` に実際に収まる量までしか移動しません
  （収まらない分は `from` に残ります＝液体を無駄にしません）。`true` にすると、`from` の残量と `amount` だけで
  移動量が決まり、`to` の `range` を超えた分は `to` の `on_overflow`（未指定なら `range.max` へ自動でクランプ
  する既定動作、6.3 節）に委ねます（あふれた分は失われます）。

`from_object`/`from_prop`/`to_object`/`to_prop` を、`modify`/`set`/`add` と同じ「対象がキー、内容が値」という
規約に合わせずフラットな4フィールドにしているのは、`conditions`（14.1 節）の `object`/`prop` と同じ理由です。
`from`・`to` それぞれ参照は常に1組であり、複数プロパティの入れ物としてネストする必要がありません。

### 9.6 set/add/destroy/spawn/transfer が書ける場所

この節の操作は次のいずれかの位置に、専用のラップを挟まず直接書きます。持続する条件を表す `conditions`/ゲートを
持つ `passives` とは、書ける場所が構造上重ならないため、両者を混同する余地はありません。

- `actions`/`combinations` の各エントリ（11 節・12 節）— `showMenu`/`conditions`/`with`/`pick` と対等な
  兄弟キー
- `pick` の各候補（10 節）— `weight`/`pick` と対等な兄弟キー
- `props` の `on_min`（6.5 節）・`on_overflow`/`on_shortfall`（6.3 節）・`on_max`（6.6 節）— これらは専用の
  キーの直下にそのまま書きます（元々ラップを挟んでいなかったため変更なし）

## 10. pick（重み付き確率分岐）

`pick` は、`set`/`add`/`destroy`/`spawn`/`transfer`（9 節）を直接書ける場所であればどこでも、**その代わりに**書ける、
重み付き候補のリストです。新しいトリガー体系は必要とせず、`passives`（無条件／`conditions`／stage 内）には
書けません。`passives` は「いつ振るか」という瞬間を持たない、関係とゲートに基づく継続的な評価だからです。

### 10.1 基本構造

各候補は `weight` に加えて、`set`/`add`/`destroy`/`spawn`/`transfer`（9 節の文法そのまま）を `weight`/`pick` と対等な
兄弟キーとして直接持ちます。候補が1つしかない場合は、重みの値に関わらず必ずそれが選ばれます。

```yaml
actions:
  attack:
    showMenu: always
    pick:
      - weight: 50
        destroy: self
      - weight: 50
        destroy: actor
```

候補ごとに影響を受ける対象（`self`/`actor` など）そのものが異なるケースも、このように表現できます。`pick` の
入れ子は再帰的であり、候補の `set`/`add`/`destroy`/`spawn`/`transfer` の代わりにさらに別の `pick` を書くこともできます。

各候補に書ける内容は、一時的な命令（`set`/`add`/`destroy`/`spawn`/`transfer`）に限られます。`modify`/`accumulate`
は関係とゲートに基づいて登録され、その関係が続く限り評価され続けることに意味がある仕組みのため、1回選ばれて
終わる `pick` の候補に書く意味がありません。

### 10.2 weight

`weight` は、専用の計算式（base値＋条件付き補正）を新設せず、以下のいずれかとして表現します。

- **リテラル定数**: 外部からの干渉を想定しない候補向け。
- **既存プロパティへの参照**（`{object, prop}`、14 節の条件式の葉と同じ `object`/`prop` の書き方。`object`は
  省略可で既定値は`self`、`ancestor`（8.6 節）も指定できる）: 外部から干渉させたい候補向け。参照先は、
  通常の `props` として定義された値です。

```yaml
pick:
  - weight: {prop: accuracy}
    add:
      self: {hp: -10}
  - weight: {prop: evasion}
    destroy: dragged
```

外部からの干渉（「戦闘スキルが高いほど命中しやすい」等）は、`weight` 自体に専用の補正記法を用意するのではなく、
参照先のプロパティに対する通常の `modify` 効果として表現します。

## 11. actions（メニュー型操作）

アクション（`eat`、`move` など）は、条件（`conditions`）と実行結果（`set`/`add`/`destroy`/`spawn`/`transfer`、または
`pick`）を**1つの定義としてまとめて持ちます**。`object_defs`/`traits` の中に配置します（トップレベル独立キーには
しません）。

```yaml
traits:
  eatable:
    actions:
      eat:
        showMenu: always
        conditions:
          - {object: actor, prop: satiety, op: lt, value: max}
        add:
          actor:
            satiety: 10
        destroy: self
```

### 11.1 showMenu

メニューへの表示方法を制御します。現時点では `always` のみです。

### 11.2 conditions

`{object, prop, op, value}` の葉と `all`/`any`/`not` の複合ノードからなる条件木です（14 節）。トップレベルは
常に配列で、暗黙の `all`（AND）として扱われます。

### 11.3 set/add/destroy/spawn/transfer（active） / pick

このアクションが実行された瞬間に、`set`/`add`/`destroy`/`spawn`/`transfer`（9 節、`active` の実体）が1回だけ適用される
か、`pick`（10 節）で候補が1つ選ばれて適用されます。`showMenu`/`conditions`と対等な兄弟キーとして直接書き、
専用の `active:` ラップは挟みません。どちらも指定しなければ、条件成立時に何も起きないアクションになります。

**`actor` はすべてのアクションに暗黙的に存在し、常にプレイヤーキャラクターを指します。** `parent`（木構造上の直接の
格納先）とは独立した参照です。

## 12. combinations（ドラッグ型操作）

`combinations` は、**ドロップされた側（受け側）のオブジェクト**に定義します。`with`（ドラッグされてきたカードが
持つタグ、4.1 節）でマッチング対象を指定します。

```yaml
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        conditions:
          - {object: dragged, prop: durability, op: gt, value: 0}
        spawn: {object: logs}
        destroy: self
        add:
          dragged:
            durability: -1
  logs: {}
  axe_tool:
    tags: [axe_tool]
    props:
      durability:
        value: 10
```

### 12.1 with

マッチング対象を、タグ（4.1 節）で指定します。`object_defs` の id や trait 名では直接マッチングしません
（trait は合成後に消えてしまう存在であり、外部から参照すべきではないため）。そのタグを持つあらゆるカード
（MOD 追加分・trait を介さず直接タグを宣言したカードも含む）と一致します。

### 12.2 dragged

`set`/`add`/`destroy`/`transfer`（9 節）の対象キー、および `conditions`/`weight` の `object`（14 節・10.2 節）に、
`self`/`parent`/`child`/`actor` に加えて **`dragged`**（このインタラクションでドラッグされてきたカード）を
使えます。`combinations` の中でのみ意味を持つ、専用のキーです。

### 12.3 対称的な組み合わせ

どちらのカードをどちらにドラッグしても成立してほしい組み合わせは、**両方のカードに `combinations` を書く**ことで
表現します。専用の「双方向」記法はありません。

```yaml
object_defs:
  stick:
    combinations:
      craft_spear:
        with: rope
        destroy: [self, dragged]
        spawn: {object: spear}
  rope:
    combinations:
      craft_spear:
        with: stick
        destroy: [self, dragged]
        spawn: {object: spear}
```

`combinations` の使い分け方針（メニュー型との比較、キーの衝突の扱いなど）は `ActionSystem.md` を参照してください。

## 13. recipes（レシピ）

レシピは、成果物の `object_defs` に、名前をキーとする辞書として埋め込みます。

```yaml
object_defs:
  axe:
    recipes:
      basic:
        icon: axe_wip.png
        steps:
          - requires:
              - {object: wood, quantity: 2, consume: true}
              - {object: stone_knife, consume: false}
            duration: 30
          - requires:
              - {object: rope, quantity: 1, consume: true}
            duration: 10
```

### 13.1 steps / requires

- レシピは 1 つ以上の**工程（`steps`）**からなります。
- 各工程は 1 つ以上の**素材または道具**を要求します（`requires`）。素材（`consume: true`）は消費され、道具
  （`consume: false`）は消耗しますが消費はされません。
- 各工程には所要**時間（`duration`）**が定義されます。
- 最後の工程まで完了すると、目的のアイテムが生成されます。

### 13.2 icon

完成品ごとのアイコン指定です。レシピから自動生成される製作中オブジェクトの型へ引き継がれます（詳細は
`RecipeSystem.md`）。

レシピの内部設計（製作中オブジェクトの自動生成、`accepts` との連携など）は `RecipeSystem.md` を参照してください。

## 14. conditions（条件式）

条件は、プロパティ比較・スロット位置判定・スロット中身判定のいずれかを表す「葉」と、複数の条件を論理積・
論理和・否定で束ねる「複合ノード」からなる木構造です。トップレベルの `conditions:` は常に配列で、暗黙の
`all`（論理積）として扱われます（`passives`/`stages`/`accepts`/`pick` と同じ、複数形キーは常に配列という
規約、8 節）。

### 14.1 葉: プロパティ比較

```yaml
conditions:
  - {object: actor, prop: satiety, op: lt, value: max}
```

- **`object`**（省略可、既定値 `self`）: 参照ルート。`self`（宣言したオブジェクト自身）・`parent`（その親）・
  `ancestor`（selfの直接の親から遡り、`prop`が指すプロパティを定義している最初の祖先。8.6 節と同じ探索
  ロジック）・`actor`（実行しているプレイヤーキャラクター。actions/combinations のみ）・`dragged`
  （`combinations` 内のみ、12.2 節）のいずれか。`world`（9 節のシングルトン）は実行時追跡の仕組みがまだ無い
  ため未対応（ロード時エラー）だが、`ancestor` は見つからなければ自然にworldまで遡るため、世界固有と
  思われる概念を参照したい場合は`ancestor`で代替できる。
- **`prop`**: 参照するプロパティ名。
- **`op`**（省略可、既定値 `eq`）: 比較演算子。`lt` / `lte` / `gt` / `gte` / `eq` / `neq` / `in` / `not_in`。
- **`value`**: 比較対象の値。**リテラル**（整数・真偽値・シンボル名、6.8 節）か、**`{object, prop}` 参照**
  （`weight` の path 参照、10.2 節と同じ二択）のいずれか。参照は `lt`/`lte`/`gt`/`gte`/`eq`/`neq` でのみ
  使えます（`in`/`not_in` は複数値との比較のため、単一の参照とは噛み合わずロード時エラーになります）。

```yaml
conditions:
  - {prop: content, op: eq, value: {object: dragged, prop: content}}   # 2つの動的な値同士を比較する
```

`object`/`prop` を、他の場所（`modify`/`set`/`add` 等）と同じ「対象がキー、内容が値」という規約に合わせず
あえてフラットな2フィールドにしているのは、対象1つ・プロパティ1つの単純な参照であり、ネストする必要が無い
ためです。

`prop` が参照する値は、実体値（生の値）ではなく**実効値**（8.3 節の `modify` を加味した値）です。これにより、
`modify` だけで決まる派生プロパティ（実体値自体は変化しない値。例: 天候と時間から決まる日照）も、他の
`conditions` から参照できます。`value` が `{object, prop}` 参照の場合も同様に実効値を読みます。ただし、
あるプロパティの `modify` のゲートが、直接・間接を問わず自分自身の実効値に依存する（循環参照）と、実行時に
例外を送出します（`PropertyValue.GetEffectiveValue` 参照）。生の値と異なり実効値は計算結果そのものに
依存しうるため、この種の循環はエンジン側では防げず、YAML の書き方で避ける必要があります。

### 14.2 葉: スロット位置判定

`object` が指すオブジェクト自身が、今まさに親のどのスロットに入っているかを判定します（**外側から見た
位置**）。常に等価判定で、`op` は持ちません（否定したい場合は 14.4 節の `not` で包みます）。

```yaml
conditions:
  - {object: self, in_slot: equip}
```

`in_slot` は `prop` とは独立したフィールドで、同時には指定できません。あえて `prop` の仮想的な特殊値に
していないのは、(a) スロット判定には `lt`/`gt` 等の比較演算子が意味を持たないため、`op` を伴う `prop` と
同じ形にすると無意味な組み合わせを許してしまうこと、(b) プロパティ名とスロット名は本来別の名前空間であり、
同じ識別子が偶然重なった場合に区別できなくなることの2点によります。フィールド名を分けることで、両者は
文字列が一致しても衝突しません。

`ancestor` は「`prop` が指すプロパティ名で祖先を探す」という仕組みのため、探すプロパティを持たないスロット
位置判定では `object` に指定できません（ロード時エラー）。

### 14.3 葉: スロット中身判定

`object` が指すオブジェクト自身が持つ**自分のスロット**の中に、指定した `tag`（4.1 節）を持つ子オブジェクトが
1つでもあるかを判定します（**内側から見た中身**、14.2 節のスロット位置判定とは向きが逆）。常に存在判定で、
`op` は持ちません。

```yaml
conditions:
  - {object: self, slot: content, tag: liquid_water}
```

- **`slot`**: 判定対象の、`object` 自身が持つスロット名。
- **`tag`**: そのスロットの中身が持つべきタグ。

`slot` は 14.2 節の `in_slot` とは別フィールドです。同じ「スロットのグローバルID」を指しますが、
`in_slot` は「`object` が親の中でどこにいるか」、`slot` は「`object` 自身の中に何が入っているか」という、
参照する木構造上の向きが逆であるため、キー名自体を分けて区別しています（同じキー名で向きだけが異なると、
`{object, slot}` という同じ形が2通りの意味を持ってしまい、区別できなくなるため）。

液体容器のような「中身の種類によって取れる行動が変わる」ケースに使います。中身の種類は、容器の中の専用
スロットへ、種類ごとのタグを持つ目印用オブジェクトを1つ置くことで表現します（コンテナ設計の検討、
`ContainerSystem.md` 参照）。

```yaml
object_defs:
  canteen:
    props:
      water_amount:
        value: 0
        range: {min: 0, max: 4800}
    slots:
      content:
        accepts:
          - {tag: liquid_marker, max: 1}
    actions:
      drink:
        conditions:
          - {slot: content, tag: liquid_water}
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
```

### 14.4 複合ノード: all / any / not

複数の条件を組み合わせたい場合、`all`（論理積）・`any`（論理和）・`not`（否定）で入れ子にできます。

```yaml
conditions:
  - any:
      - {in_slot: main_hand}
      - {in_slot: off_hand}
```

トップレベルの配列自体が暗黙の `all` であるため、単純な AND 条件（従来通り）は複合ノードを使わず、葉を並べる
だけで書けます。

## 15. singleton（唯一のインスタンス）

「インスタンスが1つだけ存在すべき」という制約は、`object_defs` のエントリに `singleton: true` を追加することで
表現します。

```yaml
object_defs:
  world:
    singleton: true
    props:
      day:
        value: 1
      hour:
        value: 0
        range: {min: 0, max: 23}
        on_overflow:
          self:
            accumulate: {hour: -24, day: 1}
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_overflow:
          self:
            accumulate: {minute: -60, hour: 1}
```

（実際の定義は `Assets/StreamingAssets/WorldCodex/core.yaml` 参照。`day`/`hour`/`minute` に加え、累積 tick 数を表す
`tick` も持つ。）

日時・天候はオブジェクトから直接参照されるのではなく、**環境がオブジェクトに影響を与える**という位置づけです
（例: 明るさによって行動可否が変わる）。直接のプロパティ参照は 14 節の `conditions`（`object: world`）で使います。

## 16. 本書の対象外

- **地形生成**（`Axis`/`LocationType`/`generation_scope` 等）: 記法自体は本書と同じ「識別子をキーとする辞書」に
  統一済みですが、フィールド名・詳細な軸空間マッチングは `TerrainGeneration.md` が検討中の段階のため、本書には
  含めません。
- **`derived`（導出値）**: 「他の props から計算される値」という概念自体、採否がまだ決まっていません（17 節）。

## 17. 今後の検討課題

- `derived`（導出値）の採否。採用する場合、`stages`（6.4 節、`min` による半開区間）とキー名・記法を統一するか
- ステージ切替の瞬間だけ発火する edge-triggered な仕組み（`on_enter`/`on_exit` 的なもの）の要否と記法。「下限に
  達した瞬間」は `on_min`（6.5 節）で解決済みだが、それ以外のステージ境界を跨いだ瞬間に発火したいケースが今後
  生じた場合の対応は未検討
- `day` の上限（無制限のまま加算し続けるか、年単位で wrap して `year` プロパティを持つか）
- 天候遷移自体（いつ・どの天候に切り替わるか）のランダム性の仕組み（6.2 節）
- `passives`/`active` の対象キーに `sibling`/`descendant` を追加するかどうか（`ancestor` は 8.6 節・6.7 節で
  対応済み）
- `pick` の位置づけ（候補に `modify`/`accumulate` を書けないことの扱い）
- `pick` の候補から「別のアクションを実行する」ための記法（エフェクトから能動的にアクションを発火する仕組み自体が
  まだない）
- action / combinations の比較演算子セット（14.1 節）の過不足、`between` 等の追加要否
- `object`（14.1 節・10.2 節）の参照範囲: 現状の実装は `object` が指すオブジェクト自身が直接持つ
  プロパティ・スロットのみに対応し、任意の階層数を指定するネストした参照（例: 「親の親」を明示的に指定）は
  未対応。「祖先を遡って該当プロパティを持つ最初のオブジェクトを探す」という用途は `ancestor`（8.6 節・6.7 節）
  で対応済み。`world` を `object` にした参照（world シングルトンインスタンスの実行時追跡が未実装）も未対応
  （ロード時エラー）だが、`ancestor` は見つからなければ自然にworldまで遡るため、多くの場合これで代替できる
- `active`（9 節）の対象キー `child`: 一度きりの命令に対して「どの子か」の意味が確定していないため未対応
  （ロード時エラー）。passives の child 寄与（8 節、関係とゲートに基づく持続的な登録）とは性質が異なる
- `conditions`/`weight` の `value: max`/`value: min`（参照先プロパティの range の上限・下限を指す想定と思われる
  記法）は、規約が本書上どこにも明文化されていないため未対応（ロード時エラー）
- `weight` の合計が0（またはマイナス）になった場合のフォールバック候補の扱いは、宣言順で先頭の候補を選ぶ、と
  実装上決定した（YAML側にフォールバック候補を明示する記法は無い）
- `slots` が character 専有の概念か、コンテナ全般で使い回す汎用概念か
- `weight_rate`（7.4 節）が 1.0 を超えるケースを許容するか
- `combinations` に関する未決事項一式（キーの衝突解決、MOD 拡張性など）は `ActionSystem.md` に整理
- レシピに関する未決事項一式は `RecipeSystem.md` に整理
- コンテナの容量・重さに関する未決事項一式は `ContainerSystem.md` に整理

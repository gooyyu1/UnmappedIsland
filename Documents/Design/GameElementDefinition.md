# WorldCodex YAML 文法リファレンス

## 1. 位置づけ

本ドキュメントは、`WorldCodex`（ゲーム内のあらゆる要素を定義する YAML）の**文法そのもの**を体系的にまとめた、唯一の
リファレンスです。`traits`・`object_defs`・`props`・`stages`・`slots`・`combinations`・`recipes`・`passive`・`active`・
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
- 識別子（型名・プロパティ名・トレイト名・アクション名・スロット名に共通）は次の正規表現に従います。

  ```
  ^[a-z][a-z0-9_]*$
  ```

### 3.3 ロードとバリデーション

- YAML ファイルは所定のディレクトリ以下のすべてのファイルが自動的に読み込まれます。ゲーム本体の定義と MOD の定義は
  別ディレクトリに配置し、双方を混在させずに管理します。
- マッピングキーの重複は、ローダーの**厳格モード**でエラーにします（多くの YAML パーサはデフォルトで重複キーを
  後勝ちで黙って上書きするため、明示的な安全策として必要です）。
- ロード後に別途**バリデーションステップ**を設けます。
- 同じ ID を持つ定義が複数のファイルに存在する場合のマージ・上書き規則は未定です（17 節）。

## 4. object_defs（型定義）

型定義は `object_defs` の下に、識別子を**キーとして**表現します（値ではありません）。

```yaml
object_defs:
  stone:
    props:
      weight:
        value: 10
```

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

`props`（6 節）以外にも、`actions`・`combinations`・`recipes`・`slots`・`passive` を trait 経由でまとめて配布できます。
`value` を持たないプロパティは、5 節のルール通り空のマッピング（`{}`）として表現します。

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

### 6.3 range / on_overflow（周回・上限）

上限に達したら折り返す（あるいは繰り上げる）プロパティは、`range`（取りうる上下限）と `on_overflow`（上限到達時の挙動）を
持たせます。`value` の `{min, max}`（6.2 節、毎 tick 再ロールする範囲）とは別の仕組みです。

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

- `mode: wrap` は `carry_to` へ繰り上げて 0 に戻ります（`carry_to` が必須になります）。
- `mode: none` は上限なしです。

### 6.4 stages（段階）

数値プロパティは `stages` を持つことができ、現在値がどの段階にあるかによって、有効になる `passive`（8 節）が
切り替わります。

- 段階の区間定義は **`min`（下限）のみ**を指定します。上限は次の段階の `min` によって自動的に決まります
  （半開区間、`[min, 次のminより手前]`）。この方式により、区間の隙間や重複が構造的に発生しません。
- 最下段の段階は `min: null`（または省略）とし、それより下の残り全ての値を拾います。
- 現在値に基づいて常に一意に段階を決定します。ヒステリシス（上昇時・下降時で閾値をずらす仕組み）は採用しません。
- ステージの `passive` はレベルトリガー（そのステージにいる間ずっと有効）のみです。ステージ切替の瞬間だけ発火する
  edge-triggered な仕組み（`on_enter`/`on_exit` 的なもの）は導入していません。「値が 0 になった瞬間」という実際に
  必要なケースは、専用の `on_zero`（6.5 節）で表現します。

```yaml
props:
  progress:
    stages:
      - name: none
        min: 0
      - name: mild
        min: 20
        passive:
          parent:
            accumulate:
              temperature: 1
      - name: feverish
        min: 50
        passive:
          parent:
            accumulate:
              temperature: 2
              hydration: -1
```

### 6.5 on_zero（0以下である間、毎tick実行される内容）

`on_zero` は、プロパティが**0以下である間、毎 tick 実行される `active`（9 節）内容**です。`passive` の `modify`/
`accumulate` と同じレベルトリガーの考え方を、`add`/`destroy`/`spawn`（一時的な命令）に適用したものです。「跨いだ
瞬間だけ」を検出する仕組み（前 tick との比較）は持たず、現在値だけで判定します。

- 毎 tick 実行されても安全なのは、典型的な用途が自己終端するためです。`destroy` は既に破棄済みのオブジェクトに
  対して繰り返し実行しても安全（冪等）です。`spawn` を伴う場合は、同じ `on_zero` 内で `destroy` と組み合わせるのが
  基本形であり、破棄後はそのオブジェクト自体が tick の対象でなくなるため、2回目以降の実行は起こりません。`destroy`
  を伴わずに `spawn` だけを書くと、0以下である間 tick 毎に生成し続けてしまう点に注意してください。
- `on_zero` の中身は `active` と同じ対象キーの辞書を直接持ちます。専用のラップは挟みません。

```yaml
props:
  durability:
    value: 100
    range: {min: 0, max: 100}
    passive:
      self:
        accumulate:
          durability: -1
    on_zero:
      self:
        destroy: true
    stages:
      - name: intact
        min: 1
      - name: broken
        min: null
```

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
slots:
  inventory: {}          # 制約なし
  materials:
    accepts:
      - {object: wood, max: 2, consume: true}
      - {object: stone_knife, max: 1, consume: false}
```

- `consume: true` は素材として消費される、`consume: false` は道具として存在確認のみ行うことを表します。
- `capacity`（7.3 節）とは独立した仕組みで、1 つのスロットが両方を同時に持てます。

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

## 8. passive（持続する影響）

`passive` は、`self`/`parent`/`child` の関係とゲート（常時／`when: <スロット名>`／プロパティの stage）に紐づいて
登録され、**その関係が続く限り評価され続ける**、持続する影響を表します。次の 3 つのレベルで定義でき、いずれも
同一の記法・実行原理を用います。

1. **オブジェクトレベル**（例: 防具そのものが持つ複数の恩恵の束）
2. **プロパティレベル**（例: アイテムの重量プロパティが持ち主の負荷に寄与する）
3. **プロパティのステージレベル**（6.4 節）

### 8.1 対象キー

`passive` は、効果の対象を識別子とするキーの辞書型です。定義するのは `self`（自分自身）・`parent`（親）・
`child`（子）・`actor`（このアクションを実行しているプレイヤーキャラクター、11 節参照）の 4 つです。

```yaml
object_defs:
  armor_leather:
    covers: [torso]
    layer: base
    passive:
      parent:
        when: equip
        modify:
          defense: 5
          speed: 3
          accuracy: 2
```

### 8.2 when（ゲート）

- `when: <スロット名>` … そのスロットに入っている間、継続的に有効（レベルトリガー）
- 省略した場合は「常時（無条件）」を意味します。
- `when` は対象ごとのキーの中に書きます。1 つの `passive` の中で、対象ごとに異なる `when` を持たせられます。

### 8.3 modify

条件が真である間だけ計算式に寄与する、**可逆的な**修飾子です。条件が偽になった瞬間に寄与は自動的に消えます。値
そのものを書き換えるのではなく、実効値を都度導出するための入力として扱います。

- 同一プロパティに対する複数の `modify` は単純加算で合成します。
- 合成結果の上限・下限（min/max）はプロパティ側の `range`（6.3 節）に持たせます。

### 8.4 accumulate

条件が真である tick 毎に、対象プロパティの実体値へ直接・**不可逆**に加減算します（例: 出血中の血液量減少、耐久値の
毎 tick 減少）。`modify` と全く同じ登録・ゲートの仕組みを使い、違いは可逆か不可逆かだけです。

## 9. active（一時的な命令）

`active` は、アクション・組み合わせ・確率分岐の結果が確定した瞬間に、**無条件で1回だけ**適用される命令です。
持続する条件を表す `when`/ゲートは持たず、`modify`/`accumulate` のような登録の仕組みにも乗りません。

### 9.1 対象キー

`active` も `self`/`parent`/`child`/`actor` という同じ対象キーの辞書型を使います。`combinations`（12 節）の中では、
これに加えて **`dragged`**（ドラッグされてきたカード）も使えます。

```yaml
actions:
  eat:
    active:
      actor:
        add:
          satiety: 10
      self:
        destroy: true
```

`add`・`destroy`・`spawn` は、対象キー（`self`/`parent` など）の直下に並ぶ**対等な兄弟キー**です。値を操作するか
（`add`）オブジェクトの存在を操作するか（`destroy`/`spawn`）という区別のための専用の入れ子はありません。

### 9.2 add

対象プロパティの実体値へ、その場で一度だけ不可逆に加減算します。`when`/常時の継続的な加算は `accumulate`
（8.4 節）が担うため、`add` は一時的な命令専用です。

### 9.3 destroy

`true` を指定すると、対象オブジェクトを消滅させます。すべてのオブジェクトは必ずworldを根とするツリーに
所属するため（7.1 節）、`destroy` は「現在の親スロットから切り離す」こととして表現できます。繰り返し実行しても
安全（冪等）です。

### 9.4 spawn

`{object, into}` を指定すると、新規オブジェクトを生成し、指定した場所へ配置します。`destroy` と同じ対象キーの
中で同時に指定でき（`{spawn: {...}, destroy: true}`）、「新しいオブジェクトを生成しつつ、自分自身は消滅させる」と
いう組み合わせを1つのエントリで表現できます。

**`into`（配置先）** は、以下のいずれかです。

- **`same_slot`**: この`active`/`on_zero`を宣言したオブジェクト（`self`）が今いる、まさにその場所（親とスロット）
  へ配置します。クラフト・腐敗など、「同じ場所で別の物に置き換わる」場合に使います。スロット名を書く必要は
  ありません（`self`の現在の所属先から動的に決まるため）。
- **`<root>.<slot>`**: `self`/`parent`/`actor`/`actor_parent`のいずれかを起点に、指定したスロットへ配置します。
  `actor`（アクション実行者）・`actor_parent`（actorが現在いる場所）は、アクション実行文脈でのみ解決できます。
  `on_zero`には`actor`が存在しないため使えません（後述の`fallback`が無ければ何も起きません）。

```yaml
active:
  self:
    spawn: {object: rotten_wood, into: same_slot}
    destroy: true
```

配置先の`accepts`/`capacity`に合わず配置できない場合に備え、**`fallback`**を指定できます。`fallback`は`into`と
異なり`same_slot`は使えず、必ず`<root>.<slot>`形式で指定します。`into`への配置に失敗した場合にのみ`fallback`が
試みられ、`fallback`は`accepts`/`capacity`を無視して必ず配置に成功します（すべてのオブジェクトは必ずどこかの
親に属さなければならないため）。

```yaml
active:
  self:
    spawn: {object: item_coconut, into: actor.inventory, fallback: actor_parent.ground_items}
```

`fallback`を指定していない場合、`into`への配置に失敗すると、そのオブジェクトはどこにも配置されないまま消えます
（生成自体はされますが、worldツリーに繋がらないため、存在しなかったのと同じ扱いになります。7.1 節参照）。

### 9.5 active が書ける場所

`active` は次のいずれかの位置に直接書きます。持続する条件を表す `when`/ゲートを持つ `passive` とは、書ける場所が
構造上重ならないため、両者を混同する余地はありません。

- `actions`/`combinations` の実行結果（11 節・12 節）
- `pick` の各候補（10 節）
- `props` の `on_zero`（6.5 節）

## 10. pick（重み付き確率分岐）

`pick` は、`active` を書く場所であればどこでも、**`active` の代わりに**書ける、重み付き候補のリストです。新しい
トリガー体系は必要とせず、`passive`（無条件／`when`／stage 内）には書けません。`passive` は「いつ振るか」という
瞬間を持たない、関係とゲートに基づく継続的な評価だからです。

### 10.1 基本構造

各候補は `weight` に加えて、自分自身の `active`（対象をキーとする辞書）を丸ごと持ちます。候補が1つしかない場合は、
重みの値に関わらず必ずそれが選ばれます。

```yaml
actions:
  attack:
    showMenu: always
    pick:
      - weight: 50
        active:
          self:
            destroy: true
      - weight: 50
        active:
          actor:
            destroy: true
```

候補ごとに影響を受ける対象（`self`/`actor` など）そのものが異なるケースも、このように表現できます。`pick` の
入れ子は再帰的であり、候補の `active` の代わりにさらに別の `pick` を書くこともできます。

各候補の `active` に書ける内容は、一時的な命令（`add`/`destroy`/`spawn`）に限られます。`modify`/`accumulate` は
関係とゲートに基づいて登録され、その関係が続く限り評価され続けることに意味がある仕組みのため、1回選ばれて終わる
`pick` の候補に書く意味がありません。

### 10.2 weight

`weight` は、専用の計算式（base値＋条件付き補正）を新設せず、以下のいずれかとして表現します。

- **リテラル定数**: 外部からの干渉を想定しない候補向け。
- **既存プロパティへの参照**（`{path: <プロパティのパス>}`）: 外部から干渉させたい候補向け。参照先は、通常の
  `props` として定義された値です。

```yaml
pick:
  - weight: {path: self.accuracy}
    active:
      self:
        add: {hp: -10}
  - weight: 40
    active: {}
```

外部からの干渉（「戦闘スキルが高いほど命中しやすい」等）は、`weight` 自体に専用の補正記法を用意するのではなく、
参照先のプロパティに対する通常の `modify` 効果として表現します。

## 11. actions（メニュー型操作）

アクション（`eat`、`move` など）は、条件（`conditions`）と実行結果（`active`/`pick`）を**1つの定義としてまとめて
持ちます**。`object_defs`/`traits` の中に配置します（トップレベル独立キーにはしません）。

```yaml
traits:
  eatable:
    actions:
      eat:
        showMenu: always
        conditions:
          - {path: actor.satiety, op: lt, value: max}
        active:
          actor:
            add:
              satiety: 10
          self:
            destroy: true
```

### 11.1 showMenu

メニューへの表示方法を制御します。現時点では `always` のみです。

### 11.2 conditions

`{path, op, value}` の AND リストです（14 節）。

### 11.3 active / pick

このアクションが実行された瞬間に、`active`（9 節）が1回だけ適用されるか、`pick`（10 節）で候補が1つ選ばれて
適用されます。

**`actor` はすべてのアクションに暗黙的に存在し、常にプレイヤーキャラクターを指します。** `parent`（木構造上の直接の
格納先）とは独立した参照です。

## 12. combinations（ドラッグ型操作）

`combinations` は、**ドロップされた側（受け側）のオブジェクト**に定義します。`with`（ドラッグされてきたカードの
`object_def` の id、または trait の名前）でマッチング対象を指定します。

```yaml
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        conditions:
          - {path: dragged.durability, op: gt, value: 0}
        active:
          self:
            spawn: {object: logs, into: parent.inventory}
            destroy: true
          dragged:
            add:
              durability: -1
```

### 12.1 with

マッチング対象を、`object_defs` の id または trait 名で指定します。trait 名を使えば、そのtraitを持つあらゆるカード
（MOD 追加分も含む）と一致します。

### 12.2 dragged

`active`/`pick`（9 節・10 節）の対象キーに、`self`/`parent`/`child`/`actor` に加えて **`dragged`**（このインタラク
ションでドラッグされてきたカード）を使えます。`combinations` の中でのみ意味を持つ、専用のキーです。

### 12.3 対称的な組み合わせ

どちらのカードをどちらにドラッグしても成立してほしい組み合わせは、**両方のカードに `combinations` を書く**ことで
表現します。専用の「双方向」記法はありません。

```yaml
object_defs:
  stick:
    combinations:
      craft_spear:
        with: rope
        active: {...}
  rope:
    combinations:
      craft_spear:
        with: stick
        active: {...}
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

`{path, op, value}` の形を取ります。

```yaml
conditions:
  - {path: actor.satiety, op: lt, value: max}
```

### 14.1 path

参照ルートから始まるドット区切りのパスです。定義されている参照ルートは `self`（宣言したオブジェクト自身）・
`parent`（その親）・`actor`（実行しているプレイヤーキャラクター）・`world`（9 節のシングルトン）・`dragged`
（`combinations` 内のみ、12.2 節）です。

### 14.2 op（比較演算子）

`lt` / `lte` / `gt` / `gte` / `eq` / `neq` / `in` / `not_in` を定義しています。

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
        on_overflow: {mode: none}
      minute_of_day:
        value: 0
        range: {min: 0, max: 1439}
        on_overflow: {mode: wrap, carry_to: day}
```

日時・天候はオブジェクトから直接参照されるのではなく、**環境がオブジェクトに影響を与える**という位置づけです
（例: 明るさによって行動可否が変わる）。直接のプロパティ参照経路（`world.xxx`）は 14 節の `path` で使います。

## 16. 本書の対象外

- **地形生成**（`Axis`/`LocationType`/`generation_scope` 等）: 記法自体は本書と同じ「識別子をキーとする辞書」に
  統一済みですが、フィールド名・詳細な軸空間マッチングは `TerrainGeneration.md` が検討中の段階のため、本書には
  含めません。
- **`derived`（導出値）**: 「他の props から計算される値」という概念自体、採否がまだ決まっていません（17 節）。
- **YAML 定義のマージ・上書き規則**（3.3 節）: 別途仕様書で定義します。

## 17. 今後の検討課題

- `derived`（導出値）の採否。採用する場合、`stages`（6.4 節、`min` による半開区間）とキー名・記法を統一するか
- 同一 ID の定義が複数ファイルに存在する場合のマージ・上書き規則（3.3 節）
- ステージ切替の瞬間だけ発火する edge-triggered な仕組み（`on_enter`/`on_exit` 的なもの）の要否と記法。「0になった
  瞬間」は `on_zero`（6.5 節）で解決済みだが、それ以外のステージ境界を跨いだ瞬間に発火したいケースが今後生じた
  場合の対応は未検討
- `day` の上限（無制限のまま加算し続けるか、年単位で wrap して `year` プロパティを持つか）
- 天候遷移自体（いつ・どの天候に切り替わるか）のランダム性の仕組み（6.2 節）
- `passive`/`active` の対象キーに `ancestor`/`sibling`/`descendant` を追加するかどうか
- `pick` の位置づけ（候補に `modify`/`accumulate` を書けないことの扱い）
- `weight`（10.2 節）の参照記法。`{path: ...}` への統一か、`weight: accuracy` のような裸の名前も許容するか
- `weight` の合計が0（またはマイナス）になった場合のフォールバック候補の扱い
- `pick` の候補から「別のアクションを実行する」ための記法（エフェクトから能動的にアクションを発火する仕組み自体が
  まだない）
- action / combinations の比較演算子セット（14.2 節）の過不足、`between` 等の追加要否
- `slots` が character 専有の概念か、コンテナ全般で使い回す汎用概念か
- `weight_rate`（7.4 節）が 1.0 を超えるケースを許容するか
- `combinations` に関する未決事項一式（キーの衝突解決、MOD 拡張性など）は `ActionSystem.md` に整理
- レシピに関する未決事項一式は `RecipeSystem.md` に整理
- コンテナの容量・重さに関する未決事項一式は `ContainerSystem.md` に整理

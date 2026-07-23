# 探索・道システム設計

## 概要

本ドキュメントは、[`TerrainGeneration.md`](./TerrainGeneration.md) の地形生成パイプラインによって作られた
`Location`（土地）が、生成された**あと**にどう振る舞うかをまとめたものです。「島にどんな土地がいくつ、どう
配置されるか」は `TerrainGeneration.md` の関心事、「1つの土地に立ったプレイヤーが何をできるか（探索する・道を
見つける・移動する）」は本書の関心事、と役割を分けています。

文法そのものは [`GameElementDefinition.md`](./GameElementDefinition.md) に集約されている既存の仕組み
（`traits`・`slots`・`props`・`actions`・`pick`）だけで組み立てており、探索・道専用の新しい文法は導入していません。
ただし、実装にあたってエンジンへ2つの汎用拡張（`duration`・`move`）を追加しています。これらは地形専用ではなく、
`GameElementDefinition.md` 11.3 節・9.6 節に文法として記載されています。

本ドキュメントは検討結果であり、確定仕様書ではありません。未決事項は 6 節にまとめています。実際のクラス名・
メソッド名を使った実装の呼び出し関係（`IslandSpawner`・`MoveEffect`・`Views.Location.Explore` 等）は
[`TerrainGenerationImplementation.md`](./TerrainGenerationImplementation.md) にまとめています。

## 1. `location` trait と `explorable` trait の役割分担

「場所」であるという構造（3種のスロット）と、「探索できる」という性質（進捗・道の発見）は、**別々の trait**
に分けています。両者は独立した軸であり、探索できない場所（例えば、プレイヤーが拠点として使う家・作業小屋の
ような建造物）も「場所」である以上、木や植物・建築物や家具などの設置物用のスロット・アイテム用のスロット・
キャラクタ用のスロットは必要です。そのため、これらのスロットは探索の可否に関わらずあらゆる場所が持つべき
構造として、`explorable` ではなく `location` trait（`core.yaml`）側に置いています。

- **`location`**（`core.yaml`）: あらゆる場所が共通して持つ構造。**3種のスロット**（`items`/`fixtures`/
  `characters`）と、`world.locations` スロットの `accepts` 判定用のタグ配布。草原のような探索可能な土地も、
  家のような探索を伴わない場所も、場所である以上すべてこの trait を実装します。
- **`explorable`**（`locations.yaml`）: 探索**できる**場所だけが追加で持つ構造。探索進捗プロパティと、
  道の発見に使う2スロット（`undiscovered_paths`/`paths`）。家のように探索を伴わない場所は、この trait を
  実装しません（`traits: [location]` のみで成立します）。

```yaml
# core.yaml
traits:
  location:
    tags: [location]
    slots:
      items:
        accepts: [{tag: item, max: 9999}]
      fixtures:
        accepts: [{tag: fixture, max: 9999}]
      characters:
        accepts: [{tag: character, max: 9999}]
        unit_capacity: 1
        fixed_positions: true
```

```yaml
# locations.yaml
traits:
  explorable:
    slots:
      undiscovered_paths:
        accepts: [{tag: path, max: 9999}]
      paths:
        accepts: [{tag: path, max: 9999}]
    props:
      exploration_progress: {}   # valueなし = 実装する側で必須（5節）
```

草原などの探索可能な土地は両方を参照します（`traits: [location, explorable]`）。家のような場所は
`location` のみを参照すれば、探索の仕組み（進捗・道）を持たずに3種のスロットだけを得られます。

### 1.1 3種のスロット（`location` trait）

すべての場所は次の3種のスロットを持ちます。いずれも `capacity`（サイズの合計制限、7.3 節）は指定していません。

- **`items`**: アイテムが置かれるスロット。
- **`fixtures`**: 木や植物、建築物や家具、洞窟の入口などの設置物が置かれるスロット。
- **`characters`**: キャラクタを入れるスロット。`fixed_positions: true`・`unit_capacity: 1`（固定型、
  スタック数1つだけ）。

`items`/`fixtures` の区別はタグ（`item`/`fixture`）だけで行い、探索の発見物（2 節）を `spawn` する際、
どちらのスロットへ入るかは著者がスロット名を指定せずとも自動的に決まります（`spawn` の `into` が起点の持つ
スロットを宣言順に走査する、9.4 節）。`items` を宣言順の先頭に置いているのは、`spawn` が配置に失敗した際の
フォールバック（起点自身の親へ強制配置、9.4 節）が同じく先頭のスロットへ入るためで、「持ちきれない発見物は
地面（土地の `items`）に落ちる」という直感的な結果を、追加のルールなしに実現しています。

### 1.2 道の2スロット（隠しスロット方式、`explorable` trait）

要求にあった「土地同士の繋がり方を記述する方法」は、Card Survival と同様に**探索によって見つかる `path` という
専用オブジェクト**として表現しました。この「発見」を実装する方式として、以下の2案を検討しました。

- **隠しスロット方式（採用）**: `undiscovered_paths`（隠し）と `paths`（公開）の2スロットを持ち、生成時点で
  道は `undiscovered_paths` に置かれます。探索の進捗が道ごとの必要値に達すると、`paths` へ移動して「発見」
  されます。道オブジェクト自体は生成時から実在するため、UI側は「発見済みの `paths` の中身だけを表示する」
  だけでよく、未発見の道を非表示にする特別な処理を持つ必要がありません。
- **条件ゲート方式（不採用）**: 道は最初から1つのスロットに置かれ、移動アクション自体に「親の探索進捗 ≥
  必要な進捗」という条件を持たせて実行を禁止する。YAMLだけで完結しますが、未発見の道をカード一覧から隠す
  処理を UI 側に別途実装する必要があり、「発見」という状態遷移がどこにも実体を持ちません。

隠しスロット方式を採用したことで、「発見」は `undiscovered_paths` → `paths` という既存の `move_to_slot`
（唯一の汎用スロット移動操作、7.1 節）1回で表現でき、UI 側は「パススロットの中身を表示する」という単純な
規約だけで正しく振る舞います。

## 2. 探索（`explore` アクション）

要求どおり、「探索で何が見つかるか」は `explorable` trait にも実装せず、土地ごとの `object_defs`
（`locations.yaml`）が個別に定義します。探索できる回数（進捗プロパティの上限）も同様に個別定義です。
`explorable` trait 自身が持つのは、進捗を保持する箱（`exploration_progress`）と道の発見に使う2スロット
（1.2 節）という、あらゆる探索可能な土地に共通する器だけです。

```yaml
object_defs:
  grassland:
    traits: [location, explorable]
    props:
      exploration_progress:
        value: 0
        range: {min: 0, max: 12}   # 探索できる回数
    actions:
      explore:
        showMenu: always
        duration: 30
        conditions:
          - {prop: exploration_progress, op: lt, value: 12}
        pick:
          - weight: 25
            add: {self: {exploration_progress: 1}}
          - weight: 25
            add: {self: {exploration_progress: 1}}
            spawn: {object: water_spinach, into: self}
          # ...
```

- **探索可能回数**: `exploration_progress` の `range.max`（要求どおり 10〜20 の範囲。土地ごとに異なる）。
  `explore` の `conditions` は `value: max` という参照記法が未対応（`GameElementDefinition.md` 17 節）のため、
  `range.max` と同じ値をリテラルで重複して書いています。二重管理になる点は、`Tests/StreamingAssets/
  LocationsYamlTests.cs` が実際の探索を上限まで回す振る舞いテスト（「max-1では実行でき、maxでは実行できない」）
  で検証しており、値のずれがあれば必ず失敗します。
- **発見物**: `pick`（10 節）による重み付き抽選です。`add`（進捗+1）と `spawn`（発見物の生成）は`pick`の
  同じ候補の中に共存できます（10.1 節。候補は複数の一時的な命令を持てます）。「ハズレ」（進捗だけが増える
  候補）を必ず用意しています。`add`/`pick` は排他な兄弟キーという既存文法（`ParseActiveEffectBody`
  参照）のため、進捗+1は毎回、すべての候補に個別に含めています。
- **`duration`**: 1回の探索にかかる時間（分、`GameElementDefinition.md` 11.3 節）。見通しの悪い土地
  （密林・岸壁など）ほど長く設定しています。

## 3. 道（`path` object_def）と移動

```yaml
object_defs:
  path:
    tags: [path]
    props:
      travel_minutes:
        value: 60          # 生成時にインスタンスごと上書きされる
      required_progress:
        value: 1           # 同上
      destination_id:
        value: 0           # 同上（移動先LocationのインスタンスID）
    actions:
      travel:
        showMenu: always
        conditions:
          - {in_slot: paths}   # 発見済み（pathsスロット）の間だけ実行できる
        duration: {prop: travel_minutes}
        move:
          object: actor
          to_prop: destination_id
```

- **`travel_minutes`/`required_progress`/`destination_id`** はいずれも `path` の通常の `props` で、地形生成
  （`Domain/Generation/IslandSpawner`）がインスタンス生成の直後に `SetProperty` で書き込みます。`object_defs`
  レベルの初期値はプレースホルダで、実際に使われるのは常にインスタンスごとの上書き後の値です。
- **`conditions: [{in_slot: paths}]`**（`GameElementDefinition.md` 14.2 節）が「未発見（`undiscovered_paths`
  側）の間は移動できない」を表します。1 節の隠しスロット方式と組み合わさり、「発見されていない道は移動も
  できない」が自然に両立します。
- **`move`**（`GameElementDefinition.md` 9.6 節で新設した汎用の active 動詞）が、`actor` を `destination_id`
  が指すインスタンスへ移動させます。移動先を `object_defs` の id（型）ではなくプロパティ値（インスタンスID）
  で指しているのは、同じ `LocationType` の土地が1つの島に複数存在しうる（例: 「東の草原」と「北の草原」）
  ため、型ではなく**生成時に確定した特定の個体**を指す必要があるからです。

### 3.1 道は辺1本につき両端へ2個

地形生成（`TerrainGeneration.md` 3.5 節）が確定させる `Location` 間の1本の繋がりに対し、`path` インスタンスを
**両端に1個ずつ**生成します。片方は「Aの `undiscovered_paths` に居て、`destination_id` はBを指す」、もう片方は
その逆です。この非対称な表現により、「Aから探索を進めて先にAB間の道を見つけたが、Bはまだその道を見つけていない」
という状態を、特別な仕組みなしに自然に表現できます（Bからは、B側の道インスタンスの `required_progress` に
達するまで、同じ繋がりは見つかりません）。

### 3.2 required_progress の割り当て（探索可能回数を使い切る前に道が見つかることの保証）

要求「進捗率最大に達するのに必要な探索回数は10〜20回とし、最大に達する前に道が見つかるようにする」を、
データの調整ではなく**生成側の不変条件**として保証しています。

ある土地に接続する道が K 本あるとき、それぞれの `required_progress` を、探索上限を `max` として
`[2, max − 1]` の範囲へ均等間隔で割り当てます（`Domain/Generation/IslandSpawner`）。最初の道が進捗2で
見つかる（1回目の探索でいきなり道が見つからないようにする）のを最速とし、最後の道は必ず `max − 1` 以前に
見つかります。この不変条件は `Tests/Generation/IslandSpawnerTests.cs` が全接続について検証しています。

## 4. エンジン拡張（`duration`・`move`）

本システムの実装にあたり、`GameElementDefinition.md` へ2つの汎用拡張を加えました。地形・探索専用の機能では
なく、他のどんな `actions`/`combinations`/`pick` からも使える一般的な文法拡張です。

- **`duration`**（`GameElementDefinition.md` 11.3 節）: アクションの実行にかかるゲーム内時間（分）。
  リテラルか `{object, prop}` 参照（`weight` と同じ二択）で指定します。実行結果の適用後に
  `WorldSession.AdvanceWorldTime` で時間を進めます（先に進めると、tick駆動の変化が効果適用前の対象を
  消してしまう事故がありうるため、適用後に進めます）。それまでのエンジンには「アクションの所要時間」という
  概念自体がなく（レシピの `duration` はレシピの工程専用、13.1 節）、探索・移動のどちらにも必要だったため
  新設しました。
- **`move`**（`GameElementDefinition.md` 9.6 節）: 対象オブジェクトを、`self` のプロパティが指す
  インスタンスIDのオブジェクトへ移動させる active 動詞。既存の `set`/`add`/`destroy`/`spawn`/`transfer` には
  「既存オブジェクトの所属先そのものを変える」動詞がなく、新設しました。

## 5. カプセル化: 探索の入口を1箇所にする

`Runtime.Views.Location.Explore(actor, session)` を、探索の唯一の入口としています。

```csharp
public bool Explore(WorldObject actor, WorldSession session)
{
    if (!Instance.TryExecuteAction("explore", actor, session)) return false;
    RevealDuePaths(session);   // 進捗が必要値に達した道を、隠しスロットから公開スロットへ移す
    return true;
}
```

`explore` アクション（YAML側）の実行と、それに伴う「進捗が必要値に達した道を公開する」という後処理
（`RevealDuePaths`）を、呼び出し側（UI等）に分けて呼ばせません。呼び出し側は「探索してほしい」と依頼する
だけでよく、探索の後に何を判定すべきか（道の公開）を知らなくてよい設計にしています
（`CLAUDE.md` の「自分のことは自分でする」方針）。`RevealDuePaths` 自体は冪等なため、進捗がYAML側の効果
だけで動いた場合に備えて `Paths` アクセサからも呼べるようにしています。

## 6. 未決事項・今後の検討課題

- **洞窟内部の生成**: `cave_entrance`（探索で見つかる `fixture`）は、`TerrainGeneration.md` 3.7 節が構想する
  「内部に子 `Location` グラフを持つ `Structure`」の入口として先に用意したプレースホルダです。
  `structure_interior` 生成スコープの具体的なスキーマと、洞窟内部への遷移アクション（`move` の応用）は
  未実装です。
- **`spring`（湧き水）の給水アクション**: 発見されるだけのプレースホルダで、`drink` 的なアクションは
  `ContainerSystem.md` の液体表現の実装とあわせて今後の課題です。
- **発見物の `size`/`weight`**: 探索で見つかるアイテム・設置物は、コンテナ容量（`ContainerSystem.md`）に
  関わる `size`/`weight` プロパティをまだ持たせていません。
- **`name_pool`（固有名詞）**: `TerrainGeneration.md` 3.6 節が構想する、印象的な地形への固有名詞付与は
  未実装です（現状は「方角+LocationType表示名」、重複時は漢数字の接尾辞のみ）。
- **同じ土地への道が3本以上ある場合の分布**: 現在の等間隔割り当ては K 本すべてに対して機械的に働きますが、
  「最初の道が見つかるまでが長すぎる／短すぎる」といった体験上の調整は今後の課題です。

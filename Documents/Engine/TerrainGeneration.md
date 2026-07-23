# 地形生成システム設計

## 概要

本ドキュメントは、島の地形生成システムに関する設計と実装をまとめたものです。
[`GameElementDefinition.md`](./GameElementDefinition.md) が掲げる「ハードコードしない」「汎用エンジンに
任せる」「ファイル追加だけで拡張できる」という設計方針（2.4 節）に準拠し、以下を目的とします。

- シード値ありのランダム生成で無人島の地形を生成する
- 地形・構造物はすべて YAML でオブジェクト定義し、MOD 作成者がコードに触れずに拡張できる状態を保つ

本書が扱うのは、**島の座標・軸・LocationType・パスネットワークを生成するアルゴリズムそのもの**です。生成された
`Location`（土地）が生成された**あと**にどう振る舞うか（スロット構成・探索・道の発見・移動）は
[`ExplorationSystem.md`](./ExplorationSystem.md) に切り出しています。両者を分けているのは、前者が「どんな島が、
どんなレイアウトで生成されるか」という**生成時点だけの計算**（`Domain.Generation` 名前空間、`WorldObject` には
一切触れない純粋な計算）であるのに対し、後者は「生成された `Location` インスタンスがゲームプレイ中どう振る舞うか」
という**実行時の挙動**（既存の `traits`/`actions`/`slots` の応用）であり、関心事の性質が異なるためです。

本書は設計判断（なぜこのアルゴリズムか）を扱い、実際のクラス名・メソッド名を使った実装の呼び出し関係は
[`TerrainGenerationImplementation.md`](./TerrainGenerationImplementation.md) に切り出しています。
コードを読む・変更する際はそちらを参照してください。

実装は `Assets/Scripts/Domain/Generation/` 以下（Unity非依存の純粋 C#）、定義データは
`Assets/StreamingAssets/WorldCodex/terrain_generation.yaml`（生成パラメータ）・`locations.yaml`（土地・道の
`object_defs`）にあります。

## 1. 用語定義

| 用語 | 説明 |
|---|---|
| **Axis（軸）** | 標高・湿り気など、地点が持つ連続値パラメータの 1 次元。ジェネレータ（ノイズ/距離場など）によって値が決まる。値は 0〜100 の整数（後述） |
| **Site（地点）** | 座標と軸ベクトルのみを持つ、`LocationType` 未確定の中間状態のノード |
| **環境（Environment）** | 軸ベクトルが表す性質そのもの。データ構造として実体化はしない（クラスや YAML 定義を持たない）。`Site` 同士の軸ベクトルの近さという関係性としてのみ存在する概念 |
| **LocationType** | 「草原」「洞窟」など、配置の定義（YAML）。プレイヤーには見えない設計者側の語彙 |
| **Location（土地）** | 実際に生成・命名された実体。「東の草原」のようにゲーム内で識別可能な名前を持つ。パスネットワークのノードでもある |
| **Structure（構造物）** | 内部に子 `Location` のグラフを持つ、特殊な `Location`。「島の中に埋め込まれた入れ子の島」として扱う（**未実装**、6 節参照） |
| **Coordinate/Position** | 単なる座標値。`Site`/`Location` が持つプロパティの一つ |

## 2. 生成パイプライン全体像

```
[generation_scopes (YAML)]
   ↓ サイト数の抽選 + 座標配置（外周リング + 内陸への散布）
[Site群] (座標のみ)
   ↓ Axis定義(YAML)のジェネレータ(距離場/ノイズ)を各座標でサンプリング
[Site群] (座標 + 軸ベクトル)
   ↓ guarantees（軸カバレッジの強制割当） → LocationType の axis_preferences との最近傍マッチング
   ↓ (フォールバック処理)
[Location群] (LocationType確定)
   ↓ Delaunay三角形分割 → MSTで間引き → 迂回率に応じて一部の辺を復活
[Locationネットワーク] (距離・移動時間つきパスで接続)
   ↓ 8方位 + LocationType.display_name で命名
[Location群] (命名済み)
   ↓ IslandSpawner が object_defs を spawn し、world.locations へ配置
   ↓ 辺ごとに path を両端へ生成し、undiscovered_paths（隠しスロット）へ配置（ExplorationSystem.md）
[実体化済みの島]
```

座標決定（サイト配置）を軸のサンプリングより先に行う点が、当初の構想（概念設計段階の草案）からの変更点です。
`Site` は座標を先に持たなければ、座標に依存する軸のジェネレータ（距離場・座標ベースのノイズ）を評価できない
ため、パイプラインの順序を「座標決定が最上流」に統一しています。

**構造物内部の生成は未実装です**（6 節参照）。「島の生成と構造物内部の生成は同一の生成ロジックを共有する」
という設計方針自体は維持しており、`generation_scopes` にスコープ（現状は `island` のみ）ごとのパラメータ
プリセットを持たせる形で実装済みです。`structure_interior` スコープを追加すれば、同じ `TerrainGenerator` が
そのまま再帰的に使える設計になっています。

## 3. 各ステップの詳細仕様

### 3.1 Axis定義とジェネレータプリミティブ

Axis は汎用プリミティブの重み合成（`generator.blend`）で値を生成します。**軸の値は 0〜100 の整数**です
（`GameElementDefinition.md` 6 節「数値プロパティの値は 32bit 整数」という規約に合わせ、YAML に小数を
登場させません。ジェネレータの内部計算には実数を使い、`AxisDef.Range` へ量子化する時点で整数に丸めます）。

現在実装済みのプリミティブは2種です。

- `distance_field`（`reference: edge`）: 島の縁からの距離場（縁 = 0、中心 = 1）
- `layered_noise`: シード付きの格子値ノイズ（`octaves`/`frequency`/`seed_offset` を持つ）。座標を
  `SitePlacer.IslandRadius` で正規化してから `frequency` を掛けるため、`frequency` は「島の直径あたりの
  起伏の数の目安」として機能する

`blob_scatter`（局所的に濃い領域を作る散布）・`modifiers`（他の軸との合成演算）は、実際の10土地種の定義には
まだ必要にならなかったため未実装です（6 節）。

```yaml
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 70}
        - {type: layered_noise, octaves: 3, frequency: 2, seed_offset: 11, weight: 30}
```

**設計上の注意**: 軸の種類・数はハードコードしません。`Axis` 定義自体が YAML で完結し、`LocationType` 側は
「言及した軸だけ気にする」設計にすることで、軸の増減に対して `LocationType` 定義が壊れないようにします
（3.2 節参照）。実際の定義は `Assets/StreamingAssets/WorldCodex/terrain_generation.yaml`（`elevation`・
`humidity`・`coastal_distance`・`ruggedness` の4軸）を参照してください。

### 3.2 LocationTypeマッチング（軸ベース）

各 `LocationType` は、軸空間上の「理想点＋許容範囲」として定義します。

```yaml
location_types:
  jungle:
    applicable_scopes: [island]
    move_cost: 160                     # 移動コスト（100 = 等倍。3.5節のtravel_minutesに使う）
    axis_preferences:
      humidity:   {ideal: 90, tolerance: 20, weight: 120}
      elevation:  {ideal: 30, tolerance: 30, weight: 60}
      # 言及しない軸は自動的に「無関心」（マッチング距離の計算に一切寄与しない）
    hard_limits:
      coastal_distance: {min: 16}      # 絶対的な除外条件。海岸帯には出ない
      humidity: {min: 65}
```

マッチングは、**言及した軸だけを対象に正規化した重み付きユークリッド距離**による最近傍探索です。

```
D(type, site) = sqrt( Σ_i w_i * ((v_i - ideal_i) / tolerance_i)^2  /  Σ_i w_i )
```

（`i` は `type` が `axis_preferences` に持つ軸のみを走る。`v_i` は `site` の軸値）

この式の設計判断（実装により確定した事項）:

- **`tolerance` は距離の**スケール**であり、閾値ではありません**。「`tolerance` を超えたら除外」という
  ゲートの意味は持たせていません（絶対的な除外は下記の `hard_limits` だけが担います）。1つの軸で
  `tolerance` 分ずれると正規化距離に 1 単位分寄与する、というスケール変換だけを行います。
- **`Σw_i` による正規化**により、言及する軸の数が異なる `LocationType` 同士でも公平に比較できます。
  正規化しない単純な加重和では、言及する軸が少ない型ほど和の項数が減って距離が構造的に小さくなり、
  常に有利になってしまいます（軸を1つだけ言及する型が、島全体を侵食してしまう類の事故）。`Σw_i` で割る
  ことで、この次元数バイアスを取り除いています。
- 同点（同じ距離）の場合は、`location_types` の宣言順で先に書かれた型が採用されます（決定的な挙動のため）。

`GameElementDefinition.md` が定義する「範囲による状態の決定」パターン（`stages`、6 節）と同様、値域に基づいて
分類を決める発想は共通していますが、`stages` は1つのプロパティの1次元の区間判定である一方、こちらは
複数軸にまたがる多次元の最近傍探索であるため、専用のマッチング処理（`Domain.Generation.LocationTypeMatcher`）
として実装しています。

### 3.3 マッチできない場合の処理（フォールバック）

- **絶対的な除外は `hard_limits` だけ**が行います。`hard_limits` を満たさない `LocationType` はマッチング候補
  から外れます（`axis_preferences` の `tolerance` は除外条件ではないため、これ単独ではどの候補も除外しません）。
- **フォールバック `LocationType`**: `is_fallback: true`。`hard_limits` によって全ての候補が除外された `Site`
  はこれが受けます（自身の `hard_limits` も無視する、最後の受け皿）。複数の `is_fallback` 型がある場合、
  `priority` が最大のものが選ばれます。
- **フォールバックの機能化**（設計方針として維持）: 特定の軸にのみ強くマッチする専用 `LocationType` を MOD
  側で追加すれば、フォールバックに落ちていた領域へ自動的に誘導できます。「マッチしない領域」は不具合ではなく
  「新しい `LocationType` を定義すべき場所」というシグナルとして扱う、という考え方は維持しています。

（概念設計段階の草案にあった「`tolerance` を超えたら最も合っていない軸を無視して段階的に緩和する」という
3段目の処理は実装していません。`tolerance` を閾値ではなくスケールとして扱うと定めたことで、そもそも
「`tolerance` を超えた」という状態自体を判定する意味がなくなったためです。）

### 3.4 出現数について（guaranteesによる明示的な保証）

**個別の `LocationType` ごとの出現数レンジ管理はしません。** 軸ベースの最近傍マッチングは各 `Site` が独立に
判定されるため、個数の厳密な制御には本質的に向いていません。

一方で「島には必ず山が1つある」のような要求は、軸の分布（カバレッジ）を事後チェックするだけでは保証できません
（カバレッジがあっても、実際にそこへ `Site` が配置され、かつマッチングでその型が選ばれるとは限らないため）。
そこで、`generation_scopes` に **`guarantees`**（明示的な強制割当）を持たせ、最近傍マッチングの**前**に
確定的に処理します。

```yaml
generation_scopes:
  island:
    guarantees:
      - {location_type: mountain_peak, count: 1, axis: elevation, pick: max}
```

`axis` が `pick`（`max`/`min`）側の値を持つ `Site` から `count` 個を選び、`location_type` を強制的に割り当てます
（`hard_limits` を満たす `Site` を優先し、足りなければ満たさない `Site` からも補います。保証は絶対のため）。
これにより、確率的な再生成（軸のヒストグラムを見て不足していれば作り直す、という当初の草案にあった方式）を
使わずに済み、**決定性**（同じシード → 同じ島）と**停止性**（無限に再生成しない）の両方を保っています。

### 3.5 座標配置とパスネットワーク生成

#### 3.5.1 座標配置（海岸に囲まれ、かつ海岸過多にならない配置）

島は単純な円盤（半径 `SitePlacer.IslandRadius`）とみなします。要求「海岸に囲まれた島を、海岸が多くなり
すぎないように生成する」を、次の2段階の**配置枠の分離**によって実現しています（円盤へ一様に散布すると、
面積比の関係で外周付近のサイトが多数を占めてしまい、単純な後処理だけでは制御しづらいため、配置そのものを
2種類に分けています）。

1. **外周リング**: 島を囲む海岸候補を、半径85%〜95%の円環上へ、等間隔+ジッタで配置します。個数は
   `generation_scopes.island` の想定サイト数の約35%（ただし4〜7個にクランプ）です。この個数の上限・下限が、
   「島を囲むのに十分な数」と「海岸が多くなりすぎない」の両方を同時に満たす調整弁になっています。
2. **内陸**: 残りのサイトを、半径75%以内へベストキャンディデート法（Mitchell's best-candidate algorithm）で
   散布します。既存のどのサイトからも最も離れた候補を毎回選ぶことで、サイト同士が均等に散らばります。
   `generation_scopes.island.interior_bias` が高いほど中心寄りに配置されます。

   概念設計段階の草案では「Poisson-disk sampling」を挙げていましたが、Poisson-disk は半径と面積から
   結果的な個数が決まるサンプラであり、「10〜20個ちょうど」という要求される個数を直接指定できません。
   個数を直接指定できるベストキャンディデート法に置き換えています。

外周リングに配置されたサイトは、`coastal_distance` 軸のサンプリング後に `generation_scopes.island.coast_band`
以下へクランプされます（`hull_coast: true` の場合）。これにより、海岸型 `LocationType`（`hard_limits` で
`coastal_distance` が海岸帯以下と定めている型）が必ずこの位置に配置され、「島が海岸で囲まれる」ことを
配置の構造そのもので保証しています。

#### 3.5.2 パスネットワーク

- 全 `Site` に対して **Delaunay 三角形分割**を実施します（`Domain.Generation.DelaunayTriangulator`、
  Bowyer-Watson 法）。数学的に辺が交差しないという性質を、交差なしパスネットワークの土台に使います。
- 間引きは以下の2段階です。
  1. **最小全域木（MST、Kruskal法）**は必ず残します（到達性の保証）。
  2. MST 以外の Delaunay 辺は、距離の短い順に走査し、「現在のグラフでのその2点間最短距離（Dijkstra）が、
     直結距離の `generation_scopes.island.extra_edge_detour_factor`（%）を超える」場合だけ復活させます
     （大回りを強いられている場合に、近道・分岐を作る）。復活させる辺も Delaunay 辺の部分集合であるため、
     グラフは常に交差なし（平面）のままです。
- 各エッジには `distance`（座標上のユークリッド距離）と `travel_minutes`（移動時間、分）を持たせます。

  ```
  travel_minutes = round_to_15( distance × base_minutes_per_distance × (moveCostA + moveCostB) / 200 )
  ```

  （15分単位に丸め、`minutes_per_tick` に対して粗すぎない粒度に揃えます。最低15分。）
  概念設計段階の草案にあった「距離」と「移動難易度」を別々に保持する案は採らず、最初からこの1本の式で
  `travel_minutes` に代表させています。

**「交差する代わりに新しい地区を生成する」処理は実装していません。** Delaunay 三角形分割を使う限り、
選ばれた辺同士が交差することは数学的に起こりません（交差しうるのは、Delaunay の枠外で任意のショートカットを
無理に追加しようとした場合だけです）。概念設計段階の草案にあったこの処理は、自分で作った例外を自分で
解決していただけであり、実際には解くべき問題が存在しないと判断し、実装から落としています。将来、Delaunay
に含まれない任意のショートカット辺を追加したいという要求が具体的に出てきた場合は、その時点で改めて設計します。

道オブジェクト自体（`path` object_def）の生成・探索による発見・移動アクションは [`ExplorationSystem.md`](./ExplorationSystem.md) を
参照してください。

### 3.6 命名処理

1. 全 `Site` の座標の重心を求めます。
2. 各 `Site` の、重心からの方角を8方位（東・北東・北・北西・西・南西・南・南東）に丸めます。
3. `"{方角}の{LocationType.display_name}"` で名前を作ります（例: 「東の草原」）。
4. 同じ名前が複数の `Site` に生じた場合、それらすべてに漢数字の接尾辞（「（第一）」「（第二）」…）を付けて
   区別します。

`name_pool`（固有名詞。印象的な地形に優先して使う想定）は未実装です（6 節）。

### 3.7 構造物（Structure）生成

**未実装です。** `generation_scopes` にスコープごとのパラメータプリセットを持たせる仕組み自体は実装済み
（現状 `island` のみ定義）で、同じ `TerrainGenerator`/`SitePlacer`/`AxisSampler`/`LocationTypeMatcher` を
`structure_interior` のようなスコープ名で呼び出せば、同一ロジックのまま再帰生成できる設計になっています。
探索の発見物として `cave_entrance`（`fixture` タグ）だけは先に用意していますが、これは洞窟の入口という
プレースホルダで、内部の子 `Location` グラフの生成は今後の課題です。

## 4. これまでに合意し、実装した設計原則

- 地形定義（`LocationType`）と実体（`Location`）は必ず呼び分けます。裸の名詞＝実体、`〜Type` サフィックス＝定義、
  という命名規則を全概念で徹底します。
- 「似た環境が隣り合う」は、隣接しやすさテーブル（affinity）ではなく、**軸の空間的連続性そのもの**
  （`layered_noise` が空間的に連続な値を返すこと自体）によって自然に実現しています（affinity 方式は不採用）。
- ハードコーディングを避けるため、Axis の生成ロジックは汎用プリミティブ（`distance_field`/`layered_noise`）の
  組み合わせに還元しています。新しい軸・新しい `LocationType` は YAML の追加だけで導入できます
  （`Domain.Generation` 側の生成ロジック自体はコードを変更せずに済みます）。
- 島全体の生成と構造物内部の生成は、**同一の生成ロジック**をスコープ別パラメータで使い分ける設計です
  （構造物内部スコープの追加自体は未実装、3.7 節）。
- 軸の値は 0〜100 の整数です（エンジン全体の「数値プロパティは32bit整数」という規約との整合、3.1 節）。

**稀な極端環境**（`weirdness` 軸）は未実装です。概念設計段階の草案は「高周波ノイズで稀な異常環境を作る」と
していましたが、高周波ノイズは本質的に「多数の小さな異常点」を作るものであり「稀」にはならないという矛盾が
あるため、実装方針を保留にしています（6 節）。

## 5. 生成パイプラインの前段・後段（範囲外の確認事項）

本書が扱うのは Axis 定義から `Location` の実体化・命名までの地形生成パイプラインそのものです。生成された
`Location` に対する探索アクション・道の発見・移動、キャラクタ・アイテム・設置物のスロット構成は
[`ExplorationSystem.md`](./ExplorationSystem.md) で扱います（当初「範囲外」としていましたが、実装が進んだため
専用ドキュメントを新設しました）。`Structure`（洞窟等）内部の生成は 3.7 節のとおり未実装で、範囲外のままです。

## 6. 未決事項・今後の検討課題

- **`weirdness` 軸の具体設計**: 稀な異常環境をどの程度の頻度・強度で発生させるか（4 節参照。「高周波ノイズ」
  という当初案は矛盾を含むため再検討が必要）。
- **`blob_scatter`・`modifiers` プリミティブ**: 局所的に濃い領域（汚染地帯等）を作る散布や、軸同士の合成演算
  は、必要になった時点で `Domain.Generation.AxisSampler`/`GeneratorLayerType` へ追加する。
- **構造物内部（`structure_interior`）の具体的なスキーマと再帰実行**: `generation_scopes` の仕組み自体は
  再帰に対応できる形で実装済みだが、実際にそのスコープを定義し `TerrainGenerator` を再帰呼び出しする配線は
  未着手（3.7 節）。
- **`name_pool`（固有名詞）**: 3.6 節参照。
- **Axis の計算コスト**: 軸の数・`Site` 数が増えた際のサンプリングコスト、キャッシュ戦略（現状は
  `Site` 数が高々20のため未検討）。
- **YAML 定義のマージ・上書き規則**: 同一 id が複数ファイルに存在する場合の挙動（`GameElementDefinition.md`
  3.3 節で「別途仕様書で定義する」とされている未着手事項。`location_types`/`axes`/`generation_scopes` の
  重複も、現状は常にエラーとする厳格モードのみ実装済み）。
- **`generation_scopes.island` 以外の生成パラメータのバランス調整**: `interior_bias`・
  `extra_edge_detour_factor`・`base_minutes_per_distance` 等の具体的な数値は、実際にプレイしての調整が必要。

## 7. 参考: 既存プロジェクト方針との整合性

[`GameElementDefinition.md`](./GameElementDefinition.md) に示されている以下の原則と、本設計は整合しています。

- すべての概念を YAML で定義し、複数ファイル分割・MOD 追加は別ディレクトリへのファイル追加のみで実現する
  （3.3 節）。地形生成の3つのルートキー（`axes`/`location_types`/`generation_scopes`）は、`object_defs`/
  `traits` と対等なトップレベルキーとして `WorldCodexYamlLoader.Generation.cs` が実際にロードします
  （`GameElementDefinition.md` 16 節参照）。
- `Location`/`LocationType` も、他のあらゆる要素と同じ `object_defs` として表現されます（`location_types` の
  各エントリは `object_def` フィールドで、実体化に使う `locations.yaml` の `object_defs` の id を指します）。
- 「範囲（値域）による状態の決定」という汎用パターン（`stages`、6 節）とは別の専用マッチング処理
  （3.2 節）として実装しましたが、これは多次元の最近傍探索という性質上の違いによるものです。

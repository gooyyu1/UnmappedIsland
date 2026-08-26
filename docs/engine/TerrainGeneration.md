# 地形生成システム設計

## 概要

本ドキュメントは、島の地形生成システムに関する設計と実装をまとめたものです。
[`GameElementDefinition.md`](./GameElementDefinition.md) が掲げる「ハードコードしない」「汎用エンジンに
任せる」「ファイル追加だけで拡張できる」という設計方針（2 節）に準拠し、以下を目的とします。

- シード値ありのランダム生成で無人島の地形を生成する
- 地形・構造物はすべて YAML でオブジェクト定義し、パック作成者がコードに触れずに拡張できる状態を保つ

本書が扱うのは、**島の座標・軸・LocationType・パスネットワークを生成するアルゴリズムそのもの**
（`Domain.Generation`、`WorldObject` に一切触れない生成時点だけの純粋な計算）です。生成された
`Location`（土地）が生成された**あと**にどう振る舞うか（スロット構成・探索・道の発見・移動）は
[`ExplorationSystem.md`](./ExplorationSystem.md) が扱います。

本書は設計判断（なぜこのアルゴリズムか）を扱い、実際のクラス名・メソッド名を使った実装の呼び出し関係は
[`TerrainGenerationImplementation.md`](./TerrainGenerationImplementation.md) に切り出しています。
コードを読む・変更する際はそちらを参照してください。

実装は `src/domain/generation/` 以下、定義データは
`src/assets/world-codex/terrain_generation.yaml`（生成パラメータ）・`locations.yaml`（土地・道の
`object_defs`）にあります。

## 1. 用語定義

| 用語 | 説明 |
|---|---|
| **Axis（軸）** | 標高・湿り気など、地点が持つ連続値パラメータの 1 次元。ジェネレータ（ノイズ/距離場など）によって値が決まる。値は 0〜100 の整数（後述） |
| **Site（地点）** | 座標と軸ベクトルのみを持つ、`LocationType` 未確定の中間状態のノード |
| **環境（Environment）** | 軸ベクトルが表す性質そのもの。データ構造として実体化はしない（クラスや YAML 定義を持たない）。`Site` 同士の軸ベクトルの近さという関係性としてのみ存在する概念 |
| **LocationType** | 「草原」「洞窟」など、配置の定義（YAML）。プレイヤーには見えない設計者側の語彙 |
| **Location（土地）** | 実際に生成・命名された実体。「草原」「花咲く草原」のようにゲーム内で識別可能な名前を持つ。パスネットワークのノードでもある |
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
   ↓ LocationTypeの識別子（同型が複数ならvariants）で命名
[Location群] (命名済み)
   ↓ IslandSpawner が object_defs を spawn し、world.locations へ配置
   ↓ 辺ごとに path を両端へ生成し、undiscovered_fixtures（隠しスロット）へ配置（ExplorationSystem.md）
[実体化済みの島]
```

座標に依存する軸のジェネレータ（距離場・座標ベースのノイズ）は座標なしでは評価できないため、
パイプラインの順序は「座標決定が最上流」に統一しています。

**構造物内部の生成はまだ動いていません**（3.7 節）。島の生成と構造物内部の生成は、同一の生成ロジックを
スコープ別パラメータ（`generation_scopes`）で共有する設計です。

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
    stretch_sites_to_range: true
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 90}
        - {type: layered_noise, octaves: 3, frequency: 2, seed_offset: 11, weight: 10}
```

**`stretch_sites_to_range`**: 1 回の生成で出たサンプルの最小・最大が `range` の両端へ来るよう、
量子化の前に引き伸ばします。**宣言した値域が実際に現れることを保証できるのはこれだけです**
——ジェネレータの値はサイトの座標で決まり、どこにサイトが置かれるかは事前に決まらないため、
式をどう組んでも「上端に届くサイトがある」とは言えません。値域が現実の単位へ読み替えられる軸
（標高のメートル、3.5 節）で要ります。

引き伸ばしは値の**幅**だけを保証し、**分布の形**は元の式のままです。`elevation` でノイズの重みが
距離場に対して低いのはそのためで、加算で乗せた起伏はそのまま海岸の高さのばらつきになります
（重み 30 では、海に接する土地が海抜 100 m を超えていました）。

**設計上の注意**: 軸の種類・数はハードコードしません。`Axis` 定義自体が YAML で完結し、`LocationType` 側は
「言及した軸だけ気にする」設計にすることで、軸の増減に対して `LocationType` 定義が壊れないようにします
（3.2 節参照）。実際の定義は `src/assets/world-codex/terrain_generation.yaml`（`elevation`・
`humidity`・`coastal_distance`・`ruggedness` の4軸）を参照してください。

### 3.2 LocationTypeマッチング（軸ベース）

各 `LocationType` は、軸空間上の「理想点＋許容範囲」として定義します。

```yaml
location_types:
  jungle:
    object_def: jungle                 # 実体化に使う型（locations.yamlのobject_defsのid）。土地も他の
                                       # あらゆる要素と同じobject_defsで表現される
    applicable_scopes: [island]
    move_cost: 1.6                     # 移動コストの倍率（1 = 等倍。3.5節のtravel_minutesに使う）
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

この式の設計判断:

- **`tolerance` は距離の**スケール**であり、閾値ではありません**。「`tolerance` を超えたら除外」という
  ゲートの意味は持たせていません（絶対的な除外は `hard_limits` だけが担います）。1つの軸で `tolerance` 分
  ずれると正規化距離に 1 単位分寄与する、というスケール変換だけを行います。
- **`Σw_i` による正規化**がないと、言及する軸が少ない型ほど和の項数が減って距離が構造的に小さくなり常に
  有利になる（軸を1つだけ言及する型が島全体を侵食する類の事故）ため、`Σw_i` で割って次元数バイアスを
  取り除いています。
- 同点（同じ距離）の場合は、`location_types` の宣言順で先に書かれた型が採用されます（決定的な挙動のため）。

`stages`（`GameElementDefinition.md` 6 節）は1次元の区間判定である一方、こちらは複数軸にまたがる多次元の
最近傍探索であるため、専用のマッチング処理（`Domain.Generation.LocationTypeMatcher`）として実装しています。

### 3.3 マッチできない場合の処理（フォールバック）

- **絶対的な除外は `hard_limits` だけ**が行います。`hard_limits` を満たさない `LocationType` はマッチング候補
  から外れます（`axis_preferences` の `tolerance` は除外条件ではないため、これ単独ではどの候補も除外しません）。
- **フォールバック `LocationType`**: `is_fallback: true`。`hard_limits` によって全ての候補が除外された `Site`
  はこれが受けます（自身の `hard_limits` も無視する、最後の受け皿）。複数の `is_fallback` 型がある場合、
  `priority` が最大のものが選ばれます。
- **フォールバックの機能化**: 特定の軸にのみ強くマッチする専用 `LocationType` を パック側で追加すれば、
  フォールバックに落ちていた領域へ自動的に誘導できます。「マッチしない領域」は不具合ではなく「新しい
  `LocationType` を定義すべき場所」というシグナルとして扱います。

### 3.4 出現数について（同じ型の抑制とguaranteesによる保証）

**同じ `LocationType` は `max_sites_per_type` 個までにします。** 同じ地形は環境も発見物も見た目も同じなので、
並べても島は広くなりません。上限で急に打ち切るのではなく、既に置いた同じ型の個数に応じてマッチング距離へ
割増（`crowding_penalty`、率）を掛け、上限へ届く前から他の型へ譲らせます。

- **割り当ての順番は最良距離の昇順**です。「その型らしさ」が濃い `Site` から決まるので、譲るのは環境の
  境目にいる `Site` になります（`Site` の並び順で決めると、譲る側が環境と無関係に決まってしまいます）。
- **上限は置けるかどうかの条件ではありません。** 上限を守るとどの型も選べない `Site` は、上限を無視して
  選び直します。絶対の条件は `hard_limits` だけ、という 3.3 節の原則を崩さないためです。
- `guarantees`（後述）で強制割当したぶんも個数に数えます。

これは重複を減らすだけでなく、**島に出る地形の種類を増やします**。上限が無いと軸空間の中央付近に理想点を持つ
型が大半の `Site` を取り、端に寄った型がほとんど出ません（実測値は
[`stats/terrain.yaml`](../../stats/terrain.yaml) の `location_type_counts`）。

**下限（最低出現数）のレンジ管理はしません。** 軸ベースの最近傍マッチングは各 `Site` が独立に
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
確率的な再生成を使わないため、**決定性**（同じシード → 同じ島）と**停止性**（無限に再生成しない）の両方を
保っています。

### 3.5 座標配置とパスネットワーク生成

#### 島の大きさと歩く速さ【確定】

- **島の直径は 6.7 km**（面積およそ 35 km²）。山がひとつある島として自然な大きさで、ロビンソン・
  クルーソー島（約 48 km²）よりやや小さい大きさです。
- **島の最高点は海抜 400 m。** 同じ縮尺で自然な高さです（青ヶ島は 8.7 km² で 423 m、ボラボラ島は
  30 km² で 727 m）。
- **道の無い熱帯の地面を歩く速さは 4 km/h**（`move_cost` が 1.0 の土地）。

この3つは `generation_scopes.island` の `diameter_meters`・`elevation_top_meters`・
`walk_meters_per_hour` として、**それぞれ現実の単位で別々に宣言**します。1つの値に縮尺と速さを
兼ねさせると、どちらも外の知識と突き合わせて検算できなくなるためです
（[`DesignPrinciples.md`](../concept/DesignPrinciples.md) の「現実に単位があるものは、その単位で持つ」
「1つの原因に、複数の結果を兼ねさせない」）。

#### 3.5.1 座標配置（海岸に囲まれ、かつ海岸過多にならない配置）

島は単純な円盤（半径 `SitePlacer.IslandRadius`）とみなします。**抽象座標系の直径（`IslandRadius` の
2 倍 ＝ 200 単位）が `diameter_meters` に当たり、抽象 1 単位が 33.5 m になります。** ノイズも距離場も
`IslandRadius` で正規化しているので、縮尺を変えても地形の見た目は変わりません。要求「海岸に囲まれた島を、海岸が多くなり
すぎないように生成する」を、次の2段階の**配置枠の分離**によって実現しています（円盤へ一様に散布すると、
面積比の関係で外周付近のサイトが多数を占めてしまい、単純な後処理だけでは制御しづらいため、配置そのものを
2種類に分けています）。

1. **外周リング**: 島を囲む海岸候補を、半径85%〜95%の円環上へ、等間隔+ジッタで配置します。個数は
   `generation_scopes.island` の想定サイト数の約35%（ただし4〜7個にクランプ）です。この個数の上限・下限が、
   「島を囲むのに十分な数」と「海岸が多くなりすぎない」の両方を同時に満たす調整弁になっています。
2. **内陸**: 残りのサイトを、半径75%以内へベストキャンディデート法（Mitchell's best-candidate algorithm）で
   散布します。既存のどのサイトからも最も離れた候補を毎回選ぶことで、サイト同士が均等に散らばります。
   `generation_scopes.island.interior_bias` が高いほど中心寄りに配置されます。Poisson-disk sampling では
   なくこの方式なのは、生成するサイト数を直接指定できるためです（Poisson-disk は半径と面積から結果的な
   個数が決まるサンプラで、個数を指定できません）。

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
     直結距離の `generation_scopes.island.extra_edge_detour_factor`（倍率）を超える」場合だけ復活させます
     （大回りを強いられている場合に、近道・分岐を作る）。復活させる辺も Delaunay 辺の部分集合であるため、
     グラフは常に交差なし（平面）のままです。この閾値は上げるほど道が減り、下限は MST だけが残る
     平均次数 ≒1.9 です。実測値は [`stats/terrain.yaml`](../../stats/terrain.yaml) の `site_degree`
     （`npm run stats:terrain` で再生成）にあり、閾値を動かしたら再生成します。
- 各エッジには `distance_meters`（2 地点間のユークリッド距離、m）と `travel_minutes`（移動時間、分）を
  持たせます。**距離が先にあり、速さで割ると時間が出ます。**

  ```
  歩く分   = distance_meters × (moveCostA + moveCostB) / 2 / walk_meters_per_hour × 60
  登り下り = |elevationA − elevationB| × metersPerElevationUnit / climb_meters_per_hour × 60
  travel_minutes = round_to_15( 歩く分 + 登り下り )
  ```

  （15分単位に丸め、`minutes_per_tick` に対して粗すぎない粒度に揃えます。最低15分。）

  - `move_cost` は**その土地を進む遅さの倍率**です（1.0 が開けた土地＝ `walk_meters_per_hour`
    そのままの速さ、密林 1.6、山頂 2.5）。
  - `metersPerElevationUnit` は `elevation_top_meters ÷ 標高軸の値域` で、島では 400 m ÷ 100 = 4 m です。
    どの軸を標高として読むかは `elevation_axis` が指します（エンジンは軸の名前を知りません）。
    **軸の両端が実際に出る**（3.1 節の `stretch_sites_to_range`）ので、島の最低点は必ず海抜 0 m、
    最高点は必ず 400 m になります。
  - 登り下りは**対称**です。道は両端に2つあるので向きは表せますが、行きと帰りで時間が変わると往復の
    勘定が全部2倍に複雑になります。`climb_meters_per_hour` は 600 m/h（ネイスミスの法則）で、
    海岸の土地から山頂まで最短経路で登ると、水平距離とは別に平均 38 分ぶんかかります。
  - 実測の分布は [`stats/terrain.yaml`](../../stats/terrain.yaml) の `edge`（道1本あたり平均 1,436 m・42.0 分）。

辺同士の交差を解決する処理はありません。採用する辺は常に Delaunay 辺の部分集合であるため、交差は数学的に
起こりません。Delaunay に含まれない任意のショートカット辺を追加したい要求が出てきた場合に、その時点で
改めて設計します。

道オブジェクト自体（`path` object_def）の生成・探索による発見・移動アクションは [`ExplorationSystem.md`](./ExplorationSystem.md) を
参照してください。

### 3.6 命名処理

1. `Site` を `LocationType` ごとにまとめます。
2. その型が島に 1 つだけなら、型の識別子だけが名前になります（表示は「草原」）。
3. 複数あるなら、その型の `variants`（亜種）をシャッフルして 1 つずつ配ります（表示は「木苺の草原」）。
4. `variants` が足りなければ、残りに通し番号を付けます（表示は「草原（第四）」）。名前として読めないので、
   亜種は想定される個数ぶん用意します。

**決まるのは識別子の組み合わせだけで、表示文字列は持ちません。** WorldCodex は識別子だけを持つという
規約（[Localization.md](./Localization.md)）に従い、`Site.name`（`LocationName`）は「型・亜種・通し番号」
を持ち、文字列の組み立ては `Localization.locationName` が行います。

**名前に島のどこに在るかを出しません。** 地形の把握はプレイヤー自身の仕事なので、位置が分かる修飾語を
付けると、行き先の名前を見ただけで島の形が割れてしまいます。亜種の名前も同じ制約に従います
（対応表の側で自動テストが見張ります）。

#### 亜種（variants）

亜種は**識別子と、実体化した土地へ書き込むプロパティの上書き**の組です。`IslandSpawner` が `spawn` した
土地へ `props` を書き込み、探索の抽選がその値を候補の `weight` として読みます
（`locations.yaml` の `weight: {prop: ...}`。`ExplorationSystem.md` 2 節）。表示名は対応表が持ちます
（[Localization.md](./Localization.md) の `location_texts`）。

```yaml
sandy_beach:
  object_def: sandy_beach
  variants:
    - {id: palm, props: {palm_find: 26}}   # 素の重みは13
    - {id: white_sand}                     # 素の亜種（名前だけが変わる）
```

- **名前と中身を合わせます。** 「木苺の森」で木苺が増えないなら、名前はただの飾りです。合っていれば、
  プレイヤーは名前から中身を覚えられます（地図を持たないゲームなので、名前が土地を指す唯一の手掛かりです）。
- **その亜種にしか無いものは作りません。** 同じ型は島に高々 `max_sites_per_type` 個で、型ごとの出現率も
  5 割前後です（3.4 節）。亜種に固有の発見物を紐づけると「島のどこにも無い」が普通に起きます。倍率も
  控えめ（素の重みの 0.5〜2 倍程度）にとどめます。
- 上書きするプロパティがその土地の `object_def` に無ければ**ロード時にエラー**にします（持たない
  プロパティへの書き込みは黙って消えるため）。
- 亜種は**同じ地形の中の個体差**なので、絵は型で共通です。見た目まで変えたくなったら、`location_types`
  を分けるか、亜種を絵の切り替えにも使うかの選択になります（後者は未実装）。

### 3.7 構造物（Structure）生成【いつか: 洞窟内部】

`generation_scopes` にスコープごとのパラメータプリセットを持たせる仕組み自体は実装済み
（現状 `island` のみ定義）で、`structure_interior` のようなスコープを追加すれば、同じ `TerrainGenerator`
一式が同一ロジックのまま再帰生成できる設計です。探索の発見物 `shallow_cave`（`fixture` かつ `location`）は
それ自体が入れる場所ですが、そこから奥へ続く道と、内部の子 `Location` グラフはまだ生成しません
（[`Someday.md`](../Someday.md)）。

## 4. これまでに合意し、実装した設計原則

- 地形定義（`LocationType`）と実体（`Location`）は必ず呼び分けます。裸の名詞＝実体、`〜Type` サフィックス＝定義、
  という命名規則を全概念で徹底します。
- 「似た環境が隣り合う」は、隣接しやすさテーブル（affinity、不採用）ではなく、**軸の空間的連続性そのもの**
  （`layered_noise` が空間的に連続な値を返すこと自体）によって自然に実現しています。
- Axis の生成ロジックは汎用プリミティブ（`distance_field`/`layered_noise`）の組み合わせに還元しています。
  新しい軸・新しい `LocationType` は YAML の追加だけで導入でき、`Domain.Generation` 側のコード変更は不要です。
- 島全体の生成と構造物内部の生成は、**同一の生成ロジック**をスコープ別パラメータで使い分ける設計です
  （構造物内部スコープの追加自体は 3.7 節のとおり「いつか」）。
- 軸の値は 0〜100 の整数です（エンジン全体の「数値プロパティは32bit整数」という規約との整合、3.1 節）。

**稀な極端環境**（`weirdness` 軸）は未実装です。「高周波ノイズで稀な異常環境を作る」という当初案は、
高周波ノイズが本質的に「多数の小さな異常点」を作るもので「稀」にはならないという矛盾を含むため、
実装方針を保留にしています（6 節）。

## 5. 生成パイプラインの前段・後段（範囲外の確認事項）

本書が扱うのは Axis 定義から `Location` の実体化・命名までの地形生成パイプラインそのものです。生成された
`Location` に対する探索アクション・道の発見・移動、キャラクタ・アイテム・設置物のスロット構成は
[`ExplorationSystem.md`](./ExplorationSystem.md) で扱います。`Structure`（洞窟等）内部の生成は 3.7 節の
とおり「いつか」で、範囲外です。

## 6. 未決事項・今後の検討課題

- **`weirdness` 軸の具体設計**: 稀な異常環境をどの程度の頻度・強度で発生させるか（4 節参照。「高周波ノイズ」
  という当初案は矛盾を含むため再検討が必要）。
- **`blob_scatter`・`modifiers` プリミティブ**: 局所的に濃い領域（汚染地帯等）を作る散布や、軸同士の合成演算
  は、必要になった時点で `Domain.Generation.AxisSampler`/`GeneratorLayerType` へ追加する。
- **Axis の計算コスト**: 軸の数・`Site` 数が増えた際のサンプリングコスト、キャッシュ戦略（現状は
  `Site` 数が高々20のため未検討）。
- **YAML 定義のマージ・上書き規則**: 同一 id が複数ファイルに存在する場合の挙動（`GameElementDefinition.md`
  3.3 節で「別途仕様書で定義する」とされている未着手事項。`location_types`/`axes`/`generation_scopes` の
  重複も、現状は常にエラーとする厳格モードのみ実装済み）。
- **`generation_scopes.island` 以外の生成パラメータのバランス調整**: `interior_bias`・
  `extra_edge_detour_factor` 等の具体的な数値は、実際にプレイしての調整が必要。
- **海岸の土地の高さの配分**: 海に接する土地は海抜 0〜68 m に収まりますが、砂浜と岸壁がどれだけ
  離れているべきか（岸壁は何 m から岸壁か）は決めていません。現在は `axis_preferences` の
  `elevation` で岩海岸を低く・岸壁を高く寄せているだけです。


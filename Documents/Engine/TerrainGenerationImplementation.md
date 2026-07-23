# 地形生成 実装ガイド

## 概要

本ドキュメントは、`Assets/Scripts/Domain/Generation/`（実行）・`Assets/Scripts/Domain/Defs/Generation/`（定義）・
`Assets/Scripts/Loader/WorldCodexYamlLoader.Generation.cs`（ロード）にまたがる地形生成の実装を、**実際の
クラス名・メソッド名を使ってトップダウンに**説明するものです。

- **「なぜこう設計したか」は本書では説明しません。** [`TerrainGeneration.md`](../World/TerrainGeneration.md)
  （島の生成アルゴリズムの設計判断）・[`ExplorationSystem.md`](../World/ExplorationSystem.md)（生成された
  土地の挙動の設計判断）を参照してください。本書はその実装が**コード上どこに・どういう形であるか**だけを扱います。
- ソースコードのXMLドキュメントコメント（`///`）は、各クラス・各メソッドが**そのクラス単体として**何を
  するかを説明しますが、「どのクラスがどのクラスを、どの順で呼ぶか」という全体の流れは、1つのファイルを
  読むだけでは把握できません。本書はその**呼び出し関係の地図**を提供することを目的とします。
- 個々のクラス・メソッドの正確な契約（引数・戻り値・例外）は、常にソースコードとXMLドキュメントコメントを
  正とします。本書は流れを把握するための道しるべであり、詳細な仕様書ではありません。実装が変わった場合、
  本書の更新が追いつかないことがありえます。矛盾を見つけたらソースコードを信じてください。

**読む順番の目安**: 「なぜ」を知りたければ `TerrainGeneration.md`/`ExplorationSystem.md` を先に。「コードの
どこを読めばいいか」を知りたければ本書の 1 節（全体の呼び出し関係）から。個々のクラスの詳細は 2 節以降、
ファイルを直接開く前のインデックスとして 8 節（ファイル一覧）を使ってください。

## 1. 全体の呼び出し関係

地形生成は大きく2つの入口を持ちます。**ロード**（YAML → `WorldCodex.Generation`、ゲーム起動時に1回）と、
**生成・実体化**（`WorldCodex.Generation` → 実際の `WorldObject` の島、ゲーム開始時に1回）です。

```
[ロード]
WorldCodexYamlLoader.Load(label, yamlText)              Assets/Scripts/Loader/WorldCodexYamlLoader.cs
  └─ LoadGenerationSections(label, root)                 …Generation.cs（axes/location_types/generation_scopesを読む）
       ├─ ParseAxis / ParseGeneratorLayer                 → generationAxes（フィールド）へ蓄積
       ├─ ParseLocationType                                → generationLocationTypes へ蓄積
       └─ ParseGenerationScope                             → generationScopes へ蓄積
WorldCodexYamlLoader.Build()
  └─ BuildGenerationDefs(objectDefsByGlobalId)            …object_def/axis/location_type の相互参照を検証
       └─ new GenerationDefs(axes, locationTypes, scopes)  Assets/Scripts/Domain/Defs/Generation/GenerationDefs.cs
            → WorldCodex.Generation プロパティへ格納        Assets/Scripts/Domain/Defs/WorldCodex.cs

[生成・実体化]
NewGame.Start(codex, seed, rng)                          Assets/Scripts/Domain/Generation/NewGame.cs  ← ゲーム開始の入口
  ├─ world・character の WorldObject を生成（WorldSession.Spawn）
  ├─ TerrainGenerator.Generate(codex.Generation, "island", seed) → IslandMap
  │    │                                                    Assets/Scripts/Domain/Generation/TerrainGenerator.cs
  │    ├─ 1. SitePlacer.Place(scope, rng)                  → List<Site>（座標のみ）
  │    ├─ 2. AxisSampler.Sample(defs.Axes, sites, seed, scope)  → Site.AxisValues を埋める
  │    ├─ 3. LocationTypeMatcher.AssignTypes(defs, scope, sites) → Site.Type を確定
  │    ├─ 4. DelaunayTriangulator.Triangulate(sites)       → List<(int A, int B)>
  │    ├─ 5. PathNetworkBuilder.Build(sites, delaunayEdges, scope) → List<IslandEdge>
  │    └─ 6. NameAssigner.AssignNames(sites)               → Site.Name を確定
  ├─ IslandSpawner.Populate(session, map)                  → 各SiteをWorldObjectとしてspawnし、道も生成
  └─ IslandSpawner.PlacePlayer(session, map, character)    → 開始地点へキャラクタを配置、Locationを返す
```

`TerrainGenerator.Generate` までは **`WorldObject` に一切触れない純粋な計算**です（`IslandMap`/`Site`/
`IslandEdge` はただのデータ）。`WorldObject` の生成・配置が始まるのは `IslandSpawner` からです。この境界を
意識すると、「レイアウトのバグ」（`Domain.Generation` 側）と「実体化のバグ」（`IslandSpawner` 以降）の
どちらを疑うべきかを素早く切り分けられます。

## 2. ロード: YAML → `GenerationDefs`

`WorldCodexYamlLoader` は `partial class` で、地形生成関連の処理は
`Assets/Scripts/Loader/WorldCodexYamlLoader.Generation.cs` に分離されています（`object_defs`/`traits` を
読む本体ファイル `WorldCodexYamlLoader.cs` とは別ファイル）。

- `LoadGenerationSections(label, root)`: `Load()` の中から呼ばれ、YAMLルートの `axes`/`location_types`/
  `generation_scopes` の3キーを読んで、インスタンスフィールド `generationAxes`/`generationLocationTypes`/
  `generationScopes` へ蓄積します（`object_defs`/`traits` の蓄積と同じパターン。複数ファイルへ分割しても
  `Load` を繰り返し呼べば1つに集約されます）。
- `ParseAxis`/`ParseGeneratorLayer`: `axes.'name'` 1件を `Defs.Generation.AxisDef`（`GeneratorLayer` の
  リストを持つ）へ変換します。
- `ParseLocationType`: `location_types.'name'` 1件を `Defs.Generation.LocationTypeDef` へ変換します。
  `object_def` フィールドはこの時点では `ObjectNames.Intern` するだけで、実在検証は行いません（後述の
  `BuildGenerationDefs` まで遅延）。
- `ParseGenerationScope`: `generation_scopes.'name'` 1件を `Defs.Generation.GenerationScopeDef`
  （`guarantees` を含む）へ変換します。
- `BuildGenerationDefs(objectDefsByGlobalId)`: `WorldCodexYamlLoader.Build()` の中から、全 `object_defs` の
  解決が終わった後に呼ばれます。`LocationTypeDef.ObjectDefGlobalId` が実在するか、`axis_preferences`/
  `hard_limits`/`guarantees` が参照する軸名・`LocationType` 名が実在するかをここでまとめて検証し、
  `GenerationDefs` を組み立てて返します。生成関連のYAMLが1つもロードされていなければ `null` を返します
  （`WorldCodex.Generation` が `null` になりうる、という契約はここに由来します）。

## 3. `TerrainGenerator.Generate`: 6ステップの内訳

`TerrainGenerator`（静的クラス、`Generate` 1メソッドのみ）は、以下の6クラスを順番に呼ぶだけのオーケストレータ
です。各クラスも静的クラスで、状態を持たず `Site`/`IslandEdge` のリストを受け取って書き換える・新しく作る、
という素朴な手続きです。

### 3.1 `SitePlacer.Place(GenerationScopeDef scope, Pcg32 rng)` → `List<Site>`

座標だけを決めます（軸値はまだ持ちません）。

- サイト総数を `rng.NextInt(scope.SiteCountMin, scope.SiteCountMax)` で抽選。
- 外周リング配置: `coastCount`（総数の約35%、4〜7個にクランプ）個のサイトを、半径
  `SitePlacer.CoastRingMinRadius`〜`CoastRingMaxRadius`（`IslandRadius` 比）の円環へ、角度を均等割りして
  ジッタを加えながら配置（`Site.OnCoastRing = true`）。
- 内陸配置: 残りのサイトを、半径 `SitePlacer.InteriorMaxRadius` 以内へベストキャンディデート法（候補
  `CandidatesPerSite` 個のうち、既存サイトからの最小距離が最大のものを採用するループ）で配置
  （`Site.OnCoastRing = false`）。`scope.InteriorBias` が半径分布の指数（`radiusExponent`）に反映されます。

### 3.2 `AxisSampler.Sample(axes, sites, seed, scope)`

各 `Site` の `AxisValues`（`Dictionary<string, int>`）を埋めます。

- 各 `AxisDef` の `Layers`（`GeneratorLayer` のリスト）を、private メソッド `SampleLayer(layer, site, seed)`
  で `[0, 1]` にサンプルし、`layer.Weight` で重み平均します。
  - `GeneratorLayerType.DistanceField` → `1 - (原点からの距離 / SitePlacer.IslandRadius)`
  - `GeneratorLayerType.LayeredNoise` → `ValueNoise.Sample(seed + layer.SeedOffset, site.X, site.Y,
    layer.Octaves, layer.Frequency)`
- 結果を `axis.Range`（`PropertyRange`）へ量子化して `Site.AxisValues[axis.Name]` に代入。
- `scope.HullCoast` が真なら、`Site.OnCoastRing` なサイトの `coastal_distance`
  （定数 `AxisSampler.CoastalDistanceAxisName`）を `scope.CoastBand` 以下へクランプします。

### 3.3 `LocationTypeMatcher.AssignTypes(defs, scope, sites)`

各 `Site.Type`（`LocationTypeDef`）を確定します。

1. `scope.Guarantees` を順に処理し、private メソッド `OrderForGuarantee` で軸値の最大/最小順に並べた候補
   から `guarantee.Count` 個へ強制的に型を割り当てます（`forced` という `HashSet<Site>` へ記録）。
2. 残る `Site` を1つずつ private メソッド `MatchNearest(types, site)` に渡します。`MatchNearest` は
   `PassesHardLimits` を満たす型の中から、`public` メソッド `NormalizedDistance(type, site)`
   （正規化した重み付き距離）が最小の型を選びます。該当が無ければ `IsFallback` かつ `Priority` 最大の型に
   フォールバックします（それも無ければ例外）。

### 3.4 `DelaunayTriangulator.Triangulate(sites)` → `List<(int A, int B)>`

Bowyer-Watson 法によるDelaunay三角形分割です。すべての `Site` を包む仮想の「スーパートライアングル」から
始め、`Site` を1点ずつ挿入するたびに外接円判定（private メソッド `InCircumcircle`）で無効化された三角形を
削除・再分割します。最後にスーパートライアングルの頂点を含む三角形を除いて、無向辺の集合を返します。

### 3.5 `PathNetworkBuilder.Build(sites, delaunayEdges, scope)` → `List<IslandEdge>`

- Kruskal法で最小全域木（MST）を求めます（`unionFind` 配列 + ローカル関数 `Find`）。
- MSTに含まれなかった辺（`rest`）を距離順に走査し、private メソッド `ShortestPathDistance`（Dijkstra）で
  求めた「現在のグラフでの2点間最短距離」が、直結距離 × `scope.ExtraEdgeDetourFactor / 100` を超えていれば
  その辺を復活させます。
- 採用した各辺について、private メソッド `TravelMinutes(sites, a, b, distance, scope)` で移動時間（分、
  15分刻み・下限 `PathNetworkBuilder.MinTravelMinutes`）を計算し、`IslandEdge` を作ります。

### 3.6 `NameAssigner.AssignNames(sites)`

`Site.Name` を確定します。全 `Site` の座標の重心を求め、private メソッド `DirectionOf(dx, dy)` で各 `Site`
を8方位に丸め、`"{方角}の{Site.Type.DisplayName}"` を仮の名前にします。同じ名前が複数生じた場合は、
private メソッド `ToKanjiOrdinal(ordinal)` による接尾辞（「（第一）」等）を付けます。

## 4. 実体化: `IslandSpawner`

`TerrainGenerator.Generate` の結果（`IslandMap`、まだ `WorldObject` を含まないデータ）を、実際の世界
（`world` を根とするツリー）へ実体化します。

- **`Populate(session, map)`**:
  1. `map.Sites` を1つずつ `session.Spawn(site.Type.ObjectDefGlobalId)` し、`world.locations` スロットへ
     `MoveToSlot`。生成したインスタンスの `InstanceId` を `map.SiteInstanceIds[site.Index]` へ書き込みます
     （これが `IslandMap` を書き換える唯一の箇所です）。
  2. `map.Sites` を1つずつ、その `Site` に接続する `map.Edges` を集め（LINQ の `Where`/`Select`）、
     `ObjectDef.GetPropertyDef(progressId).Range.Value.Max` から探索上限 `progressMax` を読み、道の本数に
     応じて `required_progress` を `[FirstPathProgress(=2), progressMax - 1]` へ等間隔割当てする式
     （`FirstPathProgress + (lastPathProgress - FirstPathProgress) * i / (touching.Count - 1)`）で計算します。
     `path` を `session.Spawn` し、`SetProperty` で `travel_minutes`/`required_progress`/`destination_id`
     （接続相手の `InstanceId`）を書き込み、`undiscovered_paths` スロットへ `MoveToSlot` します。
- **`PlacePlayer(session, map, character)`**: 開始地点を `sandy_beach` 優先、無ければ `Site.OnCoastRing`、
  それも無ければ `map.Sites[0]` の順で選び、`WorldObject.FindDescendantByInstanceId`（`WorldObject.Topology`
  側の汎用メソッド）で実体を解決し、`characters` スロットへ `MoveToSlot` した上で
  `Runtime.Views.Location` を返します。

## 5. データの流れ（型で見る3層）

| 層 | 主な型 | 特徴 |
|---|---|---|
| 定義（ロード後不変） | `Defs.Generation.GenerationDefs`（`AxisDef`/`LocationTypeDef`/`GenerationScopeDef`） | `WorldCodex.Generation` として1つだけ存在。YAMLの内容そのもの |
| 生成の中間・最終結果（純粋計算） | `Domain.Generation.Site`/`IslandEdge`/`IslandMap` | `WorldObject` を一切含まない。`TerrainGenerator.Generate` が返す。座標・軸値・確定した `LocationTypeDef`・命名・辺を持つだけの、ただのデータ |
| 実体化後（実行時状態） | `Runtime.WorldObject`（`Views.Location`/`Views.Path` でラップ） | `IslandSpawner` が `Site`/`IslandEdge` を読んで生成する、実際にゲームが動かす対象 |

`IslandMap`（中間層）を経由することで、`TerrainGenerator.Generate` は完全に決定的な純粋関数として単体テスト
でき（`Tests/Generation/TerrainGeneratorTests.cs`）、`IslandSpawner` 以降の実体化のテスト
（`Tests/Generation/IslandSpawnerTests.cs`）と関心事が分離されています。

## 6. 決定性の仕組み: 2つの乱数源

- **`Pcg32`**（`Domain.Generation.Pcg32`、`seed` から決定的に生成）: `SitePlacer.Place` の座標決定にのみ
  使われます。`AxisSampler` のノイズは `Pcg32` を経由せず、`seed` を直接 `ValueNoise.Sample` へ渡します
  （`ValueNoise` は状態を持たない純関数のハッシュベースノイズです）。`LocationTypeMatcher`・
  `DelaunayTriangulator`・`PathNetworkBuilder`・`NameAssigner` は乱数を一切使いません（`Site` の座標・
  軸値が決まった時点で結果は一意に決まります）。
- **`WorldSession.Rng`**（`System.Random`）: `session.Spawn` した `WorldObject` の初期値ロール（`value:
  {min,max}`）や、探索の発見物を選ぶ `pick`（`explore` アクション）の抽選に使われます。**島のレイアウト
  （座標・軸値・型・辺・名前）には一切影響しません。**

この2つの乱数源が分離されているため、「同じ `seed` なら `WorldSession.Rng` に何を渡しても島のレイアウトは
変わらない」という契約が成り立ちます（`Tests/Generation/IslandSpawnerTests.cs` の
`Start_SameSeed_ProducesSameIslandLayout` が、異なる `Random` を渡しても `IslandMap` が一致することを
検証しています）。

## 7. エンジン拡張との接点

地形生成の実装にあわせて `GameElementDefinition.md` へ追加した2つの汎用エンジン拡張（`duration`/`move`、
`ExplorationSystem.md` 4節）は、以下のコードに対応します。

- **`duration`**: `Defs.ActionDef` が `WeightSpec? duration` フィールドを持ちます。`ActionDef.TryExecute`
  の中で、`conditions` 判定 → `effect` の `WorldObject.ApplyActiveEffect` → `duration` を解決して
  `session.AdvanceWorldTime(minutes)`、の順で処理します（`session.World == null` なら時間進行だけスキップ）。
- **`move`**: `Defs.MoveEffect`（`ActiveEffect` の一種）です。`Apply` の中で
  `owner.FindRoot().FindDescendantByInstanceId(destinationId)` で移動先を解決し、
  `mover.MoveIntoFirstAcceptingSlot(destination, ...)` で配置します。`FindRoot`/
  `FindDescendantByInstanceId`/`MoveIntoFirstAcceptingSlot` はいずれも `Runtime.WorldObject.Topology`
  （partial class の1つ）に定義した汎用メソッドです。
- **道の発見・移動の入口**: `Runtime.Views.Location.Explore(actor, session)` が `explore` アクションの
  実行と `RevealDuePaths`（`undiscovered_paths` → `paths` の移動）を1回の呼び出しにまとめています。
  `Runtime.Views.Path.Travel(actor, session)` が `travel` アクションを実行します。

## 8. ファイル一覧（索引）

| ファイル | 役割 |
|---|---|
| `Assets/Scripts/Domain/Defs/Generation/AxisDef.cs` | `AxisDef`・`GeneratorLayer`・`GeneratorLayerType` |
| `Assets/Scripts/Domain/Defs/Generation/LocationTypeDef.cs` | `LocationTypeDef`・`AxisPreference`・`AxisLimit` |
| `Assets/Scripts/Domain/Defs/Generation/GenerationScopeDef.cs` | `GenerationScopeDef`・`GuaranteeDef`・`GuaranteePick` |
| `Assets/Scripts/Domain/Defs/Generation/GenerationDefs.cs` | `GenerationDefs`（上記3つの束、`WorldCodex.Generation` の中身） |
| `Assets/Scripts/Loader/WorldCodexYamlLoader.Generation.cs` | YAML → 上記Defsのパース（2節） |
| `Assets/Scripts/Domain/Generation/Pcg32.cs` | 生成専用の決定的RNG |
| `Assets/Scripts/Domain/Generation/ValueNoise.cs` | シード付き格子値ノイズ |
| `Assets/Scripts/Domain/Generation/IslandMap.cs` | `Site`・`IslandEdge`・`IslandMap`（生成結果のデータ） |
| `Assets/Scripts/Domain/Generation/SitePlacer.cs` | 3.1節: 座標配置 |
| `Assets/Scripts/Domain/Generation/AxisSampler.cs` | 3.2節: 軸値サンプリング |
| `Assets/Scripts/Domain/Generation/LocationTypeMatcher.cs` | 3.3節: LocationTypeマッチング |
| `Assets/Scripts/Domain/Generation/DelaunayTriangulator.cs` | 3.4節: Delaunay三角形分割 |
| `Assets/Scripts/Domain/Generation/PathNetworkBuilder.cs` | 3.5節: MST+辺復活+移動時間 |
| `Assets/Scripts/Domain/Generation/NameAssigner.cs` | 3.6節: 命名 |
| `Assets/Scripts/Domain/Generation/TerrainGenerator.cs` | 3節全体のオーケストレータ（`Generate`） |
| `Assets/Scripts/Domain/Generation/IslandSpawner.cs` | 4節: 実体化（`Populate`/`PlacePlayer`） |
| `Assets/Scripts/Domain/Generation/NewGame.cs` | ゲーム開始の入口（`NewGame.Start`）・`NewGameSession` |
| `Assets/Scripts/Domain/Defs/MoveEffect.cs` | 7節: `move` 効果動詞 |
| `Assets/Scripts/Domain/Defs/ActionDef.cs` | 7節: `duration` フィールド |
| `Assets/Scripts/Domain/Runtime/Views/Location.cs` | 7節: 探索の入口（`Explore`/`RevealDuePaths`） |
| `Assets/Scripts/Domain/Runtime/Views/Path.cs` | 7節: 道のビュー（`Travel`） |

対応するテストは以下のとおりです（`Tests/README.md` の「Generation テスト」節も参照）。

| テストファイル | 対象 |
|---|---|
| `Tests/Loader/GenerationYamlLoaderTests.cs` | 2節（`WorldCodexYamlLoader.Generation.cs`） |
| `Tests/StreamingAssets/TerrainGenerationYamlTests.cs` | 実ファイル `terrain_generation.yaml` と `locations.yaml` の対応 |
| `Tests/Generation/TerrainGeneratorTests.cs` | 3節（`TerrainGenerator.Generate` の不変条件） |
| `Tests/Generation/IslandSpawnerTests.cs` | 4節・6節（`IslandSpawner`/`NewGame`、決定性） |
| `Tests/Domain/ActionDurationTests.cs` | 7節（`duration`） |
| `Tests/Domain/MoveEffectTests.cs` | 7節（`move`） |

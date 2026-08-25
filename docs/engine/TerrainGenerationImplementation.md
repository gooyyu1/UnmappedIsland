# 地形生成 実装ガイド

## 概要

本ドキュメントは、`src/domain/generation/`（定義と実行）・
`src/loader/parseGeneration.ts`（ロード）にまたがる地形生成の実装を、**実際の
クラス名・関数名を使ってトップダウンに**説明するものです。

- **「なぜこう設計したか」は本書では説明しません。** [`TerrainGeneration.md`](./TerrainGeneration.md)・
  [`ExplorationSystem.md`](./ExplorationSystem.md) を参照してください。本書は、1つのファイルを読むだけでは
  把握できない**呼び出し関係の地図**を提供します。
- 個々のクラス・関数の正確な契約（引数・戻り値・例外）は、常にソースコードとTSDocコメントを
  正とします。本書と矛盾を見つけたらソースコードを信じてください。

**読む順番の目安**: 全体の呼び出し関係は 1 節、個々のクラスの詳細は 2 節以降、ファイルを直接開く前の
インデックスは 8 節（ファイル一覧）。

## 1. 全体の呼び出し関係

地形生成は大きく2つの入口を持ちます。**ロード**（YAML → `WorldCodex.generation`、ゲーム起動時に1回）と、
**生成・実体化**（`WorldCodex.generation` → 実際の `WorldObject` の島、ゲーム開始時に1回）です。

```
[ロード]
WorldCodexYamlLoader.load(label, yamlText)               src/loader/WorldCodexYamlLoader.ts
  └─ loadGenerationSections(loader, label, root)          src/loader/parseGeneration.ts（axes/location_types/generation_scopesを読む）
       ├─ parseAxis / parseGeneratorLayer                  → loader.generationAxes へ蓄積
       ├─ parseLocationType                                 → loader.generationLocationTypes へ蓄積
       └─ parseGenerationScope                              → loader.generationScopes へ蓄積
WorldCodexYamlLoader.build()
  └─ buildGenerationDefs(loader, objectDefsByGlobalId)     src/loader/parseGeneration.ts（object_def/axis/location_type の相互参照を検証）
       └─ new GenerationDefs(axes, locationTypes, scopes)  src/domain/generation/GenerationDefs.ts
            → WorldCodex.generation プロパティへ格納        src/domain/WorldCodex.ts

[生成・実体化]
start(codex, seed, rng)                                   src/domain/generation/NewGame.ts  ← ゲーム開始の入口
  ├─ world・character の WorldObject を生成（WorldSession.spawn）
  ├─ generate(codex.generation, "island", seed) → IslandMap
  │    │                                                    src/domain/generation/TerrainGenerator.ts
  │    ├─ 1. place(scope, rng)                              → Site[]（座標のみ）  SitePlacer.ts
  │    ├─ 2. sample(defs.axes, sites, seed, scope)           → Site.axisValues を埋める  AxisSampler.ts
  │    ├─ 3. assignTypes(defs, scope, sites)                 → Site.type を確定  LocationTypeMatcher.ts
  │    ├─ 4. triangulate(sites)                              → readonly [number, number][]  DelaunayTriangulator.ts
  │    ├─ 5. build(sites, delaunayEdges, scope)               → IslandEdge[]  PathNetworkBuilder.ts
  │    └─ 6. assignNames(sites)                              → Site.name を確定  NameAssigner.ts
  ├─ populate(session, map)                                 → 各SiteをWorldObjectとしてspawnし、道も生成  IslandSpawner.ts
  └─ placePlayer(session, map, character)                   → 開始地点へキャラクタを配置、Locationを返す  IslandSpawner.ts
```

`generate`（`TerrainGenerator.ts`）までは **`WorldObject` に一切触れない純粋な計算**です（`IslandMap`/`Site`/
`IslandEdge` はただのデータ）。`WorldObject` の生成・配置が始まるのは `IslandSpawner` からです。この境界を
意識すると、「レイアウトのバグ」（`src/domain/generation/` 側）と「実体化のバグ」（`IslandSpawner` 以降）の
どちらを疑うべきかを素早く切り分けられます。

## 2. ロード: YAML → `GenerationDefs`

地形生成関連の処理は、`object_defs`/`traits` を読む本体 `src/loader/WorldCodexYamlLoader.ts` とは別モジュール
`src/loader/parseGeneration.ts` に分離されています。`WorldCodexYamlLoader` が持つ `axes`/`location_types`/
`generation_scopes` の蓄積フィールド（`generationAxes`/`generationLocationTypes`/`generationScopes`）は、
`loader` 引数として `parseGeneration.ts` 側の関数へ渡されます。

- `loadGenerationSections(loader, label, root)`: `load()` の中から呼ばれ、YAMLルートの `axes`/`location_types`/
  `generation_scopes` の3キーを読んで、`loader.generationAxes`/`loader.generationLocationTypes`/
  `loader.generationScopes` へ蓄積します（`object_defs`/`traits` の蓄積と同じパターン。複数ファイルへ分割しても
  `load` を繰り返し呼べば1つに集約されます）。
- `parseAxis`/`parseGeneratorLayer`: `axes.'name'` 1件を `AxisDef`（`GeneratorLayer` の
  リストを持つ、`src/domain/generation/AxisDef.ts`）へ変換します。
- `parseLocationType`: `location_types.'name'` 1件を `LocationTypeDef`
  （`src/domain/generation/LocationTypeDef.ts`）へ変換します。
  `object_def` フィールドはこの時点では `objectNames.intern` するだけで、実在検証は行いません（後述の
  `buildGenerationDefs` まで遅延）。
- `parseGenerationScope`: `generation_scopes.'name'` 1件を `GenerationScopeDef`
  （`guarantees` を含む、`src/domain/generation/GenerationScopeDef.ts`）へ変換します。
- `buildGenerationDefs(loader, objectDefsByGlobalId)`: `WorldCodexYamlLoader.build()` の中から、全 `object_defs` の
  解決が終わった後に呼ばれます。`LocationTypeDef.objectDefGlobalId` が実在するか、`axis_preferences`/
  `hard_limits`/`guarantees` が参照する軸名・`LocationType` 名が実在するかをここでまとめて検証し、
  `GenerationDefs` を組み立てて返します。生成関連のYAMLが1つもロードされていなければ `undefined` を返します
  （`WorldCodex.generation` が `undefined` になりうる、という契約はここに由来します）。

## 3. `generate`（`TerrainGenerator.ts`）: 6ステップの内訳

`TerrainGenerator.ts`（`generate` 1関数のみをエクスポート）は、以下の6モジュールの関数を順番に呼ぶだけの
オーケストレータです。各モジュールも状態を持たない関数の集まりで、`Site`/`IslandEdge` の配列を受け取って
書き換える・新しく作る、という素朴な手続きです。

### 3.1 `place(scope: GenerationScopeDef, rng: Pcg32): Site[]`（`SitePlacer.ts`）

座標だけを決めます（軸値はまだ持ちません）。

- サイト総数を `rng.nextInt(scope.siteCountMin, scope.siteCountMax + 1)` で抽選（`nextInt` は半開区間、
  `site_count` の `max` は含む値）。
- 外周リング配置: `coastCount`（総数の約35%、4〜7個にクランプ）個のサイトを、半径
  `COAST_RING_MIN_RADIUS`〜`COAST_RING_MAX_RADIUS`（`ISLAND_RADIUS` 比）の円環へ、角度を均等割りして
  ジッタを加えながら配置（`Site.onCoastRing = true`）。
- 内陸配置: 残りのサイトを、半径 `INTERIOR_MAX_RADIUS` 以内へベストキャンディデート法（候補
  `CANDIDATES_PER_SITE` 個のうち、既存サイトからの最小距離が最大のものを採用するループ）で配置
  （`Site.onCoastRing = false`）。`scope.interiorBias` が半径分布の指数（`radiusExponent`）に反映されます。

### 3.2 `sample(axes, sites, seed, scope)`（`AxisSampler.ts`）

各 `Site` の `axisValues`（`Map<string, number>`）を埋めます。

- 各 `AxisDef` の `layers`（`GeneratorLayer` のリスト）を、モジュール内関数 `sampleLayer(layer, site, seed)`
  で `[0, 1]` にサンプルし、`layer.weight` で重み平均します。
  - `'distance_field'` → `1 - (原点からの距離 / ISLAND_RADIUS)`（`ISLAND_RADIUS` は `SitePlacer.ts` からimport）
  - `'layered_noise'` → `ValueNoise.sample(seed + layer.seedOffset, site.x, site.y,
    layer.octaves, layer.frequency)`
- 結果を `axis.range`（`PropertyRange`）へ量子化して `Site.axisValues` に `axis.name` キーで代入。
- `scope.hullCoast` が真なら、`Site.onCoastRing` なサイトの `coastal_distance`
  （定数 `COASTAL_DISTANCE_AXIS_NAME`）を `scope.coastBand` 以下へクランプします。

### 3.3 `assignTypes(defs, scope, sites)`（`LocationTypeMatcher.ts`）

各 `Site.type`（`LocationTypeDef`）を確定します。

1. `scope.guarantees` を順に処理し、モジュール内関数 `orderForGuarantee` で軸値の最大/最小順に並べた候補
   から `guarantee.count` 個へ強制的に型を割り当てます（`forced` という `Set<Site>` へ記録）。
2. 残る `Site` を1つずつモジュール内関数 `matchNearest(types, site)` に渡します。`matchNearest` は
   `passesHardLimits` を満たす型の中から、エクスポート関数 `normalizedDistance(type, site)`
   （正規化した重み付き距離）が最小の型を選びます。該当が無ければ `isFallback` かつ `priority` 最大の型に
   フォールバックします（それも無ければ例外）。

### 3.4 `triangulate(sites): readonly [number, number][]`（`DelaunayTriangulator.ts`）

Bowyer-Watson 法によるDelaunay三角形分割です。すべての `Site` を包む仮想の「スーパートライアングル」から
始め、`Site` を1点ずつ挿入するたびに外接円判定（モジュール内関数 `inCircumcircle`）で無効化された三角形を
削除・再分割します。最後にスーパートライアングルの頂点を含む三角形を除いて、無向辺の集合を返します。

### 3.5 `build(sites, delaunayEdges, scope): IslandEdge[]`（`PathNetworkBuilder.ts`）

- Kruskal法で最小全域木（MST）を求めます（`unionFind` 配列 + ローカル関数 `find`）。
- MSTに含まれなかった辺（`rest`）を距離順に走査し、モジュール内関数 `shortestPathDistance`（Dijkstra）で
  求めた「現在のグラフでの2点間最短距離」が、直結距離 × `scope.extraEdgeDetourFactor / 100` を超えていれば
  その辺を復活させます。
- 採用した各辺について、モジュール内関数 `travelMinutes(sites, a, b, distance, scope)` で移動時間（分、
  15分刻み・下限 `MIN_TRAVEL_MINUTES`）を計算し、`IslandEdge` を作ります。

### 3.6 `assignNames(sites, rng)`（`NameAssigner.ts`）

`Site.name`（`LocationName`）と `Site.variant` を確定します。`Site` を `LocationType` ごとにまとめ、
1 つだけの型は型の識別子だけを名前にし（亜種は付きません）、複数ある型はモジュール内関数
`shuffled(values, rng)` で並べ替えた `variants` を 1 つずつ配ります。亜種が尽きた分には通し番号
（`LocationName.ordinal`）を持たせます。**表示文字列はここでは作りません**——`LocationName` は識別子の
組み合わせで、文字列にするのは `Localization.locationName`（`Localization.md`）です。亜種の `props` を
実体へ書き込むのは `IslandSpawner`（4 節）です。

`rng` は配置とは別の列（`Pcg32.forPurpose(seed, 'names')`）です。配置の引く回数を変えても、命名の
結果は動きません。

## 4. 実体化: `IslandSpawner`

`generate`（`TerrainGenerator.ts`）の結果（`IslandMap`、まだ `WorldObject` を含まないデータ）を、実際の世界
（`world` を根とするツリー）へ実体化します。

- **`populate(session, map)`**:
  1. `map.sites` を1つずつ `session.spawn(site.type.objectDefGlobalId)` し、`site.variant` があれば
     その `props` を `setProperty` で書き込んでから、`world.locations` スロットへ `moveToSlotOrRejection`。生成した
     インスタンスの `instanceId` を `map.siteInstanceIds[site.index]` へ書き込みます
     （これが `IslandMap` を書き換える唯一の箇所です）。
  2. `map.sites` を1つずつ、その `Site` に接続する `map.edges` を集め（`filter`/`map`）、
     `ObjectDef.tryGetPropertyDef(progressId).range.max` から探索率100%の進捗 `progressMax` を読み、道の本数に
     応じて `required_progress` を `[FIRST_PATH_PROGRESS(=2), progressMax - 1]` へ等間隔割当てする式
     （`FIRST_PATH_PROGRESS + (lastPathProgress - FIRST_PATH_PROGRESS) * i / (touching.length - 1)`）で計算します。
     `path` を `session.spawn` し、`setProperty` で `travel_minutes`/`required_progress`/`destination_id`
     （接続相手の `instanceId`）を書き込み、`undiscovered_fixtures` スロットへ `moveToSlotOrRejection` します。
  3. 生成した道を「どのサイトからどのサイトへ向かう道か」で引けるように控えておき、`map.edges` を1本ずつ
     辿って両端の道へ互いの `instanceId` を `return_path_id` として書き込みます（発見が両側同時になる、
     [`ExplorationSystem.md`](./ExplorationSystem.md) 3.1 節）。
- **`placePlayer(session, map, character)`**: 開始地点を `sandy_beach` 優先、無ければ `Site.onCoastRing`、
  それも無ければ `map.sites[0]` の順で選び、`WorldObject.findSelfOrDescendantByInstanceId`（`WorldObject` 自身の
  汎用メソッド）で実体を解決し、`characters` スロットへ `moveToSlotOrRejection` した上で
  `Location`（`src/domain/wrappers/Location.ts`）を返します。

## 5. データの流れ（型で見る3層）

| 層 | 主な型 | 特徴 |
|---|---|---|
| 定義（ロード後不変） | `GenerationDefs`（`AxisDef`/`LocationTypeDef`/`GenerationScopeDef`、`src/domain/generation/`） | `WorldCodex.generation` として1つだけ存在。YAMLの内容そのもの |
| 生成の中間・最終結果（純粋計算） | `Site`/`IslandEdge`/`IslandMap`（`src/domain/generation/IslandMap.ts`） | `WorldObject` を一切含まない。`generate`（`TerrainGenerator.ts`）が返す。座標・軸値・確定した `LocationTypeDef`・命名・辺を持つだけの、ただのデータ |
| 実体化後（実行時状態） | `WorldObject`（`Location`/`Path` でラップ、`src/domain/wrappers/`） | `IslandSpawner` が `Site`/`IslandEdge` を読んで生成する、実際にゲームが動かす対象 |

`IslandMap`（中間層）を経由することで、`generate`（`TerrainGenerator.ts`）は完全に決定的な純粋関数として単体テスト
でき（`tests/generation/terrainGenerator.test.ts`）、`IslandSpawner` 以降の実体化のテスト
（`tests/generation/islandSpawner.test.ts`）と関心事が分離されています。

## 6. 決定性の仕組み: 用途ごとの乱数列

1つの `seed` から、用途ごとに独立した列を作ります（`Pcg32.forPurpose`、`RandomPurpose`）。

| 用途 | 引く場所 | 何を決めるか |
| --- | --- | --- |
| `sites` | `place`（`SitePlacer.ts`） | サイト総数と座標 |
| `names` | `assignNames`（`NameAssigner.ts`） | 亜種の配り方 |
| `play` | `WorldSession.rng`（`Rng.seededRng`） | 初期値ロール・`pick` の抽選・開始時刻 |

`AxisSampler` は列を引かず、`seed` を直接 `ValueNoise` のハッシュへ渡します（状態を持たない純関数）。
`LocationTypeMatcher`・`DelaunayTriangulator`・`PathNetworkBuilder` は乱数を一切使いません（`Site` の
座標・軸値が決まった時点で結果は一意に決まります）。

列を分けて守れるのは「**他の用途が何回引いたか**」の変化に対してだけです。**上流が出した値が変われば
下流は動きます**——`place` を変えれば、軸のノイズを別に引いていても軸値は変わり、型も名前も変わります。
`play` の列だけは下流を持たないので、「同じ `seed` なら `WorldSession.rng` に何を渡しても島のレイアウトは
変わらない」という契約が成り立ちます（`tests/generation/islandSpawner.test.ts` が検証しています）。

## 7. エンジン拡張との接点

地形生成の実装にあわせて `GameElementDefinition.md` へ追加した2つの汎用エンジン拡張（`duration`/`move`、
`ExplorationSystem.md` 4節）は、以下のコードに対応します。

- **`duration`**: `InteractionDef`（操作の中身）が `WeightSpec | undefined` 型の
  `duration` フィールドを持ち、実行時に自分で時間を進めます（順序は
  [`ActionSystem.md`](./ActionSystem.md) 2節）。
- **`move`**: `MoveEffect`（`ActiveEffect` の一種）です。`apply` の中で
  `owner.findRoot().findSelfOrDescendantByInstanceId(destinationId)` で移動先を解決し、
  `mover.moveIntoFirstAcceptingSlot(destination, ...)` で配置します。`findRoot`/
  `findSelfOrDescendantByInstanceId`/`moveIntoFirstAcceptingSlot` はいずれも `WorldObject`
  （`src/domain/WorldObject.ts`）に定義した汎用メソッドです。
- **道の発見・移動の入口**: `Location.explore(actor, session)`（`src/domain/wrappers/Location.ts`）が
  `explore` アクションの実行と `revealDueFixtures`（`undiscovered_fixtures` → `fixtures` の移動）を1回の呼び出しに
  まとめています。`Path.travel(actor, session)`（`src/domain/wrappers/Path.ts`）が `travel` アクション
  を実行します。

## 8. ファイル一覧（索引）

| ファイル | 役割 |
|---|---|
| `src/domain/generation/AxisDef.ts` | `AxisDef`・`GeneratorLayer`・`GeneratorLayerType`（層の種類の文字列リテラルユニオン） |
| `src/domain/generation/LocationTypeDef.ts` | `LocationTypeDef`・`AxisPreference`・`AxisLimit` |
| `src/domain/generation/GenerationScopeDef.ts` | `GenerationScopeDef`・`GuaranteeDef`・`GuaranteePick` |
| `src/domain/generation/GenerationDefs.ts` | `GenerationDefs`（上記3つの束、`WorldCodex.generation` の中身） |
| `src/loader/parseGeneration.ts` | YAML → 上記Defsのパース（2節） |
| `src/domain/generation/Pcg32.ts` | 用途ごとの列を作る決定的RNG |
| `src/domain/generation/ValueNoise.ts` | シード付き格子値ノイズ |
| `src/domain/generation/IslandMap.ts` | `Site`・`IslandEdge`・`IslandMap`（生成結果のデータ） |
| `src/domain/generation/SitePlacer.ts` | 3.1節: 座標配置 |
| `src/domain/generation/AxisSampler.ts` | 3.2節: 軸値サンプリング |
| `src/domain/generation/LocationTypeMatcher.ts` | 3.3節: LocationTypeマッチング |
| `src/domain/generation/DelaunayTriangulator.ts` | 3.4節: Delaunay三角形分割 |
| `src/domain/generation/PathNetworkBuilder.ts` | 3.5節: MST+辺復活+移動時間 |
| `src/domain/generation/NameAssigner.ts` | 3.6節: 命名 |
| `src/domain/generation/TerrainGenerator.ts` | 3節全体のオーケストレータ（`generate`） |
| `src/domain/generation/IslandSpawner.ts` | 4節: 実体化（`populate`/`placePlayer`） |
| `src/domain/generation/NewGame.ts` | ゲーム開始の入口（`start`）・`StartedGame` |
| `src/domain/MoveEffect.ts` | 7節: `move` 効果動詞 |
| `src/domain/InteractionDef.ts` | 7節: `duration` フィールド |
| `src/domain/wrappers/Location.ts` | 7節: 探索の入口（`explore`/`revealDueFixtures`） |
| `src/domain/wrappers/Path.ts` | 7節: 道のビュー（`travel`） |

対応するテストは以下のとおりです。

| テストファイル | 対象 |
|---|---|
| `tests/loader/generationYamlLoader.test.ts` | 2節（`parseGeneration.ts`） |
| `tests/world-codex/terrainGenerationYaml.test.ts` | 実ファイル `terrain_generation.yaml` と `locations.yaml` の対応 |
| `tests/generation/terrainGenerator.test.ts` | 3節（`generate` の不変条件） |
| `tests/generation/islandSpawner.test.ts` | 4節・6節（`IslandSpawner`/`NewGame`、決定性） |
| `tests/domain/actionDuration.test.ts` | 7節（`duration`） |
| `tests/domain/moveEffect.test.ts` | 7節（`move`） |

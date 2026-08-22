# domain-gen-views

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/domain/generation/AxisDef.ts | 13 | 10 | 3 | 0 | 0 | 0 |
| src/domain/generation/AxisSampler.ts | 3 | 2 | 0 | 0 | 1 | 0 |
| src/domain/generation/DelaunayTriangulator.ts | 9 | 4 | 4 | 1 | 0 | 0 |
| src/domain/generation/GenerationDefs.ts | 5 | 5 | 0 | 0 | 0 | 0 |
| src/domain/generation/GenerationScopeDef.ts | 20 | 20 | 0 | 0 | 0 | 0 |
| src/domain/generation/IslandMap.ts | 31 | 24 | 5 | 0 | 2 | 0 |
| src/domain/generation/IslandSpawner.ts | 5 | 1 | 1 | 3 | 0 | 0 |
| src/domain/generation/LocationTypeDef.ts | 28 | 26 | 1 | 1 | 0 | 0 |
| src/domain/generation/LocationTypeMatcher.ts | 8 | 5 | 0 | 1 | 2 | 0 |
| src/domain/generation/NameAssigner.ts | 2 | 1 | 0 | 1 | 0 | 0 |
| src/domain/generation/NewGame.ts | 15 | 9 | 0 | 2 | 4 | 0 |
| src/domain/generation/PathNetworkBuilder.ts | 8 | 5 | 0 | 2 | 1 | 0 |
| src/domain/generation/Pcg32.ts | 12 | 9 | 0 | 1 | 0 | 2 |
| src/domain/generation/SitePlacer.ts | 6 | 2 | 0 | 3 | 1 | 0 |
| src/domain/generation/TerrainGenerator.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/domain/generation/ValueNoise.ts | 4 | 3 | 0 | 1 | 0 | 0 |
| src/domain/views/Animal.ts | 15 | 13 | 1 | 1 | 0 | 0 |
| src/domain/views/Location.ts | 24 | 20 | 0 | 2 | 2 | 0 |
| src/domain/views/Path.ts | 10 | 8 | 1 | 1 | 0 | 0 |
| src/domain/views/PlayerCharacter.ts | 23 | 14 | 0 | 5 | 4 | 0 |
| src/domain/views/World.ts | 16 | 13 | 1 | 0 | 2 | 0 |
| **合計** | **258** | **195** | **17** | **25** | **19** | **2** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| GeneratorLayer | 軸の1層の生成方式とパラメータを宣言する | `octaves`, `frequency`, `seedOffset`（`layered_noise` にしか意味が無い） |
| AxisDef / GenerationScopeDef / GenerationDefs / LocationTypeDef 一族 | terrain_generation.yaml の宣言をそのまま保持する | なし（宣言の写しに徹している） |
| AxisSampler | 各サイトの軸値を層の重み平均から決める | `COASTAL_DISTANCE_AXIS_NAME`（どの軸が海岸帯かは宣言側の話） |
| DelaunayTriangulator | サイト集合の Delaunay 辺を返す | 辺キーの文字列符号化一式（`normalize`/`parseKey`/`countEdge`/`addNormalizedEdge`） |
| Site | 座標と軸値を持つ、生成途中のノード | `type`/`name`/`variant`（後続パスの確定結果を溜めている） |
| IslandMap | 地形生成の純粋な計算結果を保持する **と** 実体化された Location との対応を保持する（責務2つ） | `siteInstanceIds`, `nameOfInstance`（後半の1文） |
| IslandSpawner | IslandMap を世界（worldツリー）へ実体化する | `placePlayer`, `placePlayerAt`（プレイヤーの配置は島の実体化ではない） |
| LocationTypeMatcher | 各サイトへ LocationType を割り当てる | `normalizedDistance`, `passesHardLimits`（型が自分の宣言と site を突き合わせる話）, `formatAxes`（文字列整形） |
| NewGame | 新しいゲーム一式を組み立てる | `characterDefNames`, `resolveCharacterDefName`（コーデックスの問い合わせとセーブ互換） |
| NewGameSession | 開始直後のゲーム一式を保持する | `_startLocation`, `startAt`（開始地点の後からの差し替え） |
| PathNetworkBuilder | Delaunay 辺から MST+復活辺のパスネットワークを作る | `WeightedEdge`（所要時間の決まっていない辺を表すためだけの型）, `shortestPathDistance`（汎用の最短経路） |
| Pcg32 | 種から決定的な乱数列を作る | なし（ただしファイルの置き場所が generation 配下） |
| ValueNoise | 座標から [0,1) のノイズを返す | 座標を `ISLAND_RADIUS` で正規化する部分（島を知っている） |
| Animal | 動物に1手を与えるための材料（候補の数と対象）を書き込む | なし |
| Location | 土地インスタンスへの型付きの読み書き口を与える | `itemsSlotId`, `fixturesSlotId`（語彙の素通し） |
| Path | 道インスタンスへの型付きの読み書き口を与える | なし |
| PlayerCharacter | プレイヤーキャラクタへの型付きの読み書き口を与える **と** エンディング条件を判定する（責務2つ） | `hasReachedMainland`, `broughtArtifacts`, `mainland`（後半の1文） |
| World | world インスタンスの時刻・気象への読み書き口を与える | `rollTimeOfDay`（開始時刻の決定）, `runAnimalTurns`（全土地へのtick後処理の配布） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/domain/generation/Pcg32.ts | `Pcg32`, `RandomPurpose` | 配置 | 5 | `src/domain/Rng.ts` が `'play'` 用の乱数源としてこれを import しており、遊びの本体の乱数実装が生成配下に置かれている（`RandomPurpose` 自身が `'play'` を列挙している） | `src/domain/Pcg32.ts`（`Rng.ts` の隣）または `src/util/` | | |
| src/domain/generation/SitePlacer.ts | `ISLAND_RADIUS` | 配置 | 4 | 島の座標空間の基準長で、ValueNoise・AxisSampler・DelaunayTriangulator の3モジュールが import している。1つのパスの中に居るべき値ではない | `GenerationScopeDef` または生成共通の `islandSpace.ts` | 同ファイルの `COAST_RING_MIN/MAX_RADIUS`・`INTERIOR_MAX_RADIUS` が「ISLAND_RADIUS比」で書かれており、基準と比率を離すと比率側の意味が読めなくなるため | |
| src/domain/generation/AxisSampler.ts | `COASTAL_DISTANCE_AXIS_NAME` | 所属 | 4 | YAML で宣言される軸の名前がコードに固定されている。同じ海岸帯の話である `coastBand`・`hullCoast` は宣言側（GenerationScopeDef）に居る | `GenerationScopeDef`（`hullCoast` の隣）または `WorldVocabulary` | `hullCoast` を「どの軸をクランプするか」まで宣言にすると YAML の記述が増えるため、軸名だけコードへ固定している | |
| src/domain/generation/IslandMap.ts#IslandMap | `siteInstanceIds`, `nameOfInstance()` | 所属 | 4 | クラス自身が「WorldObject には一切触れない純粋な計算結果」と宣言しているのに、実体化された WorldObject.instanceId の対応表を保持している。`readonly` は付いているが中身の配列は外から書き換え可能で、実際 IslandSpawner が外から埋める | `SpawnedIsland`（生成結果と実体化結果の対応を持つ新概念）または Location 側の逆引き | 「実体化された島」という概念が無く、UI（PlayScreenView）が `map` 1つからサイト座標と土地インスタンスの両方を引けるようにするため | |
| src/domain/generation/LocationTypeMatcher.ts | `normalizedDistance()`, `passesHardLimits()` | 所属 | 4 | どちらも `type.preferences` / `type.hardLimits` を読んで「この型はこのサイトに合うか」を答える。型自身の宣言に対する判定 | `LocationTypeDef`（`appliesTo` の隣） | `LocationTypeDef`（定義＝読み取り専用の宣言）が `Site`（生成パイプラインの作業状態）の型を知らずに済ませるため | |
| src/domain/generation/NewGame.ts | `characterDefNames()` | 所属 | 4 | 実体は `codex.objectDefNamesWithTag('character')` の1行で、NewGame に固有の判断が無い。呼び出し元は NewGameScene・save・analysis と散っている | `WorldCodex` | `'character'` というタグ名を WorldCodex（語彙を持たない側）へ持ち込まずに済ませるため | |
| src/domain/generation/NewGame.ts | `resolveCharacterDefName()` | 所属 | 4 | 「未知の識別子＝旧セーブ」の互換処理で、新規ゲームの組み立てではない | `src/save/`（`newGameInput.ts` の隣） | `characterDefNames` の並び順（先頭が既定）に依存しており、同じ場所に置かないと既定の決め方が2箇所に散るため | |
| src/domain/generation/NewGame.ts#NewGameSession | `_startLocation`, `startAt()` | 所属 | 4 | 「開始直後のゲーム一式」を後から差し替えるための可変フィールドで、唯一の呼び出し元は `src/scenario/Scenario.ts` | `Scenario`（シナリオ適用の一手順として） | 開始地点の差し替えには `placePlayerAt` と `_startLocation` の同時更新が要り、Scenario へ出すと開始地点の可変性を公開することになるため | |
| src/domain/generation/PathNetworkBuilder.ts | `WeightedEdge` | 所属 | 4 | `IslandEdge` から `travelMinutes` を抜いただけの型で、プログラミング上の都合だけで存在している | `IslandMap.ts`（`IslandEdge` の所要時間を後から決める形にする） | `IslandEdge` が `travelMinutes` を必須で持つため、所要時間がまだ決まっていない段階の辺を表せないため | |
| src/domain/views/Location.ts#Location | `itemsSlotId`, `fixturesSlotId` | 所属 | 4 | `words.itemsSlotId` をそのまま返す素通し。Layers.md は定義への素通しを生やさない方針で、実際 `craftingView.ts` は `codex.vocabulary.world.itemsSlotId` を直に読んでおり、同じ値への経路が2本ある | 呼び出し側が `codex.vocabulary.world` から直に読む | ビューだけを受け取る UI（`cardPlaces.ts`）が codex を持たずにスロットを引けるようにするため | |
| src/domain/views/PlayerCharacter.ts#PlayerCharacter | `handSlotId` | 所属 | 4 | 上と同じ素通し。`craftingView.ts` は語彙から直に、`cardPlaces.ts` はビュー経由で同じ値を読んでいる | 呼び出し側が `codex.vocabulary.world` から直に読む | ビューだけを受け取る UI が codex を持たずにスロットを引けるようにするため | |
| src/domain/views/PlayerCharacter.ts#PlayerCharacter | `hasReachedMainland`, `broughtArtifacts`, `mainland` | 所属 | 4 | エンディング判定（GameEndings.md）。`broughtArtifacts` は本土の全子孫を数えており、プレイヤー本人とは無関係（キャラクタの状態ではなく決着の状態） | `Ending`（決着を判定するビュー） | 本土を親方向へ辿る起点がプレイヤー自身の位置で、`mainlandTagId`・`artifactTagId` の語彙をこのクラスが既に握っているため | `broughtArtifacts`（「持ち帰った」と言いながら本土に在る物すべてを数える） |
| src/domain/views/World.ts#World | `rollTimeOfDay()` | 所属 | 4 | ドキュメントに「NewGame.start専用」と書かれた、開始時刻の抽選。世界の恒常的な操作ではない | `NewGame` | `hourId`/`minuteId` の書き込み口と `minutesPerTick` を World の外へ公開せずに開始時刻を決めるため | |
| src/domain/views/World.ts#World | `runAnimalTurns()` | 所属 | 4 | 全土地へ tick 後処理を配る手続きで、world インスタンスの読み書きではない | `WorldSession.advanceWorldTime` | `locationsSlotId` とそのスロットの中身を外へ公開せずに全土地を回すため | |
| src/domain/generation/IslandSpawner.ts | `placePlayer()`, `placePlayerAt()` | 所属 | 3 | 島の実体化ではなくプレイヤーの配置。呼び出し元（NewGame.start / NewGameSession.startAt）が近いのでここに居る | `NewGame` | | |
| src/domain/generation/IslandSpawner.ts | `FIRST_PATH_PROGRESS` | 所属 | 3 | 生成の調整値だが、同種のもの（`coastBand`・`interiorBias` 等）は GenerationScopeDef が宣言で持っている | `GenerationScopeDef` | | |
| src/domain/generation/PathNetworkBuilder.ts | `MIN_TRAVEL_MINUTES` | 所属 | 3 | 同じ式で使う `baseMinutesPerDistance`・`extraEdgeDetourFactor` は宣言側にあるのに、これだけコードに固定されている | `GenerationScopeDef` | | |
| src/domain/generation/SitePlacer.ts | `COAST_RING_MIN_RADIUS`, `COAST_RING_MAX_RADIUS`, `INTERIOR_MAX_RADIUS` | 所属 | 3 | 上と同じ。海岸帯の話は `coastBand`/`hullCoast` として宣言側にあるのに、外周リングの半径だけコードに居る | `GenerationScopeDef` | | |
| src/domain/generation/NewGame.ts | `START_TIME_EARLIEST_MINUTES`, `START_TIME_LATEST_MINUTES` | 所属 | 3 | 遊びの調整値。利用者（`start`）が近いのでここに居る | `GenerationScopeDef` またはワールド定義 YAML | | |
| src/domain/generation/PathNetworkBuilder.ts | `shortestPathDistance()` | 配置 | 3 | 汎用のグラフ最短経路。島の語彙を一切持たない | `src/util/`（グラフの道具） | | |
| src/domain/generation/DelaunayTriangulator.ts | `cross()` | 配置 | 3 | 汎用の外積。三角形分割固有の知識が無い | `src/util/`（幾何の道具） | | |
| src/domain/generation/NameAssigner.ts | `shuffled()` | 配置 | 3 | 汎用のシャッフル。命名の知識が無い | `src/util/`（`Rng.ts` の隣） | | |
| src/domain/generation/ValueNoise.ts | `noiseAt()` | 所属 | 3 | 署名は汎用のノイズに見えるが、中で座標を `ISLAND_RADIUS` で割っている。汎用のノイズが島の大きさを知っている | 正規化を `AxisSampler` へ出し、`noiseAt` 自身は `src/util/` へ | | 有（署名から島への依存が読めない） |
| src/domain/generation/LocationTypeMatcher.ts | `formatAxes()` | 所属 | 3 | 軸値を人が読む文字列へ整形する処理がマッチングの中に居る | `Site`（自分を説明する口）またはエラー整形側 | | |
| src/domain/generation/LocationTypeDef.ts#LocationTypeDef | `applicableScopes` | 可視性 | 3 | 問いの形の `appliesTo()` があるのに生の配列も public で、クラス外からの参照は無い | 同クラス内で `private` にする | | |
| src/domain/generation/Pcg32.ts#Pcg32 | `nextUint()` | 可視性 | 3 | クラス外からの参照が無い。`nextDouble`/`nextInt` の内部実装 | 同クラス内で `private` にする | | |
| src/domain/views/Location.ts#Location | `revealDueFixtures()` | 可視性 | 3 | 本番の外部呼び出し元が無く、`explore()` からしか呼ばれない | 同クラス内で `private` にする | | |
| src/domain/views/Location.ts#Location | `runAnimalTurns()` | 所属 | 3 | 土地の中身を読む点で近いが、tick 後処理の配布そのもの（World.runAnimalTurns から降りてくる） | `WorldSession.advanceWorldTime` 側へ一本化 | | |
| src/domain/views/Path.ts#Path | `returnPathInstanceId` | 可視性 | 3 | 本番の外部呼び出し元が無い（テストのみ）。`Location.reveal` は道インスタンスから直にプロパティを読んでいる | 同クラス内で `private` にする、または `Location.reveal` をこちら経由にする | | |
| src/domain/views/PlayerCharacter.ts#PlayerCharacter | `equipmentSlotId`, `injuriesSlotId` | 可視性 | 3 | 語彙の素通しかつクラス外からの参照が無い（`handSlotId` と違い UI からも読まれない） | 同クラス内で `private` にする | | |
| src/domain/views/PlayerCharacter.ts#PlayerCharacter | `hp`, `satiety` | 可視性 | 3 | public だが本番の呼び出し元が無く、テストだけが読んでいる。UI は汎用のプロパティ経路で同じ値を読む | 同クラス内で `private` にするか、テスト側を汎用経路へ寄せる | | |
| src/domain/views/PlayerCharacter.ts#PlayerCharacter | `explore()` | 所属 | 3 | 実体は `location?.explore(this.instance)` の委譲。利用者が近いので置かれている | `Location.explore`（呼び出し側が直に呼ぶ） | | |
| src/domain/views/Animal.ts#Animal | `bumpableTargets()` | 所属 | 3 | 土地の中身を述語で絞る問いで、動物固有の知識は述語の側にある | `Location`（中身を条件で絞る口） | | |
| src/domain/generation/IslandMap.ts#Site | `axisValues`, `type`, `name`, `variant` | 所属 | 2 | パイプラインの各パスが結果を返さず Site へ書き戻すため、確定前後が同じ器に同居する（`type`/`name`/`variant` は非 readonly、`axisValues` は中身が可変） | Site のまま（プログラム上の都合として許容） | | |
| src/domain/generation/IslandMap.ts#LocationName | `key` | 所属 | 2 | 値型の同一性比較を文字列キーで代用するための口 | LocationName のまま | | |
| src/domain/generation/AxisDef.ts#GeneratorLayer | `octaves`, `frequency`, `seedOffset` | 所属 | 2 | `layered_noise` にしか意味が無く、`distance_field` では 0 のまま。層の種別を1クラスで表すための同居 | GeneratorLayer のまま（種別ごとの分割はしない方針に沿う） | | |
| src/domain/generation/DelaunayTriangulator.ts | `normalize()`, `addNormalizedEdge()`, `parseKey()`, `countEdge()` | 所属 | 2 | 辺を `Set<string>`/`Map<string,number>` のキーへ符号化し、また数値へ戻すための一式。タプルの値等価が無いことへの対処 | 同モジュールのまま（辺キー型として1箇所へ畳める） | | |
| src/domain/generation/IslandSpawner.ts | `endsKey()` | 所属 | 2 | 同上（辺の両端を文字列キーにする） | 上の辺キー型と共有 | | |
| src/domain/generation/LocationTypeDef.ts#LocationTypeDef | `objectDefGlobalId` | 所属 | 2 | 型と object_def を結ぶ数値ID。同一性のための識別子 | LocationTypeDef のまま | | |
| src/domain/views/Path.ts#Path | `destinationInstanceId` | 所属 | 2 | 行き先を数値IDで持つ（`destination` が解決する）。参照の永続化のための識別子 | Path のまま | | |
| src/domain/views/Animal.ts#Animal | `volumeId` | 所属 | 2 | `words`（world 語彙）とは別の engine 語彙から1つだけ引いた ID を個別に抱えている | Animal のまま（engine 語彙も丸ごと持つ形にできる） | | |
| src/domain/views/World.ts#World | `addMinutes()` | 所属 | 2 | `WorldSession.advanceWorldTime` 専用で負値も許すが、時計を進めるのは world 自身の操作 | World のまま | | |

## 移動先が書けなかったもの

なし。ただし2件は「既存のクラスへ移す」ではなく**欠けている概念を作る**必要がある。

- `IslandMap.siteInstanceIds` / `nameOfInstance` の移動先は既存クラスに無い。欠けているのは
  **「実体化された島」**——生成結果（Site の座標・名前）と世界のインスタンス（Location の instanceId）の
  対応を持つ概念。今はこれが無いため、純粋計算の結果である IslandMap が実体化後の状態も兼ねている。
- `PlayerCharacter.hasReachedMainland` / `broughtArtifacts` の移動先も既存クラスに無い。欠けているのは
  **「決着（エンディング）」**——死・脱出・持ち帰りをまとめて答える概念。今はこれが無いため、
  キャラクタのビューが決着の判定まで抱えている。

## ファイル配置（層=配置）についての所見

- **`src/domain/views/` が `src/domain/` の下に居るのは妥当**。Layers.md の「映し」は `src/game/view/` で、
  「今の断面を作り直し、何が出ていて操作が何を意味するかを答える」もの。`src/domain/views/` の5クラスは
  そうではなく、trait 合成モデルの `WorldObject` に**世界の語彙で名前を与えた型付きラッパ**で、
  `explore`・`travel`・`takeTurn` のように世界を書き換える。世界の側にあるべきものが世界の下に居る。
  ただし**名前が「映し」と衝突している**のは配置上の実害で、`src/domain/typed/` のように改名するか、
  少なくとも Layers.md 4節の表に「`src/domain/views/` は映しではない」と書き添える価値がある。
  なお現状の唯一の漏れは、UI へ渡す都合で語彙IDの素通し（`itemsSlotId` 等）が生えている点。
- **`src/domain/generation/` は概ね妥当**だが、2種類の異物がある。1つは**汎用の道具**
  （`Pcg32`・`shortestPathDistance`・`cross`・`shuffled`・座標正規化を除いた `noiseAt`）で、
  特に `Pcg32` は `src/domain/Rng.ts` が遊び用の乱数源として import しており、依存の向きが
  親ディレクトリ→子ディレクトリになっている。もう1つは**生成の調整値がコードと YAML に二分**して
  いる点（`ISLAND_RADIUS`・`MIN_TRAVEL_MINUTES`・`FIRST_PATH_PROGRESS`・`COAST_RING_*` 対
  `GenerationScopeDef` の各フィールド）で、同じ種類の数がどちらにあるかの線が引かれていない。
- `NewGame.ts` は生成の下に居るが、実体は**新規ゲームの組み立て入口**で、キャラクタ選択
  （`characterDefNames`）・セーブ互換（`resolveCharacterDefName`）・シナリオ用の開始地点差し替え
  （`startAt`）まで抱えている。地形生成のパイプライン（`TerrainGenerator` 以下）とは別の関心なので、
  `src/domain/NewGame.ts` へ上げるか、生成配下から `characterDefNames`/`resolveCharacterDefName` を
  出すのが自然。

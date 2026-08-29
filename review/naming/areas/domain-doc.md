# domain（説明あり）772件

A（名前をなぞるだけ）: 686件 / B: 64件 / C: 22件

判定は名前とシグネチャで行い、`doc` は「名前が言えていないことが書かれていないか」の確認に使った。
本体を読んだのは末尾に挙げた6件だけ（`chooseCandidates`・`SlotCell.tryInsert`・`emptyCell`・
`takeEmptyCell`・`ReferenceScope` の3つの getter）。

行はB・Cのみ。同じ改名で片付く兄弟・overrideは1行にまとめてあるので、行数（60）より
宣言数（86）のほうが多い。

## C（名前が別のものを指している）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/PropertyDef.ts` | `PropertyDef::checkRangeEvents` | C | 端に達していれば on_max/on_min を**適用する**（再帰的に連鎖する） | `check` は問い合わせにしか読めないのに、世界を変える。呼ぶと効果が走り、オブジェクトが消えることさえある | `applyRangeEventsAt` |
| `domain/ReferenceRoot.ts` | `ReferenceScope::broadcasting` / `::objectOnly` / `::picking` | C | フラグを1つ立てた**新しい ReferenceScope を返す** | 形容詞・名詞なので boolean の述語に見える（隣に `hasSelf`・`broadcasts` という本物の boolean が並ぶ）。実体は with系の派生 | `withBroadcast` / `withoutPropertyName` / `withPicked`（`ReferenceContext.withSelf` 等と語彙を揃える） |
| `domain/PassiveEffect.ts`（343・344・350・352・353）, `domain/PassiveEffects.ts`（361・362）, `domain/WorldObject.ts`（681・682） | `registerChild` / `registerRelation` / `registerResolvedRelation` / `registerAncestorTargetedRecursively` / `registerEdgeWith` | C | `register: boolean` の値で**登録も解除もする** | 名前は「登録する」としか言っていない。`register(owner, child, false)` が解除だと呼び側のコードを読むまで分からない | `setChildRegistered` / `setRelationRegistered` / `setAncestorTargetsRegistered` / `setEdgeRegistered` |
| `domain/ReferenceRoot.ts` | `PropertyPath::number` / `PropertyPath::value` | C | `number` は**実効値**を解決する／`value` は `PropertyValue` を返す | `number` はメソッド名が型名で、動作を1つも言っていない。しかも隣の `value` のほうが「値」に見えるのに返すのは器のほう。2つが逆に読める | `effectiveNumber` / `propertyValue` |
| `domain/WorldObject.ts` | `WorldObject::putInSlotFor` | C | itemを入れるならどの枠かを**答えるだけ**（入れない） | 動詞句なので「入れる」に読める。実際は問い合わせで、世界は動かない | `slotForPutIn`（`rejectionForMoveTo` と同じ問い合わせの形） |
| `domain/WorldSession.ts` | `WorldSession::spawn` | C | ObjectDefから WorldObject を**生成するだけ**（配置しない） | 同じ `spawn` が YAML と `WorldObject.executeSpawn` では「生んで配置する」を指す。同じ語が2つの意味を持つ | `createObject` |
| `domain/ActiveEffect.ts`（017）ほか 016・043・261 | `ActiveEffect::unresolvable` | C | 効果の**行き先が無いために、宣言している操作そのものが成立しない**か | 「解決できない」は参照が解けないことに読める。docがわざわざ「対象そのものが解決できない場合は違う」と断っているのが証拠 | `blocksOperation` |
| `domain/CellLayout.ts` | `CellLayout::trySwapCells` | C | 2つの枠の**中身だけ**を入れ替える（枠の宣言は添字に留まる） | 「セルを入れ替える」と言っているが、枠そのものは動かない。枠数固定スロットで `cells[2]` の受け入れ型が変わると誤解させる | `trySwapCellContents` |

## B（一言が名前から読み取れない）

### 失敗しうることが名前に無い（兄弟の `tryX` 規約から外れている）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/actionTime.ts` | `spendDuration` | B | 時間を進め、**その間に関与オブジェクトが失われていないか**を返す | 戻り値booleanの意味。時間は必ず進むのに、falseなら「行動が成立しなかった」ので効果を捨てる必要がある | `spendDurationAndReportParticipantsAlive` |
| `domain/crafting.ts` | `advanceCrafting` | B | 工程を1つ進める。素材不足・完了済み・自身消失なら何もせず false | 失敗しうること。同ファイル群には `tryGrowCell`・`tryPlaceAt`・`tryExecute` と `try` を付ける規約がある | `tryAdvanceCrafting` |
| `domain/InteractionDef.ts` | `InteractionDef::execute` | B | 要件を見て、時間を進め、効果を適用する（成立しなければ false） | 呼び出し元の `Interaction::tryExecute` と同じことをするのに動詞が違う。ここだけ成功前提に読める | `tryExecute` |
| `domain/WorldObject.ts`（675・649・672） | `moveToSlot` / `attachToSlot` / `insertSameSlot` | B | 移動し、**失敗したらその理由の文字列を返す** | `string \| undefined` が「理由」だと名前から読めない。同じクラスの `rejectionForMoveTo` は名前で言えている | `moveToSlotOrRejection` など、`Rejection` を名前に出す |

### 隠れた既定値・フォールバックが名前に無い

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/DeclaredNumber.ts` | `DeclaredNumber::resolve` | B | 参照を解く。**解けなければ0** | 0に倒れること。`undefined` を返さないので呼び手は0を実際の値と区別できない | `resolveOrZero` |
| `domain/generation/NewGame.ts` | `resolveCharacterDefName` | B | 未知の識別子なら**先頭のキャラクタで黙って代替する** | 代替が起きること。`resolve` は必ず正しい答えが返ると読める | `resolveCharacterDefNameOrFirst` |
| `domain/PropertyDef.ts` | `PropertyDef::initialValue` | B | 固定の初期値。**抽選つきの場合は range.min**（抽選しない側の値） | 抽選つきプロパティではこれを読むと min が返る。`rollInitialValue` と対にしないと誤って使う | `initialValueWithoutRoll` |
| `domain/CellLayout.ts` | `CellLayout::takeEmptyCell` | B | 型の合う空き枠を返す。**無ければ末尾に1つ生やす** | `take` に「作る」は含まれない（実装は `?? this.tryGrowCell()`） | `takeOrGrowEmptyCell` |
| `domain/CellLayout.ts` | `SlotCell::tryInsert` | B | **合流できる場合だけ**入れる（空き枠には入らない） | 実装は `canMerge(obj) && stack.tryInsert(obj)`。汎用の挿入に見えるが、空セルへは絶対に入らない | `tryMerge` |
| `domain/generation/LocationTypeDef.ts` | `LocationTypeDef::allows` | B | **hard_limits** をすべて満たすか | 見ているのが hard_limits だけで、axis_preferences は一切見ないこと | `satisfiesHardLimits` |
| `domain/generation/LocationTypeDef.ts` | `LocationTypeDef::priority` | B | **フォールバックが複数あるとき**の優先度 | 通常のマッチングでは使われないこと | `fallbackPriority` |
| `domain/generation/LocationTypeMatcher.ts` | `bestDistanceOf` | B | **混雑を無視した**最良距離 | crowdingPenalty を無視すること（本番のマッチング距離とは別物） | `bestDistanceIgnoringCrowding` |
| `domain/CellLayout.ts` | `CellLayout::vacancyFor` | B | **かさを見ずに**あと何個置けるか | volume を見ないこと。実際に入るかは capacity で更に減る | `vacancyForIgnoringVolume`。あわせて `SlotCell::roomFor` と動詞が割れているので語彙を揃える |
| `domain/WorldObject.ts` | `WorldObject::storageFillRatio` | B | **最も詰まっているスロット**の詰まり具合 | 合計や平均ではなく最大であること | `fullestSlotFillRatio` |

### 名前が動作・対象を言っていない（一語すぎる／名詞と動詞が噛み合わない）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/generation/IslandSpawner.ts`・`PathNetworkBuilder.ts`・`TerrainGenerator.ts`・`NewGame.ts` | `populate` / `build` / `generate` / `start` | B | 島を世界へ実体化する／パスネットワークを組む／地形を生成する／新しいゲームを始める | 全て `import { build } from './PathNetworkBuilder'` の形で名前付きimportされるので、呼び出し側には `build(...)` としか残らない。何をbuildするかがモジュール名にしか無い | `spawnIslandIntoWorld` / `buildPathNetwork` / `generateIsland` / `startNewGame` |
| `domain/crafting.ts` | `allocate` | B | 工程の**要求ごとに材料スロットの中身を割り当てる**（二重に数えない） | 何を何へ割り当てるか | `allocateContentsToRequirements` |
| `domain/PassiveAmount.ts` | `PassiveAmount::of` | B | declarerの今の状態で**寄与する量**を返す | `of` は何も言っていない。呼び出しは `amount.of(declarer)` で、返るのが量だと読めない | `amountFor` |
| `domain/ReferenceRoot.ts` | `ReferenceContext::of` | B | **selfだけが決まっている**文脈を作る | 何から作るのか。兄弟の static は `acting(self, agent, instrument)` と目的を名乗っている | `forSelf` |
| `domain/CellLayout.ts` | `CellLayout::emptyCell` | B | セルを空にし、**枠数が可変なら枠ごと取り除いて前詰めする** | 名詞（空のセル）に読める。かつ `splice` で並びが縮むことが読めない | `vacateCell` |
| `domain/CellLayout.ts` | `SlotCell::hold` | B | 中身のスタックを**入れ替える**（CellLayout専用） | 「保持する」ではなく破壊的な置換であること。専用の口であることも名前に無い | `replaceContents` |
| `domain/Interaction.ts` | `Interaction::minutes` | B | 実行にかかるゲーム内時間 | メソッドなのに名詞1語。同じことをする `InteractionDef::minutesFor` と揃っていない | `executionMinutes` |
| `domain/PropertyValue.ts` | `PropertyValue::incoming` | B | 現在登録されている**全寄与**（modify/add両方） | 何が incoming なのか。型 `RegisteredPassiveEffect[]` を見るまで分からない | `registeredContributions` |
| `domain/WorldSession.ts` | `WorldSession::gathered` | B | 操作の効果の適用中に**溜めている増加分**（`Scoped` なので有無が「適用中か」も兼ねる） | 何を gather したのか。フィールド1つで「溜め物」と「今が適用中か」の2つを兼ねること | `gainsBeingGathered` |
| `domain/autoFill.ts` | `chooseCandidates` | B | 枠の空きを埋められる型を1つ選び、**実際に入れる物を空きの数だけ**返す | 返るのは候補ではなく確定した投入物（`objects.slice(0, room)`）。同じ語を `TypeMatchRule::matches(candidateDef)` は判定対象の意味で使っている | `chooseFillersForCell` |
| `domain/autoFill.ts` | `stillWanted` | B | この枠に対応する**レシピの要求がまだ残っているか** | 主語が枠なのか中身なのか。「欲しい」のが誰かも読めない | `hasRemainingRequirement` |
| `domain/PropertyDef.ts` | `defaultClampTo` | B | on_max/on_min未指定時の既定動作の**効果を作って返す** | 動詞句なのに返り値は `ActiveEffect`（その場でclampはしない） | `defaultClampEffect` |
| `domain/GeneratedTypes.ts` | `GeneratedTypes::tryResolve` | B | 軸を動かした先の座標に**居る型のグローバルID**を引く | 何をresolveするか。同じことをする `WorldCodex::tryResolveBecome` は名前で言えている | `tryResolveTypeAtMovedCoordinate` |
| `domain/TypeMatchRule.ts` | `TypeMatchRule::candidates` | B | この指定に**当てはまる型を全部**挙げる | 「候補」ではなく確定した集合。同クラスの `matches(candidateDef)` は candidate を判定対象の意味で使っており、1クラス内で語が二重 | `matchingDefs` |

### 数・単位・向きが名前と噛み合っていない

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/ActiveEffect.ts`（012）ほか 015・025・389 | `ActiveEffect::repeatLimitingVessels` | B | 回数の上限を決める器が**いくつあるか**（`number \| undefined`） | 複数形の名詞なのに返るのは個数。`undefined` が「数えられない」であることも読めない | `repeatLimitingVesselCount` |
| `domain/generation/GenerationScopeDef.ts` | `GenerationScopeDef::coastBand` | B | coastal_distance が**この値以下**なら海岸帯とみなす閾値 | 帯そのものではなく閾値であること | `coastBandMaxDistance` |
| `domain/generation/GenerationScopeDef.ts` | `GenerationScopeDef::crowdingPenalty` | B | 同じ型が**1個増えるごとに**マッチング距離へ乗せる割増率 | 1個ごとの率であること（総額ではない） | `crowdingPenaltyPerDuplicate` |
| `domain/generation/GenerationScopeDef.ts` | `GenerationScopeDef::extraEdgeDetourFactor` | B | 辺を復活させるかを決める**迂回率の閾値** | 掛け算の係数（factor）ではなく比較の閾値であること | `extraEdgeDetourThreshold` |
| `domain/generation/GenerationScopeDef.ts` | `GenerationScopeDef::hullCoast` | B | 凸包上のサイトを海岸帯へ**クランプするか** | boolean なのに名詞句で、何を問うているか読めない | `clampsHullSitesToCoast` |
| `domain/SlotDef.ts` | `SlotDef::cellsToKeep` | B | 枠数が固定ならその数、可変なら `'grows'` | `'grows'` は「保つ枠数」ではないので、名前と値域が噛み合っていない | `cellCountPolicy` |
| `domain/Interaction.ts`（241）, `domain/WorldObject.ts`（646） | `Combination::acceptedCount` / `WorldObject::acceptedCountForMoveTo` | B | 続けて実行できる／入れられる個数（**自分を含む**） | 自分を含むこと。同名の `Slot::acceptedCount`・`ActiveEffect::acceptedCount` は渡した候補しか数えないので、同じ名前で数え方が違う | `countIncludingSelf` を語尾に出す（例 `acceptedCountIncludingSelf`） |

### 「自分自身を含むか」が名前で割れている

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/WorldObject.ts` | `WorldObject::contains` | B | otherが**自分自身か**、自分の中に入っているか | 自分自身を真とすること（`contains` は普通、中身だけを指す） | `containsOrIs` |
| `domain/WorldObject.ts`（666・667） | `findDescendantByInstanceId` / `findDescendantOfDef` | B | **自分自身を含む**子孫から探す | 同クラスの `descendants()` は自分自身を含まない。同じ語が同じクラスで逆の意味を持つ | `findSelfOrDescendantByInstanceId` / `findSelfOrDescendantOfDef` |

### 実効値／実体値の別が名前に無い

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/wrappers/ObjectWrapper.ts`（745）, `domain/wrappers/World.ts`（767） | `ObjectWrapper::numberOf` / `World::minutesPerTick` | B | `numberOf` は**実効値**、`minutesPerTick` は**実体値**を返す | 同じ包みの中で読む値の種類が違うのに、どちらの名前も何も言っていない。`ambientTemperature`・`ambientBrightness` は実効値なので、`minutesPerTick` だけ例外 | `effectiveNumberOf` / 実体値を返す側は `rawMinutesPerTick` |

### 型・フィールドの意味が名前より広い／狭い

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/ActiveEffect.ts` | `ActiveEffects` | B | 効果を**宣言順に並べて全部適用する**合成効果（Composite） | 親の `ActiveEffect` と1文字差で、集まりであることしか言っていない。順序が意味を持つことも読めない | `ActiveEffectSequence` |
| `domain/ActiveEffect.ts` | `ActiveEffects::operations` | B | 適用順＝この並び順、である子効果のリスト | 並びが適用順であること。`pick` も入るので「命令（operation）」より広い | `effectsInDeclarationOrder` |
| `domain/EffectSite.ts` | `EffectSite` | B | same_slot spawn 専用の、selfが居た位置のスナップショット**兼、連続配置の進行状態**（`anchorStack` を書き換える） | same_slot spawn だけが使うこと。不変のスナップショットに見えて、2個目以降の置き場所を覚える可変状態を持つこと | `SameSlotSpawnSite` |
| `domain/ConditionNode.ts` | `ConditionNode::slotGlobalId` | B | slot_position では**subjectの親の中の位置**、slot_content では**subject自身のスロット** | 1つのフィールドが向きの違う2つの意味を持つこと（docが「向きが異なる」と断っている） | kindごとに `containerSlotGlobalId` / `ownedSlotGlobalId` へ分ける |
| `domain/generation/NewGame.ts` | `NewGameSession` | B | `start` が組み立てた**開始直後のゲーム一式**（session・map・開始地点） | `WorldSession` の一種に見える（実際は session を持つ側）。`session` を内包するのに `Session` を名乗るので入れ子が読めない | `StartedGame` |
| `domain/generation/NewGame.ts` | `spawnSingletons` | B | singletonのうち、**worldが直に受け入れられるものだけ**を湧かす | 全 singleton は湧かないこと（キャラクタは対象外だと doc がわざわざ断っている） | `spawnSingletonsAcceptedByWorld` |
| `domain/generation/GenerationScopeDef.ts` | `GuaranteeDef` | B | 指定軸が最大/最小のサイトへ**LocationTypeを強制割当**するカバレッジ保証1件 | 何の保証か | `CoverageGuaranteeDef` |
| `domain/ObjectDef.ts` | `ObjectDef::recipes` | B | **この型を成果物とする**レシピ | 方向。「この型を材料に使うレシピ」とも読める（隣に `RecipeDef::requires` があるので余計に紛れる） | `recipesProducingThis` |
| `domain/ObjectStack.ts` | `ObjectStack::matches` | B | candidateが**このスタックへ合流できるか** | `SlotCell::canMerge` と同じことを別の動詞で言っている。`TypeMatchRule::matches` は型の一致判定なので、同じ語が2つの意味 | `canMerge` |
| `domain/LocalIndexMap.ts` | `LocalIndexMap` | B | **グローバルID → そのObjectDef内のローカルindex** の変換表 | 変換の向き | `LocalIndexByGlobalId` |
| `domain/ObjectDef.ts`（300・303） | `ObjectDef::propertyLayout` / `::slotLayout` | B | グローバルID → ローカルindex の変換表 | `layout`（配置）ではなく索引の変換であること | `propertyIndexByGlobalId` / `slotIndexByGlobalId` |
| `domain/PropertyDef.ts` | `StageReading` | B | 段の刻みと、**その中で今どこにいるか** | 「今どこにいるか」が入っていること（`stageAt` が返す段そのものとの違い） | `CurrentStageReading` |
| `domain/WorldCodex.ts` | `WorldCodex::recipeCategoryTagIds` | B | レシピ棚のタグ。**並びが優先順位**で、完成品は最初に一致した棚にだけ載る | 並びが挙動を決めること。並べ替えると別の棚に載る | `recipeCategoryTagIdsByPriority` |
| `domain/wrappers/Location.ts` | `Location::paths` | B | この土地から出ている、**発見済みの**道 | 未発見の道が含まれないこと。同クラスに `undiscoveredFixtures` があるので対になっていない | `discoveredPaths` |

## 判定を保留したもの

| 現在地 | 名前 | 迷った理由 |
| ------ | ---- | ---------- |
| `domain/ActiveEffect.ts`・`ConditionNode.ts`・`InteractionDef.ts`・`PassiveEffect.ts` | `read(reader)` | 自分が読むのではなく**読み手に自分を読み上げさせる**ので向きが逆に見える（`describeTo` 等が素直）。ただし引数の型が `EffectReader` なので方向は補える。4箇所で揃った既存の語彙でもあるため、単独で崩すべきか判断できなかった |
| `domain/PropertyDef.ts` | `PropertyDef::inherit` | 「継承」と言いつつ実際は**祖先の実効値を加算**する（置換ではない）。改名すると YAML のキー `inherit` との対応が切れるので、直すべきは名前ではなく YAML の語彙かもしれない |
| `domain/PropertyDef.ts` | `PropertyStage::eq` | doc が「シンボル型かを訊きたい側はこれではなく `isSymbolic` を見よ」と誤用を戒めており、名前が言えていない証拠。ただし改名しても誤用（`eq !== undefined` をシンボル型判定に使う）は消えないので、名前で解ける問題か確信が持てなかった |
| `domain/generation/LocationTypeDef.ts` | `LocationTypeDef::applicableScopes` | **空なら全スコープ**という規約が名前に無い（空＝どこにも適用されない、と逆に読める）。ただし名前で言い切る良い案が出せなかった |
| `domain/ObjectDef.ts` | `ObjectDef::visibleSlotGlobalIds` | 並びがそのまま子ウィンドウのタブの表示順になる。同種の「並びが意味を持つ」宣言は他にも多く、どこまでを名前に出すべきかの線を引けなかった（`recipeCategoryTagIds` は挙動が変わるので B にした） |

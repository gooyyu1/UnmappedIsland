# domain-state / domain-gen-views — 判定3の再点検

対象は private メソッド・private getter・export されていないモジュール関数（フィールドと private
コンストラクタは除く）。**主語の判定基準**: 自クラスのフィールド（ビュークラスの `this.instance` を含む）を
動かす／読むだけなら「自分」。引数で受け取った**名前を持つ他の型**の内部事情を読んで答えを組み立てて
いるなら「他（B）」。引数が数値・配列などの素の値しかない純計算（`smoothStep`・`clampIndex`・
`seedFor` 等）は、足す先が存在しないので「自分」に数えた。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/domain/EffectSite.ts | 3 | 2 | 1 |
| src/domain/ObjectStack.ts | 1 | 0 | 1 |
| src/domain/PropertyInfluence.ts | 3 | 2 | 1 |
| src/domain/PropertyValue.ts | 0 | 0 | 0 |
| src/domain/Slot.ts | 11 | 6 | 5 |
| src/domain/WorldObject.ts | 17 | 13 | 4 |
| src/domain/WorldSession.ts | 1 | 0 | 1 |
| src/domain/autoFill.ts | 1 | 0 | 1 |
| src/domain/crafting.ts | 2 | 0 | 2 |
| （domain-state の他12ファイル） | 0 | 0 | 0 |
| **domain-state 小計** | **39** | **23** | **16** |
| src/domain/generation/AxisSampler.ts | 1 | 0 | 1 |
| src/domain/generation/DelaunayTriangulator.ts | 6 | 0 | 6 |
| src/domain/generation/IslandSpawner.ts | 1 | 0 | 1 |
| src/domain/generation/LocationTypeMatcher.ts | 7 | 3 | 4 |
| src/domain/generation/NameAssigner.ts | 1 | 0 | 1 |
| src/domain/generation/NewGame.ts | 1 | 0 | 1 |
| src/domain/generation/PathNetworkBuilder.ts | 2 | 1 | 1 |
| src/domain/generation/Pcg32.ts | 1 | 1 | 0 |
| src/domain/generation/ValueNoise.ts | 3 | 3 | 0 |
| src/domain/views/Animal.ts | 5 | 3 | 2 |
| src/domain/views/Location.ts | 4 | 0 | 4 |
| src/domain/views/PlayerCharacter.ts | 2 | 0 | 2 |
| （domain-gen-views の他9ファイル） | 0 | 0 | 0 |
| **domain-gen-views 小計** | **34** | **11** | **23** |
| **合計** | **73** | **34** | **39** |

## 主語が他にあるヘルパー

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| Slot.ts#Slot | `sumVolume()` | `WorldObject` | 「自分のかさ（volume）はいくつか。宣言が無ければ0」に答える口が無い | **消える**（`contents.reduce((s,o)=>s+o.volume,0)` の1行になり、引数の `volumePropertyGlobalId` も要らなくなる） | 無し。`Slot` は `rejectionFor`/`acceptedCount` で既に `this.owner.session.codex.vocabulary.engine` から自力で `volumeId` を取っており、外から渡させているのは `fillRatio` の1経路だけ |
| Slot.ts#Slot | `vacancyFor()`, `findCellFor()`, `findMergeableCell()`, `tryMergeIntoMatchingStack()` | `ObjectStack` + `CellDef` | 「この枠にあと何個入るか」（`cellAt(i).max` と `_cells[i].members.length` の差）に答える主体が居ない | **消えない。** `max` は `CellDef`（枠側）が、在庫は `ObjectStack`（中身側）が持ち、両者は `_cells[i]` と `def.cellAt(i)` という**添字の暗黙の一致**でしか結ばれていない。どちらへ足しても片方が足りない | 「枠1つ」を表すオブジェクトが無い。`ObjectStack.tryInsert` が `matches` しか見ず `max` を守れないのはこのため——不変条件の片割れを `Slot` が肩代わりしている |
| ObjectStack.ts#ObjectStack | `computeInsertionIndex()` | `StackOrderDef` / `ObjectDef` | 「並び順の宣言が無ければ末尾」という既定が宣言の側に無い | **消える**（`obj.def.insertionIndexOf(obj, members)` の1行） | 無し |
| EffectSite.ts#EffectSite | `originKindRemains` | `ObjectStack` | `isEmpty` に当たる問いが無く、`members.length > 0` を外から書いている | **消えない。** 「同種がまだ残っているか」という**意味の名前**は EffectSite の判断として残る | 無し（1行が `!this.originStack.isEmpty` になるだけ） |
| PropertyInfluence.ts#PropertyInfluences | `add()` | `InfluenceCounterpart` / `PropertyInfluence` | 相手の同一性キーが無く、A が `p{id}`/`o{id}` を組み立てている。「相手も記号も同じ2件を1件へ畳む」規則の置き場も無い | **消えない。** キーを B へ足しても、畳み込み（`active` の OR 合成）は残る | 畳み込みを持つ**集合型**（`InfluenceEntries` 相当）が無く、`given`/`received` が素の `Map` のまま2本ある |
| WorldObject.ts#WorldObject | `missing()` | `NameRegistry` | 「このIDを人に見せる文字列（名前、無ければ `id=N`）」に答える口が無い | **消えない**（`'{def.name}' は{kind} {names.describe(id)} を持ちません` は残る） | 無し。なお引数 `names` は `this.session.codex` から自分で辿れるのに呼び出し側が渡している |
| WorldObject.ts#WorldObject | `engine` | `WorldSession` / `WorldCodex` | `session.codex.vocabulary.engine` という3段の連鎖を短くする口が無い | **消えない**（別名を付けているだけ） | 無し |
| WorldObject.ts#WorldObject | `captureEffectSite()` | `EffectSite` | 自分を組み立てる static factory（`EffectSite.capture(owner)`）が無く、4値の組み立てを A がやっている | **消える** | `_parent`・`_parentSlot` が private。ただし両者とも public getter（`parent`/`parentSlot`）が既に在り、実際には破れている |
| WorldObject.ts#WorldObject | `evict()` | 子の `WorldObject` | 「持ち主から離れるとき、単独で在れない自分は消える」を子自身が答えられない | **消えない。** ただし同じ分岐が `spillContentsTo()` にも別の形で書かれており、**1箇所へ畳める** | 無し（同一クラス内の重複） |
| WorldSession.ts#WorldSession | `runTick()` | `World` | 「1 tick 分の自分を進める」（`instance.tick()` + `runAnimalTurns`）が World に無い | **ほぼ消える**（残るのは `tickObserver?.()` の1行） | 循環（`runAnimalTurns(session)` がセッションを渡し返す）。第1波が `advanceWorldTime` に付けた阻害要因と同じもの。なお `runTick(world)` は `this.world` と同じ物を引数で受け直している |
| crafting.ts | `allocate()` | `RecipeStepDef` | 「自分の要求へ、この持ち物を宣言順に割り当てる（1つを二重に数えない）」が工程に無い | **消える** | Def が `WorldObject` を知ることになる。ただし判定に使うのは `requirement.requires(object.def)` だけなので、`ObjectDef[]` を受けて添字を返す形にすれば阻害要因は消える |
| crafting.ts | `spillUnneeded()` | `inProgress: WorldObject` | 5引数のうち先頭2つ（`inProgress`, `materialsSlotGlobalId`）が全関数で同じ。親・親スロット・進捗・材料スロットのすべてが `inProgress` の話 | **消えない。** 移す先の型が存在しない | **製作中オブジェクトのビュー（`InProgressObject`）が無い。** `Location`/`Path`/`PlayerCharacter` と同じ形の器が `domain/views/` に在れば、`crafting.ts` の5関数と `autoFill` から同じ2引数が消える |
| autoFill.ts | `chooseCandidates()` | `CellDef` | 「この枠に入るのはどれか」までは `cell.accepts` で足りるが、A は同じ関数内で `slot.def.cellsToKeep` / `slot.def.cellAt(i)` / `slot.cells[i]?.members.length` から**枠ごとの残り数**を再計算している | **消えない**（型ごとの束ね方は autoFill の選び方） | 上の `Slot.vacancyFor` と同じ「枠1つ」の不在。`Slot` の private ヘルパーと同じ計算を、外から `Slot` の内部構造を覗いて書いている |
| AxisSampler.ts | `sampleLayer()` | `GeneratorLayer` | `layer.type` による分岐と、`octaves`/`frequency`/`seedOffset` の使い方が層自身に無い | **消える**（`layer.sampleAt(site.x, site.y, seed)`） | `AxisDef.ts` は宣言だけのファイルで、移すと `ValueNoise`・`SitePlacer.ISLAND_RADIUS` への依存が入る。`GeneratorLayer` のコメントが「値の計算はサンプラーが担う」と明示しており、意図的な分離 |
| LocationTypeMatcher.ts | `normalizedDistance()`, `passesHardLimits()` | `LocationTypeDef` | 「私はこのサイトにどれだけ合うか／私の hard_limits を通るか」が型自身に無い | **消える** | 第1波は「Def が `Site` を知らずに済ませるため」としたが、**両関数が読むのは `site.axisValues` だけ**。引数を `ReadonlyMap<string, number>` にすれば `Site` への依存は生まれず、阻害要因は消える（`appliesTo` の隣に並ぶ） |
| LocationTypeMatcher.ts | `formatAxes()` | `Site` | 自分の軸値を人が読める形で言う口が無い | **消える** | 無し |
| LocationTypeMatcher.ts | `orderForGuarantee()` | `GuaranteeDef` | 「私の軸で max/min 順に並べる」が保証の宣言側に無い | **消えない**（hard_limits で前後に分ける部分は型の話） | 2つの Def（`GuaranteeDef` と `LocationTypeDef`）にまたがるため、片方には寄らない |
| PathNetworkBuilder.ts | `travelMinutes()` | `GenerationScopeDef` | 「距離と移動コストから所要時間」を宣言側が答えない。`MIN_TRAVEL_MINUTES` と 15分丸めだけコードに固定されている | **ほぼ消える**（残るのは `(sites[a].type!.moveCost + sites[b].type!.moveCost)/2`） | 無し。同じ式で使う `baseMinutesPerDistance` は既に scope 側に在る |
| NameAssigner.ts | `shuffled()` | `Rng` / `Pcg32` | シャッフルが乱数源に無い | **消える** | 無し。**同種の `pickWeighted` は既に `src/domain/Rng.ts` に居る**——同じ形の道具の片方だけが取り残されている |
| NewGame.ts | `spawnSingletons()` | `WorldSession` | 「singleton を world へ1つずつ湧かせる」がセッションに無い（中身は `session.codex.singletonGlobalIds()` と `session.spawn` だけ） | **消える**（`session.spawnSingletonsInto(worldInstance)`） | 無し |
| IslandSpawner.ts | `endsKey()` | `IslandEdge` / サイト添字の組 | 「辺の両端をキーにする」型が無い | **消えない**（型が存在しない） | 下の DelaunayTriangulator と共通（後述） |
| DelaunayTriangulator.ts | `normalize()`, `addNormalizedEdge()`, `parseKey()`, `countEdge()` | 無向辺（サイト添字の組） | **型そのものが無い。** `Set<string>`/`Map<string,number>` のキーとして文字列へ符号化し、また戻している | **消えない** | タプルの値等価が無いことへの対処。`[number, number]` は型エイリアスなのでメソッドを持てない |
| DelaunayTriangulator.ts | `cross()`, `inCircumcircle()` | `Point` / `Triangle` | 幾何の演算を持てる主体が無い | **消えない** | `type Point = readonly [number, number]` は素のタプル別名で、振る舞いの置き場が無い |
| Animal.ts#Animal | `bumpableTargets()` | `WorldObject` + `Location` | ①`WorldObject` に `volume` が無い（`tryGetProperty(volumeId)?.getEffectiveValue() ?? 0` を書いている。`private volumeId` フィールドはそのためだけに在る）②`Location` に「中身を述語で絞る」口が無い | **消えない。** 「かさが重み・最小1」は Animal の規則 | 無し。①だけでも足せば `private volumeId` が消える |
| Animal.ts#Animal | `escapeTargets()` | `Location` / `Path` | **無い。** `location.paths` も `path.destinationInstanceId` も既に在り、残りは「どれも重み1」という Animal の規則だけ | — | 構文上の `this` 不参照は、重みが定数1であることの帰結にすぎない（**タネの片方は空振り**） |
| Location.ts#Location | `slotContents()`, `stacksOf()` | `WorldObject` | 「その枠が無ければ空として読む」口が無い | **消える** | 無し。`PlayerCharacter.stacksOf` は**1文字違わぬ同じ実装** |
| Location.ts#Location | `reveal()`, `revealInOwnLocation()` | **別の** `Location` と `Path` | ①`revealInOwnLocation` は `fixture.parent`（＝別の土地）の隠しスロットを操作しており、`this.instance` を一度も触らない ②戻り道IDを `fixture.tryGetProperty(returnPathIdId)` から直に読んでいるが、**`Path.returnPathInstanceId` が同じ値を返す** ③`fixture.findRoot().findDescendantByInstanceId(id)` は `Path.destination` の解決手順の写し | **②③は消える。** ①は「別の Location のインスタンスを作って頼む」形に直せば消える | 無し。第1波が「`Path.returnPathInstanceId` に本番の呼び出し元が無い」と報告した**症状の原因がこれ** |
| PlayerCharacter.ts#PlayerCharacter | `mainland` | `WorldObject` | 「タグを持つ最初の祖先」を探す口が無い（`findAncestorWithProperty` は在る） | **消える**（`findAncestorWithTag(mainlandTagId)`） | 無し。`findAncestorWithProperty` のコメントは自らを「唯一の祖先探索ロジック」と称しているが、ここに2本目が在る |
| PlayerCharacter.ts#PlayerCharacter | `stacksOf()` | `WorldObject` | 上の `Location.stacksOf` と同一 | **消える** | 無し |

## 同じ B に対して複数の A が補っているもの

1. **`WorldObject` に「自分のかさ（volume）」が無い** — 補っているのは `Slot.sumVolume` /
   `Slot.rejectionFor` / `Slot.acceptedCount`（同じ式が Slot 内に3回）と `Animal.bumpableTargets`。
   **書き方が食い違っている**: Slot は `?.number`（実体値）、Animal は `?.getEffectiveValue()`（実効値）。
   同じ「かさ」が2種類の読み方をされており、B に1つ足せば読み方も1つに決まる。
   `Animal.volumeId` という private フィールドと `Slot.fillRatio` の引数も同時に消える。

2. **`WorldObject` に「枠の中身を、枠が無ければ空として読む」口が無い** — `Location.slotContents`、
   `Location.stacksOf`、`PlayerCharacter.stacksOf`（後2者は完全に同一実装）、`crafting.ts` の3箇所の
   インライン（`inProgress.tryGetSlot(id)?.contents ?? []`）、`game/view/craftingView.ts` の同型関数。
   **担当範囲だけで6箇所**。関連して `tryGetProperty(x)?.getEffectiveValue() ?? 0` が src 全体で17箇所ある。

3. **`ObjectDef` に `hasTag` が無い** — `def.tags.includes(id)` が担当範囲で5箇所
   （`Location.paths`、`PlayerCharacter.broughtArtifacts`/`mainland`、`Animal.lootTargets`/`smashTargets`）、
   src 全体で13箇所。**`PropertyDef` には `hasTag` が在り**（`WorldObject.propertiesWithTag` が使っている）、
   同じ語彙の2つの Def で片方だけ口が閉じている。

4. **「枠1つ」（`CellDef` と `ObjectStack` の組）を表すオブジェクトが無い** — `Slot` の private ヘルパー
   5本（`vacancyFor`・`findCellFor`・`findMergeableCell`・`tryMergeIntoMatchingStack` と、それらが支える
   `addInternal`）が `_cells[i]` と `def.cellAt(i)` の**添字の暗黙の一致**を毎回結び直しており、
   同じ計算（`(cell.max ?? 1) - 中身の数`）を `autoFill.autoFillMaterials` が**Slot の外から `slot.cells`
   越しに**書いている。`ObjectStack.tryInsert` が `max` を守れず `Slot` に守ってもらっているのも同じ原因。
   担当範囲で最も多くのヘルパーを生んでいる欠落。

5. **辺（サイト添字の順不同の組）を表す型が無い** — `DelaunayTriangulator` の
   `normalize`/`addNormalizedEdge`/`parseKey`/`countEdge` と `IslandSpawner.endsKey` が、別々の書式
   （`"a,b"` と `"a->b"`）で同じことをしている。第1波は両者を別々に判定2としており、同じ欠落だと
   結び付いていなかった。

6. **`Rng` に `shuffle` が無い** — `NameAssigner.shuffled` が補っている。**同じ形の `pickWeighted` は
   既に `src/domain/Rng.ts` に export されて居る**ので、片方だけが取り残された状態。

7. **製作中オブジェクトのビューが無い** — `crafting.ts` の5関数と `autoFill.autoFillMaterials` が
   `(inProgress: WorldObject, materialsSlotGlobalId: number, ...)` という同じ2引数を先頭で受け渡している。
   `domain/views/` に `Location`/`Path`/`PlayerCharacter` という同型の器が既に在るのに、製作だけ
   モジュール関数の引数として持ち回っている。

## 補足（ヘルパーではないが同じ問いで出たもの）

- `WorldObject.becomeType` の `property.init(property.def.range?.clamp(carried) ?? carried)` は、
  **`PropertyValue` の range を呼び出し側がクランプしている**。`init` 自身がやれば呼び出し側は
  「置く前に丸める」手順を覚えなくてよい（CLAUDE.md「自分のことは自分でする」の直球の例）。
  `init` の呼び出し元3者のうち、丸めているのはここだけ。
- `Slot.fillRatio(volumePropertyGlobalId)` の引数は、`Slot` 自身が他の2メソッドで自力で取っている値。
  この引数のためだけに `WorldObject.storageFillRatio` が `private get engine` を経由している。

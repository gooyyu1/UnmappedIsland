# domain-state

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/domain/AlertLevel.ts | 2 | 1 | 1 | 0 | 0 | 0 |
| src/domain/EffectSite.ts | 15 | 9 | 2 | 4 | 0 | 0 |
| src/domain/Interaction.ts | 17 | 15 | 0 | 0 | 2 | 0 |
| src/domain/LocalIndexMap.ts | 6 | 3 | 3 | 0 | 0 | 0 |
| src/domain/ObjectRef.ts | 12 | 10 | 1 | 0 | 1 | 0 |
| src/domain/ObjectStack.ts | 9 | 8 | 0 | 1 | 0 | 0 |
| src/domain/PropertyGain.ts | 7 | 6 | 1 | 0 | 0 | 0 |
| src/domain/PropertyInfluence.ts | 31 | 26 | 0 | 4 | 1 | 0 |
| src/domain/PropertyValue.ts | 30 | 21 | 5 | 1 | 1 | 2 |
| src/domain/ReferenceRoot.ts | 6 | 5 | 0 | 1 | 0 | 0 |
| src/domain/Rng.ts | 6 | 3 | 1 | 1 | 1 | 0 |
| src/domain/Slot.ts | 37 | 17 | 4 | 11 | 1 | 4 |
| src/domain/SlotPosition.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| src/domain/WorldChange.ts | 5 | 5 | 0 | 0 | 0 | 0 |
| src/domain/WorldObject.ts | 67 | 38 | 8 | 18 | 3 | 0 |
| src/domain/WorldSession.ts | 26 | 7 | 2 | 1 | 16 | 0 |
| src/domain/WorldSignal.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/domain/actionTime.ts | 1 | 0 | 0 | 0 | 1 | 0 |
| src/domain/autoFill.ts | 2 | 1 | 0 | 1 | 0 | 0 |
| src/domain/crafting.ts | 8 | 4 | 0 | 2 | 2 | 0 |
| src/domain/slotEntry.ts | 1 | 1 | 0 | 0 | 0 | 0 |
| **合計** | **292** | **184** | **28** | **45** | **29** | **6** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| WorldObject | 型（ObjectDef）の実体として、プロパティ値とスロットの中身を保持し、**かつ**所属ツリーの付け替え（移動・こぼし・破棄・型変更）を行い、**かつ**能動効果の適用とspawnの配置を担い、**かつ**weight/loadの中身寄与と影響一覧を導出する——**責務は4つ**。 | 責務A（実体の保持）: `instanceId` `_def` `properties` `slots` `tryGetProperty` `getProperty` `getSlot` `tryGetSlot` `gaugeProperties` `propertiesWithTag` `children` `descendants` `missing`。責務B（所属ツリー）: `_parent` `_parentSlot` `moveToSlot` `insertSameSlot` `reorderInParentSlot` `rejectionForMoveTo` `acceptedCountForMoveTo` `rejectionForLoopOrDetach` `attachToSlot` `detachFromParent` `setParent` `registerEdgeWith` `registerAncestorTargetedRecursively` `putInSlotFor` `moveIntoFirstAcceptingSlot` `spillTo` `destroy` `spillContentsTo` `becomeAlong` `canBecomeAlong` `becomeType` `evict` `contains` `findAncestorWithProperty` `findRoot` `findDescendantByInstanceId` `findDescendantOfDef`。責務C（効果の実行）: `applyActiveEffect` `resolveEffectTarget` `resolveEffectTargetOrAncestor` `captureEffectSite` `executeSpawn` `place` `tryFirstAcceptingChild` `tick` `actionsFor` `tryGetAction` `combinationsWith`。責務D（導出値）: `engine` `containerContributionTo` `effectiveWeight` `storageFillRatio` `readInfluences` `collectContainerInfluence` `collectInfluencesRecursively` `resolveInfluenceTargets` `artSuffix` `exhaustedStage`。**Dだけが「保持も付け替えもしない、読んで計算するだけ」**で、他の3つと性質が違う。 |
| Slot | 1つのスロットの中身をセルの並びとして保持し、**かつ**受け入れ可否（型・空き・capacity）を判定し、**かつ**セルをずらして場所を作る配置アルゴリズムを走らせる——**責務は3つ**。 | 判定: `rejectionFor` `acceptedCount` `vacancyFor` `putInMinutes` `fillRatio`。配置アルゴリズム: `placeSameSlot` `tryFillCell` `tryPlaceAdjacent` `tryPlaceAtGap` `tryPlaceShifted` `tryInsertAtGap` `tryInsertAtCell` `tryMoveStackToGap` `tryMoveStackToCell` `clampIndex`（11メソッド・約150行が「どこへずらすか」だけを扱う） |
| WorldSession | 1セッション分の可変状態（instanceId発行・rng・world）を持ち、**かつ**世界の出来事を4種の観測口へ流し、**かつ**ゲーム内時間を進めてtickを回す——**責務は3つ**。 | 観測: `tickObserver` `changeObserver` `signalObserver` `gainObserver` `gathered` `subject` `observeTicks` `observeChanges` `observeSignals` `observeGains` `withInteractionEffect` `withSubject` `recordGain` `recordChange` `recordSignal`（26宣言中15）。時間: `advanceWorldTime` `runTick` |
| PropertyValue | 1つのプロパティの実行時の値を保持し、登録された持続効果を反映して実体値・実効値を答える。 | `ticksUntilMax` `changePerTick`（今の進み方が続く**と仮定した**予測）、`availableToTransferOut` `remainingTransferCapacity`（transfer効果の規則） |
| PropertyInfluences | 1つのプロパティを視点に、書き出された影響の辺を「与える/受ける」へ振り分け、記号の同じものを1件へ畳む。 | 畳み込み（`add`）は「プレイヤーにとっては1件」という**見せ方の判断**で、辺の書き出しそのものではない |
| EffectSite | same_slot spawnのために、効果の起点が占めていた位置を捕捉して置き換え先を決める。 | なし（`SameSlotPlacement` は捕捉の結果を1ホップ運ぶだけの入れ物） |
| ObjectStack | 同じ型のWorldObjectを1つのまとまりとして保持し、宣言された並び順で出し入れする。 | なし |
| ObjectRef | オブジェクトを1つ指す参照の宣言と、その解決。 | `needsInteraction`（ロード時検証のための問い） |
| Interaction/Action/Combination | 相手の決まった操作1つとして、宣言（Def）と個体（self/actor/dragged）を結び付ける。 | なし |
| crafting.ts | 製作の進行（工程・要求・供給・前進）を、製作中オブジェクトとレシピから読む。 | `currentStep` `remainingRequirements` は製作中オブジェクトを見ておらず、RecipeDefとprogressだけで決まる |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/domain/AlertLevel.ts | `ALERT_LEVELS` | 所属 | 2 | ロード時検証のための列挙の実体化で、型そのものではない。 | (現状可) | | |
| src/domain/EffectSite.ts#EffectSite | `parent`, ctor | 所属 | 2 | 呼び出し側（WorldObject.captureEffectSite）が4値を組み立てて渡し、`parent`はspill先を決めるためだけに公開されている。 | (現状可) | | |
| src/domain/EffectSite.ts | `SameSlotPlacement`（クラス） | 所属 | 3 | 2値を`EffectSite`→`WorldObject.insertSameSlot`→`Slot.placeSameSlot`の1ホップ運ぶだけで、受け手は即座に分解している（`placeSameSlot(obj, originCellIndex, kindRemains)`）。 | `EffectSite`内のprivate、または`Slot.placeSameSlot`の引数のまま | | |
| src/domain/EffectSite.ts#EffectSite | `nextPlacement`, `originKindRemains`, `originCellIndex` | 所属 | 3 | クラス内からしか呼ばれないprivateヘルパー。 | (現状可) | | |
| src/domain/Interaction.ts#Interaction/Action | `name`, `showMenu` | 所属 | 4 | `this.def.name` / `this.def.showMenu` の素通しゲッター。Layers.md 3節は「宣言は`def`から直に読む」としており、素通しは線をぼやかす。 | 呼び出し側が`def`から直に読む | `def`をprotectedに閉じているため、呼び出し側から宣言へ届く口がこれしかない（`def`を公開すると「Defへ訊くかInteractionへ訊くか」の線が消える） | |
| src/domain/LocalIndexMap.ts | `LocalIndexMap`（クラス）, `missing`, `empty` | 所属 | 2 | グローバルID⇔ローカル添字の変換表と番兵値・空値。概念としては自明でないが、密配列を持つ以上必要。 | (現状可) | | |
| src/domain/ObjectRef.ts#ObjectRef | private ctor | 可視性 | 2 | 3通りの指し方をstatic factoryで作らせるための隠蔽。 | (現状可) | | |
| src/domain/ObjectRef.ts#ObjectRef | `needsInteraction()` | 所属 | 4 | 「actor/draggedに依存する参照か」はロード時検証（`parseActiveEffects`）だけが訊く問いで、実行時の参照解決とは無関係。 | `src/loader/parseActiveEffects.ts` | `root`がprivateで、`reading`経由にすると呼び出し側がunionのkindを分解して同じ判定を書くことになる | |
| src/domain/ObjectStack.ts#ObjectStack | `computeInsertionIndex` | 所属 | 3 | クラス内からしか呼ばれないprivateヘルパー。 | (現状可) | | |
| src/domain/PropertyGain.ts#InteractionGains | `source: readonly WorldObject[]` | 所属 | 2 | 中身は「出どころとその祖先の連なり」（`WorldSession.withInteractionEffect`が`chain`を詰めている）で、単数の出どころではない。 | (現状可・改名) | | **あり**（`source`という単数の名前で祖先チェーンを運んでいる。実装を読むまで単数のsourceだと読める） |
| src/domain/PropertyInfluence.ts | `InfluenceCounterpart` | 可視性 | 3 | exportされているが、他ファイルからは1度も型名で参照されていない（構造型として消費されている）。 | (現状可・export外し) | | |
| src/domain/PropertyInfluence.ts#PropertyInfluences | `counterpartOfCause`, `counterpartOf`, `add` | 所属 | 3 | クラス内からしか呼ばれないprivateヘルパー。 | (現状可) | | |
| src/domain/PropertyInfluence.ts | `PropertyInfluences`（クラス） | 所属 | 4 | 「視点で与える/受けるへ振り分ける」「相手も記号も同じ辺は1件へ畳む」は**見せ方の判断**（Layers.md 3節: 読んだ値から答えを組み立てるなら映しのもの）。ドメインが持つのは`InfluenceWriter`という読み上げ口までのはず（同6節の`EffectReader`と同じ形）。 | `src/game/view/`（`InfluenceWriter`実装として） | 辺を集めるのに祖先チェーン・子孫走査・`def.passives`が要り（`readInfluences`）、実装を映しへ出すとその走査を外へ開けることになる | |
| src/domain/PropertyValue.ts#PropertyValue | `isComputingEffectiveValue` | 所属 | 2 | 再入（循環参照）検出用のフラグ。概念ではなくプログラム上の防御。 | (現状可) | | |
| src/domain/PropertyValue.ts#PropertyValue | `init(number)` | 可視性 | 2 | 「世界のルールを走らせずに値を置く」裏口。becomeType・IslandSpawner・シナリオの3者のためだけに公開されている。 | (現状可) | | **あり**（`init`はコンストラクタ相当に読めるが、実体は「rangeイベントもgainも起こさずに書く」特殊経路） |
| src/domain/PropertyValue.ts#PropertyValue | `artSuffix` | 所属 | 3 | `this.stage?.art` の素通し。`stage`が既に公開されているので、呼び出し側（`WorldObject.artSuffix`）が同じ1行を書ける。 | 呼び出し側 | | |
| src/domain/PropertyValue.ts#PropertyValue | `ticksUntilMax()` | 所属 | 4 | 「今の進み方が**続いたとき**」という仮定の上の予測。Layers.md 6節が「答えが必ず近似になるものは解析へ」と定めた種類の値で、宣言が言っていることではない。 | `src/analysis/`、または利用者の`src/game/view/cardLooks.ts` | `accumulateEffects`（登録済みの`add`効果）がprivateで、その和を外から取れない——ただし同じ和を返す`changePerTick`が既に公開されており、この防御は実際には破れている | |
| src/domain/PropertyValue.ts#PropertyValue | `changePerTick()` | 可視性 | 5 | public だが**クラス外から1箇所も呼ばれていない**（`ticksUntilMax`の内部でしか使われない）。 | (private化) | | |
| src/domain/PropertyValue.ts#PropertyValue | `incoming` | 可視性 | 5 | public だが**プロダクションコードに呼び出し元が無い**（テストのみ）。さらに`RegisteredPassiveEffect`側が「`PropertyValue.incoming`のため公開する」と書いてメンバーを開けており、使われていない口のために2段の露出が続いている。 | (private化・`RegisteredPassiveEffect`の公開も見直し) | | |
| src/domain/PropertyValue.ts#PropertyValue | `availableToTransferOut()`, `remainingTransferCapacity()` | 所属 | 2 | transfer効果（9.5節）の規則だが、実体値とrangeのどちらで判定するかを呼び出し側に決めさせないため値側にある（Layers.md 3節の`alert`と同じ形）。 | (現状可) | | |
| src/domain/PropertyValue.ts#PropertyValue | `toString()` | 所属 | 2 | デバッグ・エラー文面のための言語規約メンバー。 | (現状可) | | |
| src/domain/ReferenceRoot.ts | `PropertyPath`（クラス） | 配置 | 3 | `ReferenceRoot`型のファイルに、別概念（root+propertyGlobalIdの組）のクラスが同居している。利用者は`PickEffect`/`ConditionNode`/`parseConditions`など5ファイル。 | `src/domain/PropertyPath.ts` | | |
| src/domain/Rng.ts | `pickWeighted()` | 配置 | 4 | 重み付き抽選は完全に汎用のアルゴリズムで、ゲームの語彙を1つも含まない（Layers.md 4節の`src/util/`の定義に合致）。 | `src/util/` | `Rng`インターフェースがドメインに居るため、`src/util/`へ出すと util → domain の import が生まれる（`Rng`ごと出すなら成立する） | |
| src/domain/Rng.ts | `randomRng()` | 所属 | 2 | 既定の非決定乱数源のファクトリ。 | (現状可) | | |
| src/domain/Rng.ts | `seededRng()` | 配置 | 3 | 実体は`domain/generation/Pcg32`にあり、この1行のためだけに抽象の定義ファイルが具象実装へ依存している。 | `src/domain/generation/` | | |
| src/domain/Slot.ts#Slot | `hasFixedCells` | 可視性 | 5 | public だが**クラス外に呼び出し元が無い**（`WorldObject`のコメントで言及されるのみ、テストにも無し）。 | (private化) | | |
| src/domain/Slot.ts#Slot | `tryInsertAtGap()`, `tryInsertAtCell()`, `tryMoveStackToGap()` | 可視性 | 5 | public だが**src/・tests/ を通じて呼び出し元が無い**。`insertAt`/`moveStackTo`が唯一の入口として既に存在し、gap/cellの読み替えを担っている。 | (private化) | | |
| src/domain/Slot.ts#Slot | `tryMoveStackToCell()` | 可視性 | 4 | 上の3つと同じ4つ組の1つだが、こちらだけ`tests/domain/stacking.test.ts`が直接叩いている。 | (private化) | テストがセル指定の入れ替えを`insertAt`/`moveStackTo`経由ではなく直に検証しているため、privateにするとテストが書けなくなる | |
| src/domain/Slot.ts#Slot | `addInternal()`, `removeInternal()`, `restack()`, `placeSameSlot()` | 可視性 | 2 | `WorldObject`の配置の関門からのみ呼ばれる内部操作を、TypeScriptにfriendが無いためpublicにしている（`Internal`という接尾辞がそれを明示している）。 | (現状可) | | |
| src/domain/Slot.ts#Slot | `liveStacks`, `vacancyFor`, `findCellFor`, `findMergeableCell`, `sumVolume`, `tryMergeIntoMatchingStack`, `tryFillCell`, `tryPlaceAdjacent`, `tryPlaceAtGap`, `tryPlaceShifted`, `clampIndex` | 所属 | 3 | クラス／ファイル内からしか呼ばれないprivateヘルパー（大半はセルずらしのアルゴリズム）。 | (現状可。ただし「セルをずらして場所を作る」11メソッド分は`CellLayout`のような別クラスへ切り出せる) | | |
| src/domain/WorldObject.ts#WorldObject | `instanceId` | 所属 | 2 | 同一性比較・保存・参照解決のためのID。 | (現状可) | | |
| src/domain/WorldObject.ts#WorldObject | `findDescendantByInstanceId()`, `findDescendantOfDef()` | 所属 | 2 | 「別途のインスタンス一覧を持たずツリー走査で引く」というプログラム上の都合の解決。 | (現状可) | | |
| src/domain/WorldObject.ts#WorldObject | `insertSameSlot()` | 可視性 | 2 | `EffectSite`からのみ呼ばれるsame_slot専用の入口。 | (現状可) | | |
| src/domain/WorldObject.ts#WorldObject | `readInfluences()`, `resolveInfluenceTargets()` | 所属 | 2 | 画面（Windows.md 8節）のための読み上げ口。Layers.md 6節が`EffectReader`について認めた形と同じで、口そのものはドメインに要る。`resolveInfluenceTargets`は名前に反して`PassiveEffect`の登録経路でも使われている。 | (現状可) | | |
| src/domain/WorldObject.ts#WorldObject | `resolveEffectTargetOrAncestor()`, `executeSpawn()` | 所属 | 2 | 効果側から呼ばれる解決・実行の入口。 | (現状可) | | |
| src/domain/WorldObject.ts#WorldObject | `engine`, `missing`, `artSuffix`, `exhaustedStage`, `rejectionForLoopOrDetach`, `attachToSlot`, `detachFromParent`, `setParent`, `registerEdgeWith`, `registerAncestorTargetedRecursively`, `spillContentsTo`, `becomeType`, `evict`, `effectiveWeight`, `collectContainerInfluence`, `collectInfluencesRecursively`, `place`, `tryFirstAcceptingChild` | 所属 | 3 | クラス内からしか呼ばれないprivateヘルパー（`artSuffix`/`exhaustedStage`はpublicだが`PropertyValue`側の同名ゲッターへの素通し）。 | (現状可) | | `missing`（**あり**: 名前からは「持っていないか」を返す述語に読めるが、実体はエラー**文面**を組み立てるメソッド。さらに`names: NameRegistry`を呼び出し側から受け取るが、`this.session.codex`から自分で辿れる） |
| src/domain/WorldObject.ts#WorldObject | `storageFillRatio()` | 所属 | 4 | 「最も詰まっているスロットを返す」は`Slot.fillRatio`の集約ではなく**どのスロットを映すかという見せ方の判断**（Layers.md 3節）。唯一の利用者は`src/game/view/cardLooks.ts`。 | `src/game/view/cardLooks.ts` | `private get engine`（規約プロパティIDの束）と各スロットの`capacity`を外へ開けずに済ませるため | |
| src/domain/WorldObject.ts#WorldObject | `containerContributionTo()` | 所属 | 4 | `weight`/`load`という**特定のプロパティ名だけに効く算術**（fill×density、load_reduction_rate）が、あらゆる型の実体クラスに直書きされている。汎用のWorldObjectが2つのプロパティ名を知っている。 | `ContainerContribution`（ContainerSystem専用の小クラス／モジュール） | `PropertyValue.getEffectiveValue`が実効値の合成の途中でこれを呼ぶため、全スロットの中身と`effectiveWeight`（再帰）へ同期的に届く必要がある | |
| src/domain/WorldObject.ts#WorldObject | `captureEffectSite()` | 所属 | 4 | `EffectSite`が要る4値（parent/slot/originStack/その添字）をWorldObject側が組み立てている。「自分のことは自分でする」に照らせば捕捉は`EffectSite`の仕事。 | `EffectSite.capture(owner)`（staticファクトリ） | `_parent`・`_parentSlot`がprivateで、捕捉をEffectSite側へ寄せると両方を渡すか公開することになる | |
| src/domain/WorldSession.ts#WorldSession | `nextInstanceId` | 所属 | 2 | ID発行カウンタ。可変状態をロード後不変のWorldCodexに置けないための配置。 | (現状可) | | |
| src/domain/WorldSession.ts#WorldSession | `adoptWorld()` | 所属 | 2 | セッションとWorldの相互依存を断つための後付け結合。概念ではなく生成順の都合。 | (現状可) | | |
| src/domain/WorldSession.ts#WorldSession | `runTick()` | 所属 | 3 | `advanceWorldTime`からのみ呼ばれるprivateヘルパー。 | `advanceWorldTime`と一緒に移動 | | |
| src/domain/WorldSession.ts#WorldSession | `tickObserver`, `changeObserver`, `signalObserver`, `gainObserver`, `gathered`, `subject`, `observeTicks()`, `observeChanges()`, `observeSignals()`, `observeGains()`, `withInteractionEffect()`, `withSubject()`, `recordGain()`, `recordChange()`, `recordSignal()` | 所属 | 4 | 26宣言中15が「世界の出来事を観測口へ流す」ための状態と手続きで、セッションの本来の責務（instanceId発行・rng・world保持）と混ざっている。`observe*`4本は保存→差し替え→try/finally→復帰が**4回コピーされた同一の仕組み**で、差はフィールドとコールバック型だけ。 | `WorldObservation`（新規クラス。セッションが1つ保持し、`observe<T>`をパラメータ化した1つの仕組みに畳む） | 世界の中の物（`WorldObject`・`PropertyValue`）が持っている外部への経路は`session`ただ1本で、観測口を別クラスへ出すと`session.observation.recordChange(...)`のような2段の道か、全オブジェクトへの2本目の参照が要る | |
| src/domain/WorldSession.ts#WorldSession | `advanceWorldTime()` | 所属 | 4 | 中身はすべて`world`のフィールド演算（`world.minute % world.minutesPerTick`でtick境界を割り出し、`world.addMinutes`を刻む）。Worldの不変条件をWorldSessionが代わりに守っている（CLAUDE.md「自分のことは自分でする」）。 | `World`（`src/domain/views/World.ts`） | `runTick`が`world.runAnimalTurns(this)`でセッションを渡し返すため、Worldへ移すとWorldがセッションを持つ循環になる | |
| src/domain/actionTime.ts | `spendDuration()` | 所属 | 4 | 第2引数に`session`を取り、中身は`session.advanceWorldTime`と`world.instance.contains`だけ。`session.spendDuration(minutes, participants)`と書けるものを自由関数にしている。 | `WorldSession`のメソッド | ここに置くことで`WorldSession`が「行動」「関与オブジェクト」という語彙と、行動が成立しなかったときの打ち切り規約（ActionSystem.md 2節）を知らずに済んでいる | |
| src/domain/autoFill.ts | `chooseCandidates()` | 所属 | 3 | ファイル内からしか呼ばれないモジュール private ヘルパー。 | (現状可) | | |
| src/domain/crafting.ts | `currentStep()`, `remainingRequirements()` | 所属 | 4 | 引数が`(recipe, progress)`だけで、製作中オブジェクトもセッションも見ていない。「所要時間を積み上げた区間が工程を指す」はレシピの宣言の読み方そのもの。 | `RecipeDef`のメソッド | `RecipeDef`はロード後不変の宣言（Layers.md 3節「型だけで決まるなら定義へ訊く」）で、そこへ`progress`という実行時の値の読み方を持ち込まずに済ませている | |
| src/domain/crafting.ts | `allocate()`, `spillUnneeded()` | 所属 | 3 | ファイル内からしか呼ばれないモジュール private ヘルパー。 | (現状可) | | |

## 移動先が書けなかったもの

すべての判定4に移動先を書けた。ただし2件は「既存のクラスへ動かす」ではなく**欠けている概念を新しく作る**必要がある。

- **観測の器（`WorldObservation` 相当）が無い。** WorldSessionの15宣言が受け持っている「世界の出来事を、囲った範囲のあいだだけ観測口へ流す」は、tick・変化・signal・gainの4種で同じ形をしているのに、4本の別々のフィールドと4本の同型メソッドとして書かれている。「観測口を1つ差し込んで、抜けたら戻す」という概念に名前が無いため、種類が増えるたびにWorldSessionが2宣言ずつ太る。
- **中身から受ける寄与（ContainerSystem）の置き場が無い。** `containerContributionTo`＋`effectiveWeight`＋`collectContainerInfluence`＋`storageFillRatio`は同じ1つの仕組み（weight/loadの導出）の4面だが、WorldObject・PropertyValue・PropertyInfluenceの3ファイルに散っている。まとめる先のクラスが存在しない。

判定5（6件）はいずれも**移動ではなくprivate化**で解ける。`Slot.hasFixedCells` / `Slot.tryInsertAtGap` / `Slot.tryInsertAtCell` / `Slot.tryMoveStackToGap` / `PropertyValue.changePerTick` / `PropertyValue.incoming` は、そこに居ること自体は正しく、公開されている理由だけが無い。

## ファイル配置（層=配置）についての所見

- **層としての配置は全21ファイルとも正しい。** どれも「見えていない土地・物も含めて何が在り何が起きるか」を扱っており、Layers.md 4節の`src/domain/`＝世界に合致する。Phaser・座標・ミリ秒への依存も無い。
- ただし`src/domain/`直下は47ファイルの平置きで、**ロード後不変の宣言（Def）と実行時の状態（実体）が混ざっている**。担当範囲の中だけを見ても、宣言側（`ObjectRef` `ReferenceRoot`/`PropertyPath` `AlertLevel` `SlotPosition`）・実体側（`WorldObject` `Slot` `PropertyValue` `ObjectStack` `WorldSession` `EffectSite`）・出来事の記録（`WorldChange` `WorldSignal` `PropertyGain` `PropertyInfluence`）・手続きモジュール（`actionTime` `autoFill` `crafting` `slotEntry`）の4種が同じ階層に並ぶ。Layers.md 3節が「定義は読んでよい／インスタンスへ訊くか定義へ訊くか」という線を強く引いているのに、ディレクトリはその線を映していない。
- `Rng.ts`が直下に居ながら唯一の実装（`Pcg32`）は`domain/generation/`にあり、抽象の定義ファイルが具象サブディレクトリへ依存している。`pickWeighted`はゲームの語彙を1つも持たない汎用アルゴリズムで、本来は`src/util/`。
- `ReferenceRoot.ts`だけは1ファイルに2概念（`ReferenceRoot`型と`PropertyPath`クラス）が同居しており、他のファイルの粒度から外れている。

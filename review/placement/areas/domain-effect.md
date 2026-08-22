# domain-effect

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/domain/ActiveEffect.ts | 59 | 38 | 2 | 8 | 11 | 0 |
| src/domain/BecomeEffect.ts | 7 | 6 | 1 | 0 | 0 | 0 |
| src/domain/ConditionNode.ts | 42 | 23 | 10 | 8 | 1 | 0 |
| src/domain/ConditionReader.ts | 15 | 12 | 0 | 0 | 3 | 0 |
| src/domain/EffectReader.ts | 28 | 25 | 0 | 2 | 1 | 0 |
| src/domain/MoveEffect.ts | 7 | 7 | 0 | 0 | 0 | 0 |
| src/domain/PassiveEffect.ts | 45 | 35 | 0 | 8 | 2 | 0 |
| src/domain/PassiveEffects.ts | 9 | 7 | 1 | 0 | 1 | 0 |
| src/domain/PassiveReader.ts | 14 | 12 | 0 | 1 | 1 | 0 |
| src/domain/PickEffect.ts | 21 | 18 | 0 | 1 | 1 | 1 |
| src/domain/RegisteredPassiveEffect.ts | 6 | 5 | 1 | 0 | 0 | 0 |
| src/domain/SignalEffect.ts | 6 | 4 | 0 | 2 | 0 | 0 |
| **合計** | **259** | **192** | **15** | **30** | **21** | **1** |

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| `ActiveEffect`（基底） | 一時的な効果1つを、対象を解決して適用する **と**、まとめ操作の可否・回数を答える | `countableVessels`, `acceptedCount`, `unresolvable`（適用ではなく「この操作を出してよいか／何個受けるか」の問い） |
| `ActiveEffects` | 子の効果を宣言順に適用する | 上記3つの畳み込み（基底が問いを持つので付いてくる） |
| `AddEffect` | プロパティを amount だけ加減算する | `applyScaled`（transfer の linked_add 専用の按分） |
| `SpawnEffect` | オブジェクトを count 個生む | `objectGlobalId`/`into`/`count` の公開（`WorldObject.executeSpawn` に読ませるため） |
| `TransferEffect` | 在庫に応じた量をプロパティ間で移す | `collectTransferInfluences`（影響グラフの辺の書き出し）, `countableVessels`/`acceptedCount` |
| `ConditionNode` | 条件の木を保持し、読み上げる **と**、世界に対して評価する **と**、見ているプロパティを列挙する | `collectWatchedProperties`（解析の見積もり材料）、`evaluate*`/`resolve*` 群（評価器） |
| `EffectReader` / `ConditionReader` / `PassiveReader` | 宣言を動詞ごとに読み上げる相手の口を定める | `PickCandidateReading.effect`, `GateReading.conditions`, `all`/`any`/`not`（読み上げではなく木そのものを渡している） |
| `PassiveEffect`（基底） | 持続効果1つを読み上げ、影響の辺を出す **と**、関係変化の登録契機を受ける **と**、tick輸送かを名乗る | `registerRelation`/`registerChild`（`PropertyPassiveEffect` だけの概念）, `tickTransfer`（具象サブクラスの名指し） |
| `PropertyPassiveEffect` | 対象プロパティへ寄与として登録される持続効果 | `activeAmount`（登録済み1件の「今いくら効いているか」） |
| `PassiveEffects` | 1つの ObjectDef の持続効果一式へ、登録/解除とtick輸送を一括で流す | `declarations`（クラスの説明文が「要素リストは公開しない」と言っているのに公開している） |
| `WeightSpec` | リテラルか参照かの二択で数値を1つ宣言し、文脈で解く | （責務自体は健全。pick 専用ではないのに `PickEffect.ts` に住んでいる） |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/domain/PickEffect.ts | `WeightSpec`（+配下8宣言） | 配置 | 5 | pick の重み専用ではなく `SlotDef.putInDuration`・`ActionDef`/`InteractionDef`/`CombinationDef` の `duration` が使う汎用の数値指定なのに、pick のファイルに住み「Weight」と名乗っている | `src/domain/WeightSpec.ts`（名前も `ValueSpec` 等へ） | | 〇（用途と名前が不一致） |
| src/domain/ActiveEffect.ts#ActiveEffect / ActiveEffects / TransferEffect, src/domain/PickEffect.ts#PickEffect | `countableVessels()` ×4, `acceptedCount()` ×3 | 所属 | 4 | 「まとめて何個まで受けるか」は操作側（`InteractionDef`/`CombinationDef`/`Slot.acceptedCount`/loader の `allow_multiple` 検証）の問いで、効果は適用しか宣言していない | `CombinationDef`／`InteractionDef` 側の判定へ、`TransferEffect` は容量だけを答える口に絞る | `TransferEffect` の `toObject`/`toPropertyGlobalId`/`amount`/`toAmount` を非公開に保つため、器の数を数えられるのは効果自身だけになっている | 〇（`countableVessels` は本体を読むまで意味が取れない） |
| src/domain/ActiveEffect.ts#AddEffect | `applyScaled()` | 所属 | 4 | `amount * numerator / denominator` という按分は transfer の linked_add の都合で、add 自身の概念ではない | `TransferEffect`（按分した `AddEffect` を作って `apply` する、または `AddEffect` に按分済みの複製を作らせる） | `AddEffect` の `target`/`propertyGlobalId`/`amount` を非公開に保つため、按分を外から書けない | |
| src/domain/ActiveEffect.ts#SpawnEffect | `objectGlobalId`, `into`, `count` | 可視性 | 4 | 効果の唯一の公開フィールド群で、`apply` は `owner.executeSpawn(this,…)` と自分を丸ごと渡し、`WorldObject` が3つを読んで配置する | `WorldObject.executeSpawn(objectGlobalId, into, …)` の引数へ、または配置手順を `SpawnEffect` 側へ | 配置（スロット宣言順走査・`spillTo`）が `WorldObject` にあり、効果が自分で置けないため内部を渡すしかない | |
| src/domain/ActiveEffect.ts#TransferEffect | `collectTransferInfluences()` | 所属 | 4 | 呼ぶのは `TransferPassiveEffect.collectInfluences` だけで、しかも `active`（ゲートが開いているか）は呼び出し側から渡される＝この効果は答えを持っていない | `TransferPassiveEffect`（`PassiveEffect.collectInfluences` の実装内で組み立てる） | `TransferEffect` の from/to 4フィールドを非公開に保つため、辺を作れるのが効果自身だけになっている | |
| src/domain/ConditionNode.ts#ConditionNode | `collectWatchedProperties()` | 所属 | 4 | 利用者は `src/analysis/tickDeltas.ts` 1箇所のみで、「条件がいつまで成り立つか」の見積もり材料＝解析側の問い。`ConditionReader` を通さない第2の読み出し口になっている | `src/analysis` 側の `ConditionReader` 実装（`property`/`propertyStage` を受けて集める） | `children`/`root`/`propertyGlobalId` が private で、木を辿れるのがノード自身だけ | |
| src/domain/ConditionReader.ts#ConditionReader | `all()`, `any()`, `not()` | 可視性 | 4 | 「読み上げ口」を名乗りながら、子は `ConditionNode` そのものを渡す＝木が外へ出ている（`EffectReader` の方針と矛盾） | (なし) | 再帰する宣言を読み上げだけで表す仕組みが無く、入れ子を畳むには読み手が木を持つしかないため | |
| src/domain/PassiveReader.ts#GateReading | `conditions: ConditionNode` | 可視性 | 4 | 同上。持続効果の「宣言」として `ConditionNode` の実体をそのまま持たせている | (なし) | 同上 | |
| src/domain/EffectReader.ts#PickCandidateReading | `effect: ActiveEffect` | 可視性 | 4 | 「効果の木そのものは外へ出さない」と宣言している当のファイルで、候補の効果を木のまま渡している | (なし) | pick は候補が再帰しうるため、1回の read では表せず読み手に木を持たせるしかない | |
| src/domain/PassiveEffect.ts#PassiveEffect | `tickTransfer` getter | 所属 | 4 | 基底が具象サブクラス `TransferPassiveEffect` を戻り値型で名指ししている（基底→具象の逆流） | `PassiveEffects` 側での振り分け、または基底に `applyTick` の空既定を置く | `PassiveEffects` のコンストラクタが `instanceof` で振り分けずに済ませるため | |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect | `activeAmount(declarer, slotBearer)` | 所属 | 4 | 「今いくら効いているか」は登録1件の状態で、`RegisteredPassiveEffect.activeAmount()` は自分が持つ2つを渡し直しているだけの素通し | `RegisteredPassiveEffect` | `gate` と `amount` を非公開に保つため、計算本体を def 側から動かせない | |
| src/domain/PassiveEffects.ts#PassiveEffects | `declarations` getter | 可視性 | 4 | クラスの説明文が「要素リストは公開せず一括依頼だけを受ける」と言うのに、`PassiveEffect[]` をそのまま返し、codex-viewer / analysis が1件ずつ `read` している | `PassiveEffects.read(reader: PassiveReader)` を生やして getter を閉じる | 一括の読み上げ口が無く、読み上げるには要素を取り出す以外の手段が無いため | |
| src/domain/ActiveEffect.ts | `SetEffect`, `AddEffect`, `DestroyEffect`, `SpawnEffect`, `TransferEffect`, `SpawnTargetRoot` | 配置 | 3 | 兄弟の具象（`MoveEffect`/`BecomeEffect`/`SignalEffect`/`PickEffect`）はファイルが分かれているのに、この5つだけ基底と同居して484行になっている | `TransferEffect.ts`, `SpawnEffect.ts`（`SpawnTargetRoot` も同伴）ほか | | |
| src/domain/ActiveEffect.ts#AddEffect / TransferEffect | `reading` getter | 可視性 | 3 | `read(reader)` があるのに宣言を別口で公開しているのは、`TransferEffect.reading` が linked を並べる／`TransferPassiveEffect.read` が同じ宣言を `PassiveReader` へ流すため | 呼び出し側からは `read` 経由に寄せる | | |
| src/domain/ConditionNode.ts#ConditionNode | `evaluateProperty`, `evaluatePropertyStage`, `resolvePropertyEffectiveValue`, `resolvePropertyOwner`, `evaluateSlotPosition`, `evaluateSlotContent`, `evaluateObjectMatches` | 所属 | 3 | 木の保持・読み上げとは別の「評価器」がクラス内に7メソッドぶら下がっており、private なのでここに居るだけ | `ConditionEvaluator`（分けるなら） | | |
| src/domain/ConditionNode.ts | `ConditionNodeFields` | 所属 | 3 | 8つの static ファクトリから private コンストラクタへ値を運ぶためだけの袋で、概念としては存在しない | 各 static が private コンストラクタへ直接渡す | | |
| src/domain/EffectReader.ts / src/domain/PassiveReader.ts | `EffectDeclaration`, `PassiveDeclaration` | 所属 | 3 | `ActiveEffect.read` / `PassiveEffect.read` と同一シグネチャの重複した口。読み手（codex-viewer・analysis）がクラスを値として輸入しないためだけに置かれている | 片方に寄せる（`read(reader)` を持つものの共通型を1つに） | | |
| src/domain/EffectReader.ts | `WeightReading` | 配置 | 3 | `WeightSpec` の宣言型なので、`WeightSpec` と同じ場所に居るのが自然（`WeightSpec` は所要時間にも使う） | `src/domain/WeightSpec.ts`（判定5の移動に同伴） | | |
| src/domain/PassiveEffect.ts | `PassiveEffectGate` | 配置 | 3 | 効果ではなく「条件＋段」の保持者で、具象効果の実装ファイルに同居する理由が無い | `src/domain/PassiveEffectGate.ts` | | |
| src/domain/PassiveEffect.ts#PassiveEffectGate | `stagePropertyGlobalId` getter | 可視性 | 3 | ゲートの中身のうち1フィールドだけを、影響グラフの都合で開けている（他ファイル参照なし） | `PassiveEffectGate` 側で辺の原因を答える口に畳む | | |
| src/domain/PassiveEffect.ts#PassiveEffect | `registerRelation`, `registerChild`（基底の空実装） | 所属 | 3 | 登録という概念を持つのは `PropertyPassiveEffect` だけで、基底は一括反復のために空実装を置いている | `PropertyPassiveEffect`（`PassiveEffects` 側で対象を絞る） | | |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect | `registerInto` | 可視性 | 3 | 呼ぶのは同クラスの private `register` だけ。隣の `reversible` が `protected abstract` なのに、こちらだけ public | 同クラスのまま `protected abstract` へ | | |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect | `registerResolvedRelation`, `register`, `unregister` | 所属 | 3 | クラス内からしか呼ばれない private ヘルパー | （移動不要） | | |
| src/domain/PickEffect.ts#PickEffect | `selectWeighted` | 所属 | 3 | クラス内からしか呼ばれない private ヘルパー | （移動不要） | | |
| src/domain/SignalEffect.ts#SignalEffect | `name`, `target` | 可視性 | 3 | public だが `apply`/`read` 以外から読まれておらず（他ファイルからの参照なし）、private で足りる | 同クラスのまま private へ | | |
| src/domain/ActiveEffect.ts#ActiveEffect / ActiveEffects, src/domain/BecomeEffect.ts#BecomeEffect | `unresolvable()` | 所属 | 2 | 「効果が何を起こすか」ではなく「操作を候補に出してよいか」の問い。実際に判定できるのは become だけで、基底の既定は安全側の false | `InteractionDef`／`CombinationDef` 側 | | |
| src/domain/ConditionNode.ts#ConditionNode | `kind` と9つの optional フィールド（`root`〜`children`） | 所属 | 2 | 8種類の葉/複合を単一クラス＋判別子で表す実装上の都合で、どのノードも使わないフィールドを9個抱える | （現状維持が妥当。分けるなら種類ごとのクラス） | | |
| src/domain/PassiveEffects.ts#PassiveEffects | `transfers` | 所属 | 2 | `effects` から導ける派生で、走らせる側が毎回篩わずに済ませるために前計算している | （移動不要） | | |
| src/domain/RegisteredPassiveEffect.ts#RegisteredPassiveEffect | `declarer` | 可視性 | 2 | 解除時の同定と `PropertyValue.incoming` の表示のために公開している（典型例） | （移動不要） | | |

## 移動先が書けなかったもの

`ConditionReader.all`/`any`/`not`、`GateReading.conditions`、`PickCandidateReading.effect` の3件（判定4）に移動先を書けなかった。

いずれも「**再帰する宣言を、木そのものを渡さずに読み上げる**」概念が欠けている。現在の Reader は
「1回の呼び出し＝1つの葉の宣言」を前提にしており、入れ子を表す語彙（読み上げの入れ子の開始/終了、
または読み手が子ノード用のリーダを返す形）が無い。そのため入れ子を持つ3箇所だけが、方針から外れて
`ConditionNode` / `ActiveEffect` の実体を読み手へ手渡している。この語彙が入れば、Layers.md 6節の
「効果の木を外へ出さない」が例外なしで成立する。

## ファイル配置（層=配置）についての所見

12ファイルはすべて `src/domain/` にあり、**層としては正しい**（宣言に何が書いてあるかを答える側で、
近似は `src/analysis/` にある）。Reader 3種も、疑ったうえで `src/domain/` で正しいと判断した——
`EffectReader`/`ConditionReader`/`PassiveReader` は「読む対象の型」ではなく**読み手が実装する側の契約**で、
実装は `src/analysis/` と `src/codex-viewer/` にあり、ドメインが定めるからこそ動詞を1つ足したときに
読み手のコンパイルが落ちる。`ActiveEffect.ts` へ吸収すると、読み手が効果クラスを値として輸入する
経路ができてしまう。

ファイル内の割り方には偏りがある。`ActiveEffect.ts` だけが基底＋具象5種で484行あり、同格の
`MoveEffect`/`BecomeEffect`/`SignalEffect`/`PickEffect` は1ファイル1種。分けるか寄せるかの基準が
1つ無い状態。加えて `PickEffect.ts` の `WeightSpec` は pick 以外（4種の `duration`、`SlotDef`）から
参照されており、ここが唯一の判定5。

# domain-def / domain-effect — 判定3の再点検

対象は担当26ファイルの **private メソッド・private/protected getter・export されていないモジュール関数**。
（private コンストラクタ3件（`TypeMatchRule`・`ConditionNode`・`WeightSpec`）は「ヘルパー」ではないので数えていない。）

担当26ファイルのうち **ヘルパーを1つでも持つのは4ファイルだけ**で、残り22ファイルは0件。
つまり第1波が判定3に置いた大半は「private ヘルパー」ではなく public メンバであり、
本当の private ヘルパーはこの20件に尽きる。

## 集計

| ファイル | ヘルパー総数 | 主語は自分 | 主語は他（B） |
|---|---|---|---|
| src/domain/GeneratedTypes.ts | 1 | 0 | 1 |
| src/domain/PropertyDef.ts | 4 | 0 | 4 |
| src/domain/ConditionNode.ts | 7 | 1 | 6 |
| src/domain/PassiveEffect.ts | 7 | 5 | 2 |
| src/domain/PickEffect.ts | 1 | 0 | 1 |
| 他21ファイル | 0 | 0 | 0 |
| **合計** | **20** | **6** | **14** |

「主語は自分」6件の内訳: `ConditionNode.evaluateProperty`（自分の op/values/valueRef で比較する）、
`PropertyPassiveEffect.reading`（自分の4フィールドの投影）、`PassiveEffect.reversible`（abstract 1＋実装2。
自分が可逆かを名乗るだけ）、`PropertyPassiveEffect.registerResolvedRelation`（`this.target` と relation の
一致を見る番人。矛盾した組を外から渡させないための非公開なので、ここに居るのが正しい）。

**domain-def のヘルパーは5件すべてが主語=他。** 自クラスの状態について答えているものが1つも無い。

## 主語が他にあるヘルパー

| 現在地 | ヘルパー | 主語(B) | Bに足りない機能 | Bへ足せば消えるか | 阻害要因 |
|---|---|---|---|---|---|
| src/domain/ConditionNode.ts#ConditionNode L264 | `resolvePropertyOwner(root, propertyGlobalId, resolveRoot)` | `ReferenceRoot`（`resolveReferenceRoot`）| `resolveReferenceRoot` が `'ancestor'` を扱わず、各利用側に `findAncestorWithProperty` の併用を押し付けている（doc に明記） | 消える。`WorldObject.resolveEffectTargetOrAncestor` が**同一の本体を既に持っている** | `evaluate` が `WorldObject` ではなく `(root) => WorldObject \| undefined` のクロージャを受け取る。このクロージャ型は ancestor 解決に要る propertyGlobalId を運べないので、`self` を引いてから自分で遡るしかない |
| src/domain/ConditionNode.ts#ConditionNode L253 | `resolvePropertyEffectiveValue(root, propertyGlobalId, resolveRoot)` | `PropertyPath` | `PropertyPath` は `root`＋`propertyGlobalId` の2フィールドだけのデータクラスで、「解決して実効値を読む」口を持たない | 消える（`path.resolveValue(...)`） | property 葉が `PropertyPath` として持たれていない。同じクラスの `valueRef` は `PropertyPath` 型なのに、葉自身の root/propertyGlobalId は別々の optional フィールドに分解されている——**同じ概念が片方だけ型になっている** |
| src/domain/ConditionNode.ts#ConditionNode L245 | `evaluatePropertyStage(resolveRoot)` | `WorldObject` / `PropertyValue` | `owner.tryGetProperty(id)?.isInStage(name) ?? false` の2段の optional 連鎖。「そのプロパティを持っていなければ偽」を呼び手が畳んでいる | 半分消える。解決の1段は消えるが、既定値の決定は残る | 「持っていない＝偽」は条件式側の規約（他の葉と揃える、と doc にある）。B に持たせると呼び手ごとに違う既定（`?? 0` / `?? false` / 何もしない）が要る＝**B が複数の呼び手で違う答えを返す必要がある** |
| src/domain/ConditionNode.ts#ConditionNode L274 | `evaluateSlotPosition(resolveRoot)` | `WorldObject` | 「今このスロットに入っているか」が無く、`target.parentSlot?.def.globalId` と3段辿って比べている | 消える（`WorldObject.isInSlot(slotGlobalId)`） | なし。純粋な機能不足 |
| src/domain/ConditionNode.ts#ConditionNode L279 | `evaluateSlotContent(resolveRoot)` | `Slot` | 「この指定に当たる中身が1つでもあるか」が無く、`slot.contents` を外へ出して呼び手が `.some` を掛けている | 消える（`Slot.containsMatching(rule)`） | なし。ただし `TypeMatchRule.matches` が `ObjectDef` を取るため `child.def` の1段が `Slot` 側へ移るだけになる（下の `WorldObject.matches` と併せて解消） |
| src/domain/ConditionNode.ts#ConditionNode L285 | `evaluateObjectMatches(resolveRoot)` | `WorldObject` / `TypeMatchRule` | `WorldObject` が「この指定に当たるか」を答えられず、呼び手が必ず `.def` を開ける | 消える（`WorldObject.matches(rule)`） | なし |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect L242 | `unregister(targetOwner, declarer)` | `WorldObject` / `PropertyValue` | `targetOwner?.tryGetProperty(id)?.unregisterPassiveEffectsFrom(declarer)` の純粋な素通し。**自分のフィールドは `targetPropertyGlobalId` 1つしか触らない** | 消える（`WorldObject.unregisterPassiveEffectsFrom(propertyGlobalId, declarer)`） | なし |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect L229 | `register(targetOwner, declarer, slotBearer)` | `WorldObject` / `PropertyValue` | 同上（「そのプロパティを持っていれば渡す」の1段） | 半分消える。解決の1段は消え、`new RegisteredPassiveEffect(...)` の組み立てと `registerInto` の振り分けが残る | `registerInto` が modify/積分のどちらへ入れるかを決める**多態が A 側にある**（`ModifyEffect`/`AccumulateEffect`）。B からは呼べない。`unregister` にこれが無いので、対で見ると「B に足りないのは owner→property の1段だけ」と分かる |
| src/domain/PickEffect.ts#PickEffect L49 | `selectWeighted(owner, session, actor, dragged)` | `pickWeighted`（`src/domain/Rng.ts`） | 「候補が非空なら必ず1つ返す」版が無く、`undefined` の後始末を呼び手が書いている | 消えない。`?? this.candidates[0]` が残る | もう1人の呼び手 `src/domain/views/Animal.ts` L79 は `undefined` を「狙わない」として使う。**B が複数の呼び手で違う答えを返す必要がある**ので、全0時の既定は pick 側の規約として残るのが正しい |
| src/domain/PropertyDef.ts#PropertyDef L279 | `deriveAlertDirection(stages)` (static) | 段の並び（`readonly PropertyStage[]`） | 段の列に主が居ない。「eq の段は数値の並びに乗らない」「min の昇順に並べる」を各所が各自で書いている | `PropertyStage` に述語を足すだけでは消えない（単調性の走査は**列**の問い）。列を持つ `PropertyStages` を作れば消える | `stages` が裸の配列で public。読み手（`src/codex-viewer/describe/describeProperty.ts`）も配列を直接舐めている |
| src/domain/PropertyDef.ts#PropertyDef L414 | `stageBoundaries()` | 段の並び ＋ `PropertyRange` | 同上＋`PropertyRange` が `ratioOf` を持たない（第1波の判定4と同じ） | `PropertyStages` が range を同伴すれば消える | `range` が `undefined` になりうるため `ratioOf` を `PropertyRange` へ移せない（第1波で挙げた阻害要因と同一） |
| src/domain/PropertyDef.ts#PropertyDef L431 | `spanOf(stage)` | 段の並び ＋ `PropertyRange` | 「その段の上端＝より上で最も近い段の min」は**隣を知る**問いで、`PropertyStage` は隣を知らない | 同上、消える | 同上 |
| src/domain/PropertyDef.ts L474 | `defaultClampTo(range, propertyGlobalId, isMax)` | `PropertyRange`（＋`SetEffect`） | `PropertyRange` が `min`/`max` の生フィールドだけで、「isMax 側の端」を答えられない | 消えない。`range.endValue(isMax)` を足しても `new ActiveEffects([new SetEffect(...)])` の組み立てが残る | 残る部分は「**既定のクランプ**」という概念だが、名前を持つ場所が無い。`isExhausted` が `declaredOnMin` から同じ規則を裏返して再現しており、規則が2箇所に散っている |
| src/domain/GeneratedTypes.ts L77 | `keyOf(coordinate)` | `GeneratedCoordinate` | `interface` なので振る舞いを1つも持たず、自分の同一性（鍵）を答えられない。`tryResolve` が行う「軸を1つ動かす」も同じく座標の問い | 消える（`coordinate.key`） | なし。`coordinateOf` がその場でリテラルの座標を作っているだけで、class 化を阻むものは無い |

## 同じ B に対して複数の A が補っているもの

### B1: `PropertyPath` / `ReferenceRoot` — 「参照を解決する」

`resolveReferenceRoot` は doc で明示的に `'ancestor'` を扱わないと宣言し、
「各利用側が `findAncestorWithProperty` を併用する」と書いている。その結果、**同じ3行が5箇所にある**。

| A | 場所 |
|---|---|
| `ConditionNode.resolvePropertyOwner` + `resolvePropertyEffectiveValue` | src/domain/ConditionNode.ts L253-272（private） |
| `WeightSpec.resolve` | src/domain/PickEffect.ts L85-95 — `WorldObject.resolveEffectTargetOrAncestor` と**本体が完全に同一**（`self` を持っているので、そのまま呼べば消える） |
| `PropertyPassiveEffect.registerRelation` の ancestor 分岐 | src/domain/PassiveEffect.ts L191-200 |
| `PropertyDef.inheritedContribution` | src/domain/PropertyDef.ts L463-466（第1波の判定5） |
| `WorldObject.resolveEffectTargetOrAncestor` | src/domain/WorldObject.ts L833-843（担当外。**唯一の名前付き実装**） |

→ `PropertyPath` に `resolveOwner(self, actor, dragged)` / `resolveValue(...)` を足す（あるいは
`resolveReferenceRoot` を propertyGlobalId 込みの1本にする）と、担当範囲の4箇所が消える。
**優先度は最も高い。** `PropertyPath` は現在フィールド2つだけのデータクラスで、足す先が空いている。

### B2: `WorldObject` — 「解決してプロパティ値を取る」の2段

`owner.resolveEffectTargetOrAncestor(root, id, actor, dragged)` の直後に `?.tryGetProperty(id)` を書き、
**同じ `propertyGlobalId` を2回渡す**形が10箇所ある。

- `src/domain/ActiveEffect.ts` — 6箇所（`SetEffect.apply` L157、`AddEffect.applyScaled` L202、
  `TransferEffect.apply` L356/362、`TransferEffect.acceptedCount` L419/432）
- `src/domain/ConditionNode.ts` — 2箇所（`resolvePropertyEffectiveValue`・`evaluatePropertyStage`。private）
- `src/domain/PassiveEffect.ts` — 2箇所（`register`・`unregister`。private）

→ `WorldObject.tryResolveProperty(root, propertyGlobalId, actor, dragged): PropertyValue | undefined`
を1本足せば、10箇所すべてが1行になる。**解決できなかったときの既定（`?? 0` / `?? false` / 何もしない）は
呼び手ごとに違うので B には持たせない**——B が返すのは `PropertyValue | undefined` まで。

### B3: `PropertyStage` と「段の並び」

`PropertyStage` はフィールド5つのデータクラスで、述語を1つも持たない。そのため
「eq の段か」「min の段か」「フォールバック段か」の判定が6箇所に散っている。

- `src/domain/PropertyDef.ts` — 5箇所（構築子の `fallbackStage` 計算、`deriveAlertDirection`、
  `stageAt`、`stageBoundaries`、`spanOf`）
- `src/codex-viewer/describe/describeProperty.ts` L31（担当外。`def.stages` を直接舐める）

→ `PropertyStage.matches(value)` / `.isNumeric` / `.isFallback` を足すと各判定は消えるが、
「min の昇順に並べる」「隣の段を探す」は**列**の問いなので、range を同伴する `PropertyStages` を
作らないと `deriveAlertDirection`/`stageBoundaries`/`spanOf` は消えない。
第1波が `PropertyDef` の判定4として挙げた5件（`stageOnBarAt`・`ratioOf` ほか）と**同じ1つの欠落**である。

### B4: `WorldObject.matches(rule)` / `Slot.containsMatching(rule)`

`TypeMatchRule.matches` が `ObjectDef` を取るため、`WorldObject` を持つ側は必ず `.def` を1段開ける。

- `ConditionNode.evaluateObjectMatches`（private、担当内）
- `ConditionNode.evaluateSlotContent`（private、担当内。加えて `slot.contents` も外へ出させている）
- `CombinationDef.acceptsDragged` / `CombinationDef.execute`（担当内、public）

→ `WorldObject.matches(rule)` と `Slot.containsMatching(rule)` の2本で3箇所が消える。

## 補足: private ではないが同じ形のもの

上の問いを立てて読むと、**public でありながら実質は他クラスのヘルパー**という形が担当範囲に複数ある。
第1波が判定3〜4に置いたものと重なるが、「B の機能不足を A が補っている」という因果はこちらの方が明確。

| 現在地 | 名前 | 主語(B) | Bに足りない機能 |
|---|---|---|---|
| src/domain/ActiveEffect.ts#AddEffect | `applyScaled(...)` | `TransferEffect` | 唯一の呼び手は `TransferEffect.apply` の linked_add。**A（AddEffect）が B のために生やした口**で、向きが逆（B の不足を A が補うのではなく、B の都合で A が膨らんでいる） |
| src/domain/PassiveEffect.ts#PropertyPassiveEffect | `activeAmount(declarer, slotBearer)` | `RegisteredPassiveEffect` | 登録1件が「今いくら効いているか」を自力で答えられず、自分の2フィールドを def へ渡し直している（`RegisteredPassiveEffect.activeAmount()` が完全な素通し） |
| src/domain/WorldCodex.ts#WorldCodex | `singletonGlobalIds()`, `objectDefNamesWithTag()` | `ObjectDefTable` | 全型走査の口が `ObjectDefTable` に無いため、Codex が `this.objects` を舐めている |
| src/domain/PickEffect.ts#WeightSpec | `resolve(self, actor, dragged)` | `WorldObject` | B1 と同じ。`self.resolveEffectTargetOrAncestor(...)` をそのまま呼べる位置にありながら、本体を書き直している |

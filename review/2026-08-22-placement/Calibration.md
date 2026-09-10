# 較正（判定4・5の再判定）

## 裏付けが取れたもの

| 指摘 | 確認内容 |
|---|---|
| `PropertyDef.declaredOnMax` (判定5) | L166宣言・L259代入のみ。`src` `tests` `scripts` のどこからも読まれない |
| `PropertyDef.inheritedContribution` (判定5) | `PropertyValue.ts:130` が `this.def.inheritedContribution(this.owner)` と自分の owner を渡し返す。読むのは public な `inherit`/`globalId` のみ＝Def に置く理由なし |
| `WeightSpec` (判定5) | `SlotDef.putInDuration`・`ActionDef`/`InteractionDef`/`CombinationDef.duration` が使用。pick 専用ではない |
| `Rng.ts → generation/Pcg32.ts` (判定5) | `Rng` は9ファイルから使われる汎用。`Pcg32` は `src/save/SaveData.ts` からも使われ、生成配下に居る理由なし |
| `Button` の CodeStructure.md 反例 | `SLOT_BUTTON_PAPER_TEXTURE` は Button.ts のモジュール定数。`Button` クラスは未参照（読むのは BootScene と PlayScene）。**ドキュメントの例が実装とずれている** |
| `RawObjectDef` / `RawTrait` 二重化 | 共通フィールド11個を確認（name, source, tags, props, slots, passives, stackOrder, visibleSlots, artByStage, actions, combinations）。`RawTrait.readFields` のコメント自身が「RawObjectDef.readFieldsと対」と書いている |
| `Slot.tryInsertAtGap` / `tryInsertAtCell` / `tryMoveStackToGap`, `PropertyValue.changePerTick` (判定5) | `src` `tests` ともに参照ゼロ。完全な死んだ public |

## 判定を変更するもの

| 指摘 | 担当の判定 | 親の判定 | 理由 |
|---|---|---|---|
| `PropertyValue.incoming` | 5 | **4** | 「プロダクション利用ゼロ」は正しいが、`tests/domain/passiveEffect.test.ts:477` が明示的にこの getter を試験している。**テスト可能性を守るために公開されている**＝判定4の定義そのもの。しかも `RegisteredPassiveEffect` が「PropertyValue.incoming のため公開する」と2段目の露出を招いており、テスト1本のために公開が2段連鎖している点が指摘の核 |
| `Slot.hasFixedCells` | 5 | 5（理由を修正） | 「呼び出し元が無い」は不正確。`Slot.ts` 内部で12箇所使われている。**外部に呼び出し元が無い public getter** ＝可視性の指摘であって、未使用ではない |

## 件数の比較可能性についての注意

判定4の件数は担当間で直接比較できない。`loader` の43件は、うち24件が
`RawObjectDef`/`RawTrait` の二重化という**単一の原因**を宣言ごとに数えた結果。
`domain-state` の29件も16件が `WorldSession` の観測口という単一原因。
集計表では「件数」と「原因の数」を分けて示すこと。

# スロットシステム設計

## 概要

スロット（親子関係とコンテナ、[`GameElementDefinition.md`](./GameElementDefinition.md) 7節）が
実行時にどう実装されているかを記述する設計ドキュメントです。定義は `Domain.Defs.SlotDef`、
実行時状態は `Domain.Runtime.Slot` と `Domain.Runtime.ObjectStack`。重さの伝播は
[`ContainerSystem.md`](./ContainerSystem.md)、`represented_by` を使う代表例は
[`LiquidContainerSystem.md`](./LiquidContainerSystem.md) を参照してください。

## 1. データ構造: セルの並びとスタックの2階層

スロットの中身は「**セルの並び**」として持つ（`Slot.cells`）。

- セル = 1つの `ObjectStack`（同種のまとまり）か、空（null）。**位置 = セルの添字**。
- `ObjectStack` = 見た目上1単位として積み重なる同種インスタンスのリスト（7.6節）。
- 親子関係の正の情報源は親側のスロット配列で、子側の `WorldObject.Parent` は逆引きキャッシュ（7.1節）。

出入りは唯一の汎用操作 `move_to_slot`（`WorldObject.MoveToSlot` → `AttachToSlot`）経由のみ。
親子整合・weight 伝播・passive エッジの登録・代表チェーン再判定という副作用を1箇所に集約する。
`force: true`（spawn の強制配置フォールバック専用、9.4節）は受け入れ検証だけを飛ばす。

## 2. 受け入れ判定: 3つの独立した制約

`Slot.CanAccept` は次の3つを順に検証する。いずれも定義が無ければ無制限。

| 制約 | 単位 | 意味 |
| --- | --- | --- |
| `accepts`（7.2節） | ルールごとの個数 | 型の制約。各ルールは `tag`（タグ保持）か `object`（型そのもの）でマッチし、そのルールにマッチする在中個数が `max` 未満なら受け入れ |
| `capacity`（7.3節） | `size` の合計 | 中身の `size` プロパティ合計 + 候補の `size` が上限以下 |
| `unit_capacity` | 単位数 | セルを占める「単位」の数。単位の意味は `stackable` に従う（4節）。既存スタックへ合流できる場合は新しい枠を消費しない |

## 3. 固定位置スロットと前詰めスロット（fixed_positions）

両者の違いは「**空になったセルを残すか、詰めるか**」の1点だけで、他のロジックは共通。

- **`fixed_positions: true`**（例: プレイヤー手持ちの6枠）: セル配列は常に `unit_capacity` 長で、
  空セルを null として保持する。位置（固定番号）が安定し、プレイヤーによる手動配置ができる。
  - `Slot.TrySetManualPosition`: 指定した番号のセルとの単純 swap（並び替え）。
  - `Slot.TryInsertAtGap`: セルとセルの**隙間**へ入れる（カードを隙間へドラッグ＆ドロップしたとき）。
    まず右方向へ、それが無理なら左方向へ既存のセルをずらして場所を作る。合流できる既存スタックが
    あるときは、指定された位置より「同種は1スタック」（4〜5節）を優先してそちらへ入れる。
- **非 fixed_positions**: 空になったセルは削除して前詰めする（null を含まない）。

`same_slot` spawn の置き換え配置（元の位置の引き継ぎ・「隣に生まれる」・押し出し）は 7.6節の
規定どおり `Slot.PlaceSameSlot` が実装する。置き換え位置の基準（元のセル・同種が残っているか）は
効果適用の入口で捕捉した `EffectSite` から渡される（`ActionSystem.md` 5節）。

## 4. スタック可否（stackable）

- **`stackable: true`**（既定）: 同一性（5節）が一致する既存スタックへ合流する。
  `unit_capacity` の「単位」は種類数（= スタック数）。
- **`stackable: false`**（例: かまどの投入口）: 同種でも常に個体ごとに別スタック。
  「単位」は個体数そのものになり、同じ燃料を2つ入れると2枠消費する。

## 5. スタックの同一性: 容器の中身まで見る

同じスタックにまとまる条件は「外側の `ObjectDef` が同じ」だけではない。`ObjectStack` は生成時に、
seed の**代表チェーン**（自分の `ObjectDef` を先頭に、`represented_by` で辿った代表、さらにその
代表…の `ObjectDef` 列）をスナップショットし（`WorldObject.CaptureRepresentationChain`）、
合流判定（`Matches`）はこの列の**完全一致**を要求する。これにより、水入り水筒と茶入り水筒は
外側が同じ `canteen` でも別スタックになる。

- チェーンは生成後不変。中身が入れ替わって列に合致しなくなったとき動くのは**メンバーの側**:
  `move_to_slot` が代表スロットの出入りを検知して `OnRepresentationChanged` を呼び、所属スタックの
  `Restack`（抜いて入れ直し）で「同種は1スタックにまとまる」不変条件を回復する。親方向への伝播は
  `represented_by` のネスト分だけで有界。
- 「同種のみが積み重なる」は `ObjectStack.TryInsert` 自身が保証し、呼び出し側の事前確認に
  依存しない。
- セルの位置を型（`ObjectDef`）で引くことはしない: 代表チェーンが絡むと同じ外側の型でも複数
  スタックが並びうるため、位置は常に具体的な `ObjectStack` で特定する（`Slot.IndexOfStack`）。

## 6. スタック内の並び順（stack_order）

型ごとの表示専用の並び順（`Domain.Defs.StackOrderDef`、7.6節）。指定プロパティの値で、新規
メンバーの**挿入位置を決めるだけ**で、挿入後の値の変化に追従した再ソートは行わない
（`accumulate` は同種で同じ速度で変化するため、挿入時点の相対順序が保たれる前提）。
同値は既存メンバーの後ろ（挿入順維持）。`ascending` は「値が大きいほどリストの後ろ = 手前」で、
残量・鮮度のような「少ないほど手前に出したい」値は `ascending: false` にする。

## 7. 未決事項・今後の検討課題

- `set` など accumulate 以外の値の変化で「同種は同じ速度で変化する」前提が崩れた場合も再ソート
  しない、という割り切りのままでよいか
- `Restack` で入れ直されたスタックは元のセル位置を保たない（最初の空きセル/末尾へ入る）。
  中身の入れ替わった容器の表示位置を保持する必要があるか
- 手動並び替え（`fixed_positions`）と `stack_order` の関係（並び替え対象はスタック単位であり
  スタック内はstack_order順のまま、が現状の挙動）

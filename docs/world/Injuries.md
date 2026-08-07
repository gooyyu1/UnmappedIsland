# 怪我

キャラクタが負う傷。1つの怪我＝1つの `object_def` で、`public/world-codex/injuries.yaml` に置く。

怪我は `injury` タグを持ち、キャラクタの `injuries` スロットにしか入らない
（[`Characters.md`](./Characters.md)）。プレイヤーは自分では出し入れできず、付けるのはワールド側の効果
（アクションの `pick` の失敗候補など）、外すのは怪我自身である。

## 契約

| | 内容 |
| --- | --- |
| タグ | `injury`（`item` は付けない——手持ちへ入ってしまう） |
| プロパティ | `durability`（`range.min` は 1、`on_shortfall` に `destroy: self`） |
| `passives` | `modify` で `parent`（負ったキャラクタ）の `pain` を上げる |
| 表示 | `ja.yaml` の表示名と説明 |

## 値の決め方

- **`durability` は「治りきるまでの残り」**。上限は素材と同じ 960,000 に揃え、減り方で治るまでの
  日数を表す（[`DurabilitySystem.md`](../engine/DurabilitySystem.md) 1節。`-10,000/tick` で1日、
  `-1,000/tick` で10日）。治癒度が100%で治る形にしないのは、悪化・再受傷を後から足すときに、
  「残っている傷」の方が素直に増減できるため。
- **`pain` の量**は、`player_character` の `max`（100）に対する割合で決める。同じ怪我を2つ負えば
  2つぶんの `modify` が単純加算される（[`GameElementDefinition.md`](../engine/GameElementDefinition.md)
  8.3節）ので、1つで危険域に届く量は重い怪我のために取っておく。

`item` タグを付けないので `weight` は持たない（怪我は荷重にならない）。

## 今後の検討課題

- 行動力（`stamina`）の消費増加・移動の制限といった、痛み以外の影響
- 手当て（`medic` の心得を活かす治療。今は時間だけが治す）
- 悪化（放置した怪我が別の怪我へ変わる）

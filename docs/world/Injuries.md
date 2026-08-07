# 怪我

キャラクタが負う傷。1つの怪我＝1つの `object_def` で、`public/world-codex/injuries.yaml` に置く。

怪我は `injury` タグを持ち、キャラクタの `injuries` スロットにしか入らない
（[`Characters.md`](./Characters.md)）。プレイヤーは自分では出し入れできず、付けるのはワールド側の効果
（アクションの `pick` の失敗候補など）、外すのは怪我自身である。

## 契約

| | 内容 |
| --- | --- |
| タグ | `injury`（`item` は付けない——手持ちへ入ってしまう） |
| プロパティ | `severity`（`range.min` は 1、`stages` を持ち、`on_shortfall` に `destroy: self`） |
| `passives` | `modify` で `parent`（負ったキャラクタ）の `pain` を上げる |
| 表示 | `ja.yaml` の表示名と説明 |

## 値の決め方

- **`severity`（傷の重さ）は「残っている傷」**。道具の `durability` は使わない——耐久値は多いほど
  良い量で、傷は多いほど悪い量なので、同じ語彙に載せると残量の読み方が裏返る。治癒度が100%で治る
  形にしないのは、悪化・再受傷を後から足すときに「残っている傷」の方が素直に増減できるため。
- **減り方が自然治癒の速さ**で、これを基準レートに置く（`-100/tick`）。`max` はそのまま「その速さで
  何 tick かかるか」を表す（[`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.0節の
  量のクラス。捻挫は 96,000 = 960 tick = 10日）。
- **`stages` は怪我カードのバーの色になる**（[`ScreenLayout.md`](../ui/ScreenLayout.md) カードの状態バー
  節）。怪我ごとに絶対値で刻むので、軽い怪我は負った直後でも危険域に入らない。危険域は骨折のような
  重い怪我のために空けておく。
- **`pain` の量**は、`player_character` の `max`（100）に対する割合で決める。同じ怪我を2つ負えば
  2つぶんの `modify` が単純加算される（同 8.3節）ので、1つで危険域に届く量は重い怪我のために取っておく。

`item` タグを付けないので `weight` は持たない（怪我は荷重にならない）。

## 今後の検討課題

- 行動力（`stamina`）の消費増加・移動の制限といった、痛み以外の影響
- 手当て（`medic` の心得を活かす治療。今は時間だけが治す）。包帯を巻いた絵のレシピ
  （`tools/comfyui/recipes/sprained_ankle_bandaged.json`）は用意してあるので、手当済みの
  `object_def` を足す段になったら `build.py` に渡せばよい。PNGを先に置かないのは、
  `object_def` の無い絵をリポジトリに残さないため（`tests/game/objectArt.test.ts`）
- 悪化（放置した怪我が別の怪我へ変わる）

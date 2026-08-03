# プレイヤーキャラクタ

新規ゲーム作成時に選ぶ主人公。1キャラクタ＝1つの `object_def` で、`public/world-codex/characters/` に
1ファイルずつ置く（共通の骨組みだけが `player_character` trait）。

`character` タグはプレイヤーが操作するキャラクタだけに付く。操作できない生物は、持ち運べるなら
アイテム（`item`）、持ち運べないなら設置物（`fixture`）で表す。したがって「選べるキャラクタの一覧」は
`character` タグを引くだけで得られる（`WorldCodex.objectDefNamesWithTag`）。

## 定義を分けたうえで齟齬を防ぐ方法

キャラクタごとに数値は違ってよいが、**あるキャラクタだけ満腹度の定義が無い**、**最大値だけ変えて
`stages` を直し忘れた**といった食い違いは許容できない。これを防ぐのは trait ではなくテスト
（`tests/worldCodex/charactersYaml.test.ts`）である。

trait は「何を持つべきか」ではなく「省略したらこの値」しか表現できない。`props` のマージはフィールド
単位の上書き（`RawObjectDef.resolve`）なので、trait に既定値を置くと「`range.max` だけ上書きして
`stages` は trait のまま」が素通りする。`stages` のしきい値は `max` から導いた値なので、この瞬間に
下記の不変条件が壊れるうえ、キャラクタのファイルを読んでも `stages` が見えないため気づけない。

そこでテストは `character` タグを持つ全 `object_def` を走査する。キャラクタを1つ足せば自動的に検査
対象になり、登録漏れが起きない。

## 契約

### 持たなければならないもの

| | 内容 |
| --- | --- |
| `singleton` | `true`（同時に存在するプレイヤーキャラクタは1体） |
| タグ | `character` |
| スロット | `hand`（`fixed_positions`・`item` を受け入れる・4〜8枠）、`equipment`、`injuries` |
| プロパティ | `satiety` / `hydration` / `body_fat` / `wakefulness` / `stamina` / `load` / `vegetable_nutrition` / `meat_nutrition` / `grain_tuber_nutrition` |
| 表示 | `ja.yaml` の表示名、代替アイコン（`characterArt.ts`。絵が入るまでの繋ぎ） |

`status` タグが付くのは `satiety` / `hydration` / `wakefulness` / `stamina` / `load` の5つで、宣言順もこの順に
揃える（`readPropertiesWithTag` の戻り順がそのままステータスエリアの並びになる、
[`ScreenLayout.md`](../ui/ScreenLayout.md) ステータスエリア節）。

### 値の刻み方（キャラクタ間で共通の規約）

数値のスケールは [`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.0節に従い、
`range.min` は常に0。1 tick = 15分、1時間 = 4 tick。

- **`satiety`（満腹度）**: 満腹から空になるまでの時間を `-100/tick` で表す（`max` = tick数 × 100）。
  0でも即死せず体調不良につながる想定（未実装。餓死は `body_fat` が受け持つため致命的域は持たない）。
- **`hydration`（水分）**: 値は液体と同じ実単位の mL（[`LiquidContainerSystem.md`](../engine/LiquidContainerSystem.md) 5節）で、
  1日の必要量2400mLを96 tickで割った **`-25/tick` 固定**。ここだけは個体差を持たせない——キャラクタが
  違っても、飲んだ水1mLの意味が変わってはならないため。持ちの差は `max`（＝携える水の量）で表す。
  脱水はそのまま死に至るため、致命的域（`fatal`）を持つ唯一のステータス。
  `min: max` の段 **`full`**（満水ちょうど）を持ち、名前を固定する——液体の `drink` がこの名前で
  「もう飲めない」を見る（[`LiquidContainerSystem.md`](../engine/LiquidContainerSystem.md) 5節）。
- **`body_fat`（体脂肪）**: 尽きると餓死する致死的パラメータ（餓死の実処理は未実装）。`-100/tick` で、
  `max` は「最大限に肥満した状態」から絶食で保つ日数、初期値はその1/4（標準体格）。
- **`wakefulness`（覚醒度）**: 0で強制的に眠りに入る想定（未実装。致死性は無い）。`-100/tick`。
- **`stamina`（体力）**: 疲労の逆で、tickでは減らない。
- **`load`（荷重）**: 持ち物と装備の重さ（g）。自分では動かず、中身から導出される
  （[`ContainerSystem.md`](../engine/ContainerSystem.md) 2節）ので `value` は 0 のまま。`max` が
  「担げる量」そのもので、担ぎ慣れの個人差はここに出る。
- **栄養バランス**（`vegetable_nutrition` ほか2つ）: 食の好みではなく身体の仕組みなので個体差を
  持たせず、`player_character` trait が配る。

### 域の区分（`stages` の不変条件）

[`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.4節の `alert`。`max` が違っても
プレイヤーの読み取り方が変わらないよう、しきい値は次の形で揃える。

- **安全域から外れるのは `max` の80%**（＝ステータスエリアに出始める位置）。この境界だけは
  全ステータス・全キャラクタで共通でなければ「まだ大丈夫」の感覚が崩れる。
- **`satiety` / `hydration` の初期値は `max` の75%**（安全域のやや下）。満タンで始めると alert が
  `safe` でステータスバーに出ず（[`ScreenLayout.md`](../ui/ScreenLayout.md) ステータスエリア節）、
  飲食の操作も最初は試せないため。tickで減らない `stamina` と、序盤に眠らせたくない `wakefulness` は
  満タンで始める。
- tickで減るもの（`satiety` / `wakefulness`）は、80%より下を**残り時間**で切る:
  残り12時間未満で `caution`、残り3時間未満で `danger`。
- `hydration` も残り時間で切る: 残り2日未満で `caution`、残り1日未満で `danger`、
  残り6時間未満で `fatal`。
- tickで減らない `stamina` は割合で切る: `max` の60%未満で `caution`、20%未満で `danger`。
- **`load` だけは増える側が悪い**ので、上の「80%で安全域を外れる」は当てはまらない。`max` からの割合で
  刻む: 1/4 で `watch`、1/2 で `caution`、5/6 で `danger`。空身から始まって荷造りの最中に現れるよう、
  最初の境目は低めに置く。危険域の段の名前は **`too_heavy`** で固定する——道の `travel` がこの名前で
  移動可否を見る（[`ContainerSystem.md`](../engine/ContainerSystem.md) 5節）。

## 選択とセーブ

`SaveData.characterId` は選ばれた `object_def` の識別子そのもの。読み込み時に未知の識別子だった場合
（識別子の改名・旧セーブ）は先頭のキャラクタで代替して開ける（`resolveCharacterDefName`）。

キャラクタの絵は `src/assets/objects/<識別子>.png` に置けば、コード側の登録なしにカードとポートレイトへ
出る（`objectArt.ts`）。用意されるまでは代替の絵文字を出す。

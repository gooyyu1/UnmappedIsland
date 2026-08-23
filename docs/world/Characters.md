# プレイヤーキャラクタ

新規ゲーム作成時に選ぶ主人公。1キャラクタ＝1つの `object_def` で、`src/assets/world-codex/characters/` に
1ファイルずつ置く（共通の骨組みだけが `player_character` trait）。

`character` タグはプレイヤーが操作するキャラクタだけに付く。操作できない生物は、持ち運べるなら
アイテム（`item`）、持ち運べないなら設置物（`fixture`）で表す。したがって「選べるキャラクタの一覧」は
`character` タグを引くだけで得られる（`WorldCodex.objectDefNamesWithTag`）。

## 定義を分けたうえで齟齬を防ぐ方法

キャラクタごとに数値は違ってよいが、**あるキャラクタだけ満腹度の定義が無い**、**最大値だけ変えて
`stages` を直し忘れた**といった食い違いは許容できない。これを防ぐのは trait ではなくテスト
（`tests/world-codex/charactersYaml.test.ts`）である。

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
| スロット | `hand`（`item` を受け入れる枠が4〜8個）、`equipment`、`injuries` |
| プロパティ | `weight` / `pain` / `blood` / `satiety` / `carbohydrate` / `protein` / `lipid` / `vitamin` / `hydration` / `body_fat` / `wakefulness` / `stamina` / `load` |
| アクション | 休息の4つ（`wait` / `rest` / `nap` / `sleep`。下の[休息](#休息)節。`player_character` trait が配る） |
| 表示 | `ja.yaml` の表示名、代替アイコン（`characterCard.ts`。絵が入るまでの繋ぎ） |

`status` タグが付くのは `pain` / `blood` / `satiety` / `hydration` / `wakefulness` / `stamina` / `load` の7つで、
宣言順もこの順に揃える（`propertiesWithTag` の戻り順がそのままステータスエリアの並びになる、
[`StatusArea.md`](../ui/StatusArea.md)）。先頭の3つが trait 由来なのは、trait の props がキャラクタ自身の
props より前に並ぶため（`RawObjectDef.resolve`）。**栄養素の在庫（`carbohydrate` ほか3つ）は `status` を
持たない**——常に見せるのは腹が満ちているかどうかだけで、在庫は開いて見るもの
（[`DigestionSystem.md`](../engine/DigestionSystem.md) 3 節）。

気絶を決める `consciousness` は、`pain` と同じくキャラクタ間で共通の値としてここへ加わる予定である
（押し下げる側は [`VitalsSystem.md`](../engine/VitalsSystem.md) 2 節。気を失った手番の飛ばし方が
決まっていないため、まだ実装しておらず上の契約にも含めない）。

### 値の刻み方（キャラクタ間で共通の規約）

数値のスケールは [`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.0節に従い、
`range.min` は常に0。1 tick = 15分、1時間 = 4 tick。

**尽きると死ぬのは `hydration` / `body_fat` / `blood` の3つ**（[`VitalsSystem.md`](../engine/VitalsSystem.md) 8 節）。
いずれも `range.min`（＝0）へ達した時点で `on_min` が自分を `destroy` する、同じ形で書く。既定の
クランプを置き換えるので**尽きた値は範囲の外に残り**、消えたあとでも「何が尽きたか」を段から読める
（`WorldObject.exhaustedStage`）。**死因の名前になるのは、その値が居る段**（`dehydrated` / `starved` /
`exsanguinated`）で、画面はその段の文言を出すだけ。

- **`satiety`（満腹感）**: **単位は mL**——胃に入っている物のかさで、エネルギーではない
  （[`DigestionSystem.md`](../engine/DigestionSystem.md) 2 節）。`max` が胃の容量なので、下の
  「安全域を外れるのは `max` の80%」も「初期値は75%」も当てはまらない。`max` の6割に置いた段
  **`full`** を `eat` が読んで「もう食べられない」を見る。餓死は `body_fat` が受け持つため
  致命的域は持たない。個体差は無く `player_character` trait が配る。
- **栄養素の在庫**（`carbohydrate` / `protein` / `lipid`）: **単位は tick**（体脂肪と同じ物差し）。
  在庫がある間は `body_fat` へ流れ続け、速さは栄養素ごとに違う（同 3 節）。個体差は持たず trait が配る。
- **`vitamin`（ビタミン）**: **単位は mg**（ビタミンC相当）。エネルギーにならないので在庫の3本とは
  物差しが違う（同 4 節）。同じく trait が配る。
- **`hydration`（水分）**: `-1/tick` 固定で、`max` が「満水から何 tick 保つか」。**減り方に個体差を
  持たせない**——キャラクタが違っても、飲んだ水1mLの意味が変わってはならないため。持ちの差は
  `max`（＝体が抱える水の量）で表す。液体の mL からの換算は飲用側の宣言が持つ（`transfer` の
  `to_amount`、[`LiquidContainerSystem.md`](../engine/LiquidContainerSystem.md) 5節）。
  脱水はそのまま死に至るため、致命的域（`fatal`）を持つ唯一のステータス。尽きた段の名前は
  **`dehydrated`**。
  `min: max` の段 **`full`**（満水ちょうど）を持ち、名前を固定する——液体の `drink` がこの名前で
  「もう飲めない」を見る（[`LiquidContainerSystem.md`](../engine/LiquidContainerSystem.md) 5節）。
- **`body_fat`（体脂肪）**: 腸から吸収した分が積み上がり、尽きると餓死する。`max` は「最大限に肥満した
  状態」から絶食で保つ tick 数、初期値はその1/4（標準体格）。**減る速さは自分の段で決まり**（太っている
  ほど速い）、これが食べ過ぎても際限なく太らない平衡点になる。尽きる域の名前が **`starved`**。
  1日に要る量の個体差（標準体格で `nourished` 段のレート）はここに出る
  （[`DigestionSystem.md`](../engine/DigestionSystem.md) 4 節）。`status` タグを持たないため
  ステータスエリアには出ない——画面に見える飢えの兆しは満腹感が受け持つ。
- **`wakefulness`（覚醒度）**: 0で強制的に眠りに入る想定（未実装。致死性は無い）。`-1/tick`。
  戻すのは眠る休息（仮眠・睡眠）だけ（[休息](#休息)節）。**`max` は「満タンから、意識を保てなくなって
  眠り込むまでの時間」**で、普通の人間の48時間（192 tick）を基準に置く。外から起こし続ける実験の記録
  （数日〜十日）は採らない——あれは自力で起きていられる長さではないため。眠らずにいられる長さの
  個人差はここに出る。
- **`stamina`（体力）**: 疲労の逆で、tickでは減らない。戻すのは休息だけ（同節）。
- **`pain`（痛み）**: 負っている怪我（[`InjurySystem.md`](../engine/InjurySystem.md)）が `modify` で押し上げる値。自分では
  動かないので `value` は 0 のまま、`max` は「これ以上は耐えられない」点。痛みの感じ方は食の好みではなく
  身体の仕組みなので、栄養バランスと同じく個体差を持たせず `player_character` trait が配る。
- **`weight`（体重、g）**: 65,000（下の `blood` が体重のおよそ1/13という関係から、5,000mLがちょうど
  65kg）。**担ぐ側も担がれる側になる**——筏に乗れば自分と手持ちが積載として効く
  （[`ContainerSystem.md`](../engine/ContainerSystem.md) 1.1 節）。個体差はまだ持たせず trait が配る。
- **`blood`（血液量、mL）**: `max` が体格そのもの（体重のおよそ1/13）で、満タンから始まる。**唯一、
  自分で戻るステータス**（`+2/tick` ＝ 1日およそ200mL、赤血球が作られる実際の速さ）。削るのは出血する
  怪我だけなので、**削られるのは一瞬でも戻るのは桁違いに遅い**——失った1,000mLに5日かかる。尽きた段の
  名前は **`exsanguinated`**。刻み方は [`VitalsSystem.md`](../engine/VitalsSystem.md) 3 節、これも個体差を
  持たせず trait が配る。
- **`load`（荷重）**: 持ち物と装備の重さ（g）。自分では動かず、中身から導出される
  （[`ContainerSystem.md`](../engine/ContainerSystem.md) 2節）ので `value` は 0 のまま。`max` が
  「担げる量」そのもので、担ぎ慣れの個人差はここに出る。


### 域の区分（`stages` の不変条件）

[`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.4節の `alert`。`max` が違っても
プレイヤーの読み取り方が変わらないよう、しきい値は次の形で揃える。

- **安全域から外れるのは `max` の80%**（＝ステータスエリアに出始める位置）。この境界だけは
  全ステータス・全キャラクタで共通でなければ「まだ大丈夫」の感覚が崩れる。端数は丸める——段のしきい値は
  人が読む数字なので、小数が書けても整数に留める。
- **`hydration` の初期値は `max` の75%**（安全域のやや下）。満腹感も同じ狙いで留意域（300mL）から
  始める（[`DigestionSystem.md`](../engine/DigestionSystem.md) 2 節）。満タンで始めると alert が
  `safe` でステータスバーに出ず（[`StatusArea.md`](../ui/StatusArea.md)）、
  飲食の操作も最初は試せないため。tickで減らない `stamina` と、序盤に眠らせたくない `wakefulness` は
  満タンで始める。
- tickで減るもの（`wakefulness`）は、80%より下を**残り時間**で切る:
  残り12時間未満で `caution`、残り3時間未満で `danger`。
- `hydration` も残り時間で切る: 残り2日未満で `caution`、残り1日未満で `danger`、
  残り6時間未満で `fatal`。
- tickで減らない `stamina` は割合で切る: `max` の60%未満で `caution`、20%未満で `danger`。
- `blood` は**失った割合**で切る（臨床の出血性ショックの分類、
  [`VitalsSystem.md`](../engine/VitalsSystem.md) 3 節）。2割失って安全域を外れるので、上の80%の境界と
  ちょうど一致する。以降 3割で `caution`、4割で `danger`、6割で `fatal`。
- **`load` と `pain` は増える側が悪い**ので、上の「80%で安全域を外れる」は当てはまらない。`max` からの
  割合で刻む: 1/4 で `watch`、1/2 で `caution`、5/6 で `danger`。0 から始まって荷造り・怪我の最中に
  現れるよう、最初の境目は低めに置く。`load` の危険域の段の名前は **`too_heavy`** で固定する——道の
  `travel` がこの名前で移動可否を見る（[`ContainerSystem.md`](../engine/ContainerSystem.md) 5節）。

## 休息

**時間を進める操作は、キャラクタ自身のアクションです。** 4つとも同じ形（`duration` と `add` だけ）で
`player_character` trait に並び、[`ActionSystem.md`](../engine/ActionSystem.md) 2 節の実行パイプラインを
そのまま通ります。**違うのは長さと回復量だけ**で、眠るものだけが `wakefulness` も戻します。
時間を進める専用の仕組みは持ちません。

入口は日時のフリップカードで、押すとキャラクタ自身の子ウィンドウが開きます
（[`Windows.md`](../ui/Windows.md) 4 節）。

| | 長さ | `stamina` | 1時間あたり | `wakefulness` | 1時間あたり | 眠気の実質 |
| --- | --- | --- | --- | --- | --- | --- |
| `wait`（待機） | 15分 | +2 | 8 | — | — | −1 |
| `rest`（休憩） | 60分 | +10 | 10 | — | — | −4 |
| `nap`（仮眠） | 180分 | +36 | 12 | +36 | 12 | **+24**（6時間ぶん） |
| `sleep`（睡眠） | 360分 | +90 | 15 | +96 | 16 | **+72**（18時間ぶん） |

- **まとめて休むほど1時間あたりの回復が大きい。** 同じ6時間でも、仮眠2回（体力72・眠気の実質48）より
  睡眠1回（90・72）のほうが多く戻ります。細切れに休むより通しで休むほうが得、が数値だけで出ます。
- **眠っている間も覚醒度は減り続けます**（`-1/tick`）。上の表の「実質」は経過ぶんを引いた値です。
  **18時間起きて6時間眠ると、覚醒度はちょうど元へ戻ります**（−72 と +72）——普通の1日を回すぶんには
  釣り合い、それより長く起きた日だけが翌日へ持ち越されます。**睡眠1回で戻るのは満タンの半分ほど**
  （基準のキャラクタで 96/192）なので、寝溜めはできません。
- **回復量は個体差を持ちません**（痛み・血と同じく trait が配ります）。`stamina` の `max` が大きい
  キャラクタほど1回で戻る割合は小さく、休息の重みは体格の側に出ます。
- **休んでいる間も水分と体脂肪は減ります。** 睡眠1回で水分がおよそ1日ぶんの1/4——眠ること自体に
  値段があり、渇いたまま眠れば眠っている間に死にます（[`VitalsSystem.md`](../engine/VitalsSystem.md) 6 節）。

## 選択とセーブ

`SaveData.characterId` は選ばれた `object_def` の識別子そのもの。読み込み時に未知の識別子だった場合
（識別子の改名・旧セーブ）は先頭のキャラクタで代替して開ける（`resolveCharacterDefName`）。

キャラクタの絵は `src/assets/objects/<識別子>.png` に置けば、コード側の登録なしにカードとポートレイトへ
出る（`objectArt.ts`）。用意されるまでは代替の絵文字を出す。

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
| プロパティ | `weight` / `pain` / `blood` / `warmth` / `chill_point` / `satiety` / `carbohydrate` / `protein` / `lipid` / `vitamin` / `hydration` / `body_fat` / `wakefulness` / `stamina` / `load` |
| アクション | 休息の4つ（`wait` / `rest` / `nap` / `sleep`。下の[休息](#休息)節。`player_character` trait が配る） |
| 表示 | `ja.yaml` の表示名、代替アイコン（`characterCard.ts`。絵が入るまでの繋ぎ） |

`status` タグが付くのは `pain` / `blood` / `warmth` / `satiety` / `vitamin` / `hydration` / `wakefulness` /
`stamina` / `load` の9つで、宣言順もこの順に揃える（`propertiesWithTag` の戻り順がそのままステータスエリアの
並びになる、[`StatusArea.md`](../ui/StatusArea.md)）。先頭の5つが trait 由来なのは、trait の props が
キャラクタ自身の props より前に並ぶため（`RawObjectDef.resolve`）。**`chill_point` は `status` を持たない**
——見せるのは残っている熱だけで、境目そのものは衣服・寝床が押し下げる裏の値。**栄養素の在庫（`carbohydrate` ほか3つ）は
`status` を持たない**——常に見せるのは腹が満ちているかどうかだけで、在庫は開いて見るもの
（[`DigestionSystem.md`](../engine/DigestionSystem.md) 3 節）。**ビタミンだけが在庫と別扱いなのは、
尽きた先の弊害を段が持つ**ため（同 4 節）。

気絶を決める `consciousness` は、`pain` と同じくキャラクタ間で共通の値としてここへ加わる予定である
（押し下げる側は [`VitalsSystem.md`](../engine/VitalsSystem.md) 2 節。気を失った手番の飛ばし方が
決まっていないため、まだ実装しておらず上の契約にも含めない）。

### 値の刻み方（キャラクタ間で共通の規約）

数値のスケールは [`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.0節に従い、
`range.min` は常に0。1 tick = 15分、1時間 = 4 tick。

**尽きると死ぬのは `hydration` / `body_fat` / `blood` / `warmth` の4つ**
（[`VitalsSystem.md`](../engine/VitalsSystem.md) 8 節・8.3 節）。
いずれも `range.min`（＝0）へ達した時点で `on_min` が自分を `destroy` する、同じ形で書く。
**死因を名乗るのはその `destroy` で**、添えた `reason`（`dehydrated` / `starved` / `exsanguinated` /
`frozen`）が消された側に残る（`WorldObject.destroyedReason`、
[`VitalsSystem.md`](../engine/VitalsSystem.md) 6 節）。
同じ名前の段を一番下に置くのは、尽きる前に警告を出すため。

- **`satiety`（満腹感）**: **単位は mL**——胃に入っている物のかさで、エネルギーではない
  （[`DigestionSystem.md`](../engine/DigestionSystem.md) 2 節）。`max` が胃の容量なので、下の
  「安全域を外れるのは `max` の80%」も「初期値は75%」も当てはまらない。`max` の6割に置いた段
  **`full`** を `eat` が読んで「もう食べられない」を見る。餓死は `body_fat` が受け持つため
  致命的域は持たない。個体差は無く `player_character` trait が配る。
- **栄養素の在庫**（`carbohydrate` / `protein` / `lipid`）: **単位は tick**（体脂肪と同じ物差し）。
  在庫がある間は `body_fat` へ流れ続け、速さは栄養素ごとに違う（同 3 節）。個体差は持たず trait が配る。
- **`vitamin`（ビタミン）**: **単位は mg**（ビタミンC相当）。エネルギーにならないので在庫の3本とは
  物差しが違う（同 4 節）。同じく trait が配る。一番下の段 **`scurvy`**（壊血病）が `pain` を押し上げる
  ——**体調不良を怪我のカードにせず、原因となる値の段に持たせる**
  （[`DesignPrinciples.md`](../concept/DesignPrinciples.md)）唯一の実装例。
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
- **`stamina`（体力）**: 疲労の逆。戻すのは休息だけ（同節）。**tickで減るのは荷を担いでいる間だけ**で、
  減らすのは `load` の段（下の荷重の効き方節）。空身なら 1 も減らない。
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
  持たせず trait が配る。**戻るのは水分と体脂肪がともに安全域にある間だけ**で（同 3.1 節）、
  水も食べ物も切らしたまま養生することはできない。
- **`warmth`（熱、kcal）／`chill_point`（寒さの入口、℃）**: `blood` と同じく `max` が体格そのもの
  （700 ＝ 深部体温 37℃ から 25℃ までに失える熱）で、満タンから始まる。**寒いかどうかは、居る場所の
  `ambient_temperature` と `chill_point`（素は16℃）の比較1つで決まる**——下回る間は `-2/tick`、
  屋根も蓋も無い所で雨に打たれている間は `-6/tick` で削られ、上回る間は `+8/tick` で戻る。尽きた段の
  名前は **`frozen`**。段の境目は深部体温で置く（刻み方は
  [`VitalsSystem.md`](../engine/VitalsSystem.md) 8.3 節）。個体差は持たせず trait が配る。
  **`chill_point` は、防ぐ側（衣服・寝床）が `modify` で押し下げるための境目**で、火だけは境目ではなく
  気温の側を上げる。
- **`load`（荷重）**: 持ち物と装備の重さ（g）。自分では動かず、中身から導出される
  （[`ContainerSystem.md`](../engine/ContainerSystem.md) 2節）ので `value` は 0 のまま。`max` が
  「担げる量」そのもので、担ぎ慣れの個人差はここに出る。**段が駆動するのは移動の可否だけではない**
  ——歩みの速さと `stamina` の削りも段が持つ（下の荷重の効き方節）。


### 域の区分（`stages` の不変条件）

[`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.4節の `alert`。`max` が違っても
プレイヤーの読み取り方が変わらないよう、しきい値は次の形で揃える。

- **安全域から外れるのは `max` の80%**（＝ステータスエリアに出始める位置）。この境界だけは
  全ステータス・全キャラクタで共通でなければ「まだ大丈夫」の感覚が崩れる。端数は丸める——段のしきい値は
  人が読む数字なので、小数が書けても整数に留める。
- **`hydration` の初期値は `max` の75%**（安全域のやや下）。満腹感も同じ狙いで留意域（300mL）から
  始める（[`DigestionSystem.md`](../engine/DigestionSystem.md) 2 節）。満タンで始めると alert が
  `safe` でステータスバーに出ず（[`StatusArea.md`](../ui/StatusArea.md)）、
  飲食の操作も最初は試せないため。**空身では減らない `stamina`** と、序盤に眠らせたくない
  `wakefulness` は満タンで始める。
- **減る速さが一定のものは、80%より下を残り時間で切る。** `wakefulness` は残り12時間未満で
  `caution`、残り3時間未満で `danger`。
- `hydration` も残り時間で切る: 残り2日未満で `caution`、残り1日未満で `danger`、
  残り6時間未満で `fatal`。
- **`stamina` は割合で切る**: `max` の60%未満で `caution`、20%未満で `danger`。**減る速さが担いでいる
  荷で変わる**（下の荷重の効き方節）ので、残り時間で切ると**荷を持ち替えるたびに段の意味が変わります**。
  割合なら、境目は常に「体力があと何割か」を指したままです。
- `vitamin` の80%より下は現実の量で切る: 300mg 未満が壊血病（`danger`）で、その上の `caution` の
  境目は 600mg（残り12.5日）。**発症の境目だけは残り時間ではなく実際の血中量**で、外から検算できる
  （[`DesignPrinciples.md`](../concept/DesignPrinciples.md) 「現実に単位があるものは、その単位で持つ」）。
- `blood` は**失った割合**で切る（臨床の出血性ショックの分類、
  [`VitalsSystem.md`](../engine/VitalsSystem.md) 3 節）。2割失って安全域を外れるので、上の80%の境界と
  ちょうど一致する。以降 3割で `caution`、4割で `danger`、6割で `fatal`。
- **`warmth` の境目は深部体温で切る**（[`VitalsSystem.md`](../engine/VitalsSystem.md) 8.3 節）ので、
  上の80%は安全域の境目ではなく `caution` の境目になる（560 ＝ 34.6℃ ＝ 軽度低体温症の入口）。
  **安全域は `max` ちょうど**（37℃）で、満タンから始まり、そこから 560 までが `watch`——体温は満タンが
  常態なので、失った熱はそれだけで留意に値する。
- **`load` と `pain` は増える側が悪い**ので、上の「80%で安全域を外れる」は当てはまらない。`max` からの
  割合で刻む: 1/4 で `watch`、1/2 で `caution`、5/6 で `danger`。0 から始まって荷造り・怪我の最中に
  現れるよう、最初の境目は低めに置く。`load` の危険域の段の名前は **`too_heavy`** で固定する——道の
  `travel` がこの名前で移動可否を見る（[`ContainerSystem.md`](../engine/ContainerSystem.md) 5節）。

## 荷重の効き方【確定】【未実装: 荷の重さ】

**荷は、担げるかどうかだけでなく、歩みの速さと疲れにも効きます。** 効かせ方は 1 箇所——`load` の段
（[`ContainerSystem.md`](../engine/ContainerSystem.md) 5 節）で、閾値を別に持つ量は 1 つも足しません。

| 段 | 移動 | 歩みの速さ | `stamina` |
| --- | --- | --- | --- |
| `light` | 通る | 等倍 | 減らない |
| `laden` | 通る | ×1.15 | `-0.3/tick` |
| `heavy` | 通る | ×1.4 | `-1/tick` |
| `too_heavy` | **通れない** | — | `-2/tick` |

- **疲れる側は、今の文法でそのまま書けます。** 段の `passives` が `add` で `stamina` を削るだけです
  （[`GameElementDefinition.md`](../engine/GameElementDefinition.md) 6.4 節）。**削るのが時間なので、
  往復の回数そのものが重みを持ちます**——重い荷で長い道を歩くほど、削られる tick が増えます。
  `stamina` が空身では減らない、という既定が破れるのはここだけです。
- **桁は「1 日で使い切れる」位置に取ります。** 起きている 18 時間（72 tick）を `heavy` のまま担ぎ通すと
  `-72` で、`max` 100 のほとんどを使い切ります（`captain.yaml`）。**睡眠 1 回で戻るのが +90** なので、
  **重い荷の 1 日ぶんと、一晩の回復がちょうど釣り合う**位置です。これより 1 桁小さいと、何往復しても
  一晩で必ず取り返せてしまい、**削っているのに何も決まりません**。**日をまたいで借金が積み上がる形にも
  しません**——寝れば戻るからこそ、判断は「今日あと何往復できるか」に収まります。
- **遅くなる側は、文法が 1 つ足りません。** 道の所要時間は道自身が持ち（`duration: {prop: travel_minutes}`）、
  `duration` に書けるのは**単一の参照だけ**です（同 11.3 節）。**足りるのは、2 つの参照の積を取れること
  だけです**——道の `travel_minutes` × 担ぎ手の `pace`（素は 1 で、`load` の段が `modify` で押し上げる）。
  和ではなく積にするのは、**長い道ほど遅れも大きい**からで、遅れの量を道ごとに書かずに済みます。
  加えて `duration` の `subject` は `self`/`ancestor` だけで `actor` を指せない（同 10.2 節）ので、
  そこも要ります。詳しくは同 17 節。
- **軽くする道具の値打ちは損なわれません。** そりのような率を下げる道具は `load` そのものを下げるので、
  **移動の可否・速さ・疲れの 3 つに同時に効きます**（[`ContainerSystem.md`](../engine/ContainerSystem.md)
  2 節）。移動が重くなる方向の変更ですが、[`DesignPrinciples.md`](../concept/DesignPrinciples.md) の
  「コストは、それを軽くする道具の値打ちそのもの」に沿って、**重くなった分がそのまま、そりを作る理由と
  前線を近づける理由**になります。
- **怪我もここへ合流します。** 骨折は宿主の `load` を押し上げる（[`InjurySystem.md`](../engine/InjurySystem.md)
  5 節）ので、**傷の側に移動の規則を 1 行も書かずに**「折れた脚では遅く、余計に疲れる」が出ます。
- **画面は変わりません。** `load` は既にステータスエリアへ「増えると悪い」バーとして並んでいます
  （[`StatusArea.md`](../ui/StatusArea.md) 6 節）。段が増えたわけでも、新しい行が増えたわけでもありません。

**上の表の数値は目安です。** 段ごとの倍率と削りをどこに置くかは、**1 日にどれだけ往復するのが普通か**が
決まって初めて釣り合いが見えます（未決事項は
[`ContainerSystem.md`](../engine/ContainerSystem.md) 8 節）。動かないのは、**削るのが時間であること**と、
**1 日ぶんと一晩の回復が同じ桁であること**の 2 つだけです。

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

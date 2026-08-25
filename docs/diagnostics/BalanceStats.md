# アイテム収支レポート

`tests/diagnostics/balanceStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）
だけから計算した「時間あたりの収支」。定義の数値を変えたら以下で再生成する。

```
npm run stats:balance
```

同じ表はコーデックスビューアの「収支」ページでも見られる（アイコンつき）。

## 計測方法

- 1 tick = 15分、1日 = 96 tick = 1440分。
- `pick` の分岐は `weight` から期待値を取る。入れ子の `pick` は確率の積まで畳んである。
- **1つの工程が複数の値を返す場合、所要時間は按分せず全額を各値に計上する。** 按分には
  水と満腹の交換レートが要るが、そのレートこそこの表が見つけようとしているもの。
  代わりに「同時に返す値」を添えた——それらを縦に足すと二重計上になる。
- **道具（消費されない入力）の入手時間は単位あたりの時間に含めない。** 繰り返し使えるものを
  1個あたりへ按分するには「何回使うか」の仮定が要り、その仮定が数字を支配するため。
  代わりに「前提」へ、1度だけ払う入手時間として別に並べる。
- 連鎖の起点は探索。土地ごとに得られる物が違うので、連鎖表は土地ごとに出す。
  ただし資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の
  **島全体**を先頭に置く——各資源を最も得やすい土地で得て、移動時間は数えない場合。

### 待って得る生産の数え方

罠のように、仕掛けてから時間が経つと産物が返るものは、**待っている間に他のことができる**。
そこで工程の時間を2本に分けて数える。

- **労働時間**: プレイヤーが払う分。他の行動と直接競合するのはこれだけで、
  各表の「分」はすべてこちら。
- **周期**: 経過するだけの分。単位あたりの時間には**足さない**。

では待ち時間が無コストかというと、そうではない。**設備は待っている間も朽ちる**ので、
1周期で使い切る設備の割合（周期 ÷ 寿命）が、そのまま製作労働の按分になる——罠1回の判定は
「罠を作る労働の、周期÷寿命ぶん」を払っている。連鎖表の数字はこの按分を含む。

この数え方が成り立つのは**並列度に上限があるとき**だけ。いくらでも並べられて朽ちもしない
設備は、待つだけで無限に得られることになるので按分できず、連鎖表から外して待ち生産表へ回す。

### 隣の物に押されて起こる作り替え

焼くのも失血死も、**自分では動かない値を隣の物が動かす**。炉は火にかけた物の
`cooking_progress` を進め（`add: {child: ...}`）、刺さった傷は持ち主の `blood` を奪う
（`add: {parent: ...}`）。値が range の端へ届いた瞬間に、その型自身の `on_max`/
`on_min` が生肉を焼けた肉へ、獲物を死体へ置き換える。

どちらも「1回で終わる待ち生産」なので、労働0・経過時間ありの工程として連鎖表に載せ、
押し手（炉・傷）は**要る道具**として前提の列に出す。誰が誰の隣に立てるかは、枠の
`accept` だけで判断する——炉の火の枠が `roastable` を受けるから、そこへ入る物は焼ける。

**押し手が止まるまでに動かせる総量**も数える。出血は傷の `bleeding` が尽きれば止まるので、
罠の傷（-15/tick × 2 tick = 30mL）ではネズミ（血6mL）は死ぬがヤケイ（80mL）は死なない。
届かない組み合わせはその工程を立てない。

一撃で端まで押す効果も同じ引き金を引く。仕留めの一撃（`set: {self: {blood: 0}}`）は
血を空にするだけで、死体を生むのは `blood` の `on_min` ——工程の結果にこれを
畳まないと、イノシシの死体（血4,600mLで失血死には届かない）の作り方がどこにも無くなる。
確率でしか消えない入力は、**その確率ぶんだけ**消費されるものとして数える（21回に1回
しか仕留められないなら、1回の実行に要る獲物は0.048匹）。

### この表が数えていないもの

- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。
  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。
- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは
  宣言値だけなので、罠のレートは**餌なし**の値。
- **雨で溜まる水を汲む労働。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、
  工程ではない。そのため水を汲む経路は労働0分になる——1節の「数えられない経路」へ分けて
  ある。溜まる量そのものは3節に出す（労働ではなく、季節ごとの mL/日）。
- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。
- **炉の薪。** 焼くには火を保たなければならないが、そのぶんの薪は数えていない。炉は
  前提（道具）としてだけ出る。
- **どの武器を重ねたか。** 一撃の当たり所の配分は武器が宣言する（`{subject: dragged}` の
  重み）ので、重ねる相手を決めないと配分が決まらない。ここでは**その値を最も高く宣言して
  いる型を重ねた**として読むため、配分は「分岐ごとに最も良い武器を選べる場合」のものになる
  ——1本の武器では出ない配分で、仕留めの確率は実際より低く出る。
- **実行時にしか決まらない条件。** 起こりえない工程は立てないが、偽と判定できるのは
  `subject: self` のプロパティが**その型の取りうる範囲**（`range`。端に達した瞬間に
  その型でなくなるなら、その端を除く）から外れる条件だけ。祖先の天候・重ねる相手・
  スロットの中身を見る条件は真偽を決めずに素通しするので、それだけで弾かれる操作は
  工程として残る。

### 何を「1日に要る量」と数えるか

**輸送で減る値は需要にしない。** `carbohydrate`/`protein`/`lipid` はtick毎に体脂肪へ流れるが、
あの速さ（合計3.5/tick）は在庫がある間の流量であって、要る量ではない。体が実際に燃やすのは
受け皿側の `body_fat` の減りだけで、三大栄養素はそこへ注ぐ原資（DigestionSystem.md 3節）。
流量を要求量として数えると、必要な3.5倍を食べさせることになる。

**段で減る速さが変わる値は、初期値が入る段の速さを採る。** 体脂肪は段ごとに -0.5〜-1.6/tick と
違うので、全部を足すとどの段にも当てはまらない量になる。

`satiety` は胃のかさであってエネルギーではない（同2節）。尽きても死なず、食べれば同時に
埋まるので、献立では他の値を賄うついでに満たされることが多い。

## 1. 連鎖表（素材から摂取までの総時間）

1日ぶんの必要量は medic のもの（消費表から）。
時間はすべて労働時間で、待ち時間は含まない（待ち生産の設備は、周期÷寿命ぶんの製作労働と
して計上する）。「1日の割合」は、1日ぶんを賄うのに要る労働が1日（1440分）に占める割合。
「設備数」は、待ち生産の経路で1日ぶんを賄うのに同時に要る設備の数。

**土地ごとの表は可否を判定しない。** 答えるのは「この土地を起点にすると単位あたり何分か」
だけで、ある経路が載らないのはできないからではなく**その表の対象ではない**から。
入手できるかどうかは島全体でだけ判定し、島のどこにも経路が無いものは末尾の
「島全体で入手経路が無いもの」へまとめる。

**‡ は、他の土地で用意した材料・道具が要る経路。** AとBの土地で集めた物を合わせて作るのは
普通の遊び方なので可否は分けないが、土地の間の移動時間を数えていない以上、‡ の付いた経路は
実際にはこの表より不利になる。

**時間を数えられない経路（労働0で値が返るもの）はこの表に混ぜず、末尾の「数えられない経路」
へ分けた。** 注記は読み飛ばされるが順位は読み飛ばされないので、0分の行を最安として
並べると「水はタダ」と読めてしまう。

### 島全体

> **1日を賄う最小労働: 624 分**（1440分の 43.4%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat | 2.79 | 112 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat | 0.07 | 0.05 | 0.03 | 112 | 7.8% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| grassland.explore → water_spinach.eat | 0.11 | 0.06 | 0.05 | 167 | 11.6% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 0.11 | 0.04 | 0.08 | 176 | 12.2% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat | 0.12 | 0.09 | 0.03 | 181 | 12.6% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat | 0.13 | 0.04 | 0.09 | 195 | 13.6% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.cooking_progress.on_max → charred_lump.eat | 0.15 | 0.03 | 0.12 | 232 | 16.1% | 1.3 | satiety +200.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| forest.explore → banana_plant.fell → banana.eat | 0.34 | 0.27 | 0.07 | 518 | 36.0% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 0.50 | 0.10 | 0.41 | 774 | 53.7% | 4.3 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.39 | 0.21 | 0.18 | 19 | 1.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat | 1.68 | 1.05 | 0.63 | 81 | 5.6% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| forest.explore → banana_plant.fell → banana.eat | 3.38 | 2.66 | 0.71 | 162 | 11.3% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 28.63 | 9.31 | 19.31 | 1374 | 95.4% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat | 54.23 | 39.23 | 15.00 | 2603 | 180.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat | 0.81 | 0.51 | 0.30 | 77 | 5.4% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat | 1.47 | 1.06 | 0.41 | 141 | 9.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat | 1.85 | 0.60 | 1.25 | 177 | 12.3% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 2.39 | 0.78 | 1.61 | 229 | 15.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 7.55 | 1.45 | 6.11 | 725 | 50.4% | 4.0 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| forest.explore → banana_plant.fell → banana.eat | 11.81 | 9.31 | 2.50 | 1134 | 78.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| grassland.explore → water_spinach.eat | 32.65 | 17.65 | 15.00 | 3135 | 217.7% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### sandy_beach

> **1日を賄う最小労働: 824 分**（1440分の 57.2%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| sandy_beach.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat | 3.34 | 181 |
| palm_tree.pick_green_coconut → green_coconut.bore | 8.93 | 283 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 0.12 | 0.09 | 0.03 | 181 | 12.6% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| sandy_beach.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 54.23 | 39.23 | 15.00 | 2603 | 180.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 1.47 | 1.06 | 0.41 | 141 | 9.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### rocky_coast

> **1日を賄う最小労働: 2963 分**（1440分の 205.8%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat | 48.00 | 2603 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 0.12 | 0.09 | 0.03 | 181 | 12.6% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 54.23 | 39.23 | 15.00 | 2603 | 180.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.cooking_progress.on_max → roasted_coconut_crab.eat ‡ | 1.47 | 1.06 | 0.41 | 141 | 9.8% | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 | campfire（55.9分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### cliff_coast

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> この土地を起点にできない値: satiety、vitamin、hydration、body_fat（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### grassland

> **1日を賄う最小労働: 472 分**（1440分の 32.8%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat | 2.79 | 112 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.07 | 0.05 | 0.03 | 112 | 7.8% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| grassland.explore → water_spinach.eat | 0.11 | 0.06 | 0.05 | 167 | 11.6% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.39 | 0.21 | 0.18 | 19 | 1.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 1.68 | 1.05 | 0.63 | 81 | 5.6% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.81 | 0.51 | 0.30 | 77 | 5.4% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| grassland.explore → water_spinach.eat | 32.65 | 17.65 | 15.00 | 3135 | 217.7% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### forest

> **1日を賄う最小労働: 472 分**（1440分の 32.8%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| forest.explore → taro.cooking_progress.on_max → roasted_taro.eat | 2.79 | 112 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.07 | 0.05 | 0.03 | 112 | 7.8% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 0.11 | 0.04 | 0.08 | 176 | 12.2% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat ‡ | 0.13 | 0.04 | 0.09 | 195 | 13.6% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.cooking_progress.on_max → charred_lump.eat | 0.14 | 0.02 | 0.11 | 208 | 14.4% | 1.3 | satiety +200.00 | campfire（55.9分）、laceration（27.6分）、snare（103.3分） |
| forest.explore → banana_plant.fell → banana.eat ‡ | 0.34 | 0.27 | 0.07 | 518 | 36.0% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 0.45 | 0.08 | 0.37 | 692 | 48.1% | 4.3 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.6分）、snare（103.3分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 1.68 | 1.05 | 0.63 | 81 | 5.6% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| forest.explore → banana_plant.fell → banana.eat ‡ | 3.38 | 2.66 | 0.71 | 162 | 11.3% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 28.63 | 9.31 | 19.31 | 1374 | 95.4% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.81 | 0.51 | 0.30 | 77 | 5.4% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat ‡ | 1.85 | 0.60 | 1.25 | 177 | 12.3% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 2.39 | 0.78 | 1.61 | 229 | 15.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 6.76 | 1.14 | 5.62 | 649 | 45.1% | 4.0 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.6分）、snare（103.3分） |
| forest.explore → banana_plant.fell → banana.eat ‡ | 11.81 | 9.31 | 2.50 | 1134 | 78.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### jungle

> **1日を賄う最小労働: 624 分**（1440分の 43.4%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| jungle.explore → taro.cooking_progress.on_max → roasted_taro.eat | 2.79 | 112 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.07 | 0.05 | 0.03 | 112 | 7.8% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 0.11 | 0.04 | 0.08 | 176 | 12.2% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat ‡ | 0.13 | 0.04 | 0.09 | 195 | 13.6% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.cooking_progress.on_max → charred_lump.eat | 0.15 | 0.03 | 0.12 | 228 | 15.9% | 1.3 | satiety +200.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| jungle.explore → water_spinach.eat | 0.30 | 0.25 | 0.05 | 466 | 32.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 0.34 | 0.27 | 0.07 | 518 | 36.0% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 0.50 | 0.09 | 0.40 | 761 | 52.8% | 4.3 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → water_spinach.eat | 1.10 | 0.92 | 0.18 | 53 | 3.7% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 1.68 | 1.05 | 0.63 | 81 | 5.6% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 3.38 | 2.66 | 0.71 | 162 | 11.3% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 28.63 | 9.31 | 19.31 | 1374 | 95.4% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → taro.cooking_progress.on_max → roasted_taro.eat ‡ | 0.81 | 0.51 | 0.30 | 77 | 5.4% | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 | campfire（55.9分） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max → roasted_meat.eat ‡ | 1.85 | 0.60 | 1.25 | 177 | 12.3% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 2.39 | 0.78 | 1.61 | 229 | 15.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | 7.43 | 1.40 | 6.03 | 713 | 49.5% | 4.0 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 11.81 | 9.31 | 2.50 | 1134 | 78.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（157.0分） |
| jungle.explore → water_spinach.eat | 90.97 | 75.97 | 15.00 | 8733 | 606.5% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### rocky_field

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> この土地を起点にできない値: satiety、vitamin、hydration、body_fat（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### wasteland

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> この土地を起点にできない値: satiety、vitamin、hydration、body_fat（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### mountainside

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> この土地を起点にできない値: satiety、vitamin、hydration、body_fat（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### mountain_peak

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> この土地を起点にできない値: satiety、vitamin、hydration、body_fat（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### 数えられない経路

労働0で値が返る経路。**上の表には混ぜていない**——時間を数えられていないだけで、
本当にタダなわけではない（雨で水が溜まるのはtick毎の持続効果で、工程ではない）。

| 場所 | 値 | 経路 | 同時に返す値 |
| --- | --- | --- | --- |
| 島全体 | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_water_liquid.pour_into_empty → jar__content_water_liquid.drink | hydration +10.00 |
| 島全体 | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_water_liquid.pour_into_empty → rocky_field.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| 島全体 | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| 島全体 | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| 島全体 | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → rocky_field.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| 島全体 | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| 島全体 | wakefulness | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| 島全体 | wakefulness | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| sandy_beach | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| sandy_beach | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| sandy_beach | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| sandy_beach | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| sandy_beach | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| sandy_beach | hydration | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| sandy_beach | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| sandy_beach | wakefulness | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| rocky_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → rocky_coast.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| rocky_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| rocky_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → rocky_coast.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| rocky_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_coast | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_coast | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| cliff_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| cliff_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → cliff_coast.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| cliff_coast | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| cliff_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| cliff_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → cliff_coast.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| cliff_coast | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| cliff_coast | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| cliff_coast | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| grassland | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| grassland | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| grassland | hydration | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| grassland | wakefulness | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| forest | hydration | forest.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| forest | hydration | forest.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| forest | hydration | forest.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| forest | wakefulness | forest.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| jungle | hydration | jungle.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| jungle | hydration | jungle.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| jungle | hydration | jungle.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| jungle | hydration | jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| jungle | hydration | jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| jungle | hydration | jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| jungle | wakefulness | jungle.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| jungle | wakefulness | jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_field | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| rocky_field | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → rocky_field.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| rocky_field | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_field | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| rocky_field | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → rocky_field.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| rocky_field | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_field | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| rocky_field | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| wasteland | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| wasteland | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → wasteland.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| wasteland | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| wasteland | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| wasteland | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → wasteland.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| wasteland | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| wasteland | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| wasteland | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountainside | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| mountainside | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → mountainside.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| mountainside | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountainside | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| mountainside | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → mountainside.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| mountainside | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountainside | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountainside | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountain_peak | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → jar__content_water_liquid.drink | hydration +10.00 |
| mountain_peak | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar.collect_rain → mountain_peak.explore → stone.heat_soak.on_max → hot_stone.boil → jar__content_hot_water_liquid.drink | hydration +10.00 |
| mountain_peak | hydration | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountain_peak | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → coconut_bowl__content_water_liquid.drink | hydration +10.00 |
| mountain_peak | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_bowl.collect_rain → mountain_peak.explore → stone.heat_soak.on_max → hot_stone.boil → coconut_bowl__content_hot_water_liquid.drink | hydration +10.00 |
| mountain_peak | hydration | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountain_peak | wakefulness | unfired_jar.coiled → unfired_jar.cooking_progress.on_max → jar__content_tea_liquid.pour_into_empty → jar__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |
| mountain_peak | wakefulness | coconut.husk → husked_coconut.crack → coconut_half.scrape → jar__content_tea_liquid.pour_into_empty → coconut_bowl__content_tea_liquid.drink | hydration +10.00、wakefulness +2.00 |

## 2. オブジェクトの総コスト

1つ手に入れるまでの労働を、素材の採集から数えたもの。組み立ての時間だけではない
——筏は組むのに420分だが、丸太と縄を揃えるところから数えると桁が変わる。

「日数」は、生存に要る労働を引いた残り（1日の余剰時間）で割った日数。**目標までに
何日かかるか**がこれで出る。道具（前提）の時間は総コストに含めない（#550のまま）。

土地・キャラクタ・単独で存在できない物（怪我・道）・製作中オブジェクト・軸の値の型
（液体の種類。世界に現れるのは中身入りの容器という変種のほうで、`water_liquid` そのものの
インスタンスは作られない）は、手に入れるという言い方が成り立たないので対象外。

### 入手経路が無いもの

島のどこにも作り方も見つけ方も無い。**足りない入力**まで出すので、そのまま埋めるべき穴になる。

| オブジェクト | 足りない入力 |
| --- | --- |
| three_stone_hearth | 作る工程が無い |
| stone_hearth | 作る工程が無い |
| spear | 作る工程が無い |
| bandage | 作る工程が無い |

### 総コスト

| オブジェクト | 総労働（分） | 探索 | それ以外 | 日数 | 作り方 | 前提 |
| --- | --- | --- | --- | --- | --- | --- |
| monkey | 397.5 | 397.5 | 0.0 | 0.49 | sandy_beach.explore | — |
| monkey_carcass | 397.5 | 397.5 | 0.0 | 0.49 | sandy_beach.explore → monkey.blood.on_min | puncture_wound（65.5分） |
| junglefowl | 24.8 | 9.4 | 15.4 | 0.03 | snare.catch_remaining.on_min | snare（103.3分） |
| rat | 15.2 | 5.8 | 9.4 | 0.02 | snare.catch_remaining.on_min | snare（103.3分） |
| wild_boar | 745.0 | 745.0 | 0.0 | 0.91 | forest.explore | — |
| wild_boar_carcass | 1450.0 | 745.0 | 705.0 | 1.78 | forest.explore → wild_boar.strike | weapon → sharp_stone（72.2分） |
| junglefowl_carcass | 24.8 | 9.4 | 15.4 | 0.03 | snare.catch_remaining.on_min → junglefowl.blood.on_min | puncture_wound（65.5分）、snare（103.3分） |
| rat_carcass | 15.2 | 5.8 | 9.4 | 0.02 | snare.catch_remaining.on_min → rat.blood.on_min | laceration（27.7分）、snare（103.3分） |
| roasted_rat | 15.2 | 5.8 | 9.4 | 0.02 | snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| feather | 44.8 | 9.4 | 35.4 | 0.05 | snare.catch_remaining.on_min → junglefowl.blood.on_min → junglefowl_carcass.butcher | cutting_tool → sharp_stone（72.2分）、puncture_wound（65.5分）、snare（103.3分） |
| small_bone | 30.2 | 5.8 | 24.4 | 0.04 | snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| raw_meat | 42.3 | 18.6 | 23.6 | 0.05 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| roasted_meat | 42.3 | 18.6 | 23.6 | 0.05 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_max | campfire（55.9分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| charred_lump | 15.2 | 5.8 | 9.4 | 0.02 | snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.cooking_progress.on_max | campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| animal_bone | 281.7 | 124.2 | 157.5 | 0.35 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| rawhide | 281.7 | 124.2 | 157.5 | 0.35 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| golden_chalice | 397.5 | 397.5 | 0.0 | 0.49 | cliff_coast.explore | — |
| palm_tree | 122.3 | 122.3 | 0.0 | 0.15 | sandy_beach.explore | — |
| green_coconut | 16.7 | 0.0 | 16.7 | 0.02 | palm_tree.pick_green_coconut | palm_tree（122.3分） |
| drained_green_coconut | 31.7 | 0.0 | 31.7 | 0.04 | palm_tree.pick_green_coconut → green_coconut.bore | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| coconut_jelly | 23.3 | 0.0 | 23.3 | 0.03 | palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| coconut | 17.5 | 17.5 | 0.0 | 0.02 | sandy_beach.explore | — |
| coconut_husk | 47.5 | 17.5 | 30.0 | 0.06 | sandy_beach.explore → coconut.husk | cutting_tool → sharp_stone（72.2分） |
| husked_coconut | 47.5 | 17.5 | 30.0 | 0.06 | sandy_beach.explore → coconut.husk | cutting_tool → sharp_stone（72.2分） |
| coconut_half | 31.2 | 8.7 | 22.5 | 0.04 | sandy_beach.explore → coconut.husk → husked_coconut.crack | stone（12.2分）、cutting_tool → sharp_stone（72.2分） |
| coconut_meat | 61.2 | 8.7 | 52.5 | 0.08 | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| woven_basket | 318.0 | 318.0 | 0.0 | 0.39 | sandy_beach.explore | — |
| abaca | 196.3 | 196.3 | 0.0 | 0.24 | jungle.explore | — |
| banana_plant | 186.3 | 186.3 | 0.0 | 0.23 | forest.explore | — |
| banana | 103.1 | 93.1 | 10.0 | 0.13 | forest.explore → banana_plant.fell | cutting_tool → sharp_stone（72.2分） |
| banana_stem | 43.3 | 39.3 | 4.0 | 0.05 | jungle.explore → abaca.fell | cutting_tool → sharp_stone（72.2分） |
| plant_fiber | 36.6 | 19.6 | 17.0 | 0.04 | jungle.explore → abaca.fell → banana_stem.strip | cutting_tool → sharp_stone（72.2分） |
| yarn | 93.3 | 39.3 | 54.0 | 0.11 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin | cutting_tool → sharp_stone（72.2分） |
| cord | 206.5 | 78.5 | 128.0 | 0.25 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply | cutting_tool → sharp_stone（72.2分） |
| rope | 679.5 | 235.5 | 444.0 | 0.83 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted | cutting_tool → sharp_stone（72.2分） |
| fire_drill | 97.4 | 37.4 | 60.0 | 0.12 | sandy_beach.explore → forest.explore → fire_drill.carved | — |
| dry_grass | 142.5 | 142.5 | 0.0 | 0.17 | wasteland.explore | — |
| burning_tinder | 99.9 | 29.4 | 70.5 | 0.12 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.light | fire_drill（97.4分）、cutting_tool → sharp_stone（72.2分） |
| hot_stone | 12.2 | 12.2 | 0.0 | 0.01 | rocky_field.explore → stone.heat_soak.on_max | campfire（55.9分） |
| campfire | 55.9 | 40.9 | 15.0 | 0.07 | forest.explore → campfire.stacked | — |
| water_spinach | 17.7 | 17.7 | 0.0 | 0.02 | grassland.explore | — |
| coconut_crab | 39.2 | 39.2 | 0.0 | 0.05 | rocky_coast.explore | — |
| roasted_coconut_crab | 39.2 | 39.2 | 0.0 | 0.05 | rocky_coast.explore → coconut_crab.cooking_progress.on_max | campfire（55.9分） |
| taro | 25.3 | 25.3 | 0.0 | 0.03 | grassland.explore | — |
| roasted_taro | 25.3 | 25.3 | 0.0 | 0.03 | grassland.explore → taro.cooking_progress.on_max | campfire（55.9分） |
| jar | 465.0 | 285.0 | 180.0 | 0.57 | grassland.explore → unfired_jar.coiled → unfired_jar.cooking_progress.on_max | earth_kiln（303.8分） |
| coconut_bowl | 61.2 | 8.7 | 52.5 | 0.08 | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| thick_branch | 23.7 | 23.7 | 0.0 | 0.03 | sandy_beach.explore | — |
| stone | 12.2 | 12.2 | 0.0 | 0.01 | rocky_field.explore | — |
| twig | 13.6 | 13.6 | 0.0 | 0.02 | forest.explore | — |
| berry_bush | 71.6 | 71.6 | 0.0 | 0.09 | mountainside.explore | — |
| cave_entrance | 41.4 | 41.4 | 0.0 | 0.05 | mountain_peak.explore | — |
| spring | 199.5 | 199.5 | 0.0 | 0.24 | grassland.explore | — |
| clay | 71.3 | 71.3 | 0.0 | 0.09 | grassland.explore | — |
| unfired_jar | 232.5 | 142.5 | 90.0 | 0.29 | grassland.explore → unfired_jar.coiled | — |
| earth_kiln | 303.8 | 213.8 | 90.0 | 0.37 | grassland.explore → earth_kiln.heaped | — |
| broadleaf_tree | 149.0 | 149.0 | 0.0 | 0.18 | forest.explore | — |
| log | 194.5 | 74.5 | 120.0 | 0.24 | forest.explore → broadleaf_tree.fell | chopping_tool → stone_axe（482.4分） |
| sharp_stone | 72.2 | 12.2 | 60.0 | 0.09 | rocky_field.explore → stone.knap | — |
| stone_axe | 482.4 | 114.4 | 368.0 | 0.59 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rocky_field.explore → stone.knap → sandy_beach.explore → stone_axe.hafted | — |
| bone_needle | 70.2 | 5.8 | 64.4 | 0.09 | snare.catch_remaining.on_min → rat.blood.on_min → rat_carcass.cooking_progress.on_max → roasted_rat.eat → small_bone.whittle | cutting_tool → sharp_stone（72.2分）、campfire（55.9分）、laceration（27.7分）、snare（103.3分） |
| snare | 103.3 | 39.3 | 64.0 | 0.13 | jungle.explore → abaca.fell → banana_stem.strip → snare.knotted | cutting_tool → sharp_stone（72.2分） |
| raft | 4305.0 | 1809.0 | 2496.0 | 5.28 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted → forest.explore → broadleaf_tree.fell → raft.lashed | chopping_tool → stone_axe（482.4分）、cutting_tool → sharp_stone（72.2分） |
| rawhide_sail | 4449.0 | 1656.0 | 2793.0 | 5.45 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher → jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted → sandy_beach.explore → rawhide_sail.sewn | sewing_tool → bone_needle（70.2分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| palm_frond | 11.1 | 0.0 | 11.1 | 0.01 | palm_tree.pick_frond | palm_tree（122.3分） |
| woven_leaf | 35.6 | 0.0 | 35.6 | 0.04 | palm_tree.pick_frond → palm_frond.split_and_weave | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

## 3. 待ち生産表（設備が時間をかけて返す分）

仕掛けてから時間が経つと産物が返るもの。**周期は単位あたりの労働時間には足していない**
（計測方法の「待って得る生産の数え方」参照）ので、この表が代わりに周期とレートを出す。

- **設備あたり（個/日）**: 1日は24時間まるごと回る。眠っている間も進むのが待ち生産の取り柄。
- **寿命の間に（個）**: 設備1つが朽ちるまでに返す総数。これが並列度の上限を決める。
- **労働（分/個）**: 製作労働 ÷ 寿命の間に返す数。連鎖表に載るのはこの値。

### 島全体

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 103.3 | 24.78 |
| snare | catch_remaining.on_min | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 103.3 | 15.22 |

### sandy_beach

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### rocky_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### cliff_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### grassland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 103.3 | 24.78 |
| snare | catch_remaining.on_min | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 103.3 | 15.22 |

### forest

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.143 | 0.86 | 10.0 | 8.6 | 103.3 | 12.05 |

### jungle

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | junglefowl ×0.061 | 0.36 | 10.0 | 3.6 | 103.3 | 28.39 |
| snare | catch_remaining.on_min | 240 | rat ×0.117 | 0.70 | 10.0 | 7.0 | 103.3 | 14.72 |

### rocky_field

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### wasteland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### mountainside

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### mountain_peak

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_min | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 103.3 | 15.49 |

### 雨で溜まる水

空けたまま置いた容器が、1日に受ける水と失う水（`LiquidContainerSystem.md` 6・7節）。
降雨も蒸発も気候の実測値から出している（`ClimateSystemStats.md`）。

**単一の平均は出さない。** 雨季とそれ以外では降る時間が1桁違い、平均するとどの季節にも
存在しない中間の状態を測ることになる。読みたいのは差引の符号——**雨だけで水を賄えるのは
雨季だけ**で、それ以外の季節は置いておくだけでは減る。

- **蒸発は中身がある間しか効かない。** 空になった容器は素の型へ戻って蒸発も止まるので、
  この「1日に失う水」は満杯を保った場合の上限。実際の減りはこれより小さい。
- **容量を超えた分は捨てられる。** 雨季のヤシの器は容量250mLに対して1日1300mL近く降るので、
  汲み替えなければそのほとんどが失われる。差引はその損失を含まない。

| 容器 | 季節 | 容量（mL） | 降雨（mL/日） | 蒸発（mL/日） | 差引（mL/日） |
| --- | --- | --- | --- | --- | --- |
| jar | calm | 4000 | 163 | 241 | -78 |
| jar | wet | 4000 | 2665 | 61 | +2604 |
| jar | dry | 4000 | 44 | 272 | -228 |
| coconut_bowl | calm | 250 | 81 | 97 | -16 |
| coconut_bowl | wet | 250 | 1333 | 26 | +1307 |
| coconut_bowl | dry | 250 | 22 | 108 | -86 |

## 4. 消費表（1日あたり何が要るか）

キャラクタが自分のプロパティをtick毎にどれだけ動かすか（`passives` の `add` と `transfer`）。
括弧内は1日ぶん（×96）。個体差はそのまま列に出る。**連鎖表の「1日 N」の出どころ**。

| プロパティ | 条件 | captain | engineer | farmer | medic |
| --- | --- | --- | --- | --- | --- |
| blood | 常時 | 2.00（192） | 2.00（192） | 2.00（192） | 2.00（192） |
| satiety | 常時 | -16.00（-1536） | -16.00（-1536） | -16.00（-1536） | -16.00（-1536） |
| carbohydrate | 常時（輸送・在庫がある間） | -2.00（-192） | -2.00（-192） | -2.00（-192） | -2.00（-192） |
| body_fat | 常時（輸送・在庫がある間） | 3.50（336） | 3.50（336） | 3.50（336） | 3.50（336） |
| protein | 常時（輸送・在庫がある間） | -1.00（-96） | -1.00（-96） | -1.00（-96） | -1.00（-96） |
| lipid | 常時（輸送・在庫がある間） | -0.50（-48） | -0.50（-48） | -0.50（-48） | -0.50（-48） |
| vitamin | 常時 | -0.50（-48） | -0.50（-48） | -0.50（-48） | -0.50（-48） |
| hydration | 常時 | -1.00（-96） | -1.00（-96） | -1.00（-96） | -1.00（-96） |
| body_fat | 段 body_fat=starved | -0.50（-48） | -0.45（-43） | -0.60（-58） | -0.50（-48） |
| body_fat | 段 body_fat=gaunt | -0.70（-67） | -0.60（-58） | -0.90（-86） | -0.70（-67） |
| body_fat | 段 body_fat=nourished | -1.00（-96） | -0.88（-84） | -1.25（-120） | -1.00（-96） |
| body_fat | 段 body_fat=stout | -1.30（-125） | -1.15（-110） | -1.60（-154） | -1.30（-125） |
| body_fat | 段 body_fat=obese | -1.60（-154） | -1.40（-134） | -2.00（-192） | -1.60（-154） |
| wakefulness | 常時 | -1.00（-96） | -1.00（-96） | -1.00（-96） | -1.00（-96） |

## 5. 供給表（1工程あたり）

何かを生むか、値を動かす工程すべて。産出は1回の実行あたりの期待個数。
各オブジェクトのページにも同じ宣言があるので、ここは横断して見比べるための一覧。

`?` は、所要時間か分岐の重みが**定義だけでは決まらない**工程（相手の持ち物を見る
`{subject: dragged, prop: ...}` 参照など）。解けない重みは0として扱うので、その行の期待値は
残った候補へ寄っている——例えば `strike` の当たり方は武器が決めるため、ここでは出せない。

種別 `periodic` は時間で回る工程（罠の判定）。労働は0で、周期だけが経過する。
`transfer` の増減は宣言された上限で、実際に動く量は在庫と空きで目減りする。

| 宣言元 | 工程 | 種別 | 労働（分） | 周期（分） | 期待産出 | 値の増減 |
| --- | --- | --- | --- | --- | --- | --- |
| monkey | turn | interaction | 0 | 0 | bite_wound ×0.15、gore_wound ×0.00 | — |
| monkey | strike | interaction | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、monkey_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| monkey | blood.on_min | periodic | 0 | 24 | monkey_carcass ×1.00 | — |
| monkey | blood.on_min | periodic | 0 | 40 | monkey_carcass ×1.00 | — |
| monkey_carcass | butcher | interaction | 60 | 60 | raw_meat ×4.00、animal_bone ×1.00、rawhide ×1.00 | — |
| junglefowl | turn | interaction | 0 | 0 | bite_wound ×0.00、gore_wound ×0.00 | — |
| junglefowl | strike | interaction | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、junglefowl_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| junglefowl | blood.on_min | periodic | 0 | 5 | junglefowl_carcass ×1.00 | — |
| junglefowl | blood.on_min | periodic | 0 | 8 | junglefowl_carcass ×1.00 | — |
| rat | turn | interaction | 0 | 0 | bite_wound ×0.05、gore_wound ×0.00 | — |
| rat | strike | interaction | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、rat_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| rat | blood.on_min | periodic | 0 | 6 | rat_carcass ×1.00 | — |
| rat | blood.on_min | periodic | 0 | 0 | rat_carcass ×1.00 | — |
| rat | blood.on_min | periodic | 0 | 9 | rat_carcass ×1.00 | — |
| rat | blood.on_min | periodic | 0 | 1 | rat_carcass ×1.00 | — |
| rat | blood.on_min | periodic | 0 | 6 | rat_carcass ×1.00 | — |
| wild_boar | turn | interaction | 0 | 0 | bite_wound ×0.00、gore_wound ×0.40 | — |
| wild_boar | strike | interaction | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、wild_boar_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| wild_boar_carcass | butcher | interaction | 240 | 240 | raw_meat ×40.00、animal_bone ×6.00、rawhide ×6.00 | — |
| junglefowl_carcass | butcher | interaction | 20 | 20 | raw_meat ×1.00、feather ×1.00、small_bone ×1.00 | — |
| rat_carcass | cooking_progress.on_max | periodic | 0 | 90 | roasted_rat ×1.00 | — |
| rat_carcass | cooking_progress.on_max | periodic | 0 | 90 | roasted_rat ×1.00 | — |
| rat_carcass | cooking_progress.on_max | periodic | 0 | 90 | roasted_rat ×1.00 | — |
| roasted_rat | eat | interaction | 15 | 15 | small_bone ×1.00 | satiety +60.00、protein +3.00、lipid +1.00 |
| roasted_rat | cooking_progress.on_max | periodic | 0 | 60 | charred_lump ×1.00 | — |
| roasted_rat | cooking_progress.on_max | periodic | 0 | 60 | charred_lump ×1.00 | — |
| roasted_rat | cooking_progress.on_max | periodic | 0 | 60 | charred_lump ×1.00 | — |
| small_bone | whittle | interaction | 40 | 40 | bone_needle ×1.00 | — |
| raw_meat | eat | interaction | 15 | 15 | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 |
| raw_meat | cooking_progress.on_max | periodic | 0 | 360 | roasted_meat ×1.00 | — |
| raw_meat | cooking_progress.on_max | periodic | 0 | 360 | roasted_meat ×1.00 | — |
| raw_meat | cooking_progress.on_max | periodic | 0 | 360 | roasted_meat ×1.00 | — |
| roasted_meat | eat | interaction | 15 | 15 | — | satiety +450.00、protein +24.00、lipid +7.00 |
| roasted_meat | cooking_progress.on_max | periodic | 0 | 180 | charred_lump ×1.00 | — |
| roasted_meat | cooking_progress.on_max | periodic | 0 | 180 | charred_lump ×1.00 | — |
| roasted_meat | cooking_progress.on_max | periodic | 0 | 180 | charred_lump ×1.00 | — |
| charred_lump | eat | interaction | 15 | 15 | — | satiety +200.00 |
| captain | wait | interaction | 15 | 15 | — | （self）stamina +2.00 |
| captain | rest | interaction | 60 | 60 | — | （self）stamina +10.00 |
| captain | nap | interaction | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| captain | sleep | interaction | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| engineer | wait | interaction | 15 | 15 | — | （self）stamina +2.00 |
| engineer | rest | interaction | 60 | 60 | — | （self）stamina +10.00 |
| engineer | nap | interaction | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| engineer | sleep | interaction | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| farmer | wait | interaction | 15 | 15 | — | （self）stamina +2.00 |
| farmer | rest | interaction | 60 | 60 | — | （self）stamina +10.00 |
| farmer | nap | interaction | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| farmer | sleep | interaction | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| medic | wait | interaction | 15 | 15 | — | （self）stamina +2.00 |
| medic | rest | interaction | 60 | 60 | — | （self）stamina +10.00 |
| medic | nap | interaction | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| medic | sleep | interaction | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| palm_tree | pick_green_coconut | interaction | 30 | 30 | green_coconut ×1.80、sprained_ankle ×0.10 | — |
| palm_tree | pick_frond | interaction | 30 | 30 | palm_frond ×2.70、sprained_ankle ×0.10 | — |
| green_coconut | bore | interaction | 15 | 15 | drained_green_coconut ×1.00 | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 |
| drained_green_coconut | split | interaction | 15 | 15 | coconut_jelly ×2.00 | — |
| coconut_jelly | eat | interaction | 15 | 15 | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 |
| coconut | husk | interaction | 30 | 30 | husked_coconut ×1.00、coconut_husk ×1.00 | — |
| coconut_husk | light | interaction | 30 | 30 | burning_tinder ×0.71 | — |
| husked_coconut | crack | interaction | 15 | 15 | coconut_half ×2.00 | — |
| husked_coconut | pry_open | interaction | 15 | 15 | coconut_half ×2.00 | — |
| coconut_half | scrape | interaction | 30 | 30 | coconut_meat ×1.00、coconut_bowl ×1.00 | — |
| coconut_meat | eat | interaction | 15 | 15 | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 |
| woven_basket | woven | recipe | 120 | 120 | woven_basket ×1.00 | — |
| abaca | fell | interaction | 20 | 20 | banana_stem ×5.00 | — |
| banana_plant | fell | interaction | 20 | 20 | banana ×2.00、banana_stem ×2.00 | — |
| banana | eat | interaction | 15 | 15 | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 |
| banana_stem | strip | interaction | 30 | 30 | plant_fiber ×2.00 | — |
| plant_fiber | light | interaction | 30 | 30 | burning_tinder ×0.67 | — |
| plant_fiber | spin | interaction | 20 | 20 | yarn ×1.00 | — |
| yarn | ply | interaction | 20 | 20 | cord ×1.00 | — |
| rope | twisted | recipe | 60 | 60 | rope ×1.00 | — |
| fire_drill | carved | recipe | 60 | 60 | fire_drill ×1.00 | — |
| dry_grass | light | interaction | 30 | 30 | burning_tinder ×0.60 | — |
| hot_stone | boil | interaction | 5 | 5 | jar__content_hot_water_liquid ×1.00、stone ×1.00 | — |
| hot_stone | boil | interaction | 5 | 5 | coconut_bowl__content_hot_water_liquid ×1.00、stone ×1.00 | — |
| campfire | add_fuel | interaction | 1 | 1 | — | （self）fuel +999.00 |
| campfire | add_stone | interaction | 5 | 5 | — | （self）stones +1.00 |
| campfire | stacked | recipe | 15 | 15 | campfire ×1.00 | — |
| three_stone_hearth | add_fuel | interaction | 1 | 1 | — | （self）fuel +999.00 |
| three_stone_hearth | add_stone | interaction | 5 | 5 | — | （self）stones +1.00 |
| stone_hearth | add_fuel | interaction | 1 | 1 | — | （self）fuel +999.00 |
| water_spinach | eat | interaction | 15 | 15 | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 |
| coconut_crab | cooking_progress.on_max | periodic | 0 | 540 | roasted_coconut_crab ×1.00 | — |
| coconut_crab | cooking_progress.on_max | periodic | 0 | 540 | roasted_coconut_crab ×1.00 | — |
| coconut_crab | cooking_progress.on_max | periodic | 0 | 540 | roasted_coconut_crab ×1.00 | — |
| roasted_coconut_crab | eat | interaction | 15 | 15 | — | satiety +460.00、protein +28.00、lipid +9.00、vitamin +1.00 |
| roasted_coconut_crab | cooking_progress.on_max | periodic | 0 | 270 | charred_lump ×1.00 | — |
| roasted_coconut_crab | cooking_progress.on_max | periodic | 0 | 270 | charred_lump ×1.00 | — |
| roasted_coconut_crab | cooking_progress.on_max | periodic | 0 | 270 | charred_lump ×1.00 | — |
| taro | cooking_progress.on_max | periodic | 0 | 450 | roasted_taro ×1.00 | — |
| taro | cooking_progress.on_max | periodic | 0 | 450 | roasted_taro ×1.00 | — |
| taro | cooking_progress.on_max | periodic | 0 | 450 | roasted_taro ×1.00 | — |
| roasted_taro | eat | interaction | 15 | 15 | — | satiety +550.00、carbohydrate +48.00、protein +2.00、vitamin +24.00 |
| roasted_taro | cooking_progress.on_max | periodic | 0 | 225 | charred_lump ×1.00 | — |
| roasted_taro | cooking_progress.on_max | periodic | 0 | 225 | charred_lump ×1.00 | — |
| roasted_taro | cooking_progress.on_max | periodic | 0 | 225 | charred_lump ×1.00 | — |
| jar | collect_rain | interaction | 0 | 0 | jar__content_water_liquid ×1.00 | — |
| coconut_bowl | collect_rain | interaction | 0 | 0 | coconut_bowl__content_water_liquid ×1.00 | — |
| stone | knap | interaction | 60 | 60 | sharp_stone ×1.00 | — |
| stone | heat_soak.on_max | periodic | 0 | 180 | hot_stone ×1.00 | — |
| stone | heat_soak.on_max | periodic | 0 | 180 | hot_stone ×1.00 | — |
| stone | heat_soak.on_max | periodic | 0 | 180 | hot_stone ×1.00 | — |
| sandy_beach | explore | interaction | 15 | 15 | palm_tree ×0.12、woven_basket ×0.05、coconut_crab ×0.27、rat ×0.02、monkey ×0.04、coconut ×0.86、thick_branch ×0.63 | （self）exploration_progress +1.00 |
| rocky_coast | explore | interaction | 15 | 15 | cave_entrance ×0.13、coconut_crab ×0.38、rat ×0.02、stone ×1.23、thick_branch ×0.27 | （self）exploration_progress +1.00 |
| cliff_coast | explore | interaction | 15 | 15 | cave_entrance ×0.19、golden_chalice ×0.04、stone ×1.07、rat ×0.02、thick_branch ×0.24 | （self）exploration_progress +1.00 |
| grassland | explore | interaction | 15 | 15 | berry_bush ×0.11、spring ×0.08、rat ×0.02、junglefowl ×0.03、water_spinach ×0.85、taro ×0.59、dry_grass ×0.09、clay ×0.21 | （self）exploration_progress +1.00 |
| forest | explore | interaction | 15 | 15 | berry_bush ×0.17、spring ×0.07、rat ×0.02、monkey ×0.03、wild_boar ×0.02、broadleaf_tree ×0.10、twig ×1.10、taro ×0.22、banana_plant ×0.08、clay ×0.16 | （self）exploration_progress +1.00 |
| jungle | explore | interaction | 15 | 15 | palm_tree ×0.10、taro ×0.14、rat ×0.02、junglefowl ×0.02、monkey ×0.03、wild_boar ×0.02、broadleaf_tree ×0.08、twig ×0.52、coconut ×0.57、water_spinach ×0.20、abaca ×0.08、banana_plant ×0.06、clay ×0.13 | （self）exploration_progress +1.00 |
| rocky_field | explore | interaction | 15 | 15 | cave_entrance ×0.17、golden_chalice ×0.03、twig ×0.55、rat ×0.02、stone ×1.23 | （self）exploration_progress +1.00 |
| wasteland | explore | interaction | 15 | 15 | stone ×0.99、twig ×0.50、rat ×0.02、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| mountainside | explore | interaction | 15 | 15 | cave_entrance ×0.14、golden_chalice ×0.03、berry_bush ×0.21、rat ×0.02、stone ×0.98、twig ×0.62 | （self）exploration_progress +1.00 |
| mountain_peak | explore | interaction | 15 | 15 | cave_entrance ×0.36、stone ×1.19、rat ×0.02 | （self）exploration_progress +1.00 |
| unfired_jar | coiled | recipe | 90 | 90 | unfired_jar ×1.00 | — |
| unfired_jar | cooking_progress.on_max | periodic | 0 | 1800 | jar ×0.50 | — |
| earth_kiln | add_fuel | interaction | 1 | 1 | — | （self）fuel +999.00 |
| earth_kiln | heaped | recipe | 90 | 90 | earth_kiln ×1.00 | — |
| broadleaf_tree | fell | interaction | 240 | 240 | log ×2.00、thick_branch ×3.00 | — |
| stone_axe | hafted | recipe | 180 | 180 | stone_axe ×1.00 | — |
| snare | add_plant_bait | interaction | 1 | 1 | — | （self）plant_bait +999.00 |
| snare | add_meat_bait | interaction | 1 | 1 | — | （self）meat_bait +999.00 |
| snare | knotted | recipe | 30 | 30 | snare ×1.00 | — |
| snare | catch_remaining.on_min | periodic | 0 | 240 | junglefowl ×0.07、snare_laceration ×0.18、rat ×0.11 | （self）catch_remaining +16.00 |
| raft | lashed | recipe | 420 | 420 | raft ×1.00 | — |
| rawhide_sail | sewn | recipe | 420 | 420 | rawhide_sail ×1.00 | — |
| palm_frond | weave | interaction | 90 | 90 | woven_leaf ×1.00 | — |
| palm_frond | split_and_weave | interaction | 60 | 60 | woven_leaf ×2.00 | — |
| jar__content_water_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_water_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_water_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_water_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_water_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |
| jar__content_water_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、（self）fill -250.00 |
| jar__content_hot_water_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、（self）fill -250.00 |
| jar__content_tea_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_tea_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_tea_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_tea_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_tea_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |
| jar__content_tea_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、wakefulness +2.00、（self）fill -250.00 |
| jar__content_oil_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_oil_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_oil_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_oil_liquid ×1.00 | （self）fill -999999.00 |
| jar__content_oil_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |
| coconut_bowl__content_water_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_water_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_water_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_water_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_water_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |
| coconut_bowl__content_water_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、（self）fill -250.00 |
| coconut_bowl__content_hot_water_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、（self）fill -250.00 |
| coconut_bowl__content_tea_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_tea_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_tea_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_tea_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_tea_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |
| coconut_bowl__content_tea_liquid | drink | interaction | 3 | 3 | — | hydration +10.00、wakefulness +2.00、（self）fill -250.00 |
| coconut_bowl__content_oil_liquid | pour_into_empty | interaction | 0 | 0 | jar__content_oil_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_oil_liquid | pour_into_empty | interaction | 0 | 0 | coconut_bowl__content_oil_liquid ×1.00 | （self）fill -999999.00 |
| coconut_bowl__content_oil_liquid | pour_into_filled | interaction | 0 | 0 | — | （self）fill +999999.00 |


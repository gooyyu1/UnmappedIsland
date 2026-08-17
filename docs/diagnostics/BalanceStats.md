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
（`add: {parent: ...}`）。値が range の端を割った瞬間に、その型自身の `on_overflow`/
`on_shortfall` が生肉を焼けた肉へ、獲物を死体へ置き換える。

どちらも「1回で終わる待ち生産」なので、労働0・経過時間ありの工程として連鎖表に載せ、
押し手（炉・傷）は**要る道具**として前提の列に出す。誰が誰の隣に立てるかは、枠の
`accept` だけで判断する——炉の火の枠が `roastable` を受けるから、そこへ入る物は焼ける。

**押し手が止まるまでに動かせる総量**も数える。出血は傷の `bleeding` が尽きれば止まるので、
罠の傷（-15/tick × 2 tick = 30mL）ではネズミ（血6mL）は死ぬがヤケイ（80mL）は死なない。
届かない組み合わせはその工程を立てない。

一撃で端まで押す効果も同じ引き金を引く。仕留めの一撃（`set: {self: {blood: 0}}`）は
血を空にするだけで、死体を生むのは `blood` の `on_shortfall` ——工程の結果にこれを
畳まないと、イノシシの死体（血4,600mLで失血死には届かない）の作り方がどこにも無くなる。
確率でしか消えない入力は、**その確率ぶんだけ**消費されるものとして数える（21回に1回
しか仕留められないなら、1回の実行に要る獲物は0.048匹）。

### この表が数えていないもの

- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。
  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。
- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは
  宣言値だけなので、罠のレートは**餌なし**の値。
- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。
  そのため水を汲む経路は労働0分になる——1節の「数えられない経路」へ分けてある。
- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。
- **炉の薪。** 焼くには火を保たなければならないが、そのぶんの薪は数えていない。炉は
  前提（道具）としてだけ出る。
- **どの武器を重ねたか。** 一撃の当たり所の配分は武器が宣言する（`{subject: dragged}` の
  重み）ので、重ねる相手を決めないと配分が決まらない。ここでは**その値を最も高く宣言して
  いる型を重ねた**として読むため、配分は「分岐ごとに最も良い武器を選べる場合」のものになる
  ——1本の武器では出ない配分で、仕留めの確率は実際より低く出る。

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

> **1日を賄う最小労働: 608 分**（1440分の 42.2%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.eat | 2.56 | 96 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.06 | 0.04 | 0.03 | 96 | 6.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.10 | 0.05 | 0.05 | 158 | 10.9% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| rocky_coast.explore → coconut_crab.eat | 0.11 | 0.08 | 0.03 | 167 | 11.6% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 0.11 | 0.03 | 0.08 | 171 | 11.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat | 0.12 | 0.04 | 0.09 | 190 | 13.2% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 0.15 | 0.03 | 0.12 | 229 | 15.9% | 22.8 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| forest.explore → banana_plant.fell → banana.eat | 0.32 | 0.24 | 0.07 | 485 | 33.7% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 0.50 | 0.09 | 0.41 | 764 | 53.1% | 75.8 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.37 | 0.19 | 0.18 | 18 | 1.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.eat | 1.04 | 0.63 | 0.42 | 50 | 3.5% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat | 3.16 | 2.45 | 0.71 | 152 | 10.5% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| rocky_coast.explore → coconut_crab.eat | 27.12 | 19.62 | 7.50 | 1302 | 90.4% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 27.88 | 8.56 | 19.31 | 1338 | 92.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.90 | 0.54 | 0.36 | 86 | 6.0% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| rocky_coast.explore → coconut_crab.eat | 1.64 | 1.19 | 0.45 | 158 | 11.0% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat | 1.80 | 0.55 | 1.25 | 173 | 12.0% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 2.32 | 0.71 | 1.61 | 223 | 15.5% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 5.97 | 1.08 | 4.89 | 573 | 39.8% | 56.9 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 7.46 | 1.35 | 6.11 | 716 | 49.7% | 71.1 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| forest.explore → banana_plant.fell → banana.eat | 11.06 | 8.56 | 2.50 | 1062 | 73.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| grassland.explore → water_spinach.eat | 30.80 | 15.80 | 15.00 | 2956 | 205.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### sandy_beach

> **1日を賄う最小労働: 840 分**（1440分の 58.3%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 3.07 | 215 |
| palm_tree.pick_green_coconut → green_coconut.bore | 8.37 | 265 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 0.14 | 0.11 | 0.03 | 215 | 14.9% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| sandy_beach.explore → coconut_crab.eat | 34.91 | 27.41 | 7.50 | 1676 | 116.4% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 2.12 | 1.66 | 0.45 | 203 | 14.1% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### rocky_coast

> **1日を賄う最小労働: 1662 分**（1440分の 115.4%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 24.00 | 1302 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 0.11 | 0.08 | 0.03 | 167 | 11.6% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 27.12 | 19.62 | 7.50 | 1302 | 90.4% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 1.64 | 1.19 | 0.45 | 158 | 11.0% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

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

> **1日を賄う最小労働: 456 分**（1440分の 31.7%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.eat | 2.56 | 96 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.06 | 0.04 | 0.03 | 96 | 6.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.10 | 0.05 | 0.05 | 158 | 10.9% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.37 | 0.19 | 0.18 | 18 | 1.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.eat | 1.04 | 0.63 | 0.42 | 50 | 3.5% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.90 | 0.54 | 0.36 | 86 | 6.0% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 30.80 | 15.80 | 15.00 | 2956 | 205.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### forest

> **1日を賄う最小労働: 621 分**（1440分の 43.1%）
> この土地を起点にできない値: hydration（島全体の節を参照）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 3.07 | 171 |
| forest.explore → taro.eat | 1.16 | 90 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 0.11 | 0.03 | 0.08 | 171 | 11.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat ‡ | 0.12 | 0.04 | 0.09 | 190 | 13.2% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → taro.eat | 0.13 | 0.10 | 0.03 | 198 | 13.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 0.13 | 0.02 | 0.11 | 205 | 14.3% | 20.4 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.6分）、snare（100.8分） |
| forest.explore → banana_plant.fell → banana.eat ‡ | 0.32 | 0.24 | 0.07 | 485 | 33.7% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 0.45 | 0.07 | 0.37 | 685 | 47.6% | 68.0 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.6分）、snare（100.8分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 2.15 | 1.73 | 0.42 | 103 | 7.2% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat ‡ | 3.16 | 2.45 | 0.71 | 152 | 10.5% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 27.88 | 8.56 | 19.31 | 1338 | 92.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat ‡ | 1.80 | 0.55 | 1.25 | 173 | 12.0% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| forest.explore → taro.eat | 1.84 | 1.48 | 0.36 | 177 | 12.3% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 2.32 | 0.71 | 1.61 | 223 | 15.5% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 5.35 | 0.86 | 4.49 | 514 | 35.7% | 51.0 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.6分）、snare（100.8分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 6.69 | 1.07 | 5.62 | 642 | 44.6% | 63.7 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.6分）、snare（100.8分） |
| forest.explore → banana_plant.fell → banana.eat ‡ | 11.06 | 8.56 | 2.50 | 1062 | 73.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### jungle

> **1日を賄う最小労働: 749 分**（1440分の 52.0%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat | 3.07 | 171 |
| jungle.explore → water_spinach.eat | 0.50 | 43 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat | 0.39 | 22 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 0.11 | 0.03 | 0.08 | 171 | 11.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat ‡ | 0.12 | 0.04 | 0.09 | 190 | 13.2% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 0.15 | 0.03 | 0.12 | 226 | 15.7% | 22.4 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| jungle.explore → taro.eat | 0.19 | 0.17 | 0.03 | 295 | 20.5% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| jungle.explore → water_spinach.eat | 0.29 | 0.24 | 0.05 | 441 | 30.6% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 0.32 | 0.24 | 0.07 | 485 | 33.7% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 585 | 40.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 0.49 | 0.09 | 0.40 | 752 | 52.2% | 74.6 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → water_spinach.eat | 1.04 | 0.86 | 0.18 | 50 | 3.5% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 3.16 | 2.45 | 0.71 | 152 | 10.5% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| jungle.explore → taro.eat | 3.20 | 2.78 | 0.42 | 154 | 10.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.89 | 1.25 | 9.64 | 523 | 36.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 27.88 | 8.56 | 19.31 | 1338 | 92.9% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.71 | 1.46 | 11.25 | 1220 | 84.7% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow → roasted_meat.eat ‡ | 1.80 | 0.55 | 1.25 | 173 | 12.0% | — | satiety +450.00、protein +24.00、lipid +7.00 | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.31 | 0.26 | 2.05 | 222 | 15.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.2分）、stone（12.2分・他の土地で） |
| jungle.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.eat ‡ | 2.32 | 0.71 | 1.61 | 223 | 15.5% | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| jungle.explore → taro.eat | 2.74 | 2.39 | 0.36 | 263 | 18.3% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow → charred_lump.eat | 5.87 | 1.05 | 4.83 | 564 | 39.2% | 56.0 | satiety +200.00、protein +4.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | 7.34 | 1.31 | 6.03 | 705 | 48.9% | 70.0 | satiety +60.00、protein +3.00、lipid +1.00 | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 11.06 | 8.56 | 2.50 | 1062 | 73.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.2分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.2分）、palm_tree（147.0分） |
| jungle.explore → water_spinach.eat | 86.13 | 71.13 | 15.00 | 8268 | 574.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

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

### 島全体で入手経路が無いもの

島のどこを探しても作れも見つかりもしないもの。定義の穴で、これが下の経路を塞いでいる。

- **jar** — 1経路を塞いでいる
  - `jar.collect_rain → water_liquid.drink`（hydration +10.00）
- **tea_liquid** — 1経路を塞いでいる
  - `tea_liquid.drink`（hydration +10.00、wakefulness +2.00）

## 2. オブジェクトの総コスト

1つ手に入れるまでの労働を、素材の採集から数えたもの。組み立ての時間だけではない
——筏は組むのに420分だが、丸太と縄を揃えるところから数えると桁が変わる。

「日数」は、生存に要る労働を引いた残り（1日の余剰時間）で割った日数。**目標までに
何日かかるか**がこれで出る。道具（前提）の時間は総コストに含めない（#550のまま）。

土地・キャラクタ・単独で存在できない物（怪我・道）・製作中オブジェクトは、手に入れると
いう言い方が成り立たないので対象外。

### 入手経路が無いもの

島のどこにも作り方も見つけ方も無い。**足りない入力**まで出すので、そのまま埋めるべき穴になる。

| オブジェクト | 足りない入力 |
| --- | --- |
| three_stone_hearth | 作る工程が無い |
| stone_hearth | 作る工程が無い |
| canteen | 作る工程が無い |
| pot | 作る工程が無い |
| bottle | 作る工程が無い |
| jar | 作る工程が無い |
| spear | 作る工程が無い |
| bandage | 作る工程が無い |

### 総コスト

| オブジェクト | 総労働（分） | 探索 | それ以外 | 日数 | 作り方 | 前提 |
| --- | --- | --- | --- | --- | --- | --- |
| monkey | 397.5 | 397.5 | 0.0 | 0.48 | sandy_beach.explore | — |
| monkey_carcass | 397.5 | 397.5 | 0.0 | 0.48 | sandy_beach.explore → monkey.blood.on_shortfall | puncture_wound（65.4分） |
| junglefowl | 24.2 | 8.8 | 15.4 | 0.03 | snare.catch_remaining.on_shortfall | snare（100.8分） |
| rat | 14.8 | 5.4 | 9.4 | 0.02 | snare.catch_remaining.on_shortfall | snare（100.8分） |
| wild_boar | 685.0 | 685.0 | 0.0 | 0.82 | forest.explore | — |
| wild_boar_carcass | 1390.0 | 685.0 | 705.0 | 1.67 | forest.explore → wild_boar.strike | weapon → sharp_stone（72.2分） |
| junglefowl_carcass | 24.2 | 8.8 | 15.4 | 0.03 | snare.catch_remaining.on_shortfall → junglefowl.blood.on_shortfall | puncture_wound（65.4分）、snare（100.8分） |
| rat_carcass | 14.8 | 5.4 | 9.4 | 0.02 | snare.catch_remaining.on_shortfall → rat.blood.on_shortfall | laceration（27.7分）、snare（100.8分） |
| roasted_rat | 14.8 | 5.4 | 9.4 | 0.02 | snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| feather | 44.2 | 8.8 | 35.4 | 0.05 | snare.catch_remaining.on_shortfall → junglefowl.blood.on_shortfall → junglefowl_carcass.butcher | cutting_tool → sharp_stone（72.2分）、puncture_wound（65.4分）、snare（100.8分） |
| small_bone | 29.8 | 5.4 | 24.4 | 0.04 | snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| raw_meat | 40.8 | 17.1 | 23.6 | 0.05 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| roasted_meat | 40.8 | 17.1 | 23.6 | 0.05 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher → raw_meat.cooking_progress.on_overflow | campfire（52.6分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| charred_lump | 14.8 | 5.4 | 9.4 | 0.02 | snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.cooking_progress.on_overflow | campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| animal_bone | 271.7 | 114.2 | 157.5 | 0.33 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| rawhide | 271.7 | 114.2 | 157.5 | 0.33 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher | cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
| golden_chalice | 397.5 | 397.5 | 0.0 | 0.48 | cliff_coast.explore | — |
| palm_tree | 122.3 | 122.3 | 0.0 | 0.15 | sandy_beach.explore | — |
| green_coconut | 16.7 | 0.0 | 16.7 | 0.02 | palm_tree.pick_green_coconut | palm_tree（122.3分） |
| drained_green_coconut | 31.7 | 0.0 | 31.7 | 0.04 | palm_tree.pick_green_coconut → green_coconut.bore | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| coconut_jelly | 23.3 | 0.0 | 23.3 | 0.03 | palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split | cutting_tool → sharp_stone（72.2分）、palm_tree（122.3分） |
| coconut | 17.5 | 17.5 | 0.0 | 0.02 | sandy_beach.explore | — |
| coconut_husk | 47.5 | 17.5 | 30.0 | 0.06 | sandy_beach.explore → coconut.husk | cutting_tool → sharp_stone（72.2分） |
| husked_coconut | 47.5 | 17.5 | 30.0 | 0.06 | sandy_beach.explore → coconut.husk | cutting_tool → sharp_stone（72.2分） |
| coconut_half | 31.2 | 8.7 | 22.5 | 0.04 | sandy_beach.explore → coconut.husk → husked_coconut.crack | stone（12.2分）、cutting_tool → sharp_stone（72.2分） |
| coconut_meat | 61.2 | 8.7 | 52.5 | 0.07 | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| woven_basket | 318.0 | 318.0 | 0.0 | 0.38 | sandy_beach.explore | — |
| abaca | 183.8 | 183.8 | 0.0 | 0.22 | jungle.explore | — |
| banana_plant | 171.3 | 171.3 | 0.0 | 0.21 | forest.explore | — |
| banana | 95.6 | 85.6 | 10.0 | 0.11 | forest.explore → banana_plant.fell | cutting_tool → sharp_stone（72.2分） |
| banana_stem | 40.8 | 36.8 | 4.0 | 0.05 | jungle.explore → abaca.fell | cutting_tool → sharp_stone（72.2分） |
| plant_fiber | 35.4 | 18.4 | 17.0 | 0.04 | jungle.explore → abaca.fell → banana_stem.strip | cutting_tool → sharp_stone（72.2分） |
| yarn | 90.8 | 36.8 | 54.0 | 0.11 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin | cutting_tool → sharp_stone（72.2分） |
| cord | 201.5 | 73.5 | 128.0 | 0.24 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply | cutting_tool → sharp_stone（72.2分） |
| rope | 664.5 | 220.5 | 444.0 | 0.80 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted | cutting_tool → sharp_stone（72.2分） |
| fire_drill | 96.3 | 36.3 | 60.0 | 0.12 | sandy_beach.explore → forest.explore → fire_drill.carved | — |
| dry_grass | 142.5 | 142.5 | 0.0 | 0.17 | wasteland.explore | — |
| burning_tinder | 98.1 | 27.6 | 70.5 | 0.12 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.light | fire_drill（96.3分）、cutting_tool → sharp_stone（72.2分） |
| campfire | 52.6 | 37.6 | 15.0 | 0.06 | forest.explore → campfire.stacked | — |
| water_spinach | 15.8 | 15.8 | 0.0 | 0.02 | grassland.explore | — |
| coconut_crab | 39.2 | 39.2 | 0.0 | 0.05 | rocky_coast.explore | — |
| taro | 22.6 | 22.6 | 0.0 | 0.03 | grassland.explore | — |
| coconut_bowl | 61.2 | 8.7 | 52.5 | 0.07 | sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape | cutting_tool → sharp_stone（72.2分）、stone（12.2分） |
| thick_branch | 23.7 | 23.7 | 0.0 | 0.03 | sandy_beach.explore | — |
| stone | 12.2 | 12.2 | 0.0 | 0.01 | rocky_field.explore | — |
| twig | 12.5 | 12.5 | 0.0 | 0.02 | forest.explore | — |
| berry_bush | 71.6 | 71.6 | 0.0 | 0.09 | mountainside.explore | — |
| cave_entrance | 41.4 | 41.4 | 0.0 | 0.05 | mountain_peak.explore | — |
| spring | 178.5 | 178.5 | 0.0 | 0.21 | grassland.explore | — |
| broadleaf_tree | 137.0 | 137.0 | 0.0 | 0.16 | forest.explore | — |
| log | 188.5 | 68.5 | 120.0 | 0.23 | forest.explore → broadleaf_tree.fell | chopping_tool → stone_axe（477.4分） |
| sharp_stone | 72.2 | 12.2 | 60.0 | 0.09 | rocky_field.explore → stone.knap | — |
| stone_axe | 477.4 | 109.4 | 368.0 | 0.57 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rocky_field.explore → stone.knap → sandy_beach.explore → stone_axe.hafted | — |
| bone_needle | 69.8 | 5.4 | 64.4 | 0.08 | snare.catch_remaining.on_shortfall → rat.blood.on_shortfall → rat_carcass.cooking_progress.on_overflow → roasted_rat.eat → small_bone.whittle | cutting_tool → sharp_stone（72.2分）、campfire（52.6分）、laceration（27.7分）、snare（100.8分） |
| snare | 100.8 | 36.8 | 64.0 | 0.12 | jungle.explore → abaca.fell → banana_stem.strip → snare.knotted | cutting_tool → sharp_stone（72.2分） |
| raft | 4209.0 | 1713.0 | 2496.0 | 5.06 | jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted → forest.explore → broadleaf_tree.fell → raft.lashed | chopping_tool → stone_axe（477.4分）、cutting_tool → sharp_stone（72.2分） |
| rawhide_sail | 4334.0 | 1541.0 | 2793.0 | 5.21 | forest.explore → wild_boar.strike → wild_boar_carcass.butcher → jungle.explore → abaca.fell → banana_stem.strip → plant_fiber.spin → yarn.ply → rope.twisted → sandy_beach.explore → rawhide_sail.sewn | sewing_tool → bone_needle（69.8分）、cutting_tool → sharp_stone（72.2分）、weapon → sharp_stone（72.2分） |
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
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 100.8 | 24.18 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 100.8 | 14.85 |

### sandy_beach

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### rocky_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### cliff_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### grassland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 100.8 | 24.18 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 100.8 | 14.85 |

### forest

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.143 | 0.86 | 10.0 | 8.6 | 100.8 | 11.75 |

### jungle

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.061 | 0.36 | 10.0 | 3.6 | 100.8 | 27.71 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.117 | 0.70 | 10.0 | 7.0 | 100.8 | 14.37 |

### rocky_field

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### wasteland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### mountainside

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

### mountain_peak

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 100.8 | 15.11 |

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
| monkey | turn | action | 0 | 0 | bite_wound ×0.15、gore_wound ×0.00 | — |
| monkey | strike | combination | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、monkey_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| monkey | blood.on_shortfall | periodic | 0 | 30 | monkey_carcass ×1.00 | — |
| monkey | blood.on_shortfall | periodic | 0 | 40 | monkey_carcass ×1.00 | — |
| monkey_carcass | butcher | combination | 60 | 60 | raw_meat ×4.00、animal_bone ×1.00、rawhide ×1.00 | — |
| junglefowl | turn | action | 0 | 0 | bite_wound ×0.00、gore_wound ×0.00 | — |
| junglefowl | strike | combination | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、junglefowl_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| junglefowl | blood.on_shortfall | periodic | 0 | 6 | junglefowl_carcass ×1.00 | — |
| junglefowl | blood.on_shortfall | periodic | 0 | 8 | junglefowl_carcass ×1.00 | — |
| rat | turn | action | 0 | 0 | bite_wound ×0.05、gore_wound ×0.00 | — |
| rat | strike | combination | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、rat_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| rat | blood.on_shortfall | periodic | 0 | 6 | rat_carcass ×1.00 | — |
| rat | blood.on_shortfall | periodic | 0 | 0 | rat_carcass ×1.00 | — |
| rat | blood.on_shortfall | periodic | 0 | 9 | rat_carcass ×1.00 | — |
| rat | blood.on_shortfall | periodic | 0 | 1 | rat_carcass ×1.00 | — |
| rat | blood.on_shortfall | periodic | 0 | 6 | rat_carcass ×1.00 | — |
| wild_boar | turn | action | 0 | 0 | bite_wound ×0.00、gore_wound ×0.40 | — |
| wild_boar | strike | combination | 15 | 15 | laceration ×0.55、puncture_wound ×0.23、wild_boar_carcass ×0.02 | （self）wariness +24.47、（self）shock +79.79 |
| wild_boar_carcass | butcher | combination | 240 | 240 | raw_meat ×40.00、animal_bone ×6.00、rawhide ×6.00 | — |
| junglefowl_carcass | butcher | combination | 20 | 20 | raw_meat ×1.00、feather ×1.00、small_bone ×1.00 | — |
| rat_carcass | cooking_progress.on_overflow | periodic | 0 | 105 | roasted_rat ×1.00 | — |
| rat_carcass | cooking_progress.on_overflow | periodic | 0 | 105 | roasted_rat ×1.00 | — |
| rat_carcass | cooking_progress.on_overflow | periodic | 0 | 105 | roasted_rat ×1.00 | — |
| roasted_rat | eat | action | 15 | 15 | small_bone ×1.00 | satiety +60.00、protein +3.00、lipid +1.00 |
| roasted_rat | cooking_progress.on_overflow | periodic | 0 | 75 | charred_lump ×1.00 | — |
| roasted_rat | cooking_progress.on_overflow | periodic | 0 | 75 | charred_lump ×1.00 | — |
| roasted_rat | cooking_progress.on_overflow | periodic | 0 | 75 | charred_lump ×1.00 | — |
| small_bone | whittle | combination | 40 | 40 | bone_needle ×1.00 | — |
| raw_meat | eat | action | 15 | 15 | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 |
| raw_meat | cooking_progress.on_overflow | periodic | 0 | 375 | roasted_meat ×1.00 | — |
| raw_meat | cooking_progress.on_overflow | periodic | 0 | 375 | roasted_meat ×1.00 | — |
| raw_meat | cooking_progress.on_overflow | periodic | 0 | 375 | roasted_meat ×1.00 | — |
| roasted_meat | eat | action | 15 | 15 | — | satiety +450.00、protein +24.00、lipid +7.00 |
| roasted_meat | cooking_progress.on_overflow | periodic | 0 | 195 | charred_lump ×1.00 | — |
| roasted_meat | cooking_progress.on_overflow | periodic | 0 | 195 | charred_lump ×1.00 | — |
| roasted_meat | cooking_progress.on_overflow | periodic | 0 | 195 | charred_lump ×1.00 | — |
| charred_lump | eat | action | 15 | 15 | — | satiety +200.00、protein +4.00、lipid +1.00 |
| captain | wait | action | 15 | 15 | — | （self）stamina +2.00 |
| captain | rest | action | 60 | 60 | — | （self）stamina +10.00 |
| captain | nap | action | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| captain | sleep | action | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| engineer | wait | action | 15 | 15 | — | （self）stamina +2.00 |
| engineer | rest | action | 60 | 60 | — | （self）stamina +10.00 |
| engineer | nap | action | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| engineer | sleep | action | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| farmer | wait | action | 15 | 15 | — | （self）stamina +2.00 |
| farmer | rest | action | 60 | 60 | — | （self）stamina +10.00 |
| farmer | nap | action | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| farmer | sleep | action | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| medic | wait | action | 15 | 15 | — | （self）stamina +2.00 |
| medic | rest | action | 60 | 60 | — | （self）stamina +10.00 |
| medic | nap | action | 180 | 180 | — | （self）stamina +36.00、（self）wakefulness +36.00 |
| medic | sleep | action | 360 | 360 | — | （self）stamina +90.00、（self）wakefulness +96.00 |
| palm_tree | pick_green_coconut | action | 30 | 30 | green_coconut ×1.80、sprained_ankle ×0.10 | — |
| palm_tree | pick_frond | action | 30 | 30 | palm_frond ×2.70、sprained_ankle ×0.10 | — |
| green_coconut | bore | combination | 15 | 15 | drained_green_coconut ×1.00 | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 |
| drained_green_coconut | split | combination | 15 | 15 | coconut_jelly ×2.00 | — |
| coconut_jelly | eat | action | 15 | 15 | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 |
| coconut | husk | combination | 30 | 30 | husked_coconut ×1.00、coconut_husk ×1.00 | — |
| coconut_husk | light | combination | 30 | 30 | burning_tinder ×0.71 | — |
| husked_coconut | crack | combination | 15 | 15 | coconut_half ×2.00 | — |
| husked_coconut | pry_open | combination | 15 | 15 | coconut_half ×2.00 | — |
| coconut_half | scrape | combination | 30 | 30 | coconut_meat ×1.00、coconut_bowl ×1.00 | — |
| coconut_meat | eat | action | 15 | 15 | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 |
| woven_basket | woven | recipe | 120 | 120 | woven_basket ×1.00 | — |
| abaca | fell | combination | 20 | 20 | banana_stem ×5.00 | — |
| banana_plant | fell | combination | 20 | 20 | banana ×2.00、banana_stem ×2.00 | — |
| banana | eat | action | 15 | 15 | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 |
| banana_stem | strip | combination | 30 | 30 | plant_fiber ×2.00 | — |
| plant_fiber | light | combination | 30 | 30 | burning_tinder ×0.67 | — |
| plant_fiber | spin | combination | 20 | 20 | yarn ×1.00 | — |
| yarn | ply | combination | 20 | 20 | cord ×1.00 | — |
| rope | twisted | recipe | 60 | 60 | rope ×1.00 | — |
| fire_drill | carved | recipe | 60 | 60 | fire_drill ×1.00 | — |
| dry_grass | light | combination | 30 | 30 | burning_tinder ×0.60 | — |
| campfire | add_fuel | combination | 1 | 1 | — | （self）fuel +999.00 |
| campfire | add_stone | combination | 5 | 5 | — | （self）stones +1.00 |
| campfire | stacked | recipe | 15 | 15 | campfire ×1.00 | — |
| three_stone_hearth | add_fuel | combination | 1 | 1 | — | （self）fuel +999.00 |
| three_stone_hearth | add_stone | combination | 5 | 5 | — | （self）stones +1.00 |
| stone_hearth | add_fuel | combination | 1 | 1 | — | （self）fuel +999.00 |
| water_spinach | eat | action | 15 | 15 | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 |
| coconut_crab | eat | action | 15 | 15 | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 |
| taro | eat | action | 15 | 15 | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 |
| jar | collect_rain | action | 0 | 0 | water_liquid ×1.00 | — |
| coconut_bowl | collect_rain | action | 0 | 0 | water_liquid ×1.00 | — |
| water_liquid | drink | action | 3 | 3 | — | hydration +10.00、（self）volume -250.00 |
| tea_liquid | drink | action | 3 | 3 | — | hydration +10.00、wakefulness +2.00、（self）volume -250.00 |
| stone | knap | combination | 60 | 60 | sharp_stone ×1.00 | — |
| sandy_beach | explore | action | 15 | 15 | palm_tree ×0.12、woven_basket ×0.05、coconut_crab ×0.27、rat ×0.02、monkey ×0.04、coconut ×0.86、thick_branch ×0.63 | （self）exploration_progress +1.00 |
| rocky_coast | explore | action | 15 | 15 | cave_entrance ×0.13、coconut_crab ×0.38、rat ×0.02、stone ×1.23、thick_branch ×0.27 | （self）exploration_progress +1.00 |
| cliff_coast | explore | action | 15 | 15 | cave_entrance ×0.19、golden_chalice ×0.04、stone ×1.07、rat ×0.02、thick_branch ×0.24 | （self）exploration_progress +1.00 |
| grassland | explore | action | 15 | 15 | berry_bush ×0.13、spring ×0.08、rat ×0.03、junglefowl ×0.03、water_spinach ×0.95、taro ×0.66、dry_grass ×0.10 | （self）exploration_progress +1.00 |
| forest | explore | action | 15 | 15 | berry_bush ×0.18、spring ×0.07、rat ×0.02、monkey ×0.03、wild_boar ×0.02、broadleaf_tree ×0.11、twig ×1.20、taro ×0.24、banana_plant ×0.09 | （self）exploration_progress +1.00 |
| jungle | explore | action | 15 | 15 | palm_tree ×0.10、taro ×0.15、rat ×0.02、junglefowl ×0.02、monkey ×0.03、wild_boar ×0.02、broadleaf_tree ×0.08、twig ×0.56、coconut ×0.61、water_spinach ×0.21、abaca ×0.08、banana_plant ×0.07 | （self）exploration_progress +1.00 |
| rocky_field | explore | action | 15 | 15 | cave_entrance ×0.17、golden_chalice ×0.03、twig ×0.55、rat ×0.02、stone ×1.23 | （self）exploration_progress +1.00 |
| wasteland | explore | action | 15 | 15 | stone ×0.99、twig ×0.50、rat ×0.02、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| mountainside | explore | action | 15 | 15 | cave_entrance ×0.14、golden_chalice ×0.03、berry_bush ×0.21、rat ×0.02、stone ×0.98、twig ×0.62 | （self）exploration_progress +1.00 |
| mountain_peak | explore | action | 15 | 15 | cave_entrance ×0.36、stone ×1.19、rat ×0.02 | （self）exploration_progress +1.00 |
| broadleaf_tree | fell | combination | 240 | 240 | log ×2.00、thick_branch ×3.00 | — |
| stone_axe | hafted | recipe | 180 | 180 | stone_axe ×1.00 | — |
| snare | add_plant_bait | combination | 1 | 1 | — | （self）plant_bait +999.00 |
| snare | add_meat_bait | combination | 1 | 1 | — | （self）meat_bait +999.00 |
| snare | knotted | recipe | 30 | 30 | snare ×1.00 | — |
| snare | catch_remaining.on_shortfall | periodic | 0 | 240 | junglefowl ×0.07、snare_laceration ×0.18、rat ×0.11 | （self）catch_remaining +16.00 |
| raft | lashed | recipe | 420 | 420 | raft ×1.00 | — |
| rawhide_sail | sewn | recipe | 420 | 420 | rawhide_sail ×1.00 | — |
| palm_frond | weave | action | 90 | 90 | woven_leaf ×1.00 | — |
| palm_frond | split_and_weave | combination | 60 | 60 | woven_leaf ×2.00 | — |


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

### この表が数えていないもの

- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。
  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。
- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは
  宣言値だけなので、罠のレートは**餌なし**の値。
- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。
  そのため水を汲む経路は労働0分になる——1節の「数えられない経路」へ分けてある。
- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。
- **獲物が死体に変わるまで。** 罠に掛かった獲物を殺すのは、刺さった傷が**親へ**与える出血
  （`snare_laceration` の `add: {parent: {blood: -15}}`）で、しかも傷の `bleeding` が尽きる
  数tickだけ効く。「傷の勢い×効いている長さ」と「獲物の血の量」の勝負なので、tick毎の
  増減を1つ足すだけでは決まらない。そのため待ち生産表の産物（獲物）は連鎖表へ繋がっておらず、
  連鎖表の「設備数」列は今のところ全て空になる。

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

> **1日を賄う最小労働: 605 分**（1440分の 42.0%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.eat | 2.56 | 93 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.06 | 0.04 | 0.03 | 93 | 6.4% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.10 | 0.05 | 0.05 | 153 | 10.6% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| rocky_coast.explore → coconut_crab.eat | 0.11 | 0.08 | 0.03 | 164 | 11.4% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| forest.explore → banana_plant.fell → banana.eat | 0.30 | 0.23 | 0.07 | 458 | 31.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.38 | 0.04 | 0.34 | 582 | 40.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.36 | 0.18 | 0.18 | 17 | 1.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.eat | 1.01 | 0.59 | 0.42 | 48 | 3.4% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat | 2.98 | 2.27 | 0.71 | 143 | 9.9% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.82 | 1.18 | 9.64 | 519 | 36.1% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分） |
| rocky_coast.explore → coconut_crab.eat | 26.73 | 19.23 | 7.50 | 1283 | 89.1% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 12.62 | 1.37 | 11.25 | 1212 | 84.2% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.86 | 0.51 | 0.36 | 83 | 5.8% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| rocky_coast.explore → coconut_crab.eat | 1.62 | 1.17 | 0.45 | 156 | 10.8% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 2.30 | 0.25 | 2.05 | 220 | 15.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| forest.explore → banana_plant.fell → banana.eat | 10.44 | 7.94 | 2.50 | 1002 | 69.6% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| grassland.explore → water_spinach.eat | 29.87 | 14.87 | 15.00 | 2867 | 199.1% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### sandy_beach

> **1日を賄う最小労働: 830 分**（1440分の 57.6%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 3.07 | 205 |
| palm_tree.pick_green_coconut → green_coconut.bore | 8.37 | 265 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 0.13 | 0.10 | 0.03 | 205 | 14.2% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 582 | 40.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.82 | 1.18 | 9.64 | 519 | 36.1% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |
| sandy_beach.explore → coconut_crab.eat | 33.36 | 25.86 | 7.50 | 1601 | 111.2% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.62 | 1.37 | 11.25 | 1212 | 84.2% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 2.02 | 1.57 | 0.45 | 194 | 13.5% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.30 | 0.25 | 2.05 | 220 | 15.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（115.4分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### rocky_coast

> **1日を賄う最小労働: 1643 分**（1440分の 114.1%）
> 賄えない値: hydration

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 24.00 | 1283 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 0.11 | 0.08 | 0.03 | 164 | 11.4% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 26.73 | 19.23 | 7.50 | 1283 | 89.1% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 1.62 | 1.17 | 0.45 | 156 | 10.8% | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### cliff_coast

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> 賄えない値: satiety、vitamin、hydration、body_fat

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| medic.sleep | 1.00 | 360 |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### grassland

> **1日を賄う最小労働: 453 分**（1440分の 31.4%）
> 賄えない値: hydration

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| grassland.explore → taro.eat | 2.56 | 93 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.06 | 0.04 | 0.03 | 93 | 6.4% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.10 | 0.05 | 0.05 | 153 | 10.6% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.36 | 0.18 | 0.18 | 17 | 1.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| grassland.explore → taro.eat | 1.01 | 0.59 | 0.42 | 48 | 3.4% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.86 | 0.51 | 0.36 | 83 | 5.8% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 29.87 | 14.87 | 15.00 | 2867 | 199.1% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### forest

> **1日を賄う最小労働: 546 分**（1440分の 37.9%）
> 賄えない値: hydration

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| forest.explore → taro.eat | 2.56 | 186 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 0.12 | 0.10 | 0.03 | 186 | 12.9% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat ‡ | 0.30 | 0.23 | 0.07 | 458 | 31.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 2.02 | 1.60 | 0.42 | 97 | 6.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat ‡ | 2.98 | 2.27 | 0.71 | 143 | 9.9% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 1.73 | 1.37 | 0.36 | 166 | 11.5% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| forest.explore → banana_plant.fell → banana.eat ‡ | 10.44 | 7.94 | 2.50 | 1002 | 69.6% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### jungle

> **1日を賄う最小労働: 784 分**（1440分の 54.5%）

| 献立 | 回数 | 労働（分） |
| --- | --- | --- |
| jungle.explore → taro.eat | 2.56 | 272 |
| palm_tree.pick_green_coconut → green_coconut.bore | 4.80 | 152 |
| medic.sleep | 1.00 | 360 |

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → taro.eat | 0.18 | 0.15 | 0.03 | 272 | 18.9% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.26 | 0.00 | 0.26 | 393 | 27.3% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| jungle.explore → water_spinach.eat | 0.27 | 0.22 | 0.05 | 409 | 28.4% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 0.30 | 0.23 | 0.07 | 458 | 31.8% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 0.38 | 0.04 | 0.34 | 582 | 40.4% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → water_spinach.eat | 0.96 | 0.78 | 0.18 | 46 | 3.2% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |
| jungle.explore → taro.eat | 2.95 | 2.54 | 0.42 | 142 | 9.8% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 2.98 | 2.27 | 0.71 | 143 | 9.9% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 368 | 25.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 10.82 | 1.18 | 9.64 | 519 | 36.1% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |

#### hydration（1日 96・尽きると死ぬ）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.37 | 0.00 | 7.37 | 708 | 49.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 12.62 | 1.37 | 11.25 | 1212 | 84.2% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |

#### body_fat（1日 96・尽きると死ぬ／carbohydrate・protein・lipidで埋まる）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat ‡ | 2.30 | 0.25 | 2.05 | 220 | 15.3% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（72.0分）、stone（12.0分・他の土地で） |
| jungle.explore → taro.eat | 2.53 | 2.18 | 0.36 | 243 | 16.9% | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 7.67 | 0.00 | 7.67 | 736 | 51.1% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| jungle.explore → banana_plant.fell → banana.eat ‡ | 10.44 | 7.94 | 2.50 | 1002 | 69.6% | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（72.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 15.83 | 0.00 | 15.83 | 1520 | 105.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（134.0分） |
| jungle.explore → water_spinach.eat | 79.84 | 64.84 | 15.00 | 7665 | 532.3% | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 | — |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | それ以外 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medic.sleep | 3.75 | 0.00 | 3.75 | 360 | 25.0% | — | stamina +90.00、wakefulness +96.00 | — |
| medic.nap | 5.00 | 0.00 | 5.00 | 480 | 33.3% | — | stamina +36.00、wakefulness +36.00 | — |

### rocky_field

> **1日を賄う最小労働: 360 分**（1440分の 25.0%）
> 賄えない値: satiety、vitamin、hydration、body_fat

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
> 賄えない値: satiety、vitamin、hydration、body_fat

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
> 賄えない値: satiety、vitamin、hydration、body_fat

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
> 賄えない値: satiety、vitamin、hydration、body_fat

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

## 2. 待ち生産表（設備が時間をかけて返す分）

仕掛けてから時間が経つと産物が返るもの。**周期は単位あたりの労働時間には足していない**
（計測方法の「待って得る生産の数え方」参照）ので、この表が代わりに周期とレートを出す。

- **設備あたり（個/日）**: 1日は24時間まるごと回る。眠っている間も進むのが待ち生産の取り柄。
- **寿命の間に（個）**: 設備1つが朽ちるまでに返す総数。これが並列度の上限を決める。
- **労働（分/個）**: 製作労働 ÷ 寿命の間に返す数。連鎖表に載るのはこの値。

### 島全体

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 63.8 | 15.30 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 63.8 | 9.39 |

### sandy_beach

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### rocky_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### cliff_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### grassland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 63.8 | 15.30 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 63.8 | 9.39 |

### forest

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.143 | 0.86 | 10.0 | 8.6 | 63.8 | 7.44 |

### jungle

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.061 | 0.36 | 10.0 | 3.6 | 63.8 | 17.53 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.117 | 0.70 | 10.0 | 7.0 | 63.8 | 9.09 |

### rocky_field

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### wasteland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### mountainside

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

### mountain_peak

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 63.8 | 9.56 |

## 3. 消費表（1日あたり何が要るか）

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

## 4. 供給表（1工程あたり）

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
| monkey | strike | combination | 15 ? | 15 | laceration ×0.00、puncture_wound ×0.00 | （self）wariness +0.00、（self）shock +0.00 |
| monkey_carcass | butcher | combination | 60 | 60 | raw_meat ×4.00、animal_bone ×1.00、rawhide ×1.00 | — |
| junglefowl | turn | action | 0 | 0 | bite_wound ×0.00、gore_wound ×0.00 | — |
| junglefowl | strike | combination | 15 ? | 15 | laceration ×0.00、puncture_wound ×0.00 | （self）wariness +0.00、（self）shock +0.00 |
| rat | turn | action | 0 | 0 | bite_wound ×0.05、gore_wound ×0.00 | — |
| rat | strike | combination | 15 ? | 15 | laceration ×0.00、puncture_wound ×0.00 | （self）wariness +0.00、（self）shock +0.00 |
| wild_boar | turn | action | 0 | 0 | bite_wound ×0.00、gore_wound ×0.40 | — |
| wild_boar | strike | combination | 15 ? | 15 | laceration ×0.00、puncture_wound ×0.00 | （self）wariness +0.00、（self）shock +0.00 |
| wild_boar_carcass | butcher | combination | 240 | 240 | raw_meat ×40.00、animal_bone ×6.00、rawhide ×6.00 | — |
| junglefowl_carcass | butcher | combination | 20 | 20 | raw_meat ×1.00、feather ×1.00、small_bone ×1.00 | — |
| roasted_rat | eat | action | 15 | 15 | small_bone ×1.00 | satiety +60.00、protein +3.00、lipid +1.00 |
| raw_meat | eat | action | 15 | 15 | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 |
| roasted_meat | eat | action | 15 | 15 | — | satiety +450.00、protein +24.00、lipid +7.00 |
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
| sandy_beach | explore | action | 15 | 15 | palm_tree ×0.13、woven_basket ×0.05、coconut_crab ×0.29、coconut ×0.91、thick_branch ×0.67 | （self）exploration_progress +1.00 |
| rocky_coast | explore | action | 15 | 15 | cave_entrance ×0.13、coconut_crab ×0.39、stone ×1.25、thick_branch ×0.28 | （self）exploration_progress +1.00 |
| cliff_coast | explore | action | 15 | 15 | cave_entrance ×0.19、golden_chalice ×0.04、stone ×1.09、thick_branch ×0.24 | （self）exploration_progress +1.00 |
| grassland | explore | action | 15 | 15 | berry_bush ×0.13、spring ×0.09、water_spinach ×1.01、taro ×0.71、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| forest | explore | action | 15 | 15 | berry_bush ×0.20、spring ×0.08、broadleaf_tree ×0.12、twig ×1.29、taro ×0.26、banana_plant ×0.09 | （self）exploration_progress +1.00 |
| jungle | explore | action | 15 | 15 | palm_tree ×0.11、taro ×0.16、broadleaf_tree ×0.09、twig ×0.61、coconut ×0.66、water_spinach ×0.23、abaca ×0.09、banana_plant ×0.07 | （self）exploration_progress +1.00 |
| rocky_field | explore | action | 15 | 15 | cave_entrance ×0.17、golden_chalice ×0.03、twig ×0.56、stone ×1.25 | （self）exploration_progress +1.00 |
| wasteland | explore | action | 15 | 15 | stone ×1.01、twig ×0.51、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| mountainside | explore | action | 15 | 15 | cave_entrance ×0.15、golden_chalice ×0.03、berry_bush ×0.21、stone ×1.00、twig ×0.63 | （self）exploration_progress +1.00 |
| mountain_peak | explore | action | 15 | 15 | cave_entrance ×0.37、stone ×1.21 | （self）exploration_progress +1.00 |
| broadleaf_tree | fell | combination | 240 | 240 | log ×2.00、thick_branch ×3.00 | — |
| snare | add_plant_bait | combination | 1 | 1 | — | （self）plant_bait +999.00 |
| snare | add_meat_bait | combination | 1 | 1 | — | （self）meat_bait +999.00 |
| snare | knotted | recipe | 30 | 30 | snare ×1.00 | — |
| snare | catch_remaining.on_shortfall | periodic | 0 | 240 | junglefowl ×0.07、snare_laceration ×0.18、rat ×0.11 | （self）catch_remaining +16.00 |
| raft | lashed | recipe | 420 | 420 | raft ×1.00 | — |
| palm_frond | weave | action | 90 | 90 | woven_leaf ×1.00 | — |
| palm_frond | split_and_weave | combination | 60 | 60 | woven_leaf ×2.00 | — |


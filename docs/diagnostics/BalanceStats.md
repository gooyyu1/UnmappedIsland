# アイテム収支レポート

`tests/diagnostics/balanceStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）
だけから計算した「時間あたりの収支」。定義の数値を変えたら以下で再生成する。

```
npm run stats:balance
```

## 計測方法

- 1 tick = 15分、1日 = 96 tick = 1440分。
- `pick` の分岐は `weight` から期待値を取る。入れ子の `pick` は確率の積まで畳んである。
- **1つの工程が複数の値を返す場合、所要時間は按分せず全額を各値に計上する。** 按分には
  水と満腹の交換レートが要るが、そのレートこそこの表が見つけようとしているもの。
  代わりに「同時に返す値」の列を置いた——行を縦に足すと二重計上になる。
- **道具（消費されない入力）の入手時間は単位あたりの時間に含めない。** 繰り返し使えるものを
  1個あたりへ按分するには「何回使うか」の仮定が要り、その仮定が数字を支配するため。
  代わりに「前提」列へ、1度だけ払う入手時間として別に並べる。
- 連鎖の起点は探索。土地ごとに得られる物が違うので、連鎖表は土地ごとに出す。
  ただし資源は土地をまたいで分かれている（木は砂浜、石は岩場）ので、渡り歩ける前提の
  **島全体**を先頭に置く——各資源を最も得やすい土地で得て、移動時間は数えない場合。

### 待って得る生産の数え方

罠のように、仕掛けてから時間が経つと産物が返るものは、**待っている間に他のことができる**。
そこで工程の時間を2本に分けて数える。

- **労働時間**: プレイヤーが払う分。他の行動と直接競合するのはこれだけで、
  上の各表の「分」はすべてこちら。
- **周期**: 経過するだけの分。単位あたりの時間には**足さない**。

では待ち時間が無コストかというと、そうではない。**設備は待っている間も朽ちる**ので、
1周期で使い切る設備の割合（周期 ÷ 寿命）が、そのまま製作労働の按分になる——罠1回の判定は
「罠を作る労働の、周期÷寿命ぶん」を払っている。連鎖表の数字はこの按分を含む。

この数え方が成り立つのは**並列度に上限があるとき**だけ。いくらでも並べられて朽ちもしない
設備は、待つだけで無限に得られることになるので按分できず、連鎖表から外して4節へ回す。

### この表が数えていないもの

- **土地の間の移動時間。** 道ごとに違い、地形生成が個体へ書き込むため定義からは決まらない。
  設備を見回る時間もこれに含まれるので、必要設備数が多い経路ほど実際は不利になる。
- **餌の効果。** 餌は `modify`（実効値への可逆な寄与）で重みを押し上げるが、静的に読めるのは
  宣言値だけなので、罠のレートは**餌なし**の値。
- **雨で溜まる水。** 量を増やすのは `rain_filled_liquid` のtick毎の持続効果で、工程ではない。
  そのため水を汲む経路は所要時間0分の工程として出る（下表で † を付けた行）。
- **採取ポイントの枯渇。** 同じ木から何度でも採れる前提で計算している。
- **獲物が死体に変わるまで。** 罠に掛かった獲物を殺すのは、刺さった傷が**親へ**与える出血
  （`snare_laceration` の `add: {parent: {blood: -15}}`）で、しかも傷の `bleeding` が尽きる
  数tickだけ効く。「傷の勢い×効いている長さ」と「獲物の血の量」の勝負なので、tick毎の
  増減を1つ足すだけでは決まらない。そのため4節の産物（獲物）は3節の連鎖へ繋がっておらず、
  連鎖表の「設備数」列は今のところ全て空になる。

## 1. 消費表（1日あたり何が要るか）

キャラクタが自分のプロパティをtick毎にどれだけ動かすか（`passives` の `add` と `transfer`）。
括弧内は1日ぶん（×96）。個体差はそのまま列に出る。

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

## 2. 供給表（1工程あたり）

何かを生むか、値を動かす工程すべて。産出は1回の実行あたりの期待個数。
「値の増減」はキャラクタ（actor）が受け取る分で、括弧に（self）と書いたものは工程の主が受け取る分。

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
| roasted_rat | eat | action | 0 | 0 | small_bone ×1.00 | satiety +60.00、protein +3.00、lipid +1.00 |
| raw_meat | eat | action | 0 | 0 | — | satiety +500.00、protein +20.00、lipid +4.00、vitamin +2.00 |
| roasted_meat | eat | action | 0 | 0 | — | satiety +450.00、protein +24.00、lipid +7.00 |
| charred_lump | eat | action | 0 | 0 | — | satiety +200.00、protein +4.00、lipid +1.00 |
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
| coconut_jelly | eat | action | 0 | 0 | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 |
| coconut | husk | combination | 30 | 30 | husked_coconut ×1.00、coconut_husk ×1.00 | — |
| coconut_husk | light | combination | 30 | 30 | burning_tinder ×0.71 | — |
| husked_coconut | crack | combination | 15 | 15 | coconut_half ×2.00 | — |
| husked_coconut | pry_open | combination | 15 | 15 | coconut_half ×2.00 | — |
| coconut_half | scrape | combination | 30 | 30 | coconut_meat ×1.00、coconut_bowl ×1.00 | — |
| coconut_meat | eat | action | 0 | 0 | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 |
| woven_basket | woven | recipe | 120 | 120 | woven_basket ×1.00 | — |
| abaca | fell | combination | 20 | 20 | banana_stem ×5.00 | — |
| banana_plant | fell | combination | 20 | 20 | banana ×2.00、banana_stem ×2.00 | — |
| banana | eat | action | 0 | 0 | — | satiety +350.00、carbohydrate +10.00、vitamin +35.00 |
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
| water_spinach | eat | action | 0 | 0 | — | satiety +300.00、carbohydrate +1.00、vitamin +83.00 |
| coconut_crab | eat | action | 0 | 0 | — | satiety +500.00、protein +25.00、lipid +8.00、vitamin +2.00 |
| taro | eat | action | 0 | 0 | — | satiety +600.00、carbohydrate +40.00、protein +2.00、vitamin +36.00 |
| jar | collect_rain | action | 0 | 0 | water_liquid ×1.00 | — |
| coconut_bowl | collect_rain | action | 0 | 0 | water_liquid ×1.00 | — |
| water_liquid | drink | action | 0 | 0 | — | hydration +10.00、（self）volume -250.00 |
| tea_liquid | drink | action | 0 | 0 | — | hydration +10.00、wakefulness +2.00、（self）volume -250.00 |
| stone | knap | combination | 60 | 60 | sharp_stone ×1.00 | — |
| sandy_beach | explore | action | 15 | 15 | palm_tree ×0.13、woven_basket ×0.05、coconut_crab ×0.29、coconut ×0.91、thick_branch ×0.67 | （self）exploration_progress +1.00 |
| rocky_coast | explore | action | 15 | 15 | cave_entrance ×0.13、coconut_crab ×0.39、stone ×1.25、thick_branch ×0.28 | （self）exploration_progress +1.00 |
| cliff_coast | explore | action | 15 | 15 | cave_entrance ×0.20、stone ×1.13、thick_branch ×0.25 | （self）exploration_progress +1.00 |
| grassland | explore | action | 15 | 15 | berry_bush ×0.13、spring ×0.09、water_spinach ×1.01、taro ×0.71、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| forest | explore | action | 15 | 15 | berry_bush ×0.22、spring ×0.09、twig ×1.33、taro ×0.29、banana_plant ×0.11 | （self）exploration_progress +1.00 |
| jungle | explore | action | 15 | 15 | palm_tree ×0.12、taro ×0.18、twig ×0.57、coconut ×0.73、water_spinach ×0.25、abaca ×0.10、banana_plant ×0.08 | （self）exploration_progress +1.00 |
| rocky_field | explore | action | 15 | 15 | cave_entrance ×0.18、twig ×0.58、stone ×1.29 | （self）exploration_progress +1.00 |
| wasteland | explore | action | 15 | 15 | stone ×1.01、twig ×0.51、dry_grass ×0.11 | （self）exploration_progress +1.00 |
| mountainside | explore | action | 15 | 15 | cave_entrance ×0.15、berry_bush ×0.22、stone ×1.03、twig ×0.65 | （self）exploration_progress +1.00 |
| mountain_peak | explore | action | 15 | 15 | cave_entrance ×0.37、stone ×1.21 | （self）exploration_progress +1.00 |
| snare | add_plant_bait | combination | 1 | 1 | — | （self）plant_bait +999.00 |
| snare | add_meat_bait | combination | 1 | 1 | — | （self）meat_bait +999.00 |
| snare | knotted | recipe | 30 | 30 | snare ×1.00 | — |
| snare | catch_remaining.on_shortfall | periodic | 0 | 240 | junglefowl ×0.07、snare_laceration ×0.18、rat ×0.11 | （self）catch_remaining +16.00 |
| palm_frond | weave | action | 90 | 90 | woven_leaf ×1.00 | — |
| palm_frond | split_and_weave | combination | 60 | 60 | woven_leaf ×2.00 | — |

## 3. 連鎖表（素材から摂取までの総時間）

1日ぶんの必要量は medic のもの（消費表の常時効く減りから）。時間はすべて労働時間で、
待ち時間は含まない（待ち生産の設備は、周期÷寿命ぶんの製作労働として計上する）。
「1日の割合」は、1日ぶんを賄うのに要る労働が1日（1440分）に占める割合。
「設備数」は、待ち生産の経路で1日ぶんを賄うのに同時に要る設備の数（4節参照）。
† は、素材を所要時間0分の工程で得ている経路（この表が時間を数えられていない、上の注記を参照）。
前提の道具がその土地で手に入らない経路は、数字を出したうえで表の末尾へ回す。

### 島全体

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.04 | 0.04 | 0.00 | 54 | 3.8% | — | carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.05 | 0.05 | 0.00 | 76 | 5.3% | — | carbohydrate +1.00、vitamin +83.00 | — |
| rocky_coast.explore → coconut_crab.eat | 0.08 | 0.08 | 0.00 | 118 | 8.2% | — | protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |
| forest.explore → banana_plant.fell → banana.eat | 0.23 | 0.20 | 0.03 | 351 | 24.4% | — | carbohydrate +10.00、vitamin +35.00 | cutting_tool → sharp_stone（71.6分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.30 | 0.04 | 0.26 | 466 | 32.4% | — | carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool → sharp_stone（71.6分）、stone（11.6分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.18 | 0.18 | 0.00 | 9 | 0.6% | — | satiety +300.00、carbohydrate +1.00 | — |
| grassland.explore → taro.eat | 0.59 | 0.59 | 0.00 | 28 | 2.0% | — | satiety +600.00、carbohydrate +40.00、protein +2.00 | — |
| forest.explore → banana_plant.fell → banana.eat | 2.29 | 2.00 | 0.29 | 110 | 7.6% | — | satiety +350.00、carbohydrate +10.00 | cutting_tool → sharp_stone（71.6分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 8.68 | 1.18 | 7.50 | 417 | 28.9% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、hydration +6.00 | cutting_tool → sharp_stone（71.6分）、stone（11.6分） |
| rocky_coast.explore → coconut_crab.eat | 19.23 | 19.23 | 0.00 | 923 | 64.1% | — | satiety +500.00、protein +25.00、lipid +8.00 | — |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.12 | 1.37 | 8.75 | 972 | 67.5% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00 | cutting_tool → sharp_stone（71.6分）、stone（11.6分） |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### sandy_beach

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 0.10 | 0.10 | 0.00 | 159 | 11.0% | — | protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.30 | 0.04 | 0.26 | 466 | 32.4% | — | carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sandy_beach.explore → coconut_crab.eat | 25.86 | 25.86 | 0.00 | 1241 | 86.2% | — | satiety +500.00、protein +25.00、lipid +8.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 8.68 | 1.18 | 7.50 | 417 | 28.9% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、hydration +6.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（115.4分） |
| sandy_beach.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.12 | 1.37 | 8.75 | 972 | 67.5% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### rocky_coast

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 0.08 | 0.08 | 0.00 | 118 | 8.2% | — | protein +25.00、lipid +8.00、vitamin +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rocky_coast.explore → coconut_crab.eat | 19.23 | 19.23 | 0.00 | 923 | 64.1% | — | satiety +500.00、protein +25.00、lipid +8.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（72.0分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### cliff_coast

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（73.3分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### grassland

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → taro.eat | 0.04 | 0.04 | 0.00 | 54 | 3.8% | — | carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| grassland.explore → water_spinach.eat | 0.05 | 0.05 | 0.00 | 76 | 5.3% | — | carbohydrate +1.00、vitamin +83.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grassland.explore → water_spinach.eat | 0.18 | 0.18 | 0.00 | 9 | 0.6% | — | satiety +300.00、carbohydrate +1.00 | — |
| grassland.explore → taro.eat | 0.59 | 0.59 | 0.00 | 28 | 2.0% | — | satiety +600.00、carbohydrate +40.00、protein +2.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### forest

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 0.08 | 0.08 | 0.00 | 130 | 9.1% | — | carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| forest.explore → banana_plant.fell → banana.eat | 0.23 | 0.20 | 0.03 | 351 | 24.4% | — | carbohydrate +10.00、vitamin +35.00 | cutting_tool（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| forest.explore → taro.eat | 1.41 | 1.41 | 0.00 | 68 | 4.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00 | — |
| forest.explore → banana_plant.fell → banana.eat | 2.29 | 2.00 | 0.29 | 110 | 7.6% | — | satiety +350.00、carbohydrate +10.00 | cutting_tool（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### jungle

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → taro.eat | 0.14 | 0.14 | 0.00 | 213 | 14.8% | — | carbohydrate +40.00、protein +2.00、vitamin +36.00 | — |
| jungle.explore → water_spinach.eat | 0.20 | 0.20 | 0.00 | 302 | 21.0% | — | carbohydrate +1.00、vitamin +83.00 | — |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |
| jungle.explore → banana_plant.fell → banana.eat | 0.29 | 0.26 | 0.03 | 445 | 30.9% | — | carbohydrate +10.00、vitamin +35.00 | cutting_tool（この土地では入手できない） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 0.31 | 0.05 | 0.26 | 482 | 33.5% | — | carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00、hydration +6.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jungle.explore → water_spinach.eat | 0.71 | 0.71 | 0.00 | 34 | 2.4% | — | satiety +300.00、carbohydrate +1.00 | — |
| jungle.explore → taro.eat | 2.31 | 2.31 | 0.00 | 111 | 7.7% | — | satiety +600.00、carbohydrate +40.00、protein +2.00 | — |
| jungle.explore → banana_plant.fell → banana.eat | 2.90 | 2.61 | 0.29 | 139 | 9.7% | — | satiety +350.00、carbohydrate +10.00 | cutting_tool（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 8.97 | 1.47 | 7.50 | 430 | 29.9% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、hydration +6.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool（この土地では入手できない）、palm_tree（122.0分） |
| jungle.explore → coconut.husk → husked_coconut.crack → coconut_half.scrape → coconut_meat.eat | 10.46 | 1.71 | 8.75 | 1004 | 69.8% | — | satiety +200.00、carbohydrate +4.00、protein +3.00、lipid +26.00、vitamin +7.00 | cutting_tool（この土地では入手できない）、stone（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### rocky_field

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（71.6分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### wasteland

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（74.9分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### mountainside

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（74.6分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

### mountain_peak

#### satiety（1日 1536）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 0.16 | 0.00 | 0.16 | 239 | 16.6% | — | carbohydrate +4.00、lipid +1.00、vitamin +5.00、hydration +5.20 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 0.53 | 0.00 | 0.53 | 811 | 56.3% | — | carbohydrate +2.00、vitamin +5.00、hydration +20.00 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |

#### vitamin（1日 48）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.67 | 0.00 | 4.67 | 224 | 15.6% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、hydration +5.20 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 6.33 | 0.00 | 6.33 | 304 | 21.1% | — | satiety +60.00、carbohydrate +2.00、hydration +20.00 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |

#### hydration（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jar.collect_rain → water_liquid.drink | 0.00 † | 0.00 | 0.00 | 0 | 0.0% | — | — | jar（この土地では入手できない） |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | wakefulness +2.00 | tea_liquid（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore | 1.58 | 0.00 | 1.58 | 152 | 10.6% | — | satiety +60.00、carbohydrate +2.00、vitamin +5.00 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |
| palm_tree.pick_green_coconut → green_coconut.bore → drained_green_coconut.split → coconut_jelly.eat | 4.49 | 0.00 | 4.49 | 431 | 29.9% | — | satiety +150.00、carbohydrate +4.00、lipid +1.00、vitamin +5.00 | cutting_tool → sharp_stone（72.4分）、palm_tree（この土地では入手できない） |

#### wakefulness（1日 96）

| 経路 | 1単位あたり（分） | 探索 | 加工 | 1日ぶん（分） | 1日の割合 | 設備数 | 同時に返す値 | 前提 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tea_liquid.drink | 0.00 | 0.00 | 0.00 | 0 | 0.0% | — | hydration +10.00 | tea_liquid（この土地では入手できない） |

## 4. 待ち生産表（設備が時間をかけて返す分）

仕掛けてから時間が経つと産物が返るもの。**周期は単位あたりの労働時間には足していない**
（計測方法の「待って得る生産の数え方」参照）ので、この表が代わりに周期とレートを出す。

- **設備あたり（個/日）**: 1日は24時間まるごと回る。眠っている間も進むのが待ち生産の取り柄。
- **寿命の間に（個）**: 設備1つが朽ちるまでに返す総数。これが並列度の上限を決める。
- **労働（分/個）**: 製作労働 ÷ 寿命の間に返す数。連鎖表に載るのはこの値。

### 島全体

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 62.3 | 14.94 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 62.3 | 9.17 |

### sandy_beach

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### rocky_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### cliff_coast

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### grassland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.069 | 0.42 | 10.0 | 4.2 | 入手経路なし | — |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.113 | 0.68 | 10.0 | 6.8 | 入手経路なし | — |

### forest

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.143 | 0.86 | 10.0 | 8.6 | 85.0 | 9.92 |

### jungle

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | junglefowl ×0.061 | 0.36 | 10.0 | 3.6 | 62.3 | 17.12 |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.117 | 0.70 | 10.0 | 7.0 | 62.3 | 8.88 |

### rocky_field

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### wasteland

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### mountainside

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |

### mountain_peak

| 設備 | 仕掛け | 周期（分） | 1周期あたり | 設備あたり（個/日） | 寿命（日） | 寿命の間に（個） | 製作労働（分） | 労働（分/個） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| snare | catch_remaining.on_shortfall | 240 | rat ×0.111 | 0.67 | 10.0 | 6.7 | 入手経路なし | — |


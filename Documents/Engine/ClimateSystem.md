# 気候システム設計

## 概要

本ドキュメントは、ゲーム内の気候（季節・天気）に関する設計を検討した結果をまとめたものです。
`GameElementDefinition.md` が掲げる、tick 駆動・値域による状態決定・「ハードコードしない」「汎用エンジンに任せる」という
設計方針（2 節）に準拠します。

本書の前バージョンはエンジンの詳細が固まる前に書かれたため、実装の実態（`world` シングルトンが既に
`day`/`hour`/`minute`/`weather` などのプロパティを直接持っていること、`value: {min, max}` が「毎 tick 再ロール」では
なく「生成時に 1 回だけロール」であること等）と乖離していました。本改訂はその乖離を解消し、あわせて天気を
大気水分量から独立させる、季節・天気を専用オブジェクトではなく `world` 自身のプロパティとして扱う、という
方針転換を反映します。

本ドキュメントは検討結果であり、確定仕様書ではありません。具体的なレート・閾値などの数値は
本書ではまだ確定させず、7 節に未決事項として整理しています。

## 1. 基本方針

気候は次の 2 層で構成します。いずれも `world`（`GameElementDefinition.md` 15 節の `singleton: true` オブジェクト。
`core.yaml` で既に `tick`/`minute`/`hour`/`day`/`weather`/`sunlight`/`ambient_temperature` を直接プロパティとして
持っている、まさにその `world`）自身のプロパティとして表現し、専用の `WorldObject` インスタンスは作りません。

- **季節（長期サイクル）**: 穏やか・雨季・乾季の 3 状態を固定順で巡回する。滞在期間は初回サイクルのみ固定、
  2 周目以降はランダムに決まる（3 節）。
- **天気（短期変動）**: 晴れ・曇り・小雨・大雨・嵐。季節が育てる大気水分量に重み付けされた抽選で決まる、
  季節から独立したプロパティ（4 節）。

季節・天気とも、「現在の値」と「残り時間」の 2 プロパティの組で表現し、残り時間が 0 になった瞬間に次の値へ
遷移します。個別の現象を条件分岐やイベントとして作り込むのではなく、**独立したパラメータ同士が tick ごとに
加算・減算し合う「数値積分」によって駆動します**。`derived`（導出値。GameElementDefinition.md 16 節・17 節、
採否未確定）のような計算式は使いません。この方針は `GameConcept.md` の「遅れて表面化するサバイバル」節で
述べている設計思想そのものであり、本書はその具体的な適用例です。

## 2. 季節: worldプロパティとしての3サイクル

### 2.1 3状態・固定順の巡回

季節は「穏やか（`calm`）→雨季（`wet`）→乾季（`dry`）→穏やか→…」という固定順の 3 状態サイクルです。天気（4 節）とは
異なり、次に来る季節がどれかは確率で決まるものではなく、常に同じ順で巡回します。それぞれの季節が基本 30 日
（tick 換算は `DurabilitySystem.md` が前提とする `tick = 15 分・1 日 = 96 tick` に従うと 2,880 tick）続きます。

### 2.2 プロパティ構成

- `season`: 現在の季節を表す symbol プロパティ（`calm`/`wet`/`dry`。GameElementDefinition.md 6.8 節）。`stages`
  は季節ごとに 1 つずつ、`eq` は値名から自動導出されます（6.4 節）。
- `season_remaining`: 残り tick 数。毎 tick `-1` される蓄積型プロパティ。
- `season_cycle`: 3 状態を何周したかを表すカウンタ。`0` から始まり、1 周（`calm`→`wet`→`dry`→`calm`）ごとに
  `+1` される（2.3 節の固定/ランダム分岐に使う）。

### 2.3 遷移の実装: `season_remaining` の `on_min`

`season_remaining` の `on_min`（GameElementDefinition.md 6.5 節。`range: {min: 0}` 以下である間、毎 tick 実行）で、
次の 2 つを同時に行います。`on_min` の対象は `self` のみ許可されていますが、すべて `world` 自身のプロパティなので
制約になりません。

1. `season` を巡回順の次の値へ `set` する（3 状態の固定巡回であり、天気のような確率分岐ではないため `pick`
   （10 節）は不要）。
2. `season_remaining` を次の期間の tick 数へ `set` する。`season_cycle` が `0`（まだ 1 周目）の間は常に固定 30 日
   （2,880 tick）。`1` 以上になった後は、複数の候補日数から等確率で 1 つを選ぶ `pick`（10 節。候補と重みの
   具体値は 7 節で未決）でばらつかせる。
3. `dry`→`calm` への遷移（＝`calm`→`wet`→`dry`と巡って1周が完了し、次の周の`calm`に入る瞬間）でのみ、
   `season_cycle` を `+1` する。

## 3. 大気水分量・気温: 季節が駆動する2つの貯水池

天気（4 節）を決める材料として、天気とは別に「大気水分量」「気温」という 2 つの連続値プロパティを
引き続き維持します。前バージョンと同じく、`derived` を使わず、季節由来のレート＋ノイズを毎 tick 加算する
「貯水池モデル」です。

- `atmospheric_moisture`（`world` の蓄積型プロパティ）: `season` の現在値が持つレートを毎 tick 加算する。
  `wet` はプラス（湿っていく）、`dry` はマイナス（乾いていく）、`calm` はほぼ 0（現状維持）。加えて
  `layered_noise`（`TerrainGeneration.md` 3.1 節の汎用ジェネレータプリミティブを時間軸に適用したもの）による
  小さなランダム変動を加算する。
- `ambient_temperature`（同じく `world` の蓄積型プロパティ）: `dry` はプラス（じわじわ暑くなる）、`wet` は
  マイナス（じわじわ涼しくなる）、`calm` はほぼ 0。
- 降雨中の自己減算: 天気（4 節）が `light_rain`/`heavy_rain`/`storm` のいずれかである間、その `weather` の
  `stages` 自身が持つ `passive` の `accumulate` として、毎 tick `atmospheric_moisture` を減算する（耐久値や
  `GameElementDefinition.md` 6.4 節の `progress`/`feverish` 例と同じ、ステージ自身が自分の値を変化させる
  パターン）。雨が降り続ければやがて水分が尽きて乾いた候補が選ばれやすくなる、という循環がこれで自然に成立します。
- 上限・下限は既存ルール通り、プロパティ側の `min`/`max` でクランプする。

**「季節後半ほど過酷になる」は、この貯水池モデルだけで自動的に成立します。** 乾季・雨季とも季節が進むほど
`ambient_temperature`/`atmospheric_moisture` が単調に積み上がるため、追加の「経過度」計算をしなくても、季節の
後半には値が最大に近づきます。乾季後半は `ambient_temperature` が最大化して暑くなり、雨季後半は
`atmospheric_moisture` が最大化して 4.3 節の重み付けにより嵐・大雨の相対確率が上がります。`calm` はどちらの
レートもほぼ 0 のため、この効果を持たず、名前どおり穏やかな季節として振る舞います。

## 4. 天気: worldプロパティとしての短期変動

### 4.1 大気水分量から独立させる理由

前バージョンは天気を `atmospheric_moisture` の `stages`（閾値）として表現していましたが、この方式では
「大気水分量の値が 1 つ決まれば天気も 1 つに決まる」ため、大雨と嵐のように同程度の大気水分量でも降り方が
変わりうる現象を表現できません。そこで天気は季節と同じ形の、大気水分量からは独立した `world` プロパティとし、
大気水分量は「天気がどちらに転びやすいか」の重み（4.3 節）としてのみ関与させます。

### 4.2 プロパティ構成

- `weather`: 現在の天気を表す symbol プロパティ（`sunny`/`cloudy`/`light_rain`/`heavy_rain`/`storm`）。`core.yaml`
  には既に `weather` プロパティと暫定の `stages`（`storm`/`heavy_rain`/`light_rain`/`cloudy`/`clear`/`sunny`/
  `scorching`）が存在しますが、これは本設計が確定する前の仮置きであり、本書の値セットへの整合は 7 節の
  未決事項とします。
- `weather_remaining`: 残り tick 数。4〜6 時間（tick 換算で 16〜24 tick）の範囲で、遷移のたびに `pick`
  （10 節。離散候補からの等確率選択）でロールし直す。
- `sunny_weight`/`cloudy_weight`/`light_rain_weight`/`heavy_rain_weight`/`storm_weight`: `weather` の各候補に
  1 つずつ対応する、ただの数値プロパティ。値は著者が直接 `set` するのではなく、4.3 節の通り
  `atmospheric_moisture` の `stages` が常時 `modify` して維持します。

### 4.3 遷移先: 天気ごとの重みプロパティを大気水分量の `stages` が `modify` する

`weather_remaining` の `on_min`（`self`）で `pick`（GameElementDefinition.md 10 節）を実行し、次の天気を選びます。
各候補の `weight` は、対応する `*_weight` プロパティへの参照です（10.2 節の「既存プロパティへの参照」）。

```yaml
props:
  weather_remaining:
    value: 20
    range: {min: 0}
    passives:
      - accumulate:
          self:
            weather_remaining: -1
    on_min:
      pick:
        - weight: {prop: sunny_weight}
          set: {weather: sunny}
        - weight: {prop: cloudy_weight}
          set: {weather: cloudy}
        - weight: {prop: light_rain_weight}
          set: {weather: light_rain}
        - weight: {prop: heavy_rain_weight}
          set: {weather: heavy_rain}
        - weight: {prop: storm_weight}
          set: {weather: storm}
```

`weather_remaining` 自体を 4〜6 時間（16〜24 tick）の範囲で遷移のたびにロールし直す部分は、この `pick` の
中には含めていません（各候補の `set` に加えて `weather_remaining` 自体をどう再ロールするかは 2.3 節と同じ
「離散候補からの `pick`」を想定していますが、具体値は 7 節の未決事項です）。上のサンプルは `value: 20`
（初期値、tick換算で 5 時間相当）を固定で示しており、天気ごとの重み付けという本節の主題を明確にするための
簡略化です。

`*_weight` プロパティ自身の値は、`atmospheric_moisture` の `stages`（数値の半開区間。GameElementDefinition.md
6.4 節）が `passives` の `modify` として常時上書きすることで決まります（`weather` の `stages` が `sunlight` を
`modify` しているのと同じパターンの使い回しで、新しいエンジン機能は不要です）。

```yaml
props:
  atmospheric_moisture:
    value: 0
    range: {min: 0, max: 100}
    stages:
      - name: dry
        min: 0
        passives:
          - modify:
              self:
                sunny_weight: 50
                cloudy_weight: 20
                light_rain_weight: 5
                heavy_rain_weight: 0
                storm_weight: 0
      - name: moderate
        min: 30
        passives:
          - modify:
              self:
                sunny_weight: 20
                cloudy_weight: 30
                light_rain_weight: 40
                heavy_rain_weight: 5
                storm_weight: 0
      - name: humid
        min: 60
        passives:
          - modify:
              self:
                sunny_weight: 5
                cloudy_weight: 20
                light_rain_weight: 40
                heavy_rain_weight: 30
                storm_weight: 10
      - name: saturated
        min: 85
        passives:
          - modify:
              self:
                sunny_weight: 0
                cloudy_weight: 5
                light_rain_weight: 20
                heavy_rain_weight: 40
                storm_weight: 40
  sunny_weight: {value: 0}
  cloudy_weight: {value: 0}
  light_rain_weight: {value: 0}
  heavy_rain_weight: {value: 0}
  storm_weight: {value: 0}
```

`sunny`/`cloudy` 側の重みも `light_rain`/`heavy_rain`/`storm` 側と同じく `atmospheric_moisture` の段階に
連動させ、固定の重み定数にはしません。固定にすると「大気水分量がどれだけ高くても晴れが一定確率で残り続ける」
という下限が原理的に外れなくなり、`saturated` 段階（雨季後半）で「まず晴れない」を表現できなくなるためです。
上のサンプルでは `saturated` 段階で `sunny_weight: 0` とすることで、それを表現しています（同様に `dry` 段階の
`heavy_rain_weight`/`storm_weight` を `0` にすれば、乾ききっている間は大雨・嵐が原理的に起こらない、という
逆方向の下限も表現できます）。

段階の境界（`min`）を跨いだ瞬間に重みが階段状に飛ぶ点は、`weather_remaining` の遷移自体が 4〜6 時間に 1 回
（4.2 節）しか起きないため、体感上の不自然さにはならないと考えます。

### 4.4 二回連続で同じ天気になった場合

`weather_remaining` は遷移のたびに 4〜6 時間の範囲で改めて `pick` されるため、たまたま同じ天気が連続して
選ばれることがあります。この場合プレイヤーからは天気が変わらないまま 6 時間を超えて継続しているように
見えますが、これは狙って作り込む特別なルールではなく、独立試行の結果として自然に起こる、1 節で述べた
ノイズによる不確実性と同じ考え方です。

## 5. 難易度の初期補正: 専用カウンタの`stages`による大気水分量の底上げ

序盤の理不尽な過酷さを避けるため、ゲーム開始から特定の期間だけ大気水分量を底上げし、天気（4 節）が雨に
転びやすい状態を作ります。**天気そのものを固定で雨にするのではなく**、あくまで抽選の元になる
`atmospheric_moisture` の値を操作するだけであり、それでも晴れる可能性はゼロではありません（5.3 節）。

大気水分量そのものが季節由来のレート＋ノイズを毎 tick 加算する「積分値」（3 節）である以上、この補正も
「瞬間に 1 回だけ発火する」仕組みではなく、「特定の期間中ずっと、通常より高いレートで水分を積み増し続ける」
という、3 節と同種の継続的な加算として素直に表現できます。これは `stages`（現在値がその区間内にある間ずっと
`passives` が有効。GameElementDefinition.md 6.4 節）の典型的な用法そのものであり、`weather` の `stages` が
`sunlight` を、`atmospheric_moisture` の `stages` が `*_weight`（4.3 節）を、それぞれ区間内で継続的に
`modify`/`accumulate` しているのと同じパターンです。

2 つの補正（ゲーム開始 2 日目、最初の乾季 10 日目前後）は無関係な別々の意図によるものなので、1 つのプロパティに
両方の `stages` をまとめず、それぞれ専用の「ゲーム開始からの経過 tick を数えるだけの」プロパティを 1 つずつ
用意します。

### 5.1 ゲーム開始2日目

```yaml
props:
  early_rain_calibration:
    value: 0
    passives:
      - accumulate:
          self: {early_rain_calibration: 1}
    stages:
      - name: idle
        min: 0
      - name: boosting
        min: 96     # 2日目の開始（1日 = 96 tick）
        passives:
          - accumulate:
              self: {atmospheric_moisture: 2}   # 加算量は仮の値、7節で未決
      - name: done
        min: 192    # 3日目の開始でオフに戻る
```

`early_rain_calibration` はゲーム開始と同時に毎 tick `+1` されるだけの、他に何の意味も持たない専用カウンタです。
`boosting` 区間（2 日目の 96 tick 分）にいる間だけ `atmospheric_moisture` への追加加算が有効になり、3 日目に
入ると自動的にオフへ戻ります（`stages` は現在値だけで区間を決めるため、明示的なリセットや発火済みフラグは
不要です）。

### 5.2 最初の乾季、10日目前後

季節の巡回順は `calm`→`wet`→`dry`→`calm`（2.1 節）で、初回サイクルは各季節が固定 30 日（2.3 節）なので、
「最初の乾季に入ってから 10 日目前後」が絶対で何日目かはゲーム開始前から確定します。`calm`（1〜30 日目）・
`wet`（31〜60 日目）に続き、最初の `dry` は 61 日目に始まるため、その 10 日目前後は絶対 71 日目
（tick 換算で `(71-1) × 96 = 6,720` tick）です。

```yaml
props:
  first_dry_rain_calibration:
    value: 0
    passives:
      - accumulate:
          self: {first_dry_rain_calibration: 1}
    stages:
      - name: idle
        min: 0
      - name: boosting
        min: 6720   # 71日目の開始（最初の乾季開始=61日目 + 10日）
        passives:
          - accumulate:
              self: {atmospheric_moisture: 3}   # 加算量は仮の値、7節で未決
      - name: done
        min: 6816   # 72日目の開始でオフに戻る
```

5.1 節と全く同じパターンで、`season`/`season_cycle` を実行時に参照する必要はありません。ただしこの `6720`/
`6816` という具体的な tick 数は、「初回サイクルは固定 30 日」という 2.3 節の前提にそのまま依存しています。
季節の巡回順や初回サイクルの日数が変われば、この数値も再計算が必要です。

### 5.3 なぜ天気を直接固定しないか

5.1・5.2 とも、天気を強制的に `light_rain` 等へ `set` するのではなく `atmospheric_moisture` を操作するだけに
留めています。これは 1 節・4.4 節で述べた「ノイズによる不確実性を常に持たせる」という設計原則を、難易度補正の
場面でも崩さないためです。補正はあくまで確率を傾けるだけであり、絶対に雨が降ると保証するものではありません。

## 6. 設計原則のまとめ

- 季節・天気とも、専用の `WorldObject` インスタンスではなく `world` 自身のプロパティ（現在値＋残り時間）として
  表現する
- 季節は穏やか/雨季/乾季の 3 状態を固定順で巡回する。天気は季節から独立した symbol プロパティであり、季節の
  値そのものからは直接決まらない
- 天気・大気水分量・気温はいずれも「独立変数への tick ごとの加減算」のみで表現し、`derived`（計算式による
  導出）は使わない
- 大気水分量は、天気そのものの stages 閾値としては使わず（4.1 節）、天気候補ごとの重み専用プロパティを
  `stages`/`modify` 経由で駆動する入力としてのみ使う（4.3 節）。乾き系・湿り系のどちらの重みも大気水分量に
  連動させ、固定の重み定数にはしない（極端な条件下で「絶対に晴れない」「絶対に嵐にならない」を表現できるよう
  にするため）
- 「季節後半ほど過酷になる」は貯水池モデルの単調な積み上がりから自動的に生まれ、追加の経過度計算を要しない
  （3 節末尾）
- 難易度の初期補正は、天気を固定せず大気水分量という抽選の元データだけを操作することで実現し、不確実性を
  保つ。大気水分量自体が積分値であることを踏まえ、瞬間的な1回発火ではなく、専用カウンタの `stages` による
  期間中の継続加算として表現する（5 節）
- 季節の持続時間は初回サイクルのみ固定 30 日、2 周目以降はランダム化する（2.3 節）

## 7. 未決事項・今後の検討課題

- `weather` の symbol 値セット（`sunny`/`cloudy`/`light_rain`/`heavy_rain`/`storm`）と、`core.yaml` に既にある
  暫定 `stages`（`scorching` を含む 7 値）との整合（4.2 節）
- `atmospheric_moisture` の `stages` の区切り（`dry`/`moderate`/`humid`/`saturated` 等、段階数も含め）と、
  各段階が `*_weight` に `modify` する具体的な数値（4.3 節のサンプルは一例に過ぎない）
- 季節・天気のランダム持続時間を `pick` の離散候補で表現する場合の、具体的な候補値と重み（2.3 節・4.2 節）
- `season_cycle` に応じた「固定 30 日 / ランダム」の分岐を、既存の `on_min`/`pick` の語彙でどう具体的に書くか
  （2.3 節）
- 5.1・5.2 節の `boosting` 区間での `atmospheric_moisture` への具体的な加算レート
- 5.2 節の `6720`/`6816` という tick 数は 2.3 節の「初回サイクル固定 30 日」に依存する導出値であり、2.3 節の
  前提が変わった場合はこの節も再計算が必要
- 季節が `calm` へ戻った際に `atmospheric_moisture`/`ambient_temperature` を緩やかに中立へ戻す仕組みを
  入れるかどうか（3 節）
- 各季節の `moisture_rate`/`temperature_rate` の具体的な数値
- ノイズの振幅・頻度
- `GameElementDefinition.md` 6.2 節の「`value: {min, max}` は毎 tick 再ロール」という記述は、現在のコード実装
  （生成時に 1 回だけロールする `initialValueRange`）と食い違っており、本書とは別に修正が必要

## 8. 参考: 既存プロジェクト方針との整合性

- `world` が `day`/`hour`/`minute`/`weather` を直接プロパティとして持つことは `core.yaml` で既に実装済みであり、
  本書の「季節・天気を `world` のプロパティとして表現する」という方針は、その延長線上にあります
  （1 節・2 節・4 節）。
- 天気の遷移先をプロパティの現在値で重み付けした `pick` で決める設計（4.3 節）は、`GameElementDefinition.md`
  17 節に残っている「天候遷移自体のランダム性の仕組みは未検討」という未決事項に対する、既存語彙のみを使った
  具体的な解決案になっています。新しいエンジン機能は必要としません。
- `object: world` を他オブジェクトから条件・重みとして参照する仕組みは未実装です（`GameElementDefinition.md`
  14.1 節・15 節・17 節）。ただし本書の季節・天気遷移ロジックはすべて `world` 自身の `on_min`（対象は常に
  `self`）として完結するため、この制約の影響を受けません。将来、天気に反応する別オブジェクト（例: 装備の
  防水性）を作る場合は `ancestor` 経由での参照が必要になります。
- 本書全体を通じて `derived`（GameElementDefinition.md 16 節・17 節）を一切使用していません。

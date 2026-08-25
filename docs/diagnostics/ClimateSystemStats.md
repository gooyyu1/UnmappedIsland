# 気候システムレポートの読み方

数値は [`stats/climate.yaml`](../../stats/climate.yaml) にあります。
`tests/diagnostics/climateStatsReport.test.ts` が、`core.yaml` の定義どおりに世界を回して測った
シミュレーションの実測値です。`core.yaml` を変更したら再生成します。

```
npm run stats:climate
```

**この文書は手書きで、再生成しても書き換わりません。** 持つのは読み方——何を測ったか、どこに線を
引いたか、何を数えていないか——だけです。**数値そのものは1行も書きません**（書けば、再生成した
YAMLとずれます）。

## YAMLの節

`unit` は、そのレコードの測定値（`mean`〜`max`・`estimated`・`travel`・`active`）の単位です。
件数（`n`・`seeds`・`days`）は単位を持ちません。`segment` は各季節インスタンスの実持続期間の
3等分区間で、`overall`（全体）・`early`（序盤）・`middle`（中盤）・`late`（終盤）の4つです。

分布のレコードは `mean`・`min`・`p5`（5%ile）・`p95`・`max`・`sd`（標準偏差）・`n`（標本数）を
持ち、標本が足りずに決まらない数は `null` です。

| 節 | 中身 |
| --- | --- |
| `meta` | 回した種の数と、1種あたりの日数 |
| `input_fingerprint` | 指紋を取った入力ファイルと、その中身のsha256の先頭 |
| `season_moisture_rate` | 季節ごとの大気水分量レート（1tickあたり、非雨天時） |
| `rain_weather_moisture_decrement` | 降雨の天気ごとの、推定した自己減算（1tickあたり） |
| `rain_weather_net_moisture_delta` | 同じものの素の実測（天気×季節ごとの正味変化量） |
| `season_duration` | 季節1インスタンスの持続日数 |
| `activity_hours` | 土地×季節ごとの、移動できる時間と活動できる時間 |
| `temperature` | 季節×区間ごとの気温（内部値） |
| `weather_hours` | 季節×天気×区間ごとの発生時間 |
| `non_rain_streak` | 季節×区間ごとの連続未降雨時間 |
| `rain_streak` | 季節×区間ごとの連続降雨時間 |

**この表とYAMLが食い違うと `npm test` が赤くなります。** 表に挙げた節がYAMLに在って空でないことと、
表に無い節がYAMLに無いことの両方を、生成元のテストが見ます。

## 計測方法

- 天気ごとの発生時間 = 期間内の合計時間。発生しなかった期間も0時間の標本として計上（`n`は全天気共通）。
- 連続降雨/未降雨時間 = 同じ状態が連続した1回ごとの長さ。開始tickの区間に割り当て、季節境界で打ち切り。
- 標準偏差は標本標準偏差（n-1）、5%ile/95%ileは最近隣法（nearest-rank）。

## 再生成し忘れると赤くなる

**このレポートだけ、鮮度の見方が他の3本と違います。** 他は丸ごと作り直して比べますが、
20シード×3600日のシミュレーションは分単位でかかるので `npm test` では回せません。代わりに2つを見ます。

- **入力の指紋。** `input_fingerprint` に書いた `core.yaml` の中身のハッシュを、今の
  `core.yaml` と突き合わせる。**再生成しないまま入力を変えると赤くなります。**
- **活動時間の節の再計算。** `activity_hours` は定義から静的に解けるので、丸ごと数え直して比べます。

指紋が見るのは `core.yaml` だけです——シミュレーションが読むのは`world`の定義で、それはそこにしか
無いため。土地の明るさを読む `activity_hours` の側は、その線の外にあるので再計算で見ています。

## 大気水分量のレート・自己減算

`core.yaml`の設定値の実測値（範囲端0/10,000に達したtickは除外）。

`rain_weather_moisture_decrement` の `estimated`（推定自己減算）は「その天気の間の正味変化量 −
その季節のレート」を、季節ごとの標本数で重み付け平均したもの。天気自身の自己減算は季節に依らない
単一の値のはずなので、どの季節から推定しても本来は同じ値になる。素の実測は
`rain_weather_net_moisture_delta` に出しています。

`season_moisture_rate` で `dry` の標準偏差が0でないのは、最初の`dry`季節に難易度の初期補正
（`ClimateSystem.md` 5.2節）が重なるためです。

## 土地×季節ごとの活動時間

`src/analysis/activityHours.ts`が、`core.yaml`の`hour`・`weather`の段（太陽高度と天気の透過率が
ambient_brightnessへ与える寄与）・土地ごとのambient_brightness・上の天候の出現時間（平均）から
数える（[`IlluminationSystem.md`](../engine/IlluminationSystem.md) 5節のしきい値: 移動 −5・
屋外の採取と手元の作業はともに+5）。据え付けの光源（松明・炉）は含まない。

`active`（「屋外の採取」と「手元の作業」）は1つに畳んである。しきい値はどちらも+5だが見る値が違う
（採る側はlooking_brightness、作る側はhand_brightness）——据え付けの光源が無ければ両方とも土地の
ambient_brightnessをそのまま土台にするだけなので、常に同じ値になる。

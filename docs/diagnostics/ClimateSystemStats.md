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

`unit` は、そのレコードの測定値（`mean`〜`max`・`estimated`・`travel`・`gathering`・`handwork`）の
単位です。
件数（`n`・`seeds`・`days`）は単位を持ちません。`segment` は各季節インスタンスの実持続期間の
3等分区間で、`overall`（全体）・`early`（序盤）・`middle`（中盤）・`late`（終盤）です。

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
| `activity_hours` | 土地×季節ごとの、移動できる時間・屋外で採れる時間・探索できる時間・手元の作業ができる時間 |
| `excluded_locations` | 活動時間表が数えなかった土地と、外した根拠のタグ |
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

**このレポートだけ、`npm test` での見方が他と違います。** 他は丸ごと作り直して比べますが、
このレポートのシミュレーションは1分強かかるので `npm test` では回せません。代わりに次を見ます。

- **入力の指紋。** `input_fingerprint` に書いた `core.yaml` の中身のハッシュを、今の
  `core.yaml` と突き合わせる。**再生成しないまま入力を変えると赤くなります。**
- **静的に解ける節の再計算。** `activity_hours` と `excluded_locations` は定義から静的に解けるので、
  丸ごと数え直して比べます。

指紋が見るのは `core.yaml` だけです——シミュレーションが読むのは`world`の定義で、それはそこにしか
無いため。土地の明るさを読む `activity_hours` の側は、その線の外にあるので再計算で見ています。

**丸ごとの突き合わせは、`main` への push のたびに走る
[`regenerate-stats.yml`](../../.github/workflows/regenerate-stats.yml) が持ちます。**
シミュレーションのコードを変えて古くなったぶんは、指紋にも再計算にも映らないので、そこでしか
現れません（見張りが2本立てであることは
[`README.md`](./README.md#再生成し忘れると赤くなる) 参照）。

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
屋外の採取 +3・手元の作業 +5）。据え付けの光源（松明・炉）は含まない。

列は行動のクラスと1対1で、`travel`（土地の間を移動する）・`gathering`（屋外で採る）・`exploration`
（探索する）・`handwork`（手元の細かい作業）。**`gathering`が`handwork`より長いのは、しきい値だけの差**
——見る値は違う（採る側はlooking_brightness、作る側はhand_brightness）が、据え付けの光源が無ければ
どちらも土地のambient_brightnessをそのまま土台にするので、同じ明るさを別々のしきい値で切ったものになる。
**`gathering`だけが`exploration`より短くなるのは、嵐が採取だけを止めるため**
（[`ContentSkeleton.md`](../world/ContentSkeleton.md) 8.1.4節）。森・密林では嵐の時間帯がもともと
明るさで落ちており、浅い洞窟は岩陰に守られているので、そこでは2つが一致する。

**数えるのは島の土地だけ**で、海区（`voyage.yaml`の島影の海・潮目・空の海）は行にしない。海区は
探索でき、寝られ、雨も貯まるので集め方の条件（`location`タグ＋`exploration_progress`）をそのまま
満たすが、この表が答えたいのは島の1日。外した場所は`excluded_locations`に出る。

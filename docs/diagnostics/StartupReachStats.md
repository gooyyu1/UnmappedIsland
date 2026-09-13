# 開始地点の立ち上がりレポートの読み方

数値は [`stats/startup_reach.yaml`](../../stats/startup_reach.yaml) にあります。
`tests/diagnostics/startupReachStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）と
生成された島だけから計算したものです。`locations.yaml`の発見物か`terrain_generation.yaml`を
変更したら再生成します。

```
npm run stats:startup
```

**この文書は手書きで、再生成しても書き換わりません。** 持つのは読み方——何を測ったか、どこに線を
引いたか、何を数えていないか——だけです。**数値そのものは1行も書きません**（書けば、再生成した
YAMLとずれます）。

## YAMLの節

`unit` は、そのレコードの測定値（`mean`〜`max`・`share`・`expected`・`path_discovery`）の単位です。
件数（`n`・`seeds`・`islands`・`sites`）は単位を持ちません。`measure` は何を測ったかで、
`hops`（歩数）・`travel`（移動時間）・`path_discovery`（探索時間）です。

分布のレコードは `mean`・`min`・`median`・`p95`・`max`・`sd`（標準偏差）・`n`（標本数）を持ち、
標本が足りずに決まらない数は `null` です。

| 節 | 中身 |
| --- | --- |
| `meta` | 回した種の数と、数えた島・サイトの数 |
| `need_sources` | 要るものが、どの土地のどの発見物から、1回の探索あたり何個採れるか |
| `location_supplies` | 土地の型ごとの、採れる要るものと、道が全部出そろうまでの探索時間 |
| `site_reach_by_need` | 全サイト × 要るものごとの分布 |
| `site_unreachable_by_need` | 要るものごとの、島のどこをたどっても届かないサイトの割合 |
| `site_all_needs` | 全サイトの「全部が揃うまで」の分布 |
| `site_all_needs_hops_histogram` | 同じものの歩数の割合（`or_more: true` の行は「その歩数以上」） |
| `site_last_need` | 全サイトで、最後まで残った要るものの割合 |
| `site_all_needs_hops_by_start_location` | 始めた土地の型ごとの、全部が揃うまでの歩数 |
| `island_start_site` | 島ごとに選抜が選んだ開始地点の、「全部が揃うまで」の分布 |
| `island_start_site_hops_histogram` | 同じものの歩数の割合 |
| `island_start_site_by_need` | 同じサイトの、要るものごとの分布 |
| `island_missing_need` | 要るものごとの、島のどこでも採れない島の割合 |
| `island_start_site_unreachable` | 開始地点からでも届かない要るものがある島の割合 |
| `island_start_site_locations` | 開始地点の土地の型の割合 |

**この表とYAMLが食い違うと `npm test` が赤くなります。** 表に挙げた節がYAMLに在って空でないことと、
表に無い節がYAMLに無いことの両方を、生成元のテストが見ます。

## 計測方法

- **測るのは「最初の段（ContentSkeleton.md 2.1節）を越えるのに要るものが、その地点から
  何歩先にあるか」**。歩数は道の本数で、0歩はその土地自身で採れること。
- 経路は**歩数が最短のもの**を採り、同じ歩数なら移動時間が短い方。移動時間と探索時間は
  その経路のもので、最短の移動時間ではない。
- **道は未発見でも数える。** 判定するのは島の作りであってプレイヤーの進み具合ではない。
  道を見つけるのに要る時間は「探索時間」として別に出す——その経路で通る土地について、
  道が全部出そろうまでの探索回数（`exploration_progress`の上限−1）×1回の所要時間の和。
  **着いた先の探索は含まない**（そこで目当ての物を引くまでの回数は引きの運）。
- 出どころ（どの土地で何が採れるか）は`locations.yaml`の`explore`が生むと宣言している型。
  **重みは見ない**——選抜と同じ数を測るための線で、重みを確率へ直すのは近似だから
  （CodeStructure.md 5節）。1回あたり何個採れるかは`need_sources`が別に出し、**そこが0なら
  レポートは作られない**（宣言だけ在って実際には引けない土地を、選抜が数えていることになるため）。
- **「全部が揃うまで」は、届いたものの中で最も遠い要るもの**（歩数、同歩数なら移動時間で
  比べる）1つの値で表す。`measure`どうしを混ぜないため、それぞれの数は同じ1本の経路のもの。
- 中央値・95%ileは最近隣法（nearest-rank）、標準偏差は標本標準偏差（n-1）。

**このレポートは判定を出さない。** 開始地点を選ぶ順はドメイン側（ContentSkeleton.md 2.3節）が持ち、
ここはその結果を測るだけ。どの散らばりなら広すぎるか（同2.3.3節）は、ここの数字を見てから決める。

## 要るものの出どころ

`need_sources`は`locations.yaml`の`explore`の実測。**1つの土地では揃わない**ことがこの節の要点で、
荒野は火口・錐・刃を持つが軸が無く、砂浜は軸しか持たない（ContentSkeleton.md 2.3節）。

`location_supplies`の`path_discovery`は、その土地の道が全部出そろうまでの分数（上の「計測方法」参照）。

## サイトごと

`site_`で始まる節は、全島の全サイトをまとめた分布。**島の作りそのものの全体像**で、選抜
（ContentSkeleton.md 2.3節）が選ぶのはこのうち漂着できる地点だけ。

`site_all_needs_hops_by_start_location`の砂浜の行は、**選抜を通さずに砂浜から始めた場合**の分布。
選抜を入れた後との差は`island_start_site`との比較で読む。

## 島ごと

`island_`で始まる節は、その島で**選抜が選んだ開始地点**の値。島は引き直さないので
（ContentSkeleton.md 2.3.1節）、どの候補も条件を満たさない島でもここから始まる——**この分布の
散らばりが、選抜をしても引きで決まってしまうかどうかの材料**になる（同2.3.3節）。

選ぶ順は「届かない数 → 全部が揃うまでの歩数 → その移動時間 → サイトのindex」で、良し悪しの
判定ではなく順序の定義（`src/domain/generation/StartSiteSelection.ts`）。探索時間は選ぶ材料に
入らない——難易度を切るのは歩数だけ（同2.3.2節）。

`island_start_site_by_need`は、歩数がほとんど動かないときに散らばりが移動時間と探索時間の側へ
出ることを見るための節。

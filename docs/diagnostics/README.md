# 診断・統計レポート

このフォルダには、実装の挙動を計測した**統計レポートの読み方**を格納します。設計そのもの
（`Concept/`/`UI/`/`Engine/`/`World/`）とは性質が異なり、「今の実装をシミュレーションした結果こうなった」
という**測定値**についての文書であり、設計判断や仕様を記述するものではありません。

## 他のフォルダとの違い

他のフォルダ（[`../README.md`](../README.md) 参照）が「こう設計する」という判断を記すのに対し、
`Diagnostics/` が扱うのは特定時点の実装に対する**測定結果**です。実装（レート・閾値等の数値）を
変えれば結果も変わるため、内容を手で書き換えるのではなく、対応するテストを再実行して**再生成**します。
バランス調整のたびに上書きしてよく、Git履歴が変化の記録になります。

## 数値の置き場は `stats/`

**数値の生成物は、リポジトリ直下の `stats/` に YAML で置きます。** 主要な読み手はもう人間ではなく
エージェントなので、生成するのは機械可読な数値だけにし、`docs/` には人が書いたものだけを置きます。
1レコード1行のフロー形式で書くのは、`git diff` に値だけが並んで**どのレコードの値かが分からなく
なる**のを避けるためです。

**7本すべてがこの形です。** `docs/diagnostics/*.md` が持つのは読み方——何を測ったか・どこに線を
引いたか・何を数えていないか——だけで、**数値は1行も書きません**（書けば、再生成したYAMLとずれます）。
どちらが古いかを運用で守らずに済むよう、**手書きの文書の「YAMLの節」の表とYAMLの節は、両方向で
突き合わせています**（片方にしか無い節があると `npm test` が赤くなる）。

## 文書へ書き写した数値には、出どころの印を置く

`docs/` の本文が `stats/*.yaml` の数値を書き写すときは、書いた数値の直後に出どころの印を置きます。
[`tests/docs/docStatsCitations.test.ts`](../../tests/docs/docStatsCitations.test.ts) が印の指すセルと
突き合わせます——**再生成すると文書だけが古い値を持ったまま緑になる**からです
（[issue #860](https://github.com/gooyyu1/UnmappedIsland/issues/860)）。

```text
**片道の平均は86.43分**<!-- stats: terrain.yaml base_one_way base=shortest_mean mean -->
```

形は `<!-- stats: <ファイル> <節> [<列>=<値> …] <読む列> [±<粗さ>] -->` です。`<列>=<値>` はレコードを
選ぶ条件で、**1件に絞れなければ赤**になります（節に別の `base` が入った、など）。印が掛かるのは
**直前の1つの数**だけです。コードとして書いた印——フェンスで囲んだブロックの中と、バッククォートで
囲んだ中——は書式の例なので読み飛ばします。

### 印を付けるのは、1つのセルの書き写しだけ

見るのは **YAMLの1つのセルを、丸めだけを挟んで書き写した数値**です。**複数のセルや仮置きから導いた
数値（158日・176日・48,700分など）には付けません**——導出は書き写しではなく文書の主張で、式を印に
書けるようにすると同じ計算が文書と生成器の2箇所に立ちます。対象は生成物だけで、人が書く定義
（`src/assets/world-codex/*.yaml`）は再生成でずれる問題を持たないので見ません。

### 下位桁が主張に効いていないなら、粗さを書く

`±` を書かなければ、**書いた桁へ丸めた厳密一致**です。`170.45` を「170分」とは書けますが、
`4,206.8` を「約4,200分」とは書けません。この既定のままだと、定義を触るPRが**結論に効かない下位桁
まで書き直す義務**を負い、同じ行を触るPRどうしがぶつかります。

`±` を足すと、**書いた数を中心とした幅**の中にセルがあれば緑になります。幅の書き方は2つで、
どちらも「どれだけ粗く書いたか」の1点だけを言います。

| 粗さ | 見方 | 「4,200」と書いたとき緑になる範囲 |
|---|---|---|
| （書かない） | 書いた桁へ丸めて一致 | 4,199.5以上 4,200.5未満 |
| `±100` | 出どころと同じ単位で±100 | 4,100〜4,300 |
| `±5%` | 書いた数の±5% | 3,990〜4,410 |

既定の行だけ上端が入らないのは、それが幅ではなく**丸めの規則**そのものだからです（`4,200.5` は
`4,201` へ丸まります）。

```text
4桁の労働がかかるのは筏（約4,200分<!-- stats: balance.yaml object_costs object=raft total_minutes ±5% -->）
```

**幅は、その一文の主張が壊れない広さにします。** 上の主張は「4桁の労働がかかる」なので、3桁や5桁へ
落ちる幅は取りません。この幅に収まっている限り、定義が動いても本文は動かさずに済みます。

セルの単位が既に%のときも、`±5%` は**書いた数の5%**です（`24.75%` なら±1.24ポイント）。ポイントで
幅を取りたいなら `±1` と書きます。

## 生成方法

各レポートは、`tests/diagnostics/` に置かれた対応するテスト（専用の環境変数が立っているときだけ実行され、
通常の `npm test` では実行されない）を実行して生成します。生成元テストと出力先はレポート冒頭にコメントで
記載しています。

```bash
npm run stats:balance
npm run stats:climate
npm run stats:durations
npm run stats:escape
npm run stats:escape-islands
npm run stats:startup
npm run stats:terrain
```

## 再生成し忘れると赤くなる

再生成は運用で守るものでしたが、**1度すり抜けました**（[issue #775](https://github.com/gooyyu1/UnmappedIsland/issues/775)）
——古いレポートと、そこから手で書き写した定数が**互いにだけ一致**したまま、どちらも今の定義を映していない
状態がしばらく続きました。運用で守るものは、守れなかったときに誰も気づけません。

そこで、**入力を変えたまま再生成しないと赤くなる**ようにしてあります。見張りは**2本立て**で、
PRの段では `npm test` が、`main` へ入った後は
[`regenerate-stats.yml`](../../.github/workflows/regenerate-stats.yml) が見ます。前者には原理的に
届かない古さがあり、そこを後者が持ちます。

### `npm test` ——PRの段

手立てはレポートの作り直しにかかる時間で分けています。

| レポート | 見張り方 |
|---|---|
| [アイテム収支](../../stats/balance.yaml) | **丸ごと作り直して比べる**（1秒で済むので取りこぼしが無い） |
| [気候システム統計](../../stats/climate.yaml) | シミュレーションの入力（`core.yaml`）の**指紋**をレポートへ書き込み、突き合わせる。定義から静的に解ける `activity_hours`・`excluded_locations` の節だけは作り直して比べる |
| [日をまたぐ長さ](../../stats/durations.yaml) | **丸ごと作り直して比べる**（定義から解くだけなので一瞬） |
| [島を出るまでの工程数](../../stats/escape_reach.yaml) | **丸ごと作り直して比べる**（定義から解くだけなので一瞬） |
| [島ごとの脱出可否](../../stats/island_escape_reach.yaml) | **丸ごと作り直して比べる**（2,000シードで2秒） |
| [開始地点の立ち上がり](../../stats/startup_reach.yaml) | **丸ごと作り直して比べる**（2,000シードでも2秒） |
| [地形生成統計](../../stats/terrain.yaml) | **丸ごと作り直して比べる**（500シードで1秒） |

いずれも、節が消えていないことはキーが在って中身が空でないことで見ます。

指紋を使っているのは気候だけで、それは**再生成に1分強かかる**からです（クラウドのセッションで67秒。
`npm test` 全体が25秒なので、丸ごと比べると3倍以上になります）。**作り直しが数秒で済むなら丸ごと
比べます**——指紋は「入力だと決めたファイル」の外を見ないので、そこから外れた入力（解析側が持つ
定数など）を取りこぼします。

指紋が見るのは `core.yaml` だけです。土地や食べ物の変更まで含めると、YAMLを1行直すたびに1分強の
再生成を要求することになります——**線を引いた位置は読み方の文書に書いてあります。**

### `regenerate-stats.yml` ——`main` へ入った後

`main` への push のたびに7本を丸ごと作り直し、差分が出たら `main` へ push し直します。
`npm test` に映らない古さを、ここが拾います。

- **生成物を触るPRが2本続いたぶん。** 2本目は1本目が入る前の定義から作られているので、gitの上では
  衝突しないまま入ります。
- **気候表が指紋の外で古くなったぶん。** シミュレーションのコードを変えても `core.yaml` は変わらない
  ので、指紋は一致したままです。**気候表にとっては、ここが丸ごとの突き合わせを持つ唯一の場所です。**

## 収録レポート

- [アイテム収支](../../stats/balance.yaml) — 素材から摂取までの総時間（土地ごと・プロパティごと）、
  待って得る生産のレートと必要設備数、キャラクタが1日に要る量、1工程あたりの所要時間と産出。
  実行結果ではなく、定義（`src/assets/world-codex/*.yaml`）だけから計算した値。
  読み方は [`BalanceStats.md`](./BalanceStats.md)。
  生成元: `tests/diagnostics/balanceStatsReport.test.ts`
  （計算は `src/analysis/balanceTables.ts`。同じ表はコーデックスビューアの `#/balance` でも見られる
  ——絵つきで読めるのはそちら、**数値を変えたときの差分を読めるのはこちら**）。
- [気候システム統計](../../stats/climate.yaml) — 季節の持続日数・気温・天気ごとの持続時間・
  連続降雨/未降雨時間（[`ClimateSystem.md`](../engine/ClimateSystem.md) 参照）と、土地×季節ごとの活動時間。
  読み方は [`ClimateSystemStats.md`](./ClimateSystemStats.md)。
  生成元: `tests/diagnostics/climateStatsReport.test.ts`
- [日をまたぐ長さ](../../stats/durations.yaml) — 怪我が治るまで・食べ物が腐るまで・季節が変わるまで・
  渇きや飢えで倒れるまでといった、**1日以上かかる長さを種類を問わず1本の列**にしたもの。並びの狂い
  （軽い傷のほうが治りが遅い、など）を見つけるための表なので、種類では分けない。あわせて、時間では
  減らず**使うたびに減る**値（道具の耐久）が尽きるまでの回数。
  読み方は [`DurationStats.md`](./DurationStats.md)。
  生成元: `tests/diagnostics/durationStatsReport.test.ts`（計算は `src/analysis/durations.ts`）
- [島を出るまでの工程数](../../stats/escape_reach.yaml) — 島を出るのに要るもの（`boat`・`sail`・
  `fishing_tool` を名乗る型と、そこへ推移的に要求される型）が、島の産物から何工程先にあるか
  （[`ContentSkeleton.md`](../world/ContentSkeleton.md) 3節の系統12参照）。定義だけから計算した値で、
  鎖が長すぎるかどうかの判定は出さない。
  読み方は [`EscapeReachStats.md`](./EscapeReachStats.md)。
  生成元: `tests/diagnostics/escapeReachStatsReport.test.ts`（計算は `src/analysis/escapeReach.ts`）
- [島ごとの脱出可否](../../stats/island_escape_reach.yaml) — 上と同じ鎖を、**生成された島が実際に
  持つ土地**から数えたもの。島を出られない島の割合と、土地の型の取りこぼし・鎖の切れ目。
  読み方は [`IslandEscapeReachStats.md`](./IslandEscapeReachStats.md)。
  生成元: `tests/diagnostics/islandEscapeReachStatsReport.test.ts`（計算は `src/analysis/escapeReach.ts`）
- [開始地点の立ち上がり](../../stats/startup_reach.yaml) — 最初の段を越えるのに要るもの6つが、
  各サイトから何歩先にあるか（移動時間・道を見つける探索時間つき）と、島ごとに最も条件の良い
  サイトの値の分布（[`ContentSkeleton.md`](../world/ContentSkeleton.md) 2.3節参照）。
  定義と生成された島だけから計算した値で、選抜やしきい値の判定は出さない。
  読み方は [`StartupReachStats.md`](./StartupReachStats.md)。
  生成元: `tests/diagnostics/startupReachStatsReport.test.ts`（計算は `src/analysis/startupReach.ts`）
- [地形生成統計](../../stats/terrain.yaml) — 土地1つあたりの道の本数（連結数）と余分な道の本数の
  分布、次数の分布、道の移動時間
  （[`TerrainGeneration.md`](../engine/TerrainGeneration.md) 3.5節参照）。あわせて**局面ごとの1日**
  ——島を開き切るまでの探索の局面と、開き切った後の定常の局面——を、島の広さと土地ごとの
  活動できる時間から数える（[`ContentSkeleton.md`](../world/ContentSkeleton.md) 8.2節・8.3節参照）。
  読み方は [`TerrainStats.md`](./TerrainStats.md)。
  生成元: `tests/diagnostics/terrainStatsReport.test.ts`（局面の計算は `src/analysis/dailyPhases.ts`）

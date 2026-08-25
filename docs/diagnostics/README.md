# 診断・統計レポート

このフォルダには、実装の挙動を計測した**統計レポートのスナップショット**を格納します。設計そのもの
（`Concept/`/`UI/`/`Engine/`/`World/`）とは性質が異なり、「今の実装をシミュレーションした結果こうなった」
という**測定値**であり、設計判断や仕様を記述するものではありません。

## 他のフォルダとの違い

他のフォルダ（[`../README.md`](../README.md) 参照）が「こう設計する」という判断を記すのに対し、
`Diagnostics/` のレポートは特定時点の実装に対する**測定結果**です。実装（レート・閾値等の数値）を
変えれば結果も変わるため、内容を手で書き換えるのではなく、対応するテストを再実行して**再生成**します。
バランス調整のたびに上書きしてよく、Git履歴が変化の記録になります。

## 生成方法

各レポートは、`tests/diagnostics/` に置かれた対応するテスト（専用の環境変数が立っているときだけ実行され、
通常の `npm test` では実行されない）を実行して生成します。生成元テストと出力先はレポート冒頭にコメントで
記載しています。

```bash
npm run stats:balance
npm run stats:climate
npm run stats:startup
npm run stats:terrain
```

## 再生成し忘れると赤くなる

再生成は運用で守るものでしたが、**1度すり抜けました**（[issue #775](https://github.com/gooyyu1/UnmappedIsland/issues/775)）
——古いレポートと、そこから手で書き写した定数が**互いにだけ一致**したまま、どちらも今の定義を映していない
状態がしばらく続きました。運用で守るものは、守れなかったときに誰も気づけません。

そこで、**入力を変えたまま再生成しないと `npm test` が赤くなる**ようにしてあります。手立ては
レポートの作り直しにかかる時間で分けています。

| レポート | 見張り方 |
|---|---|
| [アイテム収支](./BalanceStats.md) | **丸ごと作り直して比べる**（1秒で済むので取りこぼしが無い） |
| [気候システム統計](./ClimateSystemStats.md) | シミュレーションの入力（`core.yaml`）の**指紋**をレポートへ書き込み、突き合わせる。定義から静的に解ける「土地×季節ごとの活動時間」の節だけは作り直して比べる |
| [開始地点の立ち上がり](./StartupReachStats.md)・[地形生成統計](./TerrainStats.md) | **まだ無い**（[issue #780](https://github.com/gooyyu1/UnmappedIsland/issues/780)） |

指紋が見るのは `core.yaml` だけです。土地や食べ物の変更まで含めると、YAMLを1行直すたびに数分の
再生成を要求することになります——**線を引いた位置はレポートの冒頭に書いてあります。**

## 収録レポート

- [アイテム収支レポート](./BalanceStats.md) — 素材から摂取までの総時間（土地ごと・プロパティごと）、
  待って得る生産のレートと必要設備数、キャラクタが1日に要る量、1工程あたりの所要時間と産出。
  実行結果ではなく、定義（`src/assets/world-codex/*.yaml`）だけから計算した値。
  生成元: `tests/diagnostics/balanceStatsReport.test.ts`
  （計算は `src/analysis/balanceTables.ts`。同じ表はコーデックスビューアの `#/balance` でも見られる
  ——絵つきで読めるのはそちら、**数値を変えたときの差分を読めるのはこちら**）。
- [気候システム統計レポート](./ClimateSystemStats.md) — 季節の持続日数・気温・天気ごとの持続時間・
  連続降雨/未降雨時間の平均/最小/最大/標準偏差（[`ClimateSystem.md`](../engine/ClimateSystem.md) 参照）。
  生成元: `tests/diagnostics/climateStatsReport.test.ts`
- [開始地点の立ち上がりレポート](./StartupReachStats.md) — 最初の段を越えるのに要るもの6つが、
  各サイトから何歩先にあるか（移動時間・道を見つける探索時間つき）と、島ごとに最も条件の良い
  サイトの値の分布（[`ContentSkeleton.md`](../world/ContentSkeleton.md) 2.3節参照）。
  定義と生成された島だけから計算した値で、選抜やしきい値の判定は出さない。
  生成元: `tests/diagnostics/startupReachStatsReport.test.ts`（計算は `src/analysis/startupReach.ts`）
- [地形生成統計レポート](./TerrainStats.md) — 土地1つあたりの道の本数（連結数）と余分な道の本数の
  平均/最小/最大/標準偏差、次数の分布、道の移動時間
  （[`TerrainGeneration.md`](../engine/TerrainGeneration.md) 3.5節参照）。
  生成元: `tests/diagnostics/terrainStatsReport.test.ts`

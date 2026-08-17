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
npm run stats:terrain
```

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
- [地形生成統計レポート](./TerrainStats.md) — 土地1つあたりの道の本数（連結数）と余分な道の本数の
  平均/最小/最大/標準偏差、次数の分布、道の移動時間
  （[`TerrainGeneration.md`](../engine/TerrainGeneration.md) 3.5節参照）。
  生成元: `tests/diagnostics/terrainStatsReport.test.ts`

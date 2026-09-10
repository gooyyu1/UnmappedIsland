# 名前の検査（2026-08-23）

`src` 配下の全宣言について、**その宣言の責務を一言で言い、その一言が名前から読み取れるか**を見たもの。
[`2026-08-22-placement/`](../2026-08-22-placement/) が定義の**置き場**を見たのに対し、こちらは**名前**
だけを見た。

**これはこの回の記録で、当時のコードに対する答え。** 判定の物差しと調査の回し方は
[`review/README.md`](../README.md) が持つ（2.2節・1節）。前の回の明細表の最終列に添えた名前の指摘が
拾われなかったため、独立の観点として立て直した回。

## 結果

**全4,185件の採点を終えた。** 領域別の明細は [`areas/`](./areas/) にある。

| 範囲 | 件数 | A | B | C |
| ---- | ---- | -- | -- | -- |
| `src/domain`・`generation`・`wrappers` の説明なし ＋ `loader` ほか | 460 | 449 | 9 | 1 |
| [`areas/domain-doc.md`](./areas/domain-doc.md) `src/domain` 系の説明あり | 772 | 686 | 64 | 22 |
| [`areas/game-ui.md`](./areas/game-ui.md) `src/game/ui` 全件 | 1,012 | 981 | 23 | 8 |
| [`areas/game-rest.md`](./areas/game-rest.md) `src/game`・`view`・`looks`・`src/ui` 全件 | 855 | 782 | 66 | 7 |
| [`areas/analysis-codex.md`](./areas/analysis-codex.md) `analysis`・`codex-viewer`・`locale`・`save` ほか | 1,086 | 1,051 | 34 | 1 |
| **合計** | **4,185** | **3,949（94%）** | **196** | **39** |

**94%がA**——名前が責務を言い切っている。指摘は235件で、**いずれも適用済み**。
領域ごとの状況は [`Findings.md`](./Findings.md) に書いてある。

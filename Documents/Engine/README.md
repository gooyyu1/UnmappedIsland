# ルール・エンジン

`WorldCodex`（ゲーム内のあらゆる要素を定義するYAML）の文法そのもの、その文法を使ってどんな内容にも
適用できる汎用サブシステム（レシピ・コンテナ・耐久値・アクションの使い分け）、気候・地形生成・探索といった
**仕組み**（プレイヤーの目に触れるモノそのものではなく、それらを成り立たせているメカニズム）、および
実装のアーキテクチャ・コード構造に関するドキュメントを格納します。

石・斧・防具・容器など、「実際にこのゲームに登場する具体的なモノ」は含みません。そちらは
[`../World/`](../World/README.md) を参照してください。

## 収録ドキュメント

### YAML文法（WorldCodexの書き方そのもの）

- [WorldCodex YAML 文法リファレンス](./GameElementDefinition.md) — `traits`/`object_defs`/`props`/`stages`/`slots`/
  `passive`/`active`/`modify`/`accumulate`/`add`/`destroy`/`spawn`/`move`/`pick`/`actions`/`duration`/
  `combinations`/`recipes` 等、文法をここに集約
- [WorldCodex YAMLスキーマ定義](./WorldCodexSchema.md)（[JSON Schema本体](./WorldCodex.schema.json)） — 上記文法の
  機械的な検証

実際のゲームデータ（`public/world-codex/*.yaml`）を閲覧するツールは
[`../World/WorldCodexViewer.html`](../World/WorldCodexViewer.html) を参照してください。

### 汎用サブシステム（文法を使って、どんな内容にも適用できる仕組みの設計）

- [レシピシステム設計](./RecipeSystem.md)
- [スロットシステム設計](./SlotSystem.md) — 固定位置・受け入れ制約・スタックのまとまりと並び順
- [コンテナの容量と重さ](./ContainerSystem.md)
- [液体容器システム設計](./LiquidContainerSystem.md) — 量・飲用・注ぎ移し・蒸発の実現方法
- [耐久値システム設計](./DurabilitySystem.md)
- [アクションシステム設計](./ActionSystem.md) — actions / combinations の実行時の仕組み
- [気候システム設計](./ClimateSystem.md)
- [地形生成システム設計](./TerrainGeneration.md) — 島の座標・軸・LocationTypeマッチング・パスネットワーク生成のアルゴリズム
- [探索・道システム設計](./ExplorationSystem.md) — 生成された土地のスロット構成・探索・道の発見と移動

### 実装ガイド（コード構造の把握。「なぜ」ではなく「どこに・どう実装されているか」）

- [Domain.Defs と Domain.Runtime の統合方針](./DomainDefsRuntimeIntegration.md)
- [地形生成 実装ガイド](./TerrainGenerationImplementation.md) — 実際のクラス名・メソッド名でたどる、
  ロードから島の実体化までの呼び出し関係

### その他

- [設計の経緯・教訓集](./DesignNotes.md) — 再発防止のために残す過去の失敗・不採用の決定（本文には経緯を書かない）

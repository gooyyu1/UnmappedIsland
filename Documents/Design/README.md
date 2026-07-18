# 設計書

ゲームの技術的な設計に関するドキュメントを格納します。

## 収録ドキュメント

### YAML文法（WorldCodexの書き方そのもの）

- [WorldCodex YAML 文法リファレンス](./GameElementDefinition.md) — `traits`/`object_defs`/`props`/`stages`/`slots`/
  `passive`/`active`/`modify`/`accumulate`/`add`/`destroy`/`spawn`/`pick`/`actions`/`combinations`/`recipes` 等、
  文法をここに集約
- [WorldCodex YAMLスキーマ定義](./WorldCodexSchema.md)（[JSON Schema本体](./WorldCodex.schema.json)） — 上記文法の
  機械的な検証

### 世界の記述（文法を使って具体的なゲーム内容をどう表現するか）

- [気候システム設計](./ClimateSystem.md)
- [耐久値システム設計](./DurabilitySystem.md)
- [レシピシステム設計](./RecipeSystem.md)
- [コンテナの容量と重さ](./ContainerSystem.md)
- [カード間の相互作用（actions / combinations の使い分け）](./ActionSystem.md)
- [地形生成システム設計](./TerrainGeneration.md)

### その他

- [画面レイアウト検討](./ScreenLayout.md)

## 含まれるドキュメント例

- アーキテクチャ設計書
- クラス設計書（クラス図）
- データ設計書（ScriptableObject定義など）
- シーン構成設計
- セーブデータ設計
- パフォーマンス設計（Android向け最適化指針）

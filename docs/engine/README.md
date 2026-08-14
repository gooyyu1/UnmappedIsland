# ルール・エンジン

`WorldCodex`（ゲーム内のあらゆる要素を定義するYAML）の文法そのもの、その文法を使ってどんな内容にも
適用できる汎用サブシステム（レシピ・コンテナ・耐久値・アクションの使い分け）、気候・地形生成・探索といった
**仕組み**（プレイヤーの目に触れるモノそのものではなく、それらを成り立たせているメカニズム）、および
実装のアーキテクチャ・コード構造に関するドキュメントを格納します。

石・斧・防具・容器など、「実際にこのゲームに登場する具体的なモノ」は含みません。そちらは
[`../World/`](../world/README.md) を参照してください。

## 収録ドキュメント

### YAML文法（WorldCodexの書き方そのもの）

- [WorldCodex YAML 文法リファレンス](./GameElementDefinition.md) — `traits`/`object_defs`/`props`/`stages`/`slots`/
  `passive`/`active`/`modify`/`add`/`add`/`destroy`/`spawn`/`move`/`pick`/`actions`/`duration`/
  `combinations`/`recipes` 等、文法をここに集約
- [WorldCodex YAMLスキーマ定義](./WorldCodexSchema.md)（[JSON Schema本体](./WorldCodex.schema.json)） — 上記文法の
  機械的な検証

実際のゲームデータ（`public/world-codex/*.yaml`）を型・プロパティ・スロット・操作の単位で辿って読むには、
閲覧ビューア（`npm run dev:codex`、公開先は [`../../codex/`](../../codex/)）を開いてください。作りと設計判断は
`src/codex/` の各ファイルのコメントにあります。

### 汎用サブシステム（文法を使って、どんな内容にも適用できる仕組みの設計）

- [レシピシステム設計](./RecipeSystem.md) — 作りかけを「製作中オブジェクト」という普通の物として扱い、材料投入を「入れ物へ落とす」に載せる方法
- [スキルシステム設計](./SkillSystem.md) — レシピをいつ作れるようになるかを決める、習熟度の成長と解放条件
- [スロットシステム設計](./SlotSystem.md) — 固定位置・受け入れ制約・スタックのまとまりと並び順
- [コンテナの容量・重さ・保護](./ContainerSystem.md) — 重さの純粋な合算と、担ぎ方で変わる負荷（load）。持てるか・運べるかをどちらで決めるか
- [液体容器システム設計](./LiquidContainerSystem.md) — 量・飲用・注ぎ移し・蒸発・降雨の実現方法
- [耐久値システム設計](./DurabilitySystem.md) — 素材の屋外劣化と食料の腐敗を単一の durability で表す場合の減少量の目安
- [アクションシステム設計](./ActionSystem.md) — actions / combinations の実行時の仕組み
- [気候システム設計](./ClimateSystem.md) — 季節・天気を world のプロパティと貯水池モデルで駆動する方法
- [火システム設計](./FireSystem.md) — 炉の組み立て・燃料・熾による保火と、その熱を料理へ渡す受け渡し口
- [地形生成システム設計](./TerrainGeneration.md) — 島の座標・軸・LocationTypeマッチング・パスネットワーク生成のアルゴリズム
- [探索・道システム設計](./ExplorationSystem.md) — 生成された土地のスロット構成・探索・道の発見と移動
- [狩猟システム設計](./HuntingSystem.md) — 動物との対峙をターンや専用画面ではなく、怪我・時間・既存の操作へ載せる方法
- [罠システム設計](./TrapSystem.md) — 危険の代わりに時間と食料を賭ける道。見えないタイマー・土地ごとの成否・餌・掛かった獲物の拘束
- [怪我システム設計](./InjurySystem.md) — 傷を専用の体力値ではなく1つのオブジェクトとして表し、手当てを枠へ載せる方法
- [生命と意識のシステム設計](./VitalsSystem.md) — 何が意識を奪い、何が命を奪うか。気絶と死の表し方

- [ローカライゼーション](./Localization.md) — 表示文字列をWorldCodexから切り離し、言語ごとの対応表から引く仕組み

### 実装ガイド（コード構造の把握。「なぜ」ではなく「どこに・どう実装されているか」）

- [Domain.Defs と Domain.Runtime の統合方針](./DomainDefsRuntimeIntegration.md)
- [地形生成 実装ガイド](./TerrainGenerationImplementation.md) — 実際のクラス名・メソッド名でたどる、
  ロードから島の実体化までの呼び出し関係
- [ソースリファレンス](https://gooyyu1.github.io/UnmappedIsland/reference/) — `src/` のクラス・型・JSDocから
  TypeDocが自動生成する一覧（設計の意図はこのフォルダの手書きドキュメント側にある）

### その他

- [セーブデータ管理](./SaveDataManagement.md) — 保存先・スキーマ・削除の扱いなど、
  [スタート画面・セーブ選択画面](../ui/StartScreen.md)のモックから派生した永続化の決定。
  決まった開始状態から起動するテスト用シナリオもこの節にある
- [設計の経緯・教訓集](./DesignNotes.md) — 再発防止のために残す過去の失敗・不採用の決定（本文には経緯を書かない）

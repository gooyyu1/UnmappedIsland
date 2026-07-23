# ワールド（実際にゲームに登場するモノ）

`Engine/` の文法・仕組みを使って、**石・斧・防具・容器など、プレイヤーが実際に手に取り目にする具体的な
モノ**をどう表現するかをまとめたドキュメントを格納します。

気候・地形生成・探索といった**仕組み**（プレイヤーの目に触れるモノではなく、それらを成り立たせている
メカニズム）は含みません。そちらは [`../Engine/`](../Engine/README.md) を参照してください。文法そのもの
（`traits`/`props`/`slots`/`actions` 等）も同様に `Engine/` を参照してください。

## 収録ドキュメント

- [道具・武器・容器・衣類 アイテム案](./SurvivalItems.md)
- [WorldCodex データベースビューア](./WorldCodexViewer.html) — 実際のゲームデータ
  （`Assets/StreamingAssets/WorldCodex/*.yaml`）を表示のたびにGitHubから直接取得・解釈して一覧・詳細表示する、
  人間用の閲覧ツール（ビルド不要、YAMLの変更内容がそのまま反映される）。文法そのもの（YAML文法リファレンス）は
  [`../Engine/GameElementDefinition.md`](../Engine/GameElementDefinition.md) を参照

## 含まれるドキュメント例

- アイテム・道具・武器・容器・衣類などの内容案
- 敵・NPC・生態系（今後追加予定）

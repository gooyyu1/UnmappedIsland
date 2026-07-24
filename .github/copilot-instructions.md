# Copilot Agent Instructions

設計方針・コメントの書き方は [`CLAUDE.md`](../CLAUDE.md)、TypeScriptのコーディング規約は
[`Documents/Engine/CodingConventions.md`](../Documents/Engine/CodingConventions.md) に従うこと。

## docs/ フォルダについて

> ⛔ **`docs/` フォルダは絶対に編集・コミットしてはならない。** ⛔

`docs/` フォルダは **`Documents/` から自動生成される**。

- Markdown ファイル (`Documents/**/*.md`) は Pandoc で HTML に変換され `docs/` へ出力される。
- HTML・画像などの静的ファイル (`Documents/**/*.html`, `*.png` 等) はそのまま `docs/` にコピーされる。
- 変換・コピーは `.github/workflows/docs.yml` の GitHub Actions ワークフローが `main` ブランチへのプッシュ時に自動実行する。

**ドキュメント類を修正する際は必ず `Documents/` 以下のファイルを編集すること。** `docs/` への変更は次回ワークフロー実行時に上書きされる。

**エージェントへの厳守ルール:**
- `docs/` 以下のファイルを `create`・`edit`・`git checkout`・`git add` 等の手段でいかなる変更も行ってはならない。
- `git add docs/` や `git add docs/<file>` を実行してはならない。
- コミットに `docs/` 以下の変更が含まれていてはならない。これを過去に誤って行った場合は直ちに `git checkout <prev_sha> -- docs/` で元に戻すこと。

---

## 検証コマンド

変更後は以下がすべて成功することを確認すること。

```bash
npm run lint
npm run typecheck
npm test
```

## Phaserの画面をスクリーンショットで確認する

[`run` skill](../.claude/skills/run/SKILL.md) を使うこと。このプロジェクトは
`playwright`/`@playwright/test` に依存していないため素朴な起動方法では失敗する、という
環境固有の落とし穴と、その回避手順（スクリプト付き）をskill側にまとめてある。

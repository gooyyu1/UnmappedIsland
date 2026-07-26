# Copilot Agent Instructions

設計方針・コメントの書き方は [`CLAUDE.md`](../CLAUDE.md)、TypeScriptのコーディング規約は
[`Documents/Engine/CodingConventions.md`](../Documents/Engine/CodingConventions.md) に従うこと。

## 公開サイト（GitHub Pages）について

公開サイトは `.github/workflows/pages.yml` が `main` へのプッシュのたびに丸ごと作り直し、
GitHub Pages へ直接デプロイする。**生成物はリポジトリに存在しない**（出力先の `docs/` は
`.gitignore` 済み）。

- Markdown (`Documents/**/*.md`) は Pandoc で HTML に変換される。
- HTML・画像などの静的ファイル (`Documents/**/*.html`, `*.png` 等) はそのままコピーされる。
- ソースリファレンスは TypeDoc、ゲーム本体は Vite がビルドする。

**ドキュメント類を修正する際は必ず `Documents/` 以下のファイルを編集すること。** ローカルに
`docs/` を作っても公開内容には一切影響しない（コミットもされない）。

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

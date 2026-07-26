# Copilot Agent Instructions

設計方針・コメントの書き方は [`CLAUDE.md`](../CLAUDE.md)、TypeScriptのコーディング規約は
[`docs/engine/CodingConventions.md`](../docs/engine/CodingConventions.md) に従うこと。

## 公開サイト（GitHub Pages）について

公開サイトは `.github/workflows/pages.yml` が `main` へのプッシュのたびに丸ごと作り直し、
GitHub Pages へ直接デプロイする。**生成物はリポジトリに存在しない**（出力先の `site/` は
`.gitignore` 済み）。

原稿は `docs/` に置く。サイトは3本立てで、それぞれ出どころが違う。

| サイトのパス | 出どころ |
|---|---|
| `/docs/` | `docs/**/*.md` を Pandoc で HTML 化。`*.html`・画像はそのままコピー |
| `/reference/` | `src/` から TypeDoc が生成 |
| `/game/` | Vite がビルドしたゲーム本体 |

**ドキュメント類は `docs/` 以下を編集すること。** ローカルに `site/` を作っても公開内容には
影響しない（コミットもされない）。

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

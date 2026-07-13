# Copilot Agent Instructions

## docs/ フォルダについて

`docs/` フォルダは **`Documents/` から自動生成される**。直接編集してはならない。

- Markdown ファイル (`Documents/**/*.md`) は Pandoc で HTML に変換され `docs/` へ出力される。
- HTML・画像などの静的ファイル (`Documents/**/*.html`, `*.png` 等) はそのまま `docs/` にコピーされる。
- 変換・コピーは `.github/workflows/docs.yml` の GitHub Actions ワークフローが `main` ブランチへのプッシュ時に自動実行する。

**ドキュメント類を修正する際は必ず `Documents/` 以下のファイルを編集すること。** `docs/` への変更は次回ワークフロー実行時に上書きされる。

---

## スクリーンショット取得について

このエージェント環境では **Playwright MCP ツールは動作しない**（タイムアウト／OAuth エラーが発生する）。

スクリーンショットが必要な場合は、代わりに **Puppeteer + システム Chrome** を使用すること。

```bash
cd /tmp && npm install puppeteer
```

Node.js スクリプトでは以下のオプションを指定する:

```js
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
```

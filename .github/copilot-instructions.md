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

このプロジェクトは `playwright`/`@playwright/test` に依存していないため、`playwright-core` を
別途（プロジェクト外、例えばスクラッチパッド）にインストールし、環境に事前インストール済みの
Chromiumを直接指定して起動する。

```bash
npm install playwright-core   # プロジェクト外（スクラッチパッド等）で実行
ls /opt/pw-browsers/          # 現在のバージョン付きディレクトリ名（例: chromium-1194）を確認する
```

`chromium.launch()` の `executablePath` には、上記で確認した**バージョン番号付きディレクトリ**を
使うこと。`/opt/pw-browsers/chromium/chrome-linux/chrome`（バージョン番号なし）は存在せず失敗する。

```js
const { chromium } = require('/path/to/scratchpad/node_modules/playwright-core');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-XXXX/chrome-linux/chrome', // XXXXは実際のバージョン
});
```

開発サーバーの起動・待機・スクリーンショット取得を1回の複数行コマンドにまとめると
バックグラウンドジョブが不安定になることがある。次のように**ツール呼び出しを分ける**こと。

1. `nohup npx vite --port <port> > server.log 2>&1 & disown` でサーバーを起動し、`sleep` してから
   ログを確認する（これで1回のBash呼び出し）。
2. 起動を確認できたら、**別のBash呼び出しで** Playwright スクリプトを実行してスクリーンショットを撮る。

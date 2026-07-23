# Copilot Agent Instructions

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

## フォルダ名と名前空間の対応ルール

`Assets/Scripts/` および `Tests/` 以下では、**フォルダ名と名前空間を必ず一致させること**。

- `Assets/Scripts/<FolderPath>/` に置かれたファイルの名前空間は `UnmappedIsland.<FolderPath>` とする。
  - 例: `Assets/Scripts/Domain/Runtime/` → `namespace UnmappedIsland.Domain.Runtime`
  - 例: `Assets/Scripts/Loader/` → `namespace UnmappedIsland.Loader`
- `Tests/<FolderPath>/` に置かれたファイルの名前空間は `UnmappedIsland.<FolderPath>` とする。
  - 例: `Tests/Domain/` → `namespace UnmappedIsland.Domain`
  - 例: `Tests/StreamingAssets/` → `namespace UnmappedIsland.StreamingAssets`
  - 例: `Tests/Loader/` → `namespace UnmappedIsland.Loader`

名前空間がフォルダと一致しない場合は、ファイルを正しいフォルダへ移動するか、名前空間を修正すること。

---

## スクリーンショット取得について

このエージェント環境では **Playwright MCP ツールは動作しない**（タイムアウト／OAuth エラーが発生する）。

スクリーンショットが必要な場合は、代わりに **Puppeteer + システム Chrome** を使用すること。

```bash
# 日本語フォントのインストール（文字化け防止）
sudo apt-get install -y fonts-noto-cjk

cd /tmp && npm install puppeteer
```

Node.js スクリプトでは以下のオプションを指定する:

```js
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
```

### 日本語フォントについて

HTML モック (`Documents/UI/ScreenLayout_*.html`) には以下のフォント設定が含まれている:

- **Google Fonts**: `Noto Sans JP`（ブラウザでの表示用・オンライン時のみ）
- **システムフォント**: `Noto Sans CJK JP`（`fonts-noto-cjk` パッケージ、オフライン環境用）

スクリーンショット生成の前に `fonts-noto-cjk` を必ずインストールすること。

生成したスクリーンショットは `Documents/UI/screenshot_portrait.png` と `Documents/UI/screenshot_landscape.png` に上書きして保存する。GitHub Actions ワークフローはこれらをそのまま `docs/` にコピーする。

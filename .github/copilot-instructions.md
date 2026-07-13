# Copilot Agent Instructions

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

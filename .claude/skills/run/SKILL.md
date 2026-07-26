---
name: run
description: >-
  UnmappedIsland（Phaser + TypeScript + Viteのブラウザゲーム）を起動し、ヘッドレスブラウザで
  実際の画面をスクリーンショットして動作確認する。UI・Phaserシーン・レンダリングに関わる変更を
  加えた後、「動作確認して」「画面を見せて」「ちゃんと表示されるか確認して」と言われたとき、
  あるいはフロントエンドの変更を実ブラウザで検証したいときは必ずこのskillを使う。このプロジェクトは
  playwright/@playwright/testに依存していないため、素朴なPlaywrightの使い方では失敗する
  （後述の手順が必要）。
---

# UnmappedIslandの画面を確認する

## 前提: なぜ素朴な方法では動かないか

このプロジェクトは`playwright`/`@playwright/test`をpackage.jsonの依存に持っていない。そのため
`playwright-core`をプロジェクト外（スクラッチパッド等）に別途インストールし、環境に事前インストール
済みのChromiumバイナリを直接指定して起動する必要がある。

さらに、環境の`PLAYWRIGHT_BROWSERS_PATH`（既定`/opt/pw-browsers`）は`playwright`/
`@playwright/test`パッケージ経由なら自動解決されるが、`playwright-core`を直接使う場合はこの
解決ロジックが働かない。バージョン番号付きのサブディレクトリ（例: `chromium-1194`）まで自分で
確認し、`executablePath`に明示指定しないと起動に失敗する。このバージョン番号は環境の更新で
変わりうるため、`scripts/find-chromium.sh`で毎回解決すること（決め打ちしない）。

もう一つの落とし穴は、開発サーバーの起動・待機・ブラウザ操作を1回の複数行Bashコマンドに
まとめてしまうこと。バックグラウンドジョブの扱いが不安定になり、ログファイルが見つからない等の
原因不明な失敗につながることがあった。**サーバー起動の確認とブラウザ操作は必ず別々のBash呼び出しに
分ける**（下記の手順1と手順3）。

## 手順

以下、`<scratch>`はスクラッチパッドディレクトリ、`<project>`はこのリポジトリのルートを指す。

### 1. playwright-coreを用意する（セッション内で未インストールなら）

```bash
cd <scratch> && npm install playwright-core
```

### 2. Chromiumの実行パスを解決する

```bash
bash <project>/.claude/skills/run/scripts/find-chromium.sh
# => /opt/pw-browsers/chromium-XXXX/chrome-linux/chrome
```

### 3. 開発サーバーを起動する（1回のBash呼び出し）

```bash
bash <project>/.claude/skills/run/scripts/start-dev-server.sh <port> <scratch>/server.log <project>
```

`<port>`はVite既定の5173との衝突を避けるため、明示的に選ぶ（例: 5199）。
「起動確認OK」が出れば次へ進む。出なければログを見て原因を特定する（ポート衝突が多い）。

### 4. スクリーンショットを撮る（手順3とは別のBash呼び出し）

```bash
node <project>/.claude/skills/run/scripts/screenshot.mjs \
  --url http://localhost:<port>/ \
  --out <scratch>/screenshot.png \
  --executable-path <手順2で得たパス> \
  --module-dir <scratch>
```

標準出力にJSONで`{ screenshot, errors }`が返る。`errors`が空でなければ、`pageerror`
（実行時例外）かコンソールエラーが起きている。`favicon.ico`の404だけならPhaserの動作に
無関係なので無視してよい。撮った`screenshot.png`はReadツールで確認する。

### 5. 確認が終わったらサーバーを止める

```bash
pkill -f "[v]ite --port <port>"
```

**パターンの先頭は必ず`[v]`のように囲むこと。** `pkill -f`はコマンドライン全体を見るため、素直に
`pkill -f "vite --port 5199"`と書くと、**それを実行しているシェル自身**（`/bin/bash -c pkill -f "vite --port 5199"`）
にもマッチしてシェルごと殺してしまう。結果、終了コードが144になり、`&&`で続けたコマンドが一切実行
されない（サーバーが動いていなくても起きる）。`[v]ite`と書けば、正規表現としては`vite`にマッチする一方、
コマンドライン上の文字列は`[v]ite`なので自分自身にはマッチしない。

```bash
# 悪い例: シェルごと死んで exit 144。後続の && が実行されない
pkill -f "vite --port 5199" && npm test

# 良い例: 停止に成功すれば0、動いていなければ1。どちらでもシェルは生き残る
pkill -f "[v]ite --port 5199" || true
```

同じ理由で`pgrep -f`にも`[v]`を付ける（付けないと自分自身が一致して紛らわしい）。

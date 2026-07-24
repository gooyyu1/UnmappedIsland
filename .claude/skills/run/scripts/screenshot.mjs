#!/usr/bin/env node
// ヘッドレスChromiumでURLを開き、ページ実行時エラー・コンソールエラーを収集しつつ
// スクリーンショットを1枚保存する。playwright-coreはプロジェクトの依存ではないため、
// --module-dir でインストール先（例: スクラッチパッドのnode_modules）を明示する。
//
// 使い方:
//   node screenshot.mjs --url http://localhost:5199/ --out shot.png \
//     --executable-path /opt/pw-browsers/chromium-XXXX/chrome-linux/chrome \
//     --module-dir /path/to/scratchpad [--width 800] [--height 600] [--wait 1500]

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = ['url', 'out', 'executable-path', 'module-dir'];
const missing = required.filter((key) => !args[key]);
if (missing.length > 0) {
  console.error(`必須引数が不足しています: ${missing.map((k) => `--${k}`).join(', ')}`);
  process.exit(1);
}

const { createRequire } = await import('node:module');
const require = createRequire(`${args['module-dir']}/`);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ executablePath: args['executable-path'] });
try {
  const page = await browser.newPage({
    viewport: { width: Number(args.width ?? 800), height: Number(args.height ?? 600) },
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(args.wait ?? 1500));
  await page.screenshot({ path: args.out });

  // favicon.ico の404はPhaserの動作に無関係なので、呼び出し側で無視してよい。
  console.log(JSON.stringify({ screenshot: args.out, errors }));
} finally {
  await browser.close();
}

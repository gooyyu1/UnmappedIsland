#!/usr/bin/env node
// ヘッドレスChromiumでゲームを操作しながら、複数枚のスクリーンショットを撮る。
// 1枚撮るだけならscreenshot.mjsで足りる。こちらは「タイトルから遊び始めて、時間経過の途中を見る」
// のように、画面を進めながら何枚も撮りたいときに使う。
//
// **撮影はCDP（Chrome DevTools Protocol、ブラウザを外から操作する低レベルの通信規約）の
// Page.captureScreenshotで行う。** Playwrightのpage.screenshot()は描画が落ち着くのを待つが、
// Phaserは毎フレーム描き続ける（requestAnimationFrame）ので落ち着くことがなく、2枚目以降が
// 返ってこない。
//
// 使い方:
//   node playthrough.mjs --url http://localhost:5199/ --out-dir /path/to/scratch \
//     --executable-path /opt/pw-browsers/chromium-XXXX/chrome-linux/chrome \
//     --module-dir /path/to/scratch \
//     --steps '[[450,270,1500,"01-title"],[-1,0,400,"02-after"]]'
//
// stepsは [x, y, 待つミリ秒, 保存名] の配列。xが負なら押さずに待って撮るだけ。
// [x, y, 待つミリ秒, 保存名, dx, dy] と6つ書くと、(x,y)から(dx,dy)だけドラッグする
// （スクロールや札の移動を確かめるとき）。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = ['url', 'out-dir', 'executable-path', 'module-dir', 'steps'];
const missing = required.filter((key) => !args[key]);
if (missing.length > 0) {
  console.error(`必須引数が不足しています: ${missing.map((k) => `--${k}`).join(', ')}`);
  process.exit(1);
}

const steps = JSON.parse(args.steps);
const outDir = args['out-dir'];

const { createRequire } = await import('node:module');
const require = createRequire(`${args['module-dir']}/`);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ executablePath: args['executable-path'] });
const page = await browser.newPage({
  viewport: { width: Number(args.width ?? 900), height: Number(args.height ?? 640) },
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  // favicon.icoの404はPhaserの動作に無関係。
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

const cdp = await page.context().newCDPSession(page);
const shots = [];
const shoot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(data, 'base64'));
  shots.push(path);
};

// networkidleは待たない（Phaserが描き続けるので落ち着かないことがある）。
await page.goto(args.url, { waitUntil: 'load' });
await page.waitForTimeout(Number(args.boot ?? 2500));

for (const [x, y, wait, name, dx, dy] of steps) {
  if (dx !== undefined || dy !== undefined) {
    // 1回で動かすとPhaserがドラッグと認めないことがあるので、何度かに分けて動かす。
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(x + ((dx ?? 0) * step) / 8, y + ((dy ?? 0) * step) / 8);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  } else if (x >= 0) {
    await page.mouse.click(x, y);
  }
  await page.waitForTimeout(wait);
  await shoot(name);
}

console.log(JSON.stringify({ shots, errors }));
// Phaserが回り続けているとcloseを待ち切らないことがあるので、報告し終えたら自分で降りる。
await browser.close();
process.exit(0);

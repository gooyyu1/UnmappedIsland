import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pngToWebp } from './vite.config';

/**
 * WorldCodexデータベースビューア（codex/index.html）のビルド設定。
 *
 * ゲームとは別のページなので入口も別だが、読むデータ（src/world-codex/）も絵（src/assets/）も
 * ソース（src/）も同じものを指す。ルートをcodex/に置くのは、出力をそのまま`site/codex/`として
 * 公開できるようにするため。
 */
export default defineConfig({
  root: 'codex',
  plugins: [pngToWebp()],
  // ルートがcodex/なので、入口のHTMLが書く`/src/...`はそのままではcodex/src/…を指してしまう。
  // リポジトリのsrc/へ向け直して、ゲーム側と同じ書き方（絶対パス）で本体を指せるようにする。
  resolve: {
    alias: { '/src': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    outDir: '../site/codex',
    emptyOutDir: true,
  },
});

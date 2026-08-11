import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import sharp from 'sharp';

/**
 * WebPの非可逆圧縮の品質。カードの絵・背景とも水彩調で高周波成分が少なく、この値で見た目の差は
 * 出ない一方、PNG比でおおむね1/5以下になる。
 */
const WEBP_QUALITY = 80;

/**
 * ビルドで出力されるPNGをWebP（非可逆）へ変換するプラグイン（ビューアのビルド
 * （vite.codex.config.ts）も同じものを使う）。
 *
 * リポジトリのPNGはマスターとしてそのまま残し、配信物だけを軽くする。ソース側の規約
 * （`src/assets/` にPNGを置くだけ、objectArt/backgroundArt参照）は変わらず、変換は出力ファイル名の
 * 拡張子とチャンク内のURL文字列の書き換えで完結する。テクスチャキーはソースのパスから作られる
 * ため影響しない。開発サーバー（vite dev）は変換せずPNGをそのまま配る。
 */
export function pngToWebp(): Plugin {
  return {
    name: 'png-to-webp',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const renames = new Map<string, string>();
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !fileName.endsWith('.png')) continue;
        const webp = await sharp(Buffer.from(output.source)).webp({ quality: WEBP_QUALITY }).toBuffer();
        delete bundle[fileName];
        const webpName = fileName.replace(/\.png$/, '.webp');
        this.emitFile({ type: 'asset', fileName: webpName, source: webp });
        // URLの書き換えはハッシュ付きファイル名の単位で行う。チャンクに埋まるURLの形はbase設定で
        // 変わり、相対base（--base=./）では `assets/` を含まないファイル名だけになる。ファイル名は
        // 内容ハッシュ入りで一意なので、部分文字列置換でフルパス表記にもそのまま効く。
        renames.set(fileName.split('/').pop() as string, webpName.split('/').pop() as string);
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [from, to] of renames) output.code = output.code.replaceAll(from, to);
      }
    },
  };
}

export default defineConfig({
  plugins: [pngToWebp()],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

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
 *
 * 走るのは公開するビルド（`--mode publish`、pages.yml）だけ。Phaserはどちらの形式でも動き、この変換は
 * 配信量を減らすためだけのものなので、バンドルが壊れていないかを見るだけのビルドでは要らない。
 */
export function pngToWebp(): Plugin {
  return {
    name: 'png-to-webp',
    apply: (_config, env) => env.command === 'build' && env.mode === 'publish',
    async generateBundle(_options, bundle) {
      const pngs = new Map<string, Buffer>();
      for (const [fileName, output] of Object.entries(bundle))
        if (output.type === 'asset' && fileName.endsWith('.png'))
          pngs.set(fileName, Buffer.from(output.source));

      // 1枚ずつ順に変換すると、127枚でビルド時間の半分以上をここが占める。変換は互いに独立なので
      // まとめて走らせる。
      const converted = await Promise.all(
        [...pngs].map(async ([fileName, png]) => ({
          fileName,
          webp: await sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer(),
        })),
      );

      const renames = new Map<string, string>();
      for (const { fileName, webp } of converted) {
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
    // ファイルごとにモジュールを読み直さず、ワーカー内で使い回す。テストの中身より、94ファイル分の
    // 読み直しのほうが実行時間の大半を占めていた（20.1秒→5.8秒）。使い回せる前提として、テストは
    // モジュールレベルの状態を書き換えたまま終わってはいけない（ここを破ると、実行順で結果が変わる）。
    isolate: false,
  },
});

import { join } from 'node:path';

/**
 * サンプルアセットパック（AssetPack.md）の在処。テストはリポジトリルートで実行される前提。
 *
 * 元のファイルは `sample-pack/`、配る形は `public/sample-pack.zip`（`npm run pack:sample` で固める）。
 */
export const SAMPLE_PACK_DIR = 'sample-pack';
export const SAMPLE_PACK_ZIP = join('public', 'sample-pack.zip');

/** `sample-pack/` 内の1ファイルへのパス。 */
export function samplePackPath(fileName: string): string {
  return join(SAMPLE_PACK_DIR, fileName);
}

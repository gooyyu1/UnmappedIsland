import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** リポジトリの根。置き場を字面で辿る検査（tests/architecture）が、ここを起点にする。 */
export const ROOT = resolve(__dirname, '../..');

/**
 * そのディレクトリ以下のソース（リポジトリ相対）。既定では`.ts`だけを拾い、`extensions`を渡すと
 * その種類を拾う（`scripts`・`.claude`には`.mjs`で書かれたものが在る）。
 *
 * **ファイル1つを名指しされたら、それを1件だけ返す**——検査の対象には置き場だけでなく、層の外の
 * 1ファイル（`src/game/errorReport.ts`・`src/game/launchSeed.ts`）も並ぶため。
 */
export function sourcesIn(dir: string, extensions: readonly string[] = ['.ts']): string[] {
  if (extensions.some((extension) => dir.endsWith(extension))) return [dir];
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(rel);
  }
  return found;
}

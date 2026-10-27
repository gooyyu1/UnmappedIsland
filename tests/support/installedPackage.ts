import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './sourceFiles';

/**
 * 依存のパッケージが入っている場所を、Node と同じく `from` から親を遡って引く。**作業ツリーの直下とは
 * 限らない**——`.claude/worktrees/` の作業ツリーは本体の `node_modules` を共有する
 * （`agent-ops/parallel-work.md`「本体のチェックアウトは、`main` が動いたら追随させる」）。
 *
 * どこにも無ければ、欠けた依存の名前と揃え方を告げて落ちる。**検査が見ている面の赤と読ませない**ため
 * で、黙って空を返す形にはしない（依存先を読む検査が素通しになる）。
 */
export function installedPackageDir(pkg: string, from: string = ROOT): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', pkg);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) break;
  }
  throw new Error(
    `依存 ${pkg} が、${from} から遡ったどの node_modules にも入っていない。検査の対象の不具合ではなく、` +
      "作業ツリーに依存が揃っていない——'npm install' を打つ（本体を共有する作業ツリーなら本体で）。",
  );
}

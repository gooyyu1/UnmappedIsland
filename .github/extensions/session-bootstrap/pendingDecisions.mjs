// 未処理の判断の履歴の数え方。**`.claude/hooks/inject-policies.sh` と同じ数え方・同じしきい値でなければ
// ならない**（一致は tests/scripts/pendingDecisions.test.ts が同じ置き場を両方に数えさせて見る）。
// extension.mjs から切り出してあるのは、Copilot の SDK 無しに読み込んで突き合わせるため。

import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** 未処理の履歴がこの数に達したら棚卸しを促す。 */
export const DECISIONS_THRESHOLD = 10;

export async function countPendingDecisions(repoDir) {
  try {
    // 直下の .md だけを数える。archive/ に在るのは棚卸し済み。隠しファイルも履歴なので拾い、
    // 実体でないもの（ディレクトリ・シンボリックリンク）は数えない。
    const entries = await readdir(path.join(repoDir, 'agent-ops', 'decisions'), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

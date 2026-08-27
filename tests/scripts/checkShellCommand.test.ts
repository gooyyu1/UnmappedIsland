import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * シェルの判定フック（`scripts/agent/check-shell-command.sh`）が引く線の検査。
 *
 * このフックは**引用の中身も等しく見る**。Windowsではすべて `bash -lc "..."` から走るので、
 * 引用の中を見ない作りにすると `bash -lc "printf x > src/..."` が素通りし、線が丸ごと消える。
 * その代わり、リダイレクトではない `>`（矢印・jqの名前付きグループ・文中の記号）を数えて
 * 誤って拒否する余地がある。
 *
 * そのため、通すもの・拒否するものを両方並べる。片方だけでは、**全部拒否する**フックも
 * **何も拒否しない**フックも緑になる。
 */

const HOOK = resolve(__dirname, '../../scripts/agent/check-shell-command.sh');

/** フックへ命令を流した結果。終了コード1が拒否で、理由が標準出力に出る。 */
function judge(command: string): { denied: boolean; message: string } {
  const run = spawnSync('bash', [HOOK], { input: command, encoding: 'utf-8' });
  if (run.error) throw run.error;
  return { denied: run.status !== 0, message: run.stdout };
}

/** ファイルを書かないので通すもの。 */
const ALLOWED = [
  // 引用で包んだ行き先。中身が変数展開なら、読めないので判定しない。
  'D="$LOCALAPPDATA/Temp"; printf "%s" "{}" > "$D/ls.json"',
  "printf '%s' '{}' > '$D/ls.json'",
  // jq の名前付きグループを閉じる `>`。
  'gh pr view 887 --json body --jq ".body|capture(\\"closes #(?<n>[0-9]+)\\").n"',
  // アロー関数の `=>`。
  'node -e "const f = (d) => s+=d;"',
  // 一時ディレクトリと捨て先。
  'gh issue view 732 --json body > /tmp/body.json',
  'npm test > /dev/null 2>&1',
  // 読み出しは制限しない。
  'sed -n 1,40p src/domain/World.ts',
  'git log --oneline -1 | head -3',
];

/** リポジトリのファイルを書き換えるので拒否し続けるもの。 */
const DENIED = [
  // 引用の中を見ることを降ろすと、この4件が素通りする。
  'bash -lc "printf x > src/domain/World.ts"',
  'bash -lc "printf x >> src/domain/World.ts"',
  'bash -lc "tee src/domain/World.ts"',
  'bash -lc "sed -i s/a/b/ src/domain/World.ts"',
  '> src/domain/World.ts',
  'npm run build >> build.log',
  'cat x | tee "CLAUDE.md"',
  "perl -i -pe 's/a/b/' CLAUDE.md",
  // `<` と対にした `>` を無条件に読み飛ばすと、後ろのリダイレクトごと消える。
  'cat <a.txt>src/domain/World.ts',
  // 文中に記号として書いた `>`。**これは通せない**——`bash -lc "... > src/..."` と同じ形で、
  // この判定では見分けが付かない。引用符で括り直すか、別の書き方へ替える。
  'gh issue create --title "... 引用の中の > を数える"',
];

describe('シェルの判定フック', () => {
  it.each(ALLOWED)('通す: %s', (command) => {
    const { denied, message } = judge(command);
    expect(denied, `拒否された:\n${message}`).toBe(false);
  });

  it.each(DENIED)('拒否する: %s', (command) => {
    expect(judge(command).denied, '通ってしまった').toBe(true);
  });
});

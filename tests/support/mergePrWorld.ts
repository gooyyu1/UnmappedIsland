import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { vi } from 'vitest';

import { pathForBash, runScript } from './runScript';
import { STUB_SHEBANG } from './stubShebang';

/**
 * `scripts/agent/merge-pr.sh` を実際に走らせるための世界。
 *
 * `gh` を PATH の先頭に、関門を `NEEDS_USER_REVIEW` で差し替える。
 *
 * **1回の実行で外部プロセスがいくつも起きる**ので、Windowsではプロセス生成（1回10〜30ms）が
 * そのまま試験の時間になる。**1ファイルに詰め込むと vitest のワーカーが本体へ返す `onTaskUpdate` の
 * 60秒を超えて落ちる**——同期の `execFileSync` がイベントループを止めるので、本体からの返事を
 * 受け取る前にタイマーが鳴る。だから叩く側は責務ごとにファイルを分けてある
 * （後片付けの側は [`tidyMergedPrWorld`](tidyMergedPrWorld.ts)）。
 *
 * 身代わりの先頭の1行を直に書かず [`STUB_SHEBANG`](stubShebang.ts) から取るのも同じ理由。
 */

// 全件が実プロセス（bash + gh のスタブ）を起こすため、既定の5秒だと `npm test` 全体を並行実行
// したときのCPU競合だけで時間切れになりうる。**叩く側ではなくここが持つ**——世界がプロセスを起こす
// ことを知っているのはこちらで、叩く側は毎回それを覚えていなくてよい。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-pr.sh');

export interface World {
  readonly mergeable?: string;
  /** 関門（`needs-user-review.sh`）が出す理由。既定は該当なしで、関門は開いている。 */
  readonly gate?: readonly string[];
  /** 関門の終了コード。既定は理由の有無から決まる（あれば 0、無ければ 1）。 */
  readonly gateStatus?: number;
  /** PRの番号の後ろへ足す引数。**関門を越える口が生えていないこと**を見張るのに使う。 */
  readonly extra?: readonly string[];
}

export interface Run {
  readonly lines: string[];
  readonly status: number;
  /** `gh pr merge` が呼ばれたか。 */
  readonly merged: boolean;
  /** `gh pr edit` に渡されたラベルの操作。 */
  readonly labels: string[];
}

/** 世界を組んで叩く。 */
export function run(world: World): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-merge-pr-'));
  try {
    const dir = pathForBash(work);

    // PRの `state` は、マージが呼ばれたかで変わる。**絞り込みも符号化も真似ない**——`--jq` の式は
    // 本物の `gh` が解く。ここが真似ると、式だけを変えても試験は緑のまま通る。
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `${STUB_SHEBANG}
if [ "$1" = pr ] && [ "$2" = merge ]; then
  touch '${dir}/merged'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  if [ -e '${dir}/merged' ]; then state=MERGED; else state=OPEN; fi
  case "$5" in
    mergeable) printf '%s' '${world.mergeable ?? 'MERGEABLE'}' ;;
    state) printf '%s' "$state" ;;
  esac
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = edit ]; then
  shift 3
  echo "$*" >> '${dir}/labels'
  exit 0
fi
exit 1
`,
      'utf-8',
    );
    chmodSync(stub, 0o755);

    // 関門。理由が1件でもあれば 0（＝該当あり）を返す。`needs-user-review.sh` と同じ約束。
    const gate = join(work, 'needs-user-review.sh');
    writeFileSync(
      gate,
      `${STUB_SHEBANG}\n${(world.gate ?? []).map((line) => `echo '${line}'`).join('\n')}\nexit ${
        world.gateStatus ?? ((world.gate ?? []).length > 0 ? 0 : 1)
      }\n`,
      'utf-8',
    );

    let status = 0;
    let out = '';
    try {
      out = runScript(SCRIPT, ['1000', ...(world.extra ?? [])], {
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          NEEDS_USER_REVIEW: gate,
        },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 1;
      out = failure.stdout ?? '';
    }
    const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');
    return {
      lines: lines(out),
      status,
      merged: existsSync(join(work, 'merged')),
      labels: existsSync(join(work, 'labels')) ? lines(readFileSync(join(work, 'labels'), 'utf-8')) : [],
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

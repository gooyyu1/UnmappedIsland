import { execFileSync } from 'node:child_process';

/**
 * 試験がPATHへ置く身代わりのスクリプトの、先頭の1行。
 *
 * **`#!/usr/bin/env bash` と書くと、身代わりを呼ぶたびに `env` のプロセスが1つ余分に起きる。**
 * `scripts/agent/**` を叩く試験は1件で外部プロセスを数十個起こし、Windowsではその生成が1回
 * 10〜30msかかるので、この1段だけで1割ほど遅くなる（`mergeAndCloseSessions.test.ts` で26.9秒→24.4秒）。
 *
 * かといって `#!/bin/bash` と決め打つと、bash がそこに無い環境で壊れる。**走らせている bash 自身の
 * 在り処を1回だけ引いて、それを書く**——1段減らしても、決め打ちの前提を新しく作らない。
 *
 * 本物のスクリプト（`scripts/agent/**`）は `#!/usr/bin/env bash` のままでよい。あちらは実行ビットで
 * 直に起動され、置き場も走らせる相手もこちらの管理外にある。
 */
export const STUB_SHEBANG = `#!${execFileSync('bash', ['-c', 'command -v bash'], {
  encoding: 'utf-8',
}).trim()}`;

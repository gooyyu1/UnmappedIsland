// GitHub に在る issue を、立てられた日（日本時間）ごとに数えて
// [`stats/issues.tsv`](../stats/issues.tsv) へ書き出す。
//
// 使い方:
//   npm run stats:issues
//
// **`gh` は使わない。** タスクのセッションはクラウドで走り、そこに `gh` は入っていない。`gh` に
// 頼ると、[`docs/HowWeGotHere.md`](../docs/HowWeGotHere.md) の「規模の推移」を作り直せる場所が
// 手元のPCだけになり、クラウドから回すと issue の列だけが落ちた表が出る（issue #1887）。
//
// **日付ごとの検索ではなく、リポジトリ直下の一覧を全部めくる。** `search/issues` なら日付1つに
// つき1回で数を返せるが、クラウドのセッションからは塞がれている——通るのはリポジトリに紐づく
// 経路（`repos/{owner}/{repo}/...`）だけ。
//
// **一覧にはPRも混ざる。** GitHubでは番号を共有しており、`pull_request` を持つものがPR。
//
// **認証は付けない。** 公開リポジトリなので読めるが、素通しだと1時間に60回までなので、続けて
// 何度も回すと弾かれる（弾かれたら、その旨と待ち時間を出して落ちる）。
//
// **網へ出るのはこの道具だけ。** 表を作る側（`historyStats.mjs`）は書き出した結果を読むので、
// 網の無い環境でも、検査で何度回しても、外へは出ない。
//
// `package.json` の `stats:issues` が `NODE_USE_ENV_PROXY=1` を付けているのは、**node 組み込みの
// `fetch` が `HTTPS_PROXY` を既定では読まない**ため。読まないまま直通で出ると、プロキシを挟む
// 環境（クラウドのセッション）では認証の付かない経路になり、1時間に60回の枠にすぐ当たる。

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { japanDayOf } from './japanDay.mjs';
import { ISSUE_HISTORY_FILE, formatIssueHistory } from './issueHistory.mjs';

/** 1回で取れる上限。GitHubの決まり。 */
const PER_PAGE = 100;

function repository() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url);
  if (match === null) throw new Error(`originのURLから owner/repo を取れない: ${url}`);
  return match[1];
}

async function fetchPage(owner, page) {
  const query = new URLSearchParams({
    state: 'all',
    sort: 'created',
    direction: 'asc',
    per_page: String(PER_PAGE),
    page: String(page),
  });
  const response = await fetch(`https://api.github.com/repos/${owner}/issues?${query}`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(response.headers.get('x-ratelimit-reset')) * 1000);
    throw new Error(`GitHubの回数の上限に当たった。${reset.toISOString()} より後にもう一度。`);
  }
  if (!response.ok) throw new Error(`GitHubが ${response.status} を返した: ${await response.text()}`);
  return await response.json();
}

const owner = repository();
const createdByDay = new Map();
let issues = 0;
for (let page = 1; ; page += 1) {
  const items = await fetchPage(owner, page);
  for (const item of items) {
    // 番号はPRと共有なので、PRを落とさないと issue の数にならない。
    if (item.pull_request !== undefined) continue;
    const day = japanDayOf(new Date(item.created_at));
    createdByDay.set(day, (createdByDay.get(day) ?? 0) + 1);
    issues += 1;
  }
  process.stderr.write(`\r${page}ページ目まで: issue ${issues}件`);
  if (items.length < PER_PAGE) break;
}
process.stderr.write('\n');

const measuredDay = japanDayOf(new Date());
writeFileSync(ISSUE_HISTORY_FILE, formatIssueHistory(createdByDay, measuredDay));
console.error(`書き出した: ${ISSUE_HISTORY_FILE.pathname}（${measuredDay} まで・issue ${issues}件）`);

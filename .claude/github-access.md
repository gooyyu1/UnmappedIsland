# GitHub を触る道具

issue とPRを読み書きする手。**ここが持つのは「どちらの道具で引くか」だけで、「何を引くか・何を
書くか」は係の側（`.claude/*-prompt.md`）が持つ。** 係ごとに違うのは後者だけなので、道具の名前や
引数が変わったときに直す先をここ1箇所にしてある。

## まず `command -v gh` を打つ

`gh` が在るのはユーザーのPCで走るときだけで、**クラウドのセッションには入っていない**——無いほうが
普通。無いときは GitHub の MCP で同じことをする。**打たずにどちらかを決め打つと、外れた側では最初の
1手から止まる。**

## issue を読む・書く

| やること | `gh` があるとき | 無いとき |
| --- | --- | --- |
| 開いているものを引く | `gh issue list --state open --limit <上限> --json number,title,labels` | `list_issues`（`state: "OPEN"`・`fields: ["number","title","labels"]`） |
| 題や本文で探す | `gh issue list --state open --limit <上限> --json number,title --search '<検索語>'` | `search_issues`（`query: "repo:gooyyu1/UnmappedIsland is:issue is:open <検索語>"`） |
| 本文を読む | `gh issue view <番号> --json body` | `issue_read`（`method: "get"`） |
| 立てる | `gh issue create --title <題> --body-file <本文のファイル> --label <ラベル>` | `issue_write`（`method: "create"`・`title`・`body`・`labels`） |
| 本文を書き換える | `gh issue edit <番号> --body-file <本文のファイル>` | `issue_write`（`method: "update"`・`issue_number`・`body`） |
| ラベルを付け替える | `gh issue edit <番号> --add-label <ラベル>` | `issue_write`（`method: "update"`・`issue_number`・`labels`） |
| コメントを置く | `gh issue comment <番号> --body-file <本文のファイル>` | `add_issue_comment`（`issue_number`・`body`） |

**`issue_write` の `labels` には、付け直した後の全部を渡す。** 足すぶんだけを渡すと、既に付いている
ラベルが落ちる。`gh` の `--add-label` は足すだけなので、そちらにこの穴は無い。

`gh` の `--label` は1つにつき1回書く。**ラベルの綴りに `:` が入っていても、Windows で化けることは
無い**——`kind:task` も `origin:agent` もそのまま通る（実測 2026-09-06）。

## PR を読む・書く

| やること | `gh` があるとき | 無いとき |
| --- | --- | --- |
| 本文を読む | `gh pr view <番号>` | `pull_request_read`（`method: "get"`） |
| 差分を読む | `gh pr diff <番号>` | `pull_request_read`（`method: "get_diff"`） |
| コメントを読む | `gh pr view <番号> --json comments` | `pull_request_read`（`method: "get_comments"`） |
| マージ済みを引く | `gh pr list --state merged --search 'merged:>=<窓の始まり>' --limit <上限> --json number` | `search_pull_requests`（`query: "repo:gooyyu1/UnmappedIsland is:pr is:merged merged:>=<窓の始まり>"`・`perPage: 100`） |
| コメントを置く | `gh pr comment <番号> --body-file <本文のファイル>` | `add_issue_comment`（`issue_number` にPRの番号・`body`） |
| コメントへ 👀 を付ける | `gh api -X POST repos/{owner}/{repo}/issues/comments/<コメントの id>/reactions -f content=eyes` | `add_issue_comment`（`issue_number` にPRの番号・`comment_id`・`reaction: "eyes"`。**`body` は渡さない**——返信ではなく印） |

**マージ済みを `list_pull_requests` では取れない。** `state: closed` は**マージされずに閉じたPRも
返し**、応答の `merged` は常に偽なので、マージ済みだけを取る手が無い。

**MCP の側は、`total_count` が返ったぶんより多ければ `page` を繰る。** 1ページで打ち切ると、そのぶんは
黙って落ちる。

## `gh` へ本文を渡すときはファイルで

`--body-file` を使う。本文はチェックボックスの一覧やコードブロックを含むので、シェルの引数に載せると
引用符で壊れる。

**原稿の置き場は `CLAUDE.md`「`/tmp` は2つある」に従う**——編集ツールの `/tmp` と bash の `/tmp` は別の
場所で、取り違えると**前の周が残した原稿がそのまま投稿される**（事例は同節）。**MCP の側は本文を
直接渡すので、この取り違えは起きない。**

#!/usr/bin/env bash
# 開いているPRと、指定した issue を見張り、動きがあった時点でその一覧を出して終了する。
#
# **見張るのは司令塔の仕事で、PRを出したセッションの仕事ではない。** 各セッションに見張らせると、
# 自分を起こすための `send_later` と、その取り消しの `delete_trigger` を使うことになる。この2つは
# 自動承認できないので、そのままユーザーのタップに化ける。司令塔はシェルで待てる。
#
#   bash scripts/agent/watch-prs.sh                    # 開いている全PR
#   bash scripts/agent/watch-prs.sh 731 733            # PRの番号を指定
#   bash scripts/agent/watch-prs.sh 0 --issues 732     # CIの決着を見たいPRが1本も無いとき
#   bash scripts/agent/watch-prs.sh --issues 732,759   # issue も見張る（下記）
#   bash scripts/agent/watch-prs.sh --interval 5 --timeout-minutes 60
#
# 出力は1行1件で、**終了コードで区別できる**。
#   GREEN   <番号> <ラベル>        … 全チェックが成功（ラベルが空なら素通しの候補）
#   RED     <番号> <落ちたチェック名>
#   CONFLICT <番号>                … mainと衝突していて、解消するまでマージできない
#                                    （`直し待ち` のPRを除く。差し戻し済みなので `FIXED` を待つ）
#   GONE    <番号>                 … 見張っていた issue が閉じた（--issues のときだけ）
#   REVIEWED <番号> <結論>         … レビューの結論が付いたまま、司令塔がまだ動いていないPR
#   UNREVIEWED <番号>              … 最後のコミット以降、レビューへ出していないPR
#   FIXED   <番号>                 … 直し待ちのPRへ、差し戻した後の新しいコミットが載った
#   COMMENT pr|issue <番号> <著者> … 起動より後に付いたコメント
#   CHECKED <番号> <項目>          … 確定待ち（`meta`）の本文でチェックが付いたまま、司令塔がまだ
#                                    下ろしていない項目
#   RELAY   <番号>                 … マージ済みPRの `## 司令塔へ` が、まだ下ろされていない
#                                    （`司令塔へ` ラベルが残っている）
#   TASK    <番号>                 … 着手できる open な task（投入も済んでおらず、--issues にもPRにも
#                                    無く、依存も片付いている）
#   STALLED <セッションID> <題>    … 動いておらず、PRも出していないタスクのセッション
#   終了コード 0 … 動きが1件以上ある（上の行が出ている）
#   終了コード 3 … TIMEOUT（制限時間まで、何も動かなかった）
#   終了コード 1 … ERROR（gh が続けて失敗した）
#
# **`GREEN` があるときは、行の後ろにそのPRの題・本文・ファイル一覧が `--- PR <番号> ---` に続いて
# 付く。** 緑を受け取った側は司令塔宛ての節と触ったファイルの一覧を必ず見るので、往復を1つ減らすために
# 同梱している。**判定は増えていない**——ここが担うのは促すことだけで、通すかどうかは受け取った側が
# レビューを手配して決める。
#
# ## 手番は、時刻の窓ではなく状態で見る
#
# **`REVIEWED`・`UNREVIEWED`・`FIXED`・`CHECKED`・`RELAY` が答えるのは「今それは誰の手番か」**で、
# 「この5分に何が起きたか」ではない。どれも、比べる相手を対象自身の状態から取る。
#
# - `REVIEWED` … 最後の `[レビュー]` コメントが、最後のコミットより新しい。＝結論が出たまま、
#   まだ直しも入っていない。`直し待ち`・`判断待ち` が付いていれば既に手が動いた後なので黙る。
# - `UNREVIEWED` … その `REVIEWED` の裏返し。最後のコミット以降、結論も付いておらず、`review-<番号>`
#   のセッションも立っていない。＝レビューへ出すのが司令塔の手番。
# - `FIXED` … 最後のコミットが、`直し待ち` を**付けた時刻**より新しい。＝差し戻した先から戻ってきた。
# - `CHECKED` … 確定待ちの本文に `[x]` の箇条書きとして残っている。＝答えが来たまま、司令塔が
#   まだ拾っていない。
# - `RELAY` … マージ済みPRに `司令塔へ` ラベルが残っている。＝回されたものを、司令塔がまだ
#   下ろしていない。
#
# **見張りの起動時刻と比べてはいけない。** 起動より前に起きたことは永久に出なくなるので、見張りを
# 立て直すたびに、その谷間で起きたことが丸ごと落ちる。2026-08-29 に PR #1183・#1182 の
# `[レビュー] 通してよい` が2時間放置され、同じ谷間で #1187・#1184 の直しも落ちた。
# `FIXED` の説明は前からこの節のとおりだったが、実装だけが起動時刻を代わりに使っていた。
#
# **合図が1件でもあれば `exit 0` する**（下）ので、増分にすると谷間はもっと広い——1周目で他の合図が
# 出た invocation は増分を一度も出さずに終わり、**次の起動がその間に付いたぶんを基準として飲み込む。**
# 忙しい局面ほど1周目で抜けるので、`CHECKED` は同じ形でユーザーの答えを13件飲み込んだ。
#
# **番号（`$1`〜・`--issues`）で絞らない。** 絞ると、司令塔が渡し忘れた番号は出なくなる——取りこぼしを
# 防ぐのがこの4つの役目なので、絞ると役目そのものが消える。手が動けば状態が変わって黙るので、
# 放っておいても毎周返り続けることはない。**番号が掛かるのは `GREEN`・`RED` の2つだけ。**
#
# **`CONFLICT` を番号で絞ってはいけない。** 番号で絞ってよいのは「今その結果を待っているか」で選べる
# ものだけで、コンフリクトは待っているかに関わらず前へ進めない。絞りに入れていたせいで、司令塔が
# `0` を渡す既定の使い方（下）では**どのPRのコンフリクトも一度も出なかった**——2026-08-30 に
# `判断待ち` の #1272・#1361 が、ユーザーが「入れてよい」と答えるまで衝突したまま埋もれた。
# ラベルで隠さないことは既に書いてあったが、その後段の絞りが同じことをしていた。
#
# **番号を1つも渡さないと「全部」の意味になる。** レビューへ出したPRは緑のまま置くので、渡さないと
# `GREEN` が毎周返って見張りがその場で終わる。CIの決着を見たいPRが1本も無いときは `0` を渡す。
#
# ## UNREVIEWED を見るのは、`0` を渡すと新しいPRがどこにも出ないから
#
# 上のとおり、レビュー中のPRを黙らせるために司令塔は `0` を渡す。すると `GREEN`・`RED`
# は全部の番号で外れるので、**新しく出たPRは、どの合図にも現れない**——`REVIEWED` は結論が要り、
# `FIXED` は `直し待ち` が要る。2026-08-29 に PR #1195・#1198 が誰にも拾われないまま残った。
#
# **黙る条件をPRの外から取る。** レビューを手配してもPRの状態は何も変わらないので、コメントが付く
# までの十数分、条件だけを見ていると毎周これが返って見張りがその場で終わる。`dispatch-review.sh` が
# 付ける `review-<番号>` のタグを見て、**最後のコミットより後に立った**セッションがあれば黙る。
# 「後に立った」で見るのは、直しが入った後に前回のレビューのセッションが残っていても、次の
# レビューを手配し直させるため（畳み忘れがそのまま見落としになるのを避ける）。
#
# セッション一覧が引けないとき（`--no-sessions`・`SESSIONS-OFF`）は、この合図だけ出せない。
# 判定に要る材料が無いので、黙るのではなく出さない側へ倒す——出し続けると見張りが機能しなくなる。
#
# ## COMMENT を見るのは、却下を受け取る唯一の経路だから
#
# **PRの作者はすべてユーザー自身になる**（セッションがユーザーの資格情報で push するため）ので、
# GitHubは Approve も Request changes も出させない。**仮決めを却下する手段はコメントしか無い。**
# 承認はマージがそのまま答えになるので、見張るのは却下の側だけでよい。
#
# レビューの結論は上の `REVIEWED` が状態として出すので、こちらは**それ以外のコメント**を拾う窓。
# 比べる相手が無い（「読んだ」がどこにも残らない）ので窓のままだが、**立て直すときは `--since` に
# 前回の起動時刻を渡す**と谷間が消える。
#
# `判断待ち` の付いたPRも**コメントだけは見る**。ラベルは「ユーザーの手元にある」という意味なので
# CIの決着は出さないが、そこへコメントが付いたということは手元から戻ってきたということ。
#
# **自分（司令塔）が書いたコメントでも起きる。** 著者で区別できない——セッションも司令塔もユーザーの
# 資格情報で書くため。著者と番号は出すので、受け取った側が見て、自分のものなら見張り直す。
#
# ## CHECKED を見るのは、答えがコメントではなく本文に付くから
#
# 確認の置き場（#656）は**タップ1つで答えられる形**にしてあるので、答えは本文のチェックボックスに
# 付き、コメントは1つも増えない。上の `COMMENT` だけを見ていると**タップは誰にも届かない**——
# ユーザーからは「タップしたのに何も起きない」、司令塔からは「何も来ていない」としか見えず、
# 区別が付かない。最小の入力を用意した意味が丸ごと消える。
#
# **判定は [`checked-items.sh`](checked-items.sh) が持つ**（`board.sh` の `## 確定待ち` と同じもの）。
# 見るのは `meta` の issue だけなので、**`--issues` の番号では絞らない**——絞ると「#656 を渡し忘れると
# 答えが1件も出ない」が残り、それはこの合図が塞いだ穴と同じ形になる（上の「番号で絞らない」）。
# `--issues` を1つも渡さないと issue の一覧そのものを引かないので、そのときだけは出ない。
#
# **黙るのは、その項目が確定待ちの一覧から下りたとき**（本文で `[x]` の箇条書きでなくなったとき）。
# 拾った司令塔は答えの行き先を書いてから一覧から消す（CLAUDE.md）ので、**`【確定】` の印は待たない。**
# 起き直すたびに同じ行が返るのは、答えがまだ拾われていないからで、正しい。
#
# ## RELAY を見るのは、マージした後にしか読む機会が無いから
#
# PR本文の `## 司令塔へ` には、**このPRの中では終わらないもの**が入る（立てた issue・順序・仕組みへの
# 直しの依頼。`parallel-work.md`「司令塔に手を動かしてほしいことは、`## 司令塔へ` の1節に集める」）。
# マージのときに司令塔が手で読む一発勝負しか無かったので、**PR #1240 は7件のうち1件が落ちた。**
#
# 印は [`merge-and-close.sh`](merge-and-close.sh) が `司令塔へ` ラベルとして置き、ここはそれを毎周
# 出すだけ。**黙るのは司令塔がラベルを外したとき**で、`CHECKED` と同じ形（下ろすまで黙らない）。
#
# **`--state merged` で引くのは、これがマージ後の合図だから。** 他の合図が見ている `--state open` の
# 一覧には、もう載っていない。ラベルで絞るので、引くのは常に数本。
#
# ## --issues を付けるのは、PRが出ないまま終わる場合があるから
#
# この見張りの本体はPRなので、投入した先が「閉じた issue だった」「セッションが落ちた」といった
# 理由でPRを作らないと、**何も届かないままタイムアウトまで空待ちになる**（2026-08-25 に実測。
# 却下されて閉じた issue へその16分後にセッションを立て、120分の空待ちに入りかけた）。投入した
# issue の番号を渡しておけば、それが閉じた時点で `GONE` が出る——マージで閉じたのか、始めから
# 閉じていたのかは、受け取った側が見る。
#
# **司令塔の現在地の issue（#732）も渡す。** ユーザーはPRではなくそちらへ書くことがあり、どちらに
# 書いても届くようにしておくのが、いちばん手数が少ない。
#
# **`GONE` はもう1つ、終わったセッションを畳む合図でもある。** 「その issue が閉じた」は畳む条件の
# 1つ目そのものなので、投入した issue を全部渡しておけば、掃除の遅れが見張りの間隔まで縮む
# （`parallel-work.md` の「畳む引き金は GONE」）。
#
# ## --issues は「こちらが把握している task の全部」
#
# 渡した番号に無い open な `task` は `TASK` として出る。**待ちを終える条件は「動いているものが終わる
# こと」ではなく「やることが無いこと」**だから——投入した全部が `判断待ち` で止まると、前者では
# 何も起こらなくなり、その間にセッションが立てた issue も誰の目にも触れない。
#
# **投入したものは渡さなくてよい**——`task-<番号>` のタグを見れば機械が知れる（下）。渡すのは、
# **投入していないが意図して置いてある `task`**（判断待ちのPRの後ろに並べているものなど）だけ。
# **出すか出さないかは機械が決め、拾うかどうかは受け取った側が決める。**
#
# ## 着手できるかは、印ではなく issue の依存から出す
#
# `TASK` に出るのは**`task` ラベルの付いた issue のうち、依存が片付いていて、投入もされておらず、
# open なPRが `Closes` で指していないものだけ**（GitHub の `blockedBy` に open なものが無い）。
# `task` が1件のセッションの仕事の単位なので、確認の置き場やユーザーの答え待ちのように**投入する先が
# 無い issue** は、依存が空でも仕事ではない。PRの出ている issue は、既にそのセッションの手元にある。
#
# **投入済みかどうかは、PRではなくセッションから見る**（`UNREVIEWED` が `review-<番号>` を見るのと
# 同じ形）。`dispatch-task.sh` が付ける `task-<番号>` のタグを持つセッションが生きていれば黙る。
# 投入してからPRが出るまでは十数分あり、その間PRの側には何も現れないので、ここを見ないと**投入済みの
# 番号が毎周返って見張りがその場で終わる**（2026-08-30 に #1271 で実測）。畳んだセッションは数えない
# ので、PRを出さないまま畳まれた issue は次の周からまた出る。止まったまま畳まれていないセッションは
# `STALLED` の側が出す。
#
# **セッション一覧が引けないとき（`--no-sessions`・`SESSIONS-OFF`）は、投入済みでも出す。** `UNREVIEWED`
# とは逆に倒す——あちらは出さないと何も起きないだけだが、`TASK` を止めると「やることが無い」が
# 二度と出せなくなり、待ちが終わらない。そのときは `--issues` へ渡して黙らせる（上）。
# 「今着手してよいか」は実装の進み具合で**真偽が変わる述語**なので、ラベルのような印で持たせると
# 必ず古くなり、貼り直す仕事が永久に残る。「A は B の後」は変わらない事実なので、一度書けば
# 正しいままで、着手できるかは毎周そこから計算すればよい。`task` は**それが作業単位かどうか**
# という変わらない事実なので、印で持ってよい。
#
# 依存は `gh issue list --json blockedBy` が**一覧と同時に返す**ので、呼び出しは1周1回のままで、
# `state` も同梱されるため open 一覧との突き合わせも要らない。
#
# **依存で止まったまま何も出なくなることはない。** GitHub は循環する依存を 422 で拒む（実測）ので、
# 開いている issue の依存は必ず有向非巡回になる。**非巡回な有限のグラフには必ず根がある**ので、
# open な `task` が1件でもあれば、そのうち1件は必ず ready になる。TASK が空になるのは、open な
# `task` が全部 `--issues` に入っているときだけ。
#
# 依存に書いてよいのは**順序に理由がある依存だけ**。「同じファイルを触る」は依存ではない
# （`parallel-work.md` の「1ファイル重なることは、直列にする理由にはしない」）。
#
# ## STALLED を見るのは、止まったセッションが誰にも見えないから
#
# **セッションは利用制限・権限の確認待ち・失敗で、PRを出さないまま止まる。** 止まっても
# GitHub 上には何も現れないので、`STALLED` より上のどれも出ない。ここを見ていないと、司令塔は
# 「まだ書いているのだろう」と読んだままタイムアウトまで待つ（2026-08-28 に実際に起きた。
# 司令塔だけはユーザーが1行送って起こしていたので進み、子セッションは止まったままだった）。
#
# **判定は「PRを出したか」だけで見る。** セッションの状態だけでは、書き終えて報告した IDLE と、
# 途中で落ちた IDLE が区別できない。「動いていない × open なPRが無い」が、そのまま
# 「まだ仕事が残っている」になる。枝の名前では引けない——ブリッジのセッションの `current_branches` は
# worktree のローカル枝で、push する枝とは別物。
#
# **PRとセッションは2通りで結ぶ。片方だけでは足りない。**
#
# - PR本文の脚注 `https://claude.ai/code/session_...`。Claude Code が自動で付ける。
# - PR本文の `Closes #<番号>` と、セッションの `task-<番号>` タグ（`dispatch-task.sh` が付ける）。
#
# 脚注だけで見ていたとき、**本文を書き直したPRで脚注ごと落ちた**（2026-08-29 の #1177・#1178）。
# どちらもPRは出ているのに毎周 `STALLED` が出て、見張りがその場で終わっていた。脚注は本文の一部
# なので書き手が消せるが、`Closes` は消せない——消すと issue が閉じない。
#
# マージ済みで畳み忘れたセッションもここに出る。**どちらも司令塔が手を入れるべき状態**なので、
# 種類を分けない（起こすのか畳むのかは、受け取った側が `list_events` を見て決める）。
#
# **既定で見る。`--no-sessions` で切る。** 引くのに `.claude/ccr-meta.sh`（＝Claude Code の資格情報）が
# 要るので、使えない環境では最初の1回で諦めて**標準エラーへ `SESSIONS-OFF` を出し**、以降はPRと
# issue だけを見る。黙って落とすと「止まったセッションは無い」と読めてしまう。
#
# 引く間隔はPRより粗い（`--session-interval` 秒、既定60）。`ccr-meta.sh` は1回ごとに curl と node を
# 起こすので、5秒ごとに叩く相手ではない。止まったセッションは1分待っても止まったまま。

set -uo pipefail

INTERVAL=5
TIMEOUT_MINUTES=60
FAILURE_LIMIT=20
NUMBERS=()
ISSUES=()
NO_CHECK_GRACE=90
SESSIONS=1
SESSION_INTERVAL=60
# 立てた直後のセッションは、最初のターンが始まるまでの数秒だけ「動いていない」に見える。
SESSION_GRACE=180
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --timeout-minutes)
      TIMEOUT_MINUTES="$2"
      shift 2
      ;;
    --issues)
      IFS=', ' read -r -a ISSUES <<<"$2"
      shift 2
      ;;
    --since)
      SINCE="$2"
      shift 2
      ;;
    --no-check-grace)
      NO_CHECK_GRACE="$2"
      shift 2
      ;;
    --no-sessions)
      SESSIONS=0
      shift
      ;;
    --session-interval)
      SESSION_INTERVAL="$2"
      shift 2
      ;;
    *)
      NUMBERS+=("$1")
      shift
      ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。差し替えられないと、
# 試験がユーザーの実際のセッション一覧を引き、そのとき待機中のものが `STALLED` として混ざる。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 動いておらず、自分のIDを載せた open なPRも無い `task` のセッションを出す。**判定は「PRを出したか」
# だけ**（上の STALLED の節）。第1引数は「これより古い更新なら見る」境目。
STALLED_FILTER='
  .ccr.data[]
  | select([.tags[]? | select(startswith("task"))] | length > 0)
  | select(.session_status != "SESSION_STATUS_ARCHIVED")
  | select(.status_bucket != "SESSION_STATUS_BUCKET_WORKING")
  | select(.updated_at < $grace)
  | "\(.id)\t\([.tags[]? | select(startswith("task-")) | ltrimstr("task-")] | join(" "))\t\(.title // "")"
'

deadline=$(($(date +%s) + TIMEOUT_MINUTES * 60))
session_next=0
sessions=''
failures=0

# 1周につき gh を1回だけ呼ぶ。見張る本数が増えても呼び出し回数は増えない。
# チェックが1つでも走っていれば、そのPRはまだ決着していない。
#
# **決着していても出さないPRが2種類ある。** どちらも「既に誰かの手元にある」もので、出すと起こされた
# 側が同じ行を受け取り続けて回り続ける。コンフリクトとコメント（下）は別で、ラベルに関わらず見る。
#
# - `判断待ち` … ユーザーの手元。仮決めを含むので司令塔は触らない。
# - `直し待ち` … 書いたセッションの手元。司令塔が `send_message` で差し戻した状態。**緑のまま
#   放置すると毎周報告される**ので、差し戻したら必ず付ける（2026-08-25 に PR #771 で実際に空振りした）。
#
# **`直し待ち` は、新しいコミットが載った時点で `FIXED` を出す。** 黙らせたまま放っておくと、直しが
# 上がったことに誰も気づけない——2026-08-25 に PR #781 で実際にそうなり、直しが1時間半見過ごされた。
# ラベルを付けた時刻より後のコミットがあれば、それが「戻ってきた」の合図になる。
#
# **チェックが1つも登録されないPRは、放っておくと永久に報告されない。** CI（`tests.yml`）の `paths` は
# `src/` `tests/` `scripts/` などで、`docs/` や `.claude/` しか触らないPRでは1つも走らないため。
# 実測（2026-08-25）で、PR #766 が誰にも拾われないまま残った。落ち着くのを待ってから GREEN として
# 出す（`--no-check-grace` 秒、既定90）。まだ登録中なだけの場合と区別が付かないので、猶予を置く。
#
# **コンフリクトは `判断待ち` より先に見る。** コンフリクトが表すのは「誰の手元にあろうと、解消する
# まで進めないこと」で、ラベルが表す「今それが誰の手元にあるか」とは直交する。ユーザーの手元だからと
# 隠すと、`判断待ち` のPRは何も出ないまま埋もれ、ユーザーが「入れて」と答えてもその場では入らない
# （2026-08-27 に PR #865 で実際にそうなった）。ラベルの無いPRは逆に、緑として出て素通しのマージに
# 失敗する。チェックの結果とも独立なので、CIより先に見る。
#
# **`直し待ち` だけは、コンフリクトしていても黙る。** 差し戻しの中身が解消の依頼そのものなので、
# 司令塔が次に知りたいのは解消されたか＝`FIXED` のほう。ここで `CONFLICT` を出すと、解消されるまで
# 毎周それが返り、司令塔は同じ差し戻しを繰り返す（2026-08-28 に PR #963 で実際にそうなった）。
#
# **計算中（`mergeable: UNKNOWN`）は決着として扱わない。** GitHub はマージ可否を訊かれてから計算する
# ので、初回は `UNKNOWN` が返る（#865 で実測。引き直すと `CONFLICTING` に確定した）。問題なしと
# 読むと、コンフリクトしたPRが緑として出る。次の周で引き直せば済む。
pr_settled_filter() {
  # 第1引数はチェック無しPRの猶予の境目。
  printf '
    .[]
    | . as $pr
    | ([$pr.labels[].name]) as $names
    | if ($names | index("直し待ち")) != null then "MENDING \($pr.number)"
      elif $pr.mergeable == "CONFLICTING" then "CONFLICT \($pr.number)"
      elif $pr.mergeable == "UNKNOWN" then empty
      elif ($names | index("判断待ち")) != null then empty
      else
        ([$pr.statusCheckRollup[] | select(.status != "COMPLETED")] | length) as $running
        | if ($pr.statusCheckRollup | length) == 0
          then (if $pr.updatedAt < "%s" then "GREEN \($pr.number) \($names | join(","))" else empty end)
          elif $running > 0 then empty
          else
            ([$pr.statusCheckRollup[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .name]) as $failed
            | if ($failed | length) == 0
              then "GREEN \($pr.number) \($names | join(","))"
              else "RED \($pr.number) \($failed | join(","))"
              end
          end
      end
  ' "$1"
}

# レビューの結論が付いたまま、司令塔がまだ動いていないPR（上の「手番は、時刻の窓ではなく状態で
# 見る」）。結論の行は `[レビュー] 通してよい` か `[レビュー] 直しが要る`（`review-prompt.md`）。
# 出すのは `<番号>\t<コメントの時刻>\t<結論>` で、コミットとの比較は呼び出し側で行う。
REVIEWED_FILTER='
  .[]
  | . as $pr
  | select([$pr.labels[].name] | index("直し待ち") == null and index("判断待ち") == null)
  | ([$pr.comments[] | select(.body | startswith("[レビュー]"))] | last) as $review
  | select($review != null)
  | "\($pr.number)\t\($review.createdAt)\t\($review.body | split("\n")[0] | rtrimstr("\r") | ltrimstr("[レビュー]") | sub("^[[:space:]]+"; ""))"
'

# `REVIEWED` と同じ候補（`直し待ち`・`判断待ち` の付いていないPR）を、結論が付いていないものも含めて
# 出す。添えるのは最後の `[レビュー]` コメントの時刻で、1つも無ければ空。コミットとセッションとの
# 比較は呼び出し側で行う。
REVIEW_CANDIDATE_FILTER='
  .[]
  | . as $pr
  | select([$pr.labels[].name] | index("直し待ち") == null and index("判断待ち") == null)
  | ([$pr.comments[] | select(.body | startswith("[レビュー]"))] | last) as $review
  | "\($pr.number)\t\($review.createdAt // "")"
'

# 投入済みの task。`task-<番号>` は `dispatch-task.sh` が付ける。畳んだセッションは数えない。
DISPATCHED_FILTER='
  .ccr.data[]
  | select(.session_status != "SESSION_STATUS_ARCHIVED")
  | .tags[]?
  | select(startswith("task-"))
  | ltrimstr("task-")
'

# 手配済みのレビュー。`review-<番号>` は `dispatch-review.sh` が付ける。畳んだセッションは数えない。
REVIEWING_FILTER='
  .ccr.data[]
  | select(.session_status != "SESSION_STATUS_ARCHIVED")
  | .created_at as $at
  | .tags[]?
  | select(startswith("review-"))
  | "\(ltrimstr("review-"))\t\($at)"
'

# gh の --jq には --arg を渡せないので、時刻は文字列として埋め込む。
comment_filter() {
  printf '
    .[]
    | . as $item
    | $item.comments[]
    | select(.createdAt > "%s")
    | "COMMENT %s \($item.number) \(.author.login)"
  ' "$SINCE" "$1"
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  if prs=$(gh pr list --state open --limit 50 \
    --json number,labels,statusCheckRollup,comments,updatedAt,mergeable,body 2>/dev/null); then
    failures=0
    grace=$(date -u -d "-${NO_CHECK_GRACE} seconds" +%Y-%m-%dT%H:%M:%SZ)
    settled=$(jq -r "$(pr_settled_filter "$grace")" <<<"$prs")
    # 差し戻し中のPRは**絞る前に**控える。`FIXED` は手番なので、番号を渡し忘れても出す。
    mending=$(grep '^MENDING ' <<<"$settled" | awk '{print $2}')
    # コンフリクトも**絞る前に**控える。番号で絞ってよいのは「今その結果を待っているか」で選べるもの
    # だけで、コンフリクトは待っているかに関わらず前へ進めない（上の「コンフリクトは `判断待ち` より
    # 先に見る」と同じ理由）。
    conflicts=$(grep '^CONFLICT ' <<<"$settled")
    if [ ${#NUMBERS[@]} -gt 0 ]; then
      pattern=$(printf '%s\n' "${NUMBERS[@]}" | paste -sd'|' -)
      settled=$(grep -E "^(GREEN|RED) (${pattern})( |$)" <<<"$settled")
      settled=$(printf '%s\n%s' "$settled" "$conflicts")
    fi
    settled=$(grep -v '^MENDING ' <<<"$settled")
    # 差し戻し中とレビュー済みのPRだけ、コミットの日付を追加で引く。**一覧の `--json` へ `commits`
    # を足してはいけない**——50本ぶんだとGraphQLのノード上限（50万）を超えて `gh` が丸ごと失敗し、
    # **見張り全体が黙る**（2026-08-25 に実測）。1本ずつ引けば、払うのはそのPRがあるときだけで済む。
    while read -r number; do
      [ -n "$number" ] || continue
      pushed=$(gh pr view "$number" --json commits --jq '.commits | last | .committedDate' 2>/dev/null | tr -d '\r')
      # 差し戻した時刻＝`直し待ち` を付けた時刻。ラベルの履歴はPRに残るので、見張りを立て直しても
      # 変わらない。取れなかったときだけ起動時刻へ落ちる。
      sent_back=$(gh api "repos/{owner}/{repo}/issues/$number/timeline" --paginate \
        --jq '.[] | select(.event == "labeled" and .label.name == "直し待ち") | .created_at' 2>/dev/null |
        tr -d '\r' | sort | tail -1)
      [ -n "$sent_back" ] || sent_back="$SINCE"
      if [ -n "$pushed" ] && [[ "$pushed" > "$sent_back" ]]; then
        settled=$(printf '%s\nFIXED %s' "$settled" "$number")
      fi
    done <<<"$mending"

    # レビューの結論。**番号で絞った後に足す**——絞ると、渡し忘れた番号の結論が出なくなる。
    while IFS=$'\t' read -r number at verdict; do
      [ -n "$number" ] || continue
      pushed=$(gh pr view "$number" --json commits --jq '.commits | last | .committedDate' 2>/dev/null | tr -d '\r')
      # 結論より後にコミットが載っているなら、直しは既に入っている（司令塔の手番ではない）。
      [ -n "$pushed" ] && [[ "$pushed" > "$at" ]] && continue
      settled=$(printf '%s\nREVIEWED %s %s' "$settled" "$number" "$verdict")
    done < <(jq -r "$REVIEWED_FILTER" <<<"$prs" | tr -d '\r')

    settled=$(printf '%s\n%s' "$settled" "$(jq -r "$(comment_filter pr)" <<<"$prs")")

    # 回されたまま下ろされていないもの（上の `RELAY` の節）。**マージ済みを別に引く**——上の一覧は
    # `--state open` なので、マージした瞬間に消える。ラベルで絞るので数本しか返らない。
    # 引けなかった周は黙る（次の周でまた出る。ラベルは残っている）。
    if relayed=$(gh pr list --state merged --label 司令塔へ --limit 30 --json number 2>/dev/null); then
      settled=$(printf '%s\n%s' "$settled" "$(jq -r '.[] | "RELAY \(.number)"' <<<"$relayed" | tr -d '\r')")
    fi

    # セッションの一覧。**issue より先に引く**——下の `TASK` が、投入済みかどうかをここから見る。
    # 引く間隔はPRより粗いので、間の周は前回のものを使う（投入済みのタグも止まったセッションも、
    # 1分では変わらない）。`STALLED`・`UNREVIEWED` は、引き直した周にだけ見る（下）。
    fetched_sessions=0
    if [ "$SESSIONS" -eq 1 ] && [ "$(date +%s)" -ge "$session_next" ]; then
      session_next=$(($(date +%s) + SESSION_INTERVAL))
      # 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
      if sessions=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":30}' 2>/dev/null |
        grep -o '{"ccr".*'); then
        fetched_sessions=1
      else
        echo "SESSIONS-OFF セッションの状態を引けないので、以降はPRとissueだけを見る" >&2
        SESSIONS=0
        sessions=''
      fi
    fi

    # 見張っている issue を1回引いて、閉じたもの（開いている一覧に居ないもの）と、起動より後に
    # 付いたコメントを拾う。issue の本数が増えても gh の呼び出しは1周につき1回のまま。
    if [ ${#ISSUES[@]} -gt 0 ]; then
      # jq は Windows では改行を CRLF で書く（msys の text mode）。番号どうしの突き合わせに使う
      # 一覧は、ここで `\r` を落としておかないと、どれも一致しなくなる。
      if open_issues=$(gh issue list --state open --limit 100 --json number,labels,comments,blockedBy,body 2>/dev/null); then
        numbers=$(jq -r '.[].number' <<<"$open_issues" | tr -d '\r')
        for issue in "${ISSUES[@]}"; do
          if ! grep -qx "$issue" <<<"$numbers"; then
            settled=$(printf '%s\nGONE %s' "$settled" "$issue")
          fi
        done
        watched=$(printf '%s\n' "${ISSUES[@]}" | paste -sd'|' -)
        settled=$(printf '%s\n%s' "$settled" \
          "$(jq -r "$(comment_filter issue)" <<<"$open_issues" | grep -E "^COMMENT issue (${watched}) " || true)")
        # 本文のチェック。**`body` は issue 1件につき1つの文字列**なので、上で引いた一覧から
        # そのまま出せる。呼び出しは1周1回のまま。**`watched` で絞らない**（上の CHECKED の節）。
        checked=$(bash "$HERE/checked-items.sh" <<<"$open_issues")
        if [ -n "$checked" ]; then
          settled=$(printf '%s\n%s' "$settled" "$(sed -E 's/^/CHECKED /' <<<"$checked")")
        fi
        # 渡された番号に無く、依存も片付いていて、投入もされておらず、PRも出ていない `task` は、
        # 今すぐ着手できる仕事。**待ちを終える条件は「動いているものが終わること」ではなく「やることが
        # 無いこと」**なので、これを出す。出さない4つは、どれも**その issue が今どこにあるか**を
        # 別の角度から見たもの。
        #
        # - `task` の無い issue（確認の置き場・答え待ち）… 投入する先が無いので、そもそも仕事ではない。
        # - open な `blockedBy` が残っている … 投入しても着手できず、受け取った側が毎周突き返す。
        # - `task-<番号>` のセッションが生きている … 投入済み。PRが出るまでの十数分、PRの側には
        #   何も現れない（上の「着手できるかは」）。
        # - open なPRが `Closes` で指している … 既に誰かが持っている。二重に投入すると、2つの
        #   セッションが同じ担当ファイルを触って衝突する（2026-08-27 に #885 と PR #890 で実際に出た）。
        claimed=$(jq -r '.[].body // "" | [scan("(?i)\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#([0-9]+)")] | .[][]' \
          <<<"$prs" | tr -d '\r')
        dispatched=''
        [ -n "$sessions" ] && dispatched=$(jq -r "$DISPATCHED_FILTER" <<<"$sessions" | tr -d '\r')
        ready=$(jq -r '.[]
            | select([.labels[].name] | index("task"))
            | select([.blockedBy.nodes[] | select(.state == "OPEN")] | length == 0)
            | .number' \
          <<<"$open_issues" | tr -d '\r')
        for issue in $ready; do
          if ! grep -qxE "$watched" <<<"$issue" && ! grep -qx "$issue" <<<"$claimed" &&
            ! grep -qx "$issue" <<<"$dispatched"; then
            settled=$(printf '%s\nTASK %s' "$settled" "$issue")
          fi
        done
      fi
    fi

    # 引き直した周にだけ見る。前回のものを使い回すと、`UNREVIEWED` が候補ごとに `gh pr view` を
    # 呼ぶぶんだけ、同じ答えのために毎周払うことになる。
    if [ "$fetched_sessions" -eq 1 ]; then
      session_grace=$(date -u -d "-${SESSION_GRACE} seconds" +%Y-%m-%dT%H:%M:%SZ)
      # PR本文の脚注 `https://claude.ai/code/session_...` と、`Closes #<番号>` が指す issue。
      bodies=$(jq -r '.[].body // ""' <<<"$prs")
      with_pr=$(grep -o 'session_[A-Za-z0-9]*' <<<"$bodies" | sort -u)
      closed_issues=$(grep -oiE 'closes #[0-9]+' <<<"$bodies" | grep -o '[0-9]*' | sort -u)
      while IFS=$'\t' read -r id issues title; do
        [ -n "$id" ] || continue
        grep -qx "$id" <<<"$with_pr" && continue
        claimed=0
        for issue in $issues; do
          grep -qx "$issue" <<<"$closed_issues" && claimed=1 && break
        done
        [ "$claimed" -eq 1 ] && continue
        settled=$(printf '%s\nSTALLED %s %s' "$settled" "$id" "$title")
      done < <(jq -r --arg grace "$session_grace" "$STALLED_FILTER" <<<"$sessions" | tr -d '\r')

      # まだレビューへ出していないPR（上の「UNREVIEWED を見るのは」）。セッション一覧が要るので、
      # ここで一緒に見る。引く間隔がPRより粗いぶん出るのは遅れるが、手配の遅れは分の単位でよい。
      reviewing=$(jq -r "$REVIEWING_FILTER" <<<"$sessions" | tr -d '\r')
      while IFS=$'\t' read -r number at; do
        [ -n "$number" ] || continue
        pushed=$(gh pr view "$number" --json commits --jq '.commits | last | .committedDate' 2>/dev/null | tr -d '\r')
        # 結論が最後のコミットより新しければ、それは `REVIEWED` の手番。
        if [ -n "$at" ] && { [ -z "$pushed" ] || [[ "$at" > "$pushed" ]]; }; then continue; fi
        started=$(awk -F'\t' -v n="$number" '$1 == n { print $2 }' <<<"$reviewing" | sort | tail -1)
        # 最後のコミットより後にレビューのセッションが立っていれば、手配は済んでいる。
        if [ -n "$started" ] && { [ -z "$pushed" ] || [[ "$started" > "$pushed" ]]; }; then continue; fi
        settled=$(printf '%s\nUNREVIEWED %s' "$settled" "$number")
      done < <(jq -r "$REVIEW_CANDIDATE_FILTER" <<<"$prs" | tr -d '\r')
    fi

    if [ -n "${settled//[[:space:]]/}" ]; then
      settled=$(grep -v '^[[:space:]]*$' <<<"$settled")
      printf '%s\n' "$settled"
      # 緑のPRは、この後かならず本文とファイル一覧を引くことになる。ここで出しておけば、起こされた
      # 側は司令塔宛ての節とファイルの一覧を見るところから始められる。
      while read -r number; do
        [ -n "$number" ] || continue
        printf -- '--- PR %s ---\n' "$number"
        gh pr view "$number" --json title,body,files \
          --jq '.title, "", .body, "", "--- ファイル ---", (.files[] | "\(.additions)+ \(.deletions)- \(.path)")' ||
          echo "（本文を引けなかった。gh pr view $number で引き直す）"
      done < <(grep '^GREEN ' <<<"$settled" | awk '{print $2}')
      exit 0
    fi
  else
    failures=$((failures + 1))
    if [ "$failures" -ge "$FAILURE_LIMIT" ]; then
      echo "ERROR gh pr list が ${FAILURE_LIMIT} 回続けて失敗した（認証切れか通信断）"
      exit 1
    fi
  fi
  sleep "$INTERVAL"
done

echo "TIMEOUT"
exit 3

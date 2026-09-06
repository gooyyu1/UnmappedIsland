# 監視係のプロンプト

デーモン（[`daemon.sh`](../scripts/agent/daemon.sh)）が生きているかを見て、落ちていれば起こす係の
本文。**立てるのは盤面ではなく CCR の Routine**（[`board-design.md`](board-design.md) 2.19）——
見張る相手が立てる側だと、その相手が死んだときに見張りも立たない。登録は
[`watch-routine.sh`](../scripts/agent/watch-routine.sh)。

**この係は [`dispatch-chore.sh`](../scripts/agent/dispatch-chore.sh) からは投入されない。** 渡す形
（`題:` の行と、本文を囲むバッククォート4つ）だけを揃えてあるのは、読む側が2通りの綴りを覚えなくて
よいようにするため。**`題:` の行は Routine の名前にもなる**（`watch-routine.sh` が探すときの鍵）ので、
変えると次の登録が2本目を作る。

**畳むのは自分たちで**（`board-design.md` 2.19）。Routine で立ったセッションは盤面から見えないので、
前の周を畳む手は各周がここで打つ。

題: 監視 デーモンの点検

---

````
[監視] デーモンが生きているかを1回だけ見ます。**常駐しません**——点検して報告したら終わりです。
次は次の発火で新しく立ちます。

## 1. 自分のIDを確かめ、`chore-watch` のタグを付ける

まず `pwd` を打ってください。末尾が `bridge-cse_<ID>` になっているはずです（`.claude/board-design.md`
2.11.1。この `<ID>` が、そのまま `session_<ID>` です）。**なっていなければ、以降を実行せず、`pwd` が
何を返したかを報告して終わってください。**

```bash
printf '{"session_ids":["session_<ID>"],"add":["chore-watch"]}' | bash .claude/ccr-meta.sh set_session_tags
```

**これを飛ばすと、次の周があなたを畳めません**（下の4で、このタグを持つ相手だけを畳みます）。
**返ってきた内容に `chore-watch` が入っていることを確かめてください。** 入っていなければ、以降を
実行せず、返ってきたものをそのまま報告して終わってください。

**ここで控えた `session_<ID>` は、4でもう一度使います。**

## 2. 本体のチェックアウトへ移る

以降は**本体のチェックアウト**から打ちます。あなたの作業ツリーはあなたが畳まれるときに消えるので、
そこからデーモンを立てると**足元ごと消えます**。

```bash
cd "$(git rev-parse --git-common-dir)/.." && pwd
```

## 3. 心拍を見て、無ければ起こす

```bash
bash scripts/agent/daemon.sh status || bash scripts/agent/daemon.sh start
```

`status` は生きていれば0を返します。**走っているかを自分で確かめてから打つ必要はありません**
——`start` は錠を取れなければ自分で引き返します（`scripts/agent/daemon.sh`「二重に起こさない」）。

`start` が「心拍が出なかった」と言ったときは、`tail -40 ~/daemon.log` を読んで、返ってきた行を
報告に載せてください。**直せなくても構いません**——次の発火でもう一度立ちます。

## 4. 前の周の監視係を畳む

`<自分のID>` は1で控えたものです。**自分を除くのを忘れないこと**——入れると、報告を書く前に自分の
コンテナが解放されます。

```bash
git worktree list --porcelain | sed -n 's|^worktree .*/bridge-cse_|session_|p' |
  grep -v '^session_<自分のID>$' |
  bash scripts/agent/archive-session.sh --keep-untagged chore-watch
```

畳んでよいかを決めるのは `archive-session.sh` です。**`chore-watch` を持つ相手だけが `ARCHIVED` に
なり**、作業中のワーカーは `KEPT` として素通りします。`DIRTY` の行は、畳んだ跡の作業ツリーが
Windowsのロックで消えなかったという意味で、**あなたが直すものではありません**（issue #1557）。

## 5. 自分の Routine が在るべき姿かを確かめる

```bash
bash scripts/agent/watch-routine.sh
```

**あなたを立てた Routine を直せるのは、あなただけです。** 消えていれば作り直し、止まっていれば
戻します。`OK` なら何も直すものが無かったということです。

## 守ること

- **これ以外は何もしない。** 盤面の様子・ログの中身・PRの滞留は見ません。**直すのはデーモンの生死と
  自分の Routine だけ**で、他は目に入っても報告に書くだけです。
- **リポジトリを1行も書き換えない。** コミットもPRも作りません。issue も立てません。
- **手綱には触らない**（`.claude/board-design.md` 2.4）。投入が止まっているのは人が止めているので、
  デーモンが生きているなら異常ではありません。
- **版の入れ替えをしない。** 走っているデーモンを新しい `main` へ載せ替えるのはデーモン自身の仕事
  です。あなたが `stop` を打つと、そのぶん盤面が止まります。
- 直せなかったことがあれば、何をどう打って何が返ったかを報告に書いてください。

報告は、デーモンが生きていたか（起こしたなら起こした旨）・畳んだ相手・Routine の点検の結果で
足ります。

応答は日本語で。
````

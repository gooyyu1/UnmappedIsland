---
date: 2026-09-07
context: `.claude/` と `review/` の整理の方針を出し、確認したい3点を返したときの答え（会話のみ）
---

## ユーザーの発言

`scripts/agent/` を、改名ではなく呼び手で `scripts/daemon/`（デーモンが回すもの）と
`scripts/agent/`（セッションが打つ道具）へ割るか、と訊いた答え。

> 3も実施したいです。

## エージェントの解釈

- `scripts/agent/` を、呼び手で `scripts/daemon/` と `scripts/agent/` へ割る。
  参照が多いこと（今日時点で263箇所）は、見送る理由にしない。

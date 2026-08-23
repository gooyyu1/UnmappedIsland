#!/bin/bash
# UserPromptSubmit hook: 発言に含まれる判断を、作業へ着手する前に記録させる。
#
# 記録が漏れるのは意志ではなく契機の問題なので、機械で毎回促す。着手後や応答の最後では、
# コンパクションで判断の文脈が失われた後になる。
#
# 「方針を含む発言か」の判定は機械では当たらない（キーワード照合は取りこぼしと誤検知が同時に出て、
# どちらも見えない）。機械は促すことだけを担い、判定と記録はモデルが行う。
set -euo pipefail

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "記録の確認: 直前の発言に、方針・価値観・訂正・選択の判断が含まれていないか。含まれていたら、作業へ着手する前に記録する（進め方・設計・レビューの判断は .claude/policies.md、ゲーム内容の判断基準は docs/concept/DesignPrinciples.md、確定した個別の仕様は該当する仕様書）。既存の記録と矛盾するなら追記せず書き換える（最新が正）。判断を含まない作業依頼なら何もしない。"
  }
}
JSON

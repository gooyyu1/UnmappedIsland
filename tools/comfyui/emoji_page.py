"""絵文字を1つ、白い紙の中央へ大きく描く。Qwenで描き直すための下絵。

    python emoji_page.py --emoji 💧 --out drop.png --page 1024 --size 560

**バーのアイコンは生成では作れない。** 設定・図鑑・料理・水といった役割は、絵として描かせると
毎回ちがう物が出てきて、押す前に何のボタンか読めない。絵文字は形が定まっていて小さくても読める
ので、**形と配置は絵文字から借り、質感だけをQwenで描き直す**（recipes/icon_*.json）。

紙は白で、四辺に広い余白を残す。card_art.py が紙・物・影を分けて切り出すため（--mode background）と、
Qwenに「白い紙の上の物」として扱わせるため。

絵文字のフォントは Windows 同梱の Segoe UI Emoji（icon_mark.render_emoji）。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from icon_mark import render_emoji


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--emoji", required=True, help="描く絵文字1文字")
    parser.add_argument("--page", type=int, default=1024, help="紙の一辺（px）")
    parser.add_argument("--size", type=int, required=True, help="絵文字の長辺（px）。紙より小さくする")
    args = parser.parse_args()

    if args.size >= args.page:
        raise SystemExit(f"絵文字({args.size})が紙({args.page})に収まらない。余白が残る大きさにしてください")

    glyph = render_emoji(args.emoji)
    scale = args.size / max(glyph.width, glyph.height)
    resized = glyph.resize((max(round(glyph.width * scale), 1), max(round(glyph.height * scale), 1)),
                           Image.LANCZOS)

    page = Image.new("RGB", (args.page, args.page), (255, 255, 255))
    page.paste(resized, ((args.page - resized.width) // 2, (args.page - resized.height) // 2), resized)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    page.save(out)
    print(f"{out}  {page.width}x{page.height}  絵文字 {resized.width}x{resized.height}")


if __name__ == "__main__":
    main()

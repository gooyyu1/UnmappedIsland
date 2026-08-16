"""切り出したPNGを赤い地へ重ねて並べる。透過の失敗を目で確かめるため。

    python alpha_check.py --out check.png ../../src/assets/objects/raft.png ...

**カードの紙の上で見ても、透過の失敗は分からない。** 生成物の紙もカードの紙も明るいので、
埋め残した穴・埋めすぎた穴・切り落とされた縁は、どれも「そういう絵」にしか見えない。赤い地に
重ねると、紙のままの画素だけが赤くなり、白い塊として残った画素だけが白く残る。

見るのは3つ。

- **不透明な白い塊**: 物に囲まれた紙を埋めてしまった場所（card_art.py の --keep-holes）。
  帆柱と支索が三角形に紙を囲む筏で実際に出た。
- **物の内側の赤**: 芯に入らなかった明るい面。--tolerance を下げるか、--mode flood を使う。
- **縁の欠け**: 細く分岐する輪郭が費用の綱引きで削られる（flood の弱点）。

葉の隙間のような**淡い抜け残りは既存の絵にもある**（palm_tree・banana_plant）。単独で見て
判断せず、同じ抜き方の既存の絵を並べて、そこから外れているかで決める。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

RED = (220, 0, 0)
GAP = 10
LABEL = 16


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="PNGの保存先ファイル")
    parser.add_argument("--colour", default="220,0,0", help="地の色。既定は赤")
    parser.add_argument("art", nargs="+", help="切り出し済みのPNG。既存の絵も一緒に並べる")
    args = parser.parse_args()

    ground = tuple(int(part) for part in args.colour.split(","))
    cells = []
    for path in (Path(p) for p in args.art):
        art = Image.open(path).convert("RGBA")
        cell = Image.new("RGB", art.size, ground)
        cell.paste(art, (0, 0), art)
        cells.append((path.stem, cell))

    sheet = Image.new(
        "RGB",
        (
            sum(cell.width for _, cell in cells) + GAP * (len(cells) + 1),
            max(cell.height for _, cell in cells) + GAP * 2 + LABEL,
        ),
        (40, 40, 40),
    )
    draw = ImageDraw.Draw(sheet)
    left = GAP
    for name, cell in cells:
        sheet.paste(cell, (left, GAP))
        draw.text((left, cell.height + GAP + 2), name, fill=(255, 255, 255))
        left += cell.width + GAP
    sheet.save(args.out)
    print(f"-> {args.out}  {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    main()

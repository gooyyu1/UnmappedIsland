"""生成した絵を、カードの枠に馴染むかたちへ整える。

カードの絵は820x1280で、枠の画像（card_frame.png）の上へそのまま重ねられる（Card.ts）。紙が占める
のは周囲10pxを空けた角丸（半径64px）の内側だけなので、そこからはみ出した分は消す必要がある。

ただし四角く切り落とすと境目が線として見えてしまう。水彩の滲みは紙へ吸い込まれて薄くなるものなので、
2つのやり方を重ねて「だんだん消える」ようにしている。

1. 明るい画素ほど透かす。生成された絵の白い余白がカードの紙地に置き換わり、絵と紙が地続きになる。
   影や薄い塗りは半透明として残るので、輪郭を切り抜いたときのような硬さが出ない。
2. 紙の縁の内側でだんだん薄くする。境界の外は必ず0にするので、枠の縁へは絶対にはみ出さない。

    python card_art.py portrait.png --out ../../src/assets/objects/character.png

使った設定は出力の隣へ .json として残す。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

# カードの絵の寸法と、その中で紙が占める範囲（Card.ts の FRAME_INSET / FRAME_RADIUS と同じもの）。
CARD_WIDTH = 820
CARD_HEIGHT = 1280
PAPER_MARGIN = 10
PAPER_RADIUS = 64


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """縦横比を保ったまま、指定の寸法を覆うよう拡大縮小して中央で切り出す。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def alpha_from_luma(rgb: np.ndarray, white: float, opaque: float) -> np.ndarray:
    """明るい画素ほど透ける不透明度。whiteで完全に透明、opaque以下で完全に不透明。"""
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    return np.clip((white - luma) / max(white - opaque, 1e-6), 0, 1)


def paper_mask(width: int, height: int, feather: int) -> np.ndarray:
    """紙の範囲の角丸マスク。縁の内側だけでだんだん薄くする。

    ぼかしフィルタは使わない。ぼかすとマスクが外側へも広がり、紙の範囲を超えて枠の縁まで絵が
    乗ってしまうため。代わりに縁からの距離を測り、featherピクセルかけて内側で立ち上げる。
    境界のちょうど外側は必ず0になる。
    """
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [PAPER_MARGIN, PAPER_MARGIN, width - 1 - PAPER_MARGIN, height - 1 - PAPER_MARGIN],
        radius=PAPER_RADIUS,
        fill=255,
    )
    inside = np.asarray(mask, dtype=bool)
    if feather <= 0:
        return inside.astype(np.float64)

    # 内側の各画素から、外側までの最短距離。
    distance = distance_transform_edt(inside)
    return np.clip(distance / feather, 0, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--white", type=float, default=250, help="この明度以上を完全に透明にする")
    parser.add_argument("--opaque", type=float, default=200, help="この明度以下を完全に不透明にする")
    parser.add_argument("--feather", type=int, default=48, help="紙の縁の内側で薄くしていく幅（px）")
    parser.add_argument("--keep-paper", action="store_true", help="明度による透過を使わない（縁の処理だけ）")
    args = parser.parse_args()

    source = cover(Image.open(args.source).convert("RGB"), CARD_WIDTH, CARD_HEIGHT)
    rgb = np.asarray(source, dtype=np.float64)

    alpha = paper_mask(CARD_WIDTH, CARD_HEIGHT, args.feather)
    if not args.keep_paper:
        alpha = alpha * alpha_from_luma(rgb, args.white, args.opaque)

    rgba = np.dstack([rgb, alpha * 255])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(out)

    settings = {
        "source": Path(args.source).name,
        "white": args.white,
        "opaque": args.opaque,
        "feather": args.feather,
        "keepPaper": args.keep_paper,
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  不透明度の平均 {alpha.mean():.2f}")


if __name__ == "__main__":
    main()

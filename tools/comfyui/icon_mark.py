"""切り出し済みのアイコンへ、絵文字の形を色替えして重ねる。

血のような**小さくて意味だけを伝えたい印**は、生成でも編集でも出せない。60u四方のアイコンに
描かせると、生々しい塊になるか、布の汚れに紛れて何なのか読めないかのどちらかになる。絵文字は
形が定まっていて小さくても読めるので、形だけを借りて色を差し替える。

    python icon_mark.py injury.png --out injury.png --emoji 💦 --hue 0 --size 72 --at 252 76 --shift -26

**色は乗算では変えられない。** 💦は水色なので、赤を掛けると暗く濁るだけになる。色相だけを回して
明度と彩度を残すと、絵文字の陰影とハイライトがそのまま生きる。

PIL が要る。絵文字のフォントは Windows 同梱の Segoe UI Emoji（COLR/CPAL）を使う。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

EMOJI_FONT = "C:/Windows/Fonts/seguiemj.ttf"
# Segoe UI Emojiのカラーグリフはこの大きさでしか出ない（他の値だと白黒の輪郭になる）。
# 欲しい大きさへは描いてから縮める。
EMOJI_RENDER_SIZE = 109


def render_emoji(character: str) -> Image.Image:
    """絵文字を1文字描き、余白を切り落とした画像を返す。"""
    font = ImageFont.truetype(EMOJI_FONT, EMOJI_RENDER_SIZE)
    canvas = Image.new("RGBA", (EMOJI_RENDER_SIZE * 2, EMOJI_RENDER_SIZE * 2), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text(
        (EMOJI_RENDER_SIZE // 2, EMOJI_RENDER_SIZE // 2), character, font=font, embedded_color=True
    )
    box = canvas.getbbox()
    if box is None:
        raise SystemExit(f"'{character}' が描けない。フォントがこの絵文字を持っていない")
    return canvas.crop(box)


def recolour(image: Image.Image, hue: float, saturation: float, value: float) -> Image.Image:
    """色相を差し替える。明度と彩度の**分布**は残すので、陰影とハイライトが生きる。

    valueは全体の明度の倍率。絵文字は彩度も明度も高いので、そのまま色相だけ回すと血にしては
    鮮やかすぎる。
    """
    rgba = np.asarray(image, dtype=np.float64) / 255
    rgb, alpha = rgba[:, :, :3], rgba[:, :, 3]
    brightness = rgb.max(axis=2)
    chroma = brightness - rgb.min(axis=2)
    v = brightness * value

    # HSVのS（彩度）を保ったまま、Hだけを指定の色相へ置く。
    s = np.divide(chroma, brightness, out=np.zeros_like(brightness), where=brightness > 0) * saturation
    h = (hue % 360) / 60
    sector = int(h)
    fraction = h - sector
    p, q, t = v * (1 - s), v * (1 - s * fraction), v * (1 - s * (1 - fraction))
    table = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = np.dstack([*table[sector % 6], alpha]) * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="切り出し済みのアイコン（透過PNG）")
    parser.add_argument("--out", required=True)
    parser.add_argument("--emoji", required=True, help="形を借りる絵文字1文字")
    parser.add_argument("--hue", type=float, default=0, help="置き換える色相（度。0が赤）")
    parser.add_argument("--saturation", type=float, default=1.0, help="彩度の倍率")
    parser.add_argument("--value", type=float, default=1.0, help="明度の倍率。絵文字は明るいので落とす")
    parser.add_argument("--size", type=int, required=True, help="重ねる絵文字の高さ（px）")
    parser.add_argument("--at", type=int, nargs=2, required=True, metavar=("X", "Y"), help="中心の位置（px）")
    parser.add_argument("--shift", type=int, default=0, help="元の絵を先に横へずらす量（px）")
    parser.add_argument("--opacity", type=float, default=1.0, help="重ねる濃さ")
    args = parser.parse_args()

    icon = Image.open(args.source).convert("RGBA")
    if args.shift:
        moved = Image.new("RGBA", icon.size, (0, 0, 0, 0))
        moved.paste(icon, (args.shift, 0))
        icon = moved

    mark = recolour(render_emoji(args.emoji), args.hue, args.saturation, args.value)
    width = max(1, round(mark.width * args.size / mark.height))
    mark = mark.resize((width, args.size), Image.LANCZOS)
    if args.opacity < 1:
        faded = np.asarray(mark, dtype=np.float64)
        faded[:, :, 3] *= args.opacity
        mark = Image.fromarray(np.clip(faded, 0, 255).astype(np.uint8), "RGBA")

    icon.alpha_composite(mark, (args.at[0] - mark.width // 2, args.at[1] - mark.height // 2))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    icon.save(out)
    print(f"-> {out}")


if __name__ == "__main__":
    main()

"""生成した絵の一部を切り出して、そのまま1枚の絵として使える大きさへ引き伸ばす。

    python crop_patch.py in.png --out patch.png --box 330 660 400 620 --size 832 1280

**カードの地に敷く素材は、素材そのものを頼むより物から切り出したほうが正しい。** 羽を素材として
頼むと、翼の風切羽を並べた面になって胴の羽の並びにならなかった（recipes/junglefowl_injuries_card.json）。
鳥を1羽描かせてその胴から切り出せば、並びは実物のままになる。

引き伸ばしで細部は甘くなるが、この後に Qwen Image Edit を通すので問題にならない——**Qwenへ渡すのは
並びだけ**で、質感はそちらが描き直す。
"""

from __future__ import annotations

import argparse

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="切り出す元のPNG")
    parser.add_argument("--out", required=True, help="PNGの保存先ファイル")
    parser.add_argument(
        "--box",
        type=int,
        nargs=4,
        required=True,
        metavar=("X", "Y", "W", "H"),
        help="切り出す矩形（元の絵の座標）",
    )
    parser.add_argument(
        "--size", type=int, nargs=2, required=True, metavar=("W", "H"), help="引き伸ばす先の寸法"
    )
    args = parser.parse_args()

    x, y, width, height = args.box
    image = Image.open(args.input).convert("RGB")
    if x < 0 or y < 0 or x + width > image.width or y + height > image.height:
        raise SystemExit(f"切り出す矩形が絵からはみ出しています（絵は{image.width}x{image.height}）")
    patch = image.crop((x, y, x + width, y + height)).resize(tuple(args.size), Image.LANCZOS)
    patch.save(args.out)
    print(f"-> {args.out}  {patch.width}x{patch.height}")


if __name__ == "__main__":
    main()

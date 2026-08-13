"""染みを、絵に焼くか、乗算で載る層として描く。

痣のような**面の色だけが変わるもの**は、生成にも編集にも任せられない。Qwen Image Edit に頼むと、
色と一緒に形と陰影まで描き直すので、くるぶしが腫れた塊になって出てくる。乗算で色を寄せるだけなら
元の陰影がそのまま残り、形はまったく動かない。

    python skin_tint.py foot.png --out foot.png --spot 238,240,60,0.55,#c98fa6
    python skin_tint.py --layer 410x640 --out bruise.png --spot 205,300,165,0.55,#dda6ab

--spot は「中心X,中心Y,半径,濃さ,色」で、何度でも重ねられる（薄く広い暈しの上に濃い芯を置く、
といった塗り方ができる）。半径の外側へ向かって滑らかに消える。

色は**乗算**で載る。指定した色が白に近いほど変化は小さく、暗く濁った色ほど強く沈む。透明な画素
（切り抜きの外）は塗らない。

**--layer は、焼く相手が実行時まで決まらないときに使う**（怪我の痣は、人にも動物にも載る）。
掛かり具合をそのまま重ねられる形——色と濃さ（アルファ）——に直して出すので、乗算で重ねれば焼いたのと
同じ絵になる。**白い画素は作らない**。「変わらない」は透明で表す（docs/ui/CardView.md 5 節）。

PIL と numpy が要る。
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np
from PIL import Image

SPOT_PATTERN = re.compile(r"^([\d.]+),([\d.]+),([\d.]+),([\d.]+),#([0-9a-fA-F]{6})$")


class Spot:
    """1つの染み。中心・半径・濃さ・乗算する色。"""

    def __init__(self, x: float, y: float, radius: float, strength: float, rgb: tuple[int, int, int]):
        self.x = x
        self.y = y
        self.radius = radius
        self.strength = strength
        self.rgb = rgb


def spot(text: str) -> Spot:
    matched = SPOT_PATTERN.match(text.strip())
    if matched is None:
        raise argparse.ArgumentTypeError(f"'{text}' は X,Y,半径,濃さ,#rrggbb の形ではありません")
    x, y, radius, strength, colour = matched.groups()
    rgb = (int(colour[0:2], 16), int(colour[2:4], 16), int(colour[4:6], 16))
    return Spot(float(x), float(y), float(radius), float(strength), rgb)


def apply_spot(rgb: np.ndarray, alpha: np.ndarray, target: Spot) -> None:
    """染みを1つ載せる。中心で最も濃く、半径の外側でちょうど消える。"""
    height, width = alpha.shape
    dx = np.arange(width) - target.x
    dy = np.arange(height) - target.y
    distance = np.hypot(dx[None, :], dy[:, None])

    # 縁で微分も0になる曲線（smoothstep）にする。単純な線形だと輪が見える。
    t = np.clip(1.0 - distance / target.radius, 0.0, 1.0)
    # 不透明な画素にだけ載せる。切り出しの影は半透明なので、3乗すれば実質的に染まらない
    # （物の色として置いた染みが、地に落ちた影まで染めるのはおかしい）。
    weight = (t * t * (3.0 - 2.0 * t) * target.strength * alpha**3)[:, :, None]

    tint = np.array(target.rgb, dtype=np.float64) / 255
    rgb *= 1.0 - weight * (1.0 - tint)


def as_layer(rgb: np.ndarray) -> np.ndarray:
    """白い紙に染みを載せた結果を、そのまま乗算で重ねられる層に直す。

    濃さ（アルファ）は最も暗くなる成分の落ち込み、色はそこから逆算する。何も変わらない画素は
    アルファ0——つまり透明であって、白ではない。
    """
    factor = rgb / 255
    alpha = (1.0 - factor).max(axis=2)
    # 変わらない画素での0除算を避ける。そこは透明なので、割った結果は出力に現れない。
    colour = np.clip(1.0 - (1.0 - factor) / np.where(alpha == 0, 1.0, alpha)[:, :, None], 0, 1)
    return np.rint(np.dstack([colour * 255, alpha * 255])).astype(np.uint8)


def size(text: str) -> tuple[int, int]:
    matched = re.match(r"^(\d+)x(\d+)$", text.strip())
    if matched is None:
        raise argparse.ArgumentTypeError(f"'{text}' は 幅x高さ の形ではありません")
    return int(matched.group(1)), int(matched.group(2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="切り出し済みの絵（透過PNG）")
    parser.add_argument("--layer", type=size, metavar="幅x高さ", help="絵に焼かず、層として描く")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--spot",
        type=spot,
        action="append",
        required=True,
        metavar="X,Y,R,S,#RRGGBB",
        help="染み1つ（中心X,中心Y,半径,濃さ,乗算する色）。重ねられる",
    )
    args = parser.parse_args()
    if (args.source is None) == (args.layer is None):
        raise SystemExit("焼く相手（source）と --layer は、どちらか一方だけを指定します")

    if args.layer is None:
        rgba = np.asarray(Image.open(args.source).convert("RGBA"), dtype=np.float64)
        rgb, alpha, opacity = rgba[:, :, :3].copy(), rgba[:, :, 3] / 255, rgba[:, :, 3]
    else:
        width, height = args.layer
        # 白い紙の上に染みを載せれば、そのまま「下地を何倍にするか」になる。
        rgb, alpha = np.full((height, width, 3), 255.0), np.ones((height, width))

    for target in args.spot:
        apply_spot(rgb, alpha, target)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tinted = (
        as_layer(np.clip(rgb, 0, 255))
        if args.layer is not None
        else np.dstack([np.clip(rgb, 0, 255), opacity]).astype(np.uint8)
    )
    Image.fromarray(tinted, "RGBA").save(out)
    print(f"-> {out}")


if __name__ == "__main__":
    main()

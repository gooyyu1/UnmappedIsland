"""切り出し済みの絵の一部を、陰影を残したまま別の色へ寄せる。

痣のような**面の色だけが変わるもの**は、生成にも編集にも任せられない。Qwen Image Edit に頼むと、
色と一緒に形と陰影まで描き直すので、くるぶしが腫れた塊になって出てくる。乗算で色を寄せるだけなら
元の陰影がそのまま残り、形はまったく動かない。

    python skin_tint.py foot.png --out foot.png --spot 238,240,60,0.55,#c98fa6

--spot は「中心X,中心Y,半径,濃さ,色」で、何度でも重ねられる（薄く広い暈しの上に濃い芯を置く、
といった塗り方ができる）。半径の外側へ向かって滑らかに消える。

色は**乗算**で載る。指定した色が白に近いほど変化は小さく、暗く濁った色ほど強く沈む。透明な画素
（切り抜きの外）は塗らない。

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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="切り出し済みの絵（透過PNG）")
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

    image = Image.open(args.source).convert("RGBA")
    rgba = np.asarray(image, dtype=np.float64)
    rgb, alpha = rgba[:, :, :3].copy(), rgba[:, :, 3] / 255

    for target in args.spot:
        apply_spot(rgb, alpha, target)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tinted = np.dstack([np.clip(rgb, 0, 255), rgba[:, :, 3]]).astype(np.uint8)
    Image.fromarray(tinted, "RGBA").save(out)
    print(f"-> {out}")


if __name__ == "__main__":
    main()

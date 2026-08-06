"""空の下地を描く（生成ではなく計算で作る）。

雲の無い空——日差しの強い晴れと灼熱——は、SDXLに頼むと必ず余計な物が付いてくる。太陽の円盤は
水平線際へ降りて夕景になり、外すと今度は雲と陸が湧く。**縦のグラデーションと光の滲みしか無い絵は、
計算で描く方が速くて確実**なので、ここで下地を作り、質感だけをQwen Image Editに足させる
（README「空の絵」節）。

    python sky_art.py --out base.png --size 2048 640 \
        --stop "#1a5fa6@0" --stop "#9fc6dd@1" --glow 0.78,0.2,0.42,1.0 --core 0.05

PIL と numpy が要る。ComfyUI同梱の .venv のPythonで動く（README参照）。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def parse_stop(text: str) -> tuple[float, np.ndarray]:
    """"#rrggbb@位置" を (位置, RGB) にする。位置は上端0・下端1。"""
    color, _, position = text.partition("@")
    color = color.lstrip("#")
    rgb = np.array([int(color[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)
    return float(position), rgb


def gradient(width: int, height: int, stops: list[tuple[float, np.ndarray]]) -> np.ndarray:
    """縦のグラデーション。stopsの間を線形に繋ぐ。"""
    stops = sorted(stops)
    t = np.linspace(0.0, 1.0, height)
    columns = np.stack(
        [np.interp(t, [p for p, _ in stops], [c[i] for _, c in stops]) for i in range(3)],
        axis=1,
    )
    return np.repeat(columns[:, None, :], width, axis=1)


def add_glow(
    rgb: np.ndarray, x: float, y: float, radius: float, strength: float, color: np.ndarray, core: float
) -> np.ndarray:
    """光の滲みを1つ載せる。位置と半径は画像の短辺ではなく**高さ**に対する割合で指定する。

    滲みは距離の3乗で落とす。線形だと縁がはっきりした円盤に、指数だと中心以外がほとんど光らない。
    coreを与えると、その半径までは滲みとは別に色で埋める（太陽そのものを見せたいとき）。
    """
    height, width = rgb.shape[:2]
    # 円が縦横に潰れないよう、距離は高さを基準に測る（横長の絵なので幅で測ると横に伸びる）。
    dx = (np.arange(width) - x * width) / height
    dy = (np.arange(height) - y * height) / height
    distance = np.hypot(dx[None, :], dy[:, None])

    falloff = np.clip(1.0 - distance / radius, 0.0, 1.0) ** 3 * strength
    result = rgb + (color - rgb) * falloff[:, :, None]
    if core > 0:
        # 縁は1画素ぶんだけ滑らかにする。硬い縁のまま置くと、後段の縮小で階段が出る。
        inside = np.clip((core - distance) * height, 0.0, 1.0)
        result = result + (color - result) * inside[:, :, None]
    return result


def add_noise(rgb: np.ndarray, amount: float, seed: int) -> np.ndarray:
    """一様な面のままだと、Qwen Image Editが掴む手掛かりが無く、絵として何も足されない。"""
    if amount <= 0:
        return rgb
    generator = np.random.default_rng(seed)
    return rgb + generator.normal(0.0, amount * 255.0, rgb.shape)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, nargs=2, default=(2048, 640), metavar=("W", "H"))
    parser.add_argument("--stop", action="append", required=True, help='"#rrggbb@位置"。2つ以上')
    parser.add_argument("--glow", help="X,Y,半径,強さ（いずれも割合。半径は高さに対する割合）")
    parser.add_argument("--glow-color", default="#ffffff")
    parser.add_argument("--core", type=float, default=0.0, help="光の中心を色で埋める半径（高さに対する割合）")
    parser.add_argument("--noise", type=float, default=0.01, help="面に載せる粒の強さ（0〜1）")
    parser.add_argument("--seed", type=int, default=1, help="粒の並び。下地を選び直したいとき用")
    args = parser.parse_args()

    width, height = args.size
    rgb = gradient(width, height, [parse_stop(s) for s in args.stop])
    if args.glow:
        x, y, radius, strength = (float(v) for v in args.glow.split(","))
        rgb = add_glow(rgb, x, y, radius, strength, parse_stop(f"{args.glow_color}@0")[1], args.core)
    rgb = add_noise(rgb, args.noise, args.seed)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(out)
    print(f"-> {out}")


if __name__ == "__main__":
    main()

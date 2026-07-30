"""生成した絵をレーンの背景として使える形に整える。

やることは3つ。

1. 油絵風にぼかす（oilify）。生成直後の絵は背景にするには輪郭がはっきりしすぎていて、カードより
   目立ってしまうため。GIMPのFilters > Artistic > Oilifyと同じ「窓の中で最も多い明度帯の色を採る」
   アルゴリズムを実装している。
2. 縦を切り出す。仕上がりの高さより高く生成しておき、要らない範囲（空など）を落とす。
3. 横をシームレスにする。仕上がりの幅より広く生成しておき、余った幅を使って左右をクロスフェードで
   繋ぐ。切り捨てるのではなく継ぎ目の材料として使い切るので、無駄が出ない。

使った設定は出力の隣へ .json として残す（generate.pyと同じ考え方）。

    python postprocess.py in.png --out out.png --top 96

PIL と numpy と scipy が要る。ComfyUI同梱の .venv のPythonで動く（README参照）。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

TARGET_WIDTH = 2048
TARGET_HEIGHT = 512


def oilify(rgb: np.ndarray, radius: int, levels: int) -> np.ndarray:
    """窓の中で最も多い明度帯を選び、その帯に属する画素の平均色へ置き換える（GIMPのoilifyと同じ）。

    明度をlevels段に量子化し、段ごとに「窓内の個数」と「窓内の色の合計」を移動平均で求めて、
    個数が最大の段の平均色を採る。段の数だけ移動平均をかけるだけなので、画素ごとのループは要らない。
    """
    size = radius * 2 + 1
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    bins = np.clip((luma / 256.0 * levels).astype(np.int32), 0, levels - 1)

    best_count = np.zeros(rgb.shape[:2])
    result = np.zeros_like(rgb)
    for level in range(levels):
        mask = (bins == level).astype(np.float64)
        count = uniform_filter(mask, size=size, mode="reflect")
        # 窓内でこの段に属する画素だけの平均色。countが0の位置は後段のwhereで捨てられる。
        total = np.stack(
            [uniform_filter(rgb[:, :, c] * mask, size=size, mode="reflect") for c in range(3)],
            axis=2,
        )
        mean = np.divide(total, count[:, :, None], out=np.zeros_like(total), where=count[:, :, None] > 0)

        wins = count > best_count
        best_count = np.where(wins, count, best_count)
        result = np.where(wins[:, :, None], mean, result)
    return result


def seamless_horizontal(rgb: np.ndarray, target_width: int) -> np.ndarray:
    """余った幅を使って左右をクロスフェードで繋ぐ。

    出力のx列は入力のx列と(x + target_width)列が同じ絵になるべき位置なので、その2つを混ぜる。
    継ぎ目（出力の右端→左端）では入力の隣り合う2列が並ぶことになり、段差が生まれない。
    """
    height, width, _ = rgb.shape
    blend = width - target_width
    if blend <= 0:
        raise ValueError(f"幅{width}は仕上がり{target_width}より広くありません")

    out = rgb[:, :target_width].copy()
    ramp = 1.0 - np.arange(blend) / blend  # 左端で1（＝継ぎ目側を採る）、blend列で0
    out[:, :blend] = (
        out[:, :blend] * (1 - ramp)[None, :, None] + rgb[:, target_width : target_width + blend] * ramp[None, :, None]
    )
    return out


def seam_ratio(rgb: np.ndarray) -> float:
    """継ぎ目の段差が、画像内部の平均的な段差の何倍か。1に近いほど見分けが付かない。"""
    inner = np.abs(np.diff(rgb, axis=1)).mean()
    wrap = np.abs(rgb[:, 0, :] - rgb[:, -1, :]).mean()
    return float(wrap / inner) if inner > 0 else float("inf")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="generate.pyが出したPNG")
    parser.add_argument("--out", required=True)
    parser.add_argument("--top", type=int, default=0, help="縦の切り出し開始位置")
    parser.add_argument("--width", type=int, default=TARGET_WIDTH)
    parser.add_argument("--height", type=int, default=TARGET_HEIGHT)
    parser.add_argument("--oilify-radius", type=int, default=3, help="0でoilifyを飛ばす")
    parser.add_argument("--oilify-levels", type=int, default=12)
    args = parser.parse_args()

    rgb = np.asarray(Image.open(args.source).convert("RGB"), dtype=np.float64)
    if args.top + args.height > rgb.shape[0]:
        raise SystemExit(f"--top {args.top} + 高さ {args.height} が元画像の高さ {rgb.shape[0]} を超えます")

    if args.oilify_radius > 0:
        rgb = oilify(rgb, args.oilify_radius, args.oilify_levels)
    rgb = rgb[args.top : args.top + args.height]
    rgb = seamless_horizontal(rgb, args.width)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(out)

    ratio = seam_ratio(rgb)
    settings = {
        "source": Path(args.source).name,
        "top": args.top,
        "width": args.width,
        "height": args.height,
        "oilifyRadius": args.oilify_radius,
        "oilifyLevels": args.oilify_levels,
        "seamRatio": round(ratio, 3),
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  継ぎ目 {ratio:.2f}x（1に近いほど良い）")


if __name__ == "__main__":
    main()

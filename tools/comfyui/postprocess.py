"""生成した絵をレーンの背景として使える形に整える。

やることは3つ。

1. 油絵風にぼかす（oilify）。生成直後の絵は背景にするには輪郭がはっきりしすぎていて、カードより
   目立ってしまうため。GIMPのFilters > Artistic > Oilifyと同じ「窓の中で最も多い明度帯の色を採る」
   アルゴリズムを実装している。
2. 別の絵の色味へ寄せる（--match）。同じ土地の2つのレーンが別の場所に見えないようにするための調整。
   プロンプトで色を動かすと題材ごと変わってしまう（土色を足すよう頼んだら熱帯林が落葉樹林になった）
   ので、構図は生成で決めて色だけここで合わせる。
3. 保持する大きさへ縮小する。生成は破綻しない解像度で行い、常駐量はここで削る。レーンの背景は
   起動時に全土地ぶんを読み込む（BootScene参照）ので、1枚の大きさがそのまま常駐量に効く。

左右は生成の時点で繋がっているので（workflows/*_tiling.api.json）、繋ぎ直す処理は要らない。
繋がったままかは継ぎ目の指標を出して確かめる。

使った設定は出力の隣へ .json として残す（generate.pyと同じ考え方）。

    python postprocess.py in.png --out out.png

PIL と numpy と scipy が要る。ComfyUI同梱の .venv のPythonで動く（README参照）。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

TARGET_WIDTH = 1024
TARGET_HEIGHT = 320


def oilify(rgb: np.ndarray, radius: int, levels: int) -> np.ndarray:
    """窓の中で最も多い明度帯を選び、その帯に属する画素の平均色へ置き換える（GIMPのoilifyと同じ）。

    明度をlevels段に量子化し、段ごとに「窓内の個数」と「窓内の色の合計」を移動平均で求めて、
    個数が最大の段の平均色を採る。段の数だけ移動平均をかけるだけなので、画素ごとのループは要らない。

    横だけ端を巻き込む（wrap）。絵は左右が繋がっているので、端で折り返すと継ぎ目だけ別の平均になり、
    せっかくの繋がりが壊れる。縦は繋がっていないのでreflectのまま。
    """
    size = radius * 2 + 1
    modes = ["reflect", "wrap"]
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    bins = np.clip((luma / 256.0 * levels).astype(np.int32), 0, levels - 1)

    best_count = np.zeros(rgb.shape[:2])
    result = np.zeros_like(rgb)
    for level in range(levels):
        mask = (bins == level).astype(np.float64)
        count = uniform_filter(mask, size=size, mode=modes)
        # 窓内でこの段に属する画素だけの平均色。countが0の位置は後段のwhereで捨てられる。
        total = np.stack(
            [uniform_filter(rgb[:, :, c] * mask, size=size, mode=modes) for c in range(3)],
            axis=2,
        )
        mean = np.divide(total, count[:, :, None], out=np.zeros_like(total), where=count[:, :, None] > 0)

        wins = count > best_count
        best_count = np.where(wins, count, best_count)
        result = np.where(wins[:, :, None], mean, result)
    return result


def flatten(rgb: np.ndarray, sigma: float) -> np.ndarray:
    """細部を潰して、色ムラだけの面にする。

    生成モデルに「無地に近い面」を描かせるのは難しく、質感を否定すると別の題材（紙・布・風景）へ
    流れる。素材として何か生成させ、構造をここで消す方が確実。oilifyと同じ理由で横だけ端を巻き込む。
    """
    modes = ["reflect", "wrap"]
    return np.stack([gaussian_filter(rgb[:, :, c], sigma=sigma, mode=modes) for c in range(3)], axis=2)


def match_tone(rgb: np.ndarray, reference: Path, strength: float) -> np.ndarray:
    """基準の絵の色味へ寄せる。動かすのはチャンネル間の比だけで、明るさは変えない。

    明るさまで合わせると別レーンとの明暗差という別の話まで巻き込むので、輝度が変わらないように
    ゲインを正規化する。strengthは寄せる度合いで、1.0だと基準の色味そのもの、0.5だと中間。

    効かせる強さは画素ごとに変える。無彩色に近い画素ほど同じゲインで色が大きく動くため、一律に
    掛けると、寄せたい地面や葉が半分しか動かないうちに、奥の白い霞だけが色付く（実測で、暗部の
    色味が+9→+18に留まる一方、明るい部分は+27→+59まで振れた）。明度の2乗で落として、暗い画素へ
    集中させる。
    """
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    weight = ((1.0 - luma / 255.0) ** 2)[:, :, None]

    # ゲインは「効かせたい範囲」の色から決めたいので、平均も同じ重みで取る。
    source_mean = (rgb * weight).reshape(-1, 3).sum(axis=0) / weight.sum()
    target_mean = np.asarray(Image.open(reference).convert("RGB"), dtype=np.float64).reshape(-1, 3).mean(axis=0)
    gain = np.divide(target_mean, source_mean, out=np.ones(3), where=source_mean > 0)
    gain = 1.0 + (gain - 1.0) * strength

    weights = np.array([0.299, 0.587, 0.114])
    gain /= float((weights * source_mean * gain).sum() / (weights * source_mean).sum())
    return np.clip(rgb * (1.0 + (gain - 1.0) * weight), 0, 255)


def shrink(rgb: np.ndarray, width: int, height: int) -> np.ndarray:
    """左右が繋がったまま縮小する。

    そのまま縮小すると、両端の画素は「外側に絵が無い」前提で重み付けされ、継ぎ目にだけ別の色が
    生まれる。いったん横へ巻き付けてから縮小し、余分を切り落とすことでこれを避ける。
    """
    margin = 32
    source_margin = round(margin * rgb.shape[1] / width)
    wrapped = np.concatenate([rgb[:, -source_margin:], rgb, rgb[:, :source_margin]], axis=1)
    image = Image.fromarray(np.clip(wrapped, 0, 255).astype(np.uint8))
    image = image.resize((width + margin * 2, height), Image.LANCZOS)
    return np.asarray(image, dtype=np.float64)[:, margin : margin + width]


def seam_ratio(rgb: np.ndarray) -> float:
    """継ぎ目の段差が、画像内部の平均的な段差の何倍か。1に近いほど見分けが付かない。"""
    inner = np.abs(np.diff(rgb, axis=1)).mean()
    wrap = np.abs(rgb[:, 0, :] - rgb[:, -1, :]).mean()
    return float(wrap / inner) if inner > 0 else float("inf")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="generate.pyが出したPNG")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=TARGET_WIDTH, help="保持する幅")
    parser.add_argument("--height", type=int, default=TARGET_HEIGHT, help="保持する高さ")
    parser.add_argument("--oilify-radius", type=int, default=3, help="0でoilifyを飛ばす")
    parser.add_argument("--oilify-levels", type=int, default=12)
    parser.add_argument("--flatten", type=float, default=0, help="細部を潰すぼかしの強さ。0で飛ばす")
    parser.add_argument("--match", help="色味を寄せる基準の画像")
    parser.add_argument("--match-strength", type=float, default=0.5, help="寄せる度合い（0〜1）")
    args = parser.parse_args()

    rgb = np.asarray(Image.open(args.source).convert("RGB"), dtype=np.float64)
    # oilifyは縮小前にかける。縮小後だと、同じ半径でも画面上での効き方が保持サイズに左右される。
    if args.oilify_radius > 0:
        rgb = oilify(rgb, args.oilify_radius, args.oilify_levels)
    if args.flatten > 0:
        rgb = flatten(rgb, args.flatten)
    if args.match:
        rgb = match_tone(rgb, Path(args.match), args.match_strength)
    rgb = shrink(rgb, args.width, args.height)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(out)

    ratio = seam_ratio(rgb)
    settings = {
        "source": Path(args.source).name,
        "oilifyRadius": args.oilify_radius,
        "oilifyLevels": args.oilify_levels,
        "flatten": args.flatten,
        "match": Path(args.match).name if args.match else None,
        "matchStrength": args.match_strength if args.match else None,
        "size": [rgb.shape[1], rgb.shape[0]],
        "seamRatio": round(ratio, 3),
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  継ぎ目 {ratio:.2f}x（1に近いほど良い）")


if __name__ == "__main__":
    main()

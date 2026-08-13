"""生成した絵から、カードの比率で「最も平らな窓」を探す（怪我のカードの地に使う肌・毛皮のため）。

身体の絵は部位を描かせない（docs/ui/CardView.md 7 節）。ところが「肌だけ」と頼むと砂丘や胴体が
出るので、**背中のような目に見える部品の少ない場所を描かせ、その中の平らな所を切り出す**。どこを
切るかは目で選ばず、3つの数字で決める。

- 肌でない画素の割合——背景・髪・服が入っていないか
- 明るさの起伏——背骨・肩甲骨・輪郭のような構造が入っていないか
- 暗い点の割合——ほくろ・乳首・毛のような、小さいのに目を引くものが入っていないか

3つ目が要る。**起伏だけで選ぶと、平らな胸に乳首が1つ乗った窓が上位に来る**（小さいので起伏の平均は
上がらない）。地に敷く絵に目印が1つでもあると、その上へ載る傷より先にそちらが読まれてしまう。

    python flat_window.py 生成物/*.png

各画像の最良の窓を score とともに出す。採る1枚を決めたら、その seed と窓をレシピの
`seed` / `cardArt.crop` に書く（build.py が同じ絵を作り直せる）。

PIL と numpy が要る。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

# カードの絵の比率（objectArt.ts の CARD_ART_WIDTH と card_art.py の card サイズ）。
CARD_RATIO = 410 / 640

# 試す窓の幅（元画像の幅に対する割合）。小さいほど平らな場所は見つかるが、そのぶん拡大されて粗くなる。
SCALES = (0.62, 0.72, 0.82)
STEP = 24

# 肌でない画素が全部を占めたときの罰（1割なら10）。起伏の差では取り返せない重さにする——背景が
# 入った窓は、どれだけ平らでも地にはできない（平らな絵の起伏は2〜5程度）。
NON_SKIN_PENALTY = 100

# 暗い点と見なす暗さ（絵全体の中央値からの差）と、それが全部を占めたときの罰。
# 割合そのものは小さい（乳首1つで1%に満たない）ので、罰は肌でない画素より重くする。
DARK_SPOT_DEPTH = 28
DARK_SPOT_PENALTY = 400


def skin_mask(rgb: np.ndarray) -> np.ndarray:
    """肌・毛皮らしい画素か。赤 > 緑 > 青で、赤と青の差がはっきりある画素だけを採る。"""
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    return (r > g) & (g > b) & (r - b > 25) & (r > 80)


def roughness(gray: np.ndarray) -> np.ndarray:
    """各画素の起伏（隣との明るさの差）。構造のある場所ほど大きい。"""
    dy = np.abs(np.diff(gray, axis=0, prepend=gray[:1]))
    dx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    return dx + dy


def best_window(image: Image.Image) -> tuple[float, int, int, int, int]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float64)
    gray = rgb.mean(axis=2)
    skin, rough = skin_mask(rgb), roughness(gray)
    # 暗さの基準は絵全体の中央値。肌が大半を占める前提なので、これが素の肌の明るさになる。
    dark = gray < np.median(gray) - DARK_SPOT_DEPTH

    best: tuple[float, int, int, int, int] | None = None
    for scale in SCALES:
        width = int(image.width * scale)
        height = int(width / CARD_RATIO)
        if height > image.height:
            continue
        for top in range(0, image.height - height + 1, STEP):
            for left in range(0, image.width - width + 1, STEP):
                window = (slice(top, top + height), slice(left, left + width))
                score = (
                    (1 - skin[window].mean()) * NON_SKIN_PENALTY
                    + dark[window].mean() * DARK_SPOT_PENALTY
                    + rough[window].mean()
                )
                if best is None or score < best[0]:
                    best = (score, left, top, width, height)
    if best is None:
        raise SystemExit("カードの比率で収まる窓がありません（絵が横長すぎます）")
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", help="生成物のPNG")
    parser.add_argument("--out", help="最良の窓を切り出して書き出すディレクトリ")
    args = parser.parse_args()

    for path in (Path(p) for p in args.images):
        image = Image.open(path)
        score, left, top, width, height = best_window(image)
        print(f"{path.name}  score={score:6.2f}  crop: [{left}, {top}, {width}, {height}]")
        if args.out:
            out = Path(args.out) / f"crop_{path.stem}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            image.crop((left, top, left + width, top + height)).save(out)


if __name__ == "__main__":
    main()

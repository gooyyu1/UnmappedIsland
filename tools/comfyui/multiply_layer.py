"""乗算で載る層と、それを載せた絵の間を行き来する。

    python multiply_layer.py apply   肌.png 傷.png --out 肌に傷.png
    python multiply_layer.py extract 肌.png 描き直し.png --out 傷.png

apply は実行時（Card.ts）と同じ計算で層を地へ載せる。extract はその逆で、描き直された絵を地で割り、
**どの身体にも載る層へ戻す**。

これは、生成でも計算でも単独では出せないものを作るための道。切り傷を生成に頼むと、傷ではなく
「傷を負った人物の絵」が返る（prompts/objects.json の laceration）。線として描くと、構造の無い
一本の線にしかならない。**下絵を肌の上に置いて描き直させ、その肌で割って落とせば、傷だけが残る。**

割った結果には絵全体の寄り（描き直しは地の側も少し動かす）が混ざるので、浅い変化は捨てる。

PIL と numpy が要る。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

# 捨てる暗さと、そのまま残す暗さ（間は滑らかに繋ぐ）。地の側の寄りは数%に収まるので、
# それを跨ぐ値を選ぶ。上げすぎると傷の縁の淡い赤みまで消える。
FLOOR = 0.06
CEIL = 0.18


def load(path: str, size: tuple[int, int] | None = None) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    # Qwenは寸法を丸めて返すので、地の寸法へ戻してから比べる。
    if size is not None and image.size != size:
        image = image.resize(size, Image.LANCZOS)
    return np.asarray(image, dtype=np.float64) / 255


def apply(ground: str, layer: str) -> Image.Image:
    base = load(ground)
    src = np.asarray(Image.open(layer).convert("RGBA"), dtype=np.float64) / 255
    colour, alpha = src[:, :, :3], src[:, :, 3:4]
    return Image.fromarray(np.rint(255 * base * (1 - alpha + alpha * colour)).astype(np.uint8))


def extract(ground: str, painted: str) -> Image.Image:
    ground_image = Image.open(ground).convert("RGB")
    base = np.asarray(ground_image, dtype=np.float64) / 255
    after = load(painted, ground_image.size)

    # 「地を何倍にしたか」。明るくなった画素は乗算では表せないので、変化なしとして扱う。
    darkening = 1 - np.clip(after / np.maximum(base, 1e-6), 0, 1)
    depth = darkening.max(axis=2)
    t = np.clip((depth - FLOOR) / (CEIL - FLOOR), 0, 1)
    darkening *= (t * t * (3 - 2 * t))[:, :, None]

    # 濃さは最も暗くなる成分、色はそこから逆算する（skin_tint.py の as_layer と同じ）。
    alpha = darkening.max(axis=2)
    colour = np.clip(1 - darkening / np.where(alpha == 0, 1, alpha)[:, :, None], 0, 1)
    return Image.fromarray(
        np.rint(np.dstack([colour * 255, alpha * 255])).astype(np.uint8), "RGBA"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("verb", choices=("apply", "extract"))
    parser.add_argument("ground", help="地（肌・毛皮）の絵")
    parser.add_argument("other", help="applyなら乗算の層、extractなら描き直された絵")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    result = apply(args.ground, args.other) if args.verb == "apply" else extract(args.ground, args.other)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    result.save(out)
    print(f"-> {out}")


if __name__ == "__main__":
    main()

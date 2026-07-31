"""生成した本の絵から、情報エリアの背景（9patchの素材）を切り出す。

情報エリアの背景は本のページを模した枠付きの面で、9patchで引き伸ばして使う。9patchは四隅をそのまま、
辺を片方向だけ、中央を両方向に引き伸ばすので、**本の絵から片ページの矩形を切り出して縮めるだけ**で
素材になる。縁は縮小した分だけ細くなり、生成された紙の質感や表紙の陰影はそのまま残る。

SDXLに「本の一部を切り取った構図」は作らせられない（綴じ目・斜め・巻物・文字入りになる。16枚で全滅）。
見開きが画面いっぱいに写った絵を作らせ、切り出しはここでやる。

縁の飾りも生成では頼まない。装飾を求めると豪華な古書の製品写真へ寄り、平置きの白紙見開きが崩れる
（8枚で全滅）。9patchでは辺が引き伸ばされるので、**縁と平行な罫と角の飾り**だけが破綻せずに使える。
どちらもここで描く。太さも位置も設計値で決まる。

切り出しは、フィールドエリア側の辺だけ本の外を少し含め（そこは透明にして、本が落とす影にする）、
残る3辺は本の境界かそのわずか内側で切る。机や背景が入ると、情報エリアの縁に別の物が見えてしまう。

    python page_art.py book.png --out information_background.png \
        --crop 0 33 470 935 --cover-side left --fade 15 --short 384

--crop は左上のx y と 幅 高さ。--cover-side は切り出しの中で表紙（フィールド側）がどちら側かで、
出力では常に右へ来るよう必要なら反転する。--fade はその辺の外側を透明にする幅（切り出し前の座標）。
--cut は表紙の途中を落として縁を細くする指定（切り出し前の座標での列の範囲）。革は一様なので、
真ん中を抜いて繋いでも見えない。--short は仕上がりの短辺で、縦横比は保つ（保たないと辺ごとに縁の
太さが変わる）。使った設定は出力の隣へ .json として残す。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# 仕上がりの短辺。9patchなので中央は引き伸ばされる。縁と角が入る大きさがあればよい。
SHORT_SIDE = 128


def draw_rule(page: Image.Image, inset: int, color: str, corner: int) -> None:
    """縁と平行な罫を1本引き、角だけ内側へもう1本重ねる。

    9patchは辺を辺方向へ引き伸ばすので、縁と平行な線は伸びても線のまま。角は引き伸ばされないので、
    そこにだけ飾りを置ける。逆に、辺に沿って繰り返す模様は間延びするので使えない。
    """
    draw = ImageDraw.Draw(page)
    right, bottom = page.width - 1 - inset, page.height - 1 - inset
    draw.rectangle([inset, inset, right, bottom], outline=color, width=1)
    if corner <= 0:
        return

    gap = max(2, inset // 3)
    for x0, y0, dx, dy in [(inset, inset, 1, 1), (right, inset, -1, 1), (inset, bottom, 1, -1), (right, bottom, -1, -1)]:
        x, y = x0 + dx * gap, y0 + dy * gap
        draw.line([x, y, x + dx * corner, y], fill=color)
        draw.line([x, y, x, y + dy * corner], fill=color)


def splice(pixels: np.ndarray, start: int, end: int, blend: int, axis: int) -> np.ndarray:
    """[start, end) を落として前後を繋ぐ。継ぎ目の手前blend分をクロスフェードする。

    そのまま繋ぐと、紙のムラが上下（左右）で連続しないため、切断面が一本の線として残る。
    """
    pixels = np.moveaxis(pixels, axis, 0)
    removed = end - start
    blend = min(blend, start)
    out = np.concatenate([pixels[:start], pixels[end:]], axis=0)
    if blend > 0:
        ramp = (np.arange(blend) / blend).reshape((blend,) + (1,) * (out.ndim - 1))
        out[start - blend : start] = pixels[start - blend : start] * (1 - ramp) + pixels[end - blend : end] * ramp
    return np.moveaxis(out, 0, axis)


def tint_paper(page: Image.Image, target: str, curve: tuple[int, int, int], inset: int) -> Image.Image:
    """紙の色を目標へ寄せる。効かせる強さは明度で決める。

    一律に掛けると、紙の橙を抜くのと同じだけ革からも茶色が抜けて灰色になる。紙は明るく革は暗いので、
    明度で切り分けられる。curveは(low, full, soft)で、lowが革と紙の境目、lowからfullまでで立ち上げ、
    softより明るいところは255へ向けて落とす。上を落とすのは、元から明るい部分が色飛びするのを防ぐため。
    """
    low, full, soft = curve
    rgb = np.asarray(page, dtype=np.float64)
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    rise = np.clip((luma - low) / max(full - low, 1), 0, 1)
    fall = np.clip((255.0 - luma) / max(255 - soft, 1), 0, 1)
    weight = (rise * fall)[:, :, None]

    goal = np.array([int(target.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)
    paper = rgb[inset:-inset, inset:-inset].reshape(-1, 3).mean(axis=0)
    gain = np.divide(goal, paper, out=np.ones(3), where=paper > 0)
    return Image.fromarray(np.clip(rgb * (1.0 + (gain - 1.0) * weight), 0, 255).astype(np.uint8), "RGB")


def shade_outside(page: Image.Image, fade: int) -> Image.Image:
    """右端のfade列を、本が落とす影（外へ向かって消える半透明の黒）に置き換える。

    ここだけ本の外を残してあるのは、フィールドエリアへ重ねて、ページが手前にあるように見せるため。
    """
    rgba = np.asarray(page.convert("RGBA"), dtype=np.float64)
    ramp = np.linspace(0.45, 0.0, fade)
    rgba[:, -fade:, :3] = 0.0
    rgba[:, -fade:, 3] = ramp[None, :] * 255.0
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="本の絵（見開きが画面いっぱい）")
    parser.add_argument("--out", required=True)
    parser.add_argument("--crop", type=int, nargs=4, metavar=("X", "Y", "W", "H"), required=True,
                        help="切り出す片ページの矩形")
    parser.add_argument("--cover-side", choices=["left", "right"], default="right",
                        help="切り出しの中で表紙（フィールド側）がどちらか。出力では常に右へ来る")
    parser.add_argument("--fade", type=int, default=0, help="本の外を透明にする幅（切り出し前の座標）")
    parser.add_argument("--cut", type=int, nargs=2, metavar=("FROM", "TO"), action="append",
                        help="縁の途中を落として細くする列の範囲（切り出し前の座標）。複数回指定できる")
    parser.add_argument("--cut-rows", type=int, nargs=2, metavar=("FROM", "TO"), action="append",
                        help="中央の行を落として縦横比を詰める範囲（切り出し前の座標）。複数回指定できる")
    parser.add_argument("--blend", type=int, default=48, help="落とした継ぎ目をクロスフェードする幅")
    parser.add_argument("--paper", help="紙の色を寄せる目標（#RRGGBB）。表紙の革は動かさない")
    parser.add_argument("--paper-curve", type=int, nargs=3, metavar=("LOW", "FULL", "SOFT"),
                        default=(110, 140, 200), help="効かせる明度の範囲（革と紙の境目・全開・落とし始め）")
    parser.add_argument("--short", type=int, default=SHORT_SIDE, help="仕上がりの短辺")
    parser.add_argument("--rule-inset", type=int, default=0, help="罫を引く位置（縁からの距離）。0で罫なし")
    parser.add_argument("--rule-color", default="#8a6a2f", help="罫の色")
    parser.add_argument("--corner", type=int, default=0, help="角で罫を二重にする長さ。0で無し")
    args = parser.parse_args()

    x, y, width, height = args.crop
    page = Image.open(args.source).convert("RGB").crop((x, y, x + width, y + height))
    # 後ろから順に詰める。前から詰めると、残りの範囲の座標がずれる。
    pixels = np.asarray(page, dtype=np.float64)
    for start, end in sorted(args.cut or [], reverse=True):
        pixels = splice(pixels, start, end, args.blend, axis=1)
    for start, end in sorted(args.cut_rows or [], reverse=True):
        pixels = splice(pixels, start, end, args.blend, axis=0)
    page = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")
    width, height = page.width, page.height
    if args.cover_side == "left":
        page = page.transpose(Image.FLIP_LEFT_RIGHT)
    scale = args.short / min(width, height)
    page = page.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)

    if args.paper:
        page = tint_paper(page, args.paper, tuple(args.paper_curve), inset=max(8, round(args.short * 0.15)))
    if args.rule_inset > 0:
        draw_rule(page, args.rule_inset, args.rule_color, args.corner)
    if args.fade > 0:
        page = shade_outside(page, max(1, round(args.fade * scale)))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    page.save(out)

    settings = {
        "source": Path(args.source).name,
        "crop": args.crop,
        "coverSide": args.cover_side,
        "fade": args.fade,
        "short": args.short,
        "size": [page.width, page.height],
        "scale": round(scale, 4),
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {width}x{height} を {page.width}x{page.height} へ（{scale:.3f}倍）")


if __name__ == "__main__":
    main()

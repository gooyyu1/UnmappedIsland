"""生成した絵を、カードに載るかたちへ整える。

出力の寸法は --size で選ぶ。基準はカード幅410（カードの寸法205u x 320uのちょうど2倍で、4Kで
等倍になる大きさ）。**キャンバスの一辺が、そのままカード上での物の大きさになる。** Card.ts は絵を
カード中央へ置き、常に cardWidth/410 倍で描くだけなので、大きさの決定はここに閉じている。

    256  小石や種のような、丸くて小さい物（カード幅の62%）
    320  細長い物や、やや大きい物（78%）
    400  更に大きい物（98%）
    card 410x640。地形やポートレートのように、カード全面を使う絵

透過のさせ方は絵の性格で2通りある（--mode）。

- background: 紙・物・影の3つに分ける（separate参照）。アイテムのように、白地に置かれた1つの物を
  切り出す絵向け。
- luma: 明るい画素ほど透かす。キャラクターのポートレートのように、背景ごと紙へ溶かしたい絵向け。
  生成された絵の白い余白がカードの紙地に置き換わり、絵と紙が地続きになる。

    python card_art.py stone.png --out ../../src/assets/objects/stone.png --size 256

--trim を付けると、仕上げに透明な余白を切り落とす。**キャンバスの一辺ではなく物そのものの大きさで
置きたいとき**に使う。ボタンのアイコンがこれで、置き場所の枠へ縦横比のまま収めるため、正方形の
キャンバスに余白を残したままだと、平たい物ほど小さく見えてしまう（--sizeは切り出しの解像度になる）。

絵に足りないものは、切り出したあとで足せる。落ち影が描かれていなければ --drop-shadow、色が
薄ければ --saturation / --gamma（それぞれ drop_shadow / retone 参照）。

使った設定は出力の隣へ .json として残す。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import (
    binary_fill_holes,
    distance_transform_edt,
    gaussian_filter,
    label,
    shift,
    sum_labels,
)

# カードの絵の寸法と、その中で紙が占める範囲（Card.ts の CARD_ART_WIDTH / FRAME_INSET /
# FRAME_RADIUS と同じもの）。410x640は、カードの寸法205u x 320uのちょうど2倍。4K（u=2px）で等倍に
# なる大きさで、これ以上はどの画面でも縮小されるだけの無駄になる。
CARD_WIDTH = 410
CARD_HEIGHT = 640
PAPER_MARGIN = 5
PAPER_RADIUS = 32

# 物を収める正方形キャンバスの段階。アイテムの絵はobject_defの数だけ増えるので、必要な段だけ使う。
OBJECT_SIZES = (256, 320, 400)

# キャンバスの縁と物の間に残す余白。透過の立ち上がり（--edge）が切れないだけの幅。
OBJECT_SLACK = 4


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """縦横比を保ったまま、指定の寸法を覆うよう拡大縮小して中央で切り出す。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def bounds(mask: np.ndarray) -> tuple[int, int, int, int]:
    """0でない部分の外接矩形 (left, top, right, bottom)。rightとbottomは含まない。"""
    ys, xs = np.nonzero(mask > 0)
    if xs.size == 0:
        raise SystemExit("紙の余白が無く、物を切り出せない。生成が画面いっぱいに描いている。")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_object(image: Image.Image, size: int, tolerance: float, edge: float, shadow: float,
               reach: float, reserve: float = 0) -> np.ndarray:
    """物だけを切り出し、正方形のキャンバスの中央へ、長辺がキャンバスに収まる大きさで置く。

    中央に合わせるのも、大きさを決めるのも、影ではなく物そのもの。影は片側にしか出ないので、影ごと
    外接矩形を取ると物が中央からずれ、影の大きさで物の大きさが変わってしまう。影のぶんはキャンバスの
    四辺に余白として確保する（reachより先には影は無い）。

    紙・物・影の判定は原寸の絵に対して行う（separate参照）。縁と影の幅は出力基準の指定なので、原寸へ
    直してから渡す。縮小は不透明度を掛けてから行う。掛けずに縮ませると、透明な画素が持っている白が
    縁へ滲み出て、紙の上に白い輪郭が残る。

    reserveは、後から足すもの（drop_shadow）のために四辺へ余分に空けておく幅。
    """
    rgb = np.asarray(image, dtype=np.float64)
    margin = max(edge, reach, OBJECT_SLACK, reserve)
    core, _ = separate(rgb, tolerance, 0, 0, 1)
    left, top, right, bottom = bounds(core)
    scale = (size - margin * 2) / max(right - left, bottom - top)

    alpha, premultiplied = separate(rgb, tolerance, edge / scale, shadow, reach / scale)
    pad = int(np.ceil(margin / scale))
    box = (max(left - pad, 0), max(top - pad, 0),
           min(right + pad, image.width), min(bottom + pad, image.height))
    cropped = Image.fromarray(
        np.clip(np.dstack([premultiplied, alpha * 255]), 0, 255).astype(np.uint8), "RGBA"
    ).crop(box)
    width = max(round(cropped.width * scale), 1)
    height = max(round(cropped.height * scale), 1)
    small = np.asarray(cropped.resize((width, height), Image.LANCZOS), dtype=np.float64)

    # 物の中心がキャンバスの中心へ来るように置く。はみ出した影は切り落とす。
    x = round(size / 2 - ((left + right) / 2 - box[0]) * scale)
    y = round(size / 2 - ((top + bottom) / 2 - box[1]) * scale)
    source = (slice(max(-y, 0), min(size - y, height)), slice(max(-x, 0), min(size - x, width)))
    target = (slice(max(y, 0), max(y, 0) + source[0].stop - source[0].start),
              slice(max(x, 0), max(x, 0) + source[1].stop - source[1].start))

    canvas = np.zeros((size, size, 4))
    piece = small[source]
    opacity = piece[:, :, 3:] / 255
    canvas[target[0], target[1], :3] = np.divide(
        piece[:, :, :3], opacity, out=np.zeros_like(piece[:, :, :3]), where=opacity > 0
    )
    canvas[target[0], target[1], 3] = piece[:, :, 3]
    return canvas


def paper_colour(rgb: np.ndarray) -> np.ndarray:
    """外周から測った紙の色。生成時の紙は白とは限らず、灰色や淡い色のことがある。"""
    bands = [rgb[:8], rgb[-8:], rgb[:, :8].transpose(1, 0, 2), rgb[:, -8:].transpose(1, 0, 2)]
    return np.median(np.concatenate([band.reshape(-1, 3) for band in bands]), axis=0)


def align_to_diagonal(image: Image.Image, tolerance: float) -> Image.Image:
    """物の長い向きを、正方形のキャンバスの対角線へ合わせる。

    細長い物を軸沿いに置くと、長さは一辺までしか使えない。対角線へ向けると外接矩形が正方形へ
    近づき、fit_objectの倍率が上がって√2倍まで伸ばせる。槍のように長さが見せ場の物に使う。

    向きは芯の二次モーメントから求める。回転で空いた隅は紙の色で埋める——白で埋めると、生成時の
    紙が白でないときに外周が二色になり、separateが紙の色を測り損ねる。
    """
    rgb = np.asarray(image, dtype=np.float64)
    core, _ = separate(rgb, tolerance, 0, 0, 1)
    ys, xs = np.nonzero(core > 0.5)
    x = xs - xs.mean()
    y = ys - ys.mean()
    # 画像の座標はyが下向きなので、この角度は「右へ行くほど下がる」向きを正とする。
    angle = np.degrees(0.5 * np.arctan2(2 * (x * y).mean(), (x * x).mean() - (y * y).mean()))
    # 近いほうの対角線へ倒す。遠いほうへ回すと、描かれた陰影と落ち影の向きが大きく狂う。
    target = min((45.0, -45.0), key=lambda t: abs(angle - t))
    paper = tuple(int(round(v)) for v in paper_colour(rgb))
    return image.rotate(angle - target, resample=Image.BICUBIC, expand=True, fillcolor=paper)


def alpha_from_luma(rgb: np.ndarray, white: float, opaque: float) -> np.ndarray:
    """明るい画素ほど透ける不透明度。whiteで完全に透明、opaque以下で完全に不透明。"""
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    return np.clip((white - luma) / max(white - opaque, 1e-6), 0, 1)


def separate(rgb: np.ndarray, tolerance: float, edge: float, shadow: float, reach: float,
             ) -> tuple[np.ndarray, np.ndarray]:
    """絵を紙・物・影に分け、不透明度と、乗算済みの前景色を返す。

    **返すのは観測された色ではなく、紙を取り除いた前景の色。** 輪郭の画素は生成時の紙と物が混ざった
    色をしている（観測色 C = α·F + (1-α)·B）。アルファだけ下げて C のまま返すと、カードの紙 P へ
    重ねたときに α·C + (1-α)·P となり、C に含まれる紙の白が二重に乗って輪郭が白く光る。前景 F を
    解いて α·F = C - (1-α)·B を返せば、重ねた結果は α·F + (1-α)·P になる。

    **影を物と同じ扱いにしてはいけない。** 「紙より暗ければ物」という一段のしきい値だと、落ち影も
    絵の具の下地板も不透明な塊として残り、切り出しの矩形がそのまま見える。

    影は紙に対する乗算として表す。影の画素が生成時の紙の明るさの何割かを測り、その割合だけカードの
    紙を暗くする黒を、その濃さの不透明度で置く。こうすると紙の質感が影を透けて見えるうえ、生成物の
    紙の色がカードの紙の色を汚さない。

    物は2段階で決める。紙よりtolerance以上暗い塊を芯とし、内側の穴を埋めて（石の明るい中央のような
    「明るいが背景ではない」場所を残すため）不透明にする。芯の外側はedge幅だけ、紙から物までどれだけ
    寄ったかで薄くする。人工的な傾斜を足すより輪郭が素直になる。

    **必ず原寸の絵に対して呼ぶこと。** 物の周りだけを切り出した絵に渡すと、紙の明るさを測る外周に
    物や影が入って狂う。
    """
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    paper_rgb = paper_colour(rgb)
    paper = max(float(paper_rgb @ np.array([0.299, 0.587, 0.114])), 1.0)

    core = binary_fill_holes(luma <= paper - tolerance)
    regions, count = label(core)
    if count:
        # 小さな塊は落とす。文字の消し残りや、2つ目に描かれてしまった物を持ち込まないため。
        areas = sum_labels(np.ones_like(regions), regions, np.arange(1, count + 1))
        core = np.isin(regions, np.flatnonzero(areas >= areas.max() * 0.1) + 1)

    # 縁の不透明度は、紙と物のあいだのどこに居るかの比。**明度ではなく色で測る。** 紙から最寄りの芯
    # へ向かう線に観測色を射影し、その位置を不透明度とする。明度の比だと、紙をそのまま暗くしただけの
    # 落ち影を「物が半分被っている」と読み違え、影の灰色が前景の色として残る。色で見れば、影は物の色の
    # 方向からずれるぶん不透明度が小さく出る。toleranceで割るのも駄目で、あれは芯を決めるしきい値
    # でしかなく物の色とは無関係なので、暗い物ほど見積もりを外す。
    outside, (row, column) = distance_transform_edt(~core, return_indices=True)
    direction = rgb[row, column] - paper_rgb if core.any() else np.zeros_like(rgb)
    coverage = np.clip(
        np.einsum("...c,...c->...", rgb - paper_rgb, direction)
        / np.maximum((direction ** 2).sum(axis=-1), 1e-6),
        0, 1)
    opacity = np.where(core, 1.0, np.where(outside <= edge, coverage, 0.0))

    # 影は物の近くにだけ置く。離れた場所の暗がりは、絵の具の下地板のような背景の描き込みなので拾わない。
    cast = np.clip(1 - luma / paper, 0, 1) * shadow * np.clip(1 - outside / max(reach, 1e-6), 0, 1)
    alpha = opacity + (1 - opacity) * cast

    foreground = rgb - (1 - opacity)[:, :, None] * paper_rgb
    return alpha, np.clip(np.where(opacity[:, :, None] > 0, foreground, 0), 0, 255)


def drop_shadow(canvas: np.ndarray, strength: float, offset: float, blur: float) -> np.ndarray:
    """物の輪郭から落ち影を作り、物の下へ敷く。

    生成された絵に落ち影が無いことは珍しくない。物を灰色の地の上に描き、その地の暗さで浮かせて
    いるためで、地を紙へ置き換えると影ごと消える（地を残すと灰色の四角が付いてくる）。絵の側に
    無いものは、こちらで描く。

    影は物の輪郭をずらしてぼかしただけのもの。プロンプトで光を左上からと指定しているので、
    右下へ落とす。strengthを上げると輪郭の形がそのまま出て貼り絵に見えるので、薄く使う。
    """
    obj = canvas[:, :, 3] / 255
    cast = np.clip(gaussian_filter(shift(obj, (offset, offset), order=1), blur) * strength, 0, 1)
    alpha = obj + (1 - obj) * cast

    out = np.zeros_like(canvas)
    # 影は黒。物の色を不透明度で按分するだけでよい。
    out[:, :, :3] = np.divide(canvas[:, :, :3] * obj[:, :, None], alpha[:, :, None],
                              out=np.zeros_like(canvas[:, :, :3]), where=alpha[:, :, None] > 0)
    out[:, :, 3] = alpha * 255
    return out


def retone(rgb: np.ndarray, saturation: float, gamma: float) -> np.ndarray:
    """彩度と明度を動かす。灰色との差を伸ばすだけなので、色相は変わらない。

    生成された物の色が薄いときに使う。**明度ではなく彩度が足りないことが多い。** 木で測ると、
    茶色く見える絵と白けて見える絵とで明度はほぼ同じ（104と103）で、違うのは彩度（20と61）だった。
    """
    grey = (rgb @ np.array([0.299, 0.587, 0.114]))[:, :, None]
    toned = grey + (rgb - grey) * saturation
    if gamma != 1.0:
        toned = 255 * np.clip(toned / 255, 0, 1) ** gamma
    return np.clip(toned, 0, 255)


def paper_mask(width: int, height: int, feather: int) -> np.ndarray:
    """紙の範囲の角丸マスク。縁の内側だけでだんだん薄くする。

    ぼかしフィルタは使わない。ぼかすとマスクが外側へも広がり、紙の範囲を超えて枠の縁まで絵が
    乗ってしまうため。代わりに縁からの距離を測り、featherピクセルかけて内側で立ち上げる。
    境界のちょうど外側は必ず0になる。
    """
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [PAPER_MARGIN, PAPER_MARGIN, width - 1 - PAPER_MARGIN, height - 1 - PAPER_MARGIN],
        radius=PAPER_RADIUS,
        fill=255,
    )
    inside = np.asarray(mask, dtype=bool)
    if feather <= 0:
        return inside.astype(np.float64)

    # 内側の各画素から、外側までの最短距離。
    distance = distance_transform_edt(inside)
    return np.clip(distance / feather, 0, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", default="320", choices=[*map(str, OBJECT_SIZES), "card"],
                        help="出力の一辺。cardは410x640でカード全面")
    parser.add_argument("--mode", choices=["background", "luma", "none"], default="background",
                        help="背景の抜き方。noneは縁の処理だけ")
    parser.add_argument("--tolerance", type=float, default=60,
                        help="background: 紙よりこれだけ暗ければ物と見なす")
    parser.add_argument("--edge", type=float, default=4, help="background: 物の輪郭が滲む幅（px）")
    parser.add_argument("--shadow", type=float, default=1.0, help="background: 影の濃さ。0で影を捨てる")
    parser.add_argument("--reach", type=float, default=24, help="background: 影が届く範囲（物からのpx）")
    parser.add_argument("--drop-shadow", type=float, default=0,
                        help="輪郭から落ち影を描く濃さ。0で描かない（絵に影があるときは不要）")
    parser.add_argument("--drop-offset", type=float, default=10, help="落ち影を右下へずらす量（px）")
    parser.add_argument("--drop-blur", type=float, default=8, help="落ち影のぼかしの幅（px）")
    parser.add_argument("--saturation", type=float, default=1.0, help="彩度の倍率")
    parser.add_argument("--gamma", type=float, default=1.0, help="明度のガンマ。1より大きいと暗くなる")
    parser.add_argument("--white", type=float, default=250, help="luma: この明度以上を完全に透明にする")
    parser.add_argument("--opaque", type=float, default=200, help="luma: この明度以下を完全に不透明にする")
    parser.add_argument("--feather", type=int, default=24, help="紙の縁の内側で薄くしていく幅（px）")
    parser.add_argument(
        "--trim",
        action="store_true",
        help="仕上げに透明な余白を切り落とす。キャンバスの一辺ではなく物そのものの大きさで置きたいとき用",
    )
    parser.add_argument("--crop", type=int, nargs=4, metavar=("X", "Y", "W", "H"),
                        help="使う範囲を先に切り出す（1枚に複数写ったときに1つだけ採る）")
    parser.add_argument("--diagonal", action="store_true",
                        help="物の長い向きを対角線へ倒す。細長い物を長く見せたいときに使う")
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGB")
    if args.crop:
        x, y, width, height = args.crop
        image = image.crop((x, y, x + width, y + height))
    if args.diagonal:
        image = align_to_diagonal(image, args.tolerance)

    if args.size == "card":
        # 全面に敷くので、紙からはみ出した分を角丸で消す必要がある。
        rgb = np.asarray(cover(image, CARD_WIDTH, CARD_HEIGHT), dtype=np.float64)
        mask = paper_mask(CARD_WIDTH, CARD_HEIGHT, args.feather)
        if args.mode == "background":
            alpha, premultiplied = separate(rgb, args.tolerance, args.edge, args.shadow, args.reach)
            rgb = np.divide(premultiplied, alpha[:, :, None],
                            out=np.zeros_like(rgb), where=alpha[:, :, None] > 0)
        elif args.mode == "luma":
            alpha = alpha_from_luma(rgb, args.white, args.opaque)
        else:
            alpha = np.ones((CARD_HEIGHT, CARD_WIDTH))
        rgba = np.dstack([rgb, mask * alpha * 255])
    else:
        # ぼかした影は輪郭から offset + blur*2 ほど広がる。そのぶんを四辺へ空けておく。
        reserve = args.drop_offset + args.drop_blur * 2 if args.drop_shadow else 0
        rgba = fit_object(image, int(args.size), args.tolerance, args.edge, args.shadow,
                          args.reach, reserve)
        if args.drop_shadow:
            rgba = drop_shadow(rgba, args.drop_shadow, args.drop_offset, args.drop_blur)

    if args.saturation != 1.0 or args.gamma != 1.0:
        rgba[:, :, :3] = retone(rgba[:, :, :3], args.saturation, args.gamma)
    if args.trim:
        left, top, right, bottom = bounds(rgba[:, :, 3])
        rgba = rgba[top:bottom, left:right]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(out)

    settings = {
        "source": Path(args.source).name,
        "size": args.size,
        **({"crop": args.crop} if args.crop else {}),
        **({"trim": True} if args.trim else {}),
        **({"diagonal": True} if args.diagonal else {}),
        **({"mode": args.mode, "feather": args.feather} if args.size == "card" else {}),
        **({"tolerance": args.tolerance, "edge": args.edge, "shadow": args.shadow, "reach": args.reach}
           if args.size != "card" or args.mode == "background" else {}),
        **({"white": args.white, "opaque": args.opaque}
           if args.size == "card" and args.mode == "luma" else {}),
        **({"dropShadow": args.drop_shadow, "dropOffset": args.drop_offset,
            "dropBlur": args.drop_blur} if args.drop_shadow else {}),
        **({"saturation": args.saturation} if args.saturation != 1.0 else {}),
        **({"gamma": args.gamma} if args.gamma != 1.0 else {}),
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {rgba.shape[1]}x{rgba.shape[0]}  不透明度の平均 {rgba[:, :, 3].mean() / 255:.2f}")


if __name__ == "__main__":
    main()

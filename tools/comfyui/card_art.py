"""生成した絵を、カードに載るかたちへ整える。

出力の寸法は --size で選ぶ。基準はカード幅410（カードの寸法205u x 320uのちょうど2倍で、4Kで
等倍になる大きさ）。**キャンバスの一辺が、そのままカード上での物の大きさになる。** Card.ts は絵を
カード中央へ置き、常に cardWidth/410 倍で描くだけなので、大きさの決定はここに閉じている。

    256  小石や種のような、丸くて小さい物（カード幅の62%）
    320  細長い物や、やや大きい物（78%）
    400  更に大きい物（98%）
    card 410x640。地形やポートレートのように、カード全面を使う絵

透過のさせ方は絵の性格で選ぶ（--mode）。

- background: 紙・物・影の3つに分ける（separate参照）。アイテムのように、白地に置かれた1つの物を
  切り出す絵向け。
- flood: 明らかな前景と明らかな背景から染み出させて、灰色の帯の帰属を決める（flood_core参照）。
  **影が濃くて、その最も暗い所が物の最も明るい所より暗い絵**向け——backgroundの単一のしきい値では
  分けられない（実測で影157対物171）。囲まれた紙（紐の輪の内側）も自力で抜けるので、keep_holes /
  holes の指定が要らない。**紙と物の色が近い絵には使えない**（灰色の地に置いた石で、石の面が
  背景と判定された）。
- luma: 明るい画素ほど透かす。**白い紙の上に主題だけが描かれた絵**（怪我の足）向け。生成された絵の
  白い余白がカードの紙地に置き換わり、絵と紙が地続きになる。
- none: 透かさない。地形やポートレートのように、**絵そのものがカードを埋める**もの向け。

**背景が描き込まれた絵にlumaを使わないこと。** 明度でアルファを決めるので、透けるのは「背景」では
なく「明るい画素」になる。紙の上では絵の明るい部分の色が抜け、暗い地の上では白く霞む。描かれた
背景（灰色の空・滲み）は中間色なので残り、抜けた白との落差が四角い塊として見える。

    python card_art.py stone.png --out ../../src/assets/objects/stone.png --size 256

--canvas を付けると、仕上げに透明な余白を切り落としてから、指定した大きさの透明キャンバスの中央へ
置き直す。**画像の寸法を揃えたまま、--size で物の大きさだけを変えたいとき**に使う（ボタンのアイコン）。
正方形のキャンバスに fit_object の余白を残したままだと、物の形によって余白の量が変わるので、
平たい物ほど小さく見えてしまう。

--headroom は、物の上へ伸びるもの（炉の炎）のためにキャンバスを上へ広げる（fit_object 参照）。
--align は大きさと位置を別の絵から決める。**同じ物の、状態だけが違う絵を揃えるためのもの**で、
火の付いた炉は炎のぶん外接矩形が変わるので、自分の形から決めさせると炉そのものが動いてしまう。

--below-plate は、カード全面の絵を名前の板の下まで下げる。主題が絵の上端の近くに来るポートレート
向け（below_plate参照）。

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
    binary_dilation,
    binary_fill_holes,
    distance_transform_edt,
    gaussian_filter,
    label,
    shift,
    sum_labels,
)
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from postprocess import oilify

# カードの絵の寸法と、その中で紙が占める範囲（Card.ts の CARD_ART_WIDTH / FRAME_INSET /
# FRAME_RADIUS と同じもの）。410x640は、カードの寸法205u x 320uのちょうど2倍。4K（u=2px）で等倍に
# なる大きさで、これ以上はどの画面でも縮小されるだけの無駄になる。
CARD_WIDTH = 410
CARD_HEIGHT = 640
PAPER_MARGIN = 5
PAPER_RADIUS = 20
# 名前の板の下端（Card.ts の FRAME_INSET + FRAME_SIDE + FRAME_HEAD = 32.5u）。板は不透明なので、
# ここより上に描かれたものはカードでは見えない（--below-plate）。
PLATE_BOTTOM = 65
# 角丸を滑らかにするための倍率。この倍で描いてから縮める（card_frame.py の SUPERSAMPLE と同じ）。
MASK_SUPERSAMPLE = 4

# 物を収める正方形キャンバスの段階。アイテムの絵はobject_defの数だけ増えるので、必要な段だけ使う。
# ボタンのアイコン（--canvas）はこの段に縛られない。あちらは段の数ではなく物の大きさそのものを表す。
OBJECT_SIZES = (256, 320, 400)

# キャンバスの縁と物の間に残す余白。透過の立ち上がり（--edge）が切れないだけの幅。
OBJECT_SLACK = 4


def recentre(rgba: np.ndarray, width: int, height: int) -> np.ndarray:
    """透明な余白を切り落として、指定の大きさの透明キャンバスの中央へ置き直す。

    **画像の寸法を揃えたまま、物の大きさだけを変えられるようにするため。** 寸法そのものを物の
    大きさにすると（切り落としただけの状態）、絵を差し替えるたびに画面上の大きさが暗黙に変わる。
    寸法を固定しておけば、変わるのは中の画素だけになる。

    fit_objectが空けた余白は物の大きさによって違うので、いったん切り落としてから置き直す。
    """
    left, top, right, bottom = bounds(rgba[:, :, 3])
    piece = rgba[top:bottom, left:right]
    if piece.shape[0] > height or piece.shape[1] > width:
        raise SystemExit(
            f"物がキャンバス({width}x{height})に収まらない: {piece.shape[1]}x{piece.shape[0]}。"
            "--size を小さくしてください"
        )
    canvas = np.zeros((height, width, 4))
    top_left = ((height - piece.shape[0]) // 2, (width - piece.shape[1]) // 2)
    canvas[top_left[0] : top_left[0] + piece.shape[0], top_left[1] : top_left[1] + piece.shape[1]] = piece
    return canvas


def object_size(text: str) -> str:
    """--size の値。"card" か正の整数。

    アイテムの絵は OBJECT_SIZES の段から選ぶが（常駐量が object_def の数だけ効くため）、ボタンの
    アイコンは3枚しか無く、段ではなく**物の実際の大きさ**を表す値を取る。
    """
    if text == "card" or (text.isdigit() and int(text) > 0):
        return text
    raise argparse.ArgumentTypeError(f"'card' か正の整数を指定してください（アイテムの絵は {OBJECT_SIZES} から）")


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """縦横比を保ったまま、指定の寸法を覆うよう拡大縮小して中央で切り出す。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def below_plate(rgb: np.ndarray) -> np.ndarray:
    """絵を名前の板の下まで下げ、空いた上端は最上行を伸ばして埋める。

    ポートレートは頭が絵の上端の近くに来るので、そのまま敷くと不透明な名前の板が顔を切る。下がった
    ぶん下端は失われるが、胸から下の余りより顔のほうが要る。

    埋めた帯は板に隠れて見えない。**それでも単色で塗らないのは、コーデックスが同じ絵をそのまま
    並べるため**（src/codex-viewer/pages.ts）。最上行を伸ばせば、そこだけ色が切り替わった帯にはならない。
    """
    return np.vstack([np.repeat(rgb[:1], PLATE_BOTTOM, axis=0), rgb[:-PLATE_BOTTOM]])


def bounds(mask: np.ndarray) -> tuple[int, int, int, int]:
    """0でない部分の外接矩形 (left, top, right, bottom)。rightとbottomは含まない。"""
    ys, xs = np.nonzero(mask > 0)
    if xs.size == 0:
        raise SystemExit("紙の余白が無く、物を切り出せない。生成が画面いっぱいに描いている。")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_object(image: Image.Image, size: int, tolerance: float, edge: float, shadow: float,
               reach: float, reserve: float = 0, neutral: float = 0,
               keep_holes: bool = False,
               holes: list[tuple[int, int]] | None = None,
               headroom: int = 0, reference: Image.Image | None = None,
               flood: dict | None = None) -> np.ndarray:
    """物だけを切り出し、正方形のキャンバスの中央へ、長辺がキャンバスに収まる大きさで置く。

    中央に合わせるのも、大きさを決めるのも、影ではなく物そのもの。影は片側にしか出ないので、影ごと
    外接矩形を取ると物が中央からずれ、影の大きさで物の大きさが変わってしまう。影のぶんはキャンバスの
    四辺に余白として確保する（reachより先には影は無い）。

    紙・物・影の判定は原寸の絵に対して行う（separate参照）。縁と影の幅は出力基準の指定なので、原寸へ
    直してから渡す。縮小は不透明度を掛けてから行う。掛けずに縮ませると、透明な画素が持っている白が
    縁へ滲み出て、紙の上に白い輪郭が残る。

    reserveは、後から足すもの（drop_shadow）のために四辺へ余分に空けておく幅。
    neutralは影を芯から外すための彩度のしきい値（separate参照）。**濃い影を持つ絵ではこれが要る**
    ——影が芯に入ると、上の「影ではなく物そのもの」が成り立たなくなる。
    keep_holes / holes は囲まれた紙を埋めないための指定（separate参照）。

    headroomは、正方形の**上**へ足す高さ。炉の炎のように、物の上へ伸びるものを入れる場所で、
    出来上がりは size x (size + headroom) になる。物は下の正方形の中央に来るので、カードの上では
    そのぶん下へ下がる。

    referenceは、大きさと位置を決める相手（既定は自分自身）。**同じ物の、状態だけが違う絵を揃える**
    ために使う——火の付いた炉は炎のぶん外接矩形が広がるので、自分の形から決めると炉そのものの
    位置と大きさが状態ごとに変わってしまう。同じ寸法の絵しか渡せない。
    """
    rgb = np.asarray(image, dtype=np.float64)
    margin = max(edge, reach, OBJECT_SLACK, reserve)
    core, _ = separate(np.asarray(image if reference is None else reference, dtype=np.float64),
                       tolerance, 0, 0, 1, neutral, keep_holes, holes, flood)
    left, top, right, bottom = bounds(core)
    scale = (size - margin * 2) / max(right - left, bottom - top)

    alpha, premultiplied = separate(rgb, tolerance, edge / scale, shadow, reach / scale, neutral,
                                    keep_holes, holes, flood)
    pad = int(np.ceil(margin / scale))
    box = (max(left - pad, 0), max(top - pad - int(np.ceil(headroom / scale)), 0),
           min(right + pad, image.width), min(bottom + pad, image.height))
    cropped = Image.fromarray(
        np.clip(np.dstack([premultiplied, alpha * 255]), 0, 255).astype(np.uint8), "RGBA"
    ).crop(box)
    width = max(round(cropped.width * scale), 1)
    height = max(round(cropped.height * scale), 1)
    small = np.asarray(cropped.resize((width, height), Image.LANCZOS), dtype=np.float64)

    # 物の中心が下の正方形の中心へ来るように置く。はみ出した影は切り落とす。
    canvas_height = size + headroom
    x = round(size / 2 - ((left + right) / 2 - box[0]) * scale)
    y = round(headroom + size / 2 - ((top + bottom) / 2 - box[1]) * scale)
    source = (slice(max(-y, 0), min(canvas_height - y, height)), slice(max(-x, 0), min(size - x, width)))
    target = (slice(max(y, 0), max(y, 0) + source[0].stop - source[0].start),
              slice(max(x, 0), max(x, 0) + source[1].stop - source[1].start))

    canvas = np.zeros((canvas_height, size, 4))
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


def punch(core: np.ndarray, dark: np.ndarray, holes: list[tuple[int, int]]) -> np.ndarray:
    """埋めた穴のうち、挙げた座標を含むものだけを芯から外す（separate参照）。

    座標が埋めた穴に載っていなければ止める。**黙って何もしないと、白い塊を載せたまま出荷される**
    ——絵を作り直したときにseedを取り違えても、出来上がりを見るまで気付けない。
    """
    if not holes:
        return core
    regions, _ = label(core & ~dark)
    for x, y in holes:
        if not 0 <= y < regions.shape[0] or not 0 <= x < regions.shape[1]:
            raise SystemExit(f"座標({x}, {y})が絵の外にある")
        region = regions[y, x]
        if region == 0:
            raise SystemExit(f"座標({x}, {y})は埋められた穴の上に無い。原寸の絵で取り直してください")
        core = core & (regions != region)
    return core


def extrapolate(rgb: np.ndarray, inside: np.ndarray) -> np.ndarray:
    """insideの外の画素へ、最寄りのinsideの色を伸ばす。"""
    _, (row, column) = distance_transform_edt(~inside, return_indices=True)
    return np.where(inside[:, :, None], rgb, rgb[row, column])


def steepness(rgb: np.ndarray, sigma: float) -> np.ndarray:
    """色の傾きの大きさ（/px）。物の縁は数pxで急に変わり、影の縁は緩やかに変わる。

    **明度ではなく色で測る。** 明るさがほぼ同じまま色だけが変わる境目——茶色い柄と、その隣の無彩色の
    影——が明度では段として立たず、そこが前景の侵入口になる（実測で、色で測ると侵入が0pxになった）。
    """
    gy = gaussian_filter(rgb, (sigma, sigma, 0), order=(1, 0, 0))
    gx = gaussian_filter(rgb, (sigma, sigma, 0), order=(0, 1, 0))
    return np.sqrt((gy ** 2 + gx ** 2).sum(axis=2))


def shade_field(luma: np.ndarray, paper_luma: float, known: np.ndarray) -> np.ndarray:
    """紙に落ちた影を、紙に対する乗算の場として推定する。物の下は周りから外挿する。

    影は物に近いほど濃い。**その勾配があるせいで、縁のαを解くときの背景色を1つに決められない**
    ——帯のすぐ外で測ると薄すぎ、遠くで測るともっと薄い。場として推定して先に割ってしまえば、
    背景はどこでも紙になる（実測で、影の側の縁の太りが 1.00px から 0.50px へ、最悪値は 4.25px
    から 0.75px へ下がった）。

    knownは背景と分かっている画素。粗い尺度へ順に送り、正規化畳み込みで埋める。
    """
    ratio = np.clip(luma / paper_luma, 0.05, 1.0)
    field = np.zeros_like(ratio)
    filled = np.zeros(ratio.shape, dtype=bool)
    for sigma in (8, 16, 32, 64, 128):
        weight = gaussian_filter(known.astype(np.float64), sigma)
        value = gaussian_filter(np.where(known, ratio, 0.0), sigma)
        enough = weight > 0.05
        take = enough & ~filled
        field[take] = value[take] / weight[take]
        filled |= enough
        if filled.all():
            break
    field[~filled] = 1.0
    return np.clip(gaussian_filter(field, 8), 0.05, 1.0)


def geodesic(cost: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """seedsから、costを払って進んだときの各画素までの最小費用。4近傍。

    辺の重みは両端の費用の平均。入る側だけで測ると、安い画素から高い画素へ入る一歩と、その逆とで
    費用が変わってしまう。
    """
    height, width = cost.shape
    index = np.arange(height * width).reshape(height, width)
    rows, columns, weights = [], [], []
    for axis in (0, 1):
        here = index.take(np.arange(0, cost.shape[axis] - 1), axis=axis)
        there = index.take(np.arange(1, cost.shape[axis]), axis=axis)
        average = (cost.take(np.arange(0, cost.shape[axis] - 1), axis=axis)
                   + cost.take(np.arange(1, cost.shape[axis]), axis=axis)) / 2
        rows += [here.ravel(), there.ravel()]
        columns += [there.ravel(), here.ravel()]
        weights += [average.ravel(), average.ravel()]

    graph = coo_matrix(
        (np.concatenate(weights), (np.concatenate(rows), np.concatenate(columns))),
        shape=(height * width, height * width),
    ).tocsr()
    reached = dijkstra(graph, directed=False, indices=index[seeds], min_only=True)
    return reached.reshape(height, width)


def flood_core(rgb: np.ndarray, paper: np.ndarray, flood: dict) -> tuple[np.ndarray, np.ndarray]:
    """明らかな前景と明らかな背景から染み出させ、物と判定した範囲を返す（第2の返り値は影の場）。

    **単一のしきい値では、影の最も暗い所と物の最も明るい所が逆転している絵がある**（実測で157対171）。
    2つのしきい値で「明らかな前景／グレーゾーン／明らかな背景」に分け、灰色の帯はどちらの陣地かを
    染み出しの安さで決める。費用は

        1 + edgeWeight·(色の傾き/基準)^power + grayWeight·(相手側らしさ) + chromaWeight·(無彩色らしさ)

    強い縁はほぼ越えられず、前景は明るい画素へ、背景は暗い画素へ、前景は無彩色の画素へ伸びにくい。
    **エッジは二値化せず費用としてしか使わないので、輪郭が閉じている必要がない**——穴があっても、
    そこを通った相手は自分の陣地の中を進む費用を払うので数px入って止まる。

    **背景の種は「紙と同じ色か」で決める。明るさではない。** 明るいだけを種にすると、物の明るい面
    （石の光る面、ココナッツの照り、サルの胸）にも種が立ってそこから食われる。外周と繋がっている
    ことを条件にすると、今度は囲まれた紙（紐の輪の内側）が種を失って埋まる。

    unshadeを立てると、1回目の判定を手掛かりに影の場を推定して割り、一様な紙の上で判定し直す。
    """
    paper_luma = max(float(paper @ np.array([0.299, 0.587, 0.114])), 1.0)

    def belongs(image: np.ndarray) -> np.ndarray:
        luma = image @ np.array([0.299, 0.587, 0.114])
        steep = np.clip(steepness(image, flood["sigma"]) / flood["slopeRef"], 0, None) ** flood["power"]
        lean = np.clip((paper_luma - luma) / max(paper_luma - flood["fg"], 1e-6), 0, 1)
        neutral = 1 - np.clip((image.max(axis=2) - image.min(axis=2)) / flood["chromaRef"], 0, 1)
        base = 1 + flood["edgeWeight"] * steep
        from_fg = geodesic(base + flood["grayWeight"] * (1 - lean) + flood["chromaWeight"] * neutral,
                           luma <= flood["fg"])
        from_bg = geodesic(base + flood["grayWeight"] * lean + flood["chromaWeight"] * (1 - neutral),
                           np.abs(image - paper).max(axis=2) <= flood["bg"])
        return from_bg / np.maximum(from_fg + from_bg, 1e-6) > 0.5

    core = belongs(rgb)
    if not flood["unshade"]:
        return core, None
    field = shade_field(rgb @ np.array([0.299, 0.587, 0.114]), paper_luma,
                        ~binary_dilation(core, iterations=flood["margin"]))
    return belongs(np.clip(rgb / field[:, :, None], 0, 255)), field


def separate(rgb: np.ndarray, tolerance: float, edge: float, shadow: float, reach: float,
             neutral: float = 0, keep_holes: bool = False,
             holes: list[tuple[int, int]] | None = None,
             flood: dict | None = None) -> tuple[np.ndarray, np.ndarray]:
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

    **濃い影は芯に入る。** 明度だけで芯を決めるので、紙をtolerance以上暗くする影は物と地続きの塊に
    なり、不透明な灰色として残ったうえ、fit_objectの中央合わせと倍率まで影ごみで決まってしまう。
    neutralを渡すと、彩度がそれ未満の暗い画素を芯から外す——影は紙を暗くしただけなので無彩色で、
    色のある物とは彩度で分かれる（実測で籠46に対し影1）。物の内側の無彩色な場所は穴埋めで残るので、
    影響を受けるのは輪郭の外に続く影だけ。**無彩色の物（石）には使えない**ので既定は0（外さない）。

    **輪が閉じた物では穴埋めが害になる。** 輪に巻いた紐や、葉が重なって隙間を囲む草では、囲まれて
    いるのは物の内側ではなく紙なので、埋めると不透明な白い塊としてカードに乗る。
    **物の形を見て決めることなので自動では判定できない**——穴の画素は定義上どれも「紙よりtoleranceだけ
    暗くはない」ので、明度でも色でも紙と区別が付かない。指定の仕方が2つあり、**物の側に明るい場所が
    あるかどうか**で選ぶ。

    - keep_holes: 埋めない。撚った紐や葉のように、**物そのものに明るい場所が無い**もの用。
      隙間が数えきれないほどある草はこれしかない。
    - holes: 挙げた座標（原寸の絵の x, y）を含む穴だけを抜く。**明るい場所を持つ物**用——サルの
      死体でkeep_holesを使うと、尻尾の輪と一緒に背の生成りの斑と鼻面まで抜けた。
      座標が穴に載っていなければ止まる。絵はseedで固定なので、一度調べれば毎回は要らないが、
      seedを変えたら取り直す。

    **必ず原寸の絵に対して呼ぶこと。** 物の周りだけを切り出した絵に渡すと、紙の明るさを測る外周に
    物や影が入って狂う。
    """
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    paper_rgb = paper_colour(rgb)
    paper = max(float(paper_rgb @ np.array([0.299, 0.587, 0.114])), 1.0)

    field = None
    if flood is not None:
        core, field = flood_core(rgb, paper_rgb, flood)
    else:
        dark = luma <= paper - tolerance
        if neutral > 0:
            dark &= rgb.max(axis=2) - rgb.min(axis=2) >= neutral
        core = dark if keep_holes else punch(binary_fill_holes(dark), dark, holes or [])
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
    # 背景の色。floodでは紙で代用しない——影の側は物の隣が紙ではなく影なので、紙を基準にすると
    # 純粋な影の画素が α=0.5 と出て、縁が影の中へ2px太る（実測）。
    behind = paper_rgb if flood is None else extrapolate(rgb, outside > edge)
    direction = rgb[row, column] - behind if core.any() else np.zeros_like(rgb)
    coverage = np.clip(
        np.einsum("...c,...c->...", rgb - behind, direction)
        / np.maximum((direction ** 2).sum(axis=-1), 1e-6),
        0, 1)
    opacity = np.where(core, 1.0, np.where(outside <= edge, coverage, 0.0))

    # 影は物の近くにだけ置く。離れた場所の暗がりは、絵の具の下地板のような背景の描き込みなので拾わない。
    # 濃さは観測した暗さから測るが、floodでは推定した場そのものを使う（物の暗さを影と読み違えない）。
    darkness = np.clip(1 - luma / paper, 0, 1) if field is None else np.clip(1 - field, 0, 1)
    cast = darkness * shadow * np.clip(1 - outside / max(reach, 1e-6), 0, 1)
    alpha = opacity + (1 - opacity) * cast

    # 前景色。floodでは**αで割り戻さず**、最寄りの芯の色を外延して不透明度を掛けるだけにする。
    # 割り戻しは誤差を 1/α 倍に増幅し、αの小さいところで紙より明るい色を作る（実測で、既存の絵の
    # 半透明画素の25〜59%が前景色ほぼ白）。カードに載せると輪郭が白く光る。
    foreground = (rgb - (1 - opacity)[:, :, None] * paper_rgb if flood is None
                  else opacity[:, :, None] * extrapolate(rgb, core))
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
    # 角の階段を消すため、拡大して描いてから縮める（card_frame.py の rounded_mask と同じ理由）。
    # **featherが0のときはこれが唯一の平滑化**で、角丸がそのままカードの輪郭として見える。
    big = Image.new("L", (width * MASK_SUPERSAMPLE, height * MASK_SUPERSAMPLE), 0)
    edge = PAPER_MARGIN * MASK_SUPERSAMPLE
    ImageDraw.Draw(big).rounded_rectangle(
        [edge, edge, width * MASK_SUPERSAMPLE - 1 - edge, height * MASK_SUPERSAMPLE - 1 - edge],
        radius=PAPER_RADIUS * MASK_SUPERSAMPLE,
        fill=255,
    )
    smooth = np.asarray(big.resize((width, height), Image.LANCZOS), dtype=np.float64) / 255
    if feather <= 0:
        return np.clip(smooth, 0, 1)

    # 内側の各画素から、外側までの最短距離。
    distance = distance_transform_edt(smooth > 0.5)
    return np.minimum(np.clip(distance / feather, 0, 1), np.clip(smooth, 0, 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", default="320", type=object_size,
                        help="出力の一辺。cardは410x640でカード全面")
    parser.add_argument("--mode", choices=["background", "luma", "none", "flood"],
                        default="background", help="背景の抜き方。noneは縁の処理だけ")
    parser.add_argument("--tolerance", type=float, default=60,
                        help="background: 紙よりこれだけ暗ければ物と見なす")
    parser.add_argument("--edge", type=float, default=4, help="background: 物の輪郭が滲む幅（px）")
    parser.add_argument("--shadow", type=float, default=1.0, help="background: 影の濃さ。0で影を捨てる")
    parser.add_argument("--reach", type=float, default=24, help="background: 影が届く範囲（物からのpx）")
    parser.add_argument("--keep-holes", action="store_true",
                        help="background: 物に囲まれた紙を埋めない。輪に巻いた紐や、葉が隙間を囲む草に使う")
    parser.add_argument("--hole", type=int, nargs=2, action="append", metavar=("X", "Y"),
                        help="background: この座標（原寸の絵）を含む穴だけを抜く。"
                        "明るい場所を持つ物（動物）向け。何度でも指定できる")
    parser.add_argument("--fg", type=float, default=110,
                        help="flood: これ以下の明度は明らかに前景")
    parser.add_argument("--bg", type=float, default=6,
                        help="flood: 紙の色とのずれがこれ以下なら明らかに背景")
    parser.add_argument("--edge-sigma", type=float, default=0.6, help="flood: 色の傾きを測る尺度")
    parser.add_argument("--slope-ref", type=float, default=20.0, help="flood: この傾き(/px)を1とする")
    parser.add_argument("--edge-weight", type=float, default=200.0, help="flood: 縁の越えにくさ")
    parser.add_argument("--power", type=float, default=2.0, help="flood: 縁の効き方の鋭さ")
    parser.add_argument("--gray-weight", type=float, default=12.0,
                        help="flood: 明るい画素へ前景が、暗い画素へ背景が伸びにくくなる度合い")
    parser.add_argument("--chroma-weight", type=float, default=40.0,
                        help="flood: 無彩色の画素へ前景が伸びにくくなる度合い")
    parser.add_argument("--chroma-ref", type=float, default=40.0, help="flood: この彩度を色付きと見なす")
    parser.add_argument("--unshade", action="store_true",
                        help="flood: 影の場を推定して先に割る。背景がどこでも紙になる")
    parser.add_argument("--shade-margin", type=int, default=6,
                        help="flood: 影の場を測るとき、物からこれだけ空ける（px）")
    parser.add_argument("--neutral-shadow", type=float, default=0,
                        help="background: 彩度がこれ未満の暗い画素を影と見なして芯から外す。"
                        "無彩色の物には使えない")
    parser.add_argument("--drop-shadow", type=float, default=0,
                        help="輪郭から落ち影を描く濃さ。0で描かない（絵に影があるときは不要）")
    parser.add_argument("--drop-offset", type=float, default=10, help="落ち影を右下へずらす量（px）")
    parser.add_argument("--drop-blur", type=float, default=8, help="落ち影のぼかしの幅（px）")
    parser.add_argument("--saturation", type=float, default=1.0, help="彩度の倍率")
    parser.add_argument("--gamma", type=float, default=1.0, help="明度のガンマ。1より大きいと暗くなる")
    parser.add_argument("--white", type=float, default=250, help="luma: この明度以上を完全に透明にする")
    parser.add_argument("--opaque", type=float, default=200, help="luma: この明度以下を完全に不透明にする")
    parser.add_argument("--feather", type=int, default=0,
                        help="紙の縁の内側で薄くしていく幅（px）。既定の0は角丸でぱきっと切り落とす")
    parser.add_argument(
        "--canvas",
        type=int,
        nargs=2,
        metavar=("W", "H"),
        help="仕上げに、透明な余白を切り落としてからこの大きさの透明キャンバスの中央へ置く。"
        "画像の寸法を揃えたまま、--sizeで物の大きさだけを変えたいとき用（ボタンのアイコン）",
    )
    parser.add_argument("--headroom", type=int, default=0,
                        help="物の上へ足す高さ（px）。炉の炎のように、物の上へ伸びるものを入れる場所")
    parser.add_argument("--align", metavar="PNG",
                        help="大きさと位置をこの絵から決める。同じ物の、状態だけが違う絵を揃えるため")
    parser.add_argument("--crop", type=int, nargs=4, metavar=("X", "Y", "W", "H"),
                        help="使う範囲を先に切り出す（1枚に複数写ったときに1つだけ採る）")
    parser.add_argument("--diagonal", action="store_true",
                        help="物の長い向きを対角線へ倒す。細長い物を長く見せたいときに使う")
    parser.add_argument("--below-plate", action="store_true",
                        help="card: 絵を名前の板の下まで下げる。頭が板に切られるポートレート向け")
    parser.add_argument("--oilify", type=int, nargs=2, metavar=("RADIUS", "LEVELS"),
                        help="油絵風に潰す（postprocess.oilify）。写実的すぎる絵を他のカードへ寄せる")
    args = parser.parse_args()
    holes = [tuple(hole) for hole in args.hole] if args.hole else None
    flood = {
        "fg": args.fg, "bg": args.bg, "sigma": args.edge_sigma, "slopeRef": args.slope_ref,
        "edgeWeight": args.edge_weight, "power": args.power, "grayWeight": args.gray_weight,
        "chromaWeight": args.chroma_weight, "chromaRef": args.chroma_ref,
        "unshade": args.unshade, "margin": args.shade_margin,
    } if args.mode == "flood" else None

    image = Image.open(args.source).convert("RGB")
    if args.crop:
        x, y, width, height = args.crop
        image = image.crop((x, y, x + width, y + height))
    if args.diagonal:
        image = align_to_diagonal(image, args.tolerance)
    if args.oilify:
        # 切り出しの前に掛ける。輪郭も一緒に絵の具の塊にしたいので、透過を決めたあとでは遅い。
        radius, levels = args.oilify
        painted = oilify(np.asarray(image, dtype=np.float64), radius, levels, ["reflect", "reflect"])
        image = Image.fromarray(np.clip(painted, 0, 255).astype(np.uint8), "RGB")

    if args.size == "card":
        # 全面に敷くので、紙からはみ出した分を角丸で消す必要がある。
        rgb = np.asarray(cover(image, CARD_WIDTH, CARD_HEIGHT), dtype=np.float64)
        if args.below_plate:
            rgb = below_plate(rgb)
        mask = paper_mask(CARD_WIDTH, CARD_HEIGHT, args.feather)
        if args.mode in ("background", "flood"):
            alpha, premultiplied = separate(rgb, args.tolerance, args.edge, args.shadow,
                                            args.reach, keep_holes=args.keep_holes, holes=holes,
                                            flood=flood)
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
        reference = None
        if args.align:
            reference = Image.open(args.align).convert("RGB")
            if reference.size != image.size:
                raise SystemExit(
                    f"--align の絵の寸法が違う: {reference.size} と {image.size}。"
                    "同じ下絵から派生した絵しか揃えられません"
                )
        rgba = fit_object(image, int(args.size), args.tolerance, args.edge, args.shadow,
                          args.reach, reserve, args.neutral_shadow, args.keep_holes, holes,
                          args.headroom, reference, flood)
        if args.drop_shadow:
            rgba = drop_shadow(rgba, args.drop_shadow, args.drop_offset, args.drop_blur)

    if args.saturation != 1.0 or args.gamma != 1.0:
        rgba[:, :, :3] = retone(rgba[:, :, :3], args.saturation, args.gamma)
    if args.canvas:
        rgba = recentre(rgba, *args.canvas)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(out)

    settings = {
        "source": Path(args.source).name,
        "size": args.size,
        **({"crop": args.crop} if args.crop else {}),
        **({"canvas": args.canvas} if args.canvas else {}),
        **({"headroom": args.headroom} if args.headroom else {}),
        **({"align": Path(args.align).name} if args.align else {}),
        **({"diagonal": True} if args.diagonal else {}),
        **({"belowPlate": True} if args.below_plate else {}),
        **({"oilify": args.oilify} if args.oilify else {}),
        **({"mode": args.mode, "feather": args.feather} if args.size == "card" else {}),
        **({"mode": args.mode, "fg": args.fg, "bg": args.bg, "edgeSigma": args.edge_sigma,
            "slopeRef": args.slope_ref, "edgeWeight": args.edge_weight, "power": args.power,
            "grayWeight": args.gray_weight, "chromaWeight": args.chroma_weight,
            "chromaRef": args.chroma_ref, "unshade": args.unshade,
            "shadeMargin": args.shade_margin} if flood else {}),
        **({"tolerance": args.tolerance, "edge": args.edge, "shadow": args.shadow, "reach": args.reach}
           if args.size != "card" or args.mode == "background" else {}),
        **({"white": args.white, "opaque": args.opaque}
           if args.size == "card" and args.mode == "luma" else {}),
        **({"dropShadow": args.drop_shadow, "dropOffset": args.drop_offset,
            "dropBlur": args.drop_blur} if args.drop_shadow else {}),
        **({"keepHoles": True} if args.keep_holes else {}),
        **({"holes": args.hole} if args.hole else {}),
        **({"neutralShadow": args.neutral_shadow} if args.neutral_shadow else {}),
        **({"saturation": args.saturation} if args.saturation != 1.0 else {}),
        **({"gamma": args.gamma} if args.gamma != 1.0 else {}),
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {rgba.shape[1]}x{rgba.shape[0]}  不透明度の平均 {rgba[:, :, 3].mean() / 255:.2f}")


if __name__ == "__main__":
    main()

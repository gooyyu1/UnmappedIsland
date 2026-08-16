"""物の配置だけを描いた下絵を1枚出す。Qwen Image Edit へ渡して絵にしてもらうための構図の指示。

    python layout_sketch.py --out lay.png --lay fan

**組み方そのものが物の正体である物は、生成では作れない。** 焚き火らしさは枝の組み方（放射状に広げ、
手前へ折れ口を見せる）、三石のかまどは石の据え方、くくり罠は輪と杭の関係で決まるが、SDXLはこれらの
配置を言葉から作れず、住居のティピー・薪棚・三角形の額縁・ただの紐の輪にしかならなかった
（recipes/campfire.json、recipes/three_stone_hearth.json、recipes/snare.json）。
形だけをここで描き、質感と塗りはQwenに任せる。

見た目の作り込みは要らない——**Qwenへ渡るのは配置だけ**なので、丸みも岩肌も下絵では省く。
"""

from __future__ import annotations

import argparse
import math

from PIL import Image, ImageDraw

WIDTH, HEIGHT = 1152, 896
BARK = (109, 66, 40)
BARK_DARK = (74, 44, 27)
FACE = (196, 146, 92)
FACE_LINE = (120, 84, 50)
OUTLINE = (48, 30, 18)
STONE = (146, 146, 146)
STONE_DARK = (104, 104, 104)
CORD = (163, 124, 78)
CORD_DARK = (120, 88, 52)
SAIL = (198, 186, 160)


def draw_branch(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    direction: tuple[float, float],
    length: float,
    thickness: int,
) -> None:
    """startから伸びる枝を1本。伸びた先の端には折れ口が来る。"""
    start_x, start_y = start
    dx, dy = direction
    end_x, end_y = start_x + dx * length, start_y + dy * length
    draw.line([(start_x, start_y), (end_x, end_y)], fill=BARK, width=thickness, joint="curve")
    # 影の側。丸みが無いと、隣り合う枝の境目が読めない。
    nx, ny = -dy, dx
    offset = round(thickness * 0.22)
    draw.line(
        [(start_x + nx * offset, start_y + ny * offset), (end_x + nx * offset, end_y + ny * offset)],
        fill=BARK_DARK,
        width=thickness // 3,
    )
    radius = thickness // 2
    draw.ellipse(
        [end_x - radius, end_y - radius, end_x + radius, end_y + radius],
        fill=FACE,
        outline=OUTLINE,
        width=4,
    )
    for ring in (0.66, 0.36):
        inner = radius * ring
        draw.ellipse(
            [end_x - inner, end_y - inner, end_x + inner, end_y + inner],
            outline=FACE_LINE,
            width=3,
        )


def draw_stone(
    draw: ImageDraw.ImageDraw, centre: tuple[float, float], size: tuple[float, float]
) -> None:
    """地面に据えた石を1つ。下半分を暗くして、置かれている向きを出す。"""
    x, y = centre
    half_w, half_h = size[0] / 2, size[1] / 2
    draw.ellipse([x - half_w, y - half_h, x + half_w, y + half_h], fill=STONE, outline=OUTLINE, width=4)
    draw.chord(
        [x - half_w, y - half_h, x + half_w, y + half_h],
        start=20,
        end=160,
        fill=STONE_DARK,
        outline=OUTLINE,
        width=4,
    )


def draw_fan(draw: ImageDraw.ImageDraw) -> None:
    """焚き火。枝を放射状に組み、手前へ折れ口を向ける。"""
    centre = (576, 380)
    for direction in [(-0.97, 0.24), (0.97, 0.24), (-0.58, 0.81), (0.58, 0.81), (0.0, 1.0)]:
        draw_branch(draw, centre, direction, 330, 74)
    # 枝の下へ差し込んだ焚き付け。
    for index in range(-4, 5):
        x = centre[0] + index * 34
        draw.line([(x, centre[1] + 300), (x + index * 12, centre[1] + 350)], fill=BARK_DARK, width=6)


def draw_three_stone(draw: ImageDraw.ImageDraw) -> None:
    """三石のかまど。石を三方に据え、その隙間から枝を中央へ差し込む。

    **石が主役で、枝は寝かせる。** 焚き火の枝組みに石を並べても、焚き火の周りに石が転がって
    いるようにしか見えない（実測）。器を載せる支点として石が地に据わっている形にする。
    """
    centre = (576, 470)
    draw_stone(draw, (576, 330), (330, 165))
    # 枝は奥の石より手前、手前の石より奥。隙間から差し込まれているように見せる。
    for direction in [(-0.99, -0.14), (0.99, -0.14), (-0.36, 0.93), (0.36, 0.93)]:
        # 枝の太さは焚き火と揃える。物としては同じ枝で、切り抜きの拡大率もほぼ同じ（実測で772対806）。
        draw_branch(draw, centre, direction, 340, 110)
    # 中央で交わるところに焚き付け。石で隠すと、何を燃やす場所なのかが読めない。
    for index in range(-3, 4):
        draw.line(
            [(centre[0] + index * 22, centre[1] - 20), (centre[0] + index * 30, centre[1] + 30)],
            fill=BARK_DARK,
            width=6,
        )
    draw_stone(draw, (352, 600), (330, 240))
    draw_stone(draw, (800, 600), (330, 240))


def draw_snare(draw: ImageDraw.ImageDraw) -> None:
    """くくり罠。開いた輪と、紐の端を留める杭。

    **輪と杭が離れていないと、ただの紐の輪になる。** 紐だけを頼むと coil（cord/rope の絵）と
    見分けが付かない。地面に開いた輪と、そこから引かれた紐、その先の杭までを1枚に置く。
    """
    loop = (300, 470)
    radius_x, radius_y = 250, 165
    draw.ellipse(
        [loop[0] - radius_x, loop[1] - radius_y, loop[0] + radius_x, loop[1] + radius_y],
        outline=CORD,
        width=26,
    )
    # 輪から杭へ引かれた紐。結び目のこぶを途中に置く。
    draw.line([(loop[0] + radius_x - 10, loop[1] + 40), (880, 620)], fill=CORD, width=26)
    draw.ellipse([520, 520, 580, 580], fill=CORD_DARK, outline=CORD_DARK)
    # 杭。地面へ打ち込むので、先を尖らせて手前を太くする。
    draw.line([(880, 620), (960, 300)], fill=BARK, width=54)
    draw.polygon([(866, 630), (894, 640), (880, 700)], fill=BARK_DARK)
    for offset in (-30, 0, 30):
        draw.line([(866, 560 + offset), (940, 580 + offset)], fill=CORD, width=12)


def draw_hafted(
    draw: ImageDraw.ImageDraw,
    butt: tuple[float, float],
    head: tuple[float, float],
    shaft: int,
    stone: tuple[float, float, float, float],
    lashing: float,
    across: bool,
) -> None:
    """柄の先へ石を紐で固定した道具。斧と槍はこの1つの形で、石の向きと大きさだけが違う。

    stoneは（柄の先から石を伸ばす長さ、柄の内側へ残す長さ、根元の半幅、先の半幅）。斧は柄と
    直角へ幅広の刃を出し（across）、槍は柄の延長上へ細い穂先を出す。lashingは紐を巻く範囲の長さ。
    """
    (butt_x, butt_y), (head_x, head_y) = butt, head
    length = ((head_x - butt_x) ** 2 + (head_y - butt_y) ** 2) ** 0.5
    axis = ((head_x - butt_x) / length, (head_y - butt_y) / length)
    side = (-axis[1], axis[0])
    draw.line([butt, head], fill=BARK, width=shaft, joint="curve")
    draw.line(
        [(butt_x + side[0] * shaft * 0.22, butt_y + side[1] * shaft * 0.22),
         (head_x + side[0] * shaft * 0.22, head_y + side[1] * shaft * 0.22)],
        fill=BARK_DARK,
        width=shaft // 3,
    )

    forward, back, root, tip = stone
    # 石を伸ばす向き。斧は柄と直角（side）、槍は柄の延長（axis）。
    grow, wide = (side, axis) if across else (axis, side)
    origin = (head_x, head_y)
    draw.polygon(
        [
            (origin[0] - grow[0] * back + wide[0] * root, origin[1] - grow[1] * back + wide[1] * root),
            (origin[0] + grow[0] * forward + wide[0] * tip, origin[1] + grow[1] * forward + wide[1] * tip),
            (origin[0] + grow[0] * forward - wide[0] * tip, origin[1] + grow[1] * forward - wide[1] * tip),
            (origin[0] - grow[0] * back - wide[0] * root, origin[1] - grow[1] * back - wide[1] * root),
        ],
        fill=STONE,
        outline=OUTLINE,
        width=4,
    )

    # 紐。柄と石が重なるところへ何重にも巻く。
    for step in range(5):
        at = 1.0 - lashing * step / 4 / length
        centre = (butt_x + (head_x - butt_x) * at, butt_y + (head_y - butt_y) * at)
        draw.line(
            [(centre[0] - side[0] * shaft * 0.8, centre[1] - side[1] * shaft * 0.8),
             (centre[0] + side[0] * shaft * 0.8, centre[1] + side[1] * shaft * 0.8)],
            fill=CORD,
            width=10,
        )


def draw_log(draw: ImageDraw.ImageDraw) -> None:
    """丸太。左下を手前、右上を奥にして対角線へ寝かせ、手前の端へ木口を向ける。

    **姿勢と太さは生成では決まらない。** 横枠で出せば前後に極端な遠近が付いて胴が寸詰まりになり、
    縦枠にすれば立った切り株になった（26枚で0。prompts/objects.json の log 参照）。太い枝と
    分かれるのは「先細りが無いこと」と「木口」の2点だけなので、その2点をここで決める。

    **奥へ向かって細くなるのは遠近であって先細りではない。** 太い枝と分ける軸を潰さないよう、
    編集の指示でもそう言う（recipes/log.json）。対角線に沿わせるのは槍と同じ理由で、長さが
    見せ場だから（card_art.py の align_to_diagonal）。
    """
    near, far = (330.0, 690.0), (900.0, 250.0)
    near_radius, far_radius = 150.0, 80.0
    span = ((far[0] - near[0]) ** 2 + (far[1] - near[1]) ** 2) ** 0.5
    axis = ((far[0] - near[0]) / span, (far[1] - near[1]) / span)
    side = (-axis[1], axis[0])

    def offset(point: tuple[float, float], along: float, across: float) -> tuple[float, float]:
        return (
            point[0] + axis[0] * along + side[0] * across,
            point[1] + axis[1] * along + side[1] * across,
        )

    # 奥の端。面は見えないので丸く閉じる。
    draw.ellipse(
        [far[0] - far_radius, far[1] - far_radius, far[0] + far_radius, far[1] + far_radius],
        fill=BARK_DARK,
    )
    draw.polygon(
        [
            offset(near, 0, near_radius),
            offset(far, 0, far_radius),
            offset(far, 0, -far_radius),
            offset(near, 0, -near_radius),
        ],
        fill=BARK,
    )
    # 陰は手前側（右下）へ。丸みが無いと、胴が板に見える。
    draw.polygon(
        [
            offset(near, 0, near_radius),
            offset(far, 0, far_radius),
            offset(far, 0, far_radius * 0.45),
            offset(near, 0, near_radius * 0.45),
        ],
        fill=BARK_DARK,
    )
    # 手前の木口。軸に直交する楕円で、短径は見込みのぶんだけ潰す。
    for scale, fill, outline in ((1.0, FACE, OUTLINE), (0.62, None, FACE_LINE), (0.3, None, FACE_LINE)):
        rim = [
            offset(
                near,
                -math.sin(step / 48 * math.tau) * near_radius * 0.42 * scale,
                math.cos(step / 48 * math.tau) * near_radius * scale,
            )
            for step in range(48)
        ]
        draw.polygon(rim, fill=fill, outline=outline, width=4)


def draw_raft(draw: ImageDraw.ImageDraw) -> None:
    """筏。丸太を横倒しに6本並べ、桁を2本渡して交点を縛る。

    **本数と縛りは配置でしか出せない。** 丸太6本と言葉で頼むと、積み上げた丸太の山になって
    桁も縄も出ない（6枚とも。prompts/objects.json の raft 参照）。手前へ木口を向けて並べ、
    桁と縄の位置をここで決める。
    """
    middle = 576
    # 手前ほど下・太く・長い。奥から順に描くので、手前の丸太が奥の丸太を隠す。
    logs = []
    for index in range(6):
        depth = index / 5
        logs.append((545 + depth * 180, 300 + depth * 78, 32 + depth * 24))
    for y, half, thickness in logs:
        draw.line([(middle - half, y), (middle + half, y)], fill=BARK, width=round(thickness))
        draw.line(
            [(middle - half, y + thickness * 0.3), (middle + half, y + thickness * 0.3)],
            fill=BARK_DARK,
            width=round(thickness / 3),
        )
        # 両端の木口。6本を数えられるように、左右へ扇状に並べる。
        radius = thickness / 2
        for x in (middle - half, middle + half):
            draw.ellipse(
                [x - radius * 0.55, y - radius, x + radius * 0.55, y + radius],
                fill=FACE,
                outline=OUTLINE,
                width=3,
            )
    # 桁。手前へ向かって少し開く。丸太と同じ色では陰に紛れるので、縁を付けて浮かせる。
    for girder in (-215, 215):
        ends = [
            (middle + girder * 0.84, logs[0][0] - 24),
            (middle + girder, logs[-1][0] + 30),
        ]
        draw.line(ends, fill=OUTLINE, width=34)
        draw.line(ends, fill=BARK, width=26)
        for index, (y, _, thickness) in enumerate(logs):
            x = middle + girder * (0.84 + 0.16 * index / 5)
            draw.line([(x - 34, y), (x + 34, y)], fill=CORD, width=round(thickness * 0.42))

    # 帆柱。甲板の中ほどに立てる。帆の下端との間を空けないと、帆が甲板に貼り付いて見える。
    draw.line([(middle, logs[3][0]), (middle, 92)], fill=BARK, width=26)
    # 支索。帆柱の頭から手前の隅へ。
    for corner in (logs[-1][1], -logs[-1][1]):
        draw.line([(middle, 106), (middle + corner, logs[-1][0])], fill=CORD, width=9)
    # 帆桁と、風をはらんだ横帆。
    draw.line([(392, 168), (760, 168)], fill=BARK, width=16)
    draw.polygon(
        [(406, 176), (746, 176), (776, 300), (762, 412), (576, 442), (390, 412), (376, 300)],
        fill=SAIL,
        outline=OUTLINE,
        width=4,
    )


def draw_axe(draw: ImageDraw.ImageDraw) -> None:
    """石の斧。柄の先へ、刃を外へ向けた楔形の石を横向きに縛る。"""
    draw_hafted(draw, (880, 780), (350, 300), 44, (170, 55, 46, 74), 150, across=True)


def draw_spear(draw: ImageDraw.ImageDraw) -> None:
    """槍。長い柄の延長上へ、木の葉形の穂先を縛る。長さが見せ場なので対角線いっぱいに置く。"""
    draw_hafted(draw, (120, 800), (960, 240), 26, (190, 30, 46, 8), 170, across=False)


LAYS = {
    "axe": draw_axe,
    "fan": draw_fan,
    "log": draw_log,
    "raft": draw_raft,
    "snare": draw_snare,
    "spear": draw_spear,
    "three_stone": draw_three_stone,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="PNGの保存先ファイル")
    parser.add_argument("--lay", required=True, choices=sorted(LAYS), help="組み方")
    args = parser.parse_args()

    image = Image.new("RGB", (WIDTH, HEIGHT), (255, 255, 255))
    LAYS[args.lay](ImageDraw.Draw(image))
    image.save(args.out)
    print(f"-> {args.out}  {image.width}x{image.height}")


if __name__ == "__main__":
    main()

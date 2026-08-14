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


LAYS = {"fan": draw_fan, "snare": draw_snare, "three_stone": draw_three_stone}


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

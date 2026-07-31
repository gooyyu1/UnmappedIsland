"""左右（や上下）が繋がった絵を生成するためのComfyUIノード。

畳み込みのパディングをcircularにすると、拡散モデルは端が繋がる前提で絵を組み立てるので、生成した
時点でタイルとして並べられる絵が得られる。後処理でクロスフェードして繋ぐ必要がなくなる。

同じことをするカスタムノード（ComfyUI-seamless-tiling）があるが、2つ問題があった。

1. デコードのたびにVAEをdeepcopyしており、連続生成でプロセスごと落ちる（ヒープ破壊）。
2. パッチが掛けっぱなしになる。ComfyUIのModelPatcher.clone()は実体のnn.Moduleを共有するため、
   「Make a copy」を選んでも書き換えは共有インスタンスに残り、同じプロセスで後から走らせた
   タイリング不要の生成まで別物になる（実測で全画素が変化した）。

ここでは掛けたぶんを必ず戻す。UNetはComfyUIがサンプリング時に呼ぶラッパの中で掛け外しし、VAEは
デコードを挟んで掛け外しする。deepcopyもしない。ComfyUIはプロンプトを直列に実行するので、
この範囲なら他の生成に漏れない。

インストールは、このディレクトリを ComfyUI の custom_nodes へコピーしてサーバーを再起動する
（tools/comfyui/README.md 参照）。
"""

from __future__ import annotations

from typing import Callable

from torch import Tensor
from torch.nn import Conv2d
from torch.nn import functional as F
from torch.nn.modules.utils import _pair

TILING = ["x_only", "y_only", "enable"]


def _axes(tiling: str) -> tuple[bool, bool]:
    return tiling in ("x_only", "enable"), tiling in ("y_only", "enable")


def _patch(module, tile_x: bool, tile_y: bool) -> Callable[[], None]:
    """配下のConv2dのパディングを差し替え、元へ戻す関数を返す。

    縦横で別のモードを使いたいので、paddingを0にしてF.padで自分で詰める。
    （asymmetric tiling: https://github.com/tjm35/asymmetric-tiling-sd-webui）
    """
    replaced: list[tuple[Conv2d, object]] = []
    mode_x = "circular" if tile_x else "constant"
    mode_y = "circular" if tile_y else "constant"

    for layer in module.modules():
        if not isinstance(layer, Conv2d):
            continue
        padding = layer._reversed_padding_repeated_twice
        pad_x = (padding[0], padding[1], 0, 0)
        pad_y = (0, 0, padding[2], padding[3])

        def conv_forward(self, input: Tensor, weight: Tensor, bias: Tensor | None, _x=pad_x, _y=pad_y) -> Tensor:
            working = F.pad(input, _x, mode=mode_x)
            working = F.pad(working, _y, mode=mode_y)
            return F.conv2d(working, weight, bias, self.stride, _pair(0), self.dilation, self.groups)

        # インスタンス属性として被せる。元から持っていたかを覚えておき、戻すときに消し分ける。
        replaced.append((layer, layer.__dict__.get("_conv_forward")))
        layer._conv_forward = conv_forward.__get__(layer, Conv2d)

    def restore() -> None:
        for layer, original in replaced:
            if original is None:
                layer.__dict__.pop("_conv_forward", None)
            else:
                layer.__dict__["_conv_forward"] = original

    return restore


class SeamlessTileScoped:
    """サンプリングの間だけUNetのパディングをcircularにする。"""

    CATEGORY = "UnmappedIsland"
    RETURN_TYPES = ("MODEL",)
    FUNCTION = "run"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",), "tiling": (TILING,)}}

    def run(self, model, tiling: str):
        tile_x, tile_y = _axes(tiling)
        patched = model.clone()

        def wrapper(apply_model, args):
            restore = _patch(patched.model, tile_x, tile_y)
            try:
                return apply_model(args["input"], args["timestep"], **args["c"])
            finally:
                restore()

        patched.set_model_unet_function_wrapper(wrapper)
        return (patched,)


class SeamlessVAEDecodeScoped:
    """デコードの間だけVAEのパディングをcircularにする。

    UNetだけでは足りない。VAEのデコードが端を通常のパディングで処理すると、そこだけ段差が残る
    （実測で継ぎ目の指標が1.31x→6.11x）。
    """

    CATEGORY = "UnmappedIsland"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "decode"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "vae": ("VAE",), "tiling": (TILING,)}}

    def decode(self, samples, vae, tiling: str):
        tile_x, tile_y = _axes(tiling)
        restore = _patch(vae.first_stage_model, tile_x, tile_y)
        try:
            return (vae.decode(samples["samples"]),)
        finally:
            restore()


NODE_CLASS_MAPPINGS = {
    "SeamlessTileScoped": SeamlessTileScoped,
    "SeamlessVAEDecodeScoped": SeamlessVAEDecodeScoped,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SeamlessTileScoped": "Seamless Tile (scoped)",
    "SeamlessVAEDecodeScoped": "Seamless VAE Decode (scoped)",
}

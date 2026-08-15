"""ComfyUIのHTTP APIでレーンの背景画像を生成する。

ComfyUIの画面を操作せず、API形式のワークフロー（workflows/*.api.json）へプロンプトなどを
差し込んで /prompt へ投げる。標準ライブラリだけで動くので、どのPythonからでも実行できる。

生成物と一緒に、実際に使われた値（seedを含む）を .json として書き出す。これがあれば同じ絵を
作り直せる。

    python generate.py rocky_field_fixtures_lane --out ../../src/assets/backgrounds/_raw

--raw-store を渡すと、生成の前に置き場（raw_store.py）へ訊き、同じ入力の絵が既にあれば
ComfyUIへ投げずにそれを使う。

使い方の全体は README.md を参照。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import raw_store

HERE = Path(__file__).resolve().parent
DEFAULT_SERVER = "http://127.0.0.1:8188"
COMFY = Path(os.environ.get("LOCALAPPDATA", "")) / "Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI"
# 直前に流したワークフローの種類。リポジトリではなく実行環境の状態なので一時ディレクトリに置く。
STATE = Path(tempfile.gettempdir()) / "unmapped-island-comfyui-workflow.txt"

# 切り出しの余白を持たせるため、仕上がり（2048x512）より広く生成する。中央へ寄りがちな
# 特徴物を避けて切り出せるようにするのが狙い（README「大きめに生成して切り出す」）。
DEFAULT_WIDTH = 2560
DEFAULT_HEIGHT = 640


def fill(node_tree: dict, values: dict) -> dict:
    """ワークフローの "$name" プレースホルダを values の中身へ置き換える。"""

    def walk(node: object) -> object:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items() if not k.startswith("_")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and node.startswith("$"):
            key = node[1:]
            if key not in values:
                raise KeyError(f"ワークフローの ${key} に対する値がありません")
            return values[key]
        return node

    return walk(node_tree)  # type: ignore[return-value]


def post_prompt(server: str, workflow: dict) -> str:
    body = json.dumps({"prompt": workflow}).encode()
    request = urllib.request.Request(
        f"{server}/prompt", body, {"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)["prompt_id"]


def wait_for_images(server: str, prompt_id: str, timeout: float) -> list[dict]:
    """生成が終わるまで待ち、出力された画像の {filename, subfolder, type} を返す。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(f"{server}/history/{prompt_id}") as response:
            history = json.load(response)
        entry = history.get(prompt_id)
        if entry is not None:
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"生成に失敗しました: {json.dumps(status, ensure_ascii=False)}")
            images = [
                image
                for output in entry.get("outputs", {}).values()
                for image in output.get("images", [])
            ]
            if images:
                return images
        time.sleep(2)
    raise TimeoutError(f"{timeout}秒待っても生成が終わりませんでした")


def download(server: str, image: dict) -> bytes:
    query = urllib.parse.urlencode(
        {
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
    )
    with urllib.request.urlopen(f"{server}/view?{query}") as response:
        return response.read()


def responds(server: str) -> bool:
    try:
        urllib.request.urlopen(f"{server}/system_stats", timeout=5)
        return True
    except (urllib.error.URLError, OSError):
        return False


def restart_server(server: str) -> None:
    """ComfyUIを起動し直し、応答するまで待つ。"""
    port = server.rsplit(":", 1)[-1]
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         f"Where-Object {{ $_.CommandLine -like '*main.py --port {port}*' }} | "
         "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
        check=False,
    )
    subprocess.Popen(
        [str(COMFY / ".venv/Scripts/python.exe"), "main.py", "--port", port],
        cwd=COMFY, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        if responds(server):
            print("ComfyUIを起動し直しました", flush=True)
            return
        time.sleep(3)
    raise SystemExit("ComfyUIが起動しません")


def ensure_running(server: str) -> None:
    """ComfyUIが応答しなければ起動する。パディングに触れない生成（qwen_edit.py）はこれだけでよい。"""
    if not responds(server):
        restart_server(server)


def ensure_process(server: str, workflow: str) -> None:
    """投げる直前に、ComfyUIを「この種類の生成が入っていないプロセス」にする。

    タイリングのワークフローは畳み込みのパディングを差し替える。掛けたぶんは戻しているが完全には
    戻らず、種類が混ざると後から作った絵がわずかにずれる（実測で平均1.94。混ざらなければ差は0）。
    絵としては同じでもレシピから同じPNGが得られなくなるので、種類の変わり目で作り直す。

    **置き場から生データが取れた手ではここへ来ない。** 生成しないならプロセスは汚れず、
    ComfyUIが起動している必要も無い。
    """
    kind = "tiling" if "tiling" in workflow else "plain"
    if responds(server) and STATE.exists() and STATE.read_text("utf-8").strip() == kind:
        return
    restart_server(server)
    STATE.write_text(kind, "utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="プロンプト集のキー（例: rocky_field_fixture）")
    parser.add_argument(
        "--prompts",
        default="lane_backgrounds.json",
        help="prompts/ 配下のファイル名。キャラクタなら characters.json",
    )
    parser.add_argument("--out", required=True, help="PNGの保存先ディレクトリ")
    parser.add_argument("--seed", type=int, help="省略すると乱数。記録されるので後から再現できる")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--count", type=int, default=1, help="seedを変えて複数枚出す")
    parser.add_argument(
        "--workflow",
        default="lane_background_sdxl.api.json",
        help="workflows/ 配下のファイル名。SDXLで出すなら lane_background_sdxl.api.json",
    )
    parser.add_argument("--lora", help="ワークフロー既定のLoRAを差し替える（作風を比べるとき用）")
    parser.add_argument("--lora-strength", type=float, help="LoRAの強度。--loraと合わせて使う")
    parser.add_argument(
        "--no-trigger",
        action="store_true",
        help="LoRAのトリガーワードを足さない。画風を出さず、輪郭を和らげる用途だけに使いたいとき",
    )
    parser.add_argument("--suffix", default="", help="出力ファイル名の末尾に足す文字（比較用）")
    parser.add_argument("--raw-store", help="生データの置き場。同じ入力の絵があれば生成しない")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()

    prompts = json.loads((HERE / "prompts" / args.prompts).read_text("utf-8"))
    if args.name not in prompts:
        raise SystemExit(f"'{args.name}' は prompts/{args.prompts} にありません")
    entry = prompts[args.name]
    loras = json.loads((HERE / "prompts" / "loras.json").read_text("utf-8"))
    template = json.loads((HERE / "workflows" / args.workflow).read_text("utf-8"))

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    store = raw_store.Store(args.raw_store) if args.raw_store else None

    for index in range(args.count):
        seed = args.seed if args.seed is not None else random.getrandbits(48)
        if args.seed is not None and args.count > 1:
            seed += index

        # NGワードはエントリごとに完全な形で持つ。共通の文字列を差し込む仕組みにすると、それを
        # 1文字変えただけで、使っていたすべての絵が再現できなくなる。
        # 新しいエントリを書くときの叩き台は、各ファイルの _baseNegative にある（生成には使わない）。
        negative = entry["negative"]

        # 実際に使うLoRA。--loraで差し替えないなら、ワークフローが持っている既定。
        lora_name = args.lora or next(
            (
                node["inputs"]["lora_name"]
                for node in template.values()
                if isinstance(node, dict) and node.get("class_type") == "LoraLoader"
            ),
            None,
        )
        # トリガーワードを言わないとほとんど効かないLoRAがあるので、自動で先頭へ足す（loras.json）。
        positive = entry["positive"]
        trigger = None if args.no_trigger else (loras.get(lora_name, {}).get("trigger") if lora_name else None)
        if trigger:
            positive = f"{trigger}, {positive}"

        values = {
            "positive": positive,
            "negative": negative,
            "width": args.width,
            "height": args.height,
            "seed": seed,
            "prefix": f"unmapped-island/{args.name}",
        }
        workflow = fill(template, values)

        # LoRAの差し替えは、組み立て終わったワークフローへ直接効かせる。
        for node in workflow.values():
            if node.get("class_type") != "LoraLoader":
                continue
            if args.lora:
                node["inputs"]["lora_name"] = args.lora
            if args.lora_strength is not None:
                node["inputs"]["strength_model"] = args.lora_strength
                node["inputs"]["strength_clip"] = args.lora_strength

        stem = f"{args.name}_{seed}{args.suffix}"
        raw_key = raw_store.key(None, workflow)
        data = store.get(stem, raw_key) if store else None
        if data is None:
            ensure_process(args.server, args.workflow)
            print(f"[{index + 1}/{args.count}] seed={seed} {args.width}x{args.height} 生成中...")
            started = time.time()
            prompt_id = post_prompt(args.server, workflow)
            # ワークフローのSaveImageは1つなので、1手が出す絵も1枚。
            image = wait_for_images(args.server, prompt_id, args.timeout)[0]
            print(f"    {time.time() - started:.0f}秒で完了")
            data = download(args.server, image)
            if store:
                print(f"    置き場へ {store.put(stem, raw_key, data).name}")
        else:
            print(f"[{index + 1}/{args.count}] seed={seed} 置き場の生データを使います")

        (out_dir / f"{stem}.png").write_bytes(data)
        # 同じ絵を作り直すのに要る情報を、絵の隣へ丸ごと残す。
        (out_dir / f"{stem}.json").write_text(
            json.dumps(
                {
                    "name": args.name,
                    "seed": seed,
                    "workflowFile": args.workflow,
                    "values": values,
                    "workflow": workflow,
                },
                ensure_ascii=False,
                indent=2,
            ),
            "utf-8",
        )
        print(f"    -> {out_dir / f'{stem}.png'}")


if __name__ == "__main__":
    main()

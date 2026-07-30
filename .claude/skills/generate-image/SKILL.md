---
name: generate-image
description: >-
  このPCのComfyUIで画像を生成する。レーンの背景画像・カードの絵・アイテムの絵など、
  「画像を作って」「生成して」「別の土地の背景も作って」と言われたときに使う。ComfyUIの画面は
  操作せず、HTTP APIへワークフローJSONを投げる。素朴に始めると、torchの入っていないPythonを
  掴む・ブラウザ形式のワークフローをAPIへ投げて弾かれる・中央に道が生成される、といった形で
  必ず詰まるため、先にこの手順を読むこと。
---

# ComfyUIで画像を生成する

生成の一式は [`tools/comfyui/`](../../../tools/comfyui/README.md) にあり、**プロンプト・ワークフロー・
後処理の設定はすべてリポジトリに入っている**。既存の絵を作り直すだけなら、レシピを渡すだけで済む。

```bash
python tools/comfyui/build.py tools/comfyui/recipes/rocky_field_fixture.json
```

## 先に知っておくべき落とし穴

### 1. Pythonは `.venv` の方（`standalone-env` には torch が無い）

Comfy Desktop の同梱環境は2つある。**`standalone-env\python.exe` で `main.py` を起動すると
`ModuleNotFoundError: No module named 'torch'` で落ちる。**

```
インストール先  %LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI
使うPython      <上記>\ComfyUI\.venv\Scripts\python.exe   ← torch / numpy / scipy / Pillow あり
```

このPythonは `tools/comfyui/*.py` を動かすのにも使う（`postprocess.py` が numpy と scipy を使う）。

### 2. サーバーの起動

```
cd %LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI
.venv\Scripts\python.exe main.py --port 8188
```

10秒ほどで `http://127.0.0.1:8188/system_stats` が 200 を返す。PowerShellから起動するなら
`Start-Process ... -WindowStyle Hidden -RedirectStandardOutput <log>` にして、ログを残しておくと
失敗したときに原因が分かる。

**起動済みのプロセスを勝手に止めないこと。** GIMPやComfy Desktopが開いたままのことがあり、
作業中のセッションを壊す。

### 3. ワークフローは「API形式」で投げる

ComfyUIの画面で保存した `.json`（`nodes` / `links` を持つブラウザ形式）は `/prompt` へ投げられない。
`{"ノードID": {"class_type": ..., "inputs": {...}}}` の形へ直す必要がある。
`tools/comfyui/workflows/lane_background.api.json` が変換済みの例。

入力名は `GET /object_info` で確認できる。

### 4. 生成は中央に主題を置きたがる

**背景用の絵は、そのままだとほぼ必ず中央に道や開けた帯ができる。** ネガティブプロンプトに
`path, trail, road, corridor, vanishing point, central subject, symmetry` を入れて抑える。

それでも「岩が上下を縁取って中央が道になる」ような構図が出るときは、プロンプトが**シーンを
描かせている**のが原因。テクスチャが欲しい場合は `extreme close-up macro texture` /
`the same density everywhere` / `no composition` と書き換えると収まる。

### 5. モデルは Flux が既定。SDXL は速いが作風が合わない

SDXL（`lane_background_sdxl.api.json`）は 1 枚 8〜12 秒で、Flux の 20〜30 倍速い。ただし
`ghibli watercolor` LoRA は強度を上げても写実のままで、既存の絵（水彩）に揃わない。**作風を
揃える必要があるなら Flux、構図の当たりを速く探したいだけなら SDXL** と使い分ける。
比較の詳細は `tools/comfyui/README.md`。

### 6. LoRAはトリガーワードとライセンスを両方確認する

**トリガーワードを言わないとほとんど効かないLoRAがある。** サイドカーの `metadata.json` の
`trainedWords` は空のことが多く当てにならない。実際のトリガーは safetensors ヘッダーの
`ss_tag_frequency`（学習時のタグ頻度）にあり、学習フォルダ名が `20_<トリガー> style` の形。
確定した結果は `tools/comfyui/prompts/loras.json` にあり、`generate.py` が自動で足す。

**ライセンスはLoRAごとに違う。** 生成画像を配布・販売してよいかを表すのは Civitai の
`allowCommercialUse` の **`Image`** だけ。手元にも `Image` の無いLoRAがある。
`prompts/loras.json` に記録済みだが、引き直すならハッシュから:

```
GET https://civitai.com/api/v1/model-versions/by-hash/<sha256>   → modelId が取れる
GET https://civitai.com/api/v1/models/<modelId>                  → allowCommercialUse はこちら
```

**by-hash の方には許諾が入っていない**（`model` は name/type/nsfw/poi のみ）ので、
モデル本体のエンドポイントまで引くこと。

ベースモデル側も見る。FLUX.1 [dev] は非商用、SDXL 1.0 base は OpenRAIL++-M で商用可。

### 7. 生成しただけでは背景に使えない

輪郭がはっきりしすぎていてカードより目立つ。`postprocess.py` が油絵風のぼかし（GIMPのoilifyと
同じアルゴリズム）→ 縦の切り出し → 横のシームレス化を通す。

**仕上がりより大きく生成する**（2048×512 に対して 2560×640）。横の余りは捨てずに左右をクロス
フェードで繋ぐ材料として使い切り、縦の余りは要らない範囲（空など）を落とすのに使う。

## 進め方

1. サーバーを起動して `system_stats` で応答を確認する
2. `tools/comfyui/prompts/lane_backgrounds.json` にプロンプトを足す
3. `generate.py <名前> --out <scratchpad>` で1枚出す
4. **出てきたPNGをReadツールで実際に見る。** 中央に道が出ていないか、他の土地の絵と作風が
   揃っているかを確認し、駄目ならプロンプトかseedを変えて回す
5. 良ければ `postprocess.py` を通し、継ぎ目の数値（1に近いほど良い。既存の絵は0.68〜1.97）を見る
6. `recipes/` にレシピを足して `build.py` で通し直し、リポジトリへ入れる

生成には1枚あたり30秒〜6分かかる（Flux dev fp8がVRAMに収まりきらず、実行ごとに差がある）。
タイムアウトは長めに取ること。

## 書き込んでよい場所

scratchpadとリポジトリの中だけ。ComfyUIは自身の `output/` へ書くが、これはComfyUI自身の動作で
避けられない（`filename_prefix` を `unmapped-island/<名前>` にして混ざらないようにしてある）。

## 再現性

同じseedで同じ構図は出るが、**画素が完全に一致するとは限らない**。fp8のFluxをGPUで動かすため
実行ごとに数値差が出る。レシピは「同じ絵が得られる」ことを保証するもの。

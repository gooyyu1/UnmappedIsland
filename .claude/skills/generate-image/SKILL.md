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
作業中のセッションを壊す。止める必要があるときは、キューが空かと、Comfy Desktop の GUI が
開いていないかを確かめた上で、ユーザーの許可を取る。

`custom_nodes` には `unmapped_island_seamless`（左右が繋がった絵。リポジトリの
`tools/comfyui/custom_nodes/` からコピーしたもの）と `comfyui-inspyrenet-rembg`、
`comfyui-lora-manager` が入っている。読み込ませるにはサーバーの再起動が要る。

### 3. ワークフローは「API形式」で投げる

ComfyUIの画面で保存した `.json`（`nodes` / `links` を持つブラウザ形式）は `/prompt` へ投げられない。
`{"ノードID": {"class_type": ..., "inputs": {...}}}` の形へ直す必要がある。
`tools/comfyui/workflows/lane_background_sdxl.api.json` が変換済みの例。

入力名は `GET /object_info` で確認できる。

### 4. 生成は中央に主題を置きたがる

**背景用の絵は、そのままだとほぼ必ず中央に道や開けた帯ができる。** ネガティブプロンプトに
`path, trail, road, corridor, vanishing point, central subject, symmetry` を入れて抑える。

それでも「岩が上下を縁取って中央が道になる」ような構図が出るときは、プロンプトが**シーンを
描かせている**のが原因。テクスチャが欲しい場合は `extreme close-up macro texture` /
`the same density everywhere` / `no composition` と書き換えると収まる。

### 5. ベースモデルは SDXL に統一する

生成画像の商用利用が可能なため（FLUX.1 [dev] は非商用）。Fluxのワークフローとその LoRA は誤用を
避けるためリポジトリから削除してあるので、**Fluxへ戻す提案はしない**。1枚8〜12秒で速いのも利点。

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
同じアルゴリズム）→ 保持サイズへの縮小を通す。

**生成 2048×640、保持 1024×320。** 生成サイズは SDXL が破綻しない範囲、保持サイズは常駐量
（起動時に全土地ぶんを読み込む）から決まる別の値。ゲーム側がレーンの高さへ合わせて拡大縮小するので、
保持サイズを画面の寸法に合わせる必要はない。

### 8. 左右が繋がった絵は生成時に作る

`workflows/lane_background_sdxl_tiling.api.json` が畳み込みのパディングを横だけ circular にする
（`tools/comfyui/custom_nodes/unmapped_island_seamless`。UNetとVAEの両方を替えないとデコードで端に
段差が残る）。後処理でクロスフェードして繋ぐ方法もあるが、両端の絵が重なった跡が残る。

**パディングの差し替えはプロセスに残る。** 掛けたぶんは戻しているが完全には戻らず、タイリングを
挟むと後続の生成が平均1.94ずれる（挟まなければ差は0）。`generate.py` が投げる直前に種類を見て、
変わり目でサーバーを起動し直す。

**生成後に絵へ手を入れるときは、横方向の端の扱いに注意する。** oilify の移動平均を既定の `reflect`
のままにしたら、端で折り返して継ぎ目が 0.9x から 3.4x へ悪化した。縮小も同様に、いったん横へ
巻き付けてから縮める。

### 9. 狙った構図が出ないときは、生成に頼るのをやめる

**SDXLが持っていない被写体は、何枚振っても出ない。** 実例:

- 無地に近い肌の面（ハンドレーン）: 肌を指定すれば人体か毛穴のマクロ写真、質感を否定すると紙・布・
  花・風景。21枚で全滅 → 素材だけ出させて `postprocess.py --flatten` で潰した。
- 本の一部を切り取った構図（情報エリア）: 綴じ目・斜め・巻物・文字入り。16枚で全滅 → 見開きを
  画面いっぱいに作らせ、`page_art.py` で切り出した。
- 角の補強のある表紙: 装飾を求めると豪華な古書の製品写真へ寄る。24枚で全滅。

同じ言い換えを5回も6回も試すより、**生成で出せるものを出させて、残りをスクリプトで作る**方が速い。
プロンプトで色を動かすのも同様で、ジャングルに土色を足そうとしたら熱帯林が落葉樹林になった
（色は `postprocess.py --match` で寄せた）。

## 進め方

1. `tools/comfyui/prompts/lane_backgrounds.json` にプロンプトを足す
2. `recipes/` にレシピを足して `build.py` で1枚出す（サーバーが落ちていれば起動する）
3. **出てきたPNGをReadツールで実際に見る。** 中央に道が出ていないか、他の土地の絵と作風が
   揃っているかを確認し、駄目ならプロンプトかseedを変えて回す
4. 継ぎ目の数値（1に近いほど良い。既存の絵は0.68〜1.97）を確認する
5. **透過した絵は、必ず赤い地に重ねて確認する**（次節）

### 透過の確認は、紙の上ではなく赤い地の上でやる

```bash
python tools/comfyui/alpha_check.py --out check.png src/assets/objects/raft.png src/assets/objects/snare.png
```

**カードの紙の上では、透過の失敗は見えない。** 生成物の紙もカードの紙も明るいので、埋め残した穴も
切り落とされた縁も「そういう絵」にしか見えない。実際に、帆柱と支索が三角形に紙を囲む筏で、不透明な
白い塊を2つ残したまま「既存の絵と揃っている」と報告した（`--keep-holes` で直る）。

**同じ抜き方の既存の絵を一緒に並べる。** 葉の隙間の淡い抜け残りのように、既存の絵にもあるものを
不具合と取り違えないため（`palm_tree`・`banana_plant`）。

**目視の判断はユーザーに仰ぐ。** シードを何本か振ってシートにまとめ、実寸（レーンなら高さ352px、
カードなら205x320）で並べて見せ、選んでもらう。拡大して判断すると効果の強さを読み違える。

1枚8〜12秒。シードを振るときは複数枚ぶんのタイムアウトを取ること。

## 書き込んでよい場所

scratchpadとリポジトリの中だけ。ComfyUIは自身の `output/` へ書くが、これはComfyUI自身の動作で
避けられない（`filename_prefix` を `unmapped-island/<名前>` にして混ざらないようにしてある）。

## 再現性

**生成物（後処理前の生データ）は別リポジトリ
[UnmappedIsland-art-raw](https://github.com/gooyyu1/UnmappedIsland-art-raw) に置く。** `build.py` は
生成の前に置き場へ訊くので、**既存の絵を作り直すだけならComfyUIを通らず、同じPNGが必ず得られる**
（生成が起きるのは、プロンプト・seed・寸法・LoRA・ワークフローのどれかを変えたときだけ）。

`UNMAPPED_ISLAND_ART_RAW` にcloneの `raw/` を指すと、そこへ溜まる。指さなければ本体の `.art-raw/` へ
1枚ずつ落ちてくる。**新しく生成したら、置き場への追加と `tools/comfyui/raw.lock.json` の更新を
両方コミットすること**（詳細はあちらのREADME）。

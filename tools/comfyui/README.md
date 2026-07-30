# ComfyUI でレーンの背景画像を作る

`src/assets/lanes/<土地>_fixture.png` / `<土地>_item.png`（仕様は
[docs/ui/ScreenLayout.md](../../docs/ui/ScreenLayout.md) レーンの背景 節）を、ComfyUI の HTTP API
経由で作るための一式です。**画面を操作せず、ワークフローを JSON として投げます。**

## 作り直す

レシピ 1 つで、生成から仕上げまで通ります。

```bash
python build.py recipes/rocky_field_fixture.json
```

新しい土地を足すときは、`prompts/lane_backgrounds.json` にプロンプトを、`recipes/` にレシピを
足します。

## カードの絵

キャラクターのポートレートなど、カードに載せる絵は後処理が違うので `card_art.py` を通します。

```bash
python generate.py castaway_man --prompts characters.json --out <dir> \
  --seed 7001 --width 832 --height 1280 \
  --workflow lane_background_sdxl.api.json --lora watercolor_sdxl.safetensors
python card_art.py <dir>/castaway_man_7001.png --out ../../src/assets/objects/character.png
```

カードの絵は 820×1280 で、枠の画像の上へそのまま重ねられます（`Card.ts`）。紙が占めるのは周囲
10px を空けた角丸（半径 64px）の内側だけなので、**そこからはみ出すと枠の縁を塗り潰してしまいます**。

`card_art.py` は 2 つを重ねて、切り口が線に見えないようにしています。

- **明るい画素ほど透かす**。生成された絵の白い余白がカードの紙地に置き換わり、絵と紙が地続きに
  なります。影や薄い塗りは半透明として残るので、輪郭を切り抜いたときのような硬さが出ません。
- **紙の縁の内側でだんだん薄くする**。ぼかしフィルタは使いません。**ぼかすとマスクが外側へも広がり、
  枠の縁まで絵が乗ってしまう**ためです。代わりに縁からの距離を測って内側で立ち上げるので、境界の
  外は必ず 0 になります。

## 環境

ComfyUI は Comfy Desktop 同梱のものを使います。**`standalone-env\python.exe` には torch が入って
いないので、`.venv` の方を使ってください。**

```
インストール先  %LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI
Python          <上記>\ComfyUI\.venv\Scripts\python.exe
起動            cd <上記>\ComfyUI && .venv\Scripts\python.exe main.py --port 8188
```

起動には 10 秒ほどかかります。`http://127.0.0.1:8188/system_stats` が 200 を返せば準備完了です。

`build.py` を動かす Python は、`postprocess.py` が numpy / scipy / Pillow を使うので、この `.venv`
のものを指定してください。

## 中身

| ファイル | 役割 |
|---|---|
| `build.py` | レシピ 1 つを読んで、生成と後処理を通す |
| `generate.py` | ワークフローへプロンプトを差し込んで `/prompt` へ投げ、PNG を取ってくる |
| `postprocess.py` | 油絵風 → 縦の切り出し → 横のシームレス化 |
| `workflows/lane_background.api.json` | API 形式のワークフロー（`$名前` がプレースホルダ）。既定 |
| `workflows/lane_background_sdxl.api.json` | SDXL 版。速いが作風が合わない（下記） |
| `prompts/lane_backgrounds.json` | 土地ごとのプロンプト |
| `recipes/*.json` | 出力 1 枚ぶんの、生成と後処理の設定 |

## 設計

### 左右は生成の時点で繋げる

`workflows/lane_background_sdxl_tiling.api.json` は、UNet と VAE の畳み込みのパディングを横方向だけ
circular にして生成します（`ComfyUI-seamless-tiling` の `SeamlessTile` / `CircularVAEDecode`）。
左右が最初から繋がるので、後処理で繋ぎ直す必要がありません。

以前はクロスフェードで繋いでいましたが、**両端の絵が重なって合成された跡が残る**うえ、のりしろの
ぶんだけタイルが狭くなっていました。

生成後に絵へ手を入れるときは、**横方向の端の扱いに気を付けてください。** oilify の移動平均を既定の
`reflect` のままにすると、端で折り返して継ぎ目だけ別の色になります（実測で継ぎ目が 0.9x から 3.4x へ
悪化しました）。縮小も同じ理由で、いったん横へ巻き付けてから縮めています。

### 生成は 2048×640、保持は 1024×320

生成サイズは SDXL が破綻しない範囲で決めます。これより平たくすると、横長すぎる画面に同じモチーフを
繰り返しがちになります（2048×512 で試すと、両端に岬、中央に入り江という構図になりました）。

保持サイズはそれとは別で、常駐量から決めます。レーンの背景は**起動時に全土地ぶんを読み込む**ので
（`BootScene.ts`）、1 枚の大きさが土地の数だけ効きます。画面上のレーン高は 1080p で 352px、4K で
704px なので（u ＝ 画面短辺 ÷ 1080、レーン高 352u）、1024×320 は 4K だと 2.2 倍に伸びて眠くなります。
背景は低コントラストで滲ませてあり、ここが最も損失の見えない場所なので、常駐量を優先しています。

### 中央に道が出るのを防ぐ

生成モデルは主題を中央へ置きたがるため、そのままだと**ほぼ必ず中央に道や開けた帯ができます**。
`prompts/lane_backgrounds.json` の `sharedNegative` に `path, trail, road, corridor, vanishing point,
central subject, symmetry` などを入れて抑えています。

アイテムレーン（`_item`）では、それでも「岩が上下を縁取って中央が道になる」構図が出ました。
**構図のあるシーンではなく一様なテクスチャを狙う**ようプロンプトを書き換える（`extreme close-up
macro texture` / `the same density everywhere` / `no composition`）と収まります。

### 油絵風にぼかす

生成直後の絵は背景にするには輪郭がはっきりしすぎていて、カードより目立ちます。GIMP の
Filters > Artistic > Oilify と同じ「窓の中で最も多い明度帯の色を採る」処理を `postprocess.py` に
実装しています。半径 3・12 段が既定です。

### 継ぎ目の検証

`postprocess.py` は仕上げたあと、**継ぎ目の段差が画像内部の平均的な段差の何倍か**を出します。
1 に近いほど内部と見分けが付きません。既存の画像は 0.79〜1.97 で、この範囲なら問題ありません。

## FluxとSDXLの使い分け

**既定は Flux（`lane_background.api.json`）です。** SDXL も試しましたが、レーンの背景には向きません
でした。同じプロンプト・同じ seed・同じ後処理で比べた結果です。

| | Flux dev fp8 + Watercolor | SDXL base + ghibli watercolor |
|---|---|---|
| 1枚の生成時間 | 30〜350秒（実行ごとに大きく振れる） | **8〜12秒** |
| 眺めの絵（`_fixture`） | 淡い水彩。カードより手前に出ない | 写実寄りの風景画。雲・山・木が描き込まれ、背景としては情報量が多い |
| 地面の絵（`_item`） | 一様な水彩のテクスチャ | **写真のような質感**。中央に帯状のムラが残り、並べると縞に見える |

**速さは SDXL の圧勝（20〜30倍）**ですが、`ghibli watercolor` LoRA は強度 0.8 でも 1.0 でも写実の
まま（トリガーワードは無く、強度だけが効く）で、油絵風の後処理を通しても絵の出自が残りました。
1.0 は構図もかえって崩れました。

既存の絵（`jungle_*` / `sandy_beach_*` / `hand`）が水彩の作風なので、そこへ揃えるなら Flux です。
作風を問わない用途や、構図の当たりを速く探したいときは SDXL が使えます。

```bash
python generate.py rocky_field_fixture --out <dir> --workflow lane_background_sdxl.api.json
```

レシピ側で使い分けるなら `"workflow": "lane_background_sdxl.api.json"` を足します。

## ライセンス

**ベースモデルと LoRA の両方を見る必要があります。**

| | ライセンス | 生成画像の商用利用 |
|---|---|---|
| SDXL 1.0 base | CreativeML Open RAIL++-M | 可（Attachment A の用途制限あり） |
| FLUX.1 [dev] | FLUX.1 [dev] Non-Commercial License | **不可**（別途 BFL の商用ライセンスが必要） |

LoRA ごとの許諾は `prompts/loras.json` の `commercial` に記録しています。Civitai の
`allowCommercialUse` で、**生成画像を配布・販売してよいかを表すのは `Image` だけ**です
（`Rent`/`RentCivit` は有料生成サービスで動かす権利、`Sell` はモデル自体を売る権利）。

手元の LoRA では **`ral-wtrclr-sdxl` と `oil painting` に `Image` がありません**。
`traditional_watercolor_painting` と `oil_and_watercolor_painting` は `Image` はありますが
**クレジット表記が要ります**。

記録はCivitaiが持つメタデータであって法的な判断ではないので、使う前にモデルページを確認してください。
ハッシュから引き直す手順はスキル（`.claude/skills/generate-image/`）に書いてあります。

## 再現性について

**同じ seed で同じ構図が出ますが、画素が完全に一致するとは限りません。** fp8 の Flux を GPU で
動かすため、実行ごとにわずかな数値差が出ます（検証時、継ぎ目の指標が 1.25 → 1.06 と動きました）。
絵として同じものが得られる、という意味での再現性です。

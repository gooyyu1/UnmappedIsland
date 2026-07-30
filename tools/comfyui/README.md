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
| `workflows/lane_background.api.json` | API 形式のワークフロー（`$名前` がプレースホルダ） |
| `prompts/lane_backgrounds.json` | 土地ごとのプロンプト |
| `recipes/*.json` | 出力 1 枚ぶんの、生成と後処理の設定 |

## 設計

### 大きめに生成して切り出す

仕上がりは 2048×512 ですが、**2560×640 で生成**します。

- **横の余り（512px）は捨てずに、継ぎ目の材料として使い切ります。** 出力の x 列と入力の
  x+2048 列は本来同じ絵になるべき位置なので、その 2 つをクロスフェードすると、右端の次に左端が
  自然に続きます。
- **縦の余り（128px）は要らない範囲を落とすのに使います。** 眺めの絵は上端が空だけになりがちなので、
  `top` で下げて岩と草の割合を増やします。

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

## 再現性について

**同じ seed で同じ構図が出ますが、画素が完全に一致するとは限りません。** fp8 の Flux を GPU で
動かすため、実行ごとにわずかな数値差が出ます（検証時、継ぎ目の指標が 1.25 → 1.06 と動きました）。
絵として同じものが得られる、という意味での再現性です。

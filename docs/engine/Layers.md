# 層の分け方（世界・映し・意匠・部品）

`src/` のコードがどの層に属し、何を知ってよいかを決めます。**新しいファイルをどこへ置くかは、
この4つのどれに答えるかで決まります。** 各機能の設計理由はそれぞれの設計文書にあり、本書は
置き場所と境界だけを扱います。

## 1. 4つの層

| 層 | 答えること | 知ってはいけないもの |
|---|---|---|
| **世界** | 何が在り、何が起きるか。**プレイヤーに見えていない土地・物も含む** | 画面のことば全部 |
| **映し** | 世界のうち、**プレイヤーに映っている分**。今の断面と、遅れて見せる変化 | Phaser・矩形・ミリ秒 |
| **意匠** | それを**どんな色・絵・寸法で**見せるか | 世界の状態 |
| **部品** | Phaserの表示物を**作る・持ち続ける・触らせる** | 世界の語彙（レシピ・スロット名・プロパティ名） |

**映し**は、世界を写した像です。行動のたびに作り直され、時間のかかる行動では tick ごとの断面として
控えられます（`RecordedView`）。「何が出ていて、その上の操作が何を意味するか」を答え、**描きません**。

**部品**が持ってよい状態は「**今見せているもの**」だけです。「次に何を見せるべきか」は映しが答えます。

## 2. 依存の向きと、層の外の「組み立て」

```
世界 ← 映し ← 組み立て → 部品
          ↘   意匠   ↙
```

意匠は映しからも部品からも参照されます（札の色は映しが選び、その色で描くのは部品）。

**組み立ては層ではありません。** `PlayScene`・各 `Scene`・各 `Window` がこれにあたり、**全部の層を
知ってよい唯一の場所**です。どの部品をどこへ置き、映しの答えを誰へ渡すかを決めます。層として並べると
一番上に太いものが乗っているように見えますが、上下ではなく結線です。

## 3. 迷ったときの判定

- **映しか意匠か**: 「何が出ているか」なら映し、「どう見せるか」なら意匠。カードがどのインスタンスを
  映しているかは映し、その枠を何色で描くかは意匠。
- **映しか部品か**: **座標・ミリ秒・Phaserの表示物を持つなら部品**。同じ振る舞いでも、判断だけを
  切り出せるなら映しへ置きます（例: 何がどこへ飛ぶかは `cardMotionPlan`、実際に毎フレーム寄せるのは
  `CardTable`）。
- **意匠か素材か**: 「どのファイルがどの絵か」は素材（`src/assets/`）。ゲーム画面の寸法・色は意匠。
  前者は codex ビューア（`src/codex/`）も使うので、ゲームの中に置きません。
- **世界か映しか**: 見えていない土地の状態を扱うなら世界。

## 4. 在処

| 層 | 主なファイル |
|---|---|
| 世界 | `src/domain/`（`loader/`・`locale/` が定義を読み、ことばを与える） |
| 映し | `src/game/PlayScreenView.ts`・`ShownCards.ts`・`ShownStatuses.ts`・`craftingActions.ts`・`recording.ts`・`statusRows.ts`・`statusChanges.ts`・`recipeList.ts`・`tickProgress.ts`、`src/game/ui/cardMotionPlan.ts` |
| 意匠 | `src/game/ui/theme.ts`・`rainStyle.ts`・`skyTint.ts`・`heatHaze.ts`・`durationText.ts`・`childWindow.ts`・`cardFlight.ts`、`src/game/layout/` |
| 素材 | `src/game/ui/objectArt.ts`・`backgroundArt.ts`・`iconArt.ts`・`locationArt.ts`・`characterArt.ts`・`weatherArt.ts`・`separatorArt.ts`・`informationArt.ts`、`src/assets/`（絵の実体） |
| 部品 | `src/game/ui/` の残り（`Card`・`CardLane`・`CardTable`・`CardDragController`・`StatusBar`・`ProgressBar`・`Button` ほか） |
| 組み立て | `src/game/PlayScene.ts`・各 `*Scene.ts`・`src/game/ui/*Window.ts` |
| （層の外） | `src/game/errorReport.ts`（横断の道具）・`src/save/`・`src/scenario/`・`src/util/` |

**ディレクトリは層に揃っていません**（`src/game/ui/` に映し・意匠・素材が混ざり、素材と
`worldCodexFiles.ts` は codex ビューアも使うのに `src/game/` に居ます）。揃える作業は未了です。

## 5. Phaser をやめるとどうなるか

**書き換えるのは部品と組み立てだけです。** 世界・映し・意匠・素材は、判断も語彙もそのまま残ります。

部品の中でも、規則を抱えているもの（掴んだと見なす閾値、点がカード本体か隙間か、押し続けの間隔）は
Phaser に依っていません。書き換えの前に映しへ寄せられる分がどれかは、そのときに見直します。

# 見つかったもの

判定は [`README.md`](./README.md) 参照。**A（一言が名前をなぞるだけ）は挙げない**——それが良い状態で、
見た460件のうち449件がAだった。

## B・C（10件）

**すべて修正済み**（打ち手の列が入った名前になっている）。

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/Slot.ts` | `addInternal` / `removeInternal` | B | 子の親リンクは触らず、枠の並びにだけ足す／外す | **何が "Internal" なのか**。呼び手が自分で親リンクを張らなければならないことを、名前が何も言っていない | `addWithoutParentLink` / `removeWithoutParentLink` |
| `domain/CellLayout.ts` | `liveStacks` | B | 空き枠を飛ばした、枠に居る束の並び | **"live" が何を指すか。** 死んだ束は無く、実際は「空き枠でない」の意味 | `stacksInFilledCells` |
| `domain/SameSlotSpawnSite.ts` | `SameSlotPlacement.kindRemains` | B | その枠に同じ型の物がまだ残っているか | 何の kind が何に remain するのか | `sameKindStillInCell` |
| `domain/generation/SitePlacer.ts` | `place` | B | 敷地（Site）を島の上に配る | **何を置くのか。** 呼び出し側の変数名（`const sites = place(...)`）だけが言っている | `placeSites` |
| `domain/generation/AxisSampler.ts` | `sample` | C | 各敷地に軸の値を書き込む（**戻り値なし＝引数を書き換える**） | 名前は「標本を採る」で、書き込むとは読めない。兄弟の `assignTypes` と同じ形の処理なのに名前が揃っていない | `assignAxisValues` |
| `domain/generation/LocationTypeMatcher.ts` | `matchNearest` / `pickNearest` | B | 前者は「上限で埋まった型を避けて選び、全滅したら上限を無視して選び直す」、後者は「1回ぶんの選択」 | **2つの違い**（上限を諦めるかどうか）が名前に出ていない | `nearestTypeAvoidingFull` / `nearestType` |
| `loader/RawPatch.ts` | `apply`（モジュール関数） | B | patch 1件を、読み込んだ宣言の集まりへ当てる | 何を何に当てるのか | `applyPatch` |

## 領域別の適用状況

`areas/` の明細に挙げた指摘は、判定を1件ずつコードで確かめたうえで**すべて適用済み**。

| 領域 | B | C | 状況 |
| ---- | -- | -- | ---- |
| [`areas/domain-doc.md`](./areas/domain-doc.md) | 64 | 22 | 適用済み |
| [`areas/game-ui.md`](./areas/game-ui.md) | 23 | 8 | 適用済み |
| [`areas/game-rest.md`](./areas/game-rest.md) | 66 | 7 | 適用済み |
| [`areas/analysis-codex.md`](./areas/analysis-codex.md) | 34 | 1 | 適用済み |

改名だけで済まなかったものは3件ある。

- `ConditionNode.slotGlobalId` は、slot_position と slot_content で**向きの違う2つの意味**を1つの
  フィールドが兼ねていた。`containerSlotGlobalId` / `ownedSlotGlobalId` へ分けた。
- `ShapeDefaults.shadowLayers` はタプル `[倍率, 不透明度]` の暗黙の位置規約だった。
  `ShadowLayer { offsetScale, alpha }` にした。
- `PlannedFlight.face` は常に `into` と同じ値だったので、`into` へ畳んだ。

改名に伴ってファイル名も変えたもの: `WeightSpec.ts` → `DeclaredNumber.ts`、
`EffectSite.ts` → `SameSlotSpawnSite.ts`、`LocalIndexMap.ts` → `LocalIndexByGlobalId.ts`、
`looks/durationText.ts` → `looks/timeTexts.ts`。

## 適用の過程で分かったこと

- `Location.paths` は**どこからも呼ばれていなかった**ので、改名ではなく削除した
  （`Path` の import も道連れで消えた）。

## 判定を保留したもの

| 現在地 | 名前 | 迷った点 |
| ------ | ---- | -------- |
| `domain/LocalIndexByGlobalId.ts` | `missing = -1` | 単独では述語に読めるが、使うのは `local === LocalIndexByGlobalId.missing` の形だけで、そこでは読める |
| `asset-pack/zip.ts` | `ZipEntry.method` | 圧縮方式の番号。ZIP仕様側の語なので、仕様に合わせるほうが読み手には近い |
| `loader/WorldCodexYamlLoader.ts` | `engine`（getter） | ローダの `engine` は漠然としているが、返すのは `EngineVocabulary` で型が言っている |
| `domain/WorldVocabulary.ts` | `destinationIdId` / `returnPathIdId` | `Id` が2つ続いて打ち間違いに見えるが、**クラス全体が `<プロパティ名>Id` という規約**（`hpId`・`travelMinutesId` …）で、`destination_id` というYAML側のプロパティ名がそのまま出ているだけ。ここだけ規約を外すと、どのプロパティのIDなのかが逆に読めなくなる。YAML側の名前も、**移動先のインスタンスIDを持つ**という中身と合っている |

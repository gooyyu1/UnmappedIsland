# 見つかったもの

判定は [`README.md`](./README.md) 参照。**A（一言が名前をなぞるだけ）は挙げない**——それが良い状態で、
見た460件のうち449件がAだった。

## B・C（11件）

| 現在地 | 名前 | 判定 | 一言で言うと | 名前から読み取れないこと | 案 |
| ------ | ---- | ---- | ------------ | ------------------------ | -- |
| `domain/Slot.ts` | `addInternal` / `removeInternal` | B | 子の親リンクは触らず、枠の並びにだけ足す／外す | **何が "Internal" なのか**。呼んでよいのが `WorldObject` だけなのは、名前ではなくクラスのコメントが言っている | `addWithoutLinking` / `removeWithoutUnlinking` |
| `domain/CellLayout.ts` | `liveStacks` | B | 空き枠を飛ばした、枠に居る束の並び | **"live" が何を指すか。** 死んだ束は無く、実際は「空き枠でない」の意味 | `stacksInFilledCells` |
| `domain/EffectSite.ts` | `SameSlotPlacement.kindRemains` | B | その枠に同じ型の物がまだ残っているか | 何の kind が何に remain するのか | `sameKindStillInCell` |
| `domain/generation/SitePlacer.ts` | `place` | B | 敷地（Site）を島の上に配る | **何を置くのか。** 呼び出し側の変数名（`const sites = place(...)`）だけが言っている | `placeSites` |
| `domain/generation/AxisSampler.ts` | `sample` | C | 各敷地に軸の値を書き込む（**戻り値なし＝引数を書き換える**） | 名前は「標本を採る」で、書き込むとは読めない。兄弟の `assignTypes` と同じ形の処理なのに名前が揃っていない | `assignAxisValues` |
| `domain/generation/LocationTypeMatcher.ts` | `matchNearest` / `pickNearest` | B | 前者は「上限で埋まった型を避けて選び、全滅したら上限を無視して選び直す」、後者は「1回ぶんの選択」 | **2つの違い**（上限を諦めるかどうか）が名前に出ていない | `nearestTypeAvoidingFull` / `nearestType` |
| `loader/RawPatch.ts` | `apply`（モジュール関数） | B | patch 1件を、読み込んだ宣言の集まりへ当てる | 何を何に当てるのか | `applyPatch` |
| `domain/WorldVocabulary.ts` | `destinationIdId` / `returnPathIdId` | B | `destination_id` というプロパティのグローバルID | **`Id` が2つ続く**のは打ち間違いに見える。実際は「`..._id` という名のプロパティ」の「ID」 | `destinationPropertyId` / `returnPathPropertyId` |

## 判定を保留したもの

| 現在地 | 名前 | 迷った点 |
| ------ | ---- | -------- |
| `domain/LocalIndexMap.ts` | `missing = -1` | 単独では述語に読めるが、使うのは `local === LocalIndexMap.missing` の形だけで、そこでは読める |
| `asset-pack/zip.ts` | `ZipEntry.method` | 圧縮方式の番号。ZIP仕様側の語なので、仕様に合わせるほうが読み手には近い |
| `loader/WorldCodexYamlLoader.ts` | `engine`（getter） | ローダの `engine` は漠然としているが、返すのは `EngineVocabulary` で型が言っている |

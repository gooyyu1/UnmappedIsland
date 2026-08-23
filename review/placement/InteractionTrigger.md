# 設計: 操作のきっかけを宣言し、`actions` と `combinations` を1つにする

**実施済み**（記録は [`Stage3.md`](./Stage3.md) 19節。設計から変えたところもそちらに書いた）。
[`PickAmong.md`](./PickAmong.md) 9節（手番を配る仕組み）から派生したが、**A-13 とは独立**
——A-13 をやらなくてもこれだけ入れられる。

## 1. 出発点: `showMenu` は原因を言っていない

`ActionDef.showMenu`（`'always' | 'never'`）は「画面のボタンに出すか」しか言っていない。ところが
その doc は「`never` は画面のボタンには出さない操作で、**起こすのは時間の側になる**」と書いている
——時間の側にそれを起こす仕組みは無く、`Animal` が名前で `turn` を引いている。**宣言と実装が
ずれている。**

「画面に出すか」は結果であって原因ではない。誰が起こすかを書けば出すかは決まる（`menu` だけが
出る）が、逆は決まらない。

## 2. エンジンは既に「操作は1種類」と言っている

`actions` と `combinations` を分けているのは**YAMLの節とパーサだけ**で、その先はもう1つになっている。

- `InteractionDef` が共通の基底で、`ActionDef` / `CombinationDef` は差分だけを持つ。
- ロケールは `interactions:` の1つの名前空間（`Localization.interaction`）。
- **`ObjectDef` のコンストラクタが名前の衝突をエラーにしている。** コメントはこう書いている
  ——「操作の名前は1つの名前空間（actionsとcombinationsを名前で引くのは同じ問い）」。
  節が2つあるせいで**わざわざ書いている検査**で、統合すれば検査ごと消える。
- 読み上げの `InteractionTriggerReading` も既に1つの union（`menu | drag`）。

## 3. 分けている差は3つで、全部きっかけのパラメータに畳める

| 差 | 今 | 統合後 |
| -- | -- | -- |
| `subject: dragged` を書けるか | 節が `ReferenceScope` を選ぶ | きっかけが選ぶ（`drag` のときだけ dragged が居る） |
| 相手の型（`with`） | combinations 専用の兄弟キー | きっかけの中 |
| ドロップ時に起動する動詞探し | `combinationsWith` が combinations だけ見る | きっかけが `drag` のものだけ見る |
| まとめて重ねてよいか（`allow_multiple`） | combinations 専用の兄弟キー | きっかけの中 |

## 4. YAML の形

```yaml
interactions:
  explore:
    trigger: menu
    duration: 30
    spawn: {object: thick_branch}

  turn:
    trigger: tick
    pick: [...]

  strike:
    trigger: {drag: {tag: weapon}, allow_multiple: true}
    duration: 15
    pick: [...]
```

**`trigger` はスカラか map。** 同じ形の前例がある——`weight`・`duration` は `30` とも
`{prop: sharpness}` とも書ける（`WeightSpec`）。

**`with` と `allow_multiple` を `trigger` の中へ入れる。** 節を1つにすると兄弟キーの検査が緩む
（`ACTION_RESERVED_KEYS` と `COMBINATION_RESERVED_KEYS` が1つになるので、`menu` の操作に
`allow_multiple` を書いても素通りする）。きっかけの中に入れれば**構造で弾ける**——
「`drag` のときだけ必須」「`drag` のときだけ書ける」という条件付きの検査を書かずに済む。

**`trigger` は必須にする。** 節が無くなるので、書かない操作は「何で起きるか分からない操作」になる。
同梱の世界は13箇所で `showMenu: always` を明示しているので、実コストはほぼ無い。

## 5. 実行時のクラスは分けたまま

`Interaction` の具象（`Action` / `Combination`）は統合しない。**引いた時点で相手が決まっている**対で、
`Combination` は dragged が必ず居ることを型引数で保証している。ここを1つにすると
「dragged が居るかもしれない」を実行時に見る形へ戻る。

統合するのは**宣言の書き方**。`ObjectDef` は1つのリストで持ち、`actionsFor` は
`trigger` が `menu` のもの、`combinationsWith` は `drag` のものを絞る。

## 6. 3つ目のきっかけ（名前で呼ばれたときだけ）

今の `showMenu: never` は「一覧に出ない」しか言っていないので、`tick` を作ると2つに割れる。

| | 一覧に出る | 自分から起きる |
| -- | -- | -- |
| `menu` | ○ | プレイヤーが押したとき |
| `tick` | × | 時間が経ったとき |
| `drag` | ×（相手が要る） | 札を重ねたとき |
| （3つ目） | × | **起きない。** 他の宣言が名前で呼んだときだけ |

**今は作らない。** 呼ぶ仕組み（効果の中から別の操作を名前で呼ぶ動詞）がまだ無いので、値だけ先に
作ると**誰にも呼ばれない操作**——ロードは通り、画面にも出ず、永久に起きない宣言——を書けてしまう。

後から足すのは安全:

- `InteractionTriggerReading` は閉じた union で、読み手は網羅で書いている。値を1つ足すと、
  実装していない読み手はコンパイルが止まる（読み上げ口と同じ守り方）。
- YAML は受け付ける値が増えるだけなので、既存の世界もMODも壊れない。
- 「`menu` かつ `tick`」が要るようになったら、スカラかリストかを許す形へ広げられる
  （`destroy` に前例——`parseActiveEffects` が「単一の対象か対象のリスト」を許容している）。

## 7. 規模

- 同梱YAML: `actions:` 29箇所・`combinations:` 26箇所（12ファイル）。節名の付け替えと
  `showMenu` → `trigger`、`with`/`allow_multiple` の移動。機械的。
- テスト: `actions:` を書くフィクスチャ18ファイル、`combinations:` 13ファイル。
- パッチで `actions.`／`combinations.` のパスを指している宣言は**同梱には無い**。
- `src`: `ActionDef` / `CombinationDef` / `parseActionsAndCombinations` / `RawDeclarationBody` の
  trait 合成（2つの節が1つに）／`ObjectDef`（名前衝突の検査が消える）／
  `cardOperations` のボタン絞り込み1行／codex-viewer が2つの節に分けて出している所
  （`pages.ts`、きっかけで分けるか1つにするかを決める）。
- docs: `GameElementDefinition.md` 11節・12節を1つに、`ActionSystem.md`、`Localization.md`（既に
  `interactions`）。

## 8. 順序

**`trigger` の導入と節の統合は1つの作業にする。** `trigger: menu | tick` だけ先に入れて節を残すと、
「きっかけ」を言う場所が節と `trigger` の2箇所になり、`drag` だけ節が言う、という半端な状態が残る。

A-13（`among`）とは独立。どちらが先でもよいが、A-13 をやるなら
[`PickAmong.md`](./PickAmong.md) 9節（手番を配る仕組みを `WorldObject` へ）はこれに依存する
——`tick` のきっかけが無いと、エンジンが `turn` という世界の語彙を知ることになる。

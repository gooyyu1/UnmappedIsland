# アクションシステム設計

## 概要

プレイヤーがカードに対して行う操作が、実行時にどう実装されているかを記述する設計ドキュメントです。
YAML上の文法そのものは [`GameElementDefinition.md`](./GameElementDefinition.md)（`actions` は 11 節、
`combinations` は 12 節、`active` は 9 節、`pick` は 10 節、`conditions` は 14 節）を参照してください。

## 1. 2つの入口: actions と combinations

プレイヤー操作の入口は2種類だけで、どちらも `object_def` に宣言的に定義される。

- **`actions`（メニュー型、`Domain.Defs.ActionDef`）**: 1枚のカード（`self`）だけで完結する操作。
  カード選択時にボタンとして表示され、クリックで実行される。`actor`（プレイヤーキャラクター）は
  常に暗黙的に参加する。
- **`combinations`（ドラッグ型、`Domain.Defs.CombinationDef`）**: カードを別のカードへ
  ドラッグ＆ドロップする操作。**ドロップされた側（受け側）** の `object_def` に定義され、
  `with`（タグのグローバルID）がドラッグされてきたカードとのマッチング条件になる。
  対称的な組み合わせは両側のカードに定義する（12.3節）。

実行時の入口は `Runtime.WorldObject` の3メソッド。

- `TryExecuteAction(actionName, actor, session)`
- `TryExecuteCombination(dragged, actor, combinationName, session)`
- `FindMatchingCombinations(dragged)` — ドラッグ中のハイライト等のために、`with` にマッチする
  `combinations` を宣言順に列挙する。複数マッチした場合にどれを実行するかの解決はUI層に委ねる（5節）。

いずれも実行前に `ResolveInteractionTarget()` で **代表（`represented_by`）** を解決する:
代表スロットを持つカード（液体容器など）への操作は、そのスロットの中身（代表チェーンの末端）へ
リダイレクトされる。`self` と `dragged` の両方が対象。

## 2. 実行パイプライン

`TryExecute` は次の順に進み、途中で失敗すると `false` を返して何も適用しない。

1. `with` マッチング（combinations のみ）: `dragged` の `ObjectDef.Tags` に `with` タグが含まれるか。
2. `conditions` 評価（3節）: 省略時は常に真。
3. `duration` の解決: 参照 `duration` は適用前の `self`（combinations では `dragged` も）から読む
   必要があるため、効果適用の前に分数だけ確定させる。
4. 効果の適用: `self.ApplyActiveEffect(effect, session, actor, dragged)`（4節）。
5. 時間進行（6節）: 効果適用の後に進める（先に進めると、tick 中の destroy 等が
   `self` を破棄してから効果を適用する事故になる）。

## 3. 実行可能条件（conditions）

`Domain.Defs.ConditionNode` の木。葉は4種、複合は `all` / `any` / `not` の3種で、
actions/combinations の一度きりの判定と、passives（8節）の持続的なゲートが同じ木を共用する。

| 葉 | 形 | 判定 |
| --- | --- | --- |
| Property | `{object, prop, op, value}` | 参照先プロパティの**実効値**（modify・inherit込み）との比較 |
| SlotPosition | `{object, in_slot}` | object が今、親のそのスロットに入っているか（外から見た位置） |
| SlotContent | `{object, slot, tag}` | object 自身のスロットの中に、タグを持つ子が1つでもあるか（内側の中身） |
| ObjectTag | `{object, tag}` | object 自身がタグを持つか |

`value` はリテラル・配列（`in`/`not_in`）・`{object, prop}` 参照の三択。参照先が解決できない場合
（親が無い等）、その葉は偽になる。

## 4. 条件・効果から参照できるオブジェクト

`conditions` の `object`、効果の対象キー、`{object, prop}` 参照はすべて共通の起点
`Domain.Defs.ReferenceRoot` を使う。`self.prop` のような1階層の参照のみで、パス連結はない。

| 起点 | 解決先 | 使える文脈 |
| --- | --- | --- |
| `self` | 操作対象のカード自身 | すべて |
| `parent` | self の直接の親 | すべて |
| `actor` | プレイヤーキャラクター | actions / combinations（rangeイベントには存在しない） |
| `dragged` | ドラッグされてきたカード | combinations のみ |
| `dragged_parent` | dragged の直接の親 | combinations のみ（液体容器の中身→容器参照） |
| `ancestor` | self の親から遡り、参照プロパティを定義する最初の祖先 | プロパティ参照のみ（位置判定では不可） |

`world` は起点として未対応（ロード時エラー）。すべてのオブジェクトは world の下にぶら下がるため、
world 固有プロパティの参照は `ancestor` で代替できる。`child` は passives の target 専用で、
この文脈では使えない。**解決できない対象への適用は、その命令だけ無視される**（実行全体は失敗しない）。

## 5. 効果（ActiveEffect）

効果はポリモーフィックな `Domain.Defs.ActiveEffect` で、3形態を再帰的に組み合わせる。

- **単一命令**: `set` / `add` / `destroy` / `spawn` / `transfer` / `move`（9節）。
- **宣言順合成（`ActiveEffects`）**: パーサが set → add → transfer → destroy → spawn の順に並べる
  （同一プロパティへの set 後の add、destroy で空いた位置への spawn という依存関係のため）。
- **`pick`（`PickEffect`、10節）**: `weight`（リテラルかプロパティ参照）による重み付き抽選で
  1候補を選んで適用する。候補の効果も `ActiveEffect` なので、pick のネストができる。

設計上の要点:

- `set`/`add` の値・`pick` の `weight` は「リテラルか `{object, prop}` 参照か」の二択で統一されている。
- `spawn` の配置先は `same_slot`（既定）/ `self` / `actor`。`same_slot` は、適用の入口で捕捉した
  「self が占めていた位置」のスナップショット（`WorldObject.EffectSite`）を使い、destroy で self が
  消えた後でもその位置を引き継げる。配置に失敗した場合は起点の親へ伝播し、accepts/capacity を
  無視して強制配置する（オブジェクトは必ずどこかに属す必要があるため）。
- `transfer`（9.5節）は「出せる量」と（`allow_overflow: false` なら）「受け取れる量」で実移動量を決め、
  `linked_add` を実移動量に比例スケールして適用する。
- `move` は、`self` のプロパティ（`to_prop`）が保持する **インスタンスID** のオブジェクトの中へ
  `actor` を移動する。移動先が定義時点で決まらず生成時に確定する（道の移動アクション）ため、
  `object_def` 参照ではなくインスタンスIDで指す。
- プロパティの rangeイベント（`on_min`/`on_max`/`on_overflow`/`on_shortfall`、6節）も**同じ**
  `ActiveEffect` と適用経路（`WorldObject.ApplyActiveEffect`）を使う。その文脈では
  actor/dragged が null で、対象は `self` のみ（ロード時に強制）。

## 6. 時間の経過（duration）

- `actions`/`combinations` の `duration` はゲーム内の**分**。リテラルか `{object, prop}` 参照
  （`weight` と同じ二択。`combinations` では `dragged` も指せる）で、省略時は時間を消費しない。
- 時間進行は `ActionDef`/`CombinationDef` の `TryExecute` 自身が `WorldSession.AdvanceWorldTime(minutes)`
  を呼んで完結させる。呼び出し側（UI層）が実行後に別途時間を進める必要はない。
- `AdvanceWorldTime` は分を進めながら、tick 境界（world の `minutes_per_tick` プロパティ、
  現状15分）を跨ぐたびに world ツリー全体の `Tick()` を1回実行する。長い `duration` の action は、
  その間の accumulate・rangeイベントをすべて経験する。
- `World` を持たないセッション（時間の概念が無い単体テスト等）では時間進行をスキップする。

## 7. 未決事項・今後の検討課題

- 同じオブジェクト内で複数のキーが同じ `with` にマッチした場合の解決規則
  （現状は `FindMatchingCombinations` が宣言順に列挙し、選択はUI層に委ねている）
- `combinations` を、`actor` の装備スロットを経由したパス参照（例: `actor.equip.tool`）を使う
  `actions` の条件・効果として書き換えられないか
- `with` で複数タグのAND条件を指定する必要があるか
- 対称的な組み合わせ（12.3節）で両側に同じ内容を書く冗長さの軽減
- `showMenu` の値が `always` 以外に増える場合の用途・記法
- ドラッグ中のハイライトで全カードの `conditions` を評価するコストの抑制

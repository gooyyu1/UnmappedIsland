# アクションシステム設計

## 概要

プレイヤーがカードに対して行う操作が、実行時にどう実装されているかを記述する設計ドキュメントです。
YAML上の文法そのものは [`GameElementDefinition.md`](./GameElementDefinition.md)（`actions` は 11 節、
`combinations` は 12 節、`active` は 9 節、`pick` は 10 節、`conditions` は 14 節）、操作の画面側の
入口（アクションの行・ドラッグ＆ドロップ）は [`../ui/Windows.md`](../ui/Windows.md) 4 節・
[`../ui/CardInteraction.md`](../ui/CardInteraction.md) が扱います。

**入口は2種でも、実行は1本です。** メニュー型（`actions`）とドラッグ型（`combinations`）は
「どう選ばれるか」だけが違い、どちらも `InteractionDef` を基底として、同じ実行パイプライン
（マッチング → `conditions` → `duration` の解決 → 時間進行 → 生存確認 → 効果の適用、2 節）を通ります。
実行前には代表（`represented_by`）の解決が入り、起きたことは分岐名ではなく世界に起きた変化として
観測します（7 節）。操作専用の新しい文法はありません。

実装は `src/domain/defs/InteractionDef.ts`（`ActionDef`・`CombinationDef` の基底）と
`src/domain/runtime/WorldObject.ts`・`WorldSession.ts`、検証は `tests/domain/interaction.test.ts`・
`actionDuration.test.ts`・`worldChanges.test.ts` です。本書は実装済みの仕組みの記述で、
未決事項は 8 節に整理しています。

## 1. 2つの入口: actions と combinations

プレイヤー操作の入口は2種類だけで、どちらも `object_def` に宣言的に定義される。

- **`actions`（メニュー型、`Domain.Defs.ActionDef`）**: 1枚のカード（`self`）だけで完結する操作。
  カード選択時にボタンとして表示され、クリックで実行される。`actor`（プレイヤーキャラクター）は
  常に暗黙的に参加する。
- **`combinations`（ドラッグ型、`Domain.Defs.CombinationDef`）**: カードを別のカードへ
  ドラッグ＆ドロップする操作。組み合わせを宣言している側が `self`、相手が `dragged` で、
  `with`（タグのグローバルID）が `dragged` とのマッチング条件になる。宣言は**素材の側**に1つだけ置き
  （12.3節）、どちらの札をどちらへ運んでも同じ宣言が実行される——**どちらを `self` として試すかの順序は
  UI層が決める**（[`../ui/CardInteraction.md`](../ui/CardInteraction.md) 2 節）。

2種が違うのは**入口（どう選ばれるか）だけ**なので、どちらも `Domain.Defs.InteractionDef` を継承し、
選ばれた後の実行（2節）と所要時間の解決はその基底クラスが1箇所で持つ。派生が足すのは、
`ActionDef` が `showMenu`、`CombinationDef` が `with` によるマッチングだけ。`dragged` はドラッグ型
だけが持つ相手で、メニュー型では `undefined` のまま同じ経路を通る。

実行時の入口は `Runtime.WorldObject` の3メソッド。

- `TryExecuteAction(actionName, actor, session)`
- `TryExecuteCombination(dragged, actor, combinationName, session)`
- `FindMatchingCombinations(dragged)` — ドラッグ中のハイライト等のために、`with` にマッチする
  `combinations` を宣言順に列挙する。**どちらの札を `self` として引くか**（落とされた側が先、次に掴んだ側）と、
  複数マッチした場合にどれを実行するかの解決はUI層に委ねる
  （[`../ui/CardInteraction.md`](../ui/CardInteraction.md) 2 節、`PlayScreenView.combinationOf`）。

いずれも実行前に `ResolveInteractionTarget()` で **代表（`represented_by`）** を解決する:
代表スロットを持つカード（液体容器など）への操作は、そのスロットの中身（代表チェーンの末端）へ
リダイレクトされる。`self` と `dragged` の両方が対象。

## 2. 実行パイプライン

実行は次の順に進み、途中で失敗すると `false` を返して何も適用しない。順序に意味があるため、
実装は `InteractionDef` に1つだけ置く（`with` マッチングだけは `CombinationDef` が先に見る）。

1. `with` マッチング（combinations のみ）: `dragged` の `ObjectDef.Tags` に `with` タグが含まれるか。
2. `conditions` 評価（3節）: 省略時は常に真。
3. `duration` の解決: 「今の `self`（combinations では `dragged` も）の状態から見て、どれだけかかるか」
   なので、時間を進める前に分数だけ確定させる（切れ味の悪い刃物ほど時間がかかる、が書けるように）。
4. 時間進行（6節）: **効果の適用より先**に進める。行動してから結果が出る順序であり、作ったもの・
   見つけたものが自分の制作時間・探索時間ぶんの tick を浴びずに済む。
5. 関与オブジェクトの生存確認（6節）: 経過中に失われていたら、その行動は成立しなかったものとして
   `false` を返し、効果を適用せずに終える。
6. 効果の適用: `self.ApplyActiveEffect(effect, session, actor, dragged)`（4節）。

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
| `dragged` | 組み合わせる相手のカード | combinations のみ |
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
- プロパティの rangeイベント（`on_overflow`/`on_shortfall`、6.3節）も**同じ**
  `ActiveEffect` と適用経路（`WorldObject.ApplyActiveEffect`）を使う。その文脈では
  actor/dragged が null で、対象は `self` のみ（ロード時に強制）。

## 6. 時間の経過（duration）

- `actions`/`combinations` の `duration` はゲーム内の**分**。リテラルか `{object, prop}` 参照
  （`weight` と同じ二択。`combinations` では `dragged` も指せる）で、省略時は時間を消費しない。
- 時間進行は `InteractionDef` 自身が `WorldSession.AdvanceWorldTime(minutes)` を呼んで完結させる。
  呼び出し側（UI層）が実行後に別途時間を進める必要はない。解決した分数は実行前にも引ける
  （`MinutesFor`。UI層が実行前に所要時間を見せるため、[`CardInteraction.md`](../ui/CardInteraction.md) 2 節）。
- `AdvanceWorldTime` は分を進めながら、tick 境界（world の `minutes_per_tick` プロパティ、
  現状15分）を跨ぐたびに world ツリー全体の `Tick()` を1回実行する。長い `duration` の action は、
  その間の `add`・rangeイベントをすべて経験する。
- `World` を持たないセッション（時間の概念が無い単体テスト等）では時間進行をスキップする。

### 6.1 経過中に関与オブジェクトが失われた場合

時間を効果より先に進めるため、経過中の tick が `self`/`dragged`/`actor` を破棄しうる（使っていた道具が
行動の途中で壊れる）。破棄は「親スロットから切り離す」ことなので（`GameElementDefinition.md` 9.3節）
そのまま効果を適用しても例外にはならないが、`same_slot` の `spawn` が置き場所を失うなどして**黙って
何も起きない**結果になる。追跡できない失敗になるため、**関与オブジェクトが1つでも世界から失われて
いたら、その行動は成立しなかったものとして `false` を返し、効果を適用しない**（`spendDuration`）。

- 見るのは「経過前に世界に居たのに、経過後は居ない」ものだけ。もともと世界の木に繋がっていない
  オブジェクトは、失われたわけではないので対象にしない。
- **時間は既に経過している。** 1時間かけて道具が壊れ、何も得られなかった、という結果になる。
- 打ち切るのは失われた場合だけで、`conditions` の再判定は行わない。長い行動ほど「なぜか失敗する」が
  増えて予測できなくなるため。

## 7. 起きたことの観測

効果を適用した結果として世界に何が起きたかを、外から観測できます（`WorldSession.observeChanges`）。
UI が演出のために「誰が何をしたか」を要る（[`HuntingSystem.md`](./HuntingSystem.md) 6 節）ためのもので、
`observeTicks` と同じく**観測の解除も観測口が受け持ちます**（呼び出し側に外し忘れの余地を残さない）。

### 7.1 観測するのは物の出入りだけ

| 変化 | 観測の仕方 | なぜ |
|---|---|---|
| 物の出入り（生まれた・移った・世界から出た） | **1件ずつのログ**（`WorldChange`） | 前後の比較では、移動元と「誰の仕業か」が失われる |
| 値の増減 | **前後の比較**（`statusChangesBetween`） | 実効値は誰も書かないまま動くので、書き込みを記録しても現れない |
| 形の変わらない出来事（空振り） | **起こした側が告げる**（`signal`、7.4 節） | 世界を読み直しても現れない |

**値をログに寄せられないのは実効値の定義そのものが理由です。** 画面に出るのは `modify`・`inherit` を
加味した値（[`GameElementDefinition.md`](./GameElementDefinition.md) 8.3 節）で、包帯を当てると痛みは
下がりますが、痛みの実体値は 0 のままで、押し上げていた寄与が減るだけです。

逆に出入りの側は前後の比較では足りません。同じ tick に 2 匹が暴れれば「どちらが壊したか」は差分から
決められず、持ち去られた物は画面から消えるだけで壊された物と同じ形に見えます。

### 7.2 記録するのは配置の関門

出入りを記録するのは**配置を行う関門そのもの**（`attachToSlot`・`destroy`）です。呼び出し側が「動かしたら
記録する」手順を覚える形は採りません——覚える側が増えるほど、記録し忘れた経路ができます。

移動前の居場所は切り離す前に控えます。切り離した後では、どこから来たのかを誰も知りません。

### 7.3 主体は `applyActiveEffect` が決める

1 件の変化には、それを起こした効果を宣言していたオブジェクト（`self`）が主体として付きます。境界は
効果適用の入口（4 節・`applyActiveEffect`）で、**その中で起きた出入りはすべて同じ主体になります。**

- **`pick` のどの候補が選ばれたかによらず 1 つに決まります。** 観測する側は分岐を知らずに「このオブジェクトが
  何をしたか」を読めるので、候補を足しても観測する側は変わりません
- 入れ子は内側が勝ちます。効果の適用中に別のオブジェクトの range イベントが走れば、そこで起きた変化は
  そのオブジェクトのものになります（治りきった怪我が自分を消すのは、殴った側の仕業ではありません）
- プレイヤーの操作が直にワールドを動かした場合（カードのドラッグ、シナリオの開始状態）は主体を持ちません。
  世界の側に主体が居ないという意味で、そのときは UI 自身が起点だと知っています

### 7.4 形の変わらない出来事は、起こした側が告げる

**世界の形が変わらない出来事は、`signal`（[`GameElementDefinition.md`](./GameElementDefinition.md) 9.8 節）で
宣言された分だけが観測できます**（`WorldSession.observeSignals`）。空振り・回避は「何も起きなかった」のでは
なく「外したことが起きた」ので、世界を読み直しても現れない以上、起こした側が告げる以外に伝える道がありません。

**告げる語彙を持っても、7.1 節の分担は変わりません。** 観測できる出来事はワールドの著者が `signal` として
書いた分だけで、エンジンが `pick` の分岐名を横流しするわけではありません——候補を足しても、その候補が
何も告げなければ観測する側には何も増えません。

出入り（`WorldChange`）とは別の観測口にします。片方は世界の形が変わったこと、もう片方は変わらないままの
出来事で、同じログに混ぜると受け取る側が毎回どちらかを選り分けることになります。

**誰の身に起きたかは、主体（7.3 節）ではなく効果が指した対象です**（`WorldSignal.object`）。出入りは
「動いた物」と「動かした者」の 2 つを要しますが、告げられた出来事はどこから見ても 1 つの札の上のこと
でしかありません——殴って外した出来事は、殴った側ではなく殴られた側に起きています。

## 8. 未決事項・今後の検討課題

- 同じオブジェクト内で複数のキーが同じ `with` にマッチした場合の解決規則
  （現状は `FindMatchingCombinations` が宣言順に列挙し、選択はUI層に委ねている）
- `combinations` を、`actor` の装備スロットを経由したパス参照（例: `actor.equip.tool`）を使う
  `actions` の条件・効果として書き換えられないか
- `with` で複数タグのAND条件を指定する必要があるか
- `showMenu` の値が `always` 以外に増える場合の用途・記法
- ドラッグ中のハイライトで全カードの `conditions` を評価するコストの抑制

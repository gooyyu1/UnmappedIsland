# 生命と意識のシステム設計

## 概要

**何が意識を奪い、何が命を奪うか**——気絶する・死ぬをどう表すかを決めるドキュメントです。怪我という
オブジェクトそのものの構造は [`InjurySystem.md`](./InjurySystem.md)、動物と対峙する局面は
[`HuntingSystem.md`](./HuntingSystem.md)、飢え・渇きの値の刻み方は
[`Characters.md`](../world/Characters.md)、ステータスの見せ方は [`StatusArea.md`](../ui/StatusArea.md) が
扱います。本書が決めるのは、それらが合流する先である**2つのプロパティと、その底に着いたときに何が
起きるか**だけです。

**新設する文法はありません。** 導入する語彙は次の2つのプロパティと、固定する2つの段の名前だけで、
残りは既存の仕組み——`modify`（可逆な寄与）・`accumulate`（不可逆な削り）・`conditions` の `in_stage`・
`on_shortfall`（下限を割った瞬間の効果）——にそのまま載ります。

| 語彙 | 何を表すか |
| --- | --- |
| `consciousness`（意識） | 起きていて動けるか。押し下げられる**実効値**（2 節） |
| `vitality`（生命力） | 死までの余地。削られる**実体値**（3 節） |
| 段 `unconscious` | ここに落ちたら手番が回らない。名前を固定する（6 節） |
| 段 `dying` | 瀕死。致命的域（`fatal`）を持つ唯一の段 |

定義の置き場所は `player_character` trait（キャラクタ共通の props）と `animal` trait、削る側は
`public/world-codex/injuries.yaml` の各傷、読む側は `PlayScene`（気絶した間の操作）と動物の1手を
与える側です。**本ドキュメントは検討結果であり、全節が未実装です**（実装済みなのは、ここへ合流する
手前の `pain` と `severity` だけ）。未決事項は末尾に整理しています。

## 1. 意識と生命力は分ける

**気絶するかを決める値と、死ぬかを決める値は、別のプロパティにします。**

決め手は**痛みです。痛みは意識を奪いますが、命は奪いません。** 1本の値に統一すると、激痛で意識を落とす
経路がそのまま命を削ることになり、「傷は浅いが激痛で倒れた」が書けなくなります。分けておけば、原因ごとに
宛先を選べます——痛みは意識へ、出血は命へ、頭部への一撃は両方へ。

分かれ目はエンジンの機構そのものでもあります。2つは**別の仕組みに載ります**。

| | `consciousness`（意識） | `vitality`（生命力） |
| --- | --- | --- |
| 値の性質 | **実効値**（自分では動かない。`pain`・`load` の仲間） | **実体値**（不可逆に削られる。`severity` の仲間） |
| 動かすもの | 痛み・失血・頭部の傷が `modify` で押し下げる | 傷が `accumulate` で削る |
| 元に戻るか | **原因が消えれば自動で戻る**（気絶からの回復に後始末が要らない） | 戻らない。傷が癒えて初めて削る力が止む |
| 底に着いたら | 段 `unconscious` を**読む側**が手番を飛ばす（6 節） | `on_shortfall` が **死**を起こす（3 節） |

**統一が成り立たないのはここです。** `on_overflow`/`on_shortfall` は実体値の書き込みでしか発火しません
（`PropertyValue.add` が `checkRangeEvents` を呼ぶ経路だけ）。意識のように `modify` だけで決まる値は、
いくら0になっても range イベントを起こせないため、統一値にすると死を起こす主体が世界の側に居なくなり、
毎 tick 見張る側が要ります。逆に実体値1本へ統一すると、今度は気絶からの復帰を誰かが書き戻すことになり、
[`HuntingSystem.md`](./HuntingSystem.md) 6 節が「値は効果の入力であって通知路ではない」として避けた形に
戻ります。

## 2. 意識は押し下げられる実効値

**`consciousness` は自分では動きません。** 初期値は満たした状態（100）で、痛み・失血・頭部の傷が
`modify` で押し下げます。原因が消えれば寄与も消えるので、**気絶から覚めるのに回復処理は要りません**。

```yaml
consciousness:
  tags: [status, health]
  value: 100
  range: {min: 0, max: 100}
  stages:
    - {name: unconscious, alert: danger}
    - {name: dazed, min: 25, alert: caution}
    - {name: foggy, min: 60, alert: watch}
    - {name: clear, min: 80}
```

- 段の刻みは [`Characters.md`](../world/Characters.md) の規約に従い、**安全域を外れるのは `max` の80%**。
- **致命的域（`fatal`）は持ちません。** 気絶それ自体は死に至らず、死に至らせるのは命を削っている側です。
  致命的域を持つのは `vitality` の `dying` だけにします（3 節）。
- **`pain` と同じく個体差を持たせません**（`player_character` trait が配る）。押し下げる量は傷の側が
  宣言するので、同じ傷が誰に刺さっても同じ意味を持つ必要があります。

押し下げは**段ごとのブロック**で書きます（[`GameElementDefinition.md`](./GameElementDefinition.md)
8.5節）。`in_stage` は排他なので（同じ値が2つの段に該当することはない）、階段が素直に並びます。

```yaml
passives:
  # 痛みで朦朧とする。痛みだけでは気絶しない配分に留める。
  - conditions: [{prop: pain, in_stage: hurting}]
    modify: {self: {consciousness: -20}}
  - conditions: [{prop: pain, in_stage: unbearable}]
    modify: {self: {consciousness: -45}}
  # 失血。命を削られていること自体が意識を奪う。
  - conditions: [{prop: vitality, in_stage: weakened}]
    modify: {self: {consciousness: -30}}
  - conditions: [{prop: vitality, in_stage: dying}]
    modify: {self: {consciousness: -70}}
```

**痛みだけでは気絶させません。** 痛みが最も深い段でも意識は朦朧（`dazed`）に留め、そこへ失血か頭部の
一撃が重なって初めて落ちる、という配分にします。痛みで気絶できてしまうと、手当てを怠っただけで
行動不能になり、2 節の「意識は原因が消えれば戻る」が「痛みが引くまで何もできない」に変わります。

**意識が他の値を押し返す向きには書けません。**「意識が薄いほど痛みを感じない」は、`pain` の
`modify` のゲートが `consciousness` を読み、その `consciousness` が `pain` から決まる循環になり、実行時に
例外が飛びます（同 14.1節）。

## 3. 生命力は削られる実体値で、尽きたら死ぬ

**`vitality` は削られたら戻らない実体値**で、下限を割った瞬間に死にます。形は怪我の `severity` と
同じ——`range.min` を 1 に置き、`on_shortfall` で自分を消します
（[`InjurySystem.md`](./InjurySystem.md) 1 節）。

```yaml
vitality:
  tags: [status, health]
  value: 100
  range: {min: 1, max: 100}
  stages:
    - {name: dying, alert: fatal}
    - {name: failing, min: 5, alert: danger}
    - {name: weakened, min: 20, alert: caution}
    - {name: hurt, min: 60, alert: watch}
    - {name: hale, min: 80}
  on_shortfall:
    destroy: self
```

- **`max` は100に固定します**（個体差も持たせません）。傷が削る量をそのまま「1 tick で何%持っていくか」
  として読めるようにするためで、体格や頑丈さの差は傷の負いにくさ・治りの速さの側で表します。
- **自然な回復は `accumulate` の綱引きで表します。** 本人が `+1/tick` で戻し、傷が `-N/tick` で削る。
  出血が回復を上回っている間だけ死へ向かい、止血すれば戻り始めます——専用の「出血中フラグ」は要りません。
- 死体は**同じ枠での置き換え**で出します。`destroy` は `spawn` より先に実行されるので、動物は自分が
  居た枠がそのまま死体のカードに変わります（[`GameElementDefinition.md`](./GameElementDefinition.md) 9.4節）。

```yaml
# 動物側。倒れた個体は、その枠のまま死体のカードになる。
on_shortfall:
  spawn: {object: monkey_carcass}
  destroy: self
```

## 4. 出血は値ではなく、命を削る速さ

**出血に専用のプロパティを作りません。** 出血する傷とは「宿主の `vitality` を毎 tick 削る傷」のことで、
勢いの違いはレートの違いとして表れます。

```yaml
stab_wound:
  passives:
    - modify:
        parent: {pain: 60}
    # 止血していない間だけ、宿主の命を削る。これが出血そのもの。
    - conditions:
        - not: {slot: treatment, tag: hemostatic}
      accumulate:
        parent: {vitality: -8}
```

- **止血帯は「効き目」を持ちません。** 当たっている間このブロックのゲートが閉じるだけで、出血が止まる
  という結果は傷の側の宣言から出ます（[`InjurySystem.md`](./InjurySystem.md) 3.1節）。
- 独立した血液量を持たないのは、**部位や臓器のモデルを持たないから**です。持たない以上、「どこから
  どれだけ失ったか」を別立てで数えても、行き先は結局「あと何 tick 生きられるか」1つしかありません。
- 失血が意識を奪う経路は、`vitality` の段をゲートにした `modify` が担います（2 節）。血の量と意識を
  それぞれ数える必要はありません。

## 5. 頭への一撃は、気絶が先で死が後から来る

出血しない一撃——頭部の強打——は、**意識と命の両方へ、違う速さで効きます。**

```yaml
concussion:            # 脳震盪。血は出ないが、意識だけを直接奪う
  passives:
    - modify:
        parent: {consciousness: -60}
skull_fracture:        # 頭蓋骨折。外へ血は出ないが、命は削られ続ける
  passives:
    - modify:
        parent: {consciousness: -40}
    - accumulate:
        parent: {vitality: -20}
```

`modify` は傷が刺さった瞬間から効くので**気絶は即座**、`accumulate` は tick ごとなので**死は数手遅れて**
訪れます。1 tick = 15分 = 動物の1手（[`HuntingSystem.md`](./HuntingSystem.md) 2 節）なので、殴った直後に
カードが消えるのではなく、**数手のたうってから倒れる**ことになります。

**即死を表せないことは、この設計では利点です。** 手負いの獣を追う時限（同 3 節）と同じ性質——決着が
その場で付かず、追う・待つ・仕留めるという時間の判断が残ります。

## 6. 倒れたことを読むのは2箇所だけ

| 起きること | 誰が起こす・読むか |
| --- | --- |
| 死 | **世界の側**（`on_shortfall`）。プレイヤーの死は「プレイヤーが世界から出た」として `observeChanges` にそのまま現れる（[`ActionSystem.md`](./ActionSystem.md) 7 節） |
| 気絶 | **画面**（操作を受け付けず時間だけ進める）と、**動物の1手を与える側**（[`HuntingSystem.md`](./HuntingSystem.md) 5.2節）が、段 `unconscious` を読んで手番を飛ばす |

**個々のアクションに `conditions` を撒きません。** 「意識が無いと何もできない」は操作ごとの条件ではなく、
手番が回るかどうかの1つの判断だからです。撒けば、アクションを足すたびに書き忘れが増えます。

読む側が知るのは**段の名前だけ**です。荷重の `too_heavy` を道の `travel` が読み、水分の `full` を飲用が
読むのと同じ分担で（[`Characters.md`](../world/Characters.md) 値の刻み方節）、しきい値を宣言しているのは
ワールドの側だけになります。だから `unconscious` は**名前を固定します**。

## 7. 3つとも、人にも獣にも配る

`pain`・`consciousness`・`vitality` は、キャラクタと動物の両方が持ちます。**同じ傷が両方に刺さる**
（[`HuntingSystem.md`](./HuntingSystem.md) 3 節）以上、傷の側が押し下げる先は両方に在る必要があり、
片方にしか無ければ傷の定義を2通り書くことになります。

これは狩りの側に副産物を1つ生みます。**気絶した獣は抵抗できません**——`resists`（同 4 節）に意識の段を
足すだけで、殴って気絶させた個体をかごや台車へ入れられます。生け捕りが、飼いならしとは別の入口として
成立します。

## 未決事項・今後の検討課題

- **値に比例した効き**が書けない。「`severity` が重いほど意識が下がる・速く出血する」は `modify` /
  `accumulate` の量がリテラルのため、段ごとのブロックで階段状に刻むしかない。傷の種類が増えて刻みが
  増えたら、`transfer` の `linked_add`（[`GameElementDefinition.md`](./GameElementDefinition.md) 9.5節）に
  相当する「比例する寄与」を検討する
- 具体的な数値——傷ごとの出血レートと意識への寄与、自然回復のレート。3 節の `max: 100` を「1 tick で
  何%」と読む前提で、**致命傷は数手で、放置できる傷は数時間で**効くように配分する
- 脱水（`hydration` の `dehydrated`）と餓死（`body_fat`）をこの `vitality` へ合流させるか。合流させれば
  死に方が1つになるが、飢えと出血が同じ量を奪い合うことの是非は未検討
- 気絶している間に何 tick 進めるか。その間に動物が何をするか（襲い続けるのか、興味を失うのか）
- プレイヤーが死んだときの見せ方（画面・セーブデータの扱い）。[`SaveDataManagement.md`](./SaveDataManagement.md)
  との接続
- 死体オブジェクトの重さ・解体・腐敗（[`HuntingSystem.md`](./HuntingSystem.md) 未決事項節と共通）

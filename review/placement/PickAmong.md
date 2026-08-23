# A-13 設計: 周りの物を候補にする `pick`

**実施済み**（記録は [`Stage3.md`](./Stage3.md) 20節。設計から変えたところもそちらに書いた）。

## 1. 何が欠けているか

`src/domain/wrappers/Animal.ts` は「動物に1手を与える」包みに見えるが、中身の大半は
**YAML の `pick` が表せないことの肩代わり**。`pick` は**著者が書き並べた候補**から1つ選ぶことしか
できず、**周りの物を候補として数え上げる**ことができない。

そのため `Animal.takeTurn` が毎ターン、世界を見て回った結果をプロパティへ書き込み、YAML 側は
その数値を読んでいる。橋渡しに使っているプロパティが `animals.yaml` に **9つ**ある。

| 書き込むもの | 集合 | 絞り込み | 重み |
| ------------ | ---- | -------- | ---- |
| `lootables` / `loot_target` | 土地の `items` | `quarry` でない | `volume` |
| `smashables` / `smash_target` | 土地の `items` | `fragile` タグ | `volume` |
| `escape_routes` / `flee_to` | 土地の `fixtures` の道 | なし | 一律 1 |
| `nearby_characters` ＋ actor | 土地の `characters` | なし | （先頭を採る） |
| `spoils_target` | 自分の `spoils` | なし | （先頭を採る） |

数（`lootables`）は「候補が無ければその手は起こらない」を書くため、対象（`loot_target`）は
「どれに対して起こすか」を書くためにある。**2つが必ず同時に書かれる**という不変条件を
`Animal.aim` が1箇所で守っている——エンジンに語彙が無いことの穴埋めが、そのまま
「呼び出し側が覚えておく手順」になっている形。

## 2. Candidates.md の見立ての検証

**件数がずれていた。** Candidates.md は `aim` を通る3件（loot / smash / escape）を挙げているが、
`nearby_characters` と `spoils_target` も**同じ形**（周りを数え上げて YAML へ渡す）で、直接
`takeTurn` が書いている。**5件**が同じ穴から出ている。

**「3つのパラメータだけ」は正しい。** ただし、そのうち**絞り込みの語彙は既にある**。
conditions の `{subject, slot, matches}`（`slot_content`、14節）が「その相手のそのスロットに、
当てはまる子が居るか」を既に言えている——現に `devour` のゲートは
`not: {slot: spoils, matches: {tag: food}}` と**直接書かれている**。

つまり欠けているのは**絞り込みではなく「その集合から1つ選んで対象にする」**の1点だけ。
`lootables` のような数のプロパティは、**エンジンを変えなくても** `slot_content` の条件へ
置き換えられる（対象のほうは置き換えられない）。ただし**別々に直すと絞り込みが2箇所に割れる**
（ゲートの `matches` と、TypeScript 側の述語）ので、片方だけ先に直すのは薦めない。

## 3. 設計案: 候補に `among` を足す

`pick` の候補1つに、**「周りから1つ選ぶ」宣言**を持たせる。選ばれた相手は参照ルート `picked` で
指す。

```yaml
- weight: {prop: snatch}
  among: {subject: parent, slot: items, matches: {not: {tag: quarry}}, weight: {prop: volume}}
  move: {subject: picked, to: self}
  signal: snatched
```

- **集合**は `{subject, slot}`。`slot_content` 条件とまったく同じ2つ組で、上の表の5件すべてが
  これで書ける（土地の `items` / `fixtures` / `characters`、自分の `spoils`）。
- **絞り込み**は `matches`（`TypeMatchRule`）。`slot_content` と同じもの。
- **重み**は `WeightSpec`。`{prop: volume}` は**候補自身の**プロパティを指す（`picked` が
  候補ごとに束ね変わる）。省略すれば一律1。
- **集合が空なら、その候補は抽選から外れる。** 著者が「候補が無ければ起こらない」を書かなくて
  よくなる。これは既存の `ActiveEffect.unresolvable`（9.9節「行き先が無い操作は候補に出さない」）と
  同じ考えで、`PickEffect` が抽選前に `unresolvable` な候補を落とすようにすれば済む。

実装側で要るもの:

- `ReferenceRoot` に `picked` を足す。`ReferenceContext` は `withDragged` と同じ形の
  `withPicked` を持つ（**候補ごとに束ね直す**のは既にある使い方——`TransferEffect.acceptedCount` が
  `context.withDragged(candidate)` を候補ごとに作っている）。
- `PickCandidateDef` に `among` を持たせ、重み評価と効果適用を `withPicked` した文脈で行う。
- 読み上げ（`EffectReader.pick`）へは、`among` の宣言（集合・絞り込み・重み）をそのまま渡す。
  解析側は「どれが選ばれるか」を定義だけからは決められないので、**近似の置き方は読み手が決める**
  （Layers.md 6節の分担のまま）。

## 4. これで消えるもの

`animals.yaml` から:

- プロパティ **9つ**（`lootables` `loot_target` `smashables` `smash_target` `escape_routes`
  `flee_to` `nearby_characters` `spoils_target`、および placeholder の説明）
- ゲートの passives **5つ**（`lootables < 1` → `snatch: -1000` など）。集合が空なら候補が外れるので、
  打ち消しを書く必要がなくなる。

`Animal.ts` から: `aim` / `lootTargets` / `smashTargets` / `bumpableTargets` / `escapeTargets` /
`TurnTarget`。**残るのは「`turn` を宣言している物に、tick ごとに1手を与える」だけ**（`tryWrap` と
`takeTurn` の実質2行）。持続効果の動詞は `modify`/`add`/`transfer` の3つに閉じている（8.4節）ので、
「毎tick自分のアクションを引く」はYAMLでは書けない——**手番を回す側はTypeScriptに残る**。
そのぶん `Animal` は「YAMLが表せないことの肩代わり」ではなくなるので、Candidates.md が保留していた
「`ObjectWrapper` に乗せるか」もそこで決められる。

## 5. `matches` の否定と、conditions の `not` の関係

`lootables` は「`items` のうち `quarry` でないもの」なので、`among` の絞り込みに否定が要る。
`TypeMatchRule` は今 `tag` と `object` の肯定形しか持たない。**conditions の否定は流用できない**
——別の対象に掛かる別物だから。

| | 何を否定するか | 書き方 | 使える場所 |
| -- | -------------- | ------ | ---------- |
| `ConditionNode.not` | **条件**（真偽） | `not: <1ノード>`（他のキーと同居不可） | conditions（14節） |
| `matches` の否定（新設） | **型の指定** | `matches: {not: {tag: quarry}}` | `accept`・`with`・`slot_content`・`object_matches` |

**`object_matches` では、綴りが2通りになるだけで意味は同じ。**
`not: {subject: self, matches: {tag: quarry}}` と `{subject: self, matches: {not: {tag: quarry}}}` は
どちらも「self は quarry でない」。

**`slot_content` では意味が違う。** ここが整合性で一番気を付ける点:

- `not: {slot: items, matches: {tag: quarry}}` — items に quarry が**1つも無い**
- `{slot: items, matches: {not: {tag: quarry}}}` — items に quarry **でない物が1つはある**

見た目が近く、意味が違う。ただしこれは足すことで生まれる混乱ではなく、**後者が今どうやっても
書けない**ことの裏返し——`lootables >= 1` というゲートを TypeScript が数を数えて作っているのは、
まさにこの形が条件で書けないから。`accept` と `with` は候補1つに対する述語なので、この食い違いは
起きない。

**採る形。** `not` は語としては1つのまま、**掛かる先が「条件」か「型の指定」か**で読み分ける。
`TypeMatchRule` を `tag | object | not` の3形にし、否定の意味は `TypeMatchRule` の1箇所に書く。
`slot_content` での2通りの読み分けは `GameElementDefinition.md` 14節に1度だけ書く。

実装の当たり所が2つある。

- `TypeMatchRule.acceptSpec` は `Record<string, string>` を返している（`inProgressObjects` が
  レシピの要求から枠の宣言をYAMLへ戻すのに使う）。否定が入ると値が入れ子になるので戻り値の型が変わる。
- `TypeMatchRule.candidates`（当てはまる型を全部挙げる）は、否定形では「quarry 以外の全部」になる。
  使っているのはレシピ要求の絵出し（`craftingView`）と `axisVariants` の2箇所で、**どちらも否定を
  書ける場所ではない**ので実害は無い。「1つに定まらない指定を絵で見せる」という前提が否定形では
  成り立たないことだけ、doc に書いておく。

### 採らなかった案: 絞り込みを conditions にする

`among` の絞り込みを `matches` ではなく条件式にすれば（`where: [not: {subject: picked, matches:
{tag: quarry}}]`）、否定は既存の1つで済み、`{subject: picked, prop: volume, gt: 0}` のような比較まで
書けるようになる。採らない理由は2つ。

- **同じ「集合の絞り込み」が2つの語彙に割れる。** `slot_content` は `{subject, slot, matches}` で、
  `among` は `{subject, slot, where}` になる。`among` を `matches` で書けば、集合の指定は
  `slot_content` と**同じ3つのキー**で揃う。
- 5件の絞り込みは**すべて型の述語だけ**で足りる（`¬quarry` / `fragile` / `path` / `character` /
  `food`）。比較まで要る例が1つも無いうちに条件式を持ち込むと、要らない自由度が先に入る。
- 加えて、この案では `accept`・`with` に否定が入らない。

## 6. 重みの下限は設けない

今は `Math.max(1, volume)` で「かさを宣言していない物も候補から漏れない」ようにしているが、
`weight: {prop: volume}` にすると、かさ0の物は（他に候補がある限り）選ばれなくなる。**その挙動を
引き受ける**——`volume` が0の物はそこに嵩が無いという宣言なので、ぶつからないほうが読める。
下限の語彙は作らない。

A-4 のレーンで `item` タグに `volume` を必須化したので宣言漏れは無く、`volume: 0` を明示している
のは製作中オブジェクトだけ。

副次の挙動差がもう1つある。`bite`/`gore` の相手は今 `characters.at(0)` 固定だが、`among` にすると
一律の重みで抽選になる。キャラクタが2人以上居る場面が無い今は差が出ない。

## 7. 採らなかった案

- **外側の `pick` を N 個へ展開する**（「持ち去れる物1つにつき候補1つ」）。`snatch` の確率が候補の
  数に比例してしまい、「配分の合計は動物によらず100」（`animals.yaml`）が崩れる。
- **`pick` の中に `pick` を入れ子にする。** 表現力は同じだが、YAML が2段深くなる。`among` は
  「この候補は周りの1つを相手にする」という**候補1つの性質**なので、候補と同じ高さに置くほうが読める。
- **数と対象のプロパティを残したまま、書き込む側だけ整理する。** 5件を1つのヘルパーへ畳めるが、
  「エンジンの表現力不足を肩代わりしている」という中身は変わらない。名前が減るだけで穴は残る。

## 8. 段取り

1. `matches` の否定（5節）。単独で入る。
2. `ReferenceRoot.picked` と `ReferenceContext.withPicked`。
3. `among`（パーサ・`PickCandidateDef`・`unresolvable`・読み上げ）。
4. `animals.yaml` の書き換えと、プロパティ・passives の削除。
5. `Animal` の縮小と、`ObjectWrapper` に乗せるかの判断。

1〜3 はエンジンの機能追加なので、`docs/engine/GameElementDefinition.md` 10節と
`docs/engine/HuntingSystem.md` 5節の書き換えを伴う。

## 9. 手番を配る仕組みの置き場

`among` が入っても「`turn` を宣言している物に、tick ごとに1手を与える」側は残る（4節）。その置き場の検討。

**結論: `WorldObject` で合っている。ただし2点ずらす。**

### なぜ `WorldObject` か

- **セッションを自分で持っている。** `WorldObject.session` があるので、手番を実行するのに外から
  何も渡さなくてよい。今 `Animal.takeTurn(location, session)` が session を受け取っているのは、
  包みが session を持たないからでしかない。
- **tick が active 効果を起こす前例が既にある。** `PropertyValue.tick` → `checkRangeEvents` →
  `applyActiveEffect` の経路で、`stay_remaining` の `on_min: destroy: self` は tick から走っている。
  「tick は `modify`/`add`/`transfer` に閉じる」（8.4節）のは**持続効果の動詞**の話で、tick が
  行動を起こさないという決まりではない。
- **ツリー全体へ配る再帰が既にある。** 今は `World.runAnimalTurns`（locationsスロットを知っている）
  → `Location.runAnimalTurns`（itemsスロットを知っている）→ `Animal` という中継を挟んでいるが、
  この2つの wrapper が持っているのは**スロットの名前だけ**。`WorldObject` の再帰に載せれば両方消える。

### ずらす点1: `tick()` の中ではなく、tick の後の2周目

`WorldSession.runTick` は今こう書いている——「値の積分（`WorldObject.tick`）のあとに動物の1手を配る
——動物が動くのは時間が経ったからで、**その tick の値が出そろった後**になる」。

`tick()` の再帰の中で手番も実行すると、この保証が消える。手番は `destroy`/`move`/`spawn` を起こすので、
**まだ tick していない物を壊せる**——籠を `smash` された中身は、その tick の `add`（腐敗など）を1回
飛ばす。今は全部の積分が終わってから手番なので起きない。

なので `WorldObject` に2周目の口を足す。`runTick` は2行のまま:

```ts
world.instance.tick();
world.instance.runTickActions();  // ← World.runAnimalTurns の置き換え
```

**集めてから配る。** 2周目は「引く物を集める」→「順に引く」の2段にする。これで既存の不具合が1つ直る
（下記）。消えた個体（`parent === undefined`）は配る前に落とす。

### ずらす点2: 引き金を「`turn` という名前」で引かない

`WorldObject` が見てよいのは**エンジンの語彙だけ**（`WorldObject.engine` は
`vocabulary.engine` を返す private getter で、`vocabulary.world` へは行かない）。`turnAction` は
世界の語彙なので、`WorldObject` が `turn` という名前を知るのは層の破り。

引き金は**宣言側**へ移す。その語彙（`trigger: menu | tick | drag`）と、それに伴う
`actions`／`combinations` の統合は [`InteractionTrigger.md`](./InteractionTrigger.md) にまとめた。
**このレーンはそれに依存する**——`tick` のきっかけが無いと、エンジンが `turn` という世界の語彙を
知ることになる。

### ついでに直る既存の不具合: 逃げた動物が同じ tick に2回手番を取る

`World.runAnimalTurns` は土地を順に回り、`Location.runAnimalTurns` が**その土地に着いてから**
items のスナップショットを取る。動物が `flee` でまだ回っていない土地（サイトindexが後ろの土地）へ
移ると、その土地の番でもう一度手番が回る。集めてから配る形にすると消える。

*コードから読んだだけで、再現テストは書いていない。* 実施するなら最初に確かめる。

### 決めてほしいこと: 配る範囲

今は**島の土地の `items` に居る動物**だけ。ツリーの再帰にすると**世界のどこに居ても**回る。

- 罠に掛かった獲物、入れ物の中、筏の上の動物にも回る。
- ただし `among` が入っていれば、周りに何も無ければ候補が全部外れて `lurk` になるだけ
  （3節）。**何ができるかを決めるのは世界の側**になる。

「地面に居る動物だけが動く」を engine 側の絞り込みとして残すか、世界に決めさせるか。**後者を推す**
——今の絞り込みは `Location.items` という世界の語彙をエンジン側に置いているのと同じで、
`among` が入れば同じことを宣言で言える。

セーブ互換の心配は無い。`SaveData` は世界の状態を持たない（種とキャラクタと表示の記憶だけ）ので、
手番の順序が変わっても読めなくなるものが無い。

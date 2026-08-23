# A-13 設計案: 周りの物を候補にする `pick`

**未合意の設計案。** 実装はしていない。段4の他のレーンと桁が違う（エンジンの機能追加になる）ため、
着手の可否を決めるための材料として書いた。

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

## 5. 一緒に決める必要がある2点

**(a) `matches` に否定が要る。** `lootables` は「`items` のうち `quarry` でないもの」で、
`TypeMatchRule` は今 `tag` と `object` の肯定形しか持たない。`{not: {tag: quarry}}` を足すと、
同じ語彙を使う**枠の `accept`（7.2節）と `with`（12.1節）にも否定が書けるようになる**。
それを許すかどうかが判断点。避けるなら「持ち去れる物」に肯定のタグを新設することになるが、
`item` を持つ物すべてに付けて回る opt-in の一覧が増えるので、こちらは薦めない。

**(b) 重みの下限。** 今は `Math.max(1, volume)` で「かさを宣言していない物も候補から漏れない」よう
にしている。`weight: {prop: volume}` にすると、かさ0の物は（他に候補がある限り）選ばれなくなる。
A-4 のレーンで `item` タグに `volume` を必須化したので**宣言漏れは無くなった**が、`volume: 0` を
明示している物（製作中オブジェクト）は地面に置ける。挙動を保つなら重みに下限の語彙が要り、
保たないなら「かさ0の物はぶつからない」を仕様として引き受ける。**後者を推す**——`volume` が0の物は
そこに嵩が無いという宣言なので、ぶつからないほうが読める。

副次の挙動差がもう1つある。`bite`/`gore` の相手は今 `characters.at(0)` 固定だが、`among` にすると
一律の重みで抽選になる。キャラクタが2人以上居る場面が無い今は差が出ない。

## 6. 採らなかった案

- **外側の `pick` を N 個へ展開する**（「持ち去れる物1つにつき候補1つ」）。`snatch` の確率が候補の
  数に比例してしまい、「配分の合計は動物によらず100」（`animals.yaml`）が崩れる。
- **`pick` の中に `pick` を入れ子にする。** 表現力は同じだが、YAML が2段深くなる。`among` は
  「この候補は周りの1つを相手にする」という**候補1つの性質**なので、候補と同じ高さに置くほうが読める。
- **数と対象のプロパティを残したまま、書き込む側だけ整理する。** 5件を1つのヘルパーへ畳めるが、
  「エンジンの表現力不足を肩代わりしている」という中身は変わらない。名前が減るだけで穴は残る。

## 7. 段取り（実施するなら）

1. `matches` の否定（5(a)）。単独で入る。
2. `ReferenceRoot.picked` と `ReferenceContext.withPicked`。
3. `among`（パーサ・`PickCandidateDef`・`unresolvable`・読み上げ）。
4. `animals.yaml` の書き換えと、プロパティ・passives の削除。
5. `Animal` の縮小と、`ObjectWrapper` に乗せるかの判断。

1〜3 はエンジンの機能追加なので、`docs/engine/GameElementDefinition.md` 10節と
`docs/engine/HuntingSystem.md` 5節の書き換えを伴う。

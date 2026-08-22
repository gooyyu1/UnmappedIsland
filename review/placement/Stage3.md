# 段3の再設計

`Plan.md` 6節は段3を「7件は全部『定義に問いを立てる口が無い』の別の顔で、分割不可の1つの設計」と
していた。着手前にコードで確かめたところ、**この前提は成立しない**。1つの設計に乗るのは3件だけで、
残りは互いに独立した小さな移動か、方針として取り下げるべきものだった。

以下、確かめた内容と、置き換える計画。

## 1. 1つの設計に乗るのは H-3・H-10・H-11 だけ

この3件は同じ2つの欠落から出ている。

**欠落1: `(root, propertyGlobalId)` の組に名前がある場所と無い場所がある。**

`PropertyPath` は既に存在し、`ConditionNode.valueRef` と `WeightSpec.path` が使っている。一方
`SetEffect` `AddEffect` `PassiveEffect` は `target: ReferenceRoot` と `propertyGlobalId: number` を
**別々のフィールドとして持ち**、`TransferEffect` は同じ組を2つ（from/to）持つ。H-10 の
「同じ id を2回渡す」10箇所は、組に名前が無いことの直接の帰結——

```ts
owner.resolveEffectTargetOrAncestor(this.target, this.propertyGlobalId, actor, dragged)
  ?.tryGetProperty(this.propertyGlobalId)
```

`propertyGlobalId` が2回現れるのは、1回目が「どの祖先か」を決めるため、2回目が「何を読むか」を
決めるためで、**同じものだと言う手立てが無い**から両方に渡している。

**欠落2: `self`/`actor`/`dragged` の3つ組に名前が無い。**

`resolveReferenceRoot(root, self, actor, dragged)` を呼ぶ側は、`(root) => WorldObject | undefined` の
クロージャを毎回その場で作っている（`InteractionDef` L98・`PassiveEffect` L60・`ConditionNode` の
`resolveRoot` 引数）。**作られているクロージャは全部この3つ組そのもの**で、それ以外の中身は1つも無い。
CLAUDE.md の「プログラミング上の都合だけで存在するオブジェクト」に当たる。

`WeightSpec.resolve` と `WorldObject.resolveEffectTargetOrAncestor` の本体が完全に同一（H-11）なのも、
`ConditionNode` が `resolvePropertyOwner` という private を持つのも、この2つの欠落の別の顔。

**H-3 が同じ設計に入る理由。** H-3 は「どの文脈でどの root が解決先を持つか」で、ロード時の話に見える。
だが実行時と**必ず一致していなければならない**。例えば `PASSIVE_CONDITION_ROOTS` が
`{self, parent, ancestor}` であることと、`PassiveEffect` L60 が `(slotBearer, undefined, undefined)` を
渡す（＝actor/dragged が解決先を持たない）ことは同じ事実で、今は別ファイルに無関係に書かれている。
片方だけ変えても何も壊れない。**この一致こそが持ち場を1つにすべきもの**で、H-10・H-11 と同じ
「参照の文脈」という1つの概念に属する。

なお `parseSubjectRoot` は既に `allowedRoots` を受け取る統一の口を持っているが、**使っているのは
conditions だけ**。activeの対象・spawn.into・passiveのtarget はそれぞれ独自の switch を持ち、
そちらは「なぜ使えないか」を文言で持っている（`'dragged'` は combinations の中だけ、`'child'` は
一度きりの命令では「どの子か」が決まらない、等）。単純な allowlist へ畳むとこの理由が消える。
**理由は捨てずに、文脈と root の組に対して持たせる**必要がある。

## 2. B-3・H-2 の打ち手は、アーキテクチャが名指しで禁じている

`Plan.md` が引いた H-2 の打ち手は「ドメイン側の引数を `WorldObject` から `StaticValueResolver`
相当の関数1つへ変える」だった。これは `tests/architecture/layers.test.ts` L135〜143 が禁じている:

> **型として輸入するのも数える。** Phaserと違って、ここで守っているのは実行時の依存ではなく
> 「近似がドメインの語彙に混ざらないこと」——**`StaticValueResolver`を引数に取った時点で、
> その仮定はドメインの契約になってしまう**。

打ち手として名指しされた型が、禁止理由の例としてそのまま書かれている。これは機械的な検査ではなく
**方針の表明**で、優先すべきはこちら。打ち手は取り下げる。

**取り下げても B-3 の大半は解ける。** 解析側が書き直している規則を1件ずつ見ると、
resolver を要するものはほとんど無い:

| 解析側 | 実際に要るもの | resolver が要るか |
| ------ | -------------- | ----------------- |
| `rangeEvents.rangeEventAt` | 「この値は range のどちらの端を越えたか」 | 不要（値1つで決まる） |
| `rangeEvents.ticksToRangeEnd` | 「端まであと何 tick か」 | 不要（`PropertyRange` の算術） |
| `balanceTables.destroysWhenEmpty` | 「`on_min` が自分を消すか」 | 不要（宣言を読むだけ） |
| `balanceTables.isLocation` / `isCharacter` / `explorableLocationsOf` | 「タグで型を選ぶ」 | 不要（`WorldCodex`） |
| `craftingSteps.minutesOf` | 所要時間 | **要る**（`WeightSpec` が文脈で解く） |
| `staticValue.staticValueOf` の inherit 加算 | 祖先の値 | **要る＝これが近似そのもの** |

つまり resolver が要る2件のうち、`staticValueOf` は**近似そのもの**なので解析に残るのが正しい。
`minutesOf` だけが残るが、これは 3-B の「参照の文脈」が入れば、実行時文脈と静的文脈の両方を
同じ形で渡せるかを改めて見られる（今回は触らない）。

残りは全部、**宣言が自分の宣言だけで答えられる問い**に、宣言側がメソッドを持てば消える。

## 3. H-6 の診断は誤り

`ObjectDefTable` は既に `[Symbol.iterator]` を持っている（`ObjectDef.ts` L227〜230）。
「反復を持たないため利用側が毎回組み立てている」という診断は間違いで、実際は
**在るのに使われていない**。`WorldCodex` 自身が4箇所で `for (let globalId = 0; globalId < count; …)`
を書き、`balanceTables.allDefs` も同じ形を書いている。

本当に欠けているのは反復ではなく**絞り込みの語彙**——「そのタグを持つ型」「土地か」「人物か」。
`WorldCodex` は既に `isGenerated` `objectDefNamesWithTag` `singletonGlobalIds` を持っているので、
そこへ並べる。`cardLooks` がタグ名を文字列から引き直しているのも同じ穴。

## 4. B-5（describe をドメインへ）は取り下げる

「止めているのは層のテスト1つだけ」という書き方をしていたが、そのテストは
`VIEWER_FREE`（L145〜152）で、理由が書かれている:

> **型として輸入するのも数える。** 守っているのは「表示の語彙がドメインの契約に混ざらないこと」
> ——`DescriptionWriter`を引数に取った時点で、その型は「どう見せるか」を知ってしまう。

2節と同じ構図。`describe*` が「定義の公開フィールドをなぞるだけ」に見えるのは、
**なぞるだけで済むように定義側が素直な形をしているから**であって、移す理由にはならない。

ただし B-5 が併せて指摘した「3箇所が describe をドメインに置いていた頃の記述のまま」
（`DefNames` のコメント・`DescriptionWriter` 冒頭・`CodexView` 冒頭）は事実で、これは直す。

## 5. 置き換える計画

段3は**1つの分割不可の山ではなく、独立した2レーン**。触るファイルがほぼ重ならないので並列にできる。

### レーン R: 参照の文脈（H-3・H-10・H-11）——分割不可

`src/domain/ReferenceRoot.ts` を中心に、`ActiveEffect` `ConditionNode` `PassiveEffect` `WeightSpec`
`InteractionDef` `WorldObject` ＋ `loader/parseConditions` `parseActiveEffects` `parsePassives`。

1. `(self, actor, dragged)` の3つ組に型を与え、クロージャの生成を全て畳む。
2. `PropertyPath` に解決の口を持たせる（`ancestor` を含む）。`WorldObject` の
   `resolveEffectTargetOrAncestor` はここへ移る。
3. `SetEffect` `AddEffect` `TransferEffect` `PassiveEffect` のばらけた2フィールドを
   `PropertyPath` へ寄せる。H-10 の10箇所はこの副産物として消える。
4. 「文脈ごとに解決先を持つ root」を1箇所へ集め、loader の各 switch をそこへ向ける。
   **却下されている理由の文言は保つ**（allowlist へ畳んで「この文脈では使えません」に
   まとめない）。

### レーン D: 宣言が自分で答える問い（H-13・B-3の大半・H-6）——並列可

互いに独立した小さな移動で、**1つの設計は要らない**。仕組みを立てようとすると、
既存のケース数と同じ数の仕組みができるだけになる。

- `PropertyStage` に述語を持たせる（H-13）。`PropertyDef` の `stageAt` `stageBoundaries` `spanOf`
  が `stage.min` `stage.eq` を直に見るのをやめる。`best.min!` の `!` もここで消える。
- `PropertyDef` に「値がどちらの端を越えたか」、`PropertyRange` に「端までの距離」を持たせる。
  `checkRangeEvents` と `rangeEvents.rangeEventAt` が同じ判定を共有する。
- `PropertyDef` に「尽きたら持ち主ごと消えるか」を持たせる。
- `WorldCodex` にタグでの絞り込みを持たせ、`for (let globalId = …)` を無くす（H-6）。
- describe の由来を書いた3箇所のコメントを直す（B-5の残り）。

### 順序

レーン R とレーン D は同時に進めてよい。触る `src/domain` のファイルが重ならない
（R: 効果・条件・参照／D: プロパティ・型表）。レーン D は個々が独立なので、途中で止めても
それまでが有効。

## 6. レーンRの結果

実施済み。`ReferenceContext`（3つ組）・`PropertyPath` の解決の口・`ReferenceScope`（場所が何を
用意できるか）の3つが入り、`resolveReferenceRoot` / `WorldObject.resolveEffectTarget` /
`resolveEffectTargetOrAncestor` / `ConditionNode.resolvePropertyOwner` /
`ObjectRef.needsInteraction` / 4つの `*_CONDITION_ROOTS` / `parseActiveTargetRoot` の switch /
`parsePassives` の対象 switch / `in_slot` の ancestor 検査 / `parseMove` の `selfOnly` 検査が消えた。

**着手前の前提のうち2つが、コードで確かめると崩れた。**

- H-3 の「文脈ごとの許可」は、**一覧ではなく導出**で表せた。場所が持つもの（self・actor・
  dragged・プロパティ名・相手が複数でよいか）を宣言し、rootの側が要るものを言うだけで、
  既存10文脈のうち8つの許可集合が完全に一致した。
- 残る2つ（rangeイベントの `selfOnly`、`move` の `subject` から `parent` を外していたこと）は
  「解決できない」ではなく「まだ受けていない」だった。**`move` の方はコメントの誤り**——
  「一度きりの命令に対してどれを動かすか」が当てはまるのは `child` だけで、`parent` は1つに
  決まるうえ、同じ `move` の `to` では現に使えていた。

どちらも導出に合わせて受け入れる形で決着（挙動が広がる）。`on_max`/`on_min` で `parent`・
`ancestor` を、`move` の `subject` で `parent` を指せるようになった。テストは6件が新しい規則の
言い方へ変わり、1件（rangeイベントで `parent` を指せる）が増えた。

**副産物**: `slot`・`matches` の葉が `ancestor` を黙って偽にしていた（`in_slot` だけが弾いて
いた）のが、プロパティ名を伴わない葉としてまとめて弾かれるようになった。

## 7. レーンDの結果

D-1・D-2・D-4・D-5 を実施。D-3 は取り下げ。**D-6（`ticksUntilMax`）は保留**（下記）。

### 着手前の前提から変わったところ

- **D-1**: `PropertyStage.eq` が入るのは「持ち主がシンボル型（6.6節）のとき」だけで、値は常に段名の
  シンボルID。つまり `stage.eq !== undefined` は**「私はシンボル型か」の言い換え**で、`PropertyDef`
  は5箇所で遠いほうを読んでいた。段には `matches` / `lowerBound` を持たせ、シンボル型かどうかは
  `this.isSymbolic` で訊くように分けた。副次的に「シンボル型に受け皿の段は存在しえない」ことが
  コードに現れた（以前は `eq` が必ず入る結果として偶然そうなっていただけ）。
- **D-2**: `PropertyRange.remainingToward`（端までの距離）は**入れないと決めた**。実行時側の
  `PropertyValue.ticksUntilMax` と解析側の `ticksToRangeEnd` は、向き・端数・最低1の3点で規則が違い、
  共有できるのは距離の1行だけ。移すと片方の規則を他方へ押し付けることになる。
- **D-3**: 取り下げ。`destroysWhenEmpty` の述語は `readEffect`（解析の近似）を通した結果なので、
  domain へ持たせるとその近似が契約になる。D-2 の `rangeEventsAt` で `on_min` を選べれば足りる。
- **D-4**: 「反復を持たない」という診断が誤りだっただけでなく、**在る反復のほうが壊れていた**。
  `ObjectDefTable` の中身は疎になりうる（参照だけされて定義が無い型のところが穴）のに、
  `[Symbol.iterator]` の宣言型は `Iterator<ObjectDef>` で、`WorldCodex` の4つの添字ループは
  `get()` を呼ぶので穴があれば例外になる。実際に穴は作れる（`accept: {object: 未定義の型}` で再現）。
  同梱データ（112型）には現在穴が無いので誰も踏んでいない。**型を実態へ合わせ（`ObjectDef | undefined`）、
  反復は穴を飛ばす**ようにした。
- 併せて `ObjectDef.hasTag` を足した（`PropertyDef` には在って `ObjectDef` には無かった）。
  `src/` にあった生の `tags.includes` 15箇所がここへ揃う。

### やらなかったこと・見つけた宿題

- **`ObjectDefTable.withTag` は足さなかった。** 呼び手が1つしか無く、`filter(d => d.hasTag(id))` の
  1行で足りる。呼び手と同じ数だけ口を足しても何も畳めない。
- **`cardLooks` の10個のタグ名引き直し**（`codex.tagNames.tryGetId('character')` 等）は触っていない。
  `WorldVocabulary` に在るのは `location` と `character` の2つだけで、**2つだけを語彙経由に変えると
  残り8つと不揃いになる**。「10個すべてを語彙へ入れるか、1つも入れないか」を決める話なので、
  独立した指摘として残す。
- **`isLocation` のコメントと実装のずれ**（`balanceTables`）。コメントは「製作中オブジェクトは除く」
  と言うが、実装は `codex.isGenerated(def)`（生成型＝変種を含む）を見ている。集合が一致しない。
- **D-6: `PropertyValue.ticksUntilMax` の `Math.max(1, …)`**（保留）。`Math.ceil` は表示の丸めではなく
  「何tick目に `on_max` が起きるか」の答えそのものなので残すべき。表示側の都合なのは `Math.max(1, …)`
  だけで、これが効くのは「もうmaxに居るのに正の寄与が続く」ときだけ——そこで0ではなく1を返すため、
  **「もう着いている」と「あと1tick」が区別できない**。`on_max: {}`（打ち消し、6.3節）を書いた値は
  「あと1tick」を出し続ける。
- **`cardLooks` が実効値と実体値を組にしている**（保留・D-6と同じ場所）。`PropertyValue` は表示用の読み
  （`ratio` `stage` `alert` `stageOnBar`）をすべて実効値で引くのに、`ticksUntilMax` だけ実体値で測る。
  どちらも単体では正しい（`checkRangeEvents` は実体値で発火する）が、`ownCookingOf` は両方を組にして
  1枚の札へ出しており、**バーの位置と残り時間が別の値から出ている**。`cooking_progress` に `modify` が
  無いので今は一致する。

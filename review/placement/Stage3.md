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
- **D-6: `PropertyValue.ticksUntilMax` の `Math.max(1, …)`** — **取り下げ。現状が正しい。**
  「表示側の都合の辻褄合わせ」と読んだのが誤りだった。`Math.ceil` も `Math.max(1, …)` も、
  「何tick目に `on_max` が起きるか」の答えそのもの——既にmaxに居ても、溢れて `on_max` が起きるのは
  次のtickなので0tick後ではない。外していれば、残り時間の式（下記）が負の値を出すところだった。
- **`cardLooks` が実効値と実体値を組にしている** — **解消。** `PropertyValue` は表示用の読みを
  すべて実効値で引くのに `ticksUntilMax` だけ実体値で測る、という食い違いだったが、
  「実効値が実体値と食い違いうるプロパティには `on_max`/`on_min` を書けない」を入れたことで、
  `cooking_progress` のように端のイベントを持つプロパティでは両者が必ず一致するようになった。

## 8. 料理の残り時間と tick の粒度

レーンDの調査から派生した相談。**ゲーム内時間は分単位なのに tick は15分ごとにしか回らない**ため、
残り時間を数字で出すと粒度が見えてしまう——5分の行動をしても加熱は進まず、表示も動かない。

`tick` を1分にする案は**採らなかった**。tick に載っているのは率だけではなく**頻度**でもあり、
数値を割っても直らないものが3つある:

- 動物の1手（`WorldSession.runTick` → `runAnimalTurns`）。1 tick に1手とコードで決め打ちで、
  YAMLに「行動頻度」という数字が無い。1分tickでは15倍動く。
- 1回の探索＝1 tick（`locations.yaml` の `duration`、ExplorationSystem.md 124節）。
- 時間経過演出の目盛り（CardInteraction.md 7節）。**tickの粗さが見えることを前提にした演出**で、
  「区切りの長さは一定とは限らない」も状況エリアの時計が飛ぶのも、この粒度から出ている。

YAML側も、率を÷15すると分数になり、範囲を×15すると**在庫まで巻き込む**（`fuel` は率で減るが、
薪1本が持ち込む `fuel` は在庫。一律の掛け算では済まない）。

**採った案**: 表示を tick の格子の上で正直に出す。焼き上がるのは tick が回る瞬間だけなので、
焼き上がる時刻は必ず格子の上にあり、そこから今の時刻を引けば正しい残り時間になる。

```
残り分 = World.minutesUntilTick(ticksUntilMax()) = (n-1) * M + (M - 通算分 % M)
```

tick の間で時間が進めば、加熱が進んでいなくても残り時間は減る。同じtickに入れた物どうしの残り時間が
揃うのも、同じ瞬間に焼き上がる以上そちらが正しい。

**tick がいつ回るかの決まりは `World.minutesUntilTick` 1箇所へ集めた**——`advanceWorldTime` が持つ
規約と表示側が2箇所に分かれると、片方だけ変えても何も壊れない（レーンRで潰したのと同じ形）。
併せて、`minute % M`（時分の下位だけを見る近似）から `totalMinutes % M`（通算分、
`rollTimeOfDay` のコメントが述べている本来の規則）へ揃えた。M が60を割る限り結果は同じ。

なお「率の積分」と「拍のイベント」を分ける案（積分だけ分単位にし、tickは拍として残す。YAML変更ゼロ）
は**本命として残っている**。今回の表示の直しはそれを入れても無駄にならない。

## 9. 実体値と実効値の境目

8節の議論から派生。**段・バー・`conditions` は実効値を読むのに、`on_max`/`on_min` は実体値で発火する**
——`cooking_progress` に `modify` を書けば「バーは満ちているのに焼き上がらない」が起きうる。

**今のデータでは起きない。** 宣言された `on_max`/`on_min` を持つプロパティ（18個）と、`modify` の
対象になるプロパティ（32個）の集合は完全に分離していた。`inherit`（2個）と `weight`/`load` も同様。
2種類のプロパティ——**不可逆に積み上がる蓄積量**と、**毎回導出される導出量**——に分かれている。

**分かれているのは、混ぜたときの挙動を決めていないから。** そこで、決めていないことをコードに書いた:

- `WorldCodex` が世界全体を見て、**実効値が実体値と食い違いうるプロパティに宣言 `on_max`/`on_min` が
  あればロードエラー**にする（食い違いの原因は `modify`・`inherit`・入れ物からの寄与の3つ）。
  `modify` されるかは型ひとつでは分からない（宣言するのは他の型）ので、両方を持つ `WorldCodex` が見る。
- 6.3節に「実体値とは何か」「`range` は誰の端か」を書いた。

**`becomeAlong` の丸めを外した。** ここだけがエンジンによる実体値のクランプで、しかも実効値用の
`range` を実体値へ当てていた。外しても表示は新しい型の `range` で切られるし、その場ではイベントも
起きない（`init`）。丸めても上限そのものへ着地するので「反応させない」効果は元から無かった
（増える書き込みが来れば結局発火する）。これで「エンジンは実体値をクランプしない」が例外なしになった。

**残っている論点は書いていない。** 実効値で発火させる案（強心剤のように `modify` で借りて、切れた
瞬間に死ぬ）には議論の余地があり、既定路線と誤解されないよう仕様には書かない。

## 10. 段4 レーンA-1（画面のことば）

段0の決定1をコードに落とした。`ui_texts` 節・`Localization.uiText`・`setUiTexts`/`uiText`。

**段0の記述と1つ違った。** 注入するのは `main.ts` ではなく `BootScene.create()`——localeが読まれるのは
そこだから（`loadDefinitions`）。`main.ts` の `setLabelDefaults` は意匠の値なので定数から入れられるが、
ことばはアセットパックの差し替えを経るので、読み終わるまで入れられない。

**引き方を2つにしたのは意図的。** `Localization` を持てる側（`PlayScreenView`・`recipeList`）は
`locale.uiText` を直に呼ぶ——同じ行で `locale.reason(...)` を呼んでいるのに、片方だけモジュール変数を
経由するのは読み手を惑わせる。窓は持てないので注入された `uiText` を使う。**答えを決めるのは
`Localization.uiText` の1箇所**なので、規則は割れていない。

`errorReport` の「閉じる」だけは残した。起動より前（`installErrorReport`）に描かれるので、
対応表がまだ無い。

## 11. 段4 レーンA-2（部品1つぶんの意匠）

段0の決定2をコードに落とした。**Candidates.md が「最大」と見積もった山は、段0の実測で消えていた**
——`Card.ts` の44定数は「部品の中で閉じるのでそのままでよい」と決着済みだったので、
残っていたのは5つの小さな作業だった。

1. **色は例外なく `theme.ts`。** 唯一の例外だった `MapWindow` の `CHART_PAPER` / `CHART_LINE` /
   `ROAD_INK` を回収。
2. **死んだトークンを落とす。** `COLOR.weatherPanelBorder` / `COLOR.slotPortrait`。
3. **複数箇所で一致すべき寸法・時間を出す。** 探すまでもなく、**3つのコメントが別ファイルを指して
   「揃える」と書いていた**——`Button.HOLD_MS`（「カードの端を押し続けたときの1枚目と同じ」）、
   `Card.ALERT_BLINK_DURATION_MS`（「ProgressBarの警戒の枠と揃える」）、
   `SettingsScene.LIST_PADDING`（「テスト用シナリオの一覧と揃える」）。
   - 長押しと見なすまでの時間 → `src/ui/holdRepeat.ts` から export（意匠ではなく操作の閾値なので、
     `theme.ts` には置けない——`src/ui/` は意匠を知らない）
   - 警戒の明滅の片道の時間 → `looks/alertBlink.ts`（`looks/cardFlight.ts` と同じ形。
     最も薄いときの濃さは面積が違うので各々が持つ）
   - 一覧の余白 → `looks/listScreen.ts`
4. **`setShapeDefaults`。** `src/ui/shapes.ts` が抱えていた `SHADOW_LAYERS` / `DASH_LENGTH_RATIO` を
   `theme.SHAPE_LOOK` へ出し、`main.ts` が `setLabelDefaults` の隣で入れる。
   「ぼかせないので2枚重ねる」という判断も意匠側へ移した——汎用の図形が知っているのは
   「重ねて濃さを落とす」までで、何枚どの濃さかは知らない。

`PADDING`(24) は出さなかった。`Tooltip`（吹き出しの内側）・`ShelfScene`（棚の外周）・
`networkLayout`（codex-viewer）で、**同じ数字だが一致していなければならない理由が無い**。
段0が挙げていたが、実物を見ると別の概念だった。

**B-6（`Button` / `Curtain` / `ScrollIndicator` を `src/ui/` へ）の阻害要因が外れた。**
`setShapeDefaults` が入ったので、あとは色トークンの差し込み口の話だけになる。

## 12. 段4 レーンA-3（観測の器）

`WorldSession` に**同じ形が5回**あった（`observeTicks` / `observeChanges` / `observeSignals` /
`observeGains` / `withSubject`。`withInteractionEffect` も同じ形の上に「抜けるときに流す」を足したもの）。

```ts
const outer = this.xxx;
this.xxx = next;
try { body(); } finally { this.xxx = outer; }
```

A-2 のときと同じ証拠があった——**3つの doc が互いを指していた**（「observeTicksと同じく」
「observeChangesと同じく」×2）。「必ず元へ戻る」が5箇所に書かれ、3箇所は隣を指して済ませていた。

**`src/util/scoped.ts` の `Scoped<T>`**（bodyの実行中だけ差し替わる値）へ畳んだ。

### 「26宣言中15」という見積もりは粗かった

`Candidates.md` A-3 は「種類が増えるたびに2宣言ずつ太る」を欠陥として挙げ、汎用の登録口
（`session.observe('tick', cb, body)`）を示唆していた。**採らなかった。**

4つの doc の中身を読むと、太っているのは宣言ではなく**チャンネル固有の知識**のほうだった
——なぜ signal と change を分けるのか（混ぜると受け取る側が毎回選り分ける）、なぜ gains は
1回ぶんまとめるのか（同じ値へ複数回書く効果がある）。汎用の登録口にすると、この判断を書く場所が
消える。**公開メソッドは4つのまま残し、畳んだのは仕組みだけ。**

### 併せて、記述の重複も畳んだ

4つの doc が同じ約束を繰り返していた（bodyの実行中だけ・溜め置きしない・読み取り専用・解除は
observe*が行う）。**どれも4つ全部の性質**なのでクラスのコメントへ1度だけ書き、各メソッドには
「何を運ぶか」だけを残した。

結果 269行 → 234行（＋`scoped.ts` 28行）。減ったのは実装と記述の重複で、公開メソッドの数は変えていない。

## 13. 段4 レーンA-4（中身から受ける寄与）

2つの仕事に分けて進めた。

### 仕組みではなく、世界の約束が欠けていた（仕事1）

`item` タグは「持ち歩ける物」の定義そのものなのに、`weight` の宣言漏れを誰も見ていなかった。
同じ穴が `volume` にもあり、こちらのほうが実害が大きい——容量を持つ枠（編み籠 20L・**筏 500L**）へ
かさ0の物をいくらでも積める。

**ルートキー `required_props`（タグ → 要求するプロパティ）としてYAML側に置いた。**
最初はエンジンに埋め込んだが、テストが作る小さな世界も同じ `item` という語を使うため
33ファイル206テストが巻き添えで落ちた。これは「テストが面倒」ではなく、**何が要るかを決めるのは
エンジンではなく世界だ**という指摘。ロード時検査なのでMODにも効く（テストは同梱YAMLしか通らない）。

塞いだ漏れは2箇所。**怪我**（`injury` trait を新設して4行の繰り返しを畳み、そこに `weight: 0`）と
**製作中オブジェクト**（完成品のタグだけ引き継いでpropsを持たなかった。`weight: 0` と、完成品から
写した `volume`）。かさは重さと違って中身から導出されない——入れ物のかさは外側の大きさなので、
写さない限り0のまま。

`load` を trait で配るのは見送った。4キャラの `range.max` と段の境界がそれぞれ違い、それが個体差
そのもの。`player_character.yaml` の先頭が「個体差を持つプロパティはここに置かない」と決めている。

### 伝播を、与える側が書く `modify` にした（仕事2）

`getEffectiveValue` に `containerContributionTo` の1行があり、その先で入れ物が**中身を数えて回って**
いた（Ask）。案B-1a（寄与を表すクラスを入れ物側に持たせる）は「影響を与える側が影響を書く」という
全体原則に反するため却下。

**エンジンが型に `modify` を生やす形にした**（`containerPropagation`）。

| 生やす先 | 量 |
|---|---|
| 親の `weight` | 自分の `weight` |
| 親の `load` | 自分の `weight` × `load_rate` |
| 自分の `weight` | `fill` × `density` |

量が定数でない宣言が要るので、`PassiveAmount`（定数 / **宣言元自身のプロパティの実効値の積**）を
入れた。登録・解除・実効値への合算・影響の一覧は、著者が書いた `modify` とまったく同じ経路を通る。

消えたもの: `WorldObject.containerContributionTo` / `effectiveWeight` / `collectContainerInfluence`、
`PropertyValue.getEffectiveValue` の特別行、`WorldCodex.reasonEffectiveValueDiffers` の weight/load
2行（伝播が `modify` になったので一般の規則に吸収された）。

### YAMLに `value: {prop: ...}` を入れるかは、まだ入れない

「`modify` の量に変数を書ければYAMLで表せる」という案が出たが、**変数だけでは3つのうち1つしか
書けない**（残り2つは積が要る）。1つだけYAMLへ出すと同じ仕組みが2箇所に割れるので、選択肢は
「掛け算まで入れるか、入れないか」になる。入れない側を採った理由は、**この宣言に自由度が1つも
無い**こと——重さを持つ物が担いでいる物を重くしない世界は無く、書き忘れも書き換えも起こらない。
そういうものは宣言ではなく法則で、YAMLへ出せば「`weight` は書いたが伝播を書き忘れた物」という
静かな事故を新しく作ることになる。

**先に仕組みを1つにしておけば、文法は後から同じ受け皿へ足せる**（逆順はできない）。

### `load_reduction_rate` → `load_rate`

積の因子にするため裏返した（既定0の軽減率 → 感じる割合）。同梱データで宣言していた型は0だったので
実コストは無し。得られたもの2つ:

- **既定値という規約が消えた。** 因子に並べるのはその型が実際に宣言しているプロパティだけなので、
  「宣言されていない因子は1」を規則として書く必要がない。
- **クランプがエンジンから消えた。** 旧実装の `min(rate, 1)` は「担いで軽くはならない」を守るもの
  だったが、負の率は負の `modify` を書けるのと同じことで、`load` 自身の `range` の下限が止める。
  **端を持つのは受け取る側**という他のプロパティと同じ決まりに揃った。

### 残した宿題

影響の一覧が溢れる（子N個 → N行）。既存の怪我（切り傷3つ → `pain` に3行）と同じ形なので、縮退表示の
規則は両方まとめて決める。

## 14. 段4 レーンA-5（入れ子を読み上げる語彙）

### Candidates.md の見立ては2点ずれていた

**「3箇所」ではなく6箇所で、うち3つは再帰と関係なかった。** 木のクラスが domain の外へ渡る口を
全部数えると、条件側が `ConditionReader.all`/`any`/`not`・`GateReading.conditions`・
**`Requirement.node`**、効果側が `PickCandidateReading.effect`・**`PropertyDef.rangeEvents()`**・
**`PropertyDef.rangeEventsAt()`**。太字の3つはただの受け渡しで、再帰する箇所だけ直すと同じ穴が残る。

**「語彙が無い」のは条件側だけだった。** 効果側には `EffectDeclaration` が既に在り、
`readEffect`・`spawnsObject`・`PropertyDef.hasRangeEventMatching` が使っている。`PropertyDef` では
狭い型を使う `hasRangeEventMatching` と、木を素で返す `rangeEvents` が隣り合っていた。

漏れていたのは、`ActiveEffect` に付いてくる `apply`（世界を書き換える）と、`ConditionNode` に
付いてくる `evaluate`。読み手は全員 `read` で読み下しているだけなので、実害ではなく口の広さの問題。

### 6箇所を「読み下せる宣言」に揃えた

`ConditionDeclaration` を足し、6箇所すべてを `EffectDeclaration` / `ConditionDeclaration` にした。
`ConditionOp` は `PropertyConditionReading.op` の語彙なので `ConditionReader.ts` へ移した
（読み手が `ConditionNode.ts` を輸入する理由がこれで無くなる）。

内部で木そのものが要る2箇所は、自分で持つ形へ:

- `Requirement.node` は private にし、`condition`（読み下し用）と `isMet(context)` を公開。
  `Requirements.firstUnmet` が `entry.node.evaluate(...)` を呼んでいたのをやめた。
- `PropertyDef.rangeEventsAt` は private に落とし、外へは `rangeEventLabelsAt` を出す。外の唯一の
  利用（`analysis/rangeEvents`）はラベルしか読んでいなかった。「どちらの端に達したか」を答えるのが
  1箇所という約束は private 側に残っている。

### `collectWatchedProperties` を消した

`ConditionNode` は「見ているプロパティを集める」独自の再帰を持っていて、`tickDeltas` だけが
呼んでいた。読み下す口を1つに揃えるため、`tickDeltas` 側の `ConditionReader` 実装
（`WatchedSelfProperties`）へ移した。**取りこぼしが塞がるのが実利**——旧実装は
`propertyGlobalId !== undefined` というフィールドの有無で葉を判定していたので、葉の種類を足しても
黙って素通りする。読み上げ口が動詞ごとにメソッドを分けているのは、まさにそれを防ぐため。
`valueRef`（比較の相手側）を数えない挙動はそのまま移した。

### 方針を機械で保つ

`tests/architecture/layers.test.ts` に1件足した——`src/analysis` と `src/codex-viewer` は
`ActiveEffect.ts` / `ConditionNode.ts` を輸入しない。ここだけ**直接の輸入**を見る（読み手が輸入する
定義クラスの先には木が居るので、到達可能性では見られない）。`docs/engine/Layers.md` 6節に
「入れ子も、読み下せる宣言として渡す」を足し、規則はそこ1箇所に書いた。

## 15. 段4 レーンA-10（保存領域のキー名前空間）

`SaveSlots` / `Settings` / `Shelf` が `unmapped-island:` を各自で書き、壊れたJSONの扱いも各自で
実装していた。**接頭辞の定数を1つ置くだけでは畳めていない**（3クラスが各自でキーを組む形は
変わらない）ので、`StorageArea` に「領域1つ」として持たせた。

- 領域を挙げるのは `StorageAreaName`（`save` / `settings` / `shelf`）の1箇所だけ。型なので、
  4つめを勝手に足せない。
- キーは `unmapped-island:{領域}[:{名前}]`。名前を省くと領域そのもの1件になる（`shelf`）。
  **今のキーと1文字も変わらない**——既に保存されているものが読めなくなるので、ここは動かせない。
  テストがキー文字列を直に書いているので、そのまま検証になった。
- 壊れた値を未設定として読むのは `readJson` の中1箇所。`Shelf` と `SaveSlots` の try/catch が消え、
  `SaveSlots.read` は `toSaveData(this.area.readJson(...))` の1行になった。

`Settings` だけ JSON ではなく素の文字列を読み書きする（`'true'` / タブ名）ので、
`readText` / `writeText` も置いた。値の形が違うだけで、キーの組み立てと領域は共通。

## 16. 段4 レーンA-8（決着＝Ending）

`PlayerCharacter` が `isDead` / `causeOfDeath` / `hasReachedMainland` / `broughtArtifacts` と
private の `mainland` を抱えていた。**この4つはキャラクタの性質ではなく周回の終わり方**なので、
`domain/wrappers/Ending.ts` へ移し、`PlayerCharacter.ending` から取る形にした。

**2つの真偽値を1つの `kind` にできた。** 死と脱出は同時に起こらない（死ねば世界の中に居らず、
本土の中にも居ない）——旧実装はそれを2つの真偽値で表し、`playbackSteps` が
「`isDead` が先」という優先順位を書いて排他を作り直していた。`EndingKind`（`'death' | 'escape'`、
未決着は undefined）にすると、その順位が要らなくなる。**「本土に着いていても死が先」を確かめる
テストも消えた**——起こりえない入力を確かめていたので、型で消える。

旗を持たない（居場所がそのまま答える）という決まりはそのまま。`Ending` はプレイヤーの
`WorldObject` を包む `ObjectWrapper` で、`Location` や `Animal` と同じ形。

## 17. 段4 レーンA-6（描き替えを跨いで生き残るページ）

ビューアのページは `render(view) => string` の関数だけだったので、描き替えを跨いで残る状態が
モジュール変数になっていた（`balancePage.lastTables`、`main.ts` の `networkZoom`）。
`CodexPage`（抽象）を置き、**ルートごとに1つだけ作って使い回す**形にした。

ページが持つのは4つ: `route`、`render(view, args)`、`wire()`（描き込んだ後の配線。既定は何もしない）、
`scrollToSection(name)`。最後のものは `sectionId(name)` と `scrollOptions` の2つをページが答えて、
**送り方そのものは基底の1箇所**にある——旧実装は `main.ts` が3ルートぶん同じ形の呼び出しを並べ、
差は「idの作り方」と「中央へ寄せるか」だけだった。

`main.ts` から出ていったもの: `renderRoute` の9分岐、`wireObjectFilter`、`wireNetworkZoom` と
`networkZoom`、`scrollToSection` の3回の呼び出し。残ったのは**ページの一覧1つ**と、
名前の見せ方・読み込みだけ。ページを1枚足すときに `main.ts` を触るのは一覧への1行だけになる。

`renderBalancePage` が書いていた `lastTables` は `BalancePage.tables` に、`wireBalanceMenu` は
そのページの `wire()` になった（表を引数で受け取るので、モジュール変数を読み直さない）。

`render` は**引数が足りなければ undefined**を返し、`main.ts` がそれを「見つかりません」に倒す。
旧実装の `route === 'object' && first !== undefined` という条件が、ページ側の1箇所へ移った形。

## 18. 段4 レーンA-7（実体化された島）——保留。問題の中身

**着手していない。** ここに書くのは「何が問題か」だけで、直し方は決めていない。

`IslandMap`（`src/domain/generation/IslandMap.ts`）の doc は自分をこう名乗っている:

> 地形生成の結果（サイト・型・命名・パスネットワーク）を表す**不変のデータ**。
> TerrainGenerator.generateの出力であり、**WorldObjectには一切触れない純粋な計算結果**。

同じクラスがそのすぐ下でこう持っている:

```ts
/** サイトindex→実体化されたLocationのWorldObject.instanceId（IslandSpawnerが埋める。未実体化なら0）。 */
readonly siteInstanceIds: number[];
```

`readonly` が付いているのはフィールドの再代入だけで、**中身は書き換わる**。実際
`IslandSpawner.populate` が `map.siteInstanceIds[site.index] = location.instanceId` と後から書き込む。

**1つのオブジェクトが2つの生涯を兼ねている。**

| | 純粋な生成結果 | 実体化後の対応表 |
| -- | -------------- | ---------------- |
| いつ在るか | 種から計算した直後 | `populate` を通った後 |
| 不変か | 不変 | 書き換わる |
| 何を知るか | サイト・辺・命名 | どのサイトがどの `WorldObject` になったか |

そこから出ている具体的な傷が3つ:

1. **「まだ実体化していない」を 0 という番人で表している。** `nameOfInstance` は
   「instanceIdの発行は1始まりなので、0は必ず該当なし」というコメント付きで0を弾く。2つの生涯が
   同じ配列を共有しているからで、対応表が実体化と同時に生まれるなら、そもそも空の状態が無い。
2. **不変を名乗っているのに渡せない。** 受け取った側は誰でも `siteInstanceIds` へ書き込める。
   純粋な計算結果として共有・比較・キャッシュできるという性質が、実際には無い。
3. **読む側が「サイト index → instanceId → WorldObject」を毎回自分で辿っている。**
   `IslandSpawner.placePlayerAt` は `findDescendantByInstanceId(map.siteInstanceIds[site.index])`、
   `PlayScreenView` も `game.map.siteInstanceIds[site]` を直に引いている。テスト4本も同じ形。

なお、セーブは対応表を保存していない。保存するのは種（`SaveData.seed`）とサイト index だけで、
読み込み時に**同じ種から生成し直して `populate` をやり直す**（`NewGame.ts`）。
つまり対応表は毎回作り直されるものなので、**生成結果と寿命が違う**ことは保存側からも見える。

決める必要があるのは「2つに割るか」と、割るなら**対応表を誰が持つか**（`populate` の戻り値か、
`NewGameSession` のような抱える側か）。`map.siteInstanceIds` を直に読んでいる呼び出し側が
`PlayScreenView` とテスト4本あるので、割るとそこの書き換えが要る。

### 追記: セーブが世界を保存するようになると、答えが変わる

18節は「セーブは対応表を保存せず、種から作り直す」を前提に書いたが、**それは暫定処置**で、最終的には
生成された世界そのものが保存・ロードされ、生成アルゴリズムは新規ゲームでしか動かなくなる。
この前提で調べ直すと、2つ変わる。

**1. 「寿命が違う」が具体的になる。** 今は両方とも毎回まとめて作り直されるので、寿命の違いは
理屈の上の話でしかなかった。世界を保存するようになると、**世界（インスタンス）はセーブから、
生成結果（サイト・辺・命名）は種から**来る。対応表は種からは復元できない——instanceIdは
spawn のときに決まるものだから。derived な値ではなく**保存される状態**になる。

**2. 行き先が変わる。対応表そのものが要らなくなる可能性が高い。** 生成が終わった後に `IslandMap` を
読んでいるのは2箇所だけで、どちらも `sites`/`edges` を見ていない。

| 読む側 | 何のために |
| ------ | ---------- |
| `PlayScreenView.locationNameOf` | `nameOfInstance`（`LocationName` ＝ 型の識別子・亜種の識別子・通し番号） |
| `PlayScreenView.discoveredMap` | サイトindex ↔ instanceId の翻訳だけ。道も既知の土地も**世界から**導いている |

- `LocationName` の型名は**インスタンスの `def` がすでに知っている**。残るのは亜種の識別子と通し番号で、
  どちらも個体ごとの事実なので、世界を保存するなら**土地のインスタンスが持つのが自然**。
- サイトindexは「土地を指す恒久キー」としてしか使われていない（地図画面のカード位置、`SaveData`）。
  ところが**世界を保存するなら instanceId がすでにその恒久キー**である——`path` の `destination_id` が
  instanceId を持っている以上、セーブは instanceId を保たなければ壊れる。

つまり行き先は「純粋な生成結果と対応表の2つに割る」ではなく、**実体化のときに命名を土地へ書き込み、
`IslandMap` は生成の中だけで完結して捨てられる**、になりそう。18節が作ろうとしていた「実体化された島」
という概念は、いま作ると後で消すことになる。

**なので A-7 は開けたままにする。** 直し方はセーブの形式が決まってから決める。そのとき決める必要が
あるのは「**土地を指す恒久キーは何か**」の1点で、`SaveData.MapCardPosition.site` のコメント
（「同じシードなら同じ土地を指し続ける恒久キー」）は、まさに暫定処置のほうを前提にしている。

## 19. 操作のきっかけと、`actions`/`combinations` の統合

設計は [`InteractionTrigger.md`](./InteractionTrigger.md)。YAMLの2つの節を `interactions` 1つにし、
きっかけを `trigger` として宣言させた。

```yaml
interactions:
  explore: {trigger: menu, ...}
  turn: {trigger: tick, ...}
  strike: {trigger: {drag: {tag: weapon}, allow_multiple: true}, ...}
```

### 設計案から変えたところ

**JSONスキーマの `action_def` と `combination_def` が1つに畳めた。** 設計案では触れていなかったが、
2つの `$defs` は効果の動詞（`set`/`add`/`destroy`/…）を丸ごと重複させていて、違いは
`showMenu` と `with` の1キーだけだった。`interaction_def` 1つ＋`trigger` の `oneOf` になり、
スキーマは78行減った。

**codex-viewer は節を分けずに1つにした。** 宣言が1つの並びなので、ページも宣言順のまま出す
（各操作が自分のきっかけを名乗る）。

### 予告どおり消えたもの

`ObjectDef` のコンストラクタにあった名前衝突の検査。節が2つあるせいで書いていたもので、
1つの map になれば YAML の側で一意になる。`RawDeclarationBody` の trait 合成も2本から1本へ。

### 実行時のクラスは分けたまま

`Action` / `Combination`（`Interaction` の具象）は残した。`Combination` は dragged が必ず居ることを
型引数で保証していて、統合すると「居るかもしれない」を実行時に見る形へ戻る。

### 残した宿題: `ActionDef` / `CombinationDef` という名前

YAML から `actions` / `combinations` の語が消えたのに、宣言のクラス名は残っている。`ActionDef` は
今や「相手を伴わない操作（`menu` と `tick`）」で、YAML を grep しても `actions:` は見つからない。
実行時の `Action` / `Combination` の対と揃えて残したが、**名前と現実はずれている**。
きっかけを持つ小さなオブジェクト（`MenuTrigger`/`TickTrigger`/`DragTrigger`）へ畳んで
`InteractionDef` 1クラスにできるかは、別の作業として見る。

### 移行の規模

同梱YAML 13ファイル（`actions:` 29・`combinations:` 26 → `interactions:` 51。4つの型は両方の節を
持っていたので1つへ寄せた）、サンプルパック1ファイル（ZIPも固め直し）、テストのフィクスチャ20ファイル、
docs 12ファイルとJSONスキーマ。パッチのパス（`x.actions.y`）も `interactions` へ。

## 20. 段4 レーンA-13（周りの物を候補にする `pick`）

設計は [`PickAmong.md`](./PickAmong.md)。`Animal.ts` は**丸ごと消えた**。

### 入った語彙

- **`among`**（10.3節）: `pick` の候補に「周りから相手を1つ選ぶ」を書ける。集合の指し方は条件の
  `{subject, slot, matches}`（14.4節）と同じ3つのキーで、足したのは候補ごとの重みだけ。
  選ばれた相手は参照ルート `picked` で指す。
- **`matches` の否定**（`{not: ...}`）: `TypeMatchRule` が `tag | object | not` の3形に。
  `accept`・`with`・`slot_content`・`object_matches` すべてで使える。
- **`picked` を指せる先**: 条件・効果の対象・`spawn` の `into`・`destroy`・`move`。

`move` の `to`／`subject` が**マップ形も受けるようになった**（`{subject: picked, prop: destination_id}`）。
`ObjectRef` のプロパティ参照は self 固定だったが、`PropertyPath`（root + プロパティ）を持つ形にした
——`to_prop`/`subject_prop` の短い書き方はそのまま残る。

### 消えたもの

`animals.yaml` から**プロパティ8つ**（`nearby_characters` `lootables` `loot_target` `spoils_target`
`smashables` `smash_target` `escape_routes` `flee_to`）と、**ゲートの passives 5つ**。
ロケールの説明文も8つ消えた。`WorldVocabulary` からは11の識別子が消えた
（上の8つ＋`spoils`・`quarry`・`fragile`。エンジンが名前で引く必要がなくなった）。

`src/domain/wrappers/Animal.ts` は消滅。`World.runAnimalTurns` と `Location.runAnimalTurns`
（スロットの名前を知っているだけの中継）も一緒に消えた。

### 手番を配るのは `WorldObject.runTickActions`

[`PickAmong.md`](./PickAmong.md) 9節のとおり、tick の後の2周目にした。
`WorldSession.runTick` は `tick()` → `runTickActions()` の2行のまま。

**集めてから配る。** 走査しながら配ると、逃げてまだ回っていない土地へ移った動物へ二度手番が回る
——これは**既存の不具合**で（`Location.runAnimalTurns` が土地ごとに遅れてスナップショットを取る）、
集める形にして消えた。手番の途中で消えた個体は、根が変わることで飛ばされる。

配る範囲は「島の土地の items」から**世界全体**になった。罠の中でも手番は回るが、周りに相手が
居なければ候補が全部外れて様子見になるだけ——**何ができるかを決めるのは世界の側**。

### 挙動が変わったところ

- **襲う相手が抽選になった。** 今までは `characters.at(0)` 固定。人が2人以上居る場面が無いので差は出ない。
- **かさ0の物は狙われない。** 旧実装の `Math.max(1, volume)` の下限は設けなかった（PickAmong 6節）。
- 「人が居なければ襲えない」を確かめていたテストが、**重みが0に潰れること**を見ていた。重みは配分の
  ままになったので、観測できる事実（怪我が増えない）で確かめる形へ直した。

## 21. 枠の並び（`CellLayout`）

`Slot` の3つの責務（受け入れ判定・中身の保持・置き場所を作る配置）のうち、後ろ2つを
`src/domain/CellLayout.ts` へ移した。`SlotCell` も一緒に移っている。`Slot` に残ったのは、owner と
`SlotDef` を見て答える問い合わせ（`rejectionFor` `acceptedCount` `putInMinutes` `fillRatio`）だけ。
公開APIは変えていないので、`WorldObject` 側は何も知らない。

### 分けたのは責務ではなく、分岐が散っていたこと

11メソッドを移すだけなら場所が変わるだけで終わる。`Slot` が読みにくかった本体は
**「枠数を決めたスロット / 前詰めのスロット」の分岐が10箇所に散っていた**ことで、
`vacancyFor` `findCellFor` `removeInternal` `restack` `placeSameSlot` `insertAt` `tryInsertAtGap`
`tryInsertAtCell` `tryMoveStackToGap` `tryMoveStackToCell` がそれぞれ自前で二股に分かれていた。

**この2つは別のアルゴリズムではない。** 前詰めのスロットは枠の宣言が共有の1つなので、

- 挿入の `splice` は「末尾に空き枠を1つ生やして、そこから右へ中身をずらす」と結果が同じ。
- 並び替えの「抜いて入れ直す」は「抜いた跡を空き枠として残し、そこへ向けてずらす」と結果が同じ。

差は次の3つに畳めて、それぞれ1箇所でしか効かない。

| 規則 | 効く場所 |
| ---- | -------- |
| 空き枠が無いとき末尾に枠を足せるか | `tryGrowCell` |
| 空になった枠を残すか | `emptyCell` |
| 位置の指定が枠を直接指せるか | `pointsCell` |

`hasFixedCells` を見るのは、この3つと `vacancyFor`（増える枠に上限が無いこと）の4箇所だけになった。
`tryInsertAtGap` / `tryInsertAtCell` / `tryMoveStackToGap` / `tryMoveStackToCell` / `findCellFor` /
`insertGrownCell` / `tryPlaceAdjacent` は消え、置き方は
`tryPlaceAt`（位置の指定→枠 or 隙間）→ `tryPlaceAtGap` → `tryPlaceShifted` の一本になった。

**却下した案**: 抽象 `CellLayout` ＋ 固定/前詰めの2実装。差が宣言 `cellsToKeep` 1つに畳める以上、
型を2つに割る根拠が無い（仕組みの数が既存のケース数と同じになり、何も畳めていない）。

### 挙動

保存。`tests/domain/stacking.test.ts`（21件。左シフトのフォールバックと押し出し順まで見ている）と
`fieldItemPlacement` / `handPlacement` / `cells` / `slotCells` がそのまま通る。

隙間の指定を並びの範囲へ収める（`clampIndex`）のは、前詰めのスロットだけの処理だったのを両方に
広げた。範囲外の隙間を枠数固定のスロットへ指すと、今までは失敗し、今は端として扱う。
UIが作る隙間番号は常に範囲内なので差は出ない。

新しく足したのは、**前詰めのスロットにはどの操作の後にも空き枠が残らない**ことを確かめるテスト1件
（`fieldItemPlacement`）。ずらしで場所を作る形にしたので、生やした枠が使われずに残らないことが
不変条件になった。

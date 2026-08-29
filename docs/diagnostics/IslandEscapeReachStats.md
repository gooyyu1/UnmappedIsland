# 生成された島ごとの脱出可否レポートの読み方

数値は [`stats/island_escape_reach.yaml`](../../stats/island_escape_reach.yaml) にあります。
`tests/diagnostics/islandEscapeReachStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）から
島を生成して数えたものです。工程（`interactions`・`recipes`・range系イベントの周期）・土地の発見物・
生成の定義（`terrain_generation.yaml`）を変更したら再生成します。

```
npm run stats:escape-islands
```

**この文書は手書きで、再生成しても書き換わりません。** 持つのは読み方——何を測ったか、どこに線を
引いたか、何を数えていないか——だけです。**数値そのものは1行も書きません**（書けば、再生成した
YAMLとずれます）。

## YAMLの節

`unit` は、そのレコードの測定値の単位です。件数（`seeds`・`islands`・`defined_locations`・`goals`・
`n`）は単位を持ちません。

| 節 | 中身 |
| --- | --- |
| `meta` | 回した種の数、数えた島の数、定義上の島の土地の数、目標そのものの数 |
| `island_departure` | 島1つが持っていた土地の型の数の分布 |
| `island_missing_location` | 土地の型ごとに、それを持たない島の割合 |
| `island_unreached` | **島を出られない島の割合**（要るものが1つでも届かない島） |
| `island_goal_unreached` | 目標そのもの（`boat`・`sail`・`fishing_tool`）ごとに、それへ届かない島の割合 |
| `island_goal_hops` | 目標そのものごとに、届いた島での工程数の分布 |
| `island_unreached_need` | 届かなかった型ごとの島の割合（鎖のどこが切れたか。**鎖が閉じていれば空でもよい**） |

**この表とYAMLが食い違うと `npm test` が赤くなります。** 表に挙げた節がYAMLに在って空でないことと、
表に無い節がYAMLに無いことの両方を、生成元のテストが見ます。

## 計測方法

数え方の線は `src/analysis/escapeReach.ts` の冒頭が持ちます。
[`EscapeReachStats.md`](./EscapeReachStats.md) との違いは**出発集合だけ**で、あちらが定義上の島の土地
すべてを置くのに対し、こちらは**生成された島が実際に持つ土地だけ**を置きます。島は土地の型を
取りこぼす（`island_missing_location`）ので、こちらの出発集合はあちらの部分集合になります。

- **島は引き直さない。** 種ごとに1つの島を数え、その島で鎖が閉じるかを見ます
  （[`ContentSkeleton.md`](../world/ContentSkeleton.md) 2.3.1節）。
- **開始地点は数えない。** 見るのは島が持つ土地の集合だけで、そこへ歩いて行けるかは
  [`StartupReachStats.md`](./StartupReachStats.md) が持つ軸です（生成は全土地を道で繋ぐので、
  行けるかではなく在るかが分かれ目になります）。
- **個数も時間も数えない。** 数えるのは鎖が閉じるかと工程数だけで、材料が何個要るか・何日かかるかは
  見ません。
- 回す種の数は `startup_reach.yaml` と同じ2,000です。同じ島の配りを別の軸から測る表なので、母数を
  揃えないと2つの割合を並べて読めません。

## 出られない島

`island_unreached` が、この表がいちばん答えたい数——**その周回で島を出られない島の割合**です。
要るものが1つでも届かない島がこれにあたり、島を出るには `boat`・`sail`・`fishing_tool` がすべて
要るので、`island_goal_unreached` のどれかが立った島と同じものを数えています。

**0でありうるのは仕組みの側です**——島を出るのに要るものは、どれも入口を2つ以上持ち、そのうち1つは
**どの島にも必ず在る海岸**（`hull_coast` が外周を海岸帯にする）から届きます
（[`ContentSkeleton.md`](../world/ContentSkeleton.md) 5節）。

`island_unreached_need` は、その島で届かなかった型。目標そのものだけでなく、そこへ至る鎖の途中の型と、
**その型を生みうる工程が要求する型**（島に無い土地を含む）が並びます——切れ目の先だけが広がるので、
ここに並ぶ土地が「その島に足りなかったもの」を指します。

**このレポートは判定を出さない。** 出られない島が在ってよいか、直すなら生成の側（土地の配り）か
材料の出どころを増やす側かを決めるのは、この数字を見てからです。定義の上で鎖が閉じていることの
赤/緑の判定は `tests/integration/escapeReach.test.ts` が持ちます。

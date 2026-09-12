# 発見物の行き渡りレポートの読み方

数値は [`stats/discovery_coverage.yaml`](../../stats/discovery_coverage.yaml) にあります。
`tests/diagnostics/discoveryCoverageStatsReport.test.ts` が、定義（`src/assets/world-codex/*.yaml`）から
島を生成して数えたものです。土地の発見物（`locations.yaml` の `explore`）・型の札（`tags`）・生成の定義
（`terrain_generation.yaml`）を変更したら再生成します。

```
npm run stats:discovery
```

**この文書は手書きで、再生成しても書き換わりません。** 持つのは読み方——何を測ったか、どこに線を
引いたか、何を数えていないか——だけです。**数値そのものは1行も書きません**（書けば、再生成した
YAMLとずれます）。

## YAMLの節

`unit` は、そのレコードの測定値の単位です。件数（`seeds`・`islands`・`objects`・`tags`）は単位を
持ちません。

| 節 | 中身 |
| --- | --- |
| `meta` | 回した種の数、数えた島の数、探索で見つかる型の数、そのどれかが持つ札の数 |
| `object_sources` | 探索で見つかる型ごとに、その型が持つ札と、その型を出す土地の型 |
| `tag_sources` | 札ごとに、その札を持つ、探索で見つかる型 |
| `island_missing_object` | 型ごとに、その型を出す土地が1つも無かった島の割合 |
| `island_missing_tag` | 札ごとに、その札を持つ型を出す土地が1つも無かった島の割合 |

**この表とYAMLが食い違うと `npm test` が赤くなります。** 表に挙げた節がYAMLに在って空でないことと、
表に無い節がYAMLに無いことの両方を、生成元のテストが見ます。

## 何のための数か

[`SkillSystem.md`](../engine/SkillSystem.md) 3節の**発見**——探索で未知の物に出会うと腕前が伸びる経路
——を、**型を名指しで書くか、札で束ねて書くか**を決めるための数です。名指しで書いた契機は、その型を
出す土地が1つも生成されなかった島では契機ごと消えます。札で束ねれば、束の中のどれかが出れば済みます。

`island_missing_object` が前者の取りこぼし、`island_missing_tag` が後者の取りこぼしです。

**2つを束ねた1つの数は出しません。** 束ねるには「どの札なら契機に使うか」を先に決めることになり
（`item`・`fixture` のような置き場所の札まで混ぜた合計は、書き方の比較にならない）、それはこの表が
出さないと決めている判定そのものだからです。比べるのは、同じ腕前へ配るつもりの型と札の行どうしです。

## 計測方法

数え方の線は `src/analysis/discoveryCoverage.ts` の冒頭が持ちます。

- **島は引き直さない。** 種ごとに1つの島を数え、その島にその土地が在るかを見ます
  （[`ContentSkeleton.md`](../world/ContentSkeleton.md) 2.3.1節）。
- **引きの運は数えない。** `pick` の重みが正なら、その土地を探索し続ければいずれ出ます
  （[`ExplorationSystem.md`](../engine/ExplorationSystem.md) 2節、ハズレの候補は置かない）。数えるのは
  島にその土地が在るかどうかだけで、何回目の探索で出るかは見ません。**`island_missing_object` は
  探索の手間ではなく、手間をかけても出ないことの割合です。**
- **亜種は見ない。** 亜種が上書きするのは `pick` の重みだけで、しかも0を跨ぎません
  （[`TerrainGeneration.md`](../engine/TerrainGeneration.md) 3.6節）。出るか出ないかは土地の型だけで
  決まります。**跨ぐ上書きが入ったら、数えずに投げます**——跨ぐと、素の重みだけを見たこの割合が
  黙ってずれるためです（`src/analysis/discoveryCoverage.ts` の `assertVariantsKeepWeightsPositive`）。
- **札は宣言されているものを全部数えます。** 発見の契機に使えるかどうかでは絞りません——絞ると、
  絞り方が数字の出どころに混ざります。`item`・`fixture` のような置き場所の札も並びますが、それらが
  どの島でも消えないこと自体が、**札が効くのは土地の型をまたぐときだけ**という読みの裏付けです。
- **歩いて行けるかは数えません。** 見るのは島が持つ土地の集合だけで、そこへ届くかは
  [`StartupReachStats.md`](./StartupReachStats.md) が持つ軸です。
- **どの腕前へ配るかは数えません。** 型と腕前の対応はまだ書かれていない（`SkillSystem.md` 3.3節）ので、
  ここが数えるのは契機の器が島に在るかだけです。
- 回す種の数は `startup_reach.yaml`・`island_escape_reach.yaml` と同じです（どれも `meta` に
  入っています）。同じ島の配りを別の軸から測る表なので、母数を揃えないと割合を並べて読めません。

## 土地の取りこぼしとの関係

ある型が島から消えるのは、その型を出す土地の型が**すべて**生成されなかったときだけです。土地の型
ごとの取りこぼしは [`stats/island_escape_reach.yaml`](../../stats/island_escape_reach.yaml) の
`island_missing_location` にあり、`object_sources` の `locations` がその行を引くキーになります。
ただし**そちらの割合を掛け合わせてこちらは出せません**——土地の型の生成は互いに独立ではないので
（同じ島に密林と荒野が同居しにくい、など）、同時に欠ける確率は周辺分布からは出ません。

**このレポートは判定を出さない。** この取りこぼしを許すか、札を新設して束ねるか、発見物の配りを
変えるかを決めるのは、この数字を見てからです。

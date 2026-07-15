# pick: 重み付き確率分岐システム

## 概要

本ドキュメントは、天気の急変・探索時のアイテム発見・攻撃の命中判定・生水を飲んでの体調不良など、
「重み付き確率によって複数の結果から1つが選ばれる」という現象に共通して使えるメカニズムを検討した結果をまとめたものです。

`GameElementDefinition.md` が既に定義している `props` / `stages` / `effects`（modify / add / lifecycle）に対して、
できる限り新しい概念を追加せず、既存の語彙の組み合わせで表現することを目指しました。ランダム要素がない場合（候補が1つしかない場合）も、
専用の分岐を用意せず同じ記法で表現できることを重視しています。

本ドキュメントは検討結果であり、確定仕様書ではありません。未決事項は 8 節に整理しています。

## 1. 想定される利用場面

`pick` は、既存の `effects` が付けられる場所（無条件 / `when` / stage 内、GameElementDefinition.md 8.2 節・6.4 節、
および `actions`/`combinations` の効果、`ActionSystem.md`）にそのまま付けられる、新しいトリガー体系を必要としない仕組みとして設計します。
（当初は `on: <アクション名>` というトリガーの中で使う想定でしたが、`on` の仕組みそのものが `ActionSystem.md` の検討により
廃止されたため、以降のサンプルは `actions`/`combinations` の効果として直接書く形に更新しています。）

- 探索時のアイテム発見（`actions.explore` の効果として、複数アイテムから重み付きで1つを選ぶ）
- 攻撃の結果（`actions.attack` の効果として、命中/ミス/クリティカルを重み付きで選ぶ。攻撃は「攻撃対象の敵（self）」と
  「暗黙の行動主体である `actor`」の2者で完結するため、`combinations` ではなく `actions` で表現します。`GameElementDefinition.md` 8.1 節参照）
- 生水を飲んで腹を下すか（`actions.drink_raw_water` の効果として、発症/無事を重み付きで選ぶ）
- 天気の急変など、貯水池モデル（`ClimateSystem.md`）だけでは表現しにくい離散的なイベント

なお「stage に入った瞬間だけ 1 回振りたい」（例: 感染ステージに入った瞬間に重症度を決める）というケースは、
GameElementDefinition.md 6.4 節で保留になっている edge-triggered なステージ切替（`on_enter` 的なもの）が解決しないと実現できません。
この点は本書の範囲外とし、6.4 節の未決事項に委ねます。

## 2. 基本構造

`effects` の各エントリに、既存の `modify` / `add` / `lifecycle`（8.3 節）と並ぶ第4の種別として `pick` を追加します。
`pick` は重み付き候補のリストであり、各候補は既存の効果種別を自由に組み合わせて持てます。

```yaml
actions:
  drink_raw_water:
    showMenu: always
    effects:
      - pick:
          - weight: 10
            add: {}                    # 何も起きない(無事)
          - weight: 50
            lifecycle:
              spawn: { object: diarrhea, into: self.conditions }   # 発症
```

**候補が1つしかない場合は、重みの値に関わらず必ずそれが選ばれます。** つまり「ランダム要素なし」は `pick` の要素数が1のときの
特殊ケースにすぎず、専用の分岐は不要です。既存の防具・耐久値のサンプル（GameElementDefinition.md 11 節）のように重み付けを考える
必要がないケースは、これまで通り `modify` / `add` / `lifecycle` を `pick` なしで直接書けばよく、既存ドキュメントの書き換えは
必要ありません。

## 3. 候補が持てる効果の種類

- 別プロパティへの干渉 → 既存の `modify` / `add`（8.3 節）
- 自身を破壊 → 既存の `lifecycle: destroy`
- 別カードを生成 → **新規**。`lifecycle` に `spawn`（新規オブジェクトを生成する）という動詞を追加する
- 別アクションの実行 → **新規、記法未定**。エフェクトの中から特定のアクションを能動的に発火させる仕組みは今のところない（8 節参照）

`lifecycle: spawn` は、`ClimateSystem.md` で季節切り替えのために提案していた `lifecycle: transition`（自分を破棄し次の季節を生成する）を
置き換えられる可能性があります。`transition` を専用動詞にせず、「`spawn` で次のインスタンスを生成」＋「`destroy` で自分を消す」という
2つの効果の組み合わせとして表現し直せば、`lifecycle` の動詞を1つ増やすだけで両方のケースをカバーできます（8 節の未決事項）。

## 4. weight の表現方法

### 4.1 基本方針: weight は新しい概念を持たない

`pick` の各候補の `weight` は、専用の計算式（base値＋条件付き補正、のような小さな言語）を新設せず、以下のいずれかとして表現します。

- **リテラル定数**: 外部からの干渉を想定しない候補向け。数値をそのまま書くだけです。
- **既存プロパティへの参照**（`{ path: <プロパティのパス> }`）: 外部から干渉させたい候補向け。参照先は、既存の `props` として
  ごく普通に定義された値です。

```yaml
pick:
  - weight: { path: self.accuracy }
    add: { hp: -10 }
  - weight: 40
    add: {}
```

外部からの干渉（「戦闘スキルが高いほど命中しやすい」「体が強いほど感染しにくい」）は、`weight` 自体に専用の補正記法を用意するのではなく、
**参照先のプロパティに対する既存の `modify` 効果**としてそのまま表現します。これは、防具が装着者の `defense` を書き換えるのと
全く同じ仕組みです（GameElementDefinition.md 11.1 節）。

```yaml
props:
  accuracy:
    value: 50

  attack_skill:
    value: 5
    stages:
      - name: trained
        min: 10
        effects:
          - target: self
            modify:
              accuracy: 20
```

`attack_skill` の stage 効果が `target: self, modify: {accuracy: 20}` という、既存の `modify`/`target`（8.2 節・8.3 節）の
範囲内で `accuracy` を書き換えているだけであり、`pick` や `weight` のために新しい概念を追加していません。

### 4.2 なぜ base + 条件付き補正という専用記法を採用しなかったか

検討の初期段階では、「base 50、条件Aが成立で+20、条件Bが成立で-20」のような、Wiki に転記しやすい自己完結した記法
（base値＋条件付き補正のリスト）も候補に挙がりました。読みやすさの面では魅力的ですが、これは `modify`/`stages` と
「似ているが別の」概念を並存させることになり、統合を目指す本書の方針と相容れないため採用しませんでした。
命中率のような「基準値としてそもそも意味のあるプロパティ」（`accuracy` など）は、既存の `props`/`stages`/`modify` の
組み合わせで十分に表現できると判断しています。

### 4.3 命名の指針

新しい基準プロパティ（例: `hit_rate`）を安易に増やさず、既存の防具サンプルに既に登場している `accuracy`
（GameElementDefinition.md 11.1 節）のような、既に確立されたプロパティを再利用することを基本方針とします。
これにより「命中に関わる数値はどこを見ればよいか」がプロジェクト内で一貫します。

## 5. サンプル

### 5.1 攻撃（命中/ミス/クリティカル）

攻撃は、攻撃対象の敵カード（`self`）と、暗黙の行動主体である `actor`（プレイヤーキャラクター、`GameElementDefinition.md` 8.1 節）の
2者で完結するため、`combinations` を使わず `actions` で表現します。プレイヤーは敵カードを選択し、「攻撃」ボタンをクリックします。

```yaml
props:
  accuracy:
    value: 50

object_defs:
  enemy:
    actions:
      attack:
        showMenu: always
        effects:
          - pick:
              - weight: 10
                add: { hp: -20 }               # クリティカル(現時点では固定重み)
              - weight: { path: actor.accuracy }
                add: { hp: -10 }               # 通常命中
              - weight: 40
                add: {}                          # ミス
```

### 5.2 生水を飲んで腹を下すか

これは1枚のカード（キャラクター自身、あるいは水源カード）だけで完結するメニュー型の操作なので、`actions` として定義します。

```yaml
props:
  constitution:
    value: 10

actions:
  drink_raw_water:
    showMenu: always
    effects:
      - pick:
          - weight: { path: self.constitution }
            add: {}                                             # 無事
          - weight: 30
            lifecycle:
              spawn: { object: diarrhea, into: self.conditions }  # 発症
```

### 5.3 探索時のアイテム発見（多数候補、外部干渉なし）

これもロケーションカード1枚だけで完結するメニュー型の操作です。

```yaml
actions:
  explore:
    showMenu: always
    effects:
      - pick:
          - weight: 30
            lifecycle: { spawn: { object: item_coconut, into: parent.inventory } }
          - weight: 50
            lifecycle: { spawn: { object: item_rock, into: parent.inventory } }
          - weight: 1
            lifecycle: { spawn: { object: item_gem, into: parent.inventory } }
```

外部からの干渉が不要な候補は、このようにリテラルの `weight` だけで簡潔に書けます。MOD で特定の候補（例: `item_gem`）の
出現率を変えたくなった場合にのみ、そのアイテムの重みだけを `{ path: ... }` 参照に切り替えて、既存の `props`/`modify` で
干渉できるようにする、という段階的な拡張が可能です。

## 6. フォールバックについて

重みの合計が0になる（例: `constitution` が高すぎて発症側の重みが実質0になる）ケースは起こり得ます。
`TerrainGeneration.md` 3.3 節の「候補がなければ `is_fallback: true` の候補を選ぶ」という考え方を `pick` にも
流用できる可能性がありますが、本書では採否を決めていません（8 節参照）。

## 7. 設計原則のまとめ

- `pick` は新しいトリガー体系を必要としない。既存の `effects` の付け所（無条件 / `when` / stage 内、および `actions`/`combinations` の効果）にそのまま乗る
- ランダムなしのケースは、候補数が1の `pick` として同じ記法で表現できる。専用の「非ランダム」記法は用意しない
- `weight` はリテラル定数か、既存 `props` へのパス参照のいずれかであり、専用の計算式（base＋条件付き補正）を新設しない
- 外部からの重みへの干渉は、既存の `modify`/`stages`/`target` の組み合わせのみで表現し、`modify`/`stages` と類似した別概念を作らない
- 候補が持てる新しい効果は `lifecycle: spawn`（新規オブジェクト生成）のみ。`ClimateSystem.md` の `transition` 動詞は、
  `spawn` ＋ `destroy` の組み合わせに置き換えられる可能性がある

## 8. 未決事項・今後の検討課題

- `weight` の参照記法。`{ path: self.accuracy }` という明示形に統一するか、`weight: accuracy` のような裸の名前も許容するか
- 攻撃の種類（近接/遠隔など）が増えた場合に、命中判定用のプロパティ（`accuracy` 等）を共有するか、種類ごとに分けるか
- `modify` のターゲットが現状 `self`/`parent`/`child`/`actor`（8.2 節）と `combinations` 内限定の `dragged`（`ActionSystem.md`）に
  限定されている点。自分のツリーに属さない対象の重みを外部から書き換えたいケース（例: 「幸運のお守り」が探索の
  宝物発見率を上げる）は、8.2 節の既存 TODO（`target` への `ancestor`/`sibling`/`descendant` 追加）と合わせて
  解決する必要がある
- `pick` の候補から「別アクションを実行する」ための記法。エフェクトからアクションを能動的に発火させる仕組み自体がまだない
- 重みの合計が0（またはマイナス）になった場合の扱い。フォールバック候補（6 節）を許容するかどうか
- `lifecycle: spawn` の具体的な記法（生成先スロットの指定方法など）
- `lifecycle: spawn` の導入に伴い、`ClimateSystem.md` の `lifecycle: transition` を `spawn` ＋ `destroy` に置き換えるべきか
- 乱数のシード管理方針（`TerrainGeneration.md` は地形生成のシード値を明言しているが、戦闘・探索・気候などゲームプレイ全般の
  乱数と同じ系列にするか、別系列にするか）

## 9. 参考: 既存プロジェクト方針との整合性

- 本書全体を通じて `derived`（GameElementDefinition.md 6.5 節、採否未確定）を一切使用していません。`weight` の外部干渉という、
  一見「専用の計算式が欲しくなる」代表例が、既存の `props`/`stages`/`modify` の組み合わせだけで表現できることを示しており、
  `ClimateSystem.md` に続いて `derived` が不要であることのもう一つの具体例になっています。
- `weight` を `props` の参照として扱う設計は、GameElementDefinition.md 8.1 節の条件式（`{path, op, value}`）で確立された
  「パスによる参照」という考え方をそのまま踏襲しています。
- `lifecycle: spawn` の追加、および `target` の拡張（ancestor/sibling/descendant）という2つの論点は、いずれも
  `GameElementDefinition.md` に既にある未決事項と同じ形で解決を要する、という点で一貫しています。

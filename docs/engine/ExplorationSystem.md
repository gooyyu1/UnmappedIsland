# 探索・道システム設計

## 概要

本ドキュメントは、[`TerrainGeneration.md`](./TerrainGeneration.md) の地形生成パイプラインによって作られた
`Location`（土地）が、生成された**あと**にどう振る舞うかをまとめたものです。「島にどんな土地がいくつ、どう
配置されるか」は `TerrainGeneration.md` の関心事、「1つの土地に立ったプレイヤーが何をできるか（探索する・道を
見つける・移動する）」は本書の関心事、と役割を分けています。

[`GameElementDefinition.md`](./GameElementDefinition.md) の既存文法（`traits`・`slots`・`props`・`actions`・
`pick`）と、汎用拡張 `duration`（同 11.3 節）・`move`（同 9.6 節）だけで組み立てており、探索・道専用の
新しい文法は導入していません。

本ドキュメントは検討結果であり、確定仕様書ではありません。未決事項は 6 節にまとめています。実際のクラス名・
メソッド名を使った実装の呼び出し関係（`IslandSpawner`・`MoveEffect`・`Location.explore` 等）は
[`TerrainGenerationImplementation.md`](./TerrainGenerationImplementation.md) にまとめています。

## 1. `location` trait と `explorable` trait の役割分担

「場所」であるという構造（3種のスロット）と、「探索できる」という性質（進捗・道の発見）は、**別々の trait**
に分けています。家・作業小屋のような探索できない場所も3種のスロットは必要なため、スロットは `explorable` では
なく `location` trait（`core.yaml`）側に置いています。

- **`location`**（`core.yaml`）: あらゆる場所が共通して持つ構造。**3種のスロット**（`items`/`fixtures`/
  `characters`）と、`world.locations` スロットの枠が受け入れる型のタグ配布。
- **`explorable`**（`locations.yaml`）: 探索**できる**場所だけが追加で持つ構造。探索進捗プロパティと、
  未発見の設置物を隠しておくスロット（`undiscovered_fixtures`）。

```yaml
# core.yaml
traits:
  location:
    tags: [location]
    slots:
      items:
        cell: {accept: {tag: item}}
      fixtures:
        cell: {accept: {tag: fixture}}
      characters:
        cell_count: 1
        cell: {accept: {tag: character}}
```

```yaml
# locations.yaml
traits:
  explorable:
    slots:
      # locationのfixturesより後に宣言する（探索で湧く設置物が隠し側へ入らないように）。
      undiscovered_fixtures:
        cell: {accept: {tag: fixture}}
    props:
      exploration_progress: {}   # valueなし = 実装する側で必須（5節）
```

草原などの探索可能な土地は両方（`traits: [location, explorable]`）、家のような場所は `location` のみを
参照します。

### 1.1 3種のスロット（`location` trait）

すべての場所は次の3種のスロットを持ちます。いずれも `capacity`（サイズの合計制限、7.3 節）は指定していません。

- **`items`**: アイテムが置かれるスロット。
- **`fixtures`**: 木や植物、建築物や家具、洞窟の入口などの設置物が置かれるスロット。
- **`characters`**: キャラクタを入れるスロット。`cell_count: 1`（枠が1つなので位置も安定する、
  スタック数1つだけ）。

`items`/`fixtures` の区別はタグ（`item`/`fixture`）だけで行い、探索の発見物（2 節）を `spawn` する際、
どちらのスロットへ入るかは著者がスロット名を指定せずとも自動的に決まります（`spawn` の `into` が起点の持つ
スロットを宣言順に走査する、9.4 節）。`items` を宣言順の先頭に置いているのは、`spawn` が配置に失敗した際の
フォールバック（起点自身の親へ強制配置、9.4 節）が同じく先頭のスロットへ入るためで、「持ちきれない発見物は
地面（土地の `items`）に落ちる」という直感的な結果を、追加のルールなしに実現しています。

### 1.2 道の2スロット（隠しスロット方式、`explorable` trait）

土地同士の繋がりは、**探索によって見つかる `path` という専用オブジェクト**として表現します。「発見」は
隠しスロット方式で実装しています。生成時点で道は `undiscovered_fixtures`（隠し）に置かれ、探索の進捗が道ごとの
必要値に達すると `fixtures`（公開）へ移動して「発見」されます。この移動は既存の `move_to_slot`（唯一の汎用
スロット移動操作、7.1 節）1回で表現でき、UI 側は「`fixtures` の中身をそのまま表示する」という単純な
規約だけでよく、未発見の道を非表示にする特別な処理を持ちません（道を1スロットに置き移動アクションの条件で
実行だけ禁止する方式は、UI側に隠す処理が別途必要になり「発見」が実体を持たないため不採用）。

## 2. 探索（`explore` アクション）

「探索で何が見つかるか」と探索率100%までの探索回数（進捗プロパティの上限）は、`explorable` trait ではなく
土地ごとの `object_defs`（`locations.yaml`）が個別に定義します。`explorable` trait 自身が持つのは、進捗を
保持する箱（`exploration_progress`）と道の発見に使う2スロット（1.2 節）という共通の器だけです。

```yaml
object_defs:
  grassland:
    traits: [location, explorable]
    props:
      exploration_progress:
        value: 0
        range: {min: 0, max: 12}   # 探索率100%に達するまでの探索回数
    actions:
      explore:
        showMenu: always
        duration: 15
        add: {self: {exploration_progress: 1}}   # 何が見つかっても進捗は1つ進む
        pick:
          - weight: 25
          - weight: 25
            spawn: {object: water_spinach, into: self}
          # ...
```

- **探索率100%までの回数**: `exploration_progress` の `range.max`（10〜20 の範囲、土地ごとに異なる）。
- **100%に達しても探索は続けられます**。`explore` に進捗の上限を見る `conditions` は置いていません。
  上限を超えた進捗は `range` の既定のクランプ（`GameElementDefinition.md` 6.3 節）で `range.max` に
  張り付くため、探索率は100%のまま、`pick` による発見物だけが増え続けます。100%到達で変わるのは、
  生成時に仕込まれた道（3.2 節）がそれ以上見つからなくなることだけです。
- **発見物**: `pick`（10 節）による重み付き抽選です。**ハズレの候補は置かず、1 回の探索で必ず 1 個以上
  見つかります**。候補ごとに見つかる数は 1〜3 個で、実りの多い土地は平均 2 個、荒野・山頂・岸壁のような
  乏しい土地は平均 1.6 個になるよう重みを配っています（`tests/world-codex/explorationYield.test.ts` が
  検証）。設置物（木・茂み・洞窟の入口など）は 1 回に 1 つまでとし、数で増えるのはアイテムだけです。
  進捗+1（`add`）はどの候補が選ばれても起こるので、`pick` の外に1つだけ置いています（9.7 節）。
- **発見量のつまみ**: 一部の候補は `weight` をリテラルではなくプロパティ参照（`{prop: berry_find}`）で
  持ちます。素の重みは土地の `props` が持ち、**亜種**が土地ごとに上書きします
  （[TerrainGeneration.md](./TerrainGeneration.md) 3.6 節）。「少しだけ木苺の多い森」の類を、地形の
  種類を増やさずに作るための仕組みです。つまみは、その土地を特徴づける候補にだけ置きます。
- **`duration`**: 1回の探索にかかる時間（分、`GameElementDefinition.md` 11.3 節）。**全土地とも
  1 tick（`minutes_per_tick` = 15 分）**に揃えています。1回の探索がちょうど1 tick 分の世界の変化に
  対応するため、探索を繰り返しても時計とゲーム内の変化が刻みからずれません。土地ごとの探索の重さは、
  探索率100%までの回数（`exploration_progress` の `range.max`）だけで表します。

### 2.1 出くわす獣は、単独の候補

**生きた獣（`animals.yaml`）も `pick` の候補です。** 島に獣を放つ専用の仕組みは持ちません——サル・
イノシシが世界に現れる経路は探索だけで、罠が捕るのはネズミ・ヤケイだけです
（[`TrapSystem.md`](./TrapSystem.md) 3 節）。どの土地にどの獣が出るかと、その素の重みは
[`Animals.md`](../world/Animals.md) 4〜5 節の分布に従い、他の発見物と同じ**つまみ**（`monkey_find`・
`wild_boar_find`）として土地の `props` が持ちます。

**獣の候補は、その獣を1匹だけ湧かせます**（`tests/world-codex/explorationYield.test.ts` が検証）。
獣は収穫ではなく出くわすもので、木の実や枝と一緒に並ぶと実りの一部に見えてしまうためです。**重みは
他の候補より一桁低く**（3〜4 に対し 10〜20）、1回の探索で獣に出くわす確率は土地全体で 4〜5% です。

湧いた獣は `wariness` を持った状態で土地の `items` に立ちます（[`HuntingSystem.md`](./HuntingSystem.md)
3.1 節）。放っておいても `stay_remaining` が尽きれば立ち去る（同 5.6 節）ので、島に溜まり続けることは
ありません。

## 3. 道（`path` object_def）と移動

```yaml
object_defs:
  path:
    tags: [path]
    props:
      travel_minutes:
        value: 60          # 生成時にインスタンスごと上書きされる
      required_progress:
        value: 1           # 同上
      destination_id:
        value: 0           # 同上（移動先LocationのインスタンスID）
      return_path_id:
        value: 0           # 同上（移動先にある、こちらへ戻る道のインスタンスID）
    actions:
      travel:
        showMenu: always
        conditions:
          - {in_slot: fixtures}   # 発見済み（fixturesスロット）の間だけ実行できる
        duration: {prop: travel_minutes}
        move:
          subject: actor
          to_prop: destination_id
```

- **`travel_minutes`/`required_progress`/`destination_id`/`return_path_id`** はいずれも `path` の通常の
  `props` で、地形生成
  （`src/domain/generation/IslandSpawner.ts`）がインスタンス生成の直後に `setProperty` で書き込みます。`object_defs`
  レベルの初期値はプレースホルダで、実際に使われるのは常にインスタンスごとの上書き後の値です。
- **`conditions: [{in_slot: fixtures}]`**（`GameElementDefinition.md` 14.2 節）が「未発見（`undiscovered_fixtures`
  側）の間は移動できない」を表します。1 節の隠しスロット方式と組み合わさり、「発見されていない道は移動も
  できない」が自然に両立します。
- **`move`**（`GameElementDefinition.md` 9.6 節で新設した汎用の active 動詞）が、`actor` を `destination_id`
  が指すインスタンスへ移動させます。移動先を `object_defs` の id（型）ではなくプロパティ値（インスタンスID）
  で指しているのは、同じ `LocationType` の土地が1つの島に複数存在しうる（例: 「花咲く草原」と「露の草原」）
  ため、型ではなく**生成時に確定した特定の個体**を指す必要があるからです。

### 3.1 道は辺1本につき両端へ2個、発見は両側同時

地形生成（`TerrainGeneration.md` 3.5 節）が確定させる `Location` 間の1本の繋がりに対し、`path` インスタンスを
**両端に1個ずつ**生成します。片方は「Aの `undiscovered_fixtures` に居て、`destination_id` はBを指す」、もう片方は
その逆です。2個に分けるのは、どちらの土地から見るかで行き先（＝カードに出す土地名）が変わるためです。

**発見は両側同時**です。生成時に両端の `path` へ互いの `instanceId` を `return_path_id` として書き込んでおき、
片方を公開する際にもう片方も一緒に公開します（`Location.revealDueFixtures`）。片側だけを公開すると、
渡った先の土地を `required_progress` に達するまで探索し直さない限り戻れず、行き止まりに閉じ込められた
ように見えます。歩いた道の帰り方は分かる、という直感とも一致します。

`required_progress` は「その土地を探索して自力で見つける」ための条件として引き続き働きます。一度も渡って
いない土地の道は、その土地の探索でしか見つかりません。

### 3.2 required_progress の割り当て（探索率100%に達する前に道が見つかることの保証）

「探索率が100%に達する前にすべての道が見つかる」ことを、データの調整ではなく**生成側の不変条件**として
保証しています。

ある土地に接続する道が K 本あるとき、それぞれの `required_progress` を、探索の上限を `max` として
`[2, max − 1]` の範囲へ均等間隔で割り当てます（`src/domain/generation/IslandSpawner.ts`）。最初の道が進捗2で
見つかる（1回目の探索でいきなり道が見つからないようにする）のを最速とし、最後の道は必ず `max − 1` 以前に
見つかります。この不変条件は `tests/generation/islandSpawner.test.ts` が全接続について検証しています。

100%到達後も探索は続けられますが（2 節）、進捗は `max` に張り付くため、新たに条件を満たす道はもう
現れません。「探索率100%＝この土地の道は出尽くした」という保証は、この割り当てが与えています。

## 4. エンジン拡張（`duration`・`move`）

`duration`・`move` は地形・探索専用ではなく、どんな `actions`/`combinations`/`pick` からも使える汎用の
文法拡張です。

- **`duration`**（`GameElementDefinition.md` 11.3 節）: アクションの実行にかかるゲーム内時間（分）。
  リテラルか `{subject, prop}` 参照（`weight` と同じ二択）で指定します。時間は効果の適用より**先**に
  `WorldSession.advanceWorldTime` で進めます（順序とその帰結は
  [ActionSystem.md](./ActionSystem.md) 2 節）。
- **`move`**（`GameElementDefinition.md` 9.6 節）: 対象オブジェクトを、`self` のプロパティが指す
  インスタンスIDのオブジェクトへ移動させる active 動詞。

## 5. カプセル化: 探索の入口を1箇所にする

`Location.explore(actor, session)`（`src/domain/runtime/views/Location.ts`）を、探索の唯一の入口としています。

```typescript
explore(actor: WorldObject | undefined, session: WorldSession): boolean {
  if (!this.instance.tryExecuteAction('explore', actor, session)) return false;
  this.revealDueFixtures(session);   // 進捗が必要値に達した設置物を、隠しスロットから公開スロットへ移す
  return true;
}
```

プレイヤー側の入口も同じく1箇所です。`PlayerCharacter.explore(session)`（`views/PlayerCharacter.ts`）が
「今いる土地に自分を actor として渡す」という手順を引き受けるため、UI は自分の居場所を知らなくてよく、
探索できない場所に居る場合は `false` が返ります。

`explore` アクション（YAML側）の実行と、後処理の `revealDueFixtures` を呼び出し側（UI等）に分けて呼ばせません
（`CLAUDE.md` の「自分のことは自分でする」方針）。`revealDueFixtures` 自体は冪等なため、進捗がYAML側の効果
だけで動いた場合に備えて単独でも呼べるようにしています。

## 6. 未決事項・今後の検討課題

- **洞窟内部の生成**: `cave_entrance`（探索で見つかる `fixture`）は、`TerrainGeneration.md` 3.7 節が構想する
  「内部に子 `Location` グラフを持つ `Structure`」の入口として先に用意したプレースホルダです。
  `structure_interior` 生成スコープの具体的なスキーマと、洞窟内部への遷移アクション（`move` の応用）は
  未実装です。
- **`spring`（湧き水）の給水アクション**: 発見されるだけのプレースホルダで、`drink` 的なアクションは
  `ContainerSystem.md` の液体表現の実装とあわせて今後の課題です。
- **発見物の `volume`/`weight`**: 探索で見つかるアイテム・設置物は、コンテナ容量（`ContainerSystem.md`）に
  関わる `volume`/`weight` プロパティをまだ持たせていません。
- **同じ土地への道が3本以上ある場合の分布**: 現在の等間隔割り当ては K 本すべてに対して機械的に働きますが、
  「最初の道が見つかるまでが長すぎる／短すぎる」といった体験上の調整は今後の課題です。

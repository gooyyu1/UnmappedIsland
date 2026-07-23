# Domain.Defs と Domain.Runtime の統合方針

## 概要

本ドキュメントは、`Assets/Scripts/Domain/Defs/` と `Assets/Scripts/Domain/Runtime/` を分けている現在の構成を、
今後も維持すべきかどうかを検討した結果をまとめたものです。結論だけ先に書くと、**段階的に統合すべき**です。

ここで言う統合は、まず **「定義を持つ側が、その定義に基づく振る舞いも自分で引き受ける」** という責務の統合を指します。
フォルダ・名前空間を即座に1つへ潰すことは最終段階であり、出発点ではありません。

## 1. 結論

- `WorldObject` / `PropertyValue` / `Slot` / `WorldSession` のような**実行時状態**は Runtime 側に残す
- `ActionDef` / `CombinationDef` / `ConditionNode` / `PassiveEffectGate` のような**定義とその解釈規則**は、
  「定義だけ公開して Runtime 側の補助クラスが読む」形をやめ、定義自身が振る舞いを持つ方向へ寄せる
- したがって、**Defs と Runtime は責務の境界としては現状より強く統合するべき**であり、現在の
  「Defs は public なデータ置き場、Runtime がそれを見て実行する」という分割は維持しない

## 2. 現状の分割で起きている問題

### 2.1 Runtime が Defs の中身を読んで手順を組み立てている

代表例が `InteractionExecutor` です。

- `WorldObject.Def.Actions` から `ActionDef` を探す
- `ActionDef.Conditions` を `ConditionEvaluator` に渡して判定する
- `ActionDef.Active` / `ActionDef.Pick` を見て効果を解決する
- `CombinationDef.With` / `CombinationDef.Conditions` も同様に外側から読む

つまり、アクションや組み合わせの「意味」は `ActionDef` / `CombinationDef` 自身ではなく、外部の
`InteractionExecutor` が知っています。Defs 側は多くの情報を public に公開するだけになっており、
「この定義をどう実行するか」という知識が所有者の外へ漏れています。

### 2.2 条件木の評価規則が ConditionNode 自身にない

`ConditionNode` は conditions の構文木そのものですが、評価ロジックは Runtime 側の
`ConditionEvaluator` にあります。`PassiveEffectGate` も `ConditionNode` を保持するだけで、
実際の判定は `RegisteredPassiveEffect.IsActive()` から外部評価器へ委譲しています。

これも「定義を持つ側が、自分の意味を自分で説明できていない」状態です。

### 2.3 public 公開範囲が広がりやすい

Defs と Runtime を厳密に分けようとすると、Runtime から参照したい情報を Defs 側で広く公開せざるを得ません。
`Tags`、`Passives`、`Actions`、`Combinations`、`PropertyLayout`、`SlotLayout` などが典型です。

もちろん一部の公開は必要ですが、現在の分割は「Runtime が外から組み立てる」前提なので、公開が構造的に増えます。
その結果、Defs 側の不変条件を Defs 自身で守りにくくなります。

## 3. それでも完全分離に見える利点

現在の構成には、次の分かりやすさがあります。

- `Defs` はロード後不変の定義
- `Runtime` は実行時の状態と処理
- 依存方向も概ね `Runtime -> Defs` に揃っている

ただし、この分かりやすさで得られているのは主に**見た目の整理**です。実際には 2 節の通り、
処理の本体が Runtime 側へ流れ込み、Defs 側は「公開された生データ」に近づいています。

このコストは、`InteractionExecutor` や `ConditionEvaluator` のような「Defs の意味を外部が代行しているクラス」として
既にコード上へ現れており、単なる抽象的な懸念ではありません。

## 4. 採用する統合方針

### 4.1 Defs 自身が振る舞いを持つ

今後は次の方向を基本方針とします。

- `ConditionNode` が自分自身を評価する
- `PassiveEffectGate` が自分自身の成立可否を判定する
- `ActionDef` が「この action を実行できるか / 実行すると何が起きるか」を引き受ける
- `CombinationDef` が matching と実行を引き受ける
- `WeightSpec` / `PickCandidateDef` も、自分の解決規則を自分の近くへ寄せる

Runtime 側は、`WorldObject` や `WorldSession` といった実行時コンテキストを提供する役に留めます。
「この後に何を判定し、どの定義をどう解釈するか」は Defs 側の責務です。

### 4.2 ただし状態まで Defs に寄せる必要はない

`PropertyValue` が自分の range 判定を自分で行っているように、実行時状態を持つクラスがその場で不変条件を守る構造自体は
妥当です。今回統合したいのは **定義と、その定義の解釈規則** であって、実行時状態まで Defs 側へ吸収することではありません。

## 5. 進め方

1. `ConditionEvaluator` の責務を `ConditionNode` / `PassiveEffectGate` 側へ移す
2. `InteractionExecutor` の責務を `ActionDef` / `CombinationDef` / `Pick` 系へ移す
3. その結果として Runtime 側に残るのが「状態管理だけ」になった段階で、必要ならフォルダ・名前空間も再編する

重要なのは、**名前空間を先に潰すことではなく、責務のねじれを先に解消すること**です。
責務の統合が終われば、`Domain.Defs` と `Domain.Runtime` の物理的な分割を残す意味があるかを改めて判断できます。

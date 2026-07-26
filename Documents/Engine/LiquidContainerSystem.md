# 液体容器システム設計

## 概要

液体（水・茶・油）を容器で保持し、飲用・注ぎ移し・蒸発させる仕組みの設計ドキュメントです。
液体専用のエンジン機構は持たず、汎用文法（`represented_by` = 7.6節、`transfer` = 9.5節、
`passives` = 8節。いずれも [`GameElementDefinition.md`](./GameElementDefinition.md)）の組み合わせ
だけで実現しています。定義本体は `public/world-codex/liquid_containers.yaml`、
検証は `tests/worldCodex/containersYaml.test.ts`。

## 1. 役割分担: 量は容器、種類と振る舞いは中身

液体入り容器は「容器本体」と「中身の液体カード」の親子2オブジェクトで表す。

- **容器本体**（`canteen`・`pot`・`bottle`・`jar`・`coconut_bowl`）: `liquid_amount`
  （`range: {min: 0, max: 容量}`）と、液体を1つだけ入れる `content` スロット
  （`accepts: [{tag: liquid, max: 1}]`）、`represented_by: content` を持つだけ。
  `actions`/`combinations` は一切持たない。
- **中身の液体カード**（`water_liquid`・`tea_liquid`・`oil_liquid`・`empty_liquid`）: 量を持たない。
  種類タグと、飲用 `actions`・注ぎ `combinations`・蒸発 `passives` という振る舞いだけを持つ。

量を中身ではなく容器に持たせるのは、容量（`range` の `max`）が容器ごとに異なる属性だから。
中身カードは全容器で共有される型のまま、液体の種類ごとの振る舞いだけを担う。
中身から見た量は常に `parent.liquid_amount` という1階層参照で届く。

## 2. represented_by による委譲

容器本体は `represented_by: content` により、操作もスタック判定も中身へ委譲する（7.6節）。

- **操作**: 容器カードへの `actions`/`combinations` は、実行前に代表（中身の液体カード）へ
  リダイレクトされる（`WorldObject.resolveInteractionTarget`、`ActionSystem.md` 1節）。
  「水筒を選ぶと『飲む』が出る」のは、水筒ではなく中の `water_liquid` の action。
- **スタック判定**: 代表チェーンの `ObjectDef` 列の完全一致を要求するため、水入り水筒と
  茶入り水筒、水入り水筒と水入りボウルは、それぞれ別スタックになる。

## 3. 飲用（drink）

液体トレイト側の `actions`。`transfer` で `parent.liquid_amount` から `actor.hydration` へ
1回 1200 移す。`transfer` の在庫クランプにより、残量が 1200 未満なら残っている分だけ飲む。

- 効果が種類ごとに違う液体は `linked_add` で表す: 茶は実際に飲んだ量に比例して
  `actor.wakefulness` を加算する。
- 飲めない液体（油）は、単に `drink` を定義しない。

単位は `hydration` と同一スケール（1L ≈ 4800、`characters.yaml`）。1回の drink = 250mL 相当。

## 4. 注ぎ移し（pour_in）

**受け側**の液体カードに定義する `combinations`。ドラッグされるのは容器カードだが、
`self`・`dragged` の両方が代表解決されるため、実行文脈は「受け側の液体」に「注ぎ側の液体」を
重ねた形になり、`dragged_parent` がドラッグ元の容器を指す。

```yaml
pour_in:
  with: water_liquid          # 同種の液体のみマッチ（異種はマッチせず何も起きない）
  transfer:
    amount: 999999
    from_object: dragged_parent   # 注ぎ側の容器の量から
    from_prop: liquid_amount
    to_object: parent             # 受け側の容器の量へ
    to_prop: liquid_amount
```

`amount: 999999` は「全部」の意図。実移動量は `transfer` の在庫（注ぎ側の残量）と
受け入れ容量（受け側の `range.max` までの空き）の小さい方に自動でクランプされるため、
「あるだけ注ぎ、入るだけ受け、残りは注ぎ側に残る」が transfer の既定動作だけで成立する。

**空の容器**は、`content` スロットを `empty_liquid` マーカーカードが占める。`empty_liquid` は
液体の種類ごとの受け入れ `combinations`（`pour_water`/`pour_tea`/`pour_oil`）を持ち、
`transfer`（量の移送）→ `destroy: self` → `spawn`（`same_slot`、実液体カードへの置き換え）を
1つの効果として宣言順に実行する（適用順は `ActionSystem.md` 5節）。

## 5. 蒸発

`evaporating_liquid` トレイトの `passives`（`accumulate`）。ゲートは
「`parent` の開放度タグ × `ancestor.weather`」の組み合わせで、該当する組み合わせの分だけ
`parent.liquid_amount` を毎 tick 減算する。

- 開放度は容器側のタグ（`wide_open_container` / `narrow_open_container` / `sealed_container`）。
  密閉容器はどのゲートも成立しないため蒸発しない。口が狭い容器は広い容器より減りが速い
  （設定値は `liquid_containers.yaml`）。
- 天候ゲートは晴天系のみ定義されているため、降雨中は蒸発しない。
- `liquid_amount` の `range.min: 0` の既定クランプ（6.3節）により、負にはならない。

## 6. 未決事項・今後の検討課題

- 量が 0 になっても中身カードは自動で `empty_liquid` に戻らない（「空だが種類は水」の状態が残る。
  現状 `pour_in` は同種としてマッチし続ける）。`liquid_amount` の `on_min` による置き換えを
  導入するか。
- 液体の種類を増やすたびに、液体トレイト側の `pour_in` と `empty_liquid` 側の `pour_*` を
  1組ずつ追加する必要がある（`ActionSystem.md` 7節の `with` 拡張と関連）。
- 異種液体の混合（水＋茶）は表現できない（マッチせず失敗する、が現状の仕様）。

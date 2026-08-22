# 進め方の提案

**これは提案であって、着手前に合意を取るためのもの。**
対象は [`Candidates.md`](./Candidates.md)（判定4・5）と [`Helpers.md`](./Helpers.md)（判定3の再点検）。

## 1. 並べる軸は「効果の大きさ」ではない

「効果が大きいものから」と「軽微なものから」はどちらも副次的な軸で、本当の軸は
**その変更が他の指摘の判定を変えるか**。

指摘は3種類に分かれ、性質がまったく違う。

| 種類 | 他の指摘への影響 | 例 |
| ---- | ---------------- | -- |
| **判定を動かさない** | 位置が変わるだけ。判定は生き残る | 可視性を絞る、阻害要因の無い単純移動 |
| **他の指摘を消す** | 予測どおりに消える。**再調査ではなく検証**になる | 阻害要因を1つ外す（B群・H群） |
| **他の指摘の前提を変える** | 移動先が確定する／変わる | 欠けている概念を作る（A群） |

2番目は「無効になる」のではない。Candidates.md と Helpers.md は
**「これを直すと、これとこれが件数いくつ消える」まで書いてある**ので、
作業後に消えたかどうかを数えれば検証になる。**消えなかったものが新しい発見。**

危ないのは3番目だけで、これは実装ではなく**決定**が先に来るので、決定だけ先に済ませられる（§3）。

## 2. 位置ずれは無料にする

「位置がずれるので再調査が必要」は、そのままでは正しい。ただし**位置ずれと判定ずれは分けられる**。

今回のインベントリは TypeScript Compiler API で `src` 配下の全宣言を機械抽出したもの
（4,178件・所属・可視性・参照ファイル数つき）。これをリポジトリに入れておけば、
**どの宣言がどこへ動いたかは再実行と差分で追える**。

- **提案**: 抽出スクリプトを `scripts/declarationInventory.mjs` として入れる。
- 各段の後にこれを回して差分を見る。**再採点が要るのは、阻害要因を外した箇所だけ**に絞れる。

これが無いと「位置がずれた」が毎回そのまま再調査コストになる。逆に入れておけば、
守るべきものは判定だけになる。

## 3. 段0: コードを書かずに決める（先にやる）

A群12件のうち、**置き場所を決めるだけで実装が要らない**ものがある。決定はコストがほぼゼロで、
決まると段1・段2の移動先が確定する。**先にやらない理由が無い。**

| 決めること | 決まると確定するもの |
| ---------- | -------------------- |
| A-1 画面のことばの置き場 | `NO_DESCRIPTION` の重複、`'閉じる'` ×4、`UNNAMED_LOCATION` / `LOCKED` / `OTHER` の行き先 |
| A-2 意匠の粒（全体トークン＋部品1つぶんのモジュール）と、汎用部品への差し込み口 | `Card.ts` の44定数、全10シーンの46件、B-6 の3クラス、`MapWindow` の色3件 |
| A-12 「起動」の区分 | `main.ts` / `DeviceScreen` の行き先 |
| A-11 「宣言に対する見せ方の宣言」 | `RAIN_STYLES` の行き先 |

あわせて [`Architecture.md`](./Architecture.md) の10件を `docs/engine/Layers.md` へ反映する。
特に **2-1（`Button` の判定例が実装とずれている）は事実の誤りなので、他の判断の根拠にする前に直す。**

## 4. 段1: 判定を動かさない変更（5レーン並列）

他の指摘の前提を変えないので、順序を気にせず同時に進められる。ファイル集合が交わらないことは確認済み。

| レーン | 内容 | 主に触るファイル |
| ------ | ---- | ---------------- |
| L1 | 可視性を絞る（D群7件） | `domain/Slot.ts` `domain/PropertyValue.ts` `domain/RegisteredPassiveEffect.ts` `locale/Localization.ts` `loader/inProgressObjects.ts` |
| L2 | domain の単純移動 | `PickEffect.ts`→`WeightSpec.ts`、`generation/Pcg32.ts`→`domain/`、`PropertyDef.inheritedContribution`→`PropertyValue` |
| L3 | analysis / save / scenario の単純移動 | `effectOutcomes.ts`（`Readable` は既存の完全な再宣言）、`balanceTables.ts` の定数、`craftingSteps.totalMinutesOf`、`newGameInput.ts`、`Scenario.PLAYER_SLOTS` |
| L4 | codex の単純移動 | `CodexView.ts`→`html.ts` 新設 |
| L5 | ui の単純移動 | `Button.ts` の紙のキー→`src/art/`、`StatusBar.ts` の3型→`StatusDetailWindow.ts`、`ProgressBar.alertBorderColor`→`theme.ts` |

L1 は**ここで判定4を1件消す**——`PropertyValue.incoming` を private にすると、
`RegisteredPassiveEffect` の「`incoming` のため公開する」という2段目の露出も同時に消える。

## 5. 段2: 単一の阻害要因を外す（3レーン、レーン内は直列）

**「領域をまたがなければ並列」は成り立たない。** 実際にファイル集合を確認したところ、
`src/game/ui/` の中だけでも衝突する。

- H-4（`labels.ts` に折り返し幅と行間）の呼び出し側は `DescriptionPane` `ExplorationPane`
  `ModalDialog` `ObjectWindow` `StatusDetailWindow` `Tooltip` `NewGameScene` `ui/textLayout.ts`。
- H-15（`Button` に選択状態）は `ObjectWindow` `PropertiesPane` を触る → **H-4 と `ObjectWindow.ts` で衝突**。
- H-14（`StatusDetailWindow` の4件は `ProgressBar` の欠落）→ **H-4 と `StatusDetailWindow.ts` で衝突**。

同様に、B-1（`RawObjectDef`/`RawTrait` 二重化）と H-1（loader の不変条件確認18箇所）は
`loader/` のほぼ同じファイル群を触るので直列。

| レーン | 順に実施 | 消える見込み |
| ------ | -------- | ------------ |
| **ui** | H-4（`LabelStyle` に2フィールド）→ H-14（`ProgressBar` に目盛り・区間の口）→ H-15（`Button` に選択状態）→ H-5（`Button` に「中央に1つ置く」口） | 8＋4＋2＋7箇所 |
| **loader** | H-1（例外の文言に文脈と節番号を通す口）→ B-1（共通の宣言本体を1つ作る） | 18＋24箇所 |
| **domain** | H-12（「枠1つ」＝`CellDef`と`ObjectStack`の組を型にする）→ H-7（`Slot` に「空き枠を保った束」、`WorldObject` に「枠が無ければ空」） | 6＋6箇所 |

**ui レーンの先頭に H-4 を置く理由**: 単独で最大の畳み込みで（B へ2フィールド足すだけで8箇所）、
かつ CLAUDE.md の「呼び出し側が『この後あれも呼ばないと壊れる』を覚えている手順は呼ばれる側へ移す」に
そのまま当てはまる。ここを直すと、以降の ui の作業が同じ2手順を書き足さずに済む。

別レーンとして H-9（`CardLane` に「添字・札・矩形の組」と `indexOf`）と H-8（`Card` に getter）が
あるが、両方 `Card.ts` `CardLane.ts` `CardTable.ts` `CardDragController.ts` `PlayScene.ts` を触るので、
**ui レーンとは別の第4レーンにするか、ui レーンの後ろに付ける**。`PlayScene.ts` を触る点で
段3とも干渉するため、段3の前に終わらせておきたい。

## 6. 段3: 定義側の口をまとめて足す（分割不可・単独）

**ここが最大の山で、分けて着手してはいけない。** 以下は別々の指摘に見えるが、
**全部「定義（Def）に、実行時インスタンス無しで問いを立てる口が無い」の別の顔**。

| 指摘 | 見えている症状 | 規模 |
| ---- | -------------- | ---- |
| B-3 / H-2 | 解析が同じ規則を書き直している | private ヘルパー13＋export 8宣言 |
| B-5 | `describe*` 5つが定義の公開フィールドをなぞる | 5件 |
| H-13 | `PropertyStage` が述語を持たない | `PropertyDef` の5箇所 |
| H-10 | `resolveEffectTargetOrAncestor` の直後に同じ id を2回渡す | 10箇所 |
| H-11 | `resolveReferenceRoot` が `'ancestor'` を扱わない | 5箇所（うち1つは本体が完全同一） |
| H-3 | `ReferenceRoot` の「この文脈で解決先を持つか」 | 9箇所 |
| H-6 | `WorldCodex` / `ObjectDefTable` に全型走査が無い | 7＋4＋4箇所 |

分けて着手すると、**同じ設計判断（定義に問いの形の口をどう生やすか）を3回別々にすることになる**。
CLAUDE.md の「まず全部が1つの仕組みに乗ると仮定し、差をパラメータとして表す」に照らせば、
ここは1つの設計として立てるべきところ。

触るファイルが `PropertyDef` `ObjectDef` `RecipeDef` `InteractionDef` `WorldCodex` `ReferenceRoot`
`ActiveEffect` `ConditionNode` `PassiveEffect` ＋ `analysis/*` ＋ `codex-viewer/describe/*` と広く、
**段1 の L2・L3 と、段2 の domain レーンが終わっていることが前提**。

なお H-3 について、第1波が挙げた阻害要因（「評価文脈を表す型が domain に無い」）は
再点検で**反例により破れている**——`parseMove` は同性質の述語 `ObjectRef.needsInteraction()` を
domain 側から実際に呼んでいる。着手前にこの前提を確認し直す必要は無い。

## 7. 段4: 欠けている概念を実装する（A群の残り）

段0で決めた方針を、コードに落とす。段3の後にする理由は、A-3（観測の器）・A-4（ContainerSystem の
置き場）が `WorldObject` `WorldSession` `PropertyValue` を大きく動かすため、
段2・段3の作業と同じファイルで衝突するから。

A-1（画面のことば）と A-2（部品1つぶんの意匠）は段2の ui レーンと衝突するので、
**段2 の ui レーンが終わってから**。

## 8. 各段の検証

毎回 `npm run lint` / `npm run typecheck` / `npm test` / `npm run format:check` の4つ。

加えて、段2・段3には**この計画特有の検証**がある。

1. `scripts/declarationInventory.mjs` を回して宣言インベントリを再生成する。
2. Candidates.md / Helpers.md が「消える」と書いた件数と、実際に消えた件数を突き合わせる。
3. **消えなかったものを調べる。** それは予測が外れた箇所——つまり阻害要因の見立てが違っていたか、
   別の阻害要因が隠れていたかのどちらかで、新しい発見になる。

## 9. まとめ

```
段0  決める（コードを書かない）        ← 先にやる。決定は無料で、移動先が確定する
段1  判定を動かさない変更              ← 5レーン並列
段2  単一の阻害要因を外す              ← 3〜4レーン、レーン内は直列
段3  定義側の口をまとめて足す          ← 単独・分割不可・最大の山
段4  欠けている概念を実装する          ← 段0の決定をコードに落とす
```

再採点が要るのは段3の後だけ。段1・段2は位置が動くだけなので、インベントリの再生成で追える。

**着手するなら、まず段0の決定と `scripts/declarationInventory.mjs` の投入から。**
どの段から始めるか、また段0の4つの決定をこちらで案として出すか、指示をください。

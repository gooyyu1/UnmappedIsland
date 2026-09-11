# TypeScript コーディング規約

機械的に強制できる整形・静的検査は Prettier・ESLint・`tsc --strict`（`npm run lint` / `npm run typecheck`）に
任せる。ここには機械化できない規約だけを書く。設計方針（カプセル化・コメントの書き方）は
[`CLAUDE.md`](../../CLAUDE.md) を参照。

## ファイルと命名

- どのフォルダへ置くかは、そのファイルが答えることで決まる（[`CodeStructure.md`](../CodeStructure.md) 1節）。
- ファイル名は主要エクスポートの名前に一致させる。クラス・型が主ならPascalCase（`PropertyValue.ts`）、
  関数群のモジュールならcamelCase（`yamlMapping.ts`）。
- ディレクトリ名は小文字で、複数語はケバブケース（`domain/generation`・`asset-pack`・`assets/world-codex`）。
  ファイル名と違い指す識別子が無いので、綴りを合わせる相手がいない。データのファイル名（`src/assets/`
  以下）だけは例外で、識別子と同じsnake_caseに揃える
  （[`GameElementDefinition.md`](./GameElementDefinition.md) 3.2節）。
- 1ファイル1責務。1つのクラスを複数ファイルへ分割しない（大きくなりすぎる場合は
  協力クラス・関数モジュールへ切り出す）。
- クラス・型・インターフェース: PascalCase。メソッド・プロパティ・変数: camelCase。
  モジュールスコープの定数: UPPER_SNAKE_CASE。
- **失敗しうることは名前に出す。** 無いときに投げるものは `get`、無いときに `undefined` を返すものは
  `try` を頭に付ける（`WorldObject.getSlot` と `tryGetSlot`）。
- **単位や軸が値の一部なら、名前に持たせる**（`travelMinutes`）。読み手は中身ではなく名前を信じるので、
  名前が個数を指していて中身が分、のような取り違えはそのまま呼び出し側へ伝わる。
- **兄弟が既に持っている語形へ寄せる。** 1つだけ改名するときに新しい規則を作らない——揃っていない
  兄弟が残ると、どちらが規約なのかを読み手が決められなくなる。
- **`private` かどうかで基準を緩めない。** 外から呼ばれないぶん壊れる範囲は狭いが、読む人を誤解させる
  量は変わらない。

## 型と値

- 「値が無い」は `undefined` で表す。`null` は使わない（外部ライブラリが返す場合は境界で変換する）。
- `enum` は使わず、文字列リテラルユニオンを使う（`type Kind = 'modify' | 'add'`）。
- ドメインの数値は32bit整数として扱う。除算・小数→整数変換は `Math.trunc` を明示する
  （JSの `/` は常に浮動小数点になるため）。
- 公開APIで返すコレクションは `readonly T[]` / `ReadonlyMap` にする。内部の可変リストは配列、
  キー付きコレクションは挿入順が保証される `Map` を使う。
- 条件で値を選ぶだけの分岐は `if (a) return x; return y;` ではなく `return a ? x : y;` と書く。
  処理の分岐ではなく値の分岐なので、形が中身と一致する（短さは理由ではない）。

### グローバルIDは、名前空間ごとに別の型

名前空間（`NameRegistry` 1つぶん）が配るグローバルIDは、`number` に型の上だけの印を交ぜた
[`GlobalId<名前空間>`](../../src/domain/GlobalId.ts) で受ける。実体は素の `number` のままなので、
比較もMapの鍵も配列の添字もそのまま使える。名前空間が違えば別の型になり、プロパティのIDを受ける宣言へ
スロットのIDや素の数を渡すと型で止まる（[`tests/architecture/globalId.test.ts`](../../tests/architecture/globalId.test.ts)
が `@ts-expect-error` で見張る。受け口が `number` へ戻ると `npm run typecheck` が赤くなる）。

**分け終わっているのはプロパティの名前空間だけ**（2026-09-11時点）。残りは `NameRegistry` の型引数の
既定である素の `number` のままで、**互いのIDを渡し合える**。分ける手順は下に置くので、ここを読んで
「もう全部が分かれている」と読まないこと。

**素の `number` から専用の型へ変わるのは `NameRegistry` の中だけ。** 番号を決めているのが
`intern` の1行で、外へ開いているのは名前から引く経路（`intern`/`getId`/`tryGetId`）しか無い。
YAMLもシナリオも生成物もURLも**名前で越境する**ので、外から来た数がIDとして通ることがない。

名前空間を1つ増やすときの手順:

1. `GlobalId.ts` に `GlobalId<'その名前'>` の別名を置く。
2. 配る側の `NameRegistry` をその別名で型付けする（`WorldCodex`・`WorldCodexYamlLoader` の
   フィールドとゲッター）。
3. `npm run typecheck` が挙げる箇所を追う。**明示的に `number` と書いてある宣言だけが残る**
   ——`intern` から受けた値をそのまま渡している経路は推論で埋まる。

跨ぐ場所を新しく作らなければならないなら、**跨ぐ理由をその場に書く**（既にある例外は、どの名前空間も
配っていないIDを渡す試験——`tests/domain/propertyAndSlotLookup.test.ts`）。

**プロパティの「値」に別の名前空間のIDが入ることがある**（型を値に持つプロパティは `objectNames` の
ID、シンボル型は `symbolNames` のID。GameElementDefinition.md 6.6節・6.9節）。値は宣言された数であって
名前空間が配ったIDではないので、その2つを型で分けるなら、読み出す側が越境の場所になる。

## クラス

- getterの背後にある可変フィールドだけ `_` プレフィックスを付ける（`private _number` と `get number()`）。
  それ以外のフィールドにプレフィックスは付けない。
- 可視性は `private` / `readonly` キーワードで表す（`#` フィールドは使わない）。

## エラー

- 例外は `Error` の派生クラスで表し、クラス名は `〜Error` とする。メッセージは日本語。

## import

- 相対パスで書く（パスエイリアスは使わない）。型としてしか使わないものは `import type`。
  循環参照が必要な相互再帰型（例: 定義と実行時状態）は `import type` に限って許す。

## ファイルの読み込み

- リポジトリのファイルを読んで行に割るときは `\r` を落とす（`split(/\r?\n/)`）。作業ツリーは
  CRLF なので、`split('\n')` だと行末に `\r` が残り、行まるごとを比較する処理が Linux では通って
  Windows でだけ外れる。

## コメント

- TSDoc（`/** … */`）で書く。言語は日本語。何を書いてよいかは [`CLAUDE.md`](../../CLAUDE.md) の
  コメント方針に従う。`@param`/`@returns` の羅列はしない（本文で足りる説明を優先する）。
- **説明が要ると感じたら、第一手は改名。** 名前にしてなお言い残す契約があるときだけコメントを足す。
  コメントが無いこと自体は欠陥ではない——名前が責務を言い切っていれば、それが良い状態。
- **説明は、それが説明している宣言自身に付ける。** TSDoc は直後の1宣言の説明として道具が出すので、
  1つずらして書くと、読み手も IDE も別の宣言の説明として読む。

## テスト

- Vitest を使う。`describe` はクラス・機能単位、`it` の説明は挙動を平叙文で書く
  （`it('rangeの下限に達するとon_minが発火する', …)`）。
- 乱数に依存する挙動のテストは、実装のシード列に依存させず、意図した値列を返すスタブ `Rng` を渡して
  シナリオを明示する。「同じシード→同じ結果」の再現性だけを確認するテストはシード付き実装を使ってよい。

`export` は「この名前は外から使う」という宣言なので、どこからも輸入されない `const`・`function` は
`tests/architecture/exports.test.ts` が見張る（型とクラスは、輸入されなくても署名で名乗るために公開する
値打ちがあるので見ない）。

### 種類ごとに分ける

赤が出た瞬間に**どこを見に行くかが決まる**ように、テストは種類で置き場を分ける。境目は
`tests/architecture/testKinds.test.ts` が見張る。

| 種類 | 置き場 | 赤の意味 |
| --- | --- | --- |
| 層の責務 | 上記以外（`tests/domain`・`tests/game`・`tests/loader` ほか） | その層のコードが壊れた |
| 通し | `tests/integration` | 層の繋ぎ目が壊れた |
| 同梱の中身 | `tests/world-codex`・`tests/art`・`tests/asset-pack`・`tests/generation`・`tests/scenario` | 同梱のYAML・絵・対応表を直した副作用 |

**層の責務のテストは同梱の定義（`src/assets/world-codex`）を読まない。** 読むと、YAMLを直しただけで
その層が赤くなり、赤の読み方が決まらない。確かめたい形はそのテストの中にYAMLで宣言する——1つの
テストが読むぶんだけを、そのテストの隣に書く（テスト間で1つの大きな定義を共有しない）。

映しの層は入口が `StartedGame` なので、[`tests/support/miniGame.ts`](../../tests/support/miniGame.ts)
が地形生成を通さない一式を組み立てる。時間を進めるだけなら
[`tests/support/worldYaml.ts`](../../tests/support/worldYaml.ts) の world を読む。

通しのテストは実データとrngの引きに依存してよい。**何を前提にしているかは冒頭に書く。**

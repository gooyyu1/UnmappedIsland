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

## 型と値

- 「値が無い」は `undefined` で表す。`null` は使わない（外部ライブラリが返す場合は境界で変換する）。
- `enum` は使わず、文字列リテラルユニオンを使う（`type Kind = 'modify' | 'add'`）。
- ドメインの数値は32bit整数として扱う。除算・小数→整数変換は `Math.trunc` を明示する
  （JSの `/` は常に浮動小数点になるため）。
- 公開APIで返すコレクションは `readonly T[]` / `ReadonlyMap` にする。内部の可変リストは配列、
  キー付きコレクションは挿入順が保証される `Map` を使う。

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

## テスト

- Vitest を使う。`describe` はクラス・機能単位、`it` の説明は挙動を平叙文で書く
  （`it('rangeの下限に達するとon_minが発火する', …)`）。
- 乱数に依存する挙動のテストは、実装のシード列に依存させず、意図した値列を返すスタブ `Rng` を渡して
  シナリオを明示する。「同じシード→同じ結果」の再現性だけを確認するテストはシード付き実装を使ってよい。

`export` は「この名前は外から使う」という宣言なので、どこからも輸入されない `const`・`function` は
`tests/architecture/exports.test.ts` が見張る（型とクラスは、輸入されなくても署名で名乗るために公開する
値打ちがあるので見ない）。

### 3つの種類に分ける

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

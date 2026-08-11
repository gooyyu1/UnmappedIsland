# WorldCodex データベースビューア

実際のゲームデータ（`public/world-codex/*.yaml`）を、型・プロパティ・スロット・操作の単位で辿って
読むための閲覧ツールです。公開先は [`../../codex/`](../../codex/)（GitHub Pagesの `/codex/`）。

ローカルで見るときは `npm run dev:codex`、公開物と同じものを作るときは `npm run build:codex`
（出力は `site/codex/`）。

## ゲーム本体と同じプログラムで読む

ビューアは**ゲームと同じローダー（`WorldCodexYamlLoader`）で同じファイルを読み、同じ表示文字列
（`Localization`）と同じカードの絵（`src/assets/objects/`）で見せます**。YAMLを解釈する処理を
ビューア側に持たないので、文法が増えてもビューアの表示が実物と食い違いません。

見せているのは**trait解決後の姿**です（`traits` は合成後に消えるため、どのtraitから来た宣言かは
出ません）。実際にゲームが読み込んだ結果そのものなので、YAMLを見比べて頭の中で合成する必要が
ありません。

## 定義は自分自身を書き表す

条件・持続効果・active効果などの中身は、**その定義のクラス自身**が `describe` で書き出します
（[`src/domain/defs/Description.ts`](../../src/domain/defs/Description.ts)）。ビューアが定義の内側を
覗いて文を組み立てることはありません。

`describe` が返すのは文字列ではなく断片（`DescriptionToken`）の並びで、識別子への参照は地の文と
区別されています。**それを表示名にするか識別子のまま出すか、リンクを張るかを決めるのは読み手側**
——ビューアはヘッダの「表示名 / 識別子」で切り替えます。

プロパティの「影響元」も同じ考え方です。ビューアは全ての型に「あなたはこのプロパティに影響しますか」
と尋ねる（`ObjectDef.describeInfluencesOn`）だけで、passivesやactionsの中身は見ません。

## ページ

| ページ | 内容 |
| --- | --- |
| `#/` | 型の一覧（カードの絵と名前、名前での絞り込み） |
| `#/object/<識別子>` | 型の詳細（絵・説明文・props・slots・passives・actions・combinations・recipes・土地の亜種） |
| `#/property/<型>/<prop>` | プロパティの詳細（初期値・range・stages・range系イベント・影響元） |
| `#/tag/<タグ>` | そのタグを持つ型 |
| `#/slot/<スロット>` | そのスロットを持つ型と、それぞれの受け入れ条件 |
| `#/prop-candidates/<prop>` | 同名のpropを持つ型の候補（参照先が1つに絞れないときの行き先） |

プロパティの定義は型ごとに違いうる（[GameElementDefinition.md](../engine/GameElementDefinition.md) 6節）ため、
プロパティのページは型とセットでのみ一意に決まります。

## 翻訳の抜けが見える

表示名が識別子のままの対象には「未翻訳」の印が付きます。カードに並ぶ型・土地・シンボルの抜けは
自動テスト（`tests/locale/localization.test.ts`）が捕まえますが、props・actionsなど検証の対象外の
ものは、このビューアを開くのが一番早い確認方法です。

YAML文法そのものは [`../engine/GameElementDefinition.md`](../engine/GameElementDefinition.md)、
表示文字列の持ち方は [`../engine/Localization.md`](../engine/Localization.md) を参照してください。

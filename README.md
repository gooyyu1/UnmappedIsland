# Unmapped Island

Card Survivalの影響を受けた、無人島を舞台にしたサバイバルカードゲーム

## 概要

プレイヤーは無人島に漂着したサバイバーとして、カードを駆使して食料・水・資材を集め、生き残りを目指す2Dカードゲームです。

## 遊ぶ

<https://gooyyu1.github.io/UnmappedIsland/game/>

`main` への変更を GitHub Actions がビルドし、GitHub Pages で公開します（開発中のため内容は随時変わります）。

## プロジェクトコンセプト

制作者自身がシミュレーション表現と AI 活用を学ぶための個人プロジェクトで、一般販売は想定していません。
詳細は [`docs/concept/GameConcept.md`](./docs/concept/GameConcept.md) を参照してください。

## 動作環境

- **プラットフォーム**: Webブラウザ（モバイルブラウザを含む）
- **技術スタック**: TypeScript + Phaser 4 + Vite
- **開発環境**: Node.js 24.19.0 以上（CIが検証しているのはこの版）

## 開発コマンド

```bash
npm install            # 依存パッケージのインストール
npm run dev            # 開発サーバー起動
npm test               # テスト実行（Vitest）
npm run test:climate   # 気候システムの検証（core.yamlの気候の設定値を変えたときに実行）
npm run lint           # ESLint
npm run typecheck      # 型チェック（tsc --noEmit）
npm run build          # 型チェック + プロダクションビルド
npm run stats:climate  # 気候システムの統計レポート再生成（docs/diagnostics/）
npm run stats:terrain  # 地形生成の統計レポート再生成（docs/diagnostics/）
npm run stats:lines    # 追跡ファイルの行数を拡張子別に集計（pathspecで絞り込み可）
npm run docs:reference # ソースリファレンス生成（TypeDoc → site/reference/）
```

## プロジェクト構成

```
UnmappedIsland/
├── src/
│   ├── domain/
│   │   ├── defs/         # ロード済みのゲーム定義（ロード後は不変）
│   │   ├── runtime/      # 実行時状態（WorldObject・セッション・ビュー）
│   │   └── generation/   # 地形生成（決定的な島レイアウト）
│   ├── loader/           # WorldCodex YAMLローダー
│   ├── locale/           # 表示文字列の読み込み
│   ├── assets/           # データの実体（層ではない。置くだけで読まれる）
│   │   ├── objects/      # 型ごとのカードの絵
│   │   ├── backgrounds/  # レーン・カードの地に敷く絵
│   │   ├── icons/  weather/  ui/   # ボタンのアイコン・空の絵・画面共通の紙
│   │   ├── world-codex/  # ゲーム定義YAML
│   │   ├── locale/       # 表示文字列YAML（言語ごと）
│   │   └── scenarios/    # テスト用シナリオYAML
│   ├── art/              # どのファイルがどの絵かを答えるモジュール
│   ├── assetPack/        # アセットパック（ZIP）の読み込み
│   ├── codex/            # ゲーム定義の閲覧ビューア（ゲームと同じローダー・表示文字列を使う）
│   ├── game/             # Phaserシーン
│   │   ├── layout/       # 画面寸法（u単位）とエリア配置の計算
│   │   └── ui/           # 画面共通の部品（カード・ボタン・モーダルなど）
│   ├── save/             # セーブデータ（localStorage、4スロット固定）
│   └── util/             # 汎用ユーティリティ
├── codex/                # 閲覧ビューアの入口HTML（本体はsrc/codex/）
├── sample-pack/          # サンプルアセットパックの中身（npm run pack:sample でZIPにする）
├── public/               # ビルドが素通しで配るファイル（sample-pack.zip）
├── tests/                # テスト（Vitest）
└── docs/                 # 開発ドキュメント（原稿）
    ├── concept/          # コンセプト
    ├── ui/               # UI/UX
    ├── engine/           # ルール・エンジン（YAML文法・汎用サブシステム・実装ガイド）
    ├── world/            # ワールド（地形・気候・アイテムなど実際にゲームに登場する内容）
    └── diagnostics/      # 計測レポート（気候統計など）
```

公開サイトは `site/` へ生成してGitHub Pagesへ直接デプロイするため、生成物はリポジトリに入らない
（`.gitignore` 済み）。サイトは `/docs/`（`docs/` から生成したHTML）・`/reference/`（TypeDocの
ソースリファレンス）・`/game/`（ビルド済みのゲーム本体）・`/codex/`（ゲーム定義の閲覧ビューア、
`src/codex/`）の4本立て。

## ドキュメント

開発ドキュメントは [`docs/`](./docs/README.md) フォルダで管理します。
ゲームコンセプトは [`docs/concept/GameConcept.md`](./docs/concept/GameConcept.md) にまとめています。
コーディング規約は [`docs/engine/CodingConventions.md`](./docs/engine/CodingConventions.md) を参照してください。
`src/` のクラス・型とJSDocコメントから生成したソースリファレンスは
<https://gooyyu1.github.io/UnmappedIsland/reference/> で公開しています。
ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装します。

## ライセンス

[LICENSE](./LICENSE) を参照してください。

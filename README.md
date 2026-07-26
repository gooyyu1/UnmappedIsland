# Unmapped Island

Card Survivalの影響を受けた、無人島を舞台にしたサバイバルカードゲーム

## 概要

プレイヤーは無人島に漂着したサバイバーとして、カードを駆使して食料・水・資材を集め、生き残りを目指す2Dカードゲームです。

## 遊ぶ

<https://gooyyu1.github.io/UnmappedIsland/Game/>

`main` への変更を GitHub Actions がビルドし、GitHub Pages で公開します（開発中のため内容は随時変わります）。

## プロジェクトコンセプト

制作者自身がシミュレーション表現と AI 活用を学ぶための個人プロジェクトで、一般販売は想定していません。
詳細は [`Documents/Concept/GameConcept.md`](./Documents/Concept/GameConcept.md) を参照してください。

## 動作環境

- **プラットフォーム**: Webブラウザ（モバイルブラウザを含む）
- **技術スタック**: TypeScript + Phaser 4 + Vite
- **開発環境**: Node.js 26.5.0 以上

## 開発コマンド

```bash
npm install            # 依存パッケージのインストール
npm run dev            # 開発サーバー起動
npm test               # テスト実行（Vitest）
npm run lint           # ESLint
npm run typecheck      # 型チェック（tsc --noEmit）
npm run build          # 型チェック + プロダクションビルド
npm run stats:climate  # 気候システムの統計レポート再生成（Documents/Diagnostics/）
npm run docs:reference # ソースリファレンス生成（TypeDoc → docs/Reference/）
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
│   ├── game/             # Phaserシーン
│   │   ├── layout/       # 画面寸法（u単位）とエリア配置の計算
│   │   └── ui/           # 画面共通の部品（カード・ボタン・モーダルなど）
│   ├── save/             # セーブデータ（localStorage、4スロット固定）
│   └── util/             # 汎用ユーティリティ
├── public/
│   └── world-codex/      # ゲーム定義YAML（そのまま配信される）
├── tests/                # テスト（Vitest）
├── Documents/
│   ├── Concept/          # コンセプト
│   ├── UI/               # UI/UX
│   ├── Engine/           # ルール・エンジン（YAML文法・汎用サブシステム・実装ガイド）
│   ├── World/            # ワールド（地形・気候・アイテムなど実際にゲームに登場する内容）
│   └── Diagnostics/      # 計測レポート（気候統計など）
└── docs/                 # GitHub Pages の配信元（自動生成・直接編集不可）
    ├── Documents/        # Documents/ から生成したHTML
    ├── Reference/        # src/ から生成したソースリファレンス（TypeDoc）
    └── Game/             # ビルド済みのゲーム本体
```

## ドキュメント

開発ドキュメントは [`Documents/`](./Documents/README.md) フォルダで管理します。
ゲームコンセプトは [`Documents/Concept/GameConcept.md`](./Documents/Concept/GameConcept.md) にまとめています。
コーディング規約は [`Documents/Engine/CodingConventions.md`](./Documents/Engine/CodingConventions.md) を参照してください。
`src/` のクラス・型とJSDocコメントから生成したソースリファレンスは
<https://gooyyu1.github.io/UnmappedIsland/Reference/> で公開しています。
ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装します。

## ライセンス

[LICENSE](./LICENSE) を参照してください。

# UnmappedIsland

Card Survivalの影響を受けた、無人島を舞台にしたサバイバルカードゲーム

## 概要

プレイヤーは無人島に漂着したサバイバーとして、カードを駆使して食料・水・資材を集め、生き残りを目指す2Dカードゲームです。

## プロジェクトコンセプト

制作者自身がシミュレーション表現と AI 活用を学ぶための個人プロジェクトで、一般販売は想定していません。
詳細は [`Documents/Concept/GameConcept.md`](./Documents/Concept/GameConcept.md) を参照してください。

## 動作環境

- **プラットフォーム**: Webブラウザ（モバイルブラウザを含む）
- **技術スタック**: TypeScript + Phaser 3 + Vite
- **開発環境**: Node.js 22 以上

## 開発コマンド

```bash
npm install            # 依存パッケージのインストール
npm run dev            # 開発サーバー起動
npm test               # テスト実行（Vitest）
npm run lint           # ESLint
npm run typecheck      # 型チェック（tsc --noEmit）
npm run build          # 型チェック + プロダクションビルド
npm run stats:climate  # 気候システムの統計レポート再生成（Documents/Diagnostics/）
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
└── docs/                 # GitHub Pages 用 HTML（Documents/ から自動生成・直接編集不可）
```

## ドキュメント

開発ドキュメントは [`Documents/`](./Documents/README.md) フォルダで管理します。
ゲームコンセプトは [`Documents/Concept/GameConcept.md`](./Documents/Concept/GameConcept.md) にまとめています。
コーディング規約は [`Documents/Engine/CodingConventions.md`](./Documents/Engine/CodingConventions.md) を参照してください。
ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装します。

## ライセンス

[LICENSE](./LICENSE) を参照してください。

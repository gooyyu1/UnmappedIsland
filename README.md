# UnmappedIsland

Card Survivalの影響を受けた、無人島を舞台にしたサバイバルカードゲーム

## 概要

プレイヤーは無人島に漂着したサバイバーとして、カードを駆使して食料・水・資材を集め、生き残りを目指す2Dカードゲームです。

## 動作環境

- **プラットフォーム**: Android (API Level 28 以上)
- **Unity バージョン**: 2022.3.20f1 (LTS)

## プロジェクト構成

```
UnmappedIsland/
├── Assets/
│   ├── Animations/       # アニメーションクリップ・コントローラー
│   ├── Audio/
│   │   ├── BGM/          # バックグラウンドミュージック
│   │   └── SE/           # サウンドエフェクト
│   ├── Fonts/            # フォントアセット
│   ├── Materials/        # マテリアル
│   ├── Prefabs/          # プレハブ
│   ├── Scenes/           # シーンファイル
│   ├── Scripts/
│   │   ├── Core/         # GameManager, SoundManager, SceneController など
│   │   ├── Data/         # ScriptableObject定義, セーブデータ構造体
│   │   ├── Gameplay/     # ゲームロジック (カード, プレイヤーステータスなど)
│   │   ├── UI/           # UIコントロール
│   │   └── Utilities/    # 汎用ユーティリティ
│   ├── Sprites/
│   │   ├── Cards/        # カードイラスト
│   │   ├── Characters/   # キャラクタースプライト
│   │   ├── Environment/  # 背景・環境スプライト
│   │   └── UI/           # UIスプライト
│   └── Settings/         # Input System, Render Pipeline などの設定アセット
├── Docs/
│   ├── Planning/         # 企画書
│   ├── Specification/    # 仕様書
│   └── Design/           # 設計書
├── Packages/             # Unityパッケージ設定
└── ProjectSettings/      # Unityプロジェクト設定
```

## ドキュメント

開発ドキュメントは [`Docs/`](./Docs/README.md) フォルダで管理します。
ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装します。

## ライセンス

[LICENSE](./LICENSE) を参照してください。

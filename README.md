# UnmappedIsland

Card Survivalの影響を受けた、無人島を舞台にしたサバイバルカードゲーム

## 概要

プレイヤーは無人島に漂着したサバイバーとして、カードを駆使して食料・水・資材を集め、生き残りを目指す2Dカードゲームです。

## プロジェクトコンセプト

UnmappedIsland は、制作者自身がシミュレーション表現と AI 活用を学ぶために進めている個人プロジェクトです。
一般販売は想定しておらず、Card Survival との差別化や商業水準のオリジナリティ獲得そのものを最優先にはしていません。
その代わり、シンプルなルールの組み合わせから奥深い意思決定とサバイバル体験が立ち上がることを重視しています。

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
├── Documents/
│   ├── Planning/         # 企画書
│   ├── Specification/    # 仕様書
│   └── Design/           # 設計書
├── Packages/             # Unityパッケージ設定
└── ProjectSettings/      # Unityプロジェクト設定
```

## ドキュメント

開発ドキュメントは [`Documents/`](./Documents/README.md) フォルダで管理します。
ゲームコンセプトは [`Documents/Planning/GameConcept.md`](./Documents/Planning/GameConcept.md) にまとめています。
ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装します。

## ライセンス

[LICENSE](./LICENSE) を参照してください。

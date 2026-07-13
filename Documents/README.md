# UnmappedIsland ドキュメント

このディレクトリにはゲーム開発に関するすべてのドキュメントが格納されています。

## ディレクトリ構成

```
Documents/
├── Planning/       # ゲーム企画書
│   ├── GameConcept.md
│   └── README.md
├── Specification/  # 仕様書
│   └── README.md
└── Design/         # 設計書
    ├── ScreenLayout.md              # 画面レイアウト検討
    ├── ScreenLayout_Portrait.html   # 縦型モック (1080×1920)
    ├── ScreenLayout_Landscape.html  # 横型モック (1920×1080)
    ├── screenshot_portrait.png      # 縦型スクリーンショット
    ├── screenshot_landscape.png     # 横型スクリーンショット
    ├── GameElementDefinition.md
    └── README.md
```

## 各フォルダの用途

| フォルダ | 内容 |
|--------|------|
| `Planning/` | ゲームコンセプト、ターゲット、マネタイズ計画など企画段階のドキュメント |
| `Specification/` | ゲームルール、機能仕様、UI/UX仕様など詳細な仕様書 |
| `Design/` | アーキテクチャ設計、クラス設計、データ設計など技術設計書 |

> **備考**: ユーザー向けのゲーム内ヘルプやチュートリアルはゲームコンテンツとして実装するため、このフォルダには含まれません。

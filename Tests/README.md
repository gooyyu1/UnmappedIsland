# Tests

このフォルダには UnmappedIsland のドメインロジック（`Assets/Scripts/` 以下）に対する自動テストが含まれます。
Unity エンジンに依存しない純粋な C# コードを対象としており、`dotnet test` で単独実行できます。

## フォルダ構成

```
Tests/
├── Tests.csproj               # テストプロジェクト（net8.0 / NUnit）
├── UnmappedIsland.WorldCodex/ # テスト対象コードを参照するライブラリプロジェクト
├── Loader/                    # YAML 解釈テスト（本ドキュメント「Loader テスト」節を参照）
└── Domain/
    └── Runtime/               # 読み込み後の振る舞いテスト（本ドキュメント「Domain/Runtime テスト」節を参照）
```

## テストの分類

### Loader テスト（`Tests/Loader/`）

**namespace: `UnmappedIsland.Loader`**

YAML ファイルのパースおよび `WorldCodex` への変換が正しく行われるかを検証します。
`WorldCodexYamlLoader` が入力テキストを正しく解釈できるかどうかが主な関心事であり、
読み込み後の実行時動作（Tick・オーバーフロー・スタックなど）は対象外です。

| ファイル | 検証対象 |
|---|---|
| `YamlLoaderTests.cs` | ローダーの基本動作（複数ファイル・複数ディレクトリからの `WorldCodex` 構築） |
| `CoreYamlTests.cs` | `core.yaml`（world・location トレイトなどゲームの基礎定義） |
| `ContainersYamlTests.cs` | `containers.yaml`（液体容器サンプル定義） |
| `CharactersYamlTests.cs` | `characters.yaml`（プレイヤーキャラクター定義） |
| `FoodsYamlTests.cs` | `foods.yaml`（食料サンプル定義） |

**新しい Loader テストを追加するとき**
- `WorldCodexYamlLoader` または `WorldCodexYamlLoaderBuilder` の動作を検証するテストをここに置く。
- 「このキーワードがあれば ObjectDef にこう反映される」という形式の検証が典型例。
- `WorldObject` を Tick させたりプロパティを動的に変化させたりする操作はここに含めない。

---

### Domain/Runtime テスト（`Tests/Domain/Runtime/`）

**namespace: `UnmappedIsland.Domain.Runtime`**

`WorldCodex` を読み込んだ後の実行時の振る舞いを検証します。
プロパティ値の変化・スタッキング・オーバーフロー・インタラクションなど、
ゲームプレイ上の挙動が主な関心事です。YAML の解釈ではなく、読み込んだ定義を
ランタイムが正しく実行するかを確認します。

| ファイル | 検証対象 |
|---|---|
| `StackingTests.cs` | `passives` による passive effect のスタッキング挙動 |
| `StackByTests.cs` | `stack_by` に基づくスタック数の計算 |
| `PassiveEffectTests.cs` | passive effect の適用ロジック全般 |
| `OverflowTests.cs` | `range` 超過時の `on_overflow` トリガー |
| `TransferTests.cs` | `transfer` アクションによる所有権移譲 |
| `InteractionTests.cs` | `interaction` アクションの実行と結果 |
| `ViewsTests.cs` | `Runtime.Views`（`World` など）の読み取り API |
| `WorldClockTests.cs` | `WorldSession.AdvanceWorldTime` による時間進行ロジック |

**新しい Domain/Runtime テストを追加するとき**
- `WorldObject.Tick()`・`WorldSession.AdvanceWorldTime()` など、ランタイム API を呼び出して
  状態変化を検証するテストをここに置く。
- YAML フィクスチャをインラインで定義し `WorldCodexYamlLoader` でパースする方針を維持する
  （外部ファイルへの依存を最小化するため）。
- YAML の書き方自体を確認したい場合は `Tests/Loader/` に追加する。

## 実行方法

```bash
dotnet test Tests/Tests.csproj
```

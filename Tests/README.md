# Tests

このフォルダには UnmappedIsland のドメインロジック（`Assets/Scripts/` 以下）に対する自動テストが含まれます。
Unity エンジンに依存しない純粋な C# コードを対象としており、`dotnet test` で単独実行できます。

> **テスト全体の配置方針**
>
> テストは次の2か所に分けて管理します。
>
> | 場所 | 実行方法 | 対象 |
> |---|---|---|
> | `Tests/`（このフォルダ） | `dotnet test` | Unity 非依存の純粋 C# コード |
> | `Assets/Tests/`（後述） | Unity Test Runner | `UnityEngine` などに依存するコード |
>
> 基本方針は **「`Tests/` を標準・`Assets/Tests/` は例外」**。
> ロジックは可能な限り `UnityEngine` 非依存に保ち、`dotnet test` で回せる範囲を最大化することが目標です。

## フォルダ構成

```
Tests/
├── Tests.csproj               # テストプロジェクト（net8.0 / NUnit）
├── UnmappedIsland.Core/       # テスト対象コードを参照するライブラリプロジェクト
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
| `StackByTests.cs` | `represented_by` に基づくスタック数の計算 |
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

### GitHub Actions でのレポート

`.github/workflows/tests.yml` では `dotnet test` の結果を TRX として保存し、`dotnet-test-report` artifact として公開します。  
Workflow の Summary にも件数（Total/Passed/Failed/Skipped）とテストメソッド名一覧を出力します。

---

## Unity Test Runner テスト（`Assets/Tests/`）

Unity エンジンに依存する処理（`UnityEngine` API・`MonoBehaviour` ライフサイクル・シーン・物理など）は
`Assets/Tests/` 以下に配置し、Unity Test Runner で実行します。
`dotnet test` では実行できません。

```
Assets/Tests/
├── EditMode/   # UnityEngine 参照は必要だが、シーン再生・フレーム進行が不要なテスト
└── PlayMode/   # MonoBehaviour ライフサイクル・シーン・Coroutine・物理・Update 依存のテスト
```

### EditMode テスト（`Assets/Tests/EditMode/`）

Play モードに入らず、エディタ上で同期的に実行できるテスト。
シーンをロードしたりフレームをまたいだりする必要はないが、`UnityEngine` API への参照が必要なケースが対象。

**配置基準の例**
- `Application.streamingAssetsPath` / `Application.persistentDataPath` など Unity の環境情報を使う処理
- `ScriptableObject` の生成や `Resources.Load` などエディタ API を使う処理
- `UnityEngine` 型を受け渡すアダプタ層（例: `WorldCodexUnityLoader`）の薄い結合テスト

### PlayMode テスト（`Assets/Tests/PlayMode/`）

Play モードに入り、フレームをまたいで実行されるテスト。
`MonoBehaviour` の Unity メッセージ（`Awake`・`Start`・`Update` など）や Coroutine、
シーン遷移、物理演算など、エンジンのランタイムが動作していないと再現できない挙動が対象。

**配置基準の例**
- `GameManager` など MonoBehaviour のシングルトンの初期化・破棄順
- シーン遷移の前後で状態が正しく引き継がれるか
- Coroutine や `yield return` を含む非同期フロー
- UI の表示・入力イベントの反応

### 新しい Unity テストを追加するとき

1. まずそのロジックを `UnityEngine` 非依存のクラスへ切り出せないかを検討する。
2. 切り出せた部分のテストは `Tests/`（`dotnet test`）に追加する。
3. どうしても `UnityEngine` が必要な部分だけを `Assets/Tests/EditMode/` または `PlayMode/` に置く。
4. シーン再生やフレーム進行が不要であれば PlayMode より EditMode を優先する（実行が速く CI でも安定するため）。

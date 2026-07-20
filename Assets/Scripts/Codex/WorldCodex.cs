namespace UnmappedIsland.Codex
{
    /// <summary>
    /// ゲームデータ全体（GameElementDefinition.md 3.1節: 「ファイル全体が1つの WorldCodex を表します」）を
    /// 表す、唯一の集約オブジェクト。名前空間ではなくこのクラスが「WorldCodex」そのもの。実行中に生成される
    /// WorldObject（可変な実行時状態）を含まない、という点だけが定義であり、プログラム的な意味での不変
    /// （一度組み立てたら二度と書き換えないという制約）は意図していない。将来、WorldCodex自身を文字列化
    /// する処理や、ゲームデータのセーブ/ロードを実装する予定があり、そのいずれもこのインスタンス自身を
    /// 段階的に組み立て直す・読み直す形になる見込みのため。
    ///
    /// 中身は本体データ（ObjectDefTable）と、それを読むために必要な5種の名前空間
    /// （object/property/slot/tag/symbol）のNameRegistry、および汎用エンジンが規約として直接参照する
    /// WellKnownProperties。5種のNameRegistryはこのクラス自身が生成・保持する（ロード処理側が個別に
    /// 作ってコンストラクタへ渡すのではない）。SymbolNamesは、シンボル型のprops（6節）の値（整数にも
    /// 真偽値にもならない識別子）が登録される名前空間で、他の4種とは独立（同じ文字列が別の名前空間で
    /// 使われていても衝突しない）。
    ///
    /// ロード処理（Loader.WorldCodexYamlLoader）は、まずこのインスタンスを1つ作り、そのまま
    /// Loader.ObjectDefYamlConverter以下の全パース処理へ渡す（個々のNameRegistryをばらばらに引数として
    /// 渡し回さない）。全object_defのパースが終わり、ObjectDefTable・WellKnownPropertiesが確定した時点で
    /// SetObjectsを1度だけ呼び、このインスタンスを完成させる。
    /// </summary>
    public sealed class WorldCodex
    {
        public NameRegistry ObjectNames { get; } = new NameRegistry();
        public NameRegistry PropertyNames { get; } = new NameRegistry();
        public NameRegistry SlotNames { get; } = new NameRegistry();
        public NameRegistry TagNames { get; } = new NameRegistry();
        public NameRegistry SymbolNames { get; } = new NameRegistry();

        /// <summary>SetObjectsが呼ばれるまではnull（ロード処理の途中であることを示す）。</summary>
        public ObjectDefTable Objects { get; private set; }

        /// <summary>SetObjectsが呼ばれるまではnull。</summary>
        public WellKnownProperties WellKnown { get; private set; }

        /// <summary>全object_defのパースが完了した時点で、Loader.WorldCodexYamlLoaderが1度だけ呼ぶ。</summary>
        internal void SetObjects(ObjectDefTable objects, WellKnownProperties wellKnown)
        {
            Objects = objects;
            WellKnown = wellKnown;
        }
    }
}

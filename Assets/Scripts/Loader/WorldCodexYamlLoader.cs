using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnmappedIsland.Codex;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// YAMLファイル群からWorldCodexを組み立てる、ロード処理の入口（GameElementDefinition.md 3節）。
    /// Codex/Runtimeとは異なりUnityEngineには依存しないが、実際のファイルI/Oには素朴に
    /// System.IO.Fileを使う（StreamingAssets等プラットフォーム固有の読み出しが必要な場合、
    /// 実際のパス解決・バイト列取得はUnity側の薄い呼び出し元で行い、ここへはテキストとして渡す
    /// Load経由で使う）。
    ///
    /// インスタンス化して使う（staticではない）。ロード対象は基本的に使い捨てだが、再利用したいという
    /// ニーズがあるわけではなく、単に「組み立て途中の世界」を表すオブジェクトとして自然にそうなる、という
    /// だけの理由。Load系メソッド（LoadFromDirectory/LoadFromFile/Load）は何度でも呼べ、呼ぶたびに
    /// object_defs/traitsをこのインスタンス自身へ追記する。いずれもthisを返すため、Buildまで式をつなげて
    /// 書ける（例: `new WorldCodexYamlLoader().LoadFromDirectory(dir).Build()`）。
    ///
    /// object_defs/trait名の重複は、呼び出し元・ファイル・ディレクトリを問わず常にエラーとする（3.3節の
    /// 厳格モード）。MODによる既存定義の差し替えは、この「追加」の文法とは別に、専用の「既存object_defへの
    /// patch」文法を用意して表現する想定（追加のつもりが誤って上書きしてしまう事故を防ぐため）。そのため
    /// このローダー自身は「後勝ちで上書き」という規則を一切持たない。
    ///
    /// Buildを呼ぶと、それまでに蓄積した内容から最終的な不変のWorldCodexを1つ組み立てて返し、その時点で
    /// このインスタンスの蓄積状態は初期化される（再利用したいという積極的なニーズがあるわけではないが、
    /// 初期化しておくこと自体に特にコストが無く、同じインスタンスを次の別のロードにそのまま使い回せて
    /// 困る理由も無いため）。
    /// </summary>
    public sealed class WorldCodexYamlLoader
    {
        private static readonly string[] YamlExtensions = { ".yaml", ".yml" };

        /// <summary>Load系メソッドで蓄積したobject_defs/traitsの生YAMLノード。Buildが呼ばれるまでの
        /// 「組み立て途中の世界」の中身そのもの。</summary>
        private readonly Dictionary<string, (YamlMappingNode Node, string Source)> globalObjectDefs = new Dictionary<string, (YamlMappingNode, string)>();
        private readonly Dictionary<string, (YamlMappingNode Node, string Source)> globalTraits = new Dictionary<string, (YamlMappingNode, string)>();

        /// <summary>
        /// 5種の名前空間（object/property/slot/tag/symbol）のNameRegistry。Buildの中でのみ使う
        /// （Load系メソッドは生YAMLノードの収集のみを行い、名前解決は一切しない）が、Loader.
        /// ObjectDefYamlConverter以下の各パース処理へこのインスタンス自身を渡すことで、これらの
        /// メソッドが必要な名前空間をここから読めるようにする（NameRegistryをバラバラの引数として
        /// 渡し回さない）。
        /// </summary>
        internal NameRegistry ObjectNames { get; private set; } = new NameRegistry();
        internal NameRegistry PropertyNames { get; private set; } = new NameRegistry();
        internal NameRegistry SlotNames { get; private set; } = new NameRegistry();
        internal NameRegistry TagNames { get; private set; } = new NameRegistry();
        internal NameRegistry SymbolNames { get; private set; } = new NameRegistry();

        /// <summary>
        /// 1つのディレクトリ以下の*.yaml/*.ymlファイルを再帰的に（決定的な順序で）すべて読み込み、
        /// object_defs/traitsをこのインスタンスへ追記する。何度でも呼べる。
        /// </summary>
        public WorldCodexYamlLoader LoadFromDirectory(string directory)
        {
            foreach (string path in FindYamlFiles(directory))
                LoadFromFile(path);
            return this;
        }

        /// <summary>1つのファイルを読み込み、object_defs/traitsをこのインスタンスへ追記する。何度でも呼べる。</summary>
        public WorldCodexYamlLoader LoadFromFile(string path) => Load(path, File.ReadAllText(path));

        /// <summary>
        /// 既にテキストとして読み込まれた1つのYAML（labelはエラーメッセージ用の出所表示）を読み込み、
        /// object_defs/traitsをこのインスタンスへ追記する（Unity依存のファイルI/Oを呼び出し元に委ねたい
        /// 場合や、テストでファイルを介さず直接YAML文字列を渡したい場合に使う）。何度でも呼べる。
        /// </summary>
        public WorldCodexYamlLoader Load(string label, string yamlText)
        {
            YamlMappingNode root;
            try
            {
                var stream = new YamlStream();
                stream.Load(new StringReader(yamlText));
                if (stream.Documents.Count == 0) return this;
                root = (YamlMappingNode)stream.Documents[0].RootNode;
            }
            catch (YamlDotNet.Core.YamlException ex)
            {
                throw new YamlLoadException($"{label}: YAML構文エラー: {ex.Message}", ex);
            }

            YamlMappingNode objectDefs = root.TryGetMapping("object_defs", label);
            if (objectDefs != null)
                foreach (var (name, node) in objectDefs.EntriesInOrder())
                    AddUnique(globalObjectDefs, name, (YamlMappingNode)node, label, "object_defs");

            YamlMappingNode traits = root.TryGetMapping("traits", label);
            if (traits != null)
                foreach (var (name, node) in traits.EntriesInOrder())
                    AddUnique(globalTraits, name, (YamlMappingNode)node, label, "traits");

            return this;
        }

        /// <summary>
        /// これまでLoad系メソッドで蓄積したobject_defs/traitsから、最終的な不変のWorldCodexを1つ組み立てて
        /// 返す。呼び終わると、このインスタンスの蓄積状態（object_defs/traits・5種のNameRegistry）は
        /// 初期化される。
        /// </summary>
        public WorldCodex Build()
        {
            var traitsByName = globalTraits.ToDictionary(kv => kv.Key, kv => TraitMerger.ParseTraitEntry(kv.Key, kv.Value.Node));
            var objectDefsByGlobalId = new Dictionary<int, ObjectDef>();

            foreach (var kv in globalObjectDefs)
            {
                TraitMerger.RawObjectDef raw = TraitMerger.ParseObjectDefEntry(kv.Key, kv.Value.Node);
                var (props, slots, passiveNodes, stackOrder, actions, combinations, tags) = TraitMerger.Resolve(raw, traitsByName);
                ObjectDef def = ObjectDefYamlConverter.Build(
                    kv.Key, raw.IsSingleton, tags, props, slots, passiveNodes, stackOrder, actions, combinations, this);
                objectDefsByGlobalId[def.GlobalId] = def;
            }

            // ここで初めて全object_defを走査し終えるため、ObjectNames.Countが最終値として確定する
            // （個々のObjectDef自体はInternの都度、その時点までの登録状況だけを見て組み立てられている）。
            var defsByGlobalId = new ObjectDef[ObjectNames.Count];
            foreach (var kv in objectDefsByGlobalId) defsByGlobalId[kv.Key] = kv.Value;

            var wellKnown = new WellKnownProperties(PropertyNames);
            var codex = new WorldCodex(ObjectNames, PropertyNames, SlotNames, TagNames, SymbolNames, new ObjectDefTable(defsByGlobalId), wellKnown);

            Reset();
            return codex;
        }

        private void Reset()
        {
            globalObjectDefs.Clear();
            globalTraits.Clear();
            ObjectNames = new NameRegistry();
            PropertyNames = new NameRegistry();
            SlotNames = new NameRegistry();
            TagNames = new NameRegistry();
            SymbolNames = new NameRegistry();
        }

        private static void AddUnique(
            Dictionary<string, (YamlMappingNode Node, string Source)> map, string name, YamlMappingNode node, string source, string kindLabel)
        {
            if (map.TryGetValue(name, out var existing))
                throw new YamlLoadException(
                    $"{kindLabel} '{name}' が重複しています（'{existing.Source}' と '{source}'）。");
            map[name] = (node, source);
        }

        private static IEnumerable<string> FindYamlFiles(string directory)
        {
            if (!Directory.Exists(directory)) yield break;

            var files = Directory.GetFiles(directory, "*", SearchOption.AllDirectories)
                .Where(f => YamlExtensions.Contains(Path.GetExtension(f).ToLowerInvariant()))
                .OrderBy(f => f, System.StringComparer.Ordinal);

            foreach (string file in files) yield return file;
        }
    }
}

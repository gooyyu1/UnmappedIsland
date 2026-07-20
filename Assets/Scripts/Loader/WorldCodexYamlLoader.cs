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
    /// LoadFromGroups経由で使う）。
    ///
    /// インスタンス化して使う（staticではない）。ロード対象は基本的に使い捨てだが、再利用したいという
    /// ニーズがあるわけではなく、単に「組み立て途中の世界」を表すオブジェクトとして自然にそうなる、という
    /// だけの理由。Load系メソッド（LoadDirectories/LoadFromGroups）は何度でも呼べ、呼ぶたびに
    /// object_defs/traitsをこのインスタンス自身へ追記する（後から呼んだ分が同名エントリを上書きする、
    /// MOD等の複数情報源対応。3.3節）。Buildを呼ぶと、それまでに蓄積した内容から最終的な不変のWorldCodex
    /// を1つ組み立てて返し、その時点でこのインスタンスの蓄積状態は初期化される（再利用したいという
    /// 積極的なニーズがあるわけではないが、初期化しておくこと自体に特にコストが無く、同じインスタンスを
    /// 次の別のロードにそのまま使い回せて困る理由も無いため）。
    ///
    /// 複数の情報源グループ（例: ゲーム本体のディレクトリ＋外部MODディレクトリ）を渡せる。同一グループ内
    /// （＝同一の情報源）でのobject_defs/trait名の重複はエラー（3.3節の厳格モード）。異なるグループ間
    /// では、後から渡したグループの定義が同名の定義を上書きする（MODが本体の定義を差し替えられるように
    /// するため。3.3節で未定とされていたマージ規則をこの実装で決定した）。
    /// </summary>
    public sealed class WorldCodexYamlLoader
    {
        private static readonly string[] YamlExtensions = { ".yaml", ".yml" };

        /// <summary>1つの情報源グループ（例: 1ディレクトリ）に属するYAMLファイル1つ分。</summary>
        public readonly struct SourceFile
        {
            public readonly string Label;
            public readonly string Text;

            public SourceFile(string label, string text)
            {
                Label = label;
                Text = text;
            }
        }

        /// <summary>1つの情報源グループ（同一ディレクトリ相当）と、それに属するファイル群。</summary>
        public readonly struct SourceGroup
        {
            public readonly string GroupLabel;
            public readonly IReadOnlyList<SourceFile> Files;

            public SourceGroup(string groupLabel, IReadOnlyList<SourceFile> files)
            {
                GroupLabel = groupLabel;
                Files = files;
            }
        }

        /// <summary>Load系メソッドで蓄積したobject_defs/traitsの生YAMLノード。Buildが呼ばれるまでの
        /// 「組み立て途中の世界」の中身そのもの。</summary>
        private Dictionary<string, (YamlMappingNode Node, string Source)> globalObjectDefs = new Dictionary<string, (YamlMappingNode, string)>();
        private Dictionary<string, (YamlMappingNode Node, string Source)> globalTraits = new Dictionary<string, (YamlMappingNode, string)>();

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
        /// ディレクトリ群のobject_defs/traitsを、このインスタンスへ追記する。各ディレクトリ以下の
        /// *.yaml/*.ymlファイルを再帰的に（決定的な順序で）すべて読み込む。ディレクトリ1つ＝情報源
        /// グループ1つとして扱う。何度でも呼べる（後から呼んだ分が同名エントリを上書きする）。
        /// </summary>
        public void LoadDirectories(IReadOnlyList<string> directoryPaths)
        {
            var groups = new List<SourceGroup>();

            foreach (string directory in directoryPaths)
            {
                var files = FindYamlFiles(directory)
                    .Select(path => new SourceFile(path, File.ReadAllText(path)))
                    .ToList();
                groups.Add(new SourceGroup(directory, files));
            }

            LoadFromGroups(groups);
        }

        /// <summary>
        /// 既にテキストとして読み込まれたYAML群のobject_defs/traitsを、このインスタンスへ追記する
        /// （Unity依存のファイルI/Oを呼び出し元に委ねたい場合に使う）。groupsの並び順が上書き優先順位を
        /// 決める（後のグループほど優先。同一グループ内の重複はエラー）。何度でも呼べる。
        /// </summary>
        public void LoadFromGroups(IReadOnlyList<SourceGroup> groups)
        {
            foreach (SourceGroup group in groups)
            {
                var groupObjectDefs = new Dictionary<string, (YamlMappingNode, string)>();
                var groupTraits = new Dictionary<string, (YamlMappingNode, string)>();

                foreach (SourceFile file in group.Files)
                    ParseFileInto(file.Text, file.Label, groupObjectDefs, groupTraits);

                foreach (var kv in groupObjectDefs) globalObjectDefs[kv.Key] = kv.Value;
                foreach (var kv in groupTraits) globalTraits[kv.Key] = kv.Value;
            }
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
            globalObjectDefs = new Dictionary<string, (YamlMappingNode, string)>();
            globalTraits = new Dictionary<string, (YamlMappingNode, string)>();
            ObjectNames = new NameRegistry();
            PropertyNames = new NameRegistry();
            SlotNames = new NameRegistry();
            TagNames = new NameRegistry();
            SymbolNames = new NameRegistry();
        }

        private static void ParseFileInto(
            string yamlText, string fileLabel,
            Dictionary<string, (YamlMappingNode, string)> groupObjectDefs,
            Dictionary<string, (YamlMappingNode, string)> groupTraits)
        {
            YamlMappingNode root;
            try
            {
                var stream = new YamlStream();
                stream.Load(new StringReader(yamlText));
                if (stream.Documents.Count == 0) return;
                root = (YamlMappingNode)stream.Documents[0].RootNode;
            }
            catch (YamlDotNet.Core.YamlException ex)
            {
                throw new YamlLoadException($"{fileLabel}: YAML構文エラー: {ex.Message}", ex);
            }

            YamlMappingNode objectDefs = root.TryGetMapping("object_defs", fileLabel);
            if (objectDefs != null)
                foreach (var (name, node) in objectDefs.EntriesInOrder())
                    AddUnique(groupObjectDefs, name, (YamlMappingNode)node, fileLabel, "object_defs");

            YamlMappingNode traits = root.TryGetMapping("traits", fileLabel);
            if (traits != null)
                foreach (var (name, node) in traits.EntriesInOrder())
                    AddUnique(groupTraits, name, (YamlMappingNode)node, fileLabel, "traits");
        }

        private static void AddUnique(
            Dictionary<string, (YamlMappingNode Node, string Source)> map, string name, YamlMappingNode node, string source, string kindLabel)
        {
            if (map.TryGetValue(name, out var existing))
                throw new YamlLoadException(
                    $"{kindLabel} '{name}' が同一ディレクトリ内で重複しています（'{existing.Source}' と '{source}'）。");
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

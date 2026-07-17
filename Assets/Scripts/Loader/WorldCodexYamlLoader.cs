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
    /// 複数の情報源グループ（例: ゲーム本体のディレクトリ＋外部MODディレクトリ）を渡せる。同一グループ内
    /// （＝同一の情報源）でのobject_defs/trait名の重複はエラー（3.3節の厳格モード）。異なるグループ間
    /// では、後から渡したグループの定義が同名の定義を上書きする（MODが本体の定義を差し替えられるように
    /// するため。3.3節で未定とされていたマージ規則をこの実装で決定した）。
    /// </summary>
    public static class WorldCodexYamlLoader
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

        /// <summary>
        /// ディレクトリ群からWorldCodexを組み立てる。各ディレクトリ以下の*.yaml/*.ymlファイルを
        /// 再帰的に（決定的な順序で）すべて読み込む。ディレクトリ1つ＝情報源グループ1つとして扱う。
        /// </summary>
        public static WorldCodex LoadDirectories(IReadOnlyList<string> directoryPaths)
        {
            var groups = new List<SourceGroup>();

            foreach (string directory in directoryPaths)
            {
                var files = FindYamlFiles(directory)
                    .Select(path => new SourceFile(path, File.ReadAllText(path)))
                    .ToList();
                groups.Add(new SourceGroup(directory, files));
            }

            return LoadFromGroups(groups);
        }

        /// <summary>
        /// 既にテキストとして読み込まれたYAML群からWorldCodexを組み立てる（Unity依存のファイルI/Oを
        /// 呼び出し元に委ねたい場合に使う）。groupsの並び順が上書き優先順位を決める
        /// （後のグループほど優先。同一グループ内の重複はエラー）。
        /// </summary>
        public static WorldCodex LoadFromGroups(IReadOnlyList<SourceGroup> groups)
        {
            var globalObjectDefs = new Dictionary<string, (YamlMappingNode Node, string Source)>();
            var globalTraits = new Dictionary<string, (YamlMappingNode Node, string Source)>();

            foreach (SourceGroup group in groups)
            {
                var groupObjectDefs = new Dictionary<string, (YamlMappingNode, string)>();
                var groupTraits = new Dictionary<string, (YamlMappingNode, string)>();

                foreach (SourceFile file in group.Files)
                    ParseFileInto(file.Text, file.Label, groupObjectDefs, groupTraits);

                foreach (var kv in groupObjectDefs) globalObjectDefs[kv.Key] = kv.Value;
                foreach (var kv in groupTraits) globalTraits[kv.Key] = kv.Value;
            }

            var traitsByName = globalTraits.ToDictionary(kv => kv.Key, kv => TraitMerger.ParseTraitEntry(kv.Key, kv.Value.Node));

            var symbols = new NameRegistry();
            var blueprints = new List<ObjectDefBlueprint>();

            foreach (var kv in globalObjectDefs)
            {
                TraitMerger.RawObjectDef raw = TraitMerger.ParseObjectDefEntry(kv.Key, kv.Value.Node);
                var (props, slots, passiveNodes, stackOrder, actions, combinations) = TraitMerger.Resolve(raw, traitsByName);
                blueprints.Add(ObjectDefYamlConverter.Build(
                    kv.Key, raw.IsSingleton, raw.TraitNames, props, slots, passiveNodes, stackOrder, actions, combinations, symbols));
            }

            return WorldCodexBuilder.Build(blueprints, symbols);
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

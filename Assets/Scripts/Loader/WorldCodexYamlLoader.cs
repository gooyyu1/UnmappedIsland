using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// YAMLファイル群からWorldCodexを組み立てるロード処理の入口（GameElementDefinition.md 3節）。
    /// UnityEngineには依存しない（プラットフォーム固有のファイルI/Oが必要な場合は、呼び出し元が
    /// テキストを取得してLoadへ渡す）。
    ///
    /// パース全般をこのクラスが担い、5種のNameRegistryを保持する。「trait解決込みでobject_defを
    /// 組み立てる」責務はRawObjectDef.Resolveが担う。props/slots/actions/combinationsはフィールド
    /// 単位のtrait上書きマージ対象のため、深い意味解釈とprop/slot名等のInternはLoad時点ではなく
    /// Resolveまで遅延する。object_def自身のGlobalIdのみtrait解決に依存しないため、ParseObjectDefの
    /// 時点で確定する。
    ///
    /// Load系メソッドは何度でも呼べ、呼ぶたびにこのインスタンスへ追記する（thisを返すため
    /// `new WorldCodexYamlLoader().LoadFromDirectory(dir).Build()`と書ける）。
    ///
    /// object_defs/trait名の重複は、呼び出し元・ファイル・ディレクトリを問わず常にエラー（3.3節の
    /// 厳格モード）。「後勝ちで上書き」の規則は一切持たない（MODによる差し替えは専用のpatch文法で
    /// 表現する想定）。
    ///
    /// Buildは蓄積内容から不変のWorldCodexを組み立てて返し、このインスタンスの蓄積状態を初期化する。
    /// </summary>
    public sealed partial class WorldCodexYamlLoader
    {
        private static readonly string[] YamlExtensions = { ".yaml", ".yml" };

        /// <summary>Load系メソッドで蓄積した、パース済みだがtrait未解決のobject_defs/traits。</summary>
        private readonly Dictionary<string, RawObjectDef> globalObjectDefs = new Dictionary<string, RawObjectDef>();
        private readonly Dictionary<string, RawTrait> globalTraits = new Dictionary<string, RawTrait>();

        /// <summary>5種の名前空間（object/property/slot/tag/symbol）のNameRegistry。</summary>
        public NameRegistry ObjectNames { get; private set; } = new NameRegistry();
        public NameRegistry PropertyNames { get; private set; } = new NameRegistry();
        public NameRegistry SlotNames { get; private set; } = new NameRegistry();
        public NameRegistry TagNames { get; private set; } = new NameRegistry();
        public NameRegistry SymbolNames { get; private set; } = new NameRegistry();

        /// <summary>1つのディレクトリ以下の*.yaml/*.ymlファイルを再帰的に（決定的な順序で）すべて読み込む。</summary>
        public WorldCodexYamlLoader LoadFromDirectory(string directory)
        {
            foreach (string path in FindYamlFiles(directory))
                LoadFromFile(path);
            return this;
        }

        /// <summary>1つのファイルを読み込む。</summary>
        public WorldCodexYamlLoader LoadFromFile(string path) => Load(path, File.ReadAllText(path));

        /// <summary>テキストとして渡された1つのYAMLを読み込む（labelはエラーメッセージ用の出所表示）。</summary>
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
                    AddUnique(globalObjectDefs, name, ParseObjectDef(name, (YamlMappingNode)node, label), "object_defs");

            YamlMappingNode traits = root.TryGetMapping("traits", label);
            if (traits != null)
                foreach (var (name, node) in traits.EntriesInOrder())
                    AddUnique(globalTraits, name, ParseTrait(name, (YamlMappingNode)node, label), "traits");

            // 地形生成の3ルートキー（axes/location_types/generation_scopes。WorldCodexYamlLoader.Generation.cs）。
            LoadGenerationSections(label, root);

            return this;
        }

        /// <summary>蓄積したobject_defs/traitsから不変のWorldCodexを組み立てて返す。呼び終わると
        /// このインスタンスの蓄積状態は初期化される。</summary>
        public WorldCodex Build()
        {
            var objectDefsByGlobalId = new Dictionary<int, ObjectDef>();
            foreach (var kv in globalObjectDefs)
            {
                ObjectDef def = kv.Value.Resolve(globalTraits, this);
                objectDefsByGlobalId[def.GlobalId] = def;
            }

            // 全object_defの走査が終わったこの時点で、ObjectNames.Countが最終値として確定する。
            var defsByGlobalId = new ObjectDef[ObjectNames.Count];
            foreach (var kv in objectDefsByGlobalId) defsByGlobalId[kv.Key] = kv.Value;

            var wellKnown = new WellKnownProperties(PropertyNames);
            var generation = BuildGenerationDefs(objectDefsByGlobalId);
            var codex = new WorldCodex(ObjectNames, PropertyNames, SlotNames, TagNames, SymbolNames, new ObjectDefTable(defsByGlobalId), wellKnown, generation);

            Reset();
            return codex;
        }

        private void Reset()
        {
            globalObjectDefs.Clear();
            globalTraits.Clear();
            ResetGeneration();
            ObjectNames = new NameRegistry();
            PropertyNames = new NameRegistry();
            SlotNames = new NameRegistry();
            TagNames = new NameRegistry();
            SymbolNames = new NameRegistry();
        }

        /// <summary>object_defs.'name'の1エントリを浅く抽出する。trait合成（RawObjectDef.Resolve）が
        /// まだ起こりうるフィールドは生YAMLノードのまま持つ。GlobalIdのみここで確定させる。</summary>
        private RawObjectDef ParseObjectDef(string name, YamlMappingNode node, string source)
        {
            string context = $"object_defs.'{name}'";

            var raw = new RawObjectDef
            {
                Name = name,
                Source = source,
                GlobalId = ObjectNames.Intern(name),
                IsSingleton = node.TryGetBool("singleton", context, fallback: false),
                Props = node.TryGetMapping("props", context),
                Slots = node.TryGetMapping("slots", context),
                Passives = node.TryGetSequence("passives", context),
                StackOrder = node.TryGetMapping("stack_order", context),
                RepresentedBy = node.TryGetScalar("represented_by", context),
                Actions = node.TryGetMapping("actions", context),
                Combinations = node.TryGetMapping("combinations", context),
            };

            YamlSequenceNode traits = node.TryGetSequence("traits", context);
            if (traits != null)
                foreach (YamlNode t in traits)
                    raw.TraitNames.Add(((YamlScalarNode)t).Value);

            YamlSequenceNode tags = node.TryGetSequence("tags", context);
            if (tags != null)
                foreach (YamlNode t in tags)
                    raw.Tags.Add(((YamlScalarNode)t).Value);

            return raw;
        }

        /// <summary>traits.'name'の1エントリを浅く抽出する（ParseObjectDefと同じく生YAMLノードのまま持つ）。
        /// traitは実行時に識別されないため、interning対象の識別子を持たない。</summary>
        private RawTrait ParseTrait(string name, YamlMappingNode node, string source)
        {
            string context = $"traits.'{name}'";

            var raw = new RawTrait
            {
                Name = name,
                Source = source,
                Props = node.TryGetMapping("props", context),
                Slots = node.TryGetMapping("slots", context),
                Passives = node.TryGetSequence("passives", context),
                StackOrder = node.TryGetMapping("stack_order", context),
                RepresentedBy = node.TryGetScalar("represented_by", context),
                Actions = node.TryGetMapping("actions", context),
                Combinations = node.TryGetMapping("combinations", context),
            };

            YamlSequenceNode tags = node.TryGetSequence("tags", context);
            if (tags != null)
                foreach (YamlNode t in tags)
                    raw.Tags.Add(((YamlScalarNode)t).Value);

            return raw;
        }

        private static void AddUnique(Dictionary<string, RawObjectDef> map, string name, RawObjectDef raw, string kindLabel)
        {
            if (map.TryGetValue(name, out var existing))
                throw new YamlLoadException(
                    $"{kindLabel} '{name}' が重複しています（'{existing.Source}' と '{raw.Source}'）。");
            map[name] = raw;
        }

        private static void AddUnique(Dictionary<string, RawTrait> map, string name, RawTrait raw, string kindLabel)
        {
            if (map.TryGetValue(name, out var existing))
                throw new YamlLoadException(
                    $"{kindLabel} '{name}' が重複しています（'{existing.Source}' と '{raw.Source}'）。");
            map[name] = raw;
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

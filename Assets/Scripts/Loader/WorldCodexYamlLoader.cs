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
    /// YAMLの構造をそのまま辿って解釈する「パース」全般をこのクラス自身が担う（このファイルの
    /// ParseObjectDef/ParseTraitという浅い抽出から、他のpartialファイルのParseProp/ParseStage/
    /// ParsePassive等の深い意味解釈まで）。5種のNameRegistryを自分自身で持つため、これらのパース
    /// メソッドは全てインスタンスメソッドになる（NameRegistryをバラバラの引数として渡し回さない）。
    /// 一方、「trait解決込みでobject_defを組み立てる」責務はRawObjectDef.Resolveが担う（自分自身の
    /// フィールドと、渡されたtraitsByName・このローダーを使って、自分から最終的なObjectDefを組み立てる。
    /// RawObjectDef.cs参照）。
    ///
    /// props/slots/actions/combinationsの4つは、フィールド単位のtrait上書きマージ対象であり
    /// （RawObjectDef.Resolve参照）、このマージは意味解釈前の生YAMLノードに対して汎用的に行う
    /// （プロパティかスロットかアクションかを区別しない1つのマージ処理を再利用するため）。そのため、
    /// これらの深い意味解釈（ParseProp/ParseSlot/ParseActions/ParseCombinations、および
    /// ParsePassive）は、Load時点ではなく、trait合成が終わった後のRawObjectDef.Resolveの中で初めて
    /// 呼ばれる。prop/slot名等のInternも同様にResolveまで遅延する（traitからも名前が追加されうる、
    /// shallow-overrideで中身が変わりうる、という2つの理由でLoad時点では確定しないため）。ただし
    /// object_def自身の識別性（GlobalId）はtrait解決に依存しないため、ParseObjectDefの時点で確定する。
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
    public sealed partial class WorldCodexYamlLoader
    {
        private static readonly string[] YamlExtensions = { ".yaml", ".yml" };

        /// <summary>Load系メソッドで蓄積した、パース済みだがtrait未解決のobject_defs/traits。Buildが
        /// 呼ばれるまでの「組み立て途中の世界」の中身そのもの。</summary>
        private readonly Dictionary<string, RawObjectDef> globalObjectDefs = new Dictionary<string, RawObjectDef>();
        private readonly Dictionary<string, RawTrait> globalTraits = new Dictionary<string, RawTrait>();

        /// <summary>
        /// 5種の名前空間（object/property/slot/tag/symbol）のNameRegistry。他のpartialファイルの各パース
        /// メソッドが、このインスタンス自身から必要な名前空間を読む。
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
                    AddUnique(globalObjectDefs, name, ParseObjectDef(name, (YamlMappingNode)node, label), "object_defs");

            YamlMappingNode traits = root.TryGetMapping("traits", label);
            if (traits != null)
                foreach (var (name, node) in traits.EntriesInOrder())
                    AddUnique(globalTraits, name, ParseTrait(name, (YamlMappingNode)node, label), "traits");

            return this;
        }

        /// <summary>
        /// これまでLoad系メソッドで蓄積したobject_defs/traitsから、最終的な不変のWorldCodexを1つ組み立てて
        /// 返す。呼び終わると、このインスタンスの蓄積状態（object_defs/traits・5種のNameRegistry）は
        /// 初期化される。
        /// </summary>
        public WorldCodex Build()
        {
            var objectDefsByGlobalId = new Dictionary<int, ObjectDef>();
            foreach (var kv in globalObjectDefs)
            {
                ObjectDef def = kv.Value.Resolve(globalTraits, this);
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

        /// <summary>object_defs.'name'の1エントリを浅く抽出する。props/slots/passives/stack_order/
        /// actions/combinationsはtrait合成（RawObjectDef.Resolve）がまだ起こりうるため、意味解釈前の
        /// 生YAMLノードのまま持つ。自分自身の識別性（GlobalId）はtrait解決に依存しないため、ここで
        /// ObjectNames.Internを呼んで確定させる。</summary>
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
                StackBy = node.TryGetScalar("stack_by", context),
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

        /// <summary>traits.'name'の1エントリを浅く抽出する。ParseObjectDefと同じ理由で、props/slots/
        /// passives/stack_order/actions/combinationsは生YAMLノードのまま持つ。traitはそれ自体が
        /// インスタンス化されることも、実行時に識別されることも無いため、interning対象の識別子を
        /// 持たない。</summary>
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
                StackBy = node.TryGetScalar("stack_by", context),
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

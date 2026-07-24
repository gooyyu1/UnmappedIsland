using System.Collections.Generic;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// traits（GameElementDefinition.md 5節、mixin）の1エントリの生の形。上書きマージ
    /// （RawObjectDef.Resolve参照）がまだ起こりうるフィールドは生YAMLノードのまま持つ。
    /// 1つのtraitは複数のobject_defから参照され、参照ごとに異なるマージが起こるため、
    /// 「一度きり確定する完成品」にはできない（1回だけ解決されるRawObjectDefとの本質的な違い）。
    /// </summary>
    public sealed class RawTrait
    {
        public string Name;

        /// <summary>読み込み元。重複エラーメッセージの出所表示にのみ使う。</summary>
        public string Source;

        public List<string> Tags = new List<string>();
        public YamlMappingNode Props;
        public YamlMappingNode Slots;
        public YamlSequenceNode Passives;
        public YamlMappingNode StackOrder;

        /// <summary>represented_by（7.6節）で指定されたスロット名。未指定ならnull。</summary>
        public string RepresentedBy;

        public YamlMappingNode Actions;
        public YamlMappingNode Combinations;
    }
}

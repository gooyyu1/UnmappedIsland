using System.Collections.Generic;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// traits（GameElementDefinition.md 5節、mixin）の1エントリの、まだtrait解決（object_defへの合成）を
    /// 経ていない生の形。props/slots/passives/stack_order/actions/combinationsは、フィールド単位の
    /// 上書きマージ（RawObjectDef.Resolve参照）がまだ起こりうるため、あえて意味解釈済みの型にせず
    /// YamlMappingNode/YamlSequenceNodeのまま持つ。
    ///
    /// 1つのtraitは複数のobject_defから参照されうり、参照するobject_defごとに異なるフィールドだけを
    /// 上書きされうるため、trait自身の内容を「一度きり確定する完成品」にはできない（参照されるたびに
    /// 新しいマージが起こる）。この点がRawObjectDef（常にちょうど1回だけ解決される）と本質的に異なり、
    /// RawTraitがRawObjectDefとは別に存在する理由そのものになっている。
    /// </summary>
    internal sealed class RawTrait
    {
        public string Name;

        /// <summary>このtraitが最初に（どのファイル／どのLoad呼び出しから）読み込まれたか。重複エラー
        /// メッセージの出所表示にのみ使う。</summary>
        public string Source;

        public List<string> Tags = new List<string>();
        public YamlMappingNode Props;
        public YamlMappingNode Slots;
        public YamlSequenceNode Passives;
        public YamlMappingNode StackOrder;
        public YamlMappingNode Actions;
        public YamlMappingNode Combinations;
    }
}

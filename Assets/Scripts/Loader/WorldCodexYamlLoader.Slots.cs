using System.Collections.Generic;
using UnmappedIsland.Domain.Defs;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>1つのslots.'slotName'エントリを解釈し、SlotDefを組み立てる。RawObjectDef.Resolveから、
        /// trait合成済みのノードに対して呼ばれるため internal。</summary>
        internal SlotDef ParseSlot(string objectDefName, string slotName, YamlMappingNode node)
        {
            string context = $"'{objectDefName}'.slots.'{slotName}'";
            int slotGlobalId = SlotNames.Intern(slotName);

            var accepts = new List<SlotAcceptRule>();
            YamlSequenceNode acceptsNode = node.TryGetSequence("accepts", context);
            if (acceptsNode != null)
                foreach (YamlNode acceptNode in acceptsNode)
                {
                    var acceptMap = (YamlMappingNode)acceptNode;
                    string acceptContext = $"{context}.accepts";
                    string tagName = acceptMap.TryGetScalar("tag", acceptContext);
                    string objectName = acceptMap.TryGetScalar("object", acceptContext);

                    if (tagName != null && objectName != null)
                        throw new YamlLoadException($"{acceptContext}: 'tag'と'object'は同時に指定できません。");
                    if (tagName == null && objectName == null)
                        throw new YamlLoadException($"{acceptContext}: 'tag'または'object'のいずれかが必要です。");

                    SlotAcceptTargetKind targetKind = tagName != null ? SlotAcceptTargetKind.Tag : SlotAcceptTargetKind.Object;
                    int with = tagName != null ? TagNames.Intern(tagName) : ObjectNames.Intern(objectName);

                    accepts.Add(new SlotAcceptRule(
                        targetKind, with,
                        acceptMap.RequireInt("max", context),
                        acceptMap.TryGetBool("consume", context, fallback: false)));
                }

            double? capacity = node.TryGetDouble("capacity", context);
            double weightRate = node.TryGetDouble("weight_rate", context) ?? 1.0;
            bool stackable = node.TryGetBool("stackable", context, fallback: true);
            int? unitCapacity = node.TryGetInt("unit_capacity", context);
            bool fixedPositions = node.TryGetBool("fixed_positions", context, fallback: false);

            return new SlotDef(slotGlobalId, slotName, accepts, capacity, weightRate, stackable, unitCapacity, fixedPositions);
        }
    }
}

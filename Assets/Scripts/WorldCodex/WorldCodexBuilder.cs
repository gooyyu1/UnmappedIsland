using System.Collections.Generic;
using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Registry;
using UnmappedIsland.Codex.Runtime;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// YAML全体のロード結果（ObjectDefBlueprint の列。実際のYAMLデシリアライズは別途）から、
    /// ただ1つの WorldCodex を組み立てる、ロード処理の入口。
    /// </summary>
    public static class WorldCodexBuilder
    {
        public static WorldCodex Build(IReadOnlyList<ObjectDefBlueprint> blueprints)
        {
            var objectNames = new NameRegistry();
            var propertyNames = new NameRegistry();
            var slotNames = new NameRegistry();
            var symbols = new NameRegistry();

            ObjectDefTable objects = ObjectDefBuilder.Build(blueprints, objectNames, propertyNames, slotNames);
            var wellKnown = new WellKnownProperties(propertyNames);

            return new WorldCodex(objectNames, propertyNames, slotNames, symbols, objects, wellKnown);
        }
    }
}

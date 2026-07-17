using System.Collections.Generic;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// YAML全体のロード結果（ObjectDefBlueprint の列。実際のYAMLデシリアライズは別途）から、
    /// ただ1つの WorldCodex を組み立てる、ロード処理の入口。
    /// </summary>
    public static class WorldCodexBuilder
    {
        /// <summary>
        /// symbolsは省略可能。文字列値のprops（"clear"/"bright"等）を持つ場合、呼び出し側
        /// （YAMLローダー等）がブループリント構築時に同じインスタンスへIntern済みである必要があるため、
        /// そのインスタンスをそのまま受け取れるようにしている。省略時は空のレジストリを新規に使う。
        /// </summary>
        public static WorldCodex Build(IReadOnlyList<ObjectDefBlueprint> blueprints, NameRegistry symbols = null)
        {
            var objectNames = new NameRegistry();
            var propertyNames = new NameRegistry();
            var slotNames = new NameRegistry();
            symbols = symbols ?? new NameRegistry();

            ObjectDefTable objects = ObjectDefBuilder.Build(blueprints, objectNames, propertyNames, slotNames);
            var wellKnown = new WellKnownProperties(propertyNames);

            return new WorldCodex(objectNames, propertyNames, slotNames, symbols, objects, wellKnown);
        }
    }
}

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// エンジン側の汎用ロジック（容量・重さ伝播、ContainerSystem.md）が規約として直接参照するプロパティ名。
    /// "size"/"weight" の2つだけは move_to_slot の不変条件（Slot.CanAccept / WorldObject.MoveToSlot）が
    /// 直接読みに行く。ロード処理の最後、他の全プロパティ名の Intern が終わったタイミングで1回構築する。
    /// </summary>
    public sealed class WellKnownProperties
    {
        public int SizeId { get; }
        public int WeightId { get; }

        public WellKnownProperties(NameRegistry propertyNames)
        {
            SizeId = propertyNames.Intern("size");
            WeightId = propertyNames.Intern("weight");
        }
    }
}

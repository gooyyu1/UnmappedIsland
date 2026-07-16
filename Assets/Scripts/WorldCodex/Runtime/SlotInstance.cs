using System.Collections.Generic;
using UnmappedIsland.WorldCodex.Defs;

namespace UnmappedIsland.WorldCodex.Runtime
{
    /// <summary>
    /// 1つの WorldObject が持つ、1つのスロットの実行時状態。中に入っている WorldObject の一覧を保持する。
    /// 正の情報源はこちら側（親のスロット配列）であり、子側の WorldObject.Parent は逆引き用のキャッシュ（7.1節）。
    /// 中身の追加・削除は Containment.TryMoveToSlot 経由でのみ行う（両者の整合性を1箇所でのみ保証するため）。
    /// </summary>
    public sealed class SlotInstance
    {
        public SlotDef Def { get; }

        private readonly List<WorldObject> contents = new List<WorldObject>();
        public IReadOnlyList<WorldObject> Contents => contents;

        public SlotInstance(SlotDef def)
        {
            Def = def;
        }

        internal void AddInternal(WorldObject obj) => contents.Add(obj);
        internal void RemoveInternal(WorldObject obj) => contents.Remove(obj);
    }
}

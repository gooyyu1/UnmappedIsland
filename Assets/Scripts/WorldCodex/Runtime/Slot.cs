using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex.Defs;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// 1つの WorldObject が持つ、1つのスロットの実行時状態。中に入っている WorldObject の一覧を保持する。
    /// 正の情報源はこちら側（親のスロット配列）であり、子側の WorldObject.Parent は逆引き用のキャッシュ（7.1節）。
    /// 中身の追加・削除は Containment.TryMoveToSlot 経由でのみ行う（両者の整合性を1箇所でのみ保証するため）。
    ///
    /// Contentsの並び順は「表示上のスタック順」そのものを表す実データとして維持する（都度ソートし直す
    /// 派生ビューではない）。同種オブジェクトは常に連続した区間（run）としてまとまり、run内は
    /// ObjectDef.StackOrder（無ければ挿入順）で並ぶ。これは、同種は同じ速度で変化する（accumulateは
    /// ObjectDefごとに一定量）という前提のもとでのみ正しく、値の変化に追従した再ソートは行わない。
    /// </summary>
    public sealed class Slot
    {
        public SlotDef Def { get; }

        private readonly List<WorldObject> contents = new List<WorldObject>();
        public IReadOnlyList<WorldObject> Contents => contents;

        /// <summary>FixedPositionsスロットでのみ使う、ObjectDef.GlobalId → 固定番号の対応表。
        /// 前詰めしないための永続状態（番号が空いても他の型が詰めてこない）。</summary>
        private readonly Dictionary<int, int> gridIndexByType = new Dictionary<int, int>();

        public Slot(SlotDef def)
        {
            Def = def;
        }

        /// <summary>通常の追加。Stackable/FixedPositions/StackOrderに従って正しい位置へ挿入する。</summary>
        internal void AddInternal(WorldObject obj) => contents.Insert(ComputeInsertionIndex(obj), obj);

        /// <summary>same_slotによる置き換え専用。自動ソートを一切行わず、指定indexへそのまま挿入する
        /// （破棄されたオブジェクトが占めていた位置を、通常のスタック走査ロジックを介さずそのまま引き継ぐため）。</summary>
        internal void InsertAtCapturedPosition(WorldObject obj, int capturedIndex) =>
            contents.Insert(Math.Min(capturedIndex, contents.Count), obj);

        internal void RemoveInternal(WorldObject obj)
        {
            contents.Remove(obj);
            if (Def.FixedPositions && contents.All(o => o.Def.GlobalId != obj.Def.GlobalId))
                gridIndexByType.Remove(obj.Def.GlobalId);
        }

        internal int IndexOf(WorldObject obj) => contents.IndexOf(obj);

        internal int CountOfType(int objectDefGlobalId) => contents.Count(o => o.Def.GlobalId == objectDefGlobalId);

        internal int DistinctTypeCount => contents.Select(o => o.Def.GlobalId).Distinct().Count();

        /// <summary>UnitCapacity（種類数/個数の上限）に、対象オブジェクトを新たに加える余地があるか。</summary>
        internal bool HasCapacityFor(int objectDefGlobalId)
        {
            if (!Def.UnitCapacity.HasValue) return true;

            bool alreadyCounted = Def.Stackable && CountOfType(objectDefGlobalId) > 0;
            if (alreadyCounted) return true;

            int currentUnits = Def.Stackable ? DistinctTypeCount : contents.Count;
            return currentUnits < Def.UnitCapacity.Value;
        }

        /// <summary>FixedPositionsスロット専用。指定した型の固定番号を返す（未割当ならnull）。</summary>
        public int? GetGridIndex(int objectDefGlobalId) =>
            gridIndexByType.TryGetValue(objectDefGlobalId, out int index) ? index : (int?)null;

        /// <summary>既に割り当て済みならそれを、無ければ空いている最小番号を新規に割り当てて返す。</summary>
        private int AssignGridIndex(int objectDefGlobalId)
        {
            if (gridIndexByType.TryGetValue(objectDefGlobalId, out int existing)) return existing;

            for (int i = 0; i < Def.UnitCapacity.GetValueOrDefault(); i++)
            {
                if (!gridIndexByType.ContainsValue(i))
                {
                    gridIndexByType[objectDefGlobalId] = i;
                    return i;
                }
            }

            throw new InvalidOperationException(
                $"'{Def.Name}' に空いている固定番号がありません（呼び出し側でHasCapacityForを確認していないはずです）。");
        }

        /// <summary>same_slotによる型変更で、破棄されるオブジェクトが最後の1個だった場合に、
        /// その固定番号を新しい型へそのまま引き継がせるために使う。</summary>
        internal void SeedGridIndex(int objectDefGlobalId, int gridIndex) => gridIndexByType[objectDefGlobalId] = gridIndex;

        /// <summary>
        /// same_slotで新しい型がselfIndexの隣へ割り込む必要がある場合（自分の固定番号をそのまま
        /// 再利用できない場合）に使う。まずselfIndexの右側（+1以降）で最初に空いている番号を探し、
        /// 見つかれば間にいる型を+1して押し出しながら割り込ませる。右側に空きが無ければ、今度は
        /// selfIndexの左側（-1以前）で最初に空いている番号を探し、見つかれば間にいる型を-1して
        /// 押し出しながら割り込ませる（「右が空いている限り右に、そうでなければ左に生まれる」）。
        /// いずれの方向にも空きが見つからなければfalseを返す（呼び出し側でfallbackへ委ねる）。
        /// 押し出しは型（グリッド番号）単位で行うため、押し出される型がスタック（同種複数個）で
        /// あっても、その中身の相対順序・スタック自体には影響しない。
        /// </summary>
        internal bool TryMakeRoomAndSeed(int newObjectDefGlobalId, int selfIndex) =>
            TryMakeRoomRightwardAndSeed(newObjectDefGlobalId, selfIndex + 1) ||
            TryMakeRoomLeftwardAndSeed(newObjectDefGlobalId, selfIndex - 1);

        private bool TryMakeRoomRightwardAndSeed(int newObjectDefGlobalId, int targetIndex)
        {
            int capacity = Def.UnitCapacity.GetValueOrDefault();
            if (targetIndex < 0 || targetIndex >= capacity) return false;

            var occupied = new HashSet<int>(gridIndexByType.Values);
            int emptyAt = -1;
            for (int i = targetIndex; i < capacity; i++)
            {
                if (!occupied.Contains(i)) { emptyAt = i; break; }
            }
            if (emptyAt == -1) return false;

            foreach (int typeId in gridIndexByType.Keys.ToList())
            {
                int index = gridIndexByType[typeId];
                if (index >= targetIndex && index < emptyAt) gridIndexByType[typeId] = index + 1;
            }

            gridIndexByType[newObjectDefGlobalId] = targetIndex;
            return true;
        }

        private bool TryMakeRoomLeftwardAndSeed(int newObjectDefGlobalId, int targetIndex)
        {
            if (targetIndex < 0 || targetIndex >= Def.UnitCapacity.GetValueOrDefault()) return false;

            var occupied = new HashSet<int>(gridIndexByType.Values);
            int emptyAt = -1;
            for (int i = targetIndex; i >= 0; i--)
            {
                if (!occupied.Contains(i)) { emptyAt = i; break; }
            }
            if (emptyAt == -1) return false;

            foreach (int typeId in gridIndexByType.Keys.ToList())
            {
                int index = gridIndexByType[typeId];
                if (index > emptyAt && index <= targetIndex) gridIndexByType[typeId] = index - 1;
            }

            gridIndexByType[newObjectDefGlobalId] = targetIndex;
            return true;
        }

        /// <summary>
        /// プレイヤーによる手動並び替え。対象の型が既に存在する番号と入れ替える（無ければ何もしない）。
        /// 前詰めしない前提のため、単純な2者間のswapとして表現する。
        /// </summary>
        public bool TrySetManualPosition(int objectDefGlobalId, int newGridIndex)
        {
            if (!Def.FixedPositions) return false;
            if (!gridIndexByType.TryGetValue(objectDefGlobalId, out int oldIndex)) return false;
            if (newGridIndex < 0 || newGridIndex >= Def.UnitCapacity.GetValueOrDefault()) return false;

            int? occupant = gridIndexByType.Where(kv => kv.Value == newGridIndex).Select(kv => (int?)kv.Key).FirstOrDefault();

            gridIndexByType[objectDefGlobalId] = newGridIndex;
            if (occupant.HasValue && occupant.Value != objectDefGlobalId)
                gridIndexByType[occupant.Value] = oldIndex;

            return true;
        }

        /// <summary>表示用: 連続した同種の区間（スタック）ごとにグルーピングして返す。</summary>
        public IReadOnlyList<StackView> GetStacks()
        {
            var result = new List<StackView>();
            int i = 0;
            while (i < contents.Count)
            {
                int typeId = contents[i].Def.GlobalId;
                int j = i;
                while (j < contents.Count && contents[j].Def.GlobalId == typeId) j++;
                result.Add(new StackView(contents[i].Def, contents.GetRange(i, j - i)));
                i = j;
            }
            return result;
        }

        private int ComputeInsertionIndex(WorldObject obj)
        {
            if (!Def.Stackable) return contents.Count;

            if (Def.FixedPositions)
                return ComputeIndexForGridOrder(obj, AssignGridIndex(obj.Def.GlobalId));

            var run = FindRun(obj.Def.GlobalId);
            return run.start != -1 ? IndexWithinRun(obj, run.start, run.count) : contents.Count;
        }

        private int ComputeIndexForGridOrder(WorldObject obj, int gridIndex)
        {
            var run = FindRun(obj.Def.GlobalId);
            if (run.start != -1) return IndexWithinRun(obj, run.start, run.count);

            // 新規run: 固定番号の昇順を保つよう、より大きい番号を持つ最初のrunの直前へ挿入する。
            int i = 0;
            while (i < contents.Count)
            {
                int otherType = contents[i].Def.GlobalId;
                int otherGrid = gridIndexByType.TryGetValue(otherType, out int g) ? g : int.MaxValue;
                if (otherGrid > gridIndex) break;

                int j = i;
                while (j < contents.Count && contents[j].Def.GlobalId == otherType) j++;
                i = j;
            }
            return i;
        }

        private (int start, int count) FindRun(int typeId)
        {
            for (int i = 0; i < contents.Count; i++)
            {
                if (contents[i].Def.GlobalId != typeId) continue;
                int j = i;
                while (j < contents.Count && contents[j].Def.GlobalId == typeId) j++;
                return (i, j - i);
            }
            return (-1, 0);
        }

        private int IndexWithinRun(WorldObject obj, int runStart, int runCount)
        {
            StackOrderDef order = obj.Def.StackOrder;
            int end = runStart + runCount;
            if (order == null) return end; // 並び順未定義は常にrunの末尾（挿入順）

            int value = obj.GetNumber(order.PropertyGlobalId);
            int i = runStart;
            while (i < end)
            {
                int otherValue = contents[i].GetNumber(order.PropertyGlobalId);
                bool staysBefore = order.Ascending ? otherValue <= value : otherValue >= value;
                if (!staysBefore) break;
                i++;
            }
            return i;
        }
    }

    /// <summary>Slot.GetStacksが返す、1つの連続した同種区間（表示上のスタック1つ分）。</summary>
    public readonly struct StackView
    {
        public readonly ObjectDef Def;
        public readonly IReadOnlyList<WorldObject> Members;

        public StackView(ObjectDef def, IReadOnlyList<WorldObject> members)
        {
            Def = def;
            Members = members;
        }
    }
}

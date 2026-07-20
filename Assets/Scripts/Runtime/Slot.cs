using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// 1つの WorldObject が持つ、1つのスロットの実行時状態。中に入っている WorldObject を、ObjectStack
    /// （7.6節、「見た目上1つのまとまり」）のリストとして保持する。正の情報源はこちら側（親のスロット配列）
    /// であり、子側の WorldObject.Parent は逆引き用のキャッシュ（7.1節）。
    ///
    /// Stacksの並び順は「表示上のスタック順」そのものを表す実データとして維持する（都度ソートし直す
    /// 派生ビューではない）。中身の追加・削除は WorldObject.MoveToSlot 経由でのみ行う（両者の整合性を
    /// 1箇所でのみ保証するため）。
    /// </summary>
    public sealed class Slot
    {
        public SlotDef Def { get; }

        private readonly List<ObjectStack> stacks = new List<ObjectStack>();
        public IReadOnlyList<ObjectStack> Stacks => stacks;

        /// <summary>スタックの区別を畳み込んだ、このスロットの中身全部のビュー。スタックの概念に興味が無い
        /// 呼び出し側（タグ判定・重さ集計・子の一括走査など、ほとんどが内部処理）はこちらを使う。実データは
        /// あくまでStacksであり、Contentsは呼ぶ都度そこから組み立てる派生ビュー。</summary>
        public IReadOnlyList<WorldObject> Contents => stacks.SelectMany(s => s.Members).ToList();

        /// <summary>same_slot(FixedPositions)専用の一時予約。次にAddInternalで新規スタックが作られる際、
        /// AssignGridIndexで新規採番する代わりにこの値をそのまま割り当てる（1回のAddInternal呼び出しで
        /// 必ず消費される）。TryMakeRoomAndSeed/ReserveGridIndexForNextNewStack参照。</summary>
        private int? pendingGridReservation;

        public Slot(SlotDef def)
        {
            Def = def;
        }

        /// <summary>
        /// move_to_slot（7.1節）が候補オブジェクトを受け入れられるかを、この Slot 自身の Def と
        /// Stacks だけで判定する（accepts制約・capacity・UnitCapacity、7.2〜7.3節）。force=trueの
        /// 場合はこの判定自体を呼び出し側（WorldObject.AttachToSlot）がスキップする。
        /// </summary>
        internal bool CanAccept(WorldObject candidate, WellKnownProperties wellKnown, string ownerName, out string error)
        {
            if (!AcceptsRule(candidate))
            {
                error = $"'{ownerName}.{Def.Name}' は '{candidate.Def.Name}' を受け入れられません（accepts制約）。";
                return false;
            }

            if (Def.Capacity.HasValue)
            {
                int currentSize = SumSize(wellKnown.SizeId);
                int addedSize = candidate.GetNumber(wellKnown.SizeId);
                if (currentSize + addedSize > Def.Capacity.Value)
                {
                    error = $"'{ownerName}.{Def.Name}' の容量（{Def.Capacity}）を超えます。";
                    return false;
                }
            }

            if (Def.UnitCapacity.HasValue && !HasCapacityFor(candidate))
            {
                error = $"'{ownerName}.{Def.Name}' の上限（{Def.UnitCapacity}）を超えます。";
                return false;
            }

            error = null;
            return true;
        }

        private bool AcceptsRule(WorldObject candidate)
        {
            IReadOnlyList<SlotAcceptRule> rules = Def.Accepts;
            if (rules.Count == 0) return true; // accepts省略 = 無制限スロット（7.1節）

            foreach (var rule in rules)
            {
                if (!rule.Matches(candidate.Def)) continue;
                int countOfSameType = Contents.Count(o => rule.Matches(o.Def));
                if (countOfSameType < rule.Max) return true;
            }
            return false;
        }

        private int SumSize(int sizePropertyGlobalId) => Contents.Sum(o => o.GetNumber(sizePropertyGlobalId));

        /// <summary>UnitCapacity（種類数/個数の上限）に、candidateを新たに加える余地があるか。Stackableなら
        /// 既存のObjectStackへ合流できる場合は新しい枠を消費しない（この場合に限りDef.Stackableを見る。
        /// 非Stackableは同種でも常に個体ごとに新しいObjectStackを作るため、合流によるタダ乗りは無い）。</summary>
        private bool HasCapacityFor(WorldObject candidate)
        {
            if (!Def.UnitCapacity.HasValue) return true;
            if (Def.Stackable && FindMatchingStack(candidate) != null) return true;
            return stacks.Count < Def.UnitCapacity.Value;
        }

        /// <summary>通常の追加。Stackable/FixedPositions/StackOrderに従って正しいObjectStack・位置へ挿入する。</summary>
        internal void AddInternal(WorldObject obj)
        {
            if (!Def.Stackable) { stacks.Add(new ObjectStack(obj)); return; }

            ObjectStack existing = FindMatchingStack(obj);
            if (existing != null) { existing.Insert(obj); return; }

            InsertNewStack(new ObjectStack(obj));
        }

        private void InsertNewStack(ObjectStack newStack)
        {
            if (!Def.FixedPositions) { stacks.Add(newStack); return; }

            newStack.GridIndex = AssignGridIndex();
            int insertAt = stacks.FindIndex(s => s.GridIndex > newStack.GridIndex);
            stacks.Insert(insertAt == -1 ? stacks.Count : insertAt, newStack);
        }

        /// <summary>
        /// same_slotによる置き換え専用（非FixedPositions）。destroy前に捕捉しておいた「元居たObjectStackの
        /// 外側position(stackIndex)・その中でのメンバー位置(memberIndex)」へ、自動整列を一切行わず正確に
        /// 割り込ませる。元のObjectStackが（自分がその唯一のメンバーで）丸ごと消えた場合(stackWasVacated)は、
        /// 消えた位置(stackIndex)へ新規ObjectStackとしてそのまま入る。元のObjectStackが生き残る場合は、
        /// memberIndexが境界（先頭・末尾）ならその直前・直後へ、途中であれば元のObjectStackを前後2つに
        /// 分割してその間へ割り込ませる（元の平坦リストでの位置引き継ぎ、Codex.WorldObject.CaptureSameSlotAnchor
        /// 参照）。
        /// </summary>
        internal void InsertAtCapturedPosition(WorldObject obj, int stackIndex, int memberIndex, bool stackWasVacated)
        {
            if (stackWasVacated)
            {
                stacks.Insert(Math.Min(stackIndex, stacks.Count), new ObjectStack(obj));
                return;
            }

            ObjectStack existingStack = stacks[stackIndex];
            if (memberIndex <= 0) { stacks.Insert(stackIndex, new ObjectStack(obj)); return; }
            if (memberIndex >= existingStack.Members.Count) { stacks.Insert(stackIndex + 1, new ObjectStack(obj)); return; }

            ObjectStack after = existingStack.Split(memberIndex);
            stacks.Insert(stackIndex + 1, new ObjectStack(obj));
            stacks.Insert(stackIndex + 2, after);
        }

        internal void RemoveInternal(WorldObject obj)
        {
            ObjectStack stack = FindStackContaining(obj);
            if (stack == null) return;
            stack.Remove(obj);
            if (stack.Members.Count == 0) stacks.Remove(stack);
        }

        /// <summary>objが現在属しているObjectStack（無ければnull）。</summary>
        internal ObjectStack FindStackContaining(WorldObject obj) => stacks.FirstOrDefault(s => s.Members.Contains(obj));

        /// <summary>candidateが合流できる既存のObjectStack（ObjectDef・StackTypeが一致するもの、無ければnull）。</summary>
        internal ObjectStack FindMatchingStack(WorldObject candidate) => stacks.FirstOrDefault(s => s.Matches(candidate));

        /// <summary>このObjectStackが外側リスト(Stacks)の何番目にあるか。</summary>
        internal int IndexOfStack(ObjectStack stack) => stacks.IndexOf(stack);

        /// <summary>型globalIdに対応するObjectStackの固定番号（無ければnull）。stack_byを使わない
        /// ObjectDef向けの簡易API（型ごとに高々1つのObjectStackしか存在しない前提）。stack_byを使う
        /// ObjectDefについて調べたい場合は、FindStackContaining等で具体的なWorldObjectから辿ること。</summary>
        public int? GetGridIndex(int objectDefGlobalId) =>
            stacks.FirstOrDefault(s => s.Def.GlobalId == objectDefGlobalId)?.GridIndex;

        /// <summary>same_slot(FixedPositions)専用の予約。次にAddInternalで新規ObjectStackが作られる際、
        /// AssignGridIndexで新規採番する代わりにgridIndexをそのまま割り当てる（destroyされた自分自身が
        /// 同種の最後の1個で、自分の固定番号をそのまま新しい型へ引き継がせたい場合に使う）。</summary>
        internal void ReserveGridIndexForNextNewStack(int gridIndex) => pendingGridReservation = gridIndex;

        private int AssignGridIndex()
        {
            if (pendingGridReservation.HasValue)
            {
                int reserved = pendingGridReservation.Value;
                pendingGridReservation = null;
                return reserved;
            }

            var used = new HashSet<int>(stacks.Where(s => s.GridIndex.HasValue).Select(s => s.GridIndex.Value));
            for (int i = 0; i < Def.UnitCapacity.GetValueOrDefault(); i++)
                if (!used.Contains(i)) return i;

            throw new InvalidOperationException(
                $"'{Def.Name}' に空いている固定番号がありません（呼び出し側でHasCapacityForを確認していないはずです）。");
        }

        /// <summary>
        /// same_slot専用。selfIndexの右側（+1以降）で最初に見つかる空き番号へ、無ければ左側（-1以前）で
        /// 同様に、間にいる他のObjectStackを押し出しながら、次に生成されるObjectStackの固定番号として
        /// 予約する（実際の生成・挿入は直後のAddInternal→AssignGridIndexが行う。押し出しはObjectStack単位で
        /// 行うため、押し出されるObjectStackがスタック（同種複数個）であっても中身の相対順序は変わらない）。
        /// どちらの方向にも空きが見つからなければfalseを返す（呼び出し側でfallbackへ委ねる）。
        /// </summary>
        internal bool TryMakeRoomAndSeed(int selfIndex) =>
            TryMakeRoomAndSeed(selfIndex, step: 1) || TryMakeRoomAndSeed(selfIndex, step: -1);

        private bool TryMakeRoomAndSeed(int selfIndex, int step)
        {
            int targetIndex = selfIndex + step;
            int capacity = Def.UnitCapacity.GetValueOrDefault();
            if (targetIndex < 0 || targetIndex >= capacity) return false;

            var occupied = new HashSet<int>(stacks.Where(s => s.GridIndex.HasValue).Select(s => s.GridIndex.Value));
            int emptyAt = -1;
            for (int i = targetIndex; i >= 0 && i < capacity; i += step)
            {
                if (!occupied.Contains(i)) { emptyAt = i; break; }
            }
            if (emptyAt == -1) return false;

            int lo = Math.Min(targetIndex, emptyAt);
            int hi = Math.Max(targetIndex, emptyAt);
            foreach (var s in stacks)
                if (s.GridIndex.HasValue && s.GridIndex.Value >= lo && s.GridIndex.Value <= hi)
                    s.GridIndex += step;
            stacks.Sort((x, y) => Nullable.Compare(x.GridIndex, y.GridIndex));

            pendingGridReservation = targetIndex;
            return true;
        }

        /// <summary>
        /// プレイヤーによる手動並び替え。対象の型が既に存在する番号と入れ替える（無ければ何もしない）。
        /// 前詰めしない前提のため、単純な2者間のswapとして表現する。stack_byを使わないObjectDef向けの
        /// 簡易API（GetGridIndexと同じ理由）。
        /// </summary>
        public bool TrySetManualPosition(int objectDefGlobalId, int newGridIndex)
        {
            if (!Def.FixedPositions) return false;
            ObjectStack target = stacks.FirstOrDefault(s => s.Def.GlobalId == objectDefGlobalId);
            if (target == null || !target.GridIndex.HasValue) return false;
            if (newGridIndex < 0 || newGridIndex >= Def.UnitCapacity.GetValueOrDefault()) return false;

            ObjectStack occupant = stacks.FirstOrDefault(s => s.GridIndex == newGridIndex);
            int oldIndex = target.GridIndex.Value;
            target.GridIndex = newGridIndex;
            if (occupant != null && occupant != target) occupant.GridIndex = oldIndex;

            stacks.Sort((x, y) => Nullable.Compare(x.GridIndex, y.GridIndex));
            return true;
        }

        /// <summary>表示用: このスロットが持つObjectStackの一覧（既にまとまっているため、走査は不要）。</summary>
        public IReadOnlyList<ObjectStack> GetStacks() => stacks;
    }
}

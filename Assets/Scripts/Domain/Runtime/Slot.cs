using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// 1つの WorldObject が持つ、1つのスロットの実行時状態。中身を「セルの並び」として保持する。各セルは
    /// 1つの ObjectStack（7.6節、「見た目上1つのまとまり」）か、空（null）。位置＝セルの添字。正の情報源は
    /// こちら側（親のスロット配列）であり、子側の WorldObject.Parent は逆引き用のキャッシュ（7.1節）。
    ///
    /// FixedPositions と非FixedPositions の違いは1点だけ:「空になったセルを残すか、詰めるか」。
    /// - FixedPositions（番号が固定）: セル配列は常に UnitCapacity 長で、空セルは null として保持され位置が
    ///   安定する（オブジェクトが消えても番号は空くだけで前詰めされない）。
    /// - 非FixedPositions: 空になったセルは削除して前詰めする（null を含まない）。
    /// この差だけで、新規追加（最初の空きセル＝最小の空き番号／末尾へ）・削除（空き化／前詰め）・same_slot
    /// 置き換えのすべてが両対応できる（固定番号を別フィールドで二重管理する必要は無い＝ObjectStack.GridIndex撤廃）。
    ///
    /// 中身の追加・削除は WorldObject.MoveToSlot 系経由でのみ行う（両者の整合性を1箇所でのみ保証するため）。
    /// </summary>
    public sealed class Slot
    {
        public SlotDef Def { get; }

        /// <summary>セルの並び。要素は ObjectStack か null（空セル、FixedPositionsのみ）。位置＝添字。</summary>
        private readonly List<ObjectStack> cells = new List<ObjectStack>();

        private IEnumerable<ObjectStack> LiveStacks => cells.Where(c => c != null);

        /// <summary>実在するスタックだけ（空セルnullを除く）。位置は GetGridIndex / IndexOfStack で別途得る。</summary>
        public IReadOnlyList<ObjectStack> Stacks => LiveStacks.ToList();

        /// <summary>スタックの区別を畳み込んだ、このスロットの中身全部のビュー。スタックの概念に興味が無い
        /// 呼び出し側（タグ判定・重さ集計・子の一括走査など、ほとんどが内部処理）はこちらを使う。</summary>
        public IReadOnlyList<WorldObject> Contents => LiveStacks.SelectMany(s => s.Members).ToList();

        public Slot(SlotDef def)
        {
            Def = def;
            // FixedPositionsは固定長のセル配列（全て空=null）として持つ。番号は添字そのもの。
            if (def.FixedPositions)
                for (int i = 0; i < def.UnitCapacity.GetValueOrDefault(); i++)
                    cells.Add(null);
        }

        /// <summary>
        /// move_to_slot（7.1節）が候補オブジェクトを受け入れられるかを、この Slot 自身の Def と
        /// 中身だけで判定する（accepts制約・capacity・UnitCapacity、7.2〜7.3節）。force=trueの
        /// 場合はこの判定自体を呼び出し側（WorldObject.AttachToSlot）がスキップする。
        /// </summary>
        public bool CanAccept(WorldObject candidate, WellKnownProperties wellKnown, string ownerName, out string error)
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
            return LiveStacks.Count() < Def.UnitCapacity.Value;
        }

        /// <summary>通常の追加。合流できる既存スタックがあればそこへ、無ければ新規スタックとして
        /// 最初の空きセル（＝FixedPositionsでは最小の空き番号）へ、空きが無ければ末尾へ入れる。</summary>
        public void AddInternal(WorldObject obj)
        {
            if (Def.Stackable)
            {
                // TryInsertはMatchesを満たさない相手を弾くため、万一合致しないスタックが返っても無理に
                // 押し込まれず、新規スタック生成へフォールバックする。
                ObjectStack existing = FindMatchingStack(obj);
                if (existing != null && existing.TryInsert(obj)) return;
            }

            PlaceNewStack(new ObjectStack(obj));
        }

        /// <summary>新規スタックを最初の空きセルへ、無ければ末尾へ。FixedPositionsは空セル(null)を持つので
        /// 最小の空き番号へ入り、非FixedPositionsは空セルが無いので常に末尾へ追加される。</summary>
        private void PlaceNewStack(ObjectStack newStack)
        {
            int firstEmpty = cells.IndexOf(null);
            if (firstEmpty >= 0) cells[firstEmpty] = newStack;
            else cells.Add(newStack);
        }

        public void RemoveInternal(WorldObject obj)
        {
            int idx = cells.FindIndex(c => c != null && c.Members.Contains(obj));
            if (idx < 0) return;

            cells[idx].Remove(obj);
            if (cells[idx].Members.Count > 0) return;

            // セルが空になった。FixedPositionsは位置を保つため空セル(null)として残し、非FixedPositionsは
            // 前詰めするため削除する（これが両者の唯一の差）。
            if (Def.FixedPositions) cells[idx] = null;
            else cells.RemoveAt(idx);
        }

        /// <summary>
        /// same_slotによる置き換え（GameElementDefinition.md 9.4節）。置き換えオブジェクトを新規スタックとして、
        /// originが居たセル(originCellIndex)を基準に配置する（EffectSite.OriginCellIndex/OriginKindRemains参照）。
        /// 自動整列は行わない（同種はObjectStack内で整列されるため、スタック間の位置は著者が見た位置を保つ）。
        ///
        /// - kindRemains（originの同種がまだ残る＝selfが生き残る/同種の兄弟が残る）: 置き換え先はoriginの隣。
        ///   非FixedPositionsはその添字へ挿入（後続が右へずれる）。FixedPositionsはoriginの右隣（無ければ左隣）へ、
        ///   最寄りの空きセルをずらして場所を作って入れる。空きが無ければ配置失敗（false→呼び出し側でfallback）。
        /// - !kindRemains（originの同種が全て消えた）: 空いた元の位置へ。非FixedPositionsはその添字へ挿入、
        ///   FixedPositionsは空になったそのセル(null)を埋める。
        /// </summary>
        public bool PlaceSameSlot(WorldObject obj, int originCellIndex, bool kindRemains)
        {
            if (!Def.FixedPositions)
            {
                int at = kindRemains ? originCellIndex + 1 : originCellIndex;
                cells.Insert(Math.Min(Math.Max(at, 0), cells.Count), new ObjectStack(obj));
                return true;
            }

            return kindRemains
                ? TryPlaceAdjacent(obj, originCellIndex)
                : TryFillCell(obj, originCellIndex);
        }

        /// <summary>FixedPositions: 空いているセル(cellIndex)を新規スタックで埋める（埋まっていれば失敗）。</summary>
        private bool TryFillCell(WorldObject obj, int cellIndex)
        {
            if (cellIndex < 0 || cellIndex >= cells.Count || cells[cellIndex] != null) return false;
            cells[cellIndex] = new ObjectStack(obj);
            return true;
        }

        /// <summary>FixedPositions: originCellIndexの右隣（無ければ左隣）へ、最寄りの空きセルをその方向へずらして
        /// 場所を作り、新規スタックを入れる。「右が空いている限り右に、そうでなければ左に生まれる」。どちらの
        /// 方向にも空きが無ければfalse（＝スロットが埋まっている。呼び出し側でfallbackへ委ねる）。</summary>
        private bool TryPlaceAdjacent(WorldObject obj, int originCellIndex) =>
            TryPlaceShifted(obj, originCellIndex, step: 1) || TryPlaceShifted(obj, originCellIndex, step: -1);

        private bool TryPlaceShifted(WorldObject obj, int originCellIndex, int step)
        {
            int target = originCellIndex + step;
            if (target < 0 || target >= cells.Count) return false;

            int emptyAt = -1;
            for (int i = target; i >= 0 && i < cells.Count; i += step)
                if (cells[i] == null) { emptyAt = i; break; }
            if (emptyAt == -1) return false;

            // emptyからtargetへ、間のセルをstep方向へ1つずつずらす（targetを空ける）。押し出しはセル単位で
            // 行うため、押し出されるスタック（同種複数個）の中身の相対順序は変わらない。
            for (int i = emptyAt; i != target; i -= step)
                cells[i] = cells[i - step];
            cells[target] = new ObjectStack(obj);
            return true;
        }

        /// <summary>objが現在属しているObjectStack（無ければnull）。</summary>
        public ObjectStack FindStackContaining(WorldObject obj) =>
            cells.FirstOrDefault(c => c != null && c.Members.Contains(obj));

        /// <summary>candidateが合流できる既存のObjectStack（ObjectDef・代表ObjectDef列が一致するもの、無ければnull）。</summary>
        public ObjectStack FindMatchingStack(WorldObject candidate) =>
            cells.FirstOrDefault(c => c != null && c.Matches(candidate));

        /// <summary>このObjectStackがセルの並びの何番目にあるか（＝位置。FixedPositionsでは固定番号）。</summary>
        public int IndexOfStack(ObjectStack stack) => cells.IndexOf(stack);

        /// <summary>型globalIdに対応するObjectStackの位置（＝FixedPositionsの固定番号、無ければnull）。
        /// represented_byを使わないObjectDef向けの簡易API（型ごとに高々1つのObjectStackしか存在しない前提）。
        /// represented_byを使うObjectDefは、GetStacks + IndexOfStack で具体的なスタックから辿ること。</summary>
        public int? GetGridIndex(int objectDefGlobalId)
        {
            int i = cells.FindIndex(c => c != null && c.Def.GlobalId == objectDefGlobalId);
            return i >= 0 ? i : (int?)null;
        }

        /// <summary>
        /// プレイヤーによる手動並び替え（FixedPositions専用）。対象の型のセルを、指定した番号のセルと入れ替える
        /// （相手が空セルなら実質移動になり、元のセルが空く）。前詰めしない前提のため、単純な2者間のswap。
        /// represented_byを使わないObjectDef向けの簡易API（GetGridIndexと同じ理由）。
        /// </summary>
        public bool TrySetManualPosition(int objectDefGlobalId, int newGridIndex)
        {
            if (!Def.FixedPositions) return false;
            int cur = cells.FindIndex(c => c != null && c.Def.GlobalId == objectDefGlobalId);
            if (cur < 0) return false;
            if (newGridIndex < 0 || newGridIndex >= cells.Count) return false;

            ObjectStack tmp = cells[newGridIndex];
            cells[newGridIndex] = cells[cur];
            cells[cur] = tmp;
            return true;
        }

        /// <summary>表示用: このスロットが持つ実在スタックの一覧（空セルは含まない）。</summary>
        public IReadOnlyList<ObjectStack> GetStacks() => Stacks;
    }
}

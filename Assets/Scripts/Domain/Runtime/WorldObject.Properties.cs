using System;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>WorldObject の一部（プロパティの読み書き）。グローバルID→ローカル解決と「持っているか」の
    /// 判定を担い、値の変更・range判定・段階判定・実効値算出は対象の PropertyValue 自身へ委ねる。</summary>
    public sealed partial class WorldObject
    {
        public bool TryGetProperty(int globalPropertyId, out PropertyValue value)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing)
            {
                value = null;
                return false;
            }
            value = properties[local];
            return true;
        }

        /// <summary>登録済みのIncoming（modify/accumulate）はそのまま、値の中身だけを差し替える。</summary>
        public void SetProperty(int globalPropertyId, int value)
        {
            if (!TryGetProperty(globalPropertyId, out PropertyValue property))
                throw new InvalidOperationException($"'{Def.Name}' はプロパティ(id={globalPropertyId})を持ちません。");
            property.CopyValueFrom(value);
        }

        public int GetNumber(int globalPropertyId, int fallback = 0)
        {
            return TryGetProperty(globalPropertyId, out var v) ? v.Number : fallback;
        }

        /// <summary>
        /// 数値プロパティへの不可逆な加減算（9.2節の `add`）。対象プロパティを持たない場合は何もしない
        /// （例: 重さを気にしない置物）。sessionを渡さない呼び出しは、その場ではrange判定を行わない
        /// （後で明示的にTick()を呼んで判定させる呼び出し方）。
        /// </summary>
        public void AddNumber(int globalPropertyId, int delta, WorldSession session = null)
        {
            if (!TryGetProperty(globalPropertyId, out var value)) return;
            value.Add(delta, session);
        }

        /// <summary>数値プロパティへの不可逆な絶対値代入（9.2節の`set`）。対象プロパティを持たない場合は
        /// 何もしない（AddNumberと同じ規約）。</summary>
        public void SetNumber(int globalPropertyId, int value, WorldSession session = null)
        {
            if (!TryGetProperty(globalPropertyId, out var property)) return;
            property.SetNumber(value, session);
        }

        /// <summary>指定したプロパティが、今まさに指定した名前のstageに該当しているか
        /// （WhenOwnStageゲート専用、6.4節・8節）。</summary>
        public bool IsInStage(int propertyGlobalId, string stageName)
        {
            return TryGetProperty(propertyGlobalId, out var property) && property.IsInStage(stageName);
        }

        /// <summary>modifyのみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// プロパティを持たなければ0。</summary>
        public int GetEffectiveValue(int propertyGlobalId)
        {
            return TryGetProperty(propertyGlobalId, out var value) ? value.GetEffectiveValue() : 0;
        }
    }
}

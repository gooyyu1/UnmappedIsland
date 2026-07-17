using System;
using System.Collections.Generic;
using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Registry;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// 実行時のオブジェクト実体（ObjectDef のインスタンス）。WorldCodex 全体の呼称に合わせ、
    /// "Object"（言語組み込みの System.Object 等と衝突する）や汎用OOP用語の "Instance" を避けて命名している。
    ///
    /// プロパティの現在値・スロットの中身は、いずれも Def 側のローカルIDをそのままindexとする
    /// 密配列として保持する（グローバルIDでの辞書引きは行わない）。プロパティへ登録された効果
    /// （modify/accumulate）の一覧・tick毎の反映・実効値の算出は、対象がプロパティ自身であるため
    /// PropertyValue が持つ。WorldObjectはローカルID解決とグローバルAPIの提供に専念する。
    /// </summary>
    public sealed class WorldObject
    {
        public int InstanceId { get; }
        public ObjectDef Def { get; }

        // ローカルindexで並ぶ密配列。それぞれ Def.PropertyDefs / Def.SlotDefs と対になる。
        private readonly PropertyValue[] properties;
        private readonly Slot[] slots;

        /// <summary>所属先（7.1節）。子は必ず1つの親に属する。ルート（未格納）なら null。</summary>
        public WorldObject Parent { get; private set; }

        /// <summary>Parent の中で自分が入っているスロットのローカルID。Parent が null なら Missing。</summary>
        public int ParentSlotLocalId { get; private set; } = LocalIndexMap.Missing;

        public WorldObject(int instanceId, ObjectDef def)
        {
            InstanceId = instanceId;
            Def = def;

            properties = new PropertyValue[def.PropertyDefs.Count];
            for (int i = 0; i < properties.Length; i++)
                properties[i] = def.PropertyDefs[i].DefaultValue.Clone();

            slots = new Slot[def.SlotDefs.Count];
            for (int i = 0; i < slots.Length; i++)
                slots[i] = new Slot(def.SlotDefs[i]);

            foreach (var c in def.Contributions)
            {
                if (c.Target != ContributionTarget.Self) continue;
                int local = Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                RegisterContribution(local, new ActiveContribution(declarer: this, slotBearer: this, def: c));
            }
        }

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
        public void SetProperty(int globalPropertyId, PropertyValue value)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing)
                throw new InvalidOperationException($"'{Def.Name}' はプロパティ(id={globalPropertyId})を持ちません。");
            properties[local].CopyValueFrom(value);
        }

        public int GetNumber(int globalPropertyId, int fallback = 0)
        {
            return TryGetProperty(globalPropertyId, out var v) ? v.AsNumber(fallback) : fallback;
        }

        /// <summary>
        /// 数値プロパティへの不可逆な加減算（GameElementDefinition.md 9.2節の `add`、ContainerSystem.md の重さ伝播で使用）。
        /// このオブジェクトが対象プロパティを持たない場合は何もしない（例: 重さを気にしない置物）。
        /// </summary>
        public void AddNumber(int globalPropertyId, int delta)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing) return;
            properties[local].Add(delta);
        }

        public bool TryGetSlot(int globalSlotId, out Slot slot)
        {
            int local = Def.SlotLayout.ToLocal(globalSlotId);
            if (local == LocalIndexMap.Missing)
            {
                slot = null;
                return false;
            }
            slot = slots[local];
            return true;
        }

        internal Slot GetSlotByLocalId(int localId) => slots[localId];

        internal void SetParent(WorldObject parent, int parentSlotLocalId)
        {
            Parent = parent;
            ParentSlotLocalId = parentSlotLocalId;
        }

        /// <summary>Declarer自身のObjectDefに対してのみ有効なローカルID直読み（WhenOwnStageゲート専用、6.4節・8節）。</summary>
        internal int GetNumberByLocalId(int localId) => properties[localId].AsNumber();

        internal void RegisterContribution(int localPropertyId, ActiveContribution contribution)
        {
            properties[localPropertyId].RegisterContribution(contribution);
        }

        internal void UnregisterContributionsFrom(WorldObject declarer, int localPropertyId)
        {
            properties[localPropertyId].UnregisterContributionsFrom(declarer);
        }

        /// <summary>
        /// modify（Kind.Modify）のみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// target(self/parent/child)の違いはRegisterContribution呼び出し側（WorldObjectコンストラクタ・
        /// Containment）にのみ存在し、ここでは一切区別しない。Kind.Accumulateの寄与はTick参照。
        /// </summary>
        public int GetEffectiveValue(int propertyGlobalId)
        {
            int local = Def.PropertyLayout.ToLocal(propertyGlobalId);
            if (local == LocalIndexMap.Missing) return 0;
            return properties[local].GetEffectiveValue(Def.PropertyDefs[local].Range);
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算する（8.4節、不可逆）。ゲームループから
        /// 1tickにつき1回、生存している全WorldObjectに対して呼ばれる想定。
        ///
        /// on_zero（6.5節）はここでは検出しない。「プロパティが0以下である間、毎回実行されるactive内容」という
        /// 前提を置いたことで、履歴（前tickは正だったか）を持つ必要がなくなった。`Def.PropertyDefs[local].HasOnZero`
        /// と現在値（0以下か）を都度チェックするだけで済み、将来のアクション実行系がこの2つの既存情報だけを見て
        /// 判定できる（destroyは繰り返し実行されても安全であり、spawnは通常同じ本体内のdestroyとの組み合わせで
        /// 自己終端するため、履歴管理なしでも安全に運用できる）。
        /// </summary>
        public void Tick()
        {
            foreach (var p in properties) p.Tick();
        }

        /// <summary>
        /// 現在このプロパティに登録されている全寄与（modify/accumulate両方）を列挙する。
        /// 「このプロパティに何が影響しているか」をUIで表示したい場合に使う。ゲートが現在有効かどうかは
        /// 呼び出し側で ActiveContribution.IsActive() 相当の判定をしたい場合、Kind別にGetEffectiveValue/Tickの
        /// 結果と突き合わせる。
        /// </summary>
        public IReadOnlyList<ActiveContribution> GetIncomingContributions(int propertyGlobalId)
        {
            int local = Def.PropertyLayout.ToLocal(propertyGlobalId);
            if (local == LocalIndexMap.Missing) return Array.Empty<ActiveContribution>();
            return properties[local].Incoming;
        }
    }
}

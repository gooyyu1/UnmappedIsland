using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// props の実行時の値。数値（32bit整数、6節）のみを扱う。PassiveEffectの影響先は「プロパティ」で
    /// あるため、登録済み効果の一覧・tick毎の反映・実効値の算出はWorldObjectではなくこの値自身が持つ。
    /// 値の変更後のrangeイベント判定（どのon_*をいつ発火するか）は自分のPropertyDef（CheckRangeEvents）へ
    /// 委譲し、呼び出し側は変更後に何を判定すべきかを知らなくてよい。
    /// </summary>
    public sealed class PropertyValue
    {
        public int Number { get; private set; }

        private readonly PropertyDef def;
        private readonly WorldObject owner;

        /// <summary>modify効果（実効値へ寄与、GetEffectiveValueが走査）とaccumulate効果（tick毎に実体値へ
        /// 加減算、Tickが走査）は消費されるタイミングが異なるため別リストで持つ。</summary>
        private readonly List<RegisteredPassiveEffect> modifyEffects = new List<RegisteredPassiveEffect>();
        private readonly List<RegisteredPassiveEffect> accumulateEffects = new List<RegisteredPassiveEffect>();

        /// <summary>GetEffectiveValueの再入検出用。modifyのconditions（14節）が実効値を読むため、自分自身の
        /// 実効値へ（直接・間接に）依存する循環参照が起こりうる。放置するとcatch不能なStackOverflowException
        /// になるため、再入検出時点で分かりやすい例外を投げる。</summary>
        private bool isComputingEffectiveValue;

        /// <summary>生成はPropertyDef.CreateValueが担う（初期値numberは定義側が決める）。</summary>
        public PropertyValue(int number, PropertyDef def, WorldObject owner)
        {
            Number = number;
            this.def = def;
            this.owner = owner;
        }

        /// <summary>SetProperty用。登録済みのIncomingはそのまま、値の中身だけを差し替える。</summary>
        public void CopyValueFrom(int number)
        {
            Number = number;
        }

        /// <summary>
        /// 数値を加減算し（不可逆）、値が変わった直後にon_overflow・on_shortfall・on_min・on_max
        /// （6.3節・6.5節・6.6節）の判定を行う。
        ///
        /// sessionがnullの場合は判定を行わない（呼び出し側が後で明示的にTick()を呼んで判定させる場合。
        /// WorldObject.AddNumber参照）。
        ///
        /// deltaが0の場合は何もしない。on_overflow等の既定の補正（rangeの境界へのset）が境界に着地した後の
        /// 再setで、Add→CheckRangeEvents→ApplyActiveEffect→SetNumber→Addが無限に連鎖するのを防ぐガード。
        /// </summary>
        public void Add(int delta, WorldSession session)
        {
            if (delta == 0) return;

            Number += delta;
            if (session != null)
                def.CheckRangeEvents(Number, owner, session);
        }

        /// <summary>絶対値代入（set）。差分をAddへ委譲するため、range判定はAdd側に一本化される。</summary>
        public void SetNumber(int value, WorldSession session)
        {
            Add(value - Number, session);
        }

        /// <summary>効果を登録する。modify用/accumulate用のどちらのリストへ入るかは効果自身が決めて
        /// RegisterModify/RegisterAccumulateを呼び分ける。</summary>
        public void RegisterPassiveEffect(RegisteredPassiveEffect effect) => effect.RegisterInto(this);

        /// <summary>modify効果としての登録先（PassiveEffect.RegisterInto経由でのみ呼ばれる想定）。</summary>
        public void RegisterModify(RegisteredPassiveEffect effect) => modifyEffects.Add(effect);

        /// <summary>accumulate効果としての登録先（PassiveEffect.RegisterInto経由でのみ呼ばれる想定）。</summary>
        public void RegisterAccumulate(RegisteredPassiveEffect effect) => accumulateEffects.Add(effect);

        public void UnregisterPassiveEffectsFrom(WorldObject declarer)
        {
            modifyEffects.RemoveAll(c => c.Declarer == declarer);
            accumulateEffects.RemoveAll(c => c.Declarer == declarer);
        }

        /// <summary>現在登録されている全寄与（modify/accumulate両方）。UI表示用。</summary>
        public IReadOnlyList<RegisteredPassiveEffect> Incoming => modifyEffects.Concat(accumulateEffects).ToList();

        /// <summary>
        /// modifyとinherit（祖先からの継承）を加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは
        /// 書き換えない。conditions（14節）がこの実効値を読むため再入（循環参照）が起こりうる。
        /// isComputingEffectiveValueで検出し、スタックオーバーフローになる前に例外を投げる。
        /// </summary>
        public int GetEffectiveValue()
        {
            if (isComputingEffectiveValue)
                throw new InvalidOperationException(
                    $"プロパティ'{def?.Name}'の実効値計算中に循環参照を検出しました" +
                    "（modifyのconditionsが、直接・間接を問わず自分自身の実効値に依存しています）。");

            isComputingEffectiveValue = true;
            try
            {
                int sum = Number;

                foreach (var c in modifyEffects)
                    sum += c.ActiveAmount();

                sum += def.InheritedContribution(owner);

                return def.Range.HasValue ? def.Range.Value.Clamp(sum) : sum;
            }
            finally
            {
                isComputingEffectiveValue = false;
            }
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算し（8.4節、不可逆）、rangeイベント
        /// （6.3節・6.5節・6.6節）を判定する。1tickにつき1回、WorldObject.Tick経由で呼ばれる想定。
        /// </summary>
        public void Tick(WorldSession session)
        {
            foreach (var c in accumulateEffects)
                Number += c.ActiveAmount();

            def.CheckRangeEvents(Number, owner, session);
        }

        /// <summary>
        /// 今まさに指定した名前のstage（6.4節）に該当しているか（WhenOwnStageゲート専用、8節）。
        /// 生の値ではなく実効値で判定する（modifyだけで決まる派生プロパティ自身のstagesも判定できる
        /// ようにするため）。
        /// </summary>
        public bool IsInStage(string stageName)
        {
            return def.IsInStage(GetEffectiveValue(), stageName);
        }

        /// <summary>transfer（9.5節）でこのプロパティから出せる量の上限。rangeがあればrange.Minを下限と
        /// みなし、無ければ現在値そのまま。</summary>
        public int AvailableToTransferOut() => def.Range.HasValue ? Math.Max(0, Number - def.Range.Value.Min) : Number;

        /// <summary>transfer（9.5節）でallow_overflow: falseの場合に受け取れる量の上限。rangeが無ければ上限なし。</summary>
        public int RemainingTransferCapacity() => def.Range.HasValue ? Math.Max(0, def.Range.Value.Max - Number) : int.MaxValue;

        public override string ToString() => Number.ToString();
    }
}

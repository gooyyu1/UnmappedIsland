using System.Collections.Generic;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// on_overflow（GameElementDefinition.md 6.3節: rangeの上限を超えたプロパティについて、on_minと全く
    /// 同じActiveEffect・ApplyActiveEffectの経路で、著者が指定したadd/setを一度だけ適用する）に対する
    /// 自動テスト。ループ・多重走査は行わないため、1tickでの解決範囲はaccumulateの通常の反映と同じ
    /// （宣言順に1回ずつ）。YAMLパーサ経由のテストはYamlLoaderTests.csを参照。
    /// </summary>
    [TestFixture]
    public class OverflowTests
    {
        private static PropertyBlueprint WrappingProp(
            string name, int defaultValue, int min, int max, params (string Property, int Amount)[] onOverflow)
        {
            var bp = new PropertyBlueprint
            {
                Name = name,
                DefaultValue = PropertyValue.FromNumber(defaultValue),
                Range = new PropertyRange(min, max),
                OnOverflow = new ActiveEffectBlueprint(),
            };
            var adds = new List<AddBlueprint>();
            foreach (var (property, amount) in onOverflow)
                adds.Add(new AddBlueprint { PropertyName = property, Amount = amount });
            bp.OnOverflow.Adds[ReferenceRoot.Self] = adds;
            return bp;
        }

        private static PropertyBlueprint PlainProp(string name, int defaultValue) =>
            new PropertyBlueprint { Name = name, DefaultValue = PropertyValue.FromNumber(defaultValue) };

        /// <summary>on_overflowをset(自分を絶対値へ戻す)+add(繰り上げ先への加算)で表現する版。
        /// core.yamlが実際に使っている文法（accumulateの"-60"のような差分ではなく、setで0へ戻す）を検証する。</summary>
        private static PropertyBlueprint SetAndAddWrappingProp(
            string name, int defaultValue, int min, int max, int resetTo, string carryProperty, int carryAmount)
        {
            var bp = new PropertyBlueprint
            {
                Name = name,
                DefaultValue = PropertyValue.FromNumber(defaultValue),
                Range = new PropertyRange(min, max),
                OnOverflow = new ActiveEffectBlueprint(),
            };
            bp.OnOverflow.Sets[ReferenceRoot.Self] = new List<AssignBlueprint> { new AssignBlueprint { PropertyName = name, Value = resetTo } };
            bp.OnOverflow.Adds[ReferenceRoot.Self] = new List<AddBlueprint> { new AddBlueprint { PropertyName = carryProperty, Amount = carryAmount } };
            return bp;
        }

        private static ContributionBlueprint SelfAccumulate(string propertyName, int amount)
        {
            return new ContributionBlueprint
            {
                Target = ContributionTarget.Self,
                Kind = ContributionKind.Accumulate,
                TargetPropertyName = propertyName,
                Amount = amount,
                GateKind = ContributionGateKind.Always,
            };
        }

        [Test]
        public void Tick_WrapsPropertyAndCarriesToTarget_WhenExceedingRangeMax()
        {
            var clock = new ObjectDefBlueprint { Name = "clock" };
            clock.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Properties.Add(PlainProp("hour", 0));
            clock.Contributions.Add(SelfAccumulate("minute", 15));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock")));

            instance.Tick(session); // 45 + 15 = 60 > 59 なので折り返す

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void Tick_SetResetsSelfAndAddCarriesToTarget_WhenExceedingRangeMax()
        {
            // set: {self: {minute: 0}} + add: {self: {hour: 1}} という、core.yamlが実際に使っている文法
            // （accumulateの"-60"のような差分指定ではなく、setで絶対値へ戻す）を検証する。
            var clock = new ObjectDefBlueprint { Name = "clock_set" };
            clock.Properties.Add(SetAndAddWrappingProp("minute", 45, min: 0, max: 59, resetTo: 0, carryProperty: "hour", carryAmount: 1));
            clock.Properties.Add(PlainProp("hour", 0));
            clock.Contributions.Add(SelfAccumulate("minute", 15));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_set")));

            instance.Tick(session); // 45 + 15 = 60 > 59 なので折り返す

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0), "setにより絶対値0へ戻る（差分ではなく代入）");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void Tick_DoesNotOverflow_WhenValueStaysWithinRange()
        {
            var clock = new ObjectDefBlueprint { Name = "clock2" };
            clock.Properties.Add(WrappingProp("minute", 10, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Properties.Add(PlainProp("hour", 0));
            clock.Contributions.Add(SelfAccumulate("minute", 15));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock2")));

            instance.Tick(session); // 10 + 15 = 25、59以下なので折り返さない

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(25));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0));
        }

        [Test]
        public void Tick_AppliesOnOverflowOnlyOnce_SoSeveralSpansTakeSeveralTicksToFullyResolve()
        {
            // on_overflowはループしない。1tickでrangeの幅を複数回分飛び越えた場合、1回の適用では
            // 完全には解決されず、次のtick以降に持ち越されることを確認する。
            var clock = new ObjectDefBlueprint { Name = "clock3" };
            clock.Properties.Add(WrappingProp("minute", 35, min: 0, max: 9, ("minute", -10), ("hour", 1))); // 範囲10分刻み、既に35(3span+5超過)
            clock.Properties.Add(PlainProp("hour", 0));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock3")));

            instance.Tick(session);
            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(25), "1回のtickでは-10適用1回分だけ解決される");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));

            instance.Tick(session);
            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(15));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(2));

            instance.Tick(session);
            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5), "3回目のtickでようやく範囲内に収まる");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(3));

            instance.Tick(session);
            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5), "範囲内に収まった後は何もしない");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(3));
        }

        [Test]
        public void Tick_CascadesToLaterDeclaredPropertyWithinTheSameTick()
        {
            // minuteがhourより先に宣言されていれば、minute.Tickが先に走り繰り上げを適用した直後に
            // hour.Tickが走るため、hour自身の溢れも同じtick内で連鎖して解決する
            // （ループは無いが、宣言順どおりに1回ずつ処理が進むだけで足りる）。
            var clock = new ObjectDefBlueprint { Name = "clock4" };
            clock.Properties.Add(WrappingProp("minute", 50, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Properties.Add(WrappingProp("hour", 23, min: 0, max: 23, ("hour", -24), ("day", 1)));
            clock.Properties.Add(PlainProp("day", 1));
            clock.Contributions.Add(SelfAccumulate("minute", 15)); // 50+15=65 -> minute=5, hour+1(23->24, さらに折り返す)

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock4")));

            instance.Tick(session);

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0), "23+1=24は範囲(0-23)を超えるため、同じtick内でhour自身も折り返す");
            Assert.That(instance.GetNumber(dayId), Is.EqualTo(2), "hourの繰り上げでdayも+1される");
        }

        [Test]
        public void Tick_DoesNotCascadeToEarlierDeclaredProperty_UntilNextTick()
        {
            // hourがminuteより先に宣言されている場合、hour.Tickは(この回では)minuteの繰り上げより前に
            // 走ってしまうため、同じtick内では連鎖せず、次のtickで初めて解決されることを確認する
            // （ループを廃止したことで生じる、宣言順への依存を明示するテスト）。
            var clock = new ObjectDefBlueprint { Name = "clock5" };
            clock.Properties.Add(WrappingProp("hour", 23, min: 0, max: 23, ("hour", -24), ("day", 1)));
            clock.Properties.Add(PlainProp("day", 1));
            clock.Properties.Add(WrappingProp("minute", 50, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Contributions.Add(SelfAccumulate("minute", 15)); // 50+15=65 -> minute=5, hour+1(23->24)

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock5")));

            instance.Tick(session);

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(24), "hourのTickがminuteより先に走るため、この時点ではまだ折り返らない");
            Assert.That(instance.GetNumber(dayId), Is.EqualTo(1), "hourの溢れが未解決のため、dayもまだ変わらない");

            instance.Tick(session); // 2回目のTickでhour自身の溢れが解決される

            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0));
            Assert.That(instance.GetNumber(dayId), Is.EqualTo(2));
        }

        [Test]
        public void Tick_SilentlyIgnoresOverflowDeltaForPropertyNotOwnedByThisObjectDef()
        {
            // on_minのadd（WorldObject.AddNumber）と同じ規約: このobject_defが持たないプロパティへの
            // 加算は、たとえ同名のプロパティを別のobject_defが持っていて名前自体は登録されていても、
            // 黙って無視される（エラーにしない）。
            var a = new ObjectDefBlueprint { Name = "a_clock2" };
            a.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, ("minute", -60), ("hour", 1))); // このobject_defはhourを持たない
            a.Contributions.Add(SelfAccumulate("minute", 15));

            var b = new ObjectDefBlueprint { Name = "b_something2" };
            b.Properties.Add(PlainProp("hour", 0)); // 別のobject_defが同名プロパティを持つ(名前だけは登録される)

            var codex = WorldCodexBuilder.Build(new[] { a, b });
            int minuteId = codex.PropertyNames.GetId("minute");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("a_clock2")));

            instance.Tick(session); // 例外を投げればテスト自体が失敗する

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0));
        }
    }
}

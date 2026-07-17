using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// on_overflow（GameElementDefinition.md 6.3節: rangeの上限を超えたプロパティについて、on_zeroと同じ
    /// 「target-key(self)→body」という文法でaccumulateを一度だけ適用する）に対する自動テスト。
    /// YAMLパーサ経由のテストはYamlLoaderTests.csを参照。
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
            };
            foreach (var (property, amount) in onOverflow)
                bp.OnOverflow.Add(new AddBlueprint { PropertyName = property, Amount = amount });
            return bp;
        }

        private static PropertyBlueprint PlainProp(string name, int defaultValue) =>
            new PropertyBlueprint { Name = name, DefaultValue = PropertyValue.FromNumber(defaultValue) };

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

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock")));

            instance.Tick(); // 45 + 15 = 60 > 59 なので折り返す

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0));
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

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock2")));

            instance.Tick(); // 10 + 15 = 25、59以下なので折り返さない

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(25));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0));
        }

        [Test]
        public void Tick_ReappliesOnOverflowDelta_WhenAccumulationExceedsRangeBySeveralSpans()
        {
            // on_overflowは著者が指定した固定量（この例では-10/+1）を、溢れが無くなるまで繰り返し適用する
            // （範囲の自動計算はしない。1回のtickで複数span分飛び越えても正しく解決できることを確認する）。
            var clock = new ObjectDefBlueprint { Name = "clock3" };
            clock.Properties.Add(WrappingProp("minute", 0, min: 0, max: 9, ("minute", -10), ("hour", 1))); // 範囲10分刻み
            clock.Properties.Add(PlainProp("hour", 0));
            clock.Contributions.Add(SelfAccumulate("minute", 35)); // 10ずつ3回分繰り上がり、残り5

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock3")));

            instance.Tick();

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(3));
        }

        [Test]
        public void Tick_CascadesOverflowAcrossMultipleProperties_RegardlessOfDeclarationOrder()
        {
            // hour->dayへの繰り上げだが、あえてhourをminuteより先に宣言する（properties配列の走査順を
            // 繰り上げの向きと逆にする）。1回の走査だけで連鎖を解決しようとすると、minuteの繰り上げで
            // hourが溢れても見逃してしまうはずなので、複数回の再走査で正しく解決できることを確認する。
            var clock = new ObjectDefBlueprint { Name = "clock4" };
            clock.Properties.Add(WrappingProp("hour", 23, min: 0, max: 23, ("hour", -24), ("day", 1)));
            clock.Properties.Add(PlainProp("day", 1));
            clock.Properties.Add(WrappingProp("minute", 50, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Contributions.Add(SelfAccumulate("minute", 15)); // 50+15=65 -> minute=5, hour+1(23->24)

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock4")));

            instance.Tick();

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0), "23+1=24は範囲(0-23)を超えるため、hour自身も折り返す");
            Assert.That(instance.GetNumber(dayId), Is.EqualTo(2), "hourの繰り上げでdayも+1される");
        }

        [Test]
        public void Tick_SilentlyIgnoresOverflowDeltaForPropertyNotOwnedByThisObjectDef()
        {
            // on_zeroのadd（WorldObject.AddNumber）と同じ規約: このobject_defが持たないプロパティへの
            // 加算は、たとえ同名のプロパティを別のobject_defが持っていて名前自体は登録されていても、
            // 黙って無視される（エラーにしない）。
            var a = new ObjectDefBlueprint { Name = "a_clock2" };
            a.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, ("minute", -60), ("hour", 1))); // このobject_defはhourを持たない
            a.Contributions.Add(SelfAccumulate("minute", 15));

            var b = new ObjectDefBlueprint { Name = "b_something2" };
            b.Properties.Add(PlainProp("hour", 0)); // 別のobject_defが同名プロパティを持つ(名前だけは登録される)

            var codex = WorldCodexBuilder.Build(new[] { a, b });
            int minuteId = codex.PropertyNames.GetId("minute");

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("a_clock2")));

            instance.Tick(); // 例外を投げればテスト自体が失敗する

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0));
        }
    }
}

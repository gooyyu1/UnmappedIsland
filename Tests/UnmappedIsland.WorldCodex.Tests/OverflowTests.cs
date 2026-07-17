using System;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// on_overflow（GameElementDefinition.md 6.3節: rangeの上限を超えたプロパティを折り返し、carry_toへ
    /// 繰り上げる）に対する自動テスト。YAMLパーサ経由のテストはYamlLoaderTests.csを参照。
    /// </summary>
    [TestFixture]
    public class OverflowTests
    {
        private static PropertyBlueprint WrappingProp(string name, int defaultValue, int min, int max, string carryTo)
        {
            return new PropertyBlueprint
            {
                Name = name,
                DefaultValue = PropertyValue.FromNumber(defaultValue),
                Range = new PropertyRange(min, max),
                OverflowMode = OverflowMode.Wrap,
                OverflowCarryToName = carryTo,
            };
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
            clock.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, carryTo: "hour"));
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
            clock.Properties.Add(WrappingProp("minute", 10, min: 0, max: 59, carryTo: "hour"));
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
        public void Tick_CarriesMultipleStepsAtOnce_WhenAccumulationExceedsRangeBySeveralSpans()
        {
            // 1回のtickでrangeの範囲を複数回分飛び越える場合でも、carry量が正しく計算されることを確認する。
            var clock = new ObjectDefBlueprint { Name = "clock3" };
            clock.Properties.Add(WrappingProp("minute", 0, min: 0, max: 9, carryTo: "hour")); // 範囲10分刻み
            clock.Properties.Add(PlainProp("hour", 0));
            clock.Contributions.Add(SelfAccumulate("minute", 35)); // 10で3回分繰り上がり、残り5

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
            // hour->day のcarry_toだが、あえてhourをminuteより先に宣言する（properties配列の走査順を
            // carryの向きと逆にする）。1回の走査だけで連鎖を解決しようとすると、minuteの繰り上げで
            // hourが溢れても見逃してしまうはずなので、複数回の再走査で正しく解決できることを確認する。
            var clock = new ObjectDefBlueprint { Name = "clock4" };
            clock.Properties.Add(WrappingProp("hour", 23, min: 0, max: 23, carryTo: "day"));
            clock.Properties.Add(PlainProp("day", 1));
            clock.Properties.Add(WrappingProp("minute", 50, min: 0, max: 59, carryTo: "hour"));
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
        public void Build_Throws_WhenOverflowCarryToIsNotOwnedByThisObjectDef()
        {
            var a = new ObjectDefBlueprint { Name = "a_clock" };
            a.Properties.Add(WrappingProp("minute", 0, min: 0, max: 59, carryTo: "hour")); // "hour"はどのobject_defにも無い

            var b = new ObjectDefBlueprint { Name = "b_something" };
            b.Properties.Add(PlainProp("hour", 0)); // 別のobject_defが持つ同名プロパティは対象にならない

            Assert.That((Func<WorldCodex>)(() => WorldCodexBuilder.Build(new[] { a, b })),
                Throws.TypeOf<InvalidOperationException>());
        }
    }
}

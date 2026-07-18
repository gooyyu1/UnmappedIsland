using System.Collections.Generic;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// on_overflow（GameElementDefinition.md 6.3節: rangeの上限を超えたプロパティについて、on_minと全く
    /// 同じActiveEffect・ApplyActiveEffectの経路で、著者が指定したadd/setを適用する）に対する自動テスト。
    /// WorldObject.AddNumber/SetNumberは値が変わった直後にsession経由でCheckRangeEventsを再評価するため、
    /// on_overflowの補正自体が別のプロパティ（またはrangeが残っている自分自身）を書き換えた場合、
    /// 同じTick()呼び出しの中で連鎖的に解決される（宣言順やTickの回数に依存しない）。
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
            };
        }

        [Test]
        public void AddNumber_WithSession_CorrectsOverflowImmediately_WithoutWaitingForTick()
        {
            // Tick()を待たず、AddNumberにsessionを渡した瞬間にon_overflowが判定・適用されることを確認する。
            // これにより、値がrangeの外側（この例では60）にある状態が外部から観測される瞬間は生じない。
            var clock = new ObjectDefBlueprint { Name = "clock_immediate" };
            clock.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Properties.Add(PlainProp("hour", 0));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_immediate")));

            instance.AddNumber(minuteId, 15, session); // 45+15=60 > 59。Tick()は一度も呼んでいない

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0), "Tick()を呼んでいなくても、その場で折り返る");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void AddNumber_WithoutSession_DoesNotCheckOverflow_UntilExplicitTick()
        {
            // sessionを渡さない呼び出し（既存の呼び出し方との後方互換）は、値がrangeの外側のままでも
            // 即座には補正されず、明示的にTick()を呼ぶまで持ち越されることを確認する。
            var clock = new ObjectDefBlueprint { Name = "clock_deferred" };
            clock.Properties.Add(WrappingProp("minute", 45, min: 0, max: 59, ("minute", -60), ("hour", 1)));
            clock.Properties.Add(PlainProp("hour", 0));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_deferred")));

            instance.AddNumber(minuteId, 15); // sessionを渡さない

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(60), "sessionを渡さない間はrange外のまま");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0));

            instance.Tick(session);

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0), "明示的にTick()を呼ぶと折り返る");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void AddNumber_DefaultOnOverflowSettingSelfToSameValue_DoesNotRecurseInfinitely()
        {
            // on_overflowを省略した場合の既定合成（「自分自身をrange.maxへset」）は、値がちょうど境界に
            // 着地した後は同じ値への再setになる（差分0）。AddNumberが差分0を何もしないことで、
            // CheckRangeEvents→ApplyActiveEffect→SetNumber→AddNumberという無限再帰を防いでいることを確認する。
            var tank = new ObjectDefBlueprint { Name = "tank_immediate" };
            tank.Properties.Add(new PropertyBlueprint
            {
                Name = "pressure",
                DefaultValue = PropertyValue.FromNumber(5),
                Range = new PropertyRange(0, 10),
                // OnOverflowを指定しない: ObjectDefBuilderが「自分自身をrange.maxへset」を既定合成する
            });

            var codex = WorldCodexBuilder.Build(new[] { tank });
            int pressureId = codex.PropertyNames.GetId("pressure");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank_immediate")));

            instance.AddNumber(pressureId, 5, session); // 5+5=10 >= max(10)。例外・スタックオーバーフローを起こさなければ成功

            Assert.That(instance.GetNumber(pressureId), Is.EqualTo(10));
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
        public void Tick_OnOverflowCascadesImmediately_SoSeveralSpansResolveInASingleTick()
        {
            // on_overflowの補正自体(add: {self: {minute: -10}}})がAddNumberを通るため、その場でもう一度
            // CheckRangeEventsが評価される。1tickでrangeの幅を複数回分飛び越えていても、この連鎖により
            // 1回のTick()呼び出しの中だけで完全に解決される。
            var clock = new ObjectDefBlueprint { Name = "clock3" };
            clock.Properties.Add(WrappingProp("minute", 35, min: 0, max: 9, ("minute", -10), ("hour", 1))); // 範囲10分刻み、既に35(3span+5超過)
            clock.Properties.Add(PlainProp("hour", 0));

            var codex = WorldCodexBuilder.Build(new[] { clock });
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock3")));

            instance.Tick(session);
            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(5), "3span分の補正が1回のTick()の中で連鎖的に解決される");
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
        public void Tick_CascadesToEarlierDeclaredProperty_RegardlessOfDeclarationOrder()
        {
            // hourがminuteより先に宣言されていても、minuteのon_overflowが行うadd: {self: {hour: 1}}}が
            // AddNumberを通るため、その場でhour自身のCheckRangeEventsも即座に評価される。宣言順に関わらず
            // 同じTick()呼び出しの中で連鎖的に解決される。
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
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(0), "hourがminuteより先に宣言されていても、即座に連鎖して折り返る");
            Assert.That(instance.GetNumber(dayId), Is.EqualTo(2), "hourの繰り上げでdayも同じTick()内で+1される");
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

        // ------------------------------------------------------------------
        // on_max/on_minとon_overflow/on_shortfallの評価順: 循環する(自身をラップして戻す)
        // カスタムon_overflow/on_shortfallを持つプロパティが、1tickでrangeをいきなり飛び越えた場合でも、
        // on_max/on_minのレベルトリガーが「その瞬間、境界に達していたこと」を見逃さないことを確認する。
        // ------------------------------------------------------------------

        [Test]
        public void Tick_OnMaxStillFiresWhenACustomOnOverflowWrapsPastMaxInTheSameTick()
        {
            // gaugeは0-100を循環するプロパティ(on_overflowが自分自身を-100して折り返す、時計のminuteと同じ
            // パターン)。1tickでの加算(+150)がrangeの幅(100)を超えるため、on_overflow適用後のgaugeは
            // 50(range内)に収まってしまい、on_maxの判定(>=100)をon_overflowの後に行うと見逃してしまう。
            var tank = new ObjectDefBlueprint { Name = "tank2" };
            var gauge = WrappingProp("gauge", 0, min: 0, max: 100, ("gauge", -100));
            gauge.OnMax = new ActiveEffectBlueprint();
            gauge.OnMax.Adds[ReferenceRoot.Self] = new List<AddBlueprint> { new AddBlueprint { PropertyName = "alarm_count", Amount = 1 } };
            tank.Properties.Add(gauge);
            tank.Properties.Add(PlainProp("alarm_count", 0));
            tank.Contributions.Add(SelfAccumulate("gauge", 150));

            var codex = WorldCodexBuilder.Build(new[] { tank });
            int gaugeId = codex.PropertyNames.GetId("gauge");
            int alarmId = codex.PropertyNames.GetId("alarm_count");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank2")));

            instance.Tick(session); // 0 + 150 = 150 > 100 なので折り返す

            Assert.That(instance.GetNumber(gaugeId), Is.EqualTo(50), "on_overflowにより50へ折り返される");
            Assert.That(instance.GetNumber(alarmId), Is.EqualTo(1),
                "on_overflowで折り返される前に、gaugeが確かにmax(100)以上に達していたことをon_maxが検知できているはず");
        }

        [Test]
        public void Tick_OnMinStillFiresWhenACustomOnShortfallWrapsPastMinInTheSameTick()
        {
            // on_maxのテストの下限側の鏡像。gaugeが1tickでrangeの下限をいきなり下回った場合でも、
            // on_shortfallによる折り返しの前に、on_minのレベルトリガーがその瞬間を検知できることを確認する。
            var tank = new ObjectDefBlueprint { Name = "tank3" };
            var gauge = new PropertyBlueprint
            {
                Name = "gauge",
                DefaultValue = PropertyValue.FromNumber(50),
                Range = new PropertyRange(0, 100),
                OnShortfall = new ActiveEffectBlueprint(),
                OnMin = new ActiveEffectBlueprint(),
            };
            gauge.OnShortfall.Adds[ReferenceRoot.Self] = new List<AddBlueprint> { new AddBlueprint { PropertyName = "gauge", Amount = 150 } };
            gauge.OnMin.Adds[ReferenceRoot.Self] = new List<AddBlueprint> { new AddBlueprint { PropertyName = "alarm_count", Amount = 1 } };
            tank.Properties.Add(gauge);
            tank.Properties.Add(PlainProp("alarm_count", 0));
            tank.Contributions.Add(SelfAccumulate("gauge", -150));

            var codex = WorldCodexBuilder.Build(new[] { tank });
            int gaugeId = codex.PropertyNames.GetId("gauge");
            int alarmId = codex.PropertyNames.GetId("alarm_count");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank3")));

            instance.Tick(session); // 50 - 150 = -100 < 0 なので折り返す。折り返し量(+150)はmin(0)ちょうどには
            // 着地させない(50に着地させる)ことで、「折り返し後の値がたまたま境界と一致する」ケースと区別する。

            Assert.That(instance.GetNumber(gaugeId), Is.EqualTo(50), "on_shortfallにより50へ折り返される(0ちょうどには着地しない)");
            Assert.That(instance.GetNumber(alarmId), Is.EqualTo(1),
                "on_shortfallで折り返される前に、gaugeが確かにmin(0)以下に達していたことをon_minが検知できているはず");
        }
    }
}

using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
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
        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

        [Test]
        public void AddNumber_WithSession_CorrectsOverflowImmediately_WithoutWaitingForTick()
        {
            // Tick()を待たず、AddNumberにsessionを渡した瞬間にon_overflowが判定・適用されることを確認する。
            // これにより、値がrangeの外側（この例では60）にある状態が外部から観測される瞬間は生じない。
            const string yaml = @"
object_defs:
  clock_immediate:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_immediate")), session);

            instance.AddNumber(minuteId, 15, session); // 45+15=60 > 59。Tick()は一度も呼んでいない

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0), "Tick()を呼んでいなくても、その場で折り返る");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void AddNumber_WithoutSession_DoesNotCheckOverflow_UntilExplicitTick()
        {
            // sessionを渡さない呼び出し（既存の呼び出し方との後方互換）は、値がrangeの外側のままでも
            // 即座には補正されず、明示的にTick()を呼ぶまで持ち越されることを確認する。
            const string yaml = @"
object_defs:
  clock_deferred:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_deferred")), session);

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
            const string yaml = @"
object_defs:
  tank_immediate:
    props:
      pressure:
        value: 5
        range: {min: 0, max: 10}
        # on_overflowを指定しない: YAMLコンバータが「自分自身をrange.maxへset」を既定合成する
";
            var codex = Load(yaml);
            int pressureId = codex.PropertyNames.GetId("pressure");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank_immediate")), session);

            instance.AddNumber(pressureId, 5, session); // 5+5=10 >= max(10)。例外・スタックオーバーフローを起こさなければ成功

            Assert.That(instance.GetNumber(pressureId), Is.EqualTo(10));
        }

        [Test]
        public void Tick_WrapsPropertyAndCarriesToTarget_WhenExceedingRangeMax()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
    passives:
      - accumulate:
          self:
            minute: 15
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock")), session);

            instance.Tick(session); // 45 + 15 = 60 > 59 なので折り返す

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void Tick_SetResetsSelfAndAddCarriesToTarget_WhenExceedingRangeMax()
        {
            // set: {self: {minute: 0}} + add: {self: {hour: 1}} という、core.yamlが実際に使っている文法
            // （accumulateの"-60"のような差分指定ではなく、setで絶対値へ戻す）を検証する。
            const string yaml = @"
object_defs:
  clock_set:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
    passives:
      - accumulate:
          self:
            minute: 15
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock_set")), session);

            instance.Tick(session); // 45 + 15 = 60 > 59 なので折り返す

            Assert.That(instance.GetNumber(minuteId), Is.EqualTo(0), "setにより絶対値0へ戻る（差分ではなく代入）");
            Assert.That(instance.GetNumber(hourId), Is.EqualTo(1));
        }

        [Test]
        public void Tick_DoesNotOverflow_WhenValueStaysWithinRange()
        {
            const string yaml = @"
object_defs:
  clock2:
    props:
      minute:
        value: 10
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
    passives:
      - accumulate:
          self:
            minute: 15
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock2")), session);

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
            const string yaml = @"
object_defs:
  clock3:
    props:
      minute:
        value: 35
        range: {min: 0, max: 9}
        on_overflow:
          add: {self: {minute: -10, hour: 1}}
      hour:
        value: 0
";
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock3")), session);

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
            const string yaml = @"
object_defs:
  clock4:
    props:
      minute:
        value: 50
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 23
        range: {min: 0, max: 23}
        on_overflow:
          add: {self: {hour: -24, day: 1}}
      day:
        value: 1
    passives:
      - accumulate:
          self:
            minute: 15
";
            // 50+15=65 -> minute=5, hour+1(23->24, さらに折り返す)
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock4")), session);

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
            const string yaml = @"
object_defs:
  clock5:
    props:
      hour:
        value: 23
        range: {min: 0, max: 23}
        on_overflow:
          add: {self: {hour: -24, day: 1}}
      day:
        value: 1
      minute:
        value: 50
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
    passives:
      - accumulate:
          self:
            minute: 15
";
            // 50+15=65 -> minute=5, hour+1(23->24)
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("clock5")), session);

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
            const string yaml = @"
object_defs:
  a_clock2:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          add: {self: {minute: -60, hour: 1}}
    passives:
      - accumulate:
          self:
            minute: 15
  b_something2:
    props:
      hour:
        value: 0
";
            // a_clock2はhourを持たない。b_something2が同名プロパティを持つ(名前だけは登録される)
            var codex = Load(yaml);
            int minuteId = codex.PropertyNames.GetId("minute");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("a_clock2")), session);

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
            const string yaml = @"
object_defs:
  tank2:
    props:
      gauge:
        value: 0
        range: {min: 0, max: 100}
        on_overflow:
          add: {self: {gauge: -100}}
        on_max:
          add: {self: {alarm_count: 1}}
      alarm_count:
        value: 0
    passives:
      - accumulate:
          self:
            gauge: 150
";
            var codex = Load(yaml);
            int gaugeId = codex.PropertyNames.GetId("gauge");
            int alarmId = codex.PropertyNames.GetId("alarm_count");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank2")), session);

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
            const string yaml = @"
object_defs:
  tank3:
    props:
      gauge:
        value: 50
        range: {min: 0, max: 100}
        on_shortfall:
          add: {self: {gauge: 150}}
        on_min:
          add: {self: {alarm_count: 1}}
      alarm_count:
        value: 0
    passives:
      - accumulate:
          self:
            gauge: -150
";
            var codex = Load(yaml);
            int gaugeId = codex.PropertyNames.GetId("gauge");
            int alarmId = codex.PropertyNames.GetId("alarm_count");
            var session = new WorldSession(codex);

            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("tank3")), session);

            instance.Tick(session); // 50 - 150 = -100 < 0 なので折り返す。折り返し量(+150)はmin(0)ちょうどには
            // 着地させない(50に着地させる)ことで、「折り返し後の値がたまたま境界と一致する」ケースと区別する。

            Assert.That(instance.GetNumber(gaugeId), Is.EqualTo(50), "on_shortfallにより50へ折り返される(0ちょうどには着地しない)");
            Assert.That(instance.GetNumber(alarmId), Is.EqualTo(1),
                "on_shortfallで折り返される前に、gaugeが確かにmin(0)以下に達していたことをon_minが検知できているはず");
        }
    }
}

using System;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// YAMLローダー（複数ファイル・複数ディレクトリからのWorldCodex構築、GameElementDefinition.md 3・5節）
    /// に対する自動テスト。
    /// </summary>
    [TestFixture]
    public class YamlLoaderTests
    {
        private static WorldCodexYamlLoader.SourceGroup Group(string label, params (string FileLabel, string Text)[] files)
        {
            return new WorldCodexYamlLoader.SourceGroup(
                label, files.Select(f => new WorldCodexYamlLoader.SourceFile(f.FileLabel, f.Text)).ToList());
        }

        private static PropertyDef PropOf(WorldCodex codex, ObjectDef def, string propertyName)
        {
            int local = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId(propertyName));
            return def.PropertyDefs[local];
        }

        private static SlotDef SlotOf(WorldCodex codex, ObjectDef def, string slotName)
        {
            int local = def.SlotLayout.ToLocal(codex.SlotNames.GetId(slotName));
            return def.SlotDefs[local];
        }

        // ------------------------------------------------------------------
        // 基本: 1ファイル内のobject_defs
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_ParsesPropsSlotsAndStackOrder()
        {
            const string yaml = @"
object_defs:
  log:
    props:
      life:
        value: 10
    slots:
      inside:
        capacity: 5
    stack_order:
      property: life
      ascending: false
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));

            Assert.That(PropOf(codex, log, "life").DefaultValue.AsNumber(), Is.EqualTo(10));
            Assert.That(SlotOf(codex, log, "inside").Capacity, Is.EqualTo(5.0));

            Assert.That(log.StackOrder, Is.Not.Null);
            Assert.That(log.StackOrder.PropertyGlobalId, Is.EqualTo(codex.PropertyNames.GetId("life")));
            Assert.That(log.StackOrder.Ascending, Is.False);
        }

        [Test]
        public void LoadFromGroups_StringPropertyValue_InternsIntoSharedSymbolRegistry()
        {
            const string yaml = @"
object_defs:
  sky:
    props:
      weather:
        value: clear
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef sky = codex.Objects.Get(codex.ObjectNames.GetId("sky"));
            PropertyValue value = PropOf(codex, sky, "weather").DefaultValue;

            Assert.That(value.Kind, Is.EqualTo(PropertyValueKind.Symbol));
            Assert.That(codex.Symbols.GetName(value.Symbol), Is.EqualTo("clear"));
        }

        // ------------------------------------------------------------------
        // 複数ファイル（同一グループ内）: 分割してもまとめて読める
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_MergesObjectDefsAcrossMultipleFilesInSameGroup()
        {
            const string core = @"
object_defs:
  ground:
    slots:
      pile: {}
";
            const string foods = @"
object_defs:
  apple:
    props:
      freshness:
        value: 5
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                Group("base", ("core.yaml", core), ("foods.yaml", foods)),
            });

            Assert.That(codex.ObjectNames.TryGetId("ground", out _), Is.True);
            Assert.That(codex.ObjectNames.TryGetId("apple", out _), Is.True);
        }

        [Test]
        public void LoadFromGroups_DuplicateObjectDefWithinSameGroup_Throws()
        {
            const string a = @"
object_defs:
  rock: {}
";
            const string b = @"
object_defs:
  rock: {}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("base", ("a.yaml", a), ("b.yaml", b)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("rock"));
        }

        // ------------------------------------------------------------------
        // 複数グループ（ディレクトリ相当）: 後勝ちで上書き
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_LaterGroupOverridesSameNameFromEarlierGroup()
        {
            const string baseYaml = @"
object_defs:
  torch:
    props:
      fuel:
        value: 10
";
            const string modYaml = @"
object_defs:
  torch:
    props:
      fuel:
        value: 999
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                Group("base", ("base.yaml", baseYaml)),
                Group("mod", ("mod.yaml", modYaml)),
            });

            ObjectDef torch = codex.Objects.Get(codex.ObjectNames.GetId("torch"));
            Assert.That(PropOf(codex, torch, "fuel").DefaultValue.AsNumber(), Is.EqualTo(999),
                "後から渡したグループ(mod)の定義が、先のグループ(base)の同名定義を上書きする");
        }

        [Test]
        public void LoadFromGroups_SameNameAcrossDifferentGroups_DoesNotThrow()
        {
            const string baseYaml = @"
object_defs:
  torch: {}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                Group("base", ("base.yaml", baseYaml)),
                Group("mod", ("mod.yaml", baseYaml)),
            })), Throws.Nothing);
        }

        // ------------------------------------------------------------------
        // traits（mixin）
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_ObjectDefInheritsPropsAndSlotsFromTrait()
        {
            const string yaml = @"
traits:
  flammable:
    props:
      burning:
        value: 0
    slots:
      fire_pit: {}
object_defs:
  log:
    traits: [flammable]
    props:
      life:
        value: 10
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));
            Assert.That(PropOf(codex, log, "burning").DefaultValue.AsNumber(), Is.EqualTo(0));
            Assert.That(SlotOf(codex, log, "fire_pit"), Is.Not.Null);
        }

        [Test]
        public void LoadFromGroups_ObjectDefOverridesOnlySomeTraitFieldsOnMatchingProperty()
        {
            const string yaml = @"
traits:
  has_temp:
    props:
      temperature:
        value: 0
        range: {min: 0, max: 100}
object_defs:
  ember:
    traits: [has_temp]
    props:
      temperature:
        value: 50
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef ember = codex.Objects.Get(codex.ObjectNames.GetId("ember"));
            PropertyDef temp = PropOf(codex, ember, "temperature");

            Assert.That(temp.DefaultValue.AsNumber(), Is.EqualTo(50), "object_def側のvalueで上書きされる");
            Assert.That(temp.Range, Is.Not.Null, "object_defが指定していないrangeはtrait側から引き継がれる");
            Assert.That(temp.Range.Value.Min, Is.EqualTo(0));
            Assert.That(temp.Range.Value.Max, Is.EqualTo(100));
        }

        [Test]
        public void LoadFromGroups_TwoTraitsWithColidingPropertyName_Throws()
        {
            const string yaml = @"
traits:
  trait_a:
    props:
      shared:
        value: 1
  trait_b:
    props:
      shared:
        value: 2
object_defs:
  thing:
    traits: [trait_a, trait_b]
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("shared"));
        }

        [Test]
        public void LoadFromGroups_UnknownTraitReference_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    traits: [does_not_exist]
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("does_not_exist"));
        }

        // ------------------------------------------------------------------
        // passive / stage / on_min
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_StagePassive_UsesWhenOwnStageGate()
        {
            const string yaml = @"
object_defs:
  campfire:
    props:
      heat:
        value: 0
        stages:
          - name: lit
            min: 1
            modify:
              child:
                warmth: 5
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef campfire = codex.Objects.Get(codex.ObjectNames.GetId("campfire"));
            ContributionDef contribution = campfire.Contributions.Single();

            Assert.That(contribution.Target, Is.EqualTo(ContributionTarget.Child));
            Assert.That(contribution.Gate.Kind, Is.EqualTo(ContributionGateKind.WhenOwnStage));
        }

        [Test]
        public void LoadFromGroups_OnMinWithoutRange_Throws()
        {
            const string yaml = @"
object_defs:
  log:
    props:
      life:
        value: 0
        on_min:
          destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void LoadFromGroups_OnMinWithNonSelfTarget_Throws()
        {
            const string yaml = @"
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          destroy: parent
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_min"));
        }

        [Test]
        public void LoadFromGroups_OnMinSelf_ParsesDestroyAndSpawn()
        {
            const string yaml = @"
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          destroy: self
          spawn:
            object: ash
            into: same_slot
  ash: {}
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));
            ActiveEffect onMin = PropOf(codex, log, "life").OnMin;

            Assert.That(onMin, Is.Not.Null);
            Assert.That(onMin.Destroy, Contains.Item(ReferenceRoot.Self));
            Assert.That(onMin.Spawn, Is.Not.Null);
            Assert.That(onMin.Spawn.Into, Is.EqualTo(SpawnTargetRoot.SameSlot));
            Assert.That(codex.ObjectNames.GetName(onMin.Spawn.ObjectGlobalId), Is.EqualTo("ash"));
        }

        // ------------------------------------------------------------------
        // 構文エラー
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_DuplicateKeyWithinOneYamlMapping_Throws()
        {
            const string yaml = @"
object_defs:
  log:
    props:
      life:
        value: 1
      life:
        value: 2
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>());
        }

        // ------------------------------------------------------------------
        // actions / combinations
        // ------------------------------------------------------------------

        private static ActionDef ActionOf(ObjectDef def, string name) => def.Actions.Single(a => a.Name == name);
        private static CombinationDef CombinationOf(ObjectDef def, string name) => def.Combinations.Single(c => c.Name == name);

        [Test]
        public void LoadFromGroups_ParsesActionWithConditionsAndActive()
        {
            const string yaml = @"
object_defs:
  apple:
    props:
      freshness:
        value: 5
    actions:
      eat:
        showMenu: always
        conditions:
          - {path: actor.satiety, op: lt, value: 100}
        add:
          actor:
            satiety: 10
        destroy: self
  player: {}
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef apple = codex.Objects.Get(codex.ObjectNames.GetId("apple"));
            ActionDef eat = ActionOf(apple, "eat");

            Assert.That(eat.ShowMenu, Is.EqualTo(ShowMenuMode.Always));
            Assert.That(eat.Conditions.Count, Is.EqualTo(1));
            Assert.That(eat.Conditions[0].Path.Root, Is.EqualTo(ReferenceRoot.Actor));
            Assert.That(eat.Conditions[0].Op, Is.EqualTo(ConditionOp.Lt));
            Assert.That(eat.Active, Is.Not.Null);
            Assert.That(eat.Active.Adds.ContainsKey(ReferenceRoot.Actor), Is.True);
            Assert.That(eat.Active.Destroy, Contains.Item(ReferenceRoot.Self));
        }

        [Test]
        public void LoadFromGroups_ParsesActionPick()
        {
            const string yaml = @"
object_defs:
  weapon:
    actions:
      attack:
        pick:
          - weight: 50
            destroy: self
          - weight: 50
            destroy: actor
  target: {}
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef weapon = codex.Objects.Get(codex.ObjectNames.GetId("weapon"));
            ActionDef attack = ActionOf(weapon, "attack");

            Assert.That(attack.Active, Is.Null);
            Assert.That(attack.Pick.Count, Is.EqualTo(2));
            Assert.That(attack.Pick[0].Weight.IsPathRef, Is.False);
            Assert.That(attack.Pick[0].Weight.Literal, Is.EqualTo(50));
        }

        [Test]
        public void LoadFromGroups_ParsesCombinationWithAndDraggedTarget()
        {
            const string yaml = @"
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        conditions:
          - {path: dragged.durability, op: gt, value: 0}
        spawn: {object: logs}
        destroy: self
        add:
          dragged:
            durability: -1
  logs: {}
  axe_tool:
    props:
      durability:
        value: 10
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef wood = codex.Objects.Get(codex.ObjectNames.GetId("wood"));
            CombinationDef chop = CombinationOf(wood, "chop");

            Assert.That(chop.With, Is.EqualTo("axe_tool"));
            Assert.That(chop.Conditions[0].Path.Root, Is.EqualTo(ReferenceRoot.Dragged));
            Assert.That(chop.Active.Adds.ContainsKey(ReferenceRoot.Dragged), Is.True);
            Assert.That(codex.ObjectNames.GetName(chop.Active.Spawn.ObjectGlobalId), Is.EqualTo("logs"));
        }

        [Test]
        public void LoadFromGroups_ActionsAndCombinationsDistributedByTrait()
        {
            const string yaml = @"
traits:
  eatable:
    actions:
      eat:
        destroy: self
object_defs:
  berry:
    traits: [eatable]
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef berry = codex.Objects.Get(codex.ObjectNames.GetId("berry"));
            Assert.That(ActionOf(berry, "eat").Active.Destroy, Contains.Item(ReferenceRoot.Self));
        }

        [Test]
        public void LoadFromGroups_TwoTraitsWithCollidingActionName_Throws()
        {
            const string yaml = @"
traits:
  trait_a:
    actions:
      use:
        destroy: self
  trait_b:
    actions:
      use:
        destroy: self
object_defs:
  thing:
    traits: [trait_a, trait_b]
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("use"));
        }

        [Test]
        public void LoadFromGroups_DraggedTargetInActions_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: dragged
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("dragged"));
        }

        [Test]
        public void LoadFromGroups_ChildTargetInActive_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: child
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("child"));
        }

        [Test]
        public void LoadFromGroups_UnsupportedShowMenuValue_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        showMenu: sometimes
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("showMenu"));
        }

        [Test]
        public void LoadFromGroups_WorldPathRoot_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {path: world.day, op: gt, value: 0}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("world"));
        }

        [Test]
        public void LoadFromGroups_ConditionValueMax_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {path: actor.satiety, op: lt, value: max}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("max"));
        }

        [Test]
        public void LoadFromGroups_ActiveAndPickBothSpecified_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: self
        pick:
          - weight: 1
            destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("pick"));
        }

        // ------------------------------------------------------------------
        // accepts.object / combinations.with のトレイト参照・バリデーション
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_SlotAcceptsMatchesTraitName()
        {
            const string yaml = @"
traits:
  location: {}
object_defs:
  world:
    slots:
      locations:
        accepts:
          - {object: location, max: 10}
  forest:
    traits: [location]
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            SlotDef locations = SlotOf(codex, world, "locations");

            Assert.That(locations.Accepts[0].With, Is.EqualTo("location"));

            ObjectDef forest = codex.Objects.Get(codex.ObjectNames.GetId("forest"));
            Assert.That(locations.Accepts[0].Matches(forest), Is.True);
        }

        [Test]
        public void LoadFromGroups_SlotAcceptsUnknownName_Throws()
        {
            const string yaml = @"
object_defs:
  world:
    slots:
      locations:
        accepts:
          - {object: does_not_exist, max: 10}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("does_not_exist"));
        }

        [Test]
        public void LoadFromGroups_CombinationWithUnknownName_Throws()
        {
            const string yaml = @"
object_defs:
  wood:
    combinations:
      chop:
        with: does_not_exist2
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("does_not_exist2"));
        }

        // ------------------------------------------------------------------
        // on_overflow
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_OnOverflowWithoutRange_Throws()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_overflow:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void LoadFromGroups_ParsesOnOverflowAndAppliesItAtRuntime()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("clock.yaml", yaml)) });

            ObjectDef clock = codex.Objects.Get(codex.ObjectNames.GetId("clock"));
            Assert.That(PropOf(codex, clock, "minute").OnOverflow.Sets[ReferenceRoot.Self].Count, Is.EqualTo(1));
            Assert.That(PropOf(codex, clock, "minute").OnOverflow.Adds[ReferenceRoot.Self].Count, Is.EqualTo(1));

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, clock);
            instance.SetProperty(codex.PropertyNames.GetId("minute"), PropertyValue.FromNumber(60)); // 手動で溢れさせる
            instance.Tick(session); // accumulate契機は無いが、既に溢れているのでon_overflowだけが発火する

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("minute")), Is.EqualTo(0));
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("hour")), Is.EqualTo(1));
        }

        [Test]
        public void LoadFromGroups_OnOverflowWithNonSelfTarget_Throws()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_overflow:
          add: {parent: {minute: -60}}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_overflow"));
        }

        [Test]
        public void LoadFromGroups_OnOverflowOmitted_DefaultsToClampingSelfToMax()
        {
            // rangeだけ定義してon_overflowを省略すると、「自分自身をRange.Maxへsetする」既定の
            // ActiveEffectが自動生成され、上限クランプとして機能する。
            const string yaml = @"
object_defs:
  gauge:
    props:
      value:
        value: 90
        range: {min: 0, max: 100}
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef gauge = codex.Objects.Get(codex.ObjectNames.GetId("gauge"));
            Assert.That(PropOf(codex, gauge, "value").OnOverflow, Is.Not.Null);

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, gauge);
            instance.SetProperty(codex.PropertyNames.GetId("value"), PropertyValue.FromNumber(150));
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("value")), Is.EqualTo(100), "既定のon_overflowにより100へクランプされる");
        }

        // ------------------------------------------------------------------
        // on_shortfall（on_overflowの下限側の鏡像）
        // ------------------------------------------------------------------

        [Test]
        public void LoadFromGroups_OnShortfallWithoutRange_Throws()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_shortfall:
          set: {self: {minute: 0}}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void LoadFromGroups_OnShortfallWithNonSelfTarget_Throws()
        {
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_shortfall:
          add: {parent: {minute: 60}}
";
            Assert.That((Func<WorldCodex>)(() => WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) })),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_shortfall"));
        }

        [Test]
        public void LoadFromGroups_ParsesOnShortfallAndAppliesItAtRuntime()
        {
            // on_overflowの下限側の鏡像。addで折り返し量・繰り下げ量を一度に加減算する（on_overflowと
            // 同じく、setより堅牢）。
            const string yaml = @"
object_defs:
  clock:
    props:
      minute:
        value: 5
        range: {min: 0, max: 59}
        on_shortfall:
          add: {self: {minute: 60, hour: -1}}
      hour:
        value: 1
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("clock.yaml", yaml)) });

            ObjectDef clock = codex.Objects.Get(codex.ObjectNames.GetId("clock"));
            Assert.That(PropOf(codex, clock, "minute").OnShortfall.Adds[ReferenceRoot.Self].Count, Is.EqualTo(2));

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, clock);
            instance.SetProperty(codex.PropertyNames.GetId("minute"), PropertyValue.FromNumber(-10)); // 手動で下回らせる
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("minute")), Is.EqualTo(50));
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("hour")), Is.EqualTo(0));
        }

        [Test]
        public void LoadFromGroups_OnShortfallOmitted_DefaultsToClampingSelfToMin()
        {
            const string yaml = @"
object_defs:
  gauge:
    props:
      value:
        value: 10
        range: {min: 0, max: 100}
";
            var codex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            ObjectDef gauge = codex.Objects.Get(codex.ObjectNames.GetId("gauge"));
            Assert.That(PropOf(codex, gauge, "value").OnShortfall, Is.Not.Null);

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, gauge);
            instance.SetProperty(codex.PropertyNames.GetId("value"), PropertyValue.FromNumber(-50));
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("value")), Is.EqualTo(0), "既定のon_shortfallにより0へクランプされる");
        }
    }
}

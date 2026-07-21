using System;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// YAMLローダー（複数ファイル・複数ディレクトリからのWorldCodex構築、GameElementDefinition.md 3・5節）
    /// に対する自動テスト。
    /// </summary>
    [TestFixture]
    public class YamlLoaderTests
    {
        private static PropertyDef PropOf(WorldCodex codex, ObjectDef def, string propertyName)
        {
            return def.GetPropertyDef(codex.PropertyNames.GetId(propertyName));
        }

        private static SlotDef SlotOf(WorldCodex codex, ObjectDef def, string slotName)
        {
            return def.GetSlotDef(codex.SlotNames.GetId(slotName));
        }

        // ------------------------------------------------------------------
        // 基本: 1ファイル内のobject_defs
        // ------------------------------------------------------------------

        [Test]
        public void Load_ParsesPropsSlotsAndStackOrder()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));

            Assert.That(PropOf(codex, log, "life").DefaultNumber, Is.EqualTo(10));
            Assert.That(SlotOf(codex, log, "inside").Capacity, Is.EqualTo(5.0));

            Assert.That(log.StackOrder, Is.Not.Null);
            Assert.That(log.StackOrder.PropertyGlobalId, Is.EqualTo(codex.PropertyNames.GetId("life")));
            Assert.That(log.StackOrder.Ascending, Is.False);
        }

        [Test]
        public void Load_IdentifierPropertyValue_InternsAsSymbol()
        {
            const string yaml = @"
object_defs:
  sky:
    props:
      weather:
        value: clear
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            ObjectDef sky = codex.Objects.Get(codex.ObjectNames.GetId("sky"));

            Assert.That(PropOf(codex, sky, "weather").DefaultNumber, Is.EqualTo(codex.SymbolNames.GetId("clear")),
                "整数にも真偽値にもならない識別子は、シンボル名としてsymbolNamesへ登録される");
        }

        [Test]
        public void Load_NonIdentifierPropertyValue_Throws()
        {
            const string yaml = @"
object_defs:
  sky2:
    props:
      weather:
        value: ""not a valid symbol!""
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("シンボル名"));
        }

        [Test]
        public void GetSlotDef_ReturnsNullWhenObjectDoesNotHaveThatSlot()
        {
            const string yaml = @"
object_defs:
  log:
    slots:
      inside: {}
  apple: {}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));
            ObjectDef apple = codex.Objects.Get(codex.ObjectNames.GetId("apple"));
            int insideSlotId = codex.SlotNames.GetId("inside");

            Assert.That(log.GetSlotDef(insideSlotId), Is.Not.Null);
            Assert.That(apple.GetSlotDef(insideSlotId), Is.Null);
        }

        // ------------------------------------------------------------------
        // 複数ファイル・複数回のLoad呼び出し: 分割してもまとめて読める
        // ------------------------------------------------------------------

        [Test]
        public void Load_MergesObjectDefsAcrossMultipleCalls()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", core).Load("foods.yaml", foods).Build();

            Assert.That(codex.ObjectNames.TryGetId("ground", out _), Is.True);
            Assert.That(codex.ObjectNames.TryGetId("apple", out _), Is.True);
        }

        [Test]
        public void Load_DuplicateObjectDefName_Throws()
        {
            const string a = @"
object_defs:
  rock: {}
";
            const string b = @"
object_defs:
  rock: {}
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("a.yaml", a).Load("b.yaml", b).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("rock"));
        }

        // ------------------------------------------------------------------
        // 重複は出所を問わず常にエラー（MODによる既存定義の差し替えは、専用のpatch文法で
        // 別途表現する想定であり、このローダーは「後勝ちで上書き」という規則を持たない）
        // ------------------------------------------------------------------

        [Test]
        public void Load_DuplicateObjectDefNameFromSeparateCalls_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("base.yaml", baseYaml).Load("mod.yaml", modYaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("torch"),
                "追加のつもりが誤って上書きしてしまう事故を防ぐため、呼び出しが分かれていても同名の重複は許さない" +
                "（MODによる意図的な差し替えは、専用のpatch文法で別途表現する想定）");
        }

        // ------------------------------------------------------------------
        // traits（mixin）
        // ------------------------------------------------------------------

        [Test]
        public void Load_ObjectDefInheritsPropsAndSlotsFromTrait()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));
            Assert.That(PropOf(codex, log, "burning").DefaultNumber, Is.EqualTo(0));
            Assert.That(SlotOf(codex, log, "fire_pit"), Is.Not.Null);
        }

        [Test]
        public void Load_ObjectDefOverridesOnlySomeTraitFieldsOnMatchingProperty()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef ember = codex.Objects.Get(codex.ObjectNames.GetId("ember"));
            PropertyDef temp = PropOf(codex, ember, "temperature");

            Assert.That(temp.DefaultNumber, Is.EqualTo(50), "object_def側のvalueで上書きされる");
            Assert.That(temp.Range, Is.Not.Null, "object_defが指定していないrangeはtrait側から引き継がれる");
            Assert.That(temp.Range.Value.Min, Is.EqualTo(0));
            Assert.That(temp.Range.Value.Max, Is.EqualTo(100));
        }

        [Test]
        public void Load_TwoTraitsWithColidingPropertyName_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("shared"));
        }

        [Test]
        public void Load_UnknownTraitReference_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    traits: [does_not_exist]
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("does_not_exist"));
        }

        // ------------------------------------------------------------------
        // passive / stage / on_min
        // ------------------------------------------------------------------

        [Test]
        public void Load_StagePassive_UsesWhenOwnStageGate()
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
            passives:
              - modify:
                  child:
                    warmth: 5
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef campfire = codex.Objects.Get(codex.ObjectNames.GetId("campfire"));
            PassiveEffect effect = campfire.Passives.Single();

            Assert.That(effect.Target, Is.EqualTo(PassiveEffectTarget.Child));
            Assert.That(effect.Gate.StageName, Is.Not.Null, "stage内のpassivesはStageNameが設定される");
            Assert.That(effect.Gate.Conditions, Is.Null, "conditionsを書いていなければnullのまま");
        }

        [Test]
        public void Load_SymbolPropertyStage_ResolvesByNameExactMatch()
        {
            const string yaml = @"
object_defs:
  sky3:
    props:
      weather:
        value: clear
        stages:
          - name: storm
          - name: clear
            passives:
              - modify:
                  self:
                    sunlight: 5
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            ObjectDef sky = codex.Objects.Get(codex.ObjectNames.GetId("sky3"));
            PropertyDef weather = PropOf(codex, sky, "weather");

            int stormId = codex.SymbolNames.Intern("storm");
            int clearId = codex.SymbolNames.GetId("clear");
            int somethingElseId = codex.SymbolNames.Intern("cloudy");

            Assert.That(weather.ResolveStage(stormId)?.Name, Is.EqualTo("storm"));
            Assert.That(weather.ResolveStage(clearId)?.Name, Is.EqualTo("clear"));
            Assert.That(weather.ResolveStage(somethingElseId), Is.Null,
                "シンボル型プロパティにフォールバックという概念は存在せず、stagesに書かれていない値は" +
                "常にnullになる");
        }

        [Test]
        public void Load_SymbolPropertyStageWithMin_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    props:
      weather:
        value: clear
        stages:
          - name: bad
            min: 1
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("min").And.Message.Contain("シンボル型"));
        }

        [Test]
        public void Load_SymbolPropertyStagePassive_UsesWhenOwnStageGate()
        {
            const string yaml = @"
object_defs:
  sky4:
    props:
      weather:
        value: clear
        stages:
          - name: clear
            passives:
              - modify:
                  self:
                    sunlight: 5
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef sky = codex.Objects.Get(codex.ObjectNames.GetId("sky4"));
            PassiveEffect effect = sky.Passives.Single();

            Assert.That(effect.Gate.StageName, Is.EqualTo("clear"), "シンボル型のstage内のpassivesもStageNameが設定される");
            Assert.That(effect.Gate.Conditions, Is.Null);
        }

        [Test]
        public void Load_PassivesIsAlwaysAnArray_RejectsMappingForm()
        {
            const string yaml = @"
object_defs:
  torch:
    props:
      fuel:
        value: 10
        passives:
          accumulate:
            self:
              fuel: -1
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("配列"));
        }

        [Test]
        public void Load_MultiplePassivesBlocks_EachWithDifferentConditions_YieldDifferentGatedPassives()
        {
            // passivesを配列にした動機そのもの: 同じ対象(parent)に対して、装備するスロットごとに
            // 異なるmodify量を与えたい場合、conditions違いの複数ブロックが必要になる。
            const string yaml = @"
object_defs:
  character:
    props:
      attack:
        value: 10
    slots:
      main_hand: {}
      off_hand: {}
  sword:
    passives:
      - conditions:
          - {in_slot: main_hand}
        modify:
          parent:
            attack: 5
      - conditions:
          - {in_slot: off_hand}
        modify:
          parent:
            attack: 2
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int attackId = codex.PropertyNames.GetId("attack");
            int mainHandId = codex.SlotNames.GetId("main_hand");
            int offHandId = codex.SlotNames.GetId("off_hand");

            var session = new WorldSession(codex);
            var characterInstance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("character")));
            var swordInstance = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("sword")));

            Assert.That(swordInstance.MoveToSlot(characterInstance, mainHandId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(attackId), Is.EqualTo(15), "main_handでは+5");

            Assert.That(swordInstance.MoveToSlot(characterInstance, offHandId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(attackId), Is.EqualTo(12), "off_handへ持ち替えると+2に切り替わる");
        }

        [Test]
        public void Load_OnMinWithoutRange_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void Load_OnMinWithNonSelfTarget_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_min"));
        }

        [Test]
        public void Load_OnMinSelf_ParsesDestroyAndSpawn()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef log = codex.Objects.Get(codex.ObjectNames.GetId("log"));
            ActiveEffect onMin = PropOf(codex, log, "life").OnMin;

            Assert.That(onMin, Is.Not.Null);
            Assert.That(onMin.Destroy, Contains.Item(ReferenceRoot.Self));
            Assert.That(onMin.Spawns.Count, Is.EqualTo(1));
            Assert.That(onMin.Spawns[0].Into, Is.EqualTo(SpawnTargetRoot.SameSlot));
            Assert.That(codex.ObjectNames.GetName(onMin.Spawns[0].ObjectGlobalId), Is.EqualTo("ash"));
        }

        // ------------------------------------------------------------------
        // 構文エラー
        // ------------------------------------------------------------------

        [Test]
        public void Load_DuplicateKeyWithinOneYamlMapping_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>());
        }

        // ------------------------------------------------------------------
        // actions / combinations
        // ------------------------------------------------------------------

        private static ActionDef ActionOf(ObjectDef def, string name) => def.Actions.Single(a => a.Name == name);
        private static CombinationDef CombinationOf(ObjectDef def, string name) => def.Combinations.Single(c => c.Name == name);

        [Test]
        public void Load_ParsesActionWithConditionsAndActive()
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
          - {object: actor, prop: satiety, op: lt, value: 100}
        add:
          actor:
            satiety: 10
        destroy: self
  player: {}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef apple = codex.Objects.Get(codex.ObjectNames.GetId("apple"));
            ActionDef eat = ActionOf(apple, "eat");

            Assert.That(eat.ShowMenu, Is.EqualTo(ShowMenuMode.Always));
            Assert.That(eat.Conditions.Children.Count, Is.EqualTo(1));
            Assert.That(eat.Conditions.Children[0].Root, Is.EqualTo(ReferenceRoot.Actor));
            Assert.That(eat.Conditions.Children[0].Op, Is.EqualTo(ConditionOp.Lt));
            Assert.That(eat.Active, Is.Not.Null);
            Assert.That(eat.Active.Adds.ContainsKey(ReferenceRoot.Actor), Is.True);
            Assert.That(eat.Active.Destroy, Contains.Item(ReferenceRoot.Self));
        }

        [Test]
        public void Load_ActionActiveSpawnAndTransfer_AcceptsArrays()
        {
            const string yaml = @"
object_defs:
  flask:
    actions:
      use:
        spawn:
          - {object: steam}
          - {object: smell}
        transfer:
          - {amount: 100, from_prop: a, to_prop: b}
          - {amount: 200, from_prop: c, to_prop: d}
  steam: {}
  smell: {}
  sink:
    props:
      a: {value: 0}
      b: {value: 0}
      c: {value: 0}
      d: {value: 0}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef flask = codex.Objects.Get(codex.ObjectNames.GetId("flask"));
            ActionDef use = ActionOf(flask, "use");

            Assert.That(use.Active.Spawns.Count, Is.EqualTo(2));
            Assert.That(codex.ObjectNames.GetName(use.Active.Spawns[0].ObjectGlobalId), Is.EqualTo("steam"));
            Assert.That(codex.ObjectNames.GetName(use.Active.Spawns[1].ObjectGlobalId), Is.EqualTo("smell"));
            Assert.That(use.Active.Transfers.Count, Is.EqualTo(2));
            Assert.That(use.Active.Transfers[0].Amount, Is.EqualTo(100));
            Assert.That(use.Active.Transfers[1].Amount, Is.EqualTo(200));
        }

        [Test]
        public void Load_ParsesActionPick()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef weapon = codex.Objects.Get(codex.ObjectNames.GetId("weapon"));
            ActionDef attack = ActionOf(weapon, "attack");

            Assert.That(attack.Active, Is.Null);
            Assert.That(attack.Pick.Count, Is.EqualTo(2));
            Assert.That(attack.Pick[0].Weight.IsPathRef, Is.False);
            Assert.That(attack.Pick[0].Weight.Literal, Is.EqualTo(50));
        }

        [Test]
        public void Load_ParsesCombinationWithAndDraggedTarget()
        {
            const string yaml = @"
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        conditions:
          - {object: dragged, prop: durability, op: gt, value: 0}
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef wood = codex.Objects.Get(codex.ObjectNames.GetId("wood"));
            CombinationDef chop = CombinationOf(wood, "chop");

            Assert.That(chop.With, Is.EqualTo(codex.TagNames.GetId("axe_tool")));
            Assert.That(chop.Conditions.Children[0].Root, Is.EqualTo(ReferenceRoot.Dragged));
            Assert.That(chop.Active.Adds.ContainsKey(ReferenceRoot.Dragged), Is.True);
            Assert.That(chop.Active.Spawns.Count, Is.EqualTo(1));
            Assert.That(codex.ObjectNames.GetName(chop.Active.Spawns[0].ObjectGlobalId), Is.EqualTo("logs"));
        }

        [Test]
        public void Load_ActionsAndCombinationsDistributedByTrait()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef berry = codex.Objects.Get(codex.ObjectNames.GetId("berry"));
            Assert.That(ActionOf(berry, "eat").Active.Destroy, Contains.Item(ReferenceRoot.Self));
        }

        [Test]
        public void Load_TwoTraitsWithCollidingActionName_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("use"));
        }

        [Test]
        public void Load_DraggedTargetInActions_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: dragged
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("dragged"));
        }

        [Test]
        public void Load_ChildTargetInActive_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: child
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("child"));
        }

        [Test]
        public void Load_UnsupportedShowMenuValue_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        showMenu: sometimes
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("showMenu"));
        }

        [Test]
        public void Load_WorldPathRoot_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: world, prop: day, op: gt, value: 0}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("world"));
        }

        [Test]
        public void Load_ConditionValueMax_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: actor, prop: satiety, op: lt, value: max}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("max"));
        }

        [Test]
        public void Load_ConditionLeaf_ObjectAndOpDefaultToSelfAndEq()
        {
            const string yaml = @"
object_defs:
  thing:
    props:
      mode:
        value: 1
    actions:
      use:
        conditions:
          - {prop: mode, value: 1}
        destroy: self
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef thing = codex.Objects.Get(codex.ObjectNames.GetId("thing"));
            ConditionNode leaf = ActionOf(thing, "use").Conditions.Children[0];

            Assert.That(leaf.Root, Is.EqualTo(ReferenceRoot.Self), "objectを省略するとself");
            Assert.That(leaf.Op, Is.EqualTo(ConditionOp.Eq), "opを省略するとeq");
        }

        [Test]
        public void Load_ConditionInSlotAndPropTogether_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {in_slot: equip, prop: hp, value: 1}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("slot"));
        }

        [Test]
        public void Load_ConditionInSlotWithOp_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {in_slot: equip, op: eq}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("未知のキー"));
        }

        [Test]
        public void Load_ConditionSlotContent_TrueWhenTaggedChildInSlot_FalseOtherwise()
        {
            const string yaml = @"
object_defs:
  box:
    slots:
      content:
        accepts:
          - {tag: marker, max: 1}
    actions:
      use:
        conditions:
          - {slot: content, tag: red}
        destroy: self
  red_marker:
    tags: [marker, red]
  blue_marker:
    tags: [marker, blue]
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int contentSlotId = codex.SlotNames.GetId("content");

            var session = new WorldSession(codex);
            var box = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("box")));
            var redMarker = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("red_marker")));
            redMarker.MoveToSlot(box, contentSlotId, session.Codex.WellKnown, out _);

            Assert.That(InteractionExecutor.TryExecuteAction(box, actor: null, "use", session), Is.True,
                "contentスロットにredタグのマーカーがあるので実行される");
        }

        [Test]
        public void Load_ConditionSlotContent_FalseWhenDifferentTagOrEmpty()
        {
            const string yaml = @"
object_defs:
  box2:
    slots:
      content:
        accepts:
          - {tag: marker, max: 1}
    actions:
      use:
        conditions:
          - {slot: content, tag: red}
        destroy: self
  blue_marker2:
    tags: [marker, blue]
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int contentSlotId = codex.SlotNames.GetId("content");

            var session = new WorldSession(codex);
            var box = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("box2")));
            Assert.That(InteractionExecutor.TryExecuteAction(box, actor: null, "use", session), Is.False,
                "contentスロットが空なので実行されない");

            var blueMarker = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("blue_marker2")));
            blueMarker.MoveToSlot(box, contentSlotId, session.Codex.WellKnown, out _);
            Assert.That(InteractionExecutor.TryExecuteAction(box, actor: null, "use", session), Is.False,
                "contentスロットの中身がredタグを持たない(blueタグ)ので実行されない");
        }

        [Test]
        public void Load_ConditionSlotWithoutTag_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {slot: content}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("tag"));
        }

        [Test]
        public void Load_ConditionTagWithoutSlot_ParsesAsObjectTagCheck()
        {
            const string yaml = @"
object_defs:
  thing:
    tags: [red]
    actions:
      use:
        conditions:
          - {tag: red}
        destroy: self
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            var session = new WorldSession(codex);
            var thing = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("thing")));

            Assert.That(InteractionExecutor.TryExecuteAction(thing, null, "use", session), Is.True);
        }

        [Test]
        public void Load_ConditionValueAsPropertyReference_ComparesTwoDynamicProperties()
        {
            const string yaml = @"
object_defs:
  bottle:
    props:
      content:
        value: empty
    combinations:
      pour_in:
        with: liquid_container
        conditions:
          - {prop: content, op: eq, value: {object: dragged, prop: content}}
        destroy: self
  bottle_source:
    tags: [liquid_container]
    props:
      content:
        value: water
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            var session = new WorldSession(codex);
            var bottle = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("bottle")));
            var sameContent = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("bottle_source")));

            Assert.That(InteractionExecutor.TryExecuteCombination(bottle, sameContent, null, "pour_in", session), Is.False,
                "self(empty)とdragged(water)のcontentが異なるので不成立");

            int contentId = codex.PropertyNames.GetId("content");
            bottle.SetProperty(contentId, codex.SymbolNames.GetId("water"));
            Assert.That(InteractionExecutor.TryExecuteCombination(bottle, sameContent, null, "pour_in", session), Is.True,
                "selfとdraggedのcontentが同じ(water)なので成立");
        }

        [Test]
        public void Load_ConditionValueRefWithInOp_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {prop: content, op: in, value: {object: dragged, prop: content}}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("in"));
        }

        [Test]
        public void Load_SetValueAsPropertyReference_CopiesDraggedPropertyIntoSelf()
        {
            const string yaml = @"
object_defs:
  bottle2:
    props:
      content:
        value: empty
    combinations:
      pour_in:
        with: liquid_container2
        set:
          self:
            content: {object: dragged, prop: content}
  oil_source:
    tags: [liquid_container2]
    props:
      content:
        value: oil
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int contentId = codex.PropertyNames.GetId("content");

            var session = new WorldSession(codex);
            var bottle = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("bottle2")));
            var oilSource = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("oil_source")));

            Assert.That(InteractionExecutor.TryExecuteCombination(bottle, oilSource, null, "pour_in", session), Is.True);
            Assert.That(bottle.GetNumber(contentId), Is.EqualTo(codex.SymbolNames.GetId("oil")),
                "set: {content: {object: dragged, prop: content}}がdraggedの現在値をそのままコピーする");
        }

        [Test]
        public void Load_ConditionAnyCombinator_MatchesWhenEitherLeafIsTrue()
        {
            const string yaml = @"
object_defs:
  player: {}
  thing:
    props:
      hp:
        value: 5
      mp:
        value: 5
    actions:
      use:
        conditions:
          - any:
              - {prop: hp, op: gte, value: 100}
              - {prop: mp, op: gte, value: 5}
        destroy: self
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef thing = codex.Objects.Get(codex.ObjectNames.GetId("thing"));
            ConditionNode conditions = ActionOf(thing, "use").Conditions;

            Assert.That(conditions.Kind, Is.EqualTo(ConditionNodeKind.All), "conditionsの最上位は暗黙のall");
            Assert.That(conditions.Children[0].Kind, Is.EqualTo(ConditionNodeKind.Any));

            var session = new WorldSession(codex);
            var thingInstance = new WorldObject(1, thing);

            Assert.That(InteractionExecutor.TryExecuteAction(thingInstance, actor: null, "use", session), Is.True,
                "hp(5)はgte 100を満たさないが、mp(5)がgte 5を満たすのでanyとして成立する");
        }

        [Test]
        public void Load_ConditionNotCombinator_NegatesInnerLeaf()
        {
            const string yaml = @"
object_defs:
  thing:
    props:
      locked:
        value: 1
    actions:
      use:
        conditions:
          - not: {prop: locked, value: 1}
        destroy: self
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            var session = new WorldSession(codex);
            var thingInstance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("thing")));

            Assert.That(InteractionExecutor.TryExecuteAction(thingInstance, actor: null, "use", session), Is.False,
                "locked(1)がprop:1と一致するため、not: {...}は偽になる");
        }

        [Test]
        public void Load_StageForcedGateWithConditions_CombinesStageAndConditionsWithAnd()
        {
            // ステージ強制ゲート(WhenOwnStage)とconditionsは併用でき、両方を満たす間だけ有効になる
            // （WhenOwnStageAndConditions、GameElementDefinition.md 8.2節）。
            const string yaml = @"
object_defs:
  campfire:
    props:
      heat:
        value: 0
        stages:
          - name: unlit
          - name: lit
            min: 1
            passives:
              - conditions:
                  - {in_slot: fuel_slot}
                modify:
                  child:
                    warmth: 5
    slots:
      fuel_slot: {}
      storage: {}
  log:
    props:
      warmth:
        value: 0
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int heatId = codex.PropertyNames.GetId("heat");
            int warmthId = codex.PropertyNames.GetId("warmth");
            int fuelSlotId = codex.SlotNames.GetId("fuel_slot");
            int storageSlotId = codex.SlotNames.GetId("storage");

            var session = new WorldSession(codex);
            var campfireInstance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("campfire")));
            var logInstance = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("log")));

            Assert.That(logInstance.MoveToSlot(campfireInstance, fuelSlotId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(logInstance.GetEffectiveValue(warmthId), Is.EqualTo(0),
                "fuel_slotには入っているが、heatがunlitステージのためボーナスなし");

            campfireInstance.SetProperty(heatId, 1);
            Assert.That(logInstance.GetEffectiveValue(warmthId), Is.EqualTo(5),
                "litステージかつfuel_slot条件の両方を満たすのでボーナスが乗る");

            Assert.That(logInstance.MoveToSlot(campfireInstance, storageSlotId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(logInstance.GetEffectiveValue(warmthId), Is.EqualTo(0),
                "litステージのままでもfuel_slotから外れるとボーナスが消える");
        }

        [Test]
        public void Load_ActiveAndPickBothSpecified_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("pick"));
        }

        // ------------------------------------------------------------------
        // tags（4節）: accepts.tag / combinations.with のマッチング
        // ------------------------------------------------------------------

        [Test]
        public void Load_SlotAcceptsMatchesTagGrantedViaTrait()
        {
            const string yaml = @"
traits:
  location: {tags: [location]}
object_defs:
  world:
    slots:
      locations:
        accepts:
          - {tag: location, max: 10}
  forest:
    traits: [location]
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            SlotDef locations = SlotOf(codex, world, "locations");

            Assert.That(locations.Accepts[0].With, Is.EqualTo(codex.TagNames.GetId("location")));

            ObjectDef forest = codex.Objects.Get(codex.ObjectNames.GetId("forest"));
            Assert.That(locations.Accepts[0].Matches(forest), Is.True);
        }

        [Test]
        public void Load_SlotAcceptsMatchesTagDeclaredDirectly_EvenWithoutSharedTrait()
        {
            // beachはforestと同じtraitを一切参照しないが、tagsで直接同じタグを宣言する。同一traitでなくても
            // 同じように受け入れたい、というtags導入の意図そのものを検証する。
            const string yaml = @"
traits:
  location: {tags: [location]}
object_defs:
  world:
    slots:
      locations:
        accepts:
          - {tag: location, max: 10}
  forest:
    traits: [location]
  beach:
    tags: [location]
  rock: {}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            SlotDef locations = SlotOf(codex, world, "locations");

            ObjectDef beach = codex.Objects.Get(codex.ObjectNames.GetId("beach"));
            ObjectDef rock = codex.Objects.Get(codex.ObjectNames.GetId("rock"));

            Assert.That(locations.Accepts[0].Matches(beach), Is.True, "traitを介さず直接tagsで宣言したタグでもマッチする");
            Assert.That(locations.Accepts[0].Matches(rock), Is.False, "タグを持たないobject_defはマッチしない");
        }

        [Test]
        public void Load_SlotAcceptsObject_MatchesOnlyThatExactObjectDef()
        {
            const string yaml = @"
object_defs:
  cauldron:
    slots:
      ingredients:
        accepts:
          - {object: raw_meat, max: 1}
  raw_meat: {}
  raw_fish: {}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef cauldron = codex.Objects.Get(codex.ObjectNames.GetId("cauldron"));
            SlotDef ingredients = SlotOf(codex, cauldron, "ingredients");

            Assert.That(ingredients.Accepts[0].TargetKind, Is.EqualTo(SlotAcceptTargetKind.Object));
            Assert.That(ingredients.Accepts[0].With, Is.EqualTo(codex.ObjectNames.GetId("raw_meat")));

            ObjectDef rawMeat = codex.Objects.Get(codex.ObjectNames.GetId("raw_meat"));
            ObjectDef rawFish = codex.Objects.Get(codex.ObjectNames.GetId("raw_fish"));
            Assert.That(ingredients.Accepts[0].Matches(rawMeat), Is.True);
            Assert.That(ingredients.Accepts[0].Matches(rawFish), Is.False, "objectは対象の型そのものにしかマッチしない");
        }

        [Test]
        public void Load_SlotAcceptsBothTagAndObject_Throws()
        {
            const string yaml = @"
object_defs:
  cauldron2:
    slots:
      ingredients:
        accepts:
          - {tag: spice, object: raw_meat, max: 1}
  raw_meat: {}
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("同時に指定できません"));
        }

        [Test]
        public void Load_SlotAcceptsNeitherTagNorObject_Throws()
        {
            const string yaml = @"
object_defs:
  cauldron3:
    slots:
      ingredients:
        accepts:
          - {max: 1}
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("いずれかが必要です"));
        }

        // ------------------------------------------------------------------
        // on_overflow
        // ------------------------------------------------------------------

        [Test]
        public void Load_OnOverflowWithoutRange_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void Load_ParsesOnOverflowAndAppliesItAtRuntime()
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
            var codex = new WorldCodexYamlLoader().Load("clock.yaml", yaml).Build();

            ObjectDef clock = codex.Objects.Get(codex.ObjectNames.GetId("clock"));
            Assert.That(PropOf(codex, clock, "minute").OnOverflow.Sets[ReferenceRoot.Self].Count, Is.EqualTo(1));
            Assert.That(PropOf(codex, clock, "minute").OnOverflow.Adds[ReferenceRoot.Self].Count, Is.EqualTo(1));

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, clock);
            instance.SetProperty(codex.PropertyNames.GetId("minute"), 60); // 手動で溢れさせる
            instance.Tick(session); // accumulate契機は無いが、既に溢れているのでon_overflowだけが発火する

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("minute")), Is.EqualTo(0));
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("hour")), Is.EqualTo(1));
        }

        [Test]
        public void Load_OnOverflowWithNonSelfTarget_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_overflow"));
        }

        [Test]
        public void Load_OnOverflowOmitted_DefaultsToClampingSelfToMax()
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
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef gauge = codex.Objects.Get(codex.ObjectNames.GetId("gauge"));
            Assert.That(PropOf(codex, gauge, "value").OnOverflow, Is.Not.Null);

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, gauge);
            instance.SetProperty(codex.PropertyNames.GetId("value"), 150);
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("value")), Is.EqualTo(100), "既定のon_overflowにより100へクランプされる");
        }

        // ------------------------------------------------------------------
        // on_shortfall（on_overflowの下限側の鏡像）
        // ------------------------------------------------------------------

        [Test]
        public void Load_OnShortfallWithoutRange_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("range"));
        }

        [Test]
        public void Load_OnShortfallWithNonSelfTarget_Throws()
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
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("on_shortfall"));
        }

        [Test]
        public void Load_ParsesOnShortfallAndAppliesItAtRuntime()
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
            var codex = new WorldCodexYamlLoader().Load("clock.yaml", yaml).Build();

            ObjectDef clock = codex.Objects.Get(codex.ObjectNames.GetId("clock"));
            Assert.That(PropOf(codex, clock, "minute").OnShortfall.Adds[ReferenceRoot.Self].Count, Is.EqualTo(2));

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, clock);
            instance.SetProperty(codex.PropertyNames.GetId("minute"), -10); // 手動で下回らせる
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("minute")), Is.EqualTo(50));
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("hour")), Is.EqualTo(0));
        }

        [Test]
        public void Load_OnShortfallOmitted_DefaultsToClampingSelfToMin()
        {
            const string yaml = @"
object_defs:
  gauge:
    props:
      value:
        value: 10
        range: {min: 0, max: 100}
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

            ObjectDef gauge = codex.Objects.Get(codex.ObjectNames.GetId("gauge"));
            Assert.That(PropOf(codex, gauge, "value").OnShortfall, Is.Not.Null);

            var session = new WorldSession(codex);
            var instance = new WorldObject(1, gauge);
            instance.SetProperty(codex.PropertyNames.GetId("value"), -50);
            instance.Tick(session);

            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("value")), Is.EqualTo(0), "既定のon_shortfallにより0へクランプされる");
        }

        [Test]
        public void Load_ConditionAncestorRoot_SkipsNonDefiningAncestorToFindNearestDefiner()
        {
            const string yaml = @"
object_defs:
  room:
    props:
      weather:
        value: 1
    slots:
      contents: {}
  character:
    slots:
      pocket: {}
  food:
    actions:
      check:
        conditions:
          - {object: ancestor, prop: weather, op: eq, value: 1}
        destroy: self
";
            var codex = new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();
            int contentsSlotId = codex.SlotNames.GetId("contents");
            int pocketSlotId = codex.SlotNames.GetId("pocket");

            var session = new WorldSession(codex);
            var roomInstance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("room")));
            var characterInstance = new WorldObject(2, codex.Objects.Get(codex.ObjectNames.GetId("character")));
            var foodInstance = new WorldObject(3, codex.Objects.Get(codex.ObjectNames.GetId("food")));

            Assert.That(characterInstance.MoveToSlot(roomInstance, contentsSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(foodInstance.MoveToSlot(characterInstance, pocketSlotId, codex.WellKnown, out _), Is.True);

            Assert.That(InteractionExecutor.TryExecuteAction(foodInstance, actor: null, "check", session), Is.True,
                "characterはweatherを持たないため素通りし、roomのweather(1)と比較して真になる");
        }

        [Test]
        public void Load_DestroyTargetAncestor_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        destroy: ancestor
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("ancestor"));
        }

        [Test]
        public void Load_ConditionInSlotWithAncestorObject_Throws()
        {
            const string yaml = @"
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: ancestor, in_slot: somewhere}
        destroy: self
";
            Assert.That((Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build()),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("ancestor"));
        }
    }
}

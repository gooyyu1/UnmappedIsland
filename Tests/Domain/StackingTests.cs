using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// アイテムのスタック表示（Slot.Contentsの並び順・SlotDefのStackable/UnitCapacity/FixedPositions・
    /// ObjectDef.StackOrder・same_slotとの相互作用）に対する自動テスト。YAMLパーサ経由でWorldCodexを
    /// 組み立てて検証する（YamlLoaderTests.csと同じ方針）。
    /// </summary>
    [TestFixture]
    public class StackingTests
    {
        private int nextInstanceId;

        [SetUp]
        public void SetUp()
        {
            nextInstanceId = 1;
        }

        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def, new WorldSession(codex));
        }

        // ------------------------------------------------------------------
        // ObjectDef.StackOrder: 同種のrun内で「手前に重ねたいものほど末尾」に並ぶこと
        // ------------------------------------------------------------------

        [Test]
        public void AddInternal_SortsWithinRunSoThatMostUrgentEndsLast()
        {
            const string yaml = @"
object_defs:
  ground:
    slots:
      pile: {}
  log:
    props:
      life:
        value: 0
    # 寿命(life)が短いものほど末尾(=手前に重なる)にしたいので ascending: false
    stack_order:
      property: life
      ascending: false
";
            var codex = Load(yaml);
            int lifeId = codex.PropertyNames.GetId("life");
            int pileSlotId = codex.SlotNames.GetId("pile");

            WorldObject groundInstance = Spawn(codex, "ground");

            WorldObject log10 = Spawn(codex, "log");
            log10.SetProperty(lifeId, 10);
            WorldObject log5 = Spawn(codex, "log");
            log5.SetProperty(lifeId, 5);
            WorldObject log20 = Spawn(codex, "log");
            log20.SetProperty(lifeId, 20);

            log10.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);
            log5.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);
            log20.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);

            groundInstance.TryGetSlot(pileSlotId, out Slot pile);

            Assert.That(pile.Contents.Select(o => o.InstanceId),
                Is.EqualTo(new[] { log20.InstanceId, log10.InstanceId, log5.InstanceId }),
                "life値の大きい順(20,10,5)に並び、最も寿命が短い(5)が末尾(=手前)に来る");
        }

        [Test]
        public void GetStacks_GroupsContiguousSameTypeRuns()
        {
            const string yaml = @"
object_defs:
  ground2:
    slots:
      pile: {}
  wood: {}
  rock: {}
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");

            WorldObject groundInstance = Spawn(codex, "ground2");
            WorldObject wood1 = Spawn(codex, "wood");
            WorldObject wood2 = Spawn(codex, "wood");
            WorldObject rock1 = Spawn(codex, "rock");

            wood1.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);
            wood2.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);
            rock1.MoveToSlot(groundInstance, pileSlotId, codex.WellKnown, out _);

            groundInstance.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.Cells;

            Assert.That(stacks.Count, Is.EqualTo(2));
            Assert.That(stacks[0].Def.Name, Is.EqualTo("wood"));
            Assert.That(stacks[0].Members.Count, Is.EqualTo(2));
            Assert.That(stacks[1].Def.Name, Is.EqualTo("rock"));
            Assert.That(stacks[1].Members.Count, Is.EqualTo(1));
        }

        // ------------------------------------------------------------------
        // same_slot とリスト順の関係
        // ------------------------------------------------------------------

        [Test]
        public void SameSlot_WithDestroy_ReplacesExactPositionAmongDifferentTypes()
        {
            const string yaml = @"
object_defs:
  loc_abc:
    slots:
      pile: {}
  a_item: {}
  c_item: {}
  d_item: {}
  b_item:
    props:
      life:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: d_item
            into: same_slot
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_abc");
            WorldObject aInstance = Spawn(codex, "a_item");
            WorldObject bInstance = Spawn(codex, "b_item");
            WorldObject cInstance = Spawn(codex, "c_item");

            aInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            bInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            cInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);

            locInstance.Tick(session);

            locInstance.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Contents.Select(o => o.Def.Name), Is.EqualTo(new[] { "a_item", "d_item", "c_item" }),
                "A B C の B が D に置き換わっても A・C の位置はずれず、A D C になる");
        }

        [Test]
        public void SameSlot_WithDestroy_ReplacesExactPositionWithinStack()
        {
            const string yaml = @"
object_defs:
  loc_abbc:
    slots:
      pile: {}
  a_item2: {}
  c_item2: {}
  d_item2: {}
  b_item2:
    props:
      life:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: d_item2
            into: same_slot
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int lifeId = codex.PropertyNames.GetId("life");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_abbc");
            WorldObject aInstance = Spawn(codex, "a_item2");
            WorldObject bInstance1 = Spawn(codex, "b_item2"); // 生き残る方
            WorldObject bInstance2 = Spawn(codex, "b_item2"); // life=0 になり置き換わる方
            WorldObject cInstance = Spawn(codex, "c_item2");

            aInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            bInstance1.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            bInstance2.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            cInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);

            // bInstance1 は on_min が発火しないよう life を残す（bInstance2 のみ 0 のまま）。
            bInstance1.SetProperty(lifeId, 5);

            locInstance.Tick(session);

            locInstance.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "a_item2", "b_item2", "d_item2", "c_item2" }),
                "A B B C の(末尾側の)Bが D に置き換わると、残るBの位置はそのままで A B D C になる");
        }

        [Test]
        public void SameSlot_WithoutDestroy_InsertsImmediatelyAfterSelf()
        {
            const string yaml = @"
object_defs:
  loc_grow:
    slots:
      pile: {}
  a_item3: {}
  c_item3: {}
  d_item3: {}
  b_item3:
    props:
      life:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: d_item3
            into: same_slot
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_grow");
            WorldObject aInstance = Spawn(codex, "a_item3");
            WorldObject bInstance = Spawn(codex, "b_item3");
            WorldObject cInstance = Spawn(codex, "c_item3");

            aInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            bInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);
            cInstance.MoveToSlot(locInstance, pileSlotId, session.Codex.WellKnown, out _);

            locInstance.Tick(session);

            locInstance.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Contents.Select(o => o.Def.Name), Is.EqualTo(new[] { "a_item3", "b_item3", "d_item3", "c_item3" }),
                "destroyを伴わない場合、Bは残ったまま、DはBの直後に入る(A B D C)");
            Assert.That(bInstance.Parent, Is.Not.Null, "destroy: falseなのでB自身は破棄されない");
        }

        // ------------------------------------------------------------------
        // UnitCapacity / Stackable（かまど型: 非スタック・個数固定）
        // ------------------------------------------------------------------

        [Test]
        public void UnitCapacity_Stackable_LimitsDistinctTypesNotTotalCount()
        {
            const string yaml = @"
object_defs:
  hand_owner:
    slots:
      hand:
        stackable: true
        unit_capacity: 2
  apple_h: {}
  pebble_h: {}
  twig_h: {}
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");

            WorldObject handInstance = Spawn(codex, "hand_owner");

            WorldObject apple1 = Spawn(codex, "apple_h");
            WorldObject apple2 = Spawn(codex, "apple_h");
            WorldObject pebble1 = Spawn(codex, "pebble_h");
            WorldObject twig1 = Spawn(codex, "twig_h");

            Assert.That(apple1.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(apple2.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _), Is.True,
                "同種の追加はunit_capacityの種類数を消費しない");
            Assert.That(pebble1.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(twig1.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _), Is.False,
                "3種類目はunit_capacity(2)を超えるため拒否される");
        }

        [Test]
        public void UnitCapacity_NonStackable_LimitsIndividualCountEvenForSameType()
        {
            const string yaml = @"
object_defs:
  furnace:
    slots:
      intake:
        stackable: false
        unit_capacity: 2
  fuel: {}
";
            var codex = Load(yaml);
            int intakeSlotId = codex.SlotNames.GetId("intake");

            WorldObject furnaceInstance = Spawn(codex, "furnace");
            WorldObject fuel1 = Spawn(codex, "fuel");
            WorldObject fuel2 = Spawn(codex, "fuel");
            WorldObject fuel3 = Spawn(codex, "fuel");

            Assert.That(fuel1.MoveToSlot(furnaceInstance, intakeSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(fuel2.MoveToSlot(furnaceInstance, intakeSlotId, codex.WellKnown, out _), Is.True,
                "非stackableは同種でも個体ごとに枠を消費する");
            Assert.That(fuel3.MoveToSlot(furnaceInstance, intakeSlotId, codex.WellKnown, out _), Is.False,
                "同種であっても個数がunit_capacity(2)を超えるため3個目は拒否される");
        }

        // ------------------------------------------------------------------
        // FixedPositions（プレイヤー手持ち: 前詰めしない固定番号）
        // ------------------------------------------------------------------

        [Test]
        public void FixedPositions_AssignsLowestFreeIndexAndPreservesGapsOnRemoval()
        {
            const string yaml = @"
object_defs:
  hand_owner2:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  type_a: {}
  type_b: {}
  type_c: {}
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int typeAId = codex.ObjectNames.GetId("type_a");
            int typeBId = codex.ObjectNames.GetId("type_b");
            int typeCId = codex.ObjectNames.GetId("type_c");

            WorldObject handInstance = Spawn(codex, "hand_owner2");
            WorldObject a = Spawn(codex, "type_a");
            WorldObject b = Spawn(codex, "type_b");

            a.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _);
            b.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand2);
            Assert.That(hand2.GetGridIndex(typeAId), Is.EqualTo(0));
            Assert.That(hand2.GetGridIndex(typeBId), Is.EqualTo(1));

            a.Destroy(codex.WellKnown); // 0番が空く

            WorldObject c = Spawn(codex, "type_c");
            c.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _);

            Assert.That(hand2.GetGridIndex(typeBId), Is.EqualTo(1), "既存の型は前詰めされず番号を維持する");
            Assert.That(hand2.GetGridIndex(typeCId), Is.EqualTo(0), "新しい型は空いている最小番号(0)へ入る");
        }

        [Test]
        public void FixedPositions_TrySetManualPositionSwapsTwoTypes()
        {
            const string yaml = @"
object_defs:
  hand_owner3:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  type_a2: {}
  type_b2: {}
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int typeAId = codex.ObjectNames.GetId("type_a2");
            int typeBId = codex.ObjectNames.GetId("type_b2");

            WorldObject handInstance = Spawn(codex, "hand_owner3");
            WorldObject a = Spawn(codex, "type_a2");
            WorldObject b = Spawn(codex, "type_b2");

            a.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _);
            b.MoveToSlot(handInstance, handSlotId, codex.WellKnown, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand3);

            Assert.That(hand3.TrySetManualPosition(typeAId, 1), Is.True);
            Assert.That(hand3.GetGridIndex(typeAId), Is.EqualTo(1));
            Assert.That(hand3.GetGridIndex(typeBId), Is.EqualTo(0), "入れ替え先の型は元のtypeAの番号へ移る");
        }

        [Test]
        public void FixedPositions_SameSlotInheritsFreedGridIndex_WhenLastInstanceReplaced()
        {
            // potatoを「0番以外」（1番）に置き、置き換えの瞬間に0番が別途空いている状態を作る。
            // これにより、「元々の空き最小番号(0)」と「引き継いだ番号(1)」が異なる値になり、
            // 引き継ぎが実際に機能しているかどうかを区別できる（両方0番なら偶然の一致で検証にならない）。
            const string yaml = @"
object_defs:
  hand_owner4:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  filler_item: {}
  rotten_potato: {}
  potato:
    props:
      freshness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: rotten_potato
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int rottenId = codex.ObjectNames.GetId("rotten_potato");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner4");
            WorldObject fillerInstance = Spawn(codex, "filler_item"); // 0番を先に占有
            WorldObject potatoInstance = Spawn(codex, "potato"); // 1番に入る

            fillerInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            potatoInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            fillerInstance.Destroy(session.Codex.WellKnown); // 0番が空く（1番=potatoとは別に）

            handInstance.TryGetSlot(handSlotId, out Slot hand4);
            int potatoGridIndex = hand4.GetGridIndex(codex.ObjectNames.GetId("potato")).Value;
            Assert.That(potatoGridIndex, Is.EqualTo(1), "前提: potatoは1番のまま（0番が空いても前詰めされない）");

            handInstance.Tick(session);

            Assert.That(hand4.GetGridIndex(rottenId), Is.EqualTo(potatoGridIndex),
                "唯一のインスタンスが置き換わる場合、固定番号(1番)はそのまま新しい型へ引き継がれる" +
                "（空き最小番号である0番を新規に割り当てられるのではない）");
        }

        [Test]
        public void FixedPositions_SameSlotDoesNotInheritGridIndex_WhenOtherInstancesRemain()
        {
            const string yaml = @"
object_defs:
  hand_owner5:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  rotten_potato2: {}
  potato2:
    props:
      freshness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: rotten_potato2
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int potatoId = codex.ObjectNames.GetId("potato2");
            int rottenId = codex.ObjectNames.GetId("rotten_potato2");
            int freshnessId = codex.PropertyNames.GetId("freshness");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner5");
            WorldObject potato1 = Spawn(codex, "potato2"); // freshness=5のまま生き残る方
            WorldObject potato2 = Spawn(codex, "potato2"); // freshness=0のまま置き換わる方

            potato1.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            potato2.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            potato1.SetProperty(freshnessId, 5);

            handInstance.TryGetSlot(handSlotId, out Slot hand5);
            int potatoGridIndex = hand5.GetGridIndex(potatoId).Value;

            handInstance.Tick(session);

            Assert.That(hand5.GetGridIndex(potatoId), Is.EqualTo(potatoGridIndex), "残ったpotatoの番号は変わらない");
            Assert.That(hand5.GetGridIndex(rottenId), Is.Not.EqualTo(potatoGridIndex),
                "同種が残っている場合、新しい型は別の固定番号を新規に割り当てられる");
        }

        [Test]
        public void FixedPositions_SameSlotWithoutDestroy_InsertsAfterSelfShiftingLaterCellsAsNeeded()
        {
            // 「A _ B _」→ Aから(destroyなしで)Cが生まれる → 「A C B _」
            //           → Aから(destroyなしで)Dが生まれる → 「A D C B」（CとBがそれぞれ+1される）
            //           → Aから(destroyなしで)Eが生まれる → 入る場所が無いのでfallback
            const string yaml = @"
object_defs:
  hand_owner6:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  loc_fallback:
    slots:
      ground: {}
  type_b3: {}
  type_c3: {}
  type_d3: {}
  type_e3: {}
  type_a3:
    props:
      spawn_c:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_c3
            into: same_slot
      spawn_d:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_d3
            into: same_slot
      spawn_e:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_e3
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int groundSlotId = codex.SlotNames.GetId("ground");
            int spawnCId = codex.PropertyNames.GetId("spawn_c");
            int spawnDId = codex.PropertyNames.GetId("spawn_d");
            int spawnEId = codex.PropertyNames.GetId("spawn_e");
            int aTypeId = codex.ObjectNames.GetId("type_a3");
            int bTypeId = codex.ObjectNames.GetId("type_b3");
            int cTypeId = codex.ObjectNames.GetId("type_c3");
            int dTypeId = codex.ObjectNames.GetId("type_d3");

            var session = new WorldSession(codex);
            WorldObject locationInstance = Spawn(codex, "loc_fallback");
            WorldObject handInstance = Spawn(codex, "hand_owner6");
            handInstance.MoveToSlot(locationInstance, groundSlotId, session.Codex.WellKnown, out _);

            WorldObject aInstance = Spawn(codex, "type_a3");
            WorldObject bInstance = Spawn(codex, "type_b3");
            aInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _); // grid 0
            bInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _); // grid 1

            handInstance.TryGetSlot(handSlotId, out Slot hand6);
            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(1), "前提: A(0) _ B(1)... ではなくA(0) B(1)の状態からBを2番へ動かす");

            // 前提を「A _ B _」（A=0, B=2）に合わせるため、Bを手動で2番へ動かす。
            Assert.That(hand6.TrySetManualPosition(bTypeId, 2), Is.True);
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(2));

            // --- Cが生まれる: 期待 A(0) C(1) B(2) _(3) ---
            aInstance.SetProperty(spawnCId, 0);
            handInstance.Tick(session);
            aInstance.SetProperty(spawnCId, 1); // 再発火を防ぐ

            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(cTypeId), Is.EqualTo(1), "空いている1番へそのまま入る（ずれ無し）");
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(2), "Bの番号は変わらない");

            // --- Dが生まれる: 期待 A(0) D(1) C(2) B(3) ---
            aInstance.SetProperty(spawnDId, 0);
            handInstance.Tick(session);
            aInstance.SetProperty(spawnDId, 1);

            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(dTypeId), Is.EqualTo(1), "Dは1番に割り込む");
            Assert.That(hand6.GetGridIndex(cTypeId), Is.EqualTo(2), "Cは押し出されて2番になる");
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(3), "Bも押し出されて3番になる");

            handInstance.TryGetSlot(handSlotId, out Slot handAfterD);
            Assert.That(handAfterD.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "type_a3", "type_d3", "type_c3", "type_b3" }),
                "Contentsの並び順もA D C Bになっている");

            // --- Eが生まれる: 4枠すべて埋まっており入る場所が無いのでfallback ---
            aInstance.SetProperty(spawnEId, 0);
            handInstance.Tick(session);

            Assert.That(hand6.Contents.Any(o => o.Def.Name == "type_e3"), Is.False, "handには入らない");
            locationInstance.TryGetSlot(groundSlotId, out Slot ground);
            Assert.That(ground.Contents.Any(o => o.Def.Name == "type_e3"), Is.True,
                "handの親(location)へforceで強制的に伝播している");
        }

        [Test]
        public void FixedPositions_SameSlotWithoutDestroy_StackableSameTypeJoinsExistingCellWithoutOverflow()
        {
            const string yaml = @"
object_defs:
  hand_owner7:
    slots:
      hand:
        stackable: true
        unit_capacity: 1
        fixed_positions: true
  type_a4:
    props:
      spawn_a:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_a4
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int aTypeId = codex.ObjectNames.GetId("type_a4");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner7");
            WorldObject aInstance = Spawn(codex, "type_a4");
            aInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand7);
            Assert.That(hand7.GetGridIndex(aTypeId), Is.EqualTo(0));

            // unit_capacity=1なので、別の型なら絶対に入らないが、同種のスタックへの合流は
            // 新しい固定番号を消費しないため、あふれずに成功するはず。
            handInstance.Tick(session);

            Assert.That(hand7.Contents.Count(o => o.Def.Name == "type_a4"), Is.EqualTo(2),
                "同種はunit_capacity(1)を超えず、既存のグリッドへ合流する");
            Assert.That(hand7.GetGridIndex(aTypeId), Is.EqualTo(0), "固定番号は変わらない");
        }

        [Test]
        public void FixedPositions_SameSlotFallsBackLeftward_WhenNoRoomOnTheRight()
        {
            // 「_ _ A B」→ Aから(destroyなしで)Cが生まれる → 「_ C A B」（右に空きが無いので左へ）
            //           → Bから(destroyなしで)Dが生まれる → 「C A D B」（Cのさらに左は無いのでCとAを
            //              1つずつ左へ押し出して割り込ませる）
            const string yaml = @"
object_defs:
  hand_owner8:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  type_c4: {}
  type_d4: {}
  type_a5:
    props:
      spawn_c:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_c4
            into: same_slot
  type_b5:
    props:
      spawn_d:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_d4
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int spawnCId = codex.PropertyNames.GetId("spawn_c");
            int spawnDId = codex.PropertyNames.GetId("spawn_d");
            int aTypeId = codex.ObjectNames.GetId("type_a5");
            int bTypeId = codex.ObjectNames.GetId("type_b5");
            int cTypeId = codex.ObjectNames.GetId("type_c4");
            int dTypeId = codex.ObjectNames.GetId("type_d4");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner8");
            WorldObject aInstance = Spawn(codex, "type_a5");
            WorldObject bInstance = Spawn(codex, "type_b5");
            aInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            bInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand8);
            // 前提を「_ _ A B」（A=2, B=3）に合わせる。
            Assert.That(hand8.TrySetManualPosition(aTypeId, 2), Is.True);
            Assert.That(hand8.TrySetManualPosition(bTypeId, 3), Is.True);

            // --- Cが生まれる: 期待 _ C A B ---
            aInstance.SetProperty(spawnCId, 0);
            handInstance.Tick(session);
            aInstance.SetProperty(spawnCId, 1);

            Assert.That(hand8.GetGridIndex(cTypeId), Is.EqualTo(1), "右(3番)はBで埋まっているため、左の空き(1番)へ入る");
            Assert.That(hand8.GetGridIndex(aTypeId), Is.EqualTo(2), "Aの番号は変わらない");
            Assert.That(hand8.GetGridIndex(bTypeId), Is.EqualTo(3), "Bの番号も変わらない");

            // --- Dが生まれる: 期待 C A D B ---
            bInstance.SetProperty(spawnDId, 0);
            handInstance.Tick(session);

            Assert.That(hand8.GetGridIndex(cTypeId), Is.EqualTo(0), "Cはさらに左へ押し出される");
            Assert.That(hand8.GetGridIndex(aTypeId), Is.EqualTo(1), "Aも左へ押し出される");
            Assert.That(hand8.GetGridIndex(dTypeId), Is.EqualTo(2), "Dは2番に割り込む");
            Assert.That(hand8.GetGridIndex(bTypeId), Is.EqualTo(3), "Bの番号は変わらない");

            Assert.That(hand8.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "type_c4", "type_a5", "type_d4", "type_b5" }),
                "Contentsの並び順もC A D Bになっている");
        }

        [Test]
        public void FixedPositions_LeftwardShift_PreservesMultiInstanceStacksBeingPushedAside()
        {
            // 押し出される型がスタック（同種複数個）であっても、その中身がバラけたり
            // 個数が変化したりしないことを確認する。
            const string yaml = @"
object_defs:
  hand_owner9:
    slots:
      hand:
        stackable: true
        unit_capacity: 4
        fixed_positions: true
  type_c5: {}
  type_d5: {}
  type_a6: {}
  type_b6:
    props:
      spawn_d:
        value: 1
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: type_d5
            into: same_slot
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int spawnDId = codex.PropertyNames.GetId("spawn_d");
            int aTypeId = codex.ObjectNames.GetId("type_a6");
            int bTypeId = codex.ObjectNames.GetId("type_b6");
            int cTypeId = codex.ObjectNames.GetId("type_c5");
            int dTypeId = codex.ObjectNames.GetId("type_d5");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner9");
            WorldObject c1 = Spawn(codex, "type_c5");
            WorldObject c2 = Spawn(codex, "type_c5"); // Cは2個のスタック
            WorldObject aInstance = Spawn(codex, "type_a6");
            WorldObject bInstance = Spawn(codex, "type_b6");

            c1.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            c2.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _); // 既存のCスタックへ合流
            aInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);
            bInstance.MoveToSlot(handInstance, handSlotId, session.Codex.WellKnown, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand9);
            // 前提を「_ C(x2) A B」（C=1, A=2, B=3）に合わせる。
            Assert.That(hand9.TrySetManualPosition(cTypeId, 1), Is.True);
            Assert.That(hand9.TrySetManualPosition(aTypeId, 2), Is.True);
            Assert.That(hand9.TrySetManualPosition(bTypeId, 3), Is.True);
            Assert.That(hand9.Contents.Count(o => o.Def.GlobalId == cTypeId), Is.EqualTo(2));

            // Bから(destroyなしで)Dが生まれる: 右(4番)は存在せず、左は「A(2)」で埋まっているため、
            // さらに左の空き(0番)まで探し、C・Aをそれぞれ1つずつ左へ押し出してDが2番に割り込む。
            bInstance.SetProperty(spawnDId, 0);
            handInstance.Tick(session);

            Assert.That(hand9.GetGridIndex(cTypeId), Is.EqualTo(0), "Cのスタックごと左へ押し出される");
            Assert.That(hand9.GetGridIndex(aTypeId), Is.EqualTo(1), "Aも左へ押し出される");
            Assert.That(hand9.GetGridIndex(dTypeId), Is.EqualTo(2), "Dは2番に割り込む");
            Assert.That(hand9.GetGridIndex(bTypeId), Is.EqualTo(3), "Bの番号は変わらない");

            Assert.That(hand9.Contents.Count(o => o.Def.GlobalId == cTypeId), Is.EqualTo(2), "押し出されてもCのスタックの個数は変わらない");
            Assert.That(hand9.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "type_c5", "type_c5", "type_a6", "type_d5", "type_b6" }),
                "Cの2個は連続したまま、A D Bと続く");
        }
    }
}

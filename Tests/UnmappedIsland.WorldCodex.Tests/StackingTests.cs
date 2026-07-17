using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// アイテムのスタック表示（Slot.Contentsの並び順・SlotDefのStackable/UnitCapacity/FixedPositions・
    /// ObjectDef.StackOrder・same_slotとの相互作用）に対する自動テスト。
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

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def);
        }

        private static PropertyBlueprint Prop(string name, int defaultValue, ActiveEffectBlueprint onZero = null) =>
            new PropertyBlueprint { Name = name, DefaultValue = PropertyValue.FromNumber(defaultValue), OnZero = onZero };

        private static SlotBlueprint Slot(
            string name, bool stackable = true, int? unitCapacity = null, bool fixedPositions = false)
        {
            return new SlotBlueprint
            {
                Name = name,
                Stackable = stackable,
                UnitCapacity = unitCapacity,
                FixedPositions = fixedPositions,
            };
        }

        private static ActiveEffectBlueprint OnZeroSpawn(
            string spawnObjectName, bool destroy, SpawnTargetRoot into = SpawnTargetRoot.SameSlot)
        {
            var bp = new ActiveEffectBlueprint { Spawn = new SpawnBlueprint { ObjectName = spawnObjectName, Into = into } };
            if (destroy) bp.Destroy.Add(ReferenceRoot.Self);
            return bp;
        }

        // ------------------------------------------------------------------
        // ObjectDef.StackOrder: 同種のrun内で「手前に重ねたいものほど末尾」に並ぶこと
        // ------------------------------------------------------------------

        [Test]
        public void AddInternal_SortsWithinRunSoThatMostUrgentEndsLast()
        {
            var ground = new ObjectDefBlueprint { Name = "ground" };
            ground.Slots.Add(Slot("pile"));

            var log = new ObjectDefBlueprint { Name = "log" };
            log.Properties.Add(Prop("life", 0));
            // 寿命(life)が短いものほど末尾(=手前に重なる)にしたいので Ascending=false
            log.StackOrder = new StackOrderBlueprint { PropertyName = "life", Ascending = false };

            var codex = WorldCodexBuilder.Build(new[] { ground, log });
            int lifeId = codex.PropertyNames.GetId("life");
            int pileSlotId = codex.SlotNames.GetId("pile");

            Containment containment = codex.CreateContainment();
            WorldObject groundInstance = Spawn(codex, "ground");

            WorldObject log10 = Spawn(codex, "log");
            log10.SetProperty(lifeId, PropertyValue.FromNumber(10));
            WorldObject log5 = Spawn(codex, "log");
            log5.SetProperty(lifeId, PropertyValue.FromNumber(5));
            WorldObject log20 = Spawn(codex, "log");
            log20.SetProperty(lifeId, PropertyValue.FromNumber(20));

            containment.TryMoveToSlot(log10, groundInstance, pileSlotId, out _);
            containment.TryMoveToSlot(log5, groundInstance, pileSlotId, out _);
            containment.TryMoveToSlot(log20, groundInstance, pileSlotId, out _);

            groundInstance.TryGetSlot(pileSlotId, out Slot pile);

            Assert.That(pile.Contents.Select(o => o.InstanceId),
                Is.EqualTo(new[] { log20.InstanceId, log10.InstanceId, log5.InstanceId }),
                "life値の大きい順(20,10,5)に並び、最も寿命が短い(5)が末尾(=手前)に来る");
        }

        [Test]
        public void GetStacks_GroupsContiguousSameTypeRuns()
        {
            var ground = new ObjectDefBlueprint { Name = "ground2" };
            ground.Slots.Add(Slot("pile"));

            var wood = new ObjectDefBlueprint { Name = "wood" };
            var rock = new ObjectDefBlueprint { Name = "rock" };

            var codex = WorldCodexBuilder.Build(new[] { ground, wood, rock });
            int pileSlotId = codex.SlotNames.GetId("pile");

            Containment containment = codex.CreateContainment();
            WorldObject groundInstance = Spawn(codex, "ground2");
            WorldObject wood1 = Spawn(codex, "wood");
            WorldObject wood2 = Spawn(codex, "wood");
            WorldObject rock1 = Spawn(codex, "rock");

            containment.TryMoveToSlot(wood1, groundInstance, pileSlotId, out _);
            containment.TryMoveToSlot(wood2, groundInstance, pileSlotId, out _);
            containment.TryMoveToSlot(rock1, groundInstance, pileSlotId, out _);

            groundInstance.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.GetStacks();

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
            var location = new ObjectDefBlueprint { Name = "loc_abc" };
            location.Slots.Add(Slot("pile"));

            var a = new ObjectDefBlueprint { Name = "a_item" };
            var c = new ObjectDefBlueprint { Name = "c_item" };
            var d = new ObjectDefBlueprint { Name = "d_item" };

            var b = new ObjectDefBlueprint { Name = "b_item" };
            b.Properties.Add(Prop("life", 0, onZero: OnZeroSpawn("d_item", destroy: true)));

            var codex = WorldCodexBuilder.Build(new[] { location, a, b, c, d });
            int pileSlotId = codex.SlotNames.GetId("pile");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_abc");
            WorldObject aInstance = Spawn(codex, "a_item");
            WorldObject bInstance = Spawn(codex, "b_item");
            WorldObject cInstance = Spawn(codex, "c_item");

            session.Containment.TryMoveToSlot(aInstance, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(cInstance, locInstance, pileSlotId, out _);

            locInstance.Tick(session);

            locInstance.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Contents.Select(o => o.Def.Name), Is.EqualTo(new[] { "a_item", "d_item", "c_item" }),
                "A B C の B が D に置き換わっても A・C の位置はずれず、A D C になる");
        }

        [Test]
        public void SameSlot_WithDestroy_ReplacesExactPositionWithinStack()
        {
            var location = new ObjectDefBlueprint { Name = "loc_abbc" };
            location.Slots.Add(Slot("pile"));

            var a = new ObjectDefBlueprint { Name = "a_item2" };
            var c = new ObjectDefBlueprint { Name = "c_item2" };
            var d = new ObjectDefBlueprint { Name = "d_item2" };

            var b = new ObjectDefBlueprint { Name = "b_item2" };
            b.Properties.Add(Prop("life", 0, onZero: OnZeroSpawn("d_item2", destroy: true)));

            var codex = WorldCodexBuilder.Build(new[] { location, a, b, c, d });
            int pileSlotId = codex.SlotNames.GetId("pile");
            int lifeId = codex.PropertyNames.GetId("life");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_abbc");
            WorldObject aInstance = Spawn(codex, "a_item2");
            WorldObject bInstance1 = Spawn(codex, "b_item2"); // 生き残る方
            WorldObject bInstance2 = Spawn(codex, "b_item2"); // life=0 になり置き換わる方
            WorldObject cInstance = Spawn(codex, "c_item2");

            session.Containment.TryMoveToSlot(aInstance, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance1, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance2, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(cInstance, locInstance, pileSlotId, out _);

            // bInstance1 は on_zero が発火しないよう life を残す（bInstance2 のみ 0 のまま）。
            bInstance1.SetProperty(lifeId, PropertyValue.FromNumber(5));

            locInstance.Tick(session);

            locInstance.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "a_item2", "b_item2", "d_item2", "c_item2" }),
                "A B B C の(末尾側の)Bが D に置き換わると、残るBの位置はそのままで A B D C になる");
        }

        [Test]
        public void SameSlot_WithoutDestroy_InsertsImmediatelyAfterSelf()
        {
            var location = new ObjectDefBlueprint { Name = "loc_grow" };
            location.Slots.Add(Slot("pile"));

            var a = new ObjectDefBlueprint { Name = "a_item3" };
            var c = new ObjectDefBlueprint { Name = "c_item3" };
            var d = new ObjectDefBlueprint { Name = "d_item3" };

            var b = new ObjectDefBlueprint { Name = "b_item3" };
            b.Properties.Add(Prop("life", 0, onZero: OnZeroSpawn("d_item3", destroy: false)));

            var codex = WorldCodexBuilder.Build(new[] { location, a, b, c, d });
            int pileSlotId = codex.SlotNames.GetId("pile");

            var session = new WorldSession(codex);
            WorldObject locInstance = Spawn(codex, "loc_grow");
            WorldObject aInstance = Spawn(codex, "a_item3");
            WorldObject bInstance = Spawn(codex, "b_item3");
            WorldObject cInstance = Spawn(codex, "c_item3");

            session.Containment.TryMoveToSlot(aInstance, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance, locInstance, pileSlotId, out _);
            session.Containment.TryMoveToSlot(cInstance, locInstance, pileSlotId, out _);

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
            var hand = new ObjectDefBlueprint { Name = "hand_owner" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 2));

            var apple = new ObjectDefBlueprint { Name = "apple_h" };
            var pebble = new ObjectDefBlueprint { Name = "pebble_h" };
            var twig = new ObjectDefBlueprint { Name = "twig_h" };

            var codex = WorldCodexBuilder.Build(new[] { hand, apple, pebble, twig });
            int handSlotId = codex.SlotNames.GetId("hand");

            Containment containment = codex.CreateContainment();
            WorldObject handInstance = Spawn(codex, "hand_owner");

            WorldObject apple1 = Spawn(codex, "apple_h");
            WorldObject apple2 = Spawn(codex, "apple_h");
            WorldObject pebble1 = Spawn(codex, "pebble_h");
            WorldObject twig1 = Spawn(codex, "twig_h");

            Assert.That(containment.TryMoveToSlot(apple1, handInstance, handSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(apple2, handInstance, handSlotId, out _), Is.True,
                "同種の追加はunit_capacityの種類数を消費しない");
            Assert.That(containment.TryMoveToSlot(pebble1, handInstance, handSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(twig1, handInstance, handSlotId, out _), Is.False,
                "3種類目はunit_capacity(2)を超えるため拒否される");
        }

        [Test]
        public void UnitCapacity_NonStackable_LimitsIndividualCountEvenForSameType()
        {
            var furnace = new ObjectDefBlueprint { Name = "furnace" };
            furnace.Slots.Add(Slot("intake", stackable: false, unitCapacity: 2));

            var fuel = new ObjectDefBlueprint { Name = "fuel" };

            var codex = WorldCodexBuilder.Build(new[] { furnace, fuel });
            int intakeSlotId = codex.SlotNames.GetId("intake");

            Containment containment = codex.CreateContainment();
            WorldObject furnaceInstance = Spawn(codex, "furnace");
            WorldObject fuel1 = Spawn(codex, "fuel");
            WorldObject fuel2 = Spawn(codex, "fuel");
            WorldObject fuel3 = Spawn(codex, "fuel");

            Assert.That(containment.TryMoveToSlot(fuel1, furnaceInstance, intakeSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(fuel2, furnaceInstance, intakeSlotId, out _), Is.True,
                "非stackableは同種でも個体ごとに枠を消費する");
            Assert.That(containment.TryMoveToSlot(fuel3, furnaceInstance, intakeSlotId, out _), Is.False,
                "同種であっても個数がunit_capacity(2)を超えるため3個目は拒否される");
        }

        // ------------------------------------------------------------------
        // FixedPositions（プレイヤー手持ち: 前詰めしない固定番号）
        // ------------------------------------------------------------------

        [Test]
        public void FixedPositions_AssignsLowestFreeIndexAndPreservesGapsOnRemoval()
        {
            var hand = new ObjectDefBlueprint { Name = "hand_owner2" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 3, fixedPositions: true));

            var typeA = new ObjectDefBlueprint { Name = "type_a" };
            var typeB = new ObjectDefBlueprint { Name = "type_b" };
            var typeC = new ObjectDefBlueprint { Name = "type_c" };

            var codex = WorldCodexBuilder.Build(new[] { hand, typeA, typeB, typeC });
            int handSlotId = codex.SlotNames.GetId("hand");
            int typeAId = codex.ObjectNames.GetId("type_a");
            int typeBId = codex.ObjectNames.GetId("type_b");
            int typeCId = codex.ObjectNames.GetId("type_c");

            Containment containment = codex.CreateContainment();
            WorldObject handInstance = Spawn(codex, "hand_owner2");
            WorldObject a = Spawn(codex, "type_a");
            WorldObject b = Spawn(codex, "type_b");

            containment.TryMoveToSlot(a, handInstance, handSlotId, out _);
            containment.TryMoveToSlot(b, handInstance, handSlotId, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand2);
            Assert.That(hand2.GetGridIndex(typeAId), Is.EqualTo(0));
            Assert.That(hand2.GetGridIndex(typeBId), Is.EqualTo(1));

            containment.Destroy(a); // 0番が空く

            WorldObject c = Spawn(codex, "type_c");
            containment.TryMoveToSlot(c, handInstance, handSlotId, out _);

            Assert.That(hand2.GetGridIndex(typeBId), Is.EqualTo(1), "既存の型は前詰めされず番号を維持する");
            Assert.That(hand2.GetGridIndex(typeCId), Is.EqualTo(0), "新しい型は空いている最小番号(0)へ入る");
        }

        [Test]
        public void FixedPositions_TrySetManualPositionSwapsTwoTypes()
        {
            var hand = new ObjectDefBlueprint { Name = "hand_owner3" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 3, fixedPositions: true));

            var typeA = new ObjectDefBlueprint { Name = "type_a2" };
            var typeB = new ObjectDefBlueprint { Name = "type_b2" };

            var codex = WorldCodexBuilder.Build(new[] { hand, typeA, typeB });
            int handSlotId = codex.SlotNames.GetId("hand");
            int typeAId = codex.ObjectNames.GetId("type_a2");
            int typeBId = codex.ObjectNames.GetId("type_b2");

            Containment containment = codex.CreateContainment();
            WorldObject handInstance = Spawn(codex, "hand_owner3");
            WorldObject a = Spawn(codex, "type_a2");
            WorldObject b = Spawn(codex, "type_b2");

            containment.TryMoveToSlot(a, handInstance, handSlotId, out _);
            containment.TryMoveToSlot(b, handInstance, handSlotId, out _);

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
            var hand = new ObjectDefBlueprint { Name = "hand_owner4" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 3, fixedPositions: true));

            var filler = new ObjectDefBlueprint { Name = "filler_item" };
            var rottenPotato = new ObjectDefBlueprint { Name = "rotten_potato" };

            var potato = new ObjectDefBlueprint { Name = "potato" };
            potato.Properties.Add(Prop("freshness", 0, onZero: OnZeroSpawn("rotten_potato", destroy: true)));

            var codex = WorldCodexBuilder.Build(new[] { hand, filler, potato, rottenPotato });
            int handSlotId = codex.SlotNames.GetId("hand");
            int rottenId = codex.ObjectNames.GetId("rotten_potato");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner4");
            WorldObject fillerInstance = Spawn(codex, "filler_item"); // 0番を先に占有
            WorldObject potatoInstance = Spawn(codex, "potato"); // 1番に入る

            session.Containment.TryMoveToSlot(fillerInstance, handInstance, handSlotId, out _);
            session.Containment.TryMoveToSlot(potatoInstance, handInstance, handSlotId, out _);
            session.Containment.Destroy(fillerInstance); // 0番が空く（1番=potatoとは別に）

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
            var hand = new ObjectDefBlueprint { Name = "hand_owner5" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 3, fixedPositions: true));

            var rottenPotato = new ObjectDefBlueprint { Name = "rotten_potato2" };

            var potato = new ObjectDefBlueprint { Name = "potato2" };
            potato.Properties.Add(Prop("freshness", 0, onZero: OnZeroSpawn("rotten_potato2", destroy: true)));

            var codex = WorldCodexBuilder.Build(new[] { hand, potato, rottenPotato });
            int handSlotId = codex.SlotNames.GetId("hand");
            int potatoId = codex.ObjectNames.GetId("potato2");
            int rottenId = codex.ObjectNames.GetId("rotten_potato2");
            int freshnessId = codex.PropertyNames.GetId("freshness");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner5");
            WorldObject potato1 = Spawn(codex, "potato2"); // freshness=5のまま生き残る方
            WorldObject potato2 = Spawn(codex, "potato2"); // freshness=0のまま置き換わる方

            session.Containment.TryMoveToSlot(potato1, handInstance, handSlotId, out _);
            session.Containment.TryMoveToSlot(potato2, handInstance, handSlotId, out _);
            potato1.SetProperty(freshnessId, PropertyValue.FromNumber(5));

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
            var hand = new ObjectDefBlueprint { Name = "hand_owner6" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 4, fixedPositions: true));

            var location = new ObjectDefBlueprint { Name = "loc_fallback" };
            location.Slots.Add(Slot("ground"));

            var b = new ObjectDefBlueprint { Name = "type_b3" };
            var c = new ObjectDefBlueprint { Name = "type_c3" };
            var d = new ObjectDefBlueprint { Name = "type_d3" };
            var e = new ObjectDefBlueprint { Name = "type_e3" };

            var a = new ObjectDefBlueprint { Name = "type_a3" };
            a.Properties.Add(Prop("spawn_c", 1, onZero: OnZeroSpawn("type_c3", destroy: false)));
            a.Properties.Add(Prop("spawn_d", 1, onZero: OnZeroSpawn("type_d3", destroy: false)));
            a.Properties.Add(Prop("spawn_e", 1, onZero: OnZeroSpawn("type_e3", destroy: false)));

            var codex = WorldCodexBuilder.Build(new[] { hand, location, a, b, c, d, e });
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
            session.Containment.TryMoveToSlot(handInstance, locationInstance, groundSlotId, out _);

            WorldObject aInstance = Spawn(codex, "type_a3");
            WorldObject bInstance = Spawn(codex, "type_b3");
            session.Containment.TryMoveToSlot(aInstance, handInstance, handSlotId, out _); // grid 0
            session.Containment.TryMoveToSlot(bInstance, handInstance, handSlotId, out _); // grid 1

            handInstance.TryGetSlot(handSlotId, out Slot hand6);
            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(1), "前提: A(0) _ B(1)... ではなくA(0) B(1)の状態からBを2番へ動かす");

            // 前提を「A _ B _」（A=0, B=2）に合わせるため、Bを手動で2番へ動かす。
            Assert.That(hand6.TrySetManualPosition(bTypeId, 2), Is.True);
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(2));

            // --- Cが生まれる: 期待 A(0) C(1) B(2) _(3) ---
            aInstance.SetProperty(spawnCId, PropertyValue.FromNumber(0));
            handInstance.Tick(session);
            aInstance.SetProperty(spawnCId, PropertyValue.FromNumber(1)); // 再発火を防ぐ

            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(cTypeId), Is.EqualTo(1), "空いている1番へそのまま入る（ずれ無し）");
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(2), "Bの番号は変わらない");

            // --- Dが生まれる: 期待 A(0) D(1) C(2) B(3) ---
            aInstance.SetProperty(spawnDId, PropertyValue.FromNumber(0));
            handInstance.Tick(session);
            aInstance.SetProperty(spawnDId, PropertyValue.FromNumber(1));

            Assert.That(hand6.GetGridIndex(aTypeId), Is.EqualTo(0));
            Assert.That(hand6.GetGridIndex(dTypeId), Is.EqualTo(1), "Dは1番に割り込む");
            Assert.That(hand6.GetGridIndex(cTypeId), Is.EqualTo(2), "Cは押し出されて2番になる");
            Assert.That(hand6.GetGridIndex(bTypeId), Is.EqualTo(3), "Bも押し出されて3番になる");

            handInstance.TryGetSlot(handSlotId, out Slot handAfterD);
            Assert.That(handAfterD.Contents.Select(o => o.Def.Name),
                Is.EqualTo(new[] { "type_a3", "type_d3", "type_c3", "type_b3" }),
                "Contentsの並び順もA D C Bになっている");

            // --- Eが生まれる: 4枠すべて埋まっており入る場所が無いのでfallback ---
            aInstance.SetProperty(spawnEId, PropertyValue.FromNumber(0));
            handInstance.Tick(session);

            Assert.That(hand6.Contents.Any(o => o.Def.Name == "type_e3"), Is.False, "handには入らない");
            locationInstance.TryGetSlot(groundSlotId, out Slot ground);
            Assert.That(ground.Contents.Any(o => o.Def.Name == "type_e3"), Is.True,
                "handの親(location)へforceで強制的に伝播している");
        }

        [Test]
        public void FixedPositions_SameSlotWithoutDestroy_StackableSameTypeJoinsExistingCellWithoutOverflow()
        {
            var hand = new ObjectDefBlueprint { Name = "hand_owner7" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 1, fixedPositions: true));

            var a = new ObjectDefBlueprint { Name = "type_a4" };
            a.Properties.Add(Prop("spawn_a", 0, onZero: OnZeroSpawn("type_a4", destroy: false)));

            var codex = WorldCodexBuilder.Build(new[] { hand, a });
            int handSlotId = codex.SlotNames.GetId("hand");
            int aTypeId = codex.ObjectNames.GetId("type_a4");

            var session = new WorldSession(codex);
            WorldObject handInstance = Spawn(codex, "hand_owner7");
            WorldObject aInstance = Spawn(codex, "type_a4");
            session.Containment.TryMoveToSlot(aInstance, handInstance, handSlotId, out _);

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
            var hand = new ObjectDefBlueprint { Name = "hand_owner8" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 4, fixedPositions: true));

            var c = new ObjectDefBlueprint { Name = "type_c4" };
            var d = new ObjectDefBlueprint { Name = "type_d4" };

            var a = new ObjectDefBlueprint { Name = "type_a5" };
            a.Properties.Add(Prop("spawn_c", 1, onZero: OnZeroSpawn("type_c4", destroy: false)));

            var b = new ObjectDefBlueprint { Name = "type_b5" };
            b.Properties.Add(Prop("spawn_d", 1, onZero: OnZeroSpawn("type_d4", destroy: false)));

            var codex = WorldCodexBuilder.Build(new[] { hand, a, b, c, d });
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
            session.Containment.TryMoveToSlot(aInstance, handInstance, handSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance, handInstance, handSlotId, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand8);
            // 前提を「_ _ A B」（A=2, B=3）に合わせる。
            Assert.That(hand8.TrySetManualPosition(aTypeId, 2), Is.True);
            Assert.That(hand8.TrySetManualPosition(bTypeId, 3), Is.True);

            // --- Cが生まれる: 期待 _ C A B ---
            aInstance.SetProperty(spawnCId, PropertyValue.FromNumber(0));
            handInstance.Tick(session);
            aInstance.SetProperty(spawnCId, PropertyValue.FromNumber(1));

            Assert.That(hand8.GetGridIndex(cTypeId), Is.EqualTo(1), "右(3番)はBで埋まっているため、左の空き(1番)へ入る");
            Assert.That(hand8.GetGridIndex(aTypeId), Is.EqualTo(2), "Aの番号は変わらない");
            Assert.That(hand8.GetGridIndex(bTypeId), Is.EqualTo(3), "Bの番号も変わらない");

            // --- Dが生まれる: 期待 C A D B ---
            bInstance.SetProperty(spawnDId, PropertyValue.FromNumber(0));
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
            var hand = new ObjectDefBlueprint { Name = "hand_owner9" };
            hand.Slots.Add(Slot("hand", stackable: true, unitCapacity: 4, fixedPositions: true));

            var c = new ObjectDefBlueprint { Name = "type_c5" };
            var d = new ObjectDefBlueprint { Name = "type_d5" };
            var a = new ObjectDefBlueprint { Name = "type_a6" };

            var b = new ObjectDefBlueprint { Name = "type_b6" };
            b.Properties.Add(Prop("spawn_d", 1, onZero: OnZeroSpawn("type_d5", destroy: false)));

            var codex = WorldCodexBuilder.Build(new[] { hand, a, b, c, d });
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

            session.Containment.TryMoveToSlot(c1, handInstance, handSlotId, out _);
            session.Containment.TryMoveToSlot(c2, handInstance, handSlotId, out _); // 既存のCスタックへ合流
            session.Containment.TryMoveToSlot(aInstance, handInstance, handSlotId, out _);
            session.Containment.TryMoveToSlot(bInstance, handInstance, handSlotId, out _);

            handInstance.TryGetSlot(handSlotId, out Slot hand9);
            // 前提を「_ C(x2) A B」（C=1, A=2, B=3）に合わせる。
            Assert.That(hand9.TrySetManualPosition(cTypeId, 1), Is.True);
            Assert.That(hand9.TrySetManualPosition(aTypeId, 2), Is.True);
            Assert.That(hand9.TrySetManualPosition(bTypeId, 3), Is.True);
            Assert.That(hand9.Contents.Count(o => o.Def.GlobalId == cTypeId), Is.EqualTo(2));

            // Bから(destroyなしで)Dが生まれる: 右(4番)は存在せず、左は「A(2)」で埋まっているため、
            // さらに左の空き(0番)まで探し、C・Aをそれぞれ1つずつ左へ押し出してDが2番に割り込む。
            bInstance.SetProperty(spawnDId, PropertyValue.FromNumber(0));
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

using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs.Tests
{
    /// <summary>
    /// stack_by（GameElementDefinition.md 7.6節）に対する自動テスト。同じObjectDefでも指定した
    /// プロパティの値が違えば別のObjectStackとしてまとまることを検証する（例: 中身の違う容器）。
    /// </summary>
    [TestFixture]
    public class StackByTests
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
            return new WorldObject(nextInstanceId++, def);
        }

        [Test]
        public void StackBy_GroupsBySharedPropertyValue_NotJustObjectDef()
        {
            const string yaml = @"
object_defs:
  bag_sb:
    slots:
      pile: {}
  jug:
    stack_by: content_id
    props:
      content_id:
        value: 0
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int contentId = codex.PropertyNames.GetId("content_id");

            WorldObject bag = Spawn(codex, "bag_sb");
            WorldObject emptyJug1 = Spawn(codex, "jug");
            WorldObject emptyJug2 = Spawn(codex, "jug");
            WorldObject waterJug = Spawn(codex, "jug");
            waterJug.SetProperty(contentId, PropertyValue.FromNumber(1));

            emptyJug1.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            emptyJug2.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            waterJug.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.GetStacks();

            Assert.That(stacks.Count, Is.EqualTo(2), "同じjugでも中身(content_id)が違えば別のObjectStackになる");
            Assert.That(stacks[0].Members.Count, Is.EqualTo(2), "中身が同じ(空)の2個は同じObjectStackにまとまる");
            Assert.That(stacks[1].Members.Count, Is.EqualTo(1), "中身が違う1個は独立したObjectStack");
        }

        [Test]
        public void StackBy_TraitLevelDeclaration_AppliesToObjectDefsUsingIt()
        {
            const string yaml = @"
traits:
  container:
    stack_by: content_id
    props:
      content_id:
        value: 0
object_defs:
  bag_sb2:
    slots:
      pile: {}
  pot_sb:
    traits: [container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int contentId = codex.PropertyNames.GetId("content_id");

            WorldObject bag = Spawn(codex, "bag_sb2");
            WorldObject pot1 = Spawn(codex, "pot_sb");
            WorldObject pot2 = Spawn(codex, "pot_sb");
            pot2.SetProperty(contentId, PropertyValue.FromNumber(1));

            pot1.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            pot2.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.GetStacks().Count, Is.EqualTo(2), "trait経由で宣言したstack_byも同様に効く");
        }

        [Test]
        public void StackBy_FixedPositions_DoesNotShareGridCellAcrossDifferentStackTypes()
        {
            const string yaml = @"
object_defs:
  hand_sb:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  jug2:
    stack_by: content_id
    props:
      content_id:
        value: 0
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");
            int contentId = codex.PropertyNames.GetId("content_id");

            WorldObject hand = Spawn(codex, "hand_sb");
            WorldObject emptyJug = Spawn(codex, "jug2");
            WorldObject waterJug = Spawn(codex, "jug2");
            waterJug.SetProperty(contentId, PropertyValue.FromNumber(1));

            emptyJug.MoveToSlot(hand, handSlotId, codex.WellKnown, out _);
            waterJug.MoveToSlot(hand, handSlotId, codex.WellKnown, out _);

            hand.TryGetSlot(handSlotId, out Slot handSlot);
            var stacks = handSlot.GetStacks();

            Assert.That(stacks.Count, Is.EqualTo(2), "中身が違うので、同じObjectDefでも別々のObjectStack(=別々の固定番号)になる");
            Assert.That(stacks.Select(s => s.GridIndex), Is.EquivalentTo(new int?[] { 0, 1 }),
                "スタックできない(合流できない)もの同士は同じ固定番号を共有できない");
        }
    }
}

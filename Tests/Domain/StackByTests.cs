using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// represented_by（GameElementDefinition.md 7.6節）に対する自動テスト。同じObjectDefでも、代表オブジェクト
    /// （さらにその代表…）が異なれば別のObjectStackになることを検証する。
    /// </summary>
    [TestFixture]
    public class RepresentedByTests
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

        private WorldObject SpawnRepresentedContainer(WorldCodex codex, string containerName, string contentName)
        {
            int contentSlotId = codex.SlotNames.GetId("content");
            WorldObject container = Spawn(codex, containerName);
            WorldObject content = Spawn(codex, contentName);
            content.MoveToSlot(container, contentSlotId, codex.WellKnown, out _);
            return container;
        }

        [Test]
        public void RepresentedBy_GroupsByRepresentedObjectDef_NotJustContainerDef()
        {
            const string yaml = @"
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_repr:
    slots:
      pile: {}
  empty_liquid:
    tags: [liquid]
  water_liquid:
    tags: [liquid]
  jug:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");

            WorldObject bag = Spawn(codex, "bag_repr");
            WorldObject emptyJug1 = SpawnRepresentedContainer(codex, "jug", "empty_liquid");
            WorldObject emptyJug2 = SpawnRepresentedContainer(codex, "jug", "empty_liquid");
            WorldObject waterJug = SpawnRepresentedContainer(codex, "jug", "water_liquid");

            emptyJug1.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            emptyJug2.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            waterJug.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.Cells;

            Assert.That(stacks.Count, Is.EqualTo(2), "同じjugでも represented_by 先のObjectDefが違えば別スタックになる");
            Assert.That(stacks[0].Members.Count, Is.EqualTo(2));
            Assert.That(stacks[1].Members.Count, Is.EqualTo(1));
        }

        [Test]
        public void RepresentedBy_RecursivelyDistinguishesRepresentedChains()
        {
            const string yaml = @"
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
  represented_liquid:
    represented_by: essence
    slots:
      essence:
        accepts: [{tag: essence, max: 1}]
object_defs:
  bag_repr2:
    slots:
      pile: {}
  sweet_essence:
    tags: [essence]
  bitter_essence:
    tags: [essence]
  broth:
    traits: [represented_liquid]
    tags: [liquid]
  bottle_repr:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int contentSlotId = codex.SlotNames.GetId("content");
            int essenceSlotId = codex.SlotNames.GetId("essence");

            WorldObject bag = Spawn(codex, "bag_repr2");

            WorldObject bottle1 = Spawn(codex, "bottle_repr");
            WorldObject bottle2 = Spawn(codex, "bottle_repr");
            WorldObject bottle3 = Spawn(codex, "bottle_repr");
            WorldObject broth1 = Spawn(codex, "broth");
            WorldObject broth2 = Spawn(codex, "broth");
            WorldObject broth3 = Spawn(codex, "broth");
            WorldObject sweet1 = Spawn(codex, "sweet_essence");
            WorldObject sweet2 = Spawn(codex, "sweet_essence");
            WorldObject bitter = Spawn(codex, "bitter_essence");

            broth1.MoveToSlot(bottle1, contentSlotId, codex.WellKnown, out _);
            broth2.MoveToSlot(bottle2, contentSlotId, codex.WellKnown, out _);
            broth3.MoveToSlot(bottle3, contentSlotId, codex.WellKnown, out _);
            sweet1.MoveToSlot(broth1, essenceSlotId, codex.WellKnown, out _);
            sweet2.MoveToSlot(broth2, essenceSlotId, codex.WellKnown, out _);
            bitter.MoveToSlot(broth3, essenceSlotId, codex.WellKnown, out _);

            bottle1.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            bottle2.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            bottle3.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.Cells;

            Assert.That(stacks.Count, Is.EqualTo(2), "代表の代表まで同じときだけ同じスタックにまとまる");
            Assert.That(stacks[0].Members.Count, Is.EqualTo(2));
            Assert.That(stacks[1].Members.Count, Is.EqualTo(1));
        }

        [Test]
        public void RepresentedBy_FixedPositions_DoesNotShareGridCellAcrossDifferentRepresentatives()
        {
            const string yaml = @"
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  hand_repr:
    slots:
      hand:
        stackable: true
        unit_capacity: 3
        fixed_positions: true
  empty_liquid:
    tags: [liquid]
  water_liquid:
    tags: [liquid]
  jug_repr2:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int handSlotId = codex.SlotNames.GetId("hand");

            WorldObject hand = Spawn(codex, "hand_repr");
            WorldObject emptyJug = SpawnRepresentedContainer(codex, "jug_repr2", "empty_liquid");
            WorldObject waterJug = SpawnRepresentedContainer(codex, "jug_repr2", "water_liquid");

            emptyJug.MoveToSlot(hand, handSlotId, codex.WellKnown, out _);
            waterJug.MoveToSlot(hand, handSlotId, codex.WellKnown, out _);

            hand.TryGetSlot(handSlotId, out Slot handSlot);
            // FixedPositionsなのでCellsには空セル(null)も含まれる。実在スタックだけを見るためnullを除く。
            var stacks = handSlot.Cells.Where(c => c != null).ToList();

            Assert.That(stacks.Count, Is.EqualTo(2));
            Assert.That(stacks.Select(s => handSlot.IndexOfStack(s)), Is.EquivalentTo(new[] { 0, 1 }));
        }
    }
}

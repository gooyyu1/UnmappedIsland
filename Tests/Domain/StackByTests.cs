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
        public void RepresentedBy_DifferentContainerDef_SameContent_DoesNotStack()
        {
            // represented_by は同種判定を「中身のObjectDefまで」細分化するが、外側オブジェクト自体も
            // アイデンティティの先頭要素として含まれる。中身が同じ水でも、容器のObjectDefが違えば別スタック。
            const string yaml = @"
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_repr3:
    slots:
      pile: {}
  water_liquid:
    tags: [liquid]
  bowl:
    traits: [represented_container]
  bottle:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");

            WorldObject bag = Spawn(codex, "bag_repr3");
            WorldObject waterBowl = SpawnRepresentedContainer(codex, "bowl", "water_liquid");
            WorldObject waterBottle = SpawnRepresentedContainer(codex, "bottle", "water_liquid");

            waterBowl.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            waterBottle.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            var stacks = pile.Cells;

            Assert.That(stacks.Count, Is.EqualTo(2), "中身が同じ水でも容器（外側ObjectDef）が違えば別スタックになる");
            Assert.That(stacks[0].Members.Count, Is.EqualTo(1));
            Assert.That(stacks[1].Members.Count, Is.EqualTo(1));
        }

        [Test]
        public void RepresentedBy_ContentEmptied_RemigratesToMatchingStack()
        {
            // 既に空ボウルのスタックがある状態で、水入りボウルの中身が空になったら、そのボウルは
            // 弾き出されて既存の空ボウルスタックへ合流する（スロット全体で「同種は1スタック」を保つ）。
            const string yaml = @"
traits:
  represented_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  bag_remig:
    slots:
      pile: {}
  water_liquid:
    tags: [liquid]
  bowl:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int contentSlotId = codex.SlotNames.GetId("content");

            WorldObject bag = Spawn(codex, "bag_remig");
            WorldObject emptyBowl = Spawn(codex, "bowl");
            WorldObject waterBowl = Spawn(codex, "bowl");
            WorldObject water = Spawn(codex, "water_liquid");
            water.MoveToSlot(waterBowl, contentSlotId, codex.WellKnown, out _);

            emptyBowl.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            waterBowl.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Cells.Count(c => c != null), Is.EqualTo(2), "最初は空ボウルと水入りボウルで別スタック");

            // 水入りボウルの中身を消す → 空ボウルになり、既存の空ボウルスタックへ再合流するはず。
            water.Destroy(codex.WellKnown);

            var live = pile.Cells.Where(c => c != null).ToList();
            Assert.That(live.Count, Is.EqualTo(1), "空になったボウルは既存の空ボウルスタックへ合流し1スタックにまとまる");
            Assert.That(live[0].Members, Is.EquivalentTo(new[] { emptyBowl, waterBowl }));
        }

        [Test]
        public void RepresentedBy_DeepContentChange_PropagatesRestackToOutermost()
        {
            // 瓶→出汁→エッセンスの2段代表。末端のエッセンスを差し替えるだけで、最上位（瓶）のスタックまで
            // 再判定が連鎖して、同じだった2本の瓶が別スタックに分かれること（局所規則の自己伝播）を確かめる。
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
  bag_deep:
    slots:
      pile: {}
  sweet_essence:
    tags: [essence]
  bitter_essence:
    tags: [essence]
  broth:
    traits: [represented_liquid]
    tags: [liquid]
  bottle_deep:
    traits: [represented_container]
";
            var codex = Load(yaml);
            int pileSlotId = codex.SlotNames.GetId("pile");
            int contentSlotId = codex.SlotNames.GetId("content");
            int essenceSlotId = codex.SlotNames.GetId("essence");

            WorldObject bag = Spawn(codex, "bag_deep");
            WorldObject bottleA = Spawn(codex, "bottle_deep");
            WorldObject bottleB = Spawn(codex, "bottle_deep");
            WorldObject brothA = Spawn(codex, "broth");
            WorldObject brothB = Spawn(codex, "broth");
            WorldObject sweetA = Spawn(codex, "sweet_essence");
            WorldObject sweetB = Spawn(codex, "sweet_essence");

            sweetA.MoveToSlot(brothA, essenceSlotId, codex.WellKnown, out _);
            sweetB.MoveToSlot(brothB, essenceSlotId, codex.WellKnown, out _);
            brothA.MoveToSlot(bottleA, contentSlotId, codex.WellKnown, out _);
            brothB.MoveToSlot(bottleB, contentSlotId, codex.WellKnown, out _);
            bottleA.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);
            bottleB.MoveToSlot(bag, pileSlotId, codex.WellKnown, out _);

            bag.TryGetSlot(pileSlotId, out Slot pile);
            Assert.That(pile.Cells.Count(c => c != null), Is.EqualTo(1), "代表の代表まで同じなので最初は同じスタック");

            // brothA の末端エッセンスを sweet → bitter に差し替える。
            sweetA.Destroy(codex.WellKnown);
            WorldObject bitterA = Spawn(codex, "bitter_essence");
            bitterA.MoveToSlot(brothA, essenceSlotId, codex.WellKnown, out _);

            var live = pile.Cells.Where(c => c != null).ToList();
            Assert.That(live.Count, Is.EqualTo(2), "末端の差し替えが最上位まで伝播し、2本の瓶が別スタックに分かれる");
            Assert.That(live.SelectMany(s => s.Members), Is.EquivalentTo(new[] { bottleA, bottleB }));
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

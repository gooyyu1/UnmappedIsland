using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// move効果動詞（MoveEffect: 対象オブジェクトを、selfのプロパティが指すインスタンスIDのオブジェクトの
    /// 中へ移動する）に対する自動テスト。道（path）の移動アクションのように、移動先が定義時点ではなく
    /// 生成時に確定するインスタンスであるケースを想定する。
    /// </summary>
    [TestFixture]
    public class MoveEffectTests
    {
        private const string IslandYaml = @"
traits:
  location:
    tags: [location]

object_defs:
  world:
    singleton: true
    slots:
      locations:
        accepts:
          - {tag: location, max: 9999}

  meadow:
    traits: [location]
    props:
      dummy:
        value: 0
    slots:
      characters:
        accepts:
          - {tag: character, max: 9999}
      stuff: {}

  hilltop:
    traits: [location]
    slots:
      characters:
        accepts:
          - {tag: character, max: 9999}
      stuff: {}

  character:
    tags: [character]

  path:
    props:
      destination_id:
        value: 0
      travel_minutes:
        value: 60
    actions:
      travel:
        move:
          object: actor
          to_prop: destination_id
";

        private static (WorldCodex Codex, WorldSession Session,
            WorldObject World, WorldObject Meadow, WorldObject Hilltop, WorldObject Character, WorldObject Path) Build()
        {
            var codex = new WorldCodexYamlLoader().Load("island.yaml", IslandYaml).Build();
            var session = new WorldSession(codex);

            var world = session.Spawn(codex.ObjectNames.GetId("world"));
            var meadow = session.Spawn(codex.ObjectNames.GetId("meadow"));
            var hilltop = session.Spawn(codex.ObjectNames.GetId("hilltop"));
            var character = session.Spawn(codex.ObjectNames.GetId("character"));
            var path = session.Spawn(codex.ObjectNames.GetId("path"));

            int locationsId = codex.SlotNames.GetId("locations");
            Assert.That(meadow.MoveToSlot(world, locationsId, codex.WellKnown, out string e1), Is.True, e1);
            Assert.That(hilltop.MoveToSlot(world, locationsId, codex.WellKnown, out string e2), Is.True, e2);
            Assert.That(character.MoveToSlot(meadow, codex.SlotNames.GetId("characters"), codex.WellKnown, out string e3), Is.True, e3);
            Assert.That(path.MoveToSlot(meadow, codex.SlotNames.GetId("stuff"), codex.WellKnown, out string e4), Is.True, e4);

            return (codex, session, world, meadow, hilltop, character, path);
        }

        [Test]
        public void Travel_MovesActorIntoDestinationCharactersSlot()
        {
            var (codex, session, _, meadow, hilltop, character, path) = Build();
            path.SetProperty(codex.PropertyNames.GetId("destination_id"), hilltop.InstanceId);

            Assert.That(path.TryExecuteAction("travel", character, session), Is.True);

            Assert.That(character.Parent, Is.SameAs(hilltop), "actorは移動先ロケーションへ移る");
            Assert.That(character.ParentSlotLocalId,
                Is.EqualTo(hilltop.Def.SlotLayout.ToLocal(codex.SlotNames.GetId("characters"))),
                "acceptsのタグ判定により、宣言順走査でcharactersスロットへ振り分けられる");
            Assert.That(meadow.GetSlotByLocalId(meadow.Def.SlotLayout.ToLocal(codex.SlotNames.GetId("characters"))).Contents,
                Does.Not.Contain(character), "元のロケーションからは居なくなる");
        }

        [Test]
        public void Travel_WithUnresolvableDestination_DoesNothing()
        {
            var (codex, session, _, meadow, _, character, path) = Build();
            path.SetProperty(codex.PropertyNames.GetId("destination_id"), 9999);

            Assert.That(path.TryExecuteAction("travel", character, session), Is.True, "アクション自体は成立する");
            Assert.That(character.Parent, Is.SameAs(meadow), "移動先が解決できなければ何も起きない");
        }

        [Test]
        public void Travel_WithoutActor_DoesNothing()
        {
            var (codex, session, _, meadow, hilltop, character, path) = Build();
            path.SetProperty(codex.PropertyNames.GetId("destination_id"), hilltop.InstanceId);

            Assert.That(path.TryExecuteAction("travel", actor: null, session), Is.True);
            Assert.That(character.Parent, Is.SameAs(meadow), "actorがいない文脈では何も起きない");
        }

        [Test]
        public void ParseMove_RejectsNonActorObject()
        {
            Assert.That((System.Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("bad.yaml", @"
object_defs:
  path:
    props:
      destination_id:
        value: 0
    actions:
      travel:
        move:
          object: self
          to_prop: destination_id
").Build()), Throws.TypeOf<YamlLoadException>().With.Message.Contain("actor"));
        }

        [Test]
        public void ParseMove_RejectsUnknownKeys()
        {
            Assert.That((System.Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("bad.yaml", @"
object_defs:
  path:
    props:
      destination_id:
        value: 0
    actions:
      travel:
        move:
          object: actor
          to_prop: destination_id
          into: characters
").Build()), Throws.TypeOf<YamlLoadException>().With.Message.Contain("未知のキー"));
        }

        [Test]
        public void ParseMove_RejectedInsideOnMin()
        {
            Assert.That((System.Func<WorldCodex>)(() => new WorldCodexYamlLoader().Load("bad.yaml", @"
object_defs:
  bomb:
    props:
      fuse:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          move:
            object: actor
            to_prop: fuse
").Build()), Throws.TypeOf<YamlLoadException>());
        }
    }
}

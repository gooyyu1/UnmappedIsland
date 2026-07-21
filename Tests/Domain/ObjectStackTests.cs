using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// ObjectStack.TryInsert（7.6節）が「同種（Matches: ObjectDef・代表ObjectDef列が一致）だけが積み重なる」
    /// というスタックの不変条件を、呼び出し側の事前確認に依存せず自分自身で守ることを検証する。
    /// </summary>
    [TestFixture]
    public class ObjectStackTests
    {
        private const string Yaml = @"
object_defs:
  coin: {}
  gem: {}
";

        private static WorldCodex Load() => new WorldCodexYamlLoader().Load("core.yaml", Yaml).Build();

        [Test]
        public void TryInsert_SameObjectDef_JoinsStack()
        {
            var codex = Load();
            var session = new WorldSession(codex);
            ObjectDef coin = codex.Objects.Get(codex.ObjectNames.GetId("coin"));

            var stack = new ObjectStack(new WorldObject(1, coin, session));
            var another = new WorldObject(2, coin, session);

            Assert.That(stack.TryInsert(another), Is.True);
            Assert.That(stack.Members, Has.Count.EqualTo(2));
            Assert.That(stack.Members, Does.Contain(another));
        }

        [Test]
        public void TryInsert_DifferentObjectDef_FailsWithoutMutating()
        {
            var codex = Load();
            var session = new WorldSession(codex);
            ObjectDef coin = codex.Objects.Get(codex.ObjectNames.GetId("coin"));
            ObjectDef gem = codex.Objects.Get(codex.ObjectNames.GetId("gem"));

            var stack = new ObjectStack(new WorldObject(1, coin, session));
            var intruder = new WorldObject(2, gem, session);

            Assert.That(stack.TryInsert(intruder), Is.False, "別ObjectDefは合流できない（スタック不可）");
            Assert.That(stack.Members, Has.Count.EqualTo(1), "挿入失敗時はメンバーを一切変更しない");
            Assert.That(stack.Members, Does.Not.Contain(intruder));
        }
    }
}

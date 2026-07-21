using System;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// value: {min, max} 記法（GameElementDefinition.md 6.2節）による「初期値をレンジ内でランダムに決める」
    /// 挙動の検証。spawn（WorldSession.Rng経由）では[min,max]の一様乱数、RNGを渡さない直接生成では
    /// 決定的にminになる。
    /// </summary>
    [TestFixture]
    public class InitialValueRangeTests
    {
        private const string Yaml = @"
object_defs:
  gem:
    props:
      quality:
        value: {min: 10, max: 20}
";

        private static WorldCodex Load() => new WorldCodexYamlLoader().Load("core.yaml", Yaml).Build();

        [Test]
        public void Spawn_InitialValueIsWithinRange_AndVaries()
        {
            WorldCodex codex = Load();
            int qualityId = codex.PropertyNames.GetId("quality");
            int gemId = codex.ObjectNames.GetId("gem");
            var session = new WorldSession(codex, new Random(12345));

            var seen = new System.Collections.Generic.HashSet<int>();
            for (int i = 0; i < 100; i++)
            {
                int v = session.Spawn(gemId).GetNumber(qualityId);
                Assert.That(v, Is.InRange(10, 20), "初期値は[min,max]の閉区間に収まる");
                seen.Add(v);
            }

            Assert.That(seen.Count, Is.GreaterThan(1), "100体分では複数の異なる初期値が現れる（ランダム化されている）");
            Assert.That(seen, Does.Contain(20), "上限maxも取りうる（閉区間）");
        }

        [Test]
        public void Spawn_WithSameSeed_ReproducesInitialValues()
        {
            WorldCodex codex = Load();
            int qualityId = codex.PropertyNames.GetId("quality");
            int gemId = codex.ObjectNames.GetId("gem");

            int FirstSpawn(int seed) => new WorldSession(codex, new Random(seed)).Spawn(gemId).GetNumber(qualityId);

            Assert.That(FirstSpawn(999), Is.EqualTo(FirstSpawn(999)),
                "同じシードなら初期値も再現する（決定的に振る舞わせられる）");
        }
    }
}

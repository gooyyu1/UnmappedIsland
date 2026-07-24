using System;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// rangeイベント（on_min等）の直下にpickを書ける文法（GameElementDefinition.md 9.7節・10節）の
    /// 自動テスト。気候システム（ClimateSystem.md）の「残り時間が0になった瞬間、プロパティ参照の重みで
    /// 次の状態を抽選し、残り時間自体も再ロールする」パターンがこの文法に依存する。
    /// </summary>
    [TestFixture]
    public class RangeEventPickTests
    {
        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("test.yaml", yaml).Build();

        private static WorldObject Instantiate(WorldCodex codex, string objectDefName, WorldSession session) =>
            new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId(objectDefName)), session);

        [Test]
        public void OnMinPick_SelectsCandidateByPropertyWeight_AndRerollsCounter()
        {
            // 0/1の重みプロパティ参照は、そのまま決定的な条件分岐になる（重み0の候補は選ばれない）。
            // 選ばれた候補はcounter自身を再ロールし、次の周回に備える（気候の季節・天気遷移と同じ形）。
            const string yaml = @"
object_defs:
  cycler:
    props:
      go_a:
        value: 1
      go_b:
        value: 0
      chosen:
        value: 0
      counter:
        value: 3
        range: {min: 0, max: 999}
        passives:
          - accumulate:
              self:
                counter: -1
        on_min:
          pick:
            - weight: {prop: go_a}
              set:
                self: {counter: 10, chosen: 1}
            - weight: {prop: go_b}
              set:
                self: {counter: 20, chosen: 2}
";
            var codex = Load(yaml);
            var session = new WorldSession(codex, new Random(1));
            WorldObject cycler = Instantiate(codex, "cycler", session);
            int counterId = codex.PropertyNames.GetId("counter");
            int chosenId = codex.PropertyNames.GetId("chosen");

            for (int i = 0; i < 3; i++) cycler.Tick(session);

            Assert.That(cycler.GetNumber(chosenId), Is.EqualTo(1), "重み1のgo_a候補だけが選ばれる");
            Assert.That(cycler.GetNumber(counterId), Is.EqualTo(10), "選ばれた候補がcounter自身を再ロールする");

            // 重みを入れ替えると、次の発火では反対の候補が選ばれる
            cycler.SetProperty(codex.PropertyNames.GetId("go_a"), 0);
            cycler.SetProperty(codex.PropertyNames.GetId("go_b"), 1);
            for (int i = 0; i < 10; i++) cycler.Tick(session);

            Assert.That(cycler.GetNumber(chosenId), Is.EqualTo(2));
            Assert.That(cycler.GetNumber(counterId), Is.EqualTo(20));
        }

        [Test]
        public void OnMinPick_NestedPick_InheritsSelfOnlyConstraint()
        {
            // on_min配下のpick候補（ネストを含む）の効果対象はselfのみ（6.5節の制約をそのまま引き継ぐ）
            const string yaml = @"
object_defs:
  broken:
    props:
      counter:
        value: 3
        range: {min: 0, max: 999}
        on_min:
          pick:
            - weight: 1
              pick:
                - weight: 1
                  set:
                    parent: {counter: 10}
";
            Action load = () => Load(yaml);
            Assert.Throws<YamlLoadException>(load);
        }

        [Test]
        public void OnMin_ActiveAndPick_AreMutuallyExclusive()
        {
            const string yaml = @"
object_defs:
  broken:
    props:
      counter:
        value: 3
        range: {min: 0, max: 999}
        on_min:
          set:
            self: {counter: 10}
          pick:
            - weight: 1
              set:
                self: {counter: 20}
";
            Action load = () => Load(yaml);
            Assert.Throws<YamlLoadException>(load);
        }

        [Test]
        public void OnShortfall_EmptyDeclaration_DisablesDefaultClampWithoutError()
        {
            // 「宣言だけして何もしない」on_shortfall: {}。既定の下限クランプが打ち消され、
            // 値が下限を下回ったまま残ることを許容する。
            const string yaml = @"
object_defs:
  sinker:
    props:
      level:
        value: 5
        range: {min: 0, max: 10}
        on_shortfall: {}
        passives:
          - accumulate:
              self:
                level: -2
";
            var codex = Load(yaml);
            var session = new WorldSession(codex, new Random(1));
            WorldObject sinker = Instantiate(codex, "sinker", session);
            int levelId = codex.PropertyNames.GetId("level");

            for (int i = 0; i < 3; i++) sinker.Tick(session);

            Assert.That(sinker.GetNumber(levelId), Is.EqualTo(-1),
                "5 -> 3 -> 1 -> -1。既定クランプなら0で止まるが、空宣言により素通しになる");
        }
    }
}

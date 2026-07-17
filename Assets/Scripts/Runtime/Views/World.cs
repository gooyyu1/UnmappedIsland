using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Runtime.Views
{
    /// <summary>
    /// world（唯一のシングルトン、GameElementDefinition.md 15節）に対する、UI/ゲームロジック向けの
    /// 型付きビュー。継承（class World : WorldObject）ではなくラップにしているのは、WorldCodex が
    /// traitによる合成モデルを採用しており、C#側のクラス階層と噛み合わないため。
    ///
    /// コンストラクタで解決するのはプロパティ名→グローバルIDだけで、グローバル→ローカルの変換は
    /// 毎回 WorldObject 側の配列引きに任せる（軽量なため、事前キャッシュはしない）。
    /// world がどのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みの
    /// ものだけを実装している。
    /// </summary>
    public sealed class World
    {
        public WorldObject Instance { get; }

        private readonly int dayId;
        private readonly int hourId;
        private readonly int minuteId;

        public World(WorldObject instance, NameRegistry propertyNames)
        {
            Instance = instance;
            dayId = propertyNames.GetId("day");
            hourId = propertyNames.GetId("hour");
            minuteId = propertyNames.GetId("minute");
        }

        public int Day => Instance.GetEffectiveValue(dayId);
        public int Hour => Instance.GetEffectiveValue(hourId);
        public int Minute => Instance.GetEffectiveValue(minuteId);
    }
}

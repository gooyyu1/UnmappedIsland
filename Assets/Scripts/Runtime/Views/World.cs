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
        private readonly int minuteOfTickId;
        private readonly int minutesPerTickId;

        public World(WorldObject instance, NameRegistry propertyNames)
        {
            Instance = instance;
            dayId = propertyNames.GetId("day");
            hourId = propertyNames.GetId("hour");
            minuteId = propertyNames.GetId("minute");
            minuteOfTickId = propertyNames.GetId("minute_of_tick");
            minutesPerTickId = propertyNames.GetId("minutes_per_tick");
        }

        public int Day => Instance.GetEffectiveValue(dayId);
        public int Hour => Instance.GetEffectiveValue(hourId);
        public int Minute => Instance.GetEffectiveValue(minuteId);

        /// <summary>tick内で経過した分（GameTime.WorldClock参照）。modify寄与の対象ではない、ゲーム側だけが
        /// 管理する生の値のため、実効値ではなく実体値をそのまま返す。</summary>
        public int MinuteOfTick => Instance.GetNumber(minuteOfTickId);

        /// <summary>1tickに相当するゲーム内時間（分）。MinuteOfTickと同様、実体値をそのまま返す。</summary>
        public int MinutesPerTick => Instance.GetNumber(minutesPerTickId);

        /// <summary>minuteへamountをまとめて加算する（GameTime.WorldClock専用）。</summary>
        public void AddMinutes(int amount) => Instance.AddNumber(minuteId, amount);

        /// <summary>MinuteOfTickを直接書き換える（GameTime.WorldClock専用）。</summary>
        public void SetMinuteOfTick(int value) => Instance.SetNumber(minuteOfTickId, value);
    }
}

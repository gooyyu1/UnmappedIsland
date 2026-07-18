using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.GameTime
{
    /// <summary>
    /// core.yamlの時間モデル（`world.minute`/`world.minute_of_tick`、1tick=15分）に依存する、このゲーム
    /// 固有の時間進行ロジック。WorldCodexエンジン（Codex/Runtime/Loader）はtickを「呼ばれたら1度だけ進む
    /// 汎用的な1ステップ」としてしか扱わず、「15分」という具体的な意味づけは一切持たない
    /// （GameElementDefinition.md 17節）。「tick境界に達した瞬間にTick()を呼ぶ」という判断は、汎用エンジン側の
    /// フックとしてではなく、このクラスがゲームの都合として直接行う。
    ///
    /// `world.minute_of_tick`（tick内で経過した分、0〜MinutesPerTick-1）は、セーブ・ロードの対象にするため
    /// 単なるこのクラスの内部変数ではなくworldのプロパティとして持つ。それ以外はこのクラスの外に状態を持たない。
    /// </summary>
    public static class WorldClock
    {
        /// <summary>1tickに相当するゲーム内時間（分）。core.yamlのtick概念に対するこのゲーム側の割り当てであり、
        /// WorldCodex側には存在しない定数。</summary>
        public const int MinutesPerTick = 15;

        /// <summary>
        /// ゲーム内時間をamount分だけ進める。`world.minute`へamountをまとめて加算し（1分ずつの逐次加算は
        /// しない）、`world.minute_of_tick`がMinutesPerTickを跨いだ回数だけTick()を呼ぶ。
        /// 例: minute_of_tickが5の状態で20分進めると、Tickが1回実行され、minute_of_tickは10になる。
        ///
        /// MinutesPerTick（15）はminuteのrange上限（60）より小さいため、ここで呼ぶTickの回数は、
        /// minuteのon_overflowが必要とする回数（60分に1回）を必ず上回る。そのため、amountがどれだけ
        /// 大きくても、minute/hour/dayへの繰り上げは通常のTick()の繰り返し呼び出しだけで正しく連鎖する
        /// （個別に補正ループを書く必要はない）。
        /// </summary>
        public static void Advance(WorldCodex codex, WorldObject world, WorldSession session, int amount)
        {
            int minuteId = codex.PropertyNames.GetId("minute");
            int minuteOfTickId = codex.PropertyNames.GetId("minute_of_tick");

            world.AddNumber(minuteId, amount);

            int total = world.GetNumber(minuteOfTickId) + amount;
            int ticksToRun = total / MinutesPerTick;
            world.SetNumber(minuteOfTickId, total % MinutesPerTick);

            for (int i = 0; i < ticksToRun; i++)
                world.Tick(session);
        }
    }
}

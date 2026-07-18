using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.GameTime
{
    /// <summary>
    /// core.yamlの時間モデル（`world.minute`/`world.minute_of_tick`/`world.minutes_per_tick`）に依存する、
    /// このゲーム固有の時間進行ロジック。WorldCodexエンジン（Codex/Runtime/Loader）はtickを「呼ばれたら
    /// 1度だけ進む汎用的な1ステップ」としてしか扱わず、「1tickが何分に相当するか」という具体的な意味づけは
    /// 一切持たない（GameElementDefinition.md 17節）。「tick境界に達した瞬間にTick()を呼ぶ」という判断は、
    /// 汎用エンジン側のフックとしてではなく、このクラスがゲームの都合として直接行う。
    ///
    /// 1tickあたりの分数（15）自体もC#側の定数ではなくcore.yamlの`world.minutes_per_tick`が持つ値であり、
    /// このクラスは実行時にそれを読むだけで、具体的な数字への依存はcore.yaml側に寄せている。
    /// `world.minute_of_tick`（tick内で経過した分）も、セーブ・ロードの対象にするため単なるこのクラスの
    /// 内部変数ではなくworldのプロパティとして持つ。それ以外はこのクラスの外に状態を持たない。
    /// </summary>
    public static class WorldClock
    {
        /// <summary>
        /// ゲーム内時間をamount分だけ進める。`world.minute`へamountをまとめて加算し（1分ずつの逐次加算は
        /// しない）、`world.minute_of_tick`が`world.minutes_per_tick`を跨いだ回数だけTick()を呼ぶ。
        /// 例: minutes_per_tickが15、minute_of_tickが5の状態で20分進めると、Tickが1回実行され、
        /// minute_of_tickは10になる。
        ///
        /// minutes_per_tickがminuteのrange上限（60）より小さい限り、ここで呼ぶTickの回数は、minuteの
        /// on_overflowが必要とする回数（60分に1回）を必ず上回る。そのため、amountがどれだけ大きくても、
        /// minute/hour/dayへの繰り上げは通常のTick()の繰り返し呼び出しだけで正しく連鎖する
        /// （個別に補正ループを書く必要はない）。
        /// </summary>
        public static void Advance(WorldCodex codex, WorldObject world, WorldSession session, int amount)
        {
            int minuteId = codex.PropertyNames.GetId("minute");
            int minuteOfTickId = codex.PropertyNames.GetId("minute_of_tick");
            int minutesPerTickId = codex.PropertyNames.GetId("minutes_per_tick");

            world.AddNumber(minuteId, amount);

            int minutesPerTick = world.GetNumber(minutesPerTickId);
            int total = world.GetNumber(minuteOfTickId) + amount;
            int ticksToRun = total / minutesPerTick;
            world.SetNumber(minuteOfTickId, total % minutesPerTick);

            for (int i = 0; i < ticksToRun; i++)
                world.Tick(session);
        }
    }
}

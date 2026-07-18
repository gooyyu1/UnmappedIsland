using UnmappedIsland.Runtime;
using UnmappedIsland.Runtime.Views;

namespace UnmappedIsland.GameTime
{
    /// <summary>
    /// core.yamlの時間モデル（`world.minute`/`world.minutes_per_tick`）に依存する、このゲーム固有の
    /// 時間進行ロジック。WorldCodexエンジン（Codex/Runtime/Loader）はtickを「呼ばれたら1度だけ進む汎用的な
    /// 1ステップ」としてしか扱わず、「1tickが何分に相当するか」という具体的な意味づけは一切持たない
    /// （GameElementDefinition.md 17節）。「tick境界に達した瞬間にTick()を呼ぶ」という判断は、汎用エンジン側の
    /// フックとしてではなく、このクラスがゲームの都合として直接行う。
    ///
    /// 1tickあたりの分数（15）自体もC#側の定数ではなくcore.yamlの`world.minutes_per_tick`が持つ値であり、
    /// このクラスは実行時にそれを読むだけで、具体的な数字への依存はcore.yaml側に寄せている。minute自身は
    /// tick駆動のaccumulateを持たない（YAML側の自動加算とこのクラスの加算が二重にならないようにするため）。
    /// minuteへの加算は、常にminutes_per_tick以下の小さな量を1回ずつ行う（大きな値を一度に加算すると、
    /// on_overflowが1回の補正しか行わないため、途中経過を経ずに正しく折り返せる保証がなくなる）。
    /// </summary>
    public static class WorldClock
    {
        /// <summary>
        /// ゲーム内時間をamount分だけ進める。tick境界（`minute % minutes_per_tick`が0に戻る瞬間）を
        /// 跨ぐたびに、その境界までの分だけminuteへ加算してからTick()を呼ぶ、を繰り返す。ループを終えた
        /// 時点で境界に届かない端数が残っていれば、それを最後にminuteへ加算する。
        /// 例: minutes_per_tickが15、tick内経過分(minute % minutes_per_tick)が5の状態で20分進めると、
        /// まず次の境界（あと10分）まで加算してTickを1回実行し、残り10分を端数として加算する
        /// （結果としてtick内経過分は10になる）。
        /// </summary>
        public static void Advance(World world, WorldSession session, int amount)
        {
            int minutesPerTick = world.MinutesPerTick;
            int minuteOfTick = world.Minute % minutesPerTick;
            int total = minuteOfTick + amount;
            int ticksToRun = total / minutesPerTick;

            if (ticksToRun == 0)
            {
                world.AddMinutes(amount);
                return;
            }

            world.AddMinutes(minutesPerTick - minuteOfTick); // 最初のtick境界まで
            world.Instance.Tick(session);

            for (int i = 1; i < ticksToRun; i++)
            {
                world.AddMinutes(minutesPerTick); // 以降は1tick分ずつ
                world.Instance.Tick(session);
            }

            world.AddMinutes(total % minutesPerTick); // 最後に端数（0以上、minutes_per_tick未満）を加算
        }
    }
}

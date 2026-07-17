using UnmappedIsland.Codex.Runtime;

namespace UnmappedIsland.Codex.Views
{
    /// <summary>
    /// ロケーションに対する、UI/ゲームロジック向けの型付きビュー。World/PlayerCharacter と同じ理由で
    /// 継承ではなくラップにしている。
    ///
    /// ロケーションが持つべきプロパティはまだ何も確定していないため、現時点では Instance への
    /// アクセスのみを提供する。具体的なプロパティが定まり次第、World/PlayerCharacter と同様に
    /// 名前付きアクセサを追加する。
    /// </summary>
    public sealed class Location
    {
        public WorldObject Instance { get; }

        public Location(WorldObject instance)
        {
            Instance = instance;
        }
    }
}

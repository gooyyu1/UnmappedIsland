using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime.Views
{
    /// <summary>
    /// 道（locations.yamlのpath object_def）に対する、UI/ゲームロジック向けの型付きビュー。
    /// World/PlayerCharacter/Location と同じ理由で継承ではなくラップにしている。
    ///
    /// travel_minutes/required_progress/destination_idはいずれも生成時（IslandSpawner）にインスタンス
    /// ごとへ上書きされる値であり、このビューは読み取りとtravelアクションの実行だけを提供する。
    /// 移動そのもの（actorの所属差し替え・時間消費）はYAML側のtravelアクション（move+duration）が担う。
    /// </summary>
    public sealed class Path
    {
        public WorldObject Instance { get; }

        private readonly int travelMinutesId = -1;
        private readonly int requiredProgressId = -1;
        private readonly int destinationIdId = -1;

        public Path(WorldObject instance, NameRegistry propertyNames)
        {
            Instance = instance;
            travelMinutesId = IdOrMissing(propertyNames, "travel_minutes");
            requiredProgressId = IdOrMissing(propertyNames, "required_progress");
            destinationIdId = IdOrMissing(propertyNames, "destination_id");
        }

        /// <summary>未登録の名前は-1（LocalIndexMap.Missing扱い）にする（TryGetIdのout値は失敗時0＝
        /// 別の名前の有効なIDになってしまうため、そのままでは使えない）。</summary>
        private static int IdOrMissing(NameRegistry names, string name) =>
            names.TryGetId(name, out int id) ? id : -1;

        /// <summary>移動時間（分）。</summary>
        public int TravelMinutes => Instance.GetEffectiveValue(travelMinutesId);

        /// <summary>発見に必要な、親の土地の探索進捗。</summary>
        public int RequiredProgress => Instance.GetEffectiveValue(requiredProgressId);

        /// <summary>移動先LocationのインスタンスID。</summary>
        public int DestinationInstanceId => Instance.GetEffectiveValue(destinationIdId);

        /// <summary>この道を通って移動する（YAML側のtravelアクション: 未発見なら不成立、成功なら
        /// actorが移動先へ移り、travel_minutes分の時間が進む）。</summary>
        public bool Travel(WorldObject actor, WorldSession session) =>
            Instance.TryExecuteAction("travel", actor, session);
    }
}

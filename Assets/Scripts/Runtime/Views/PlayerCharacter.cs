using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Runtime.Views
{
    /// <summary>
    /// actor（プレイヤーキャラクター、GameElementDefinition.md 8.1節・11節）に対する、UI/ゲームロジック
    /// 向けの型付きビュー。World と同じ理由で継承ではなくラップにしている。
    ///
    /// どのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
    /// </summary>
    public sealed class PlayerCharacter
    {
        public WorldObject Instance { get; }

        private readonly int hpId;
        private readonly int satietyId;

        public PlayerCharacter(WorldObject instance, NameRegistry propertyNames)
        {
            Instance = instance;
            hpId = propertyNames.GetId("hp");
            satietyId = propertyNames.GetId("satiety");
        }

        public int Hp => Instance.GetEffectiveValue(hpId);
        public int Satiety => Instance.GetEffectiveValue(satietyId);
    }
}

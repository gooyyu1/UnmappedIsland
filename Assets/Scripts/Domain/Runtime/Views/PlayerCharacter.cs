using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Runtime.Views
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
            hpId = IdOrMissing(propertyNames, "hp");
            satietyId = IdOrMissing(propertyNames, "satiety");
        }

        /// <summary>未登録の名前は-1（LocalIndexMap.Missing扱い）にする。実際のcharacters.yamlが
        /// このビューの知る全プロパティを持つとは限らない（例: hpは未定義）ため、GetIdの例外ではなく
        /// 「持っていなければ0を読む」という他のビューと同じ姿勢に合わせる。</summary>
        private static int IdOrMissing(NameRegistry names, string name) =>
            names.TryGetId(name, out int id) ? id : -1;

        public int Hp => Instance.GetEffectiveValue(hpId);
        public int Satiety => Instance.GetEffectiveValue(satietyId);
    }
}

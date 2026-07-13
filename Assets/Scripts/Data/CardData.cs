using System.Collections.Generic;
using UnityEngine;

namespace UnmappedIsland.Data
{
    /// <summary>
    /// カードのデータ定義
    /// </summary>
    [CreateAssetMenu(fileName = "CardData", menuName = "UnmappedIsland/CardData")]
    public class CardData : ScriptableObject
    {
        [SerializeField] private string cardId;
        [SerializeField] private string cardName;
        [TextArea(3, 6)]
        [SerializeField] private string description;
        [SerializeField] private Sprite cardArt;
        [SerializeField] private CardType cardType;
        [SerializeField] private List<CardEffect> effects = new List<CardEffect>();

        public string CardId => cardId;
        public string CardName => cardName;
        public string Description => description;
        public Sprite CardArt => cardArt;
        public CardType CardType => cardType;
        public IReadOnlyList<CardEffect> Effects => effects;
    }

    public enum CardType
    {
        Resource,
        Action,
        Event,
        Building,
    }

    [System.Serializable]
    public class CardEffect
    {
        public EffectType effectType;
        public int value;
    }

    public enum EffectType
    {
        GainFood,
        GainWater,
        GainWood,
        GainStone,
        LoseFood,
        LoseWater,
        Heal,
        Damage,
    }
}

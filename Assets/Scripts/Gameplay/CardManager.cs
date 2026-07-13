using System.Collections.Generic;
using UnityEngine;

namespace UnmappedIsland.Gameplay
{
    /// <summary>
    /// プレイヤーの手札・デッキ・捨て札を管理するクラス
    /// </summary>
    public class CardManager : MonoBehaviour
    {
        [SerializeField] private int handSize = 5;

        private List<Data.CardData> deck = new List<Data.CardData>();
        private List<Data.CardData> hand = new List<Data.CardData>();
        private List<Data.CardData> discardPile = new List<Data.CardData>();

        private void Start()
        {
            ShuffleDeck();
            DrawHand();
        }

        private void ShuffleDeck()
        {
            for (int i = deck.Count - 1; i > 0; i--)
            {
                int j = Random.Range(0, i + 1);
                (deck[i], deck[j]) = (deck[j], deck[i]);
            }
        }

        public void DrawHand()
        {
            int drawCount = handSize - hand.Count;
            for (int i = 0; i < drawCount; i++)
            {
                DrawCard();
            }
        }

        private void DrawCard()
        {
            if (deck.Count == 0)
            {
                ReshuffleDiscard();
            }
            if (deck.Count == 0) return;

            Data.CardData card = deck[0];
            deck.RemoveAt(0);
            hand.Add(card);
        }

        private void ReshuffleDiscard()
        {
            deck.AddRange(discardPile);
            discardPile.Clear();
            ShuffleDeck();
        }

        public void PlayCard(Data.CardData card)
        {
            if (!hand.Contains(card)) return;
            hand.Remove(card);
            discardPile.Add(card);
        }

        public IReadOnlyList<Data.CardData> Hand => hand;
        public int DeckCount => deck.Count;
        public int DiscardCount => discardPile.Count;
    }
}

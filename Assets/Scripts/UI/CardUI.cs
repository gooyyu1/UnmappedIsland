using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace UnmappedIsland.UI
{
    /// <summary>
    /// 手札のカード1枚分のUI表示を担当するクラス
    /// </summary>
    public class CardUI : MonoBehaviour
    {
        [SerializeField] private Image cardArtImage;
        [SerializeField] private TextMeshProUGUI cardNameText;
        [SerializeField] private TextMeshProUGUI descriptionText;
        [SerializeField] private Button playButton;

        private Data.CardData cardData;

        public void Setup(Data.CardData data)
        {
            cardData = data;
            if (cardArtImage != null && data.CardArt != null)
                cardArtImage.sprite = data.CardArt;
            if (cardNameText != null)
                cardNameText.text = data.CardName;
            if (descriptionText != null)
                descriptionText.text = data.Description;

            if (playButton != null)
            {
                playButton.onClick.RemoveAllListeners();
                playButton.onClick.AddListener(OnPlayButtonClicked);
            }
        }

        private void OnPlayButtonClicked()
        {
            Gameplay.CardManager cardManager = FindObjectOfType<Gameplay.CardManager>();
            if (cardManager != null && cardData != null)
            {
                cardManager.PlayCard(cardData);
            }
        }
    }
}

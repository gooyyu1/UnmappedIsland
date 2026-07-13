using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace UnmappedIsland.UI
{
    /// <summary>
    /// プレイヤーのステータスをUIに表示するクラス
    /// </summary>
    public class StatusUI : MonoBehaviour
    {
        [SerializeField] private Slider foodBar;
        [SerializeField] private Slider waterBar;
        [SerializeField] private Slider healthBar;
        [SerializeField] private TextMeshProUGUI woodText;
        [SerializeField] private TextMeshProUGUI stoneText;
        [SerializeField] private TextMeshProUGUI dayText;

        [SerializeField] private Gameplay.PlayerStatus playerStatus;

        private void Update()
        {
            if (playerStatus == null) return;
            UpdateUI();
        }

        private void UpdateUI()
        {
            if (foodBar != null)
                foodBar.value = playerStatus.Food;
            if (waterBar != null)
                waterBar.value = playerStatus.Water;
            if (healthBar != null)
                healthBar.value = playerStatus.Health;
            if (woodText != null)
                woodText.text = $"木材: {playerStatus.Wood}";
            if (stoneText != null)
                stoneText.text = $"石材: {playerStatus.Stone}";
            if (dayText != null)
                dayText.text = $"Day {playerStatus.Day}";
        }
    }
}

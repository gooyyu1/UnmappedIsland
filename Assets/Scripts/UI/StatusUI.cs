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
    }
}

using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace UnmappedIsland.UI
{
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

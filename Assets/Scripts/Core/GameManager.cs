using UnityEngine;

namespace UnmappedIsland.Core
{
    /// <summary>
    /// ゲーム全体を管理するシングルトンクラス
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
    }
}

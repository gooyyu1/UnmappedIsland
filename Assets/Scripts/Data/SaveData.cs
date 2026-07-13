using UnityEngine;

namespace UnmappedIsland.Data
{
    /// <summary>
    /// プレイヤーのセーブデータ構造体
    /// </summary>
    [System.Serializable]
    public class SaveData
    {
        public int day;
        public float food;
        public float water;
        public float health;
        public int wood;
        public int stone;
    }
}

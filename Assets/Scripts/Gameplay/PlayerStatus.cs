using UnityEngine;

namespace UnmappedIsland.Gameplay
{
    /// <summary>
    /// プレイヤーのステータス（食料、水、体力など）を管理するクラス
    /// </summary>
    public class PlayerStatus : MonoBehaviour
    {
        [SerializeField] private float maxFood = 100f;
        [SerializeField] private float maxWater = 100f;
        [SerializeField] private float maxHealth = 100f;

        private float food;
        private float water;
        private float health;
        private int wood;
        private int stone;
        private int day;

        public float Food => food;
        public float Water => water;
        public float Health => health;
        public int Wood => wood;
        public int Stone => stone;
        public int Day => day;

        private void Start()
        {
            food = maxFood;
            water = maxWater;
            health = maxHealth;
            day = 1;
        }

        public void AddFood(float amount)
        {
            food = Mathf.Clamp(food + amount, 0, maxFood);
        }

        public void AddWater(float amount)
        {
            water = Mathf.Clamp(water + amount, 0, maxWater);
        }

        public void AddHealth(float amount)
        {
            health = Mathf.Clamp(health + amount, 0, maxHealth);
        }

        public void AddWood(int amount)
        {
            wood = Mathf.Max(0, wood + amount);
        }

        public void AddStone(int amount)
        {
            stone = Mathf.Max(0, stone + amount);
        }

        public void AdvanceDay()
        {
            day++;
            ConsumeResources();
        }

        private void ConsumeResources()
        {
            AddFood(-10f);
            AddWater(-15f);

            if (food <= 0 || water <= 0)
            {
                AddHealth(-10f);
            }
        }

        public bool IsAlive()
        {
            return health > 0;
        }
    }
}

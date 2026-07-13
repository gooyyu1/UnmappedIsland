using System.IO;
using UnityEngine;

namespace UnmappedIsland.Core
{
    /// <summary>
    /// セーブデータの読み書きを管理するクラス
    /// </summary>
    public class SaveDataManager : MonoBehaviour
    {
        public static SaveDataManager Instance { get; private set; }

        private static readonly string SaveFilePath =
            Path.Combine(Application.persistentDataPath, "savedata.json");

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

        public void Save<T>(T data)
        {
            string json = JsonUtility.ToJson(data, prettyPrint: true);
            File.WriteAllText(SaveFilePath, json);
        }

        public T Load<T>()
        {
            if (!File.Exists(SaveFilePath))
            {
                return default;
            }
            string json = File.ReadAllText(SaveFilePath);
            return JsonUtility.FromJson<T>(json);
        }

        public bool HasSaveData()
        {
            return File.Exists(SaveFilePath);
        }

        public void Delete()
        {
            if (File.Exists(SaveFilePath))
            {
                File.Delete(SaveFilePath);
            }
        }
    }
}

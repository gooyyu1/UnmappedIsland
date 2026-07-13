using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnmappedIsland.Core
{
    /// <summary>
    /// シーン遷移を管理するクラス
    /// </summary>
    public class SceneController : MonoBehaviour
    {
        public static SceneController Instance { get; private set; }

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

        public void LoadScene(string sceneName)
        {
            SceneManager.LoadScene(sceneName);
        }

        public void LoadSceneAsync(string sceneName)
        {
            StartCoroutine(LoadSceneAsyncCoroutine(sceneName));
        }

        private System.Collections.IEnumerator LoadSceneAsyncCoroutine(string sceneName)
        {
            AsyncOperation operation = SceneManager.LoadSceneAsync(sceneName);
            while (!operation.isDone)
            {
                yield return null;
            }
        }
    }
}

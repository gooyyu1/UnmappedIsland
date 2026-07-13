using UnityEngine;

namespace UnmappedIsland.Core
{
    /// <summary>
    /// BGMとSEのサウンド再生を管理するクラス
    /// </summary>
    public class SoundManager : MonoBehaviour
    {
        public static SoundManager Instance { get; private set; }

        [SerializeField] private AudioSource bgmSource;
        [SerializeField] private AudioSource seSource;

        [Range(0f, 1f)]
        [SerializeField] private float bgmVolume = 0.7f;

        [Range(0f, 1f)]
        [SerializeField] private float seVolume = 1.0f;

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

        public void PlayBGM(AudioClip clip)
        {
            if (bgmSource.clip == clip) return;
            bgmSource.clip = clip;
            bgmSource.volume = bgmVolume;
            bgmSource.loop = true;
            bgmSource.Play();
        }

        public void StopBGM()
        {
            bgmSource.Stop();
        }

        public void PlaySE(AudioClip clip)
        {
            seSource.PlayOneShot(clip, seVolume);
        }
    }
}

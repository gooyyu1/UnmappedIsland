using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnmappedIsland.Codex;
using UnmappedIsland.Loader;

namespace UnmappedIsland.UnityAdapter
{
    /// <summary>
    /// UnmappedIsland.Loaderを、実際のUnityランタイムから呼び出すための薄い橋渡し。
    /// Application.streamingAssetsPath/persistentDataPathの解決など、Unity依存の処理はここだけに閉じ込め、
    /// Codex/Runtime/Loaderの3つはUnityEngineに一切依存しないままにする。
    ///
    /// ゲーム本体のYAML（core/terrains/foods/toolsなど）はStreamingAssets配下に置き、
    /// ユーザーが追加できる外部定義はpersistentDataPath配下の別ディレクトリに置く。
    /// 後者のディレクトリは、存在しなくても自動生成する（ユーザーがファイルを置く場所を
    /// 見つけやすくするため）。
    /// </summary>
    public static class WorldCodexUnityLoader
    {
        private const string BuiltInDirectoryName = "WorldCodex";
        private const string UserDirectoryName = "WorldCodexMods";

        public static WorldCodex Load()
        {
            return WorldCodexYamlLoader.LoadDirectories(ResolveDirectories());
        }

        private static IReadOnlyList<string> ResolveDirectories()
        {
            string userDirectory = Path.Combine(Application.persistentDataPath, UserDirectoryName);
            Directory.CreateDirectory(userDirectory);

            return new[]
            {
                Path.Combine(Application.streamingAssetsPath, BuiltInDirectoryName),
                userDirectory,
            };
        }
    }
}

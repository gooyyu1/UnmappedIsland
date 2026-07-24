using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;

namespace UnmappedIsland.UnityAdapter
{
    /// <summary>
    /// UnmappedIsland.LoaderをUnityランタイムから呼び出す薄い橋渡し。Unity依存の処理（パス解決など）は
    /// ここだけに閉じ込め、Codex/Runtime/LoaderはUnityEngineに依存しないままにする。
    /// ユーザー定義ディレクトリ（persistentDataPath配下）は、ファイルを置く場所を見つけやすいよう
    /// 無ければ自動生成する。
    /// </summary>
    public static class WorldCodexUnityLoader
    {
        private const string BuiltInDirectoryName = "WorldCodex";
        private const string UserDirectoryName = "WorldCodexMods";

        public static WorldCodex Load()
        {
            var loader = new WorldCodexYamlLoader();
            foreach (string directory in ResolveDirectories())
                loader.LoadFromDirectory(directory);
            return loader.Build();
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

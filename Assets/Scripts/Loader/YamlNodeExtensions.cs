using System.Collections.Generic;
using System.Linq;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// YamlDotNetのRepresentationModel（YamlMappingNode等）に対する、フィールド取り出し用の
    /// 薄いヘルパー。エラーメッセージにcontext（ファイル名・object_def名など）を含められるようにする。
    /// </summary>
    public static class YamlNodeExtensions
    {
        public static YamlNode TryGet(this YamlMappingNode map, string key)
        {
            var scalar = new YamlScalarNode(key);
            return map.Children.TryGetValue(scalar, out YamlNode value) ? value : null;
        }

        public static YamlMappingNode TryGetMapping(this YamlMappingNode map, string key, string context)
        {
            YamlNode node = map.TryGet(key);
            if (node == null) return null;
            if (node is YamlMappingNode mapping) return mapping;
            throw new YamlLoadException($"{context}: '{key}' はマッピングである必要があります。");
        }

        public static YamlSequenceNode TryGetSequence(this YamlMappingNode map, string key, string context)
        {
            YamlNode node = map.TryGet(key);
            if (node == null) return null;
            if (node is YamlSequenceNode seq) return seq;
            throw new YamlLoadException($"{context}: '{key}' は配列である必要があります。");
        }

        public static string TryGetScalar(this YamlMappingNode map, string key, string context)
        {
            YamlNode node = map.TryGet(key);
            if (node == null) return null;
            if (node is YamlScalarNode scalar) return scalar.Value;
            throw new YamlLoadException($"{context}: '{key}' はスカラー値である必要があります。");
        }

        public static string RequireScalar(this YamlMappingNode map, string key, string context)
        {
            string value = map.TryGetScalar(key, context);
            if (value == null) throw new YamlLoadException($"{context}: 必須フィールド '{key}' がありません。");
            return value;
        }

        public static int RequireInt(this YamlMappingNode map, string key, string context)
        {
            string raw = map.RequireScalar(key, context);
            if (!int.TryParse(raw, out int value))
                throw new YamlLoadException($"{context}: '{key}' は整数である必要があります（値: '{raw}'）。");
            return value;
        }

        public static int? TryGetInt(this YamlMappingNode map, string key, string context)
        {
            string raw = map.TryGetScalar(key, context);
            if (raw == null) return null;
            if (!int.TryParse(raw, out int value))
                throw new YamlLoadException($"{context}: '{key}' は整数である必要があります（値: '{raw}'）。");
            return value;
        }

        public static double? TryGetDouble(this YamlMappingNode map, string key, string context)
        {
            string raw = map.TryGetScalar(key, context);
            if (raw == null) return null;
            if (!double.TryParse(raw, out double value))
                throw new YamlLoadException($"{context}: '{key}' は数値である必要があります（値: '{raw}'）。");
            return value;
        }

        public static bool TryGetBool(this YamlMappingNode map, string key, string context, bool fallback)
        {
            string raw = map.TryGetScalar(key, context);
            if (raw == null) return fallback;
            if (!bool.TryParse(raw, out bool value))
                throw new YamlLoadException($"{context}: '{key}' は真偽値である必要があります（値: '{raw}'）。");
            return value;
        }

        /// <summary>マッピングの子を、YAML上の宣言順のまま (キー文字列, 値ノード) の列として返す。</summary>
        public static IEnumerable<(string Key, YamlNode Value)> EntriesInOrder(this YamlMappingNode map)
        {
            return map.Children.Select(kv => (((YamlScalarNode)kv.Key).Value, kv.Value));
        }
    }
}

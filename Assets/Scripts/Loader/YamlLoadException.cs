using System;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// YAMLロード時のエラー（重複キー・未知のフィールド・必須フィールド欠落・trait解決の失敗など）。
    /// どのファイル・どのobject_def/trait名で起きたかを呼び出し側でメッセージに含める。
    /// </summary>
    public sealed class YamlLoadException : Exception
    {
        public YamlLoadException(string message) : base(message)
        {
        }

        public YamlLoadException(string message, Exception inner) : base(message, inner)
        {
        }
    }
}

using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// YAML上の識別子（ObjectDef名・プロパティ名・スロット名など）と、実行時に扱うグローバルなintを
    /// 相互変換する。「名前の空間」ごとに1つ用意する（object用・property用・slot用は別々のインスタンス）。
    /// ロード完了後は Intern を呼ばず、読み取り専用として扱う想定。
    /// </summary>
    public sealed class NameRegistry
    {
        private readonly Dictionary<string, int> nameToId = new Dictionary<string, int>();
        private readonly List<string> idToName = new List<string>();

        public int Count => idToName.Count;

        /// <summary>
        /// 名前を登録し、そのグローバルIDを返す。登録済みなら既存のIDを返す（冪等）。
        /// </summary>
        public int Intern(string name)
        {
            if (nameToId.TryGetValue(name, out int id))
                return id;

            id = idToName.Count;
            idToName.Add(name);
            nameToId[name] = id;
            return id;
        }

        public bool TryGetId(string name, out int id) => nameToId.TryGetValue(name, out id);

        public int GetId(string name)
        {
            if (!nameToId.TryGetValue(name, out int id))
                throw new KeyNotFoundException($"'{name}' はまだ登録されていません。");
            return id;
        }

        public string GetName(int id) => idToName[id];
    }
}

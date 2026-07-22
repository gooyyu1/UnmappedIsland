using System.Collections.Generic;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 命名処理（TerrainGeneration.md 3.6節）。島の重心からの方角（8方位）+LocationTypeの表示名で
    /// 「東の草原」のような仮称を作り、重複はフォールバック接尾辞（第一/第二…）で区別する。
    /// name_pool（固有名詞プール）は今後の課題。
    /// </summary>
    public static class NameAssigner
    {
        private static readonly string[] Directions = { "東", "北東", "北", "北西", "西", "南西", "南", "南東" };

        public static void AssignNames(IReadOnlyList<Site> sites)
        {
            double centerX = 0, centerY = 0;
            foreach (Site site in sites)
            {
                centerX += site.X;
                centerY += site.Y;
            }
            centerX /= sites.Count;
            centerY /= sites.Count;

            var counts = new Dictionary<string, int>();
            var duplicated = new HashSet<string>();
            foreach (Site site in sites)
            {
                string baseName = $"{DirectionOf(site.X - centerX, site.Y - centerY)}の{site.Type.DisplayName}";
                if (counts.TryGetValue(baseName, out int seen)) duplicated.Add(baseName);
                counts[baseName] = seen + 1;
            }

            var used = new Dictionary<string, int>();
            foreach (Site site in sites)
            {
                string baseName = $"{DirectionOf(site.X - centerX, site.Y - centerY)}の{site.Type.DisplayName}";
                if (!duplicated.Contains(baseName))
                {
                    site.Name = baseName;
                    continue;
                }

                int ordinal = used.TryGetValue(baseName, out int u) ? u + 1 : 1;
                used[baseName] = ordinal;
                site.Name = $"{baseName}{ToKanjiOrdinal(ordinal)}";
            }
        }

        /// <summary>重心からのベクトルを8方位に割り当てる（45度刻み、東=0度を中心に反時計回り）。</summary>
        private static string DirectionOf(double dx, double dy)
        {
            double angle = System.Math.Atan2(dy, dx);                       // (-π, π]
            int sector = (int)System.Math.Floor((angle + System.Math.PI / 8) / (System.Math.PI / 4));
            return Directions[((sector % 8) + 8) % 8];
        }

        private static string ToKanjiOrdinal(int ordinal)
        {
            string[] kanji = { "一", "二", "三", "四", "五", "六", "七", "八", "九", "十" };
            string number = ordinal <= 10 ? kanji[ordinal - 1] : ordinal.ToString();
            return $"（第{number}）";
        }
    }
}

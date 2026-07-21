#!/usr/bin/env python3
"""C# namespace/folder 対応チェッカー。

ルール:
  Assets/Scripts/<Path>/<File>.cs  →  namespace UnmappedIsland.<Path>
  Tests/<Path>/<File>.cs           →  namespace UnmappedIsland.<Path>

除外:
  Tests/UnmappedIsland.Core/  （独立したライブラリプロジェクト）
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent  # リポジトリルート

SCAN_ROOTS = [
    ROOT / "Assets" / "Scripts",
    ROOT / "Tests",
]

EXCLUDES = [
    ROOT / "Tests" / "UnmappedIsland.Core",
]

NAMESPACE_RE = re.compile(r"^\s*namespace\s+([\w.]+)", re.MULTILINE)


def expected_namespace(file: Path, scan_root: Path) -> str:
    rel = file.relative_to(scan_root)
    folder_parts = list(rel.parts[:-1])  # ファイル名を除いたフォルダ部分
    if folder_parts:
        return "UnmappedIsland." + ".".join(folder_parts)
    return "UnmappedIsland"


def check_file(file: Path, scan_root: Path) -> list:
    text = file.read_text(encoding="utf-8")
    matches = NAMESPACE_RE.findall(text)
    if not matches:
        return []  # namespace 宣言なし（global using ファイル等）はスキップ

    expected = expected_namespace(file, scan_root)
    violations = []
    for ns in matches:
        if ns != expected:
            rel = file.relative_to(ROOT)
            violations.append(
                f"  {rel}\n    expected: {expected}\n    found:    {ns}"
            )
    return violations


def main():
    violations = []
    checked = 0

    for scan_root in SCAN_ROOTS:
        for file in sorted(scan_root.rglob("*.cs")):
            if any(file.is_relative_to(ex) for ex in EXCLUDES):
                continue
            violations.extend(check_file(file, scan_root))
            checked += 1

    print(f"Checked {checked} C# files.")

    if violations:
        print(f"\n{len(violations)} namespace violation(s):\n")
        for v in violations:
            print(v)
        sys.exit(1)
    else:
        print("All namespace declarations match their folder paths.")


if __name__ == "__main__":
    main()

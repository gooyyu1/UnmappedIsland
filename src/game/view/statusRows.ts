import type { StatusContent } from '../ui/StatusBar';

/**
 * ステータスエリアに並べる行を、出すものだけ表示順に選ぶ（StatusArea.md）。
 *
 * taggedはstatusタグが付いたもの（常に候補）、othersはそれ以外も含めた全プロパティで、固定表示に
 * されたものだけが候補に加わる（StatusArea.md 3節「どのプロパティも固定表示にすればここへ出せる」）。
 * 安全域は固定表示でなければ出さない。
 *
 * ただし安全域へ戻ったばかりの行は、その変化を見せ終わるまで残す（wouldShowChangeFor）。ここで即座に
 * 落とすと、良くなった分の帯が動く前にバーごと消えてしまい、何がどれだけ良くなったのかが見えない。
 *
 * 並び順は「固定表示 → 危険域・致命的域 → 留意域・要注意域 → 安全域（消える途中）」で、同じまとまりの
 * 中はプロパティの宣言順を保つ。
 */
export function statusRows(
  tagged: readonly StatusContent[],
  others: readonly StatusContent[],
  wouldShowChangeFor: (status: StatusContent) => boolean,
): readonly StatusContent[] {
  // taggedはothersの部分集合（statusタグの付いた行も、キャラクタのプロパティには違いない）なので、
  // 同じ行が両方から来る。識別子で束ね、常に候補のtaggedを先に置く。
  const candidates = new Map<string, StatusContent>();
  for (const status of tagged) candidates.set(status.key, status);
  for (const status of others)
    if (status.pinned === true && !candidates.has(status.key)) candidates.set(status.key, status);

  return [...candidates.values()]
    .filter((status) => status.pinned === true || status.alert !== 'safe' || wouldShowChangeFor(status))
    .sort((a, b) => groupOf(a) - groupOf(b));
}

/** 表示順のまとまり（小さいほど上）。明滅しない域（留意・要注意）は同じまとまりに置く。 */
function groupOf(status: StatusContent): number {
  if (status.pinned === true) return 0;
  // 安全域が残っているのは変化を見せ切るまでの間だけなので、留意域より下（最後尾）へ置く。
  if (status.alert === 'safe') return 3;
  return status.alert === 'watch' || status.alert === 'caution' ? 2 : 1;
}

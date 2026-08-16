import type { CardContent } from './Card';

/**
 * 見た目のぶんだけを取り出す（操作も識別子も引き継がない）。見せるためだけのカード——飛んでいる
 * 途中の札、探索で見つけたものの枠、帰りを待つ枠に残る印——を作るときに使う。
 *
 * Cardから離してあるのは、画面を持たない層（ShownCards）も印を作るため。
 */
export function cardFace(content: CardContent): CardContent {
  const { icon, name, art, background, kind, alert, road, gauges, mark, overlay, inProgress, cooking } =
    content;
  return { icon, name, art, background, kind, alert, road, gauges, mark, overlay, inProgress, cooking };
}

/**
 * 子ウィンドウが出す借りた札の見た目。操作は引き継がないが、**同じ札だと分かる識別子だけは持つ**
 * ——元の枠からここへ運ばれてくるのも、閉じて帰るのも、この識別子を辿った並びの差し替えそのもの
 * だから（cardMotionPlan、Windows.md 1.1節）。
 */
export function borrowedFace(content: CardContent): CardContent {
  return { ...cardFace(content), identity: content.identity };
}

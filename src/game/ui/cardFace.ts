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

import type { StatusContent } from '../ui/StatusBar';

/**
 * ステータス1行が、バーとその上の文字で何を映すか（[`StatusArea.md`](../../../docs/ui/StatusArea.md)
 * 9節）。画面を持たない決め方だけを置き、描くのは`StatusBar`。
 */

/**
 * バーが映す満たされ具合。**`range`を持つならその中での位置、持たずに段だけを持つなら今いる段の中での
 * 進み**。どちらも言えなければundefinedで、バーを出さず文字だけが残る。
 */
export function barFillOf(content: StatusContent): number | undefined {
  return content.ratio ?? content.stage?.progress?.ratio;
}

/**
 * 前後の2つで、バーが同じ軸を映しているか（＝その差を「変わった分」の帯として出せるか）。
 *
 * **満たされ具合のバーの軸は`range`で、値が段をまたいでも動かない。** 段の中の進みは違い、段が
 * 上がるたび軸ごと次の段へ移って0から始まる——またいだ前後の差は変化量ではないので、帯にすると
 * 値が増えているのに「減った分」の赤い帯が出る。
 */
export function barKeepsAxis(before: StatusContent, after: StatusContent): boolean {
  return after.ratio !== undefined || before.stage?.name === after.stage?.name;
}

/**
 * バーの左端に重ねる、この行の値の読み。**段を持つならその名前**（レベル）、持たないなら実効値そのもの。
 *
 * **満たされ具合のバーには何も載せない**——長さがそのまま答えなので、文字を重ねる必要が無い。
 */
export function barValueTextOf(content: StatusContent): string {
  if (content.ratio !== undefined) return '';
  return content.stage?.name ?? String(content.value);
}

/**
 * バーの右端に重ねる、次の段の名前。**段の中の進みを映している行だけが出す**——そこへ向けて満ちる
 * バーであることが、両端の名前で読める。
 */
export function barNextStageTextOf(content: StatusContent): string {
  return content.ratio !== undefined ? '' : (content.stage?.progress?.nextName ?? '');
}

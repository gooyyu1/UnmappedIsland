import type Phaser from 'phaser';

/**
 * 文字単位で折り返すword wrapコールバック。Phaser既定の折り返しは空白で区切られた単語を単位に
 * するため、空白を持たない日本語の文字列がまったく改行されない。
 *
 * コールバックはTextStyle.syncFontの後に呼ばれるので、textObject.contextの実測値をそのまま使える。
 */
export function wrapByCharacter(
  maxWidth: number,
): (text: string, textObject: Phaser.GameObjects.Text) => string[] {
  return (text, textObject) => {
    const lines: string[] = [];
    for (const source of text.split('\n')) {
      let line = '';
      for (const character of source) {
        if (line !== '' && textObject.context.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = character;
        } else {
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  };
}

/** 1行に収まらない文字列を末尾省略（…）へ詰める。折り返さずに1行で見せたい箇所に使う。 */
export function truncateToWidth(textObject: Phaser.GameObjects.Text, maxWidth: number): void {
  const source = textObject.text;
  if (textObject.width <= maxWidth) return;

  let low = 0;
  let high = [...source].length;
  while (low < high) {
    const middle = Math.trunc((low + high + 1) / 2);
    textObject.setText(`${[...source].slice(0, middle).join('')}…`);
    if (textObject.width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  textObject.setText(low === 0 ? '…' : `${[...source].slice(0, low).join('')}…`);
}

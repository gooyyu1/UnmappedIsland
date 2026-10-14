import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLOT_BUTTON_PAPER_FRAME } from '../../src/art/slotButtonArt';
import { SIZE } from '../../src/game/looks/theme';

const ROOT = resolve(__dirname, '../..');

interface ButtonPaperRecipe {
  readonly output: string;
  readonly buttonPaper: {
    readonly at: readonly string[];
    readonly width: number;
    readonly height: number;
    readonly radius: number;
  };
}

const recipe = JSON.parse(
  readFileSync(resolve(ROOT, 'tools/comfyui/recipes/slot_button_paper.json'), 'utf-8'),
) as ButtonPaperRecipe;

/** PNGの寸法（IHDRチャンクの幅と高さ）。 */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * スロットボタンの紙は、ボタンの矩形へ引き伸ばして敷く（PaperButton）。**縦横比が違うと紙の粒が
 * 一方向へ伸びる**ので、切り出し・読み込み・生成物の寸法が、どれもボタンの2倍で揃っていなければならない。
 */
describe('スロットボタンの紙の寸法', () => {
  it('1枚の寸法は、ボタン（SIZE.slotButton）の2倍', () => {
    expect(SLOT_BUTTON_PAPER_FRAME).toEqual({
      width: SIZE.slotButton.width * 2,
      height: SIZE.slotButton.height * 2,
    });
  });

  it('レシピが切り出す寸法と角丸は、読み込む1枚の寸法とボタンの角丸の2倍に揃っている', () => {
    const { width, height, radius } = recipe.buttonPaper;
    expect({ width, height }).toEqual(SLOT_BUTTON_PAPER_FRAME);
    expect(radius).toBe(SIZE.radius * 2);
  });

  it('生成物は、その1枚をレシピの切り出しの数だけ縦に積んだシート', () => {
    expect(pngSize(resolve(ROOT, recipe.output))).toEqual({
      width: SLOT_BUTTON_PAPER_FRAME.width,
      height: SLOT_BUTTON_PAPER_FRAME.height * recipe.buttonPaper.at.length,
    });
  });
});

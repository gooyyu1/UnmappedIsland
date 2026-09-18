import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 周期の係が諾否の issue へ貼る、候補の一覧のひな型の検査
 * （`agent-ops/prompts/policy-cycle-prompt.md`）。
 *
 * **ひな型の例に、現に在る見出しの名前を置かない。** 例は埋める手本なので、次の周はそれをなぞる
 * ——名指しされた見出しは、その周の検査を通っていなくても候補に挙がる。`docs/DocumentStyle.md`
 * 5節の参照の検査（`docReferences.test.ts`）はここを止められない。あれが見るのは指し先が実在
 * するかで、**実在する見出しを名指ししていること自体がここでの誤り**だから。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPT = join(ROOT, 'agent-ops', 'prompts', 'policy-cycle-prompt.md');

/** 見出しを埋めさせる穴。ひな型にはこれが残っていること。 */
const PLACEHOLDER = '<見出し>';

/** 候補の一覧を見せている囲み。`## 乗せる候補` を含むものが1つだけ在る。 */
function candidateTemplate(): string {
  const blocks = [...readFileSync(PROMPT, 'utf-8').matchAll(/```markdown\r?\n([\s\S]*?)```/g)]
    .map((found) => found[1])
    .filter((block) => block.includes('## 乗せる候補'));
  if (blocks.length !== 1) throw new Error(`候補の一覧の囲みが ${blocks.length} 個`);
  return blocks[0];
}

describe('諾否の issue へ貼る候補のひな型', () => {
  it('どの候補の例も、見出しを名指しせずに穴のまま置いている', () => {
    const items = candidateTemplate()
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- [ ]'));

    expect(items, '候補の例が1つも無い').not.toEqual([]);
    expect(items.filter((line) => !line.includes(PLACEHOLDER))).toEqual([]);
  });
});

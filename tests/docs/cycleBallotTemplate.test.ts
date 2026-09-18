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
 *
 * 見るのは2つ——**穴が残っていること**と、**現に在る見出しを名指ししていないこと**。前者だけでは、
 * 穴と見出しの名前を同じ行へ並べた例が通る。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPT = join(ROOT, 'agent-ops', 'prompts', 'policy-cycle-prompt.md');
const POLICIES = join(ROOT, 'agent-ops', 'policies.md');

/** 見出しを埋めさせる穴。ひな型にはこれが残っていること。 */
const PLACEHOLDER = '<見出し>';

/** 一般則の側に現に在る見出し。ひな型の例がこれを名指ししていたら、次の周がそれをなぞる。 */
function headingsInPolicies(): readonly string[] {
  return [...readFileSync(POLICIES, 'utf-8').matchAll(/^##\s+(\S.*?)\s*$/gm)].map((found) => found[1]);
}

/** 候補の一覧を見せている囲み。`## 乗せる候補` を含むものが1つだけ在る。 */
function candidateTemplate(): string {
  const blocks = [...readFileSync(PROMPT, 'utf-8').matchAll(/```markdown\r?\n([\s\S]*?)```/g)]
    .map((found) => found[1])
    .filter((block) => block.includes('## 乗せる候補'));
  if (blocks.length !== 1) throw new Error(`候補の一覧の囲みが ${blocks.length} 個`);
  return blocks[0];
}

describe('諾否の issue へ貼る候補のひな型', () => {
  /** 候補の例の行。 */
  function items(): readonly string[] {
    const found = candidateTemplate()
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- [ ]'));
    expect(found, '候補の例が1つも無い').not.toEqual([]);
    return found;
  }

  it('どの候補の例も、見出しの位置に穴を残している', () => {
    expect(items().filter((line) => !line.includes(PLACEHOLDER))).toEqual([]);
  });

  // 穴が在ることと、現に在る見出しを名指ししていないことは別——**同じ行に両方書ける。**
  it('どの候補の例も、現に在る見出しを名指ししていない', () => {
    const headings = headingsInPolicies();
    expect(headings, '一般則の側の見出しが1つも読めていない').not.toEqual([]);

    const named = items().flatMap((line) =>
      headings.filter((heading) => line.includes(heading)).map((heading) => `${heading}: ${line}`),
    );
    expect(named, 'ひな型の例が現に在る見出しを名指ししている').toEqual([]);
  });
});

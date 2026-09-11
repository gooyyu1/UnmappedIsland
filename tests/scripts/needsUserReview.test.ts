import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/needs-user-review.sh` が引く線。
 *
 * この判定は**ユーザーへ回すかどうか**を決める関門で、誤りはどちらへ転んでも見えない。緩すぎれば
 * 誰が決めたのか分からない確定が人の目に触れないまま `main` へ入り、厳しすぎれば判断の中身が無いPRが
 * ユーザーのタップを1回増やすだけになる。GitHub の側には何も現れないので、ここで見ていないと誰も
 * 気づけない。
 *
 * `gh` と `git` を PATH の先頭に置いて差し替え、実際にスクリプトを走らせる。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/needs-user-review.sh');

interface Result {
  readonly lines: string[];
  readonly code: number;
}

/** `git show <ref>:<パス>` が返す中身。`base`・`head` を省いたら「そのファイルは無い」。 */
interface Doc {
  readonly base?: string;
  readonly head?: string;
}

/** 差し替えた `gh`・`git` で判定を1回走らせる。`files` は差分のファイル、`diff` は `gh pr diff` の出力。 */
function judge(files: readonly string[], diff: string, docs: Readonly<Record<string, Doc>> = {}): Result {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-needs-user-review-'));
  try {
    const dir = pathForBash(work);
    writeFileSync(join(work, 'files'), `${files.join('\n')}\n`, 'utf-8');
    writeFileSync(join(work, 'diff'), diff, 'utf-8');

    mkdirSync(join(work, 'show'));
    for (const [path, doc] of Object.entries(docs)) {
      for (const [ref, text] of [
        ['base0000', doc.base],
        ['head0000', doc.head],
      ] as const) {
        if (text === undefined) continue;
        writeFileSync(join(work, 'show', `${ref}:${path}`.replace(/[/:]/g, '_')), text, 'utf-8');
      }
    }

    const gh = join(work, 'gh');
    writeFileSync(
      gh,
      `${STUB_SHEBANG}\n` +
        `if [ "$2" = diff ]; then\n  cat '${dir}/diff'\n  exit 0\nfi\n` +
        // `--jq` の式（最後の引数）は本物の `jq` へ渡す——本物の `gh` がするのと同じことなので、
        // 式を変えればここも一緒に動く。スタブが取り出し方を真似ると、式だけ変えても緑のまま通る。
        `if [[ "$*" == *RefOid* ]]; then\n` +
        `  printf '%s' '{"headRefOid":"head0000","baseRefOid":"base0000"}' | jq -r "\${@: -1}"\n` +
        `  exit 0\nfi\n` +
        `cat '${dir}/files'\n`,
      'utf-8',
    );
    chmodSync(gh, 0o755);

    // `git fetch` は通し、`git show <ref>:<パス>` は `docs` に置いたものだけを返す（無ければ失敗）。
    const git = join(work, 'git');
    writeFileSync(
      git,
      `${STUB_SHEBANG}\n` +
        `[ "$1" = fetch ] && exit 0\n` +
        `if [ "$1" = show ]; then\n` +
        `  f="${dir}/show/$(printf '%s' "$2" | tr '/:' '__')"\n` +
        `  [ -f "$f" ] || exit 1\n` +
        `  cat "$f"\n` +
        `  exit 0\n` +
        `fi\n` +
        `exit 1\n`,
      'utf-8',
    );
    chmodSync(git, 0o755);

    const out = spawnScript(SCRIPT, ['900'], {
      env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH ?? ''}` },
    });
    return {
      lines: out.stdout.split('\n').filter((line) => line.trim() !== ''),
      code: out.status ?? -1,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 1ファイルぶんの差分。`lines` は `+`・`-` の付いた行をそのまま並べる。 */
function hunk(path: string, lines: readonly string[]): string {
  return (
    `diff --git a/${path} b/${path}\n` +
    `index 0000000..1111111 100644\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    `@@ -1,3 +1,3 @@\n` +
    `${lines.join('\n')}\n`
  );
}

/**
 * 宣言文法・スキーマへの変更は、**ここでは引かない**（判定するのは差分を読むレビュアー。
 * `.claude/review-criteria.md`「人の判断へ回す」）。ファイルの線で引いていた頃は、スキーマの
 * `description` を変えただけの差分も文法を足した差分も同じに見えていた。
 */
describe('needs-user-review.sh は文法・スキーマのファイルでは止めない', () => {
  it('yaml に書ける形を決めているファイルの、実体の変更でも止めない', () => {
    const result = judge(
      ['src/loader/parsePassives.ts', 'src/domain/DeclaredNumber.ts'],
      hunk('src/loader/parsePassives.ts', [
        "-  const keys = ['self', 'parent'];",
        "+  const keys = ['self', 'parent', 'child'];",
      ]) + hunk('src/domain/DeclaredNumber.ts', ['-  return value;', '+  return value * 2;']),
    );

    expect(result.lines).toEqual([]);
    expect(result.code).toBe(1);
  });

  it('スキーマと文法の仕様書を書き換えても止めない', () => {
    const result = judge(
      ['docs/engine/WorldCodex.schema.json', 'docs/engine/GameElementDefinition.md'],
      hunk('docs/engine/WorldCodex.schema.json', ['-      "type": "string"', '+      "type": "number"']) +
        hunk('docs/engine/GameElementDefinition.md', [
          '-`ancestor` は set/add に書ける。',
          '+`ancestor` は、プロパティ名を伴う場所に書ける。',
        ]),
      {
        'docs/engine/GameElementDefinition.md': {
          base: '# 要素の定義\n\n`ancestor` は set/add に書ける。\n',
          head: '# 要素の定義\n\n`ancestor` は、プロパティ名を伴う場所に書ける。\n',
        },
      },
    );

    expect(result.lines).toEqual([]);
    expect(result.code).toBe(1);
  });
});

/**
 * 印を足したPRを止めるかどうか。**同じ答えに二度目のタップを求めない**ための緩めなので、
 * 緩みすぎれば「誰が決めたのか分からない確定」がそのまま `main` へ入る。
 */
describe('needs-user-review.sh の MARK と SOURCED', () => {
  const PATH = 'docs/ui/Windows.md';
  const HEADING = '## 9.3 未解放レシピの理由は押している間だけ出す';
  const doc = (heading: string, body: readonly string[]): string => `${heading}\n\n${body.join('\n')}\n`;

  it('出どころの1行があるなら、印が増えても止めない', () => {
    const result = judge(
      [PATH],
      hunk(PATH, ['-## 9.3 未解放レシピの理由は押している間だけ出す', `+${HEADING}【確定】`]),
      {
        [PATH]: {
          base: doc(HEADING, ['押している間だけ吹き出しで出す。']),
          head: doc(`${HEADING}【確定】`, [
            '**出どころ**: #656（未解放レシピの理由は押している間の吹き出しで出す）',
            '',
            '押している間だけ出す。',
          ]),
        },
      },
    );

    expect(result.lines).toEqual([`SOURCED ${PATH} 9.3 未解放レシピの理由は押している間だけ出す【確定】`]);
    expect(result.code).toBe(1);
  });

  it('出どころの1行が無い印は、今までどおり止める', () => {
    const result = judge(
      [PATH],
      hunk(PATH, ['-## 9.3 未解放レシピの理由は押している間だけ出す', `+${HEADING}【確定】`]),
      {
        [PATH]: {
          base: doc(HEADING, ['押している間だけ吹き出しで出す。']),
          head: doc(`${HEADING}【確定】`, ['押している間だけ出す。', '', '札には出さない。']),
        },
      },
    );

    expect(result.lines).toEqual([`MARK ${PATH} 9.3 未解放レシピの理由は押している間だけ出す【確定】`]);
    expect(result.code).toBe(0);
  });

  // 出どころの行は、そのPRが決めたことの申告。前から在った確定節に書いてあっても、緩める理由には
  // ならない（印が動いていないので、そもそも `CONFIRMED`）。
  it('前から確定していた節は、出どころがあっても CONFIRMED のまま', () => {
    const result = judge([PATH], hunk(PATH, ['-押している間だけ出す。', '+押している間に出す。']), {
      [PATH]: {
        base: doc(`${HEADING}【確定】`, [
          '**出どころ**: #656（未解放レシピの理由は押している間の吹き出しで出す）',
          '',
          '押している間だけ出す。',
        ]),
        head: doc(`${HEADING}【確定】`, [
          '**出どころ**: #656（未解放レシピの理由は押している間の吹き出しで出す）',
          '',
          '押している間に出す。',
        ]),
      },
    });

    expect(result.lines).toEqual([`CONFIRMED ${PATH} 9.3 未解放レシピの理由は押している間だけ出す【確定】`]);
    expect(result.code).toBe(1);
  });
});

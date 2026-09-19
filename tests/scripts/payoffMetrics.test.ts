import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { KEY_LINES, countCutIssues, countObjectDefs, ratio } from '../../scripts/payoffMetrics.mjs';

/**
 * `npm run stats:payoff`（`scripts/payoffMetrics.mjs`）の検査。
 *
 * **この道具が答えるのは「割に合っているか」**——ゲームが増えた量（`object_defs` の直下キー）と、
 * それに費やした量（`main` へ入ったPR）。読むのは割に合っているかを見る係
 * （`agent-ops/prompts/payoff-prompt.md`）で、**そこが仕組みを変えるかの判断をこの数から出す**ので、
 * 数え間違いはそのまま誤った手になる。
 *
 * 数え方の中身（節の出入り・番号の拾い方）は、**gitを起こさずに引ける形で公開してある**ので
 * そちらを直に見る。CLIの側は、**表が空でないこと**だけを見る（`countLines.mjs` と同じで、
 * 全部0になっても表の形は保たれるため）。
 */

const ROOT = resolve(__dirname, '../..');

describe('countObjectDefs', () => {
  /** `git grep -n <KEY_LINES> <rev>` が返す1行。 */
  const hit = (path: string, line: number, text: string) => `HEAD:${path}:${line}:${text}`;

  it('object_defs の直下キーだけを数える', () => {
    const stdout = [
      hit('src/assets/world-codex/tools.yaml', 1, 'traits:'),
      hit('src/assets/world-codex/tools.yaml', 2, '  weapon:'),
      hit('src/assets/world-codex/tools.yaml', 9, 'object_defs:'),
      hit('src/assets/world-codex/tools.yaml', 10, '  stone_axe:'),
      hit('src/assets/world-codex/tools.yaml', 20, '  sharp_stone:'),
    ].join('\n');
    expect(countObjectDefs(stdout)).toBe(2);
  });

  // **古い置き場も数える。** 2026-08-16 より前の区間は、`world-codex` が `public` の下に在った頃の
  // ものにしか無いので、見落とすと移した週に定義が全部消えたように出る。
  it('古い置き場（public の下に在った頃）の定義も数える', () => {
    const stdout = [
      hit('public/world-codex/foods.yaml', 1, 'object_defs:'),
      hit('public/world-codex/foods.yaml', 2, '  taro:'),
    ].join('\n');
    expect(countObjectDefs(stdout)).toBe(1);
  });

  // **世界の定義ではないYAMLを数えない。** `git grep` はリビジョン全体を引くので、置き場で絞る側が
  // 無いと、翻訳表や workflow のキーまで定義として数える。
  it('world-codex の外のファイルは数えない', () => {
    const stdout = [
      hit('public/locale/ja.yaml', 1, 'object_defs:'),
      hit('public/locale/ja.yaml', 2, '  stone_axe:'),
    ].join('\n');
    expect(countObjectDefs(stdout)).toBe(0);
  });

  // **ファイルが変わったら節から出る。** `object_defs` の途中で終わったファイルの状態を持ち越すと、
  // 次のファイルの先頭のキー（`traits:` の下）まで定義として数える。
  it('前のファイルが object_defs の途中で終わっても、次のファイルへ持ち越さない', () => {
    const stdout = [
      hit('src/assets/world-codex/a.yaml', 1, 'object_defs:'),
      hit('src/assets/world-codex/a.yaml', 2, '  taro:'),
      hit('src/assets/world-codex/b.yaml', 1, '  weapon:'),
    ].join('\n');
    expect(countObjectDefs(stdout)).toBe(1);
  });

  // **区切りの `:` の数では割れない。** パスにも中身にも `:` は入りうるので、前から数えて割ると
  // 列がずれ、**置き場で絞る側が当たらなくなって、その行が黙って数から落ちる。**
  it('パスに `:` が入っていても、置き場で絞る側が当たる', () => {
    const stdout = [
      hit('src/assets/world-codex/a:b.yaml', 1, 'object_defs:'),
      hit('src/assets/world-codex/a:b.yaml', 2, '  stone_axe:'),
      hit('src/assets/world-codex/a:b.yaml', 3, '  note: x:y:z'),
    ].join('\n');
    expect(countObjectDefs(stdout)).toBe(2);
  });

  // **引く式と数える側は対で効く。** 式が2段目のインデントまで引くようになったら、`  ` で始まる行を
  // 直下キーとして数えているここが嘘になる。
  it('引く式が見るのは、トップレベルのキーとその直下だけ', () => {
    expect(KEY_LINES).toBe('^([A-Za-z_][A-Za-z0-9_]*:|  [A-Za-z_][A-Za-z0-9_]*:)');
  });
});

describe('ratio', () => {
  it('増えた区間は、1オブジェクトあたりの本数を出す', () => {
    expect(ratio(24, 3)).toBe('8.0');
  });

  // **増えていない区間に割は無い。** 負のまま出すと、**払った量が多いほど値が小さく（良く）見える**
  // 列になり、定義を減らした週がいちばん割の良い週として並ぶ。
  it('定義が減った区間は、割を出さない', () => {
    expect(ratio(30, -2)).toBe('—');
    expect(ratio(30, 0)).toBe('—');
  });
});

describe('countCutIssues', () => {
  // **数えるのは箇条書きの先頭の番号だけ。** 行の後ろには出どころのPRの番号が並ぶので、節の中の
  // `#数字` を全部数えると、切った issue の数がPRの数だけ水増しされる。
  it('1行に並んだ出どころのPRの番号を、切った issue に数えない', () => {
    const text = [
      '## 読んだ範囲',
      '',
      '- #1000 から #1010 まで。',
      '',
      '## 切った issue',
      '',
      '- **#2299** — 数え上げの残り。PR #2210 の2周と #2211 が挙げた。',
      '- **#2300** — 一次レビューが本番コードを書き換えられる。PR #2250。',
      '',
      '## 落としたもの',
      '',
      'なし。',
      '',
    ].join('\n');
    expect(countCutIssues(text)).toBe(2);
  });

  it('1件も切らなかった回は0', () => {
    const text = ['## 切った issue', '', 'なし。', '', '## 落としたもの', ''].join('\n');
    expect(countCutIssues(text)).toBe(0);
  });

  // 節そのものが無い記録（二次の係の要約など）は、この表に出さない。
  it('節を持たない記録は undefined', () => {
    expect(countCutIssues('## 傾向\n\n同じ形が3回。\n')).toBeUndefined();
  });
});

describe('npm run stats:payoff', () => {
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }).trim();

  function run(): { readonly stdout: string; readonly status: number } {
    try {
      return {
        stdout: execFileSync('node', [join(ROOT, 'scripts/payoffMetrics.mjs')], {
          cwd: ROOT,
          encoding: 'utf-8',
        }),
        status: 0,
      };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { stdout: failure.stdout ?? '', status: failure.status ?? 1 };
    }
  }

  // **浅いクローンでは表を出さずに落ちる**（`requireFullHistory`）。今の定義の数は1コミットからでも
  // 出せてしまうので、そこで表を出すと**過去の列が欠けたまま「測れた」形の表**になる。
  it.runIf(shallow === 'true')('浅いクローンでは、表を出さずに落ちる', () => {
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('オブジェクト定義');
  });

  // **0でないことを見る。** 表の形は全部0でも保たれるので、形だけ見ていると数え方が壊れたことに
  // 気づけない（`countLines.mjs` で挙がった issue #867 と同じ形）。
  it.runIf(shallow !== 'true')('オブジェクト定義の数も、入ったPRの数も0ではない', () => {
    const result = run();
    expect(result.status).toBe(0);
    // **後ろの表と混ぜない。** 分析の回の表も `| <日付> |` で始まるので、行の形だけで引くと
    // 列の数が違うものが混ざり、数を読む位置がずれる。
    const [growth = ''] = result.stdout.split('\n## 仕組みが自分で作った仕事');
    const rows = growth
      .split('\n')
      .filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line))
      .map((line) => line.split('|').map((cell) => cell.trim()));
    expect(rows.length).toBeGreaterThan(1);
    // 今の定義の数は、最後の行がそのまま持っている。
    expect(Number(rows[rows.length - 1][2])).toBeGreaterThan(0);
    // **PRの本数は区間を通して見る。** 最後の区間は**今日まで**なので、マージが1本も無い週に
    // 当たると、数え方が壊れていなくても0になる。先頭の行は区間の始まりで `—` が入るので外す。
    const spent = rows.slice(1).reduce((sum, row) => sum + Number(row[4]), 0);
    expect(spent).toBeGreaterThan(0);
  });
});

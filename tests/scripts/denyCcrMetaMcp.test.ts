import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runScript } from '../support/runScript';

/**
 * `.claude/hooks/deny-ccr-meta-mcp.sh` が、メタMCPを呼んだところで正しい入口へ案内することの検査。
 *
 * **案内が出るかどうかは、`settings.json` の matcher が `mcp__ccr_meta__*` に当たるかで決まる。**
 * 当たらなければフックは呼ばれず、拒否もされないまま素通りする——そのとき起きるのは「使えなくて
 * 諦める」で、これは何も鳴らずに終わる（`policies.md`「仕組みの作り方」の、塞ぐより案内板にする）。
 */

// 実プロセス（bash）を起こすので、既定の5秒では足りないことがある。
vi.setConfig({ testTimeout: 20000 });

const REPO = resolve(__dirname, '../..');
const HOOK = resolve(REPO, '.claude/hooks/deny-ccr-meta-mcp.sh');
const ENTRY = resolve(REPO, '.claude/ccr-meta.sh');

interface Matcher {
  readonly matcher?: string;
  readonly hooks?: readonly { readonly command?: string }[];
}

interface Decision {
  readonly hookEventName?: string;
  readonly permissionDecision?: string;
  readonly permissionDecisionReason?: string;
}

function decision(): Decision {
  const parsed: unknown = JSON.parse(runScript(HOOK, [], {}));
  return (parsed as { hookSpecificOutput?: Decision }).hookSpecificOutput ?? {};
}

/**
 * 入口（`.claude/ccr-meta.sh`）の冒頭のコメント。**行頭の `#` を落としてから繋ぐ**——残すと、写しの
 * 判定が入口側の**行折り返しの位置**に依る（折り返しをまたぐ写しが `#` で断ち切られて抜ける）。
 */
function entryComment(): string {
  return readFileSync(ENTRY, 'utf-8').replace(/^#+ ?/gm, '');
}

/** 入口のコメントが持つ節の見出し。 */
function entrySections(): string[] {
  return entryComment()
    .split(/\r?\n/)
    .flatMap((line) => /^#{2,6}\s+(\S.*?)\s*$/.exec(line)?.[1] ?? []);
}

/** 引く側と引かれる側で揃わない記号を落として突き合わせる形にする。 */
function normalize(text: string): string {
  return text.replace(/[\s*`「」]/g, '');
}

/**
 * 案内の散文。**呼び方の例示（字下げした行）は外す**——あれは入口の使い方そのものなので、入口の
 * 冒頭と同じ形になるのが正しい。
 */
function reasonProse(): string {
  return normalize(
    (decision().permissionDecisionReason ?? '')
      .split('\n')
      .filter((line) => !line.startsWith('  '))
      .join('\n'),
  );
}

/**
 * 案内が入口と続けて同じ字面を持ってよい長さ。**入口の在り処と、そこで何が呼べるかを名指しする
 * ぶんで足りる**（2026-09-18 の実測で、正しい状態の最長は21字）。理由の一文を写し戻すと54字に
 * なるので、どちらからも離れたところで分ける。
 */
const COPY_RUN = 32;

function preToolUse(): readonly Matcher[] {
  const settings: unknown = JSON.parse(readFileSync(resolve(REPO, '.claude/settings.json'), 'utf-8'));
  return (settings as { hooks?: { PreToolUse?: readonly Matcher[] } }).hooks?.PreToolUse ?? [];
}

describe('deny-ccr-meta-mcp.sh', () => {
  it('拒否して、正しい入口の呼び方を理由に書く', () => {
    const output = decision();

    expect(output.hookEventName).toBe('PreToolUse');
    expect(output.permissionDecision).toBe('deny');
    expect(output.permissionDecisionReason).toContain('.claude/ccr-meta.sh');
    // 入口を名指しするだけでは、そこから先が分からず結局止まる。呼び方まで渡す。
    expect(output.permissionDecisionReason).toContain('bash .claude/ccr-meta.sh');
  });

  /**
   * **なぜシェルへ載せると壊れるかを持つのは入口の節ひとつ**で、ここはそこを名指しするだけ
   * （`CLAUDE.md`「同じ説明を複数箇所に書かない」）。写しを置くと、片方だけが古くなる。
   *
   * **鉤括弧は全部見る。** 案内が引くのは入口の節だけなので、節でないものを引いたらそれも赤くする
   * ——「どれが節の名前か」を字面で見分ける仕組みは、ここには無い。
   */
  it('入口の節を名指しで指し、その節が実在する', () => {
    const reason = decision().permissionDecisionReason ?? '';
    const quoted = [...reason.matchAll(/「([^」]+)」/g)].map((match) => match[1]);
    const sections = entrySections().map(normalize);
    const missing = quoted.filter((name) => !sections.some((heading) => heading.includes(normalize(name))));

    // 節を指していなければ、読み手は冒頭のどこを読めばよいか分からない。
    expect(quoted, `理由を持つ節を名指ししていない:\n${reason}`).not.toHaveLength(0);
    // 畳まれた節を指したままでは、案内が行き止まりになる。
    expect(missing, `入口に無い節を指している:\n${missing.join('\n')}`).toEqual([]);
  });

  it('要旨だけを書き、入口の文面を写さない', () => {
    const prose = reasonProse();
    const entry = normalize(entryComment());
    const copied = [...Array(Math.max(prose.length - COPY_RUN + 1, 0)).keys()]
      .map((start) => prose.slice(start, start + COPY_RUN))
      .filter((run) => entry.includes(run));

    // 案内が空でも「写しが無い」で通ってしまうので、拾える長さが在ることを先に見る。
    expect(prose.length).toBeGreaterThan(COPY_RUN);
    expect(copied, `入口からの写し:\n${copied.join('\n')}`).toEqual([]);
  });

  it('メタMCPの道具名に当たる matcher から呼ばれている', () => {
    const registered = preToolUse().filter((entry) =>
      (entry.hooks ?? []).some((hook) => hook.command?.includes('deny-ccr-meta-mcp.sh') === true),
    );

    expect(registered).not.toHaveLength(0);
    for (const name of ['mcp__ccr_meta__create_session', 'mcp__ccr_meta__list_sessions']) {
      expect(registered.some((entry) => new RegExp(entry.matcher ?? '').test(name))).toBe(true);
    }
  });

  // `settings.json` はフックをパスで直に起動するので、POSIX側（クラウドのセッションはLinux）では
  // 実行ビットが要る。Windowsの作業ツリーでは欠けても動くため、gitのインデックスの側を見る。
  it('実行ビットが立っている', () => {
    const listed = execFileSync('git', ['ls-files', '-s', '.claude/hooks/deny-ccr-meta-mcp.sh'], {
      cwd: REPO,
      encoding: 'utf-8',
    });

    expect(listed.startsWith('100755 ')).toBe(true);
  });
});

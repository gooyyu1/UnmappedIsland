import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/merge-and-close.sh` が出す行の検査。
 *
 * **後戻りできない操作をする唯一の司令塔スクリプト**なので、素通しの条件だけは機械で見る。
 * コンフリクトしたPRでマージへ進むと、失敗するだけでなく、司令塔は片付いたつもりで次へ行く。
 *
 * `gh` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替えて、実際にスクリプトを走らせる。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-and-close.sh');

interface World {
  readonly mergeable?: string;
  readonly body?: string;
  /** issue番号ごとの `state`。 */
  readonly issues?: Record<number, string>;
  /** セッションIDごとの `session_status`。 */
  readonly sessions?: Record<string, string>;
}

interface Run {
  readonly lines: string[];
  readonly status: number;
  /** `gh pr merge` が呼ばれたか。 */
  readonly merged: boolean;
  /** `archive_session` を呼ばれたセッション。 */
  readonly archived: string[];
}

function run(world: World): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-merge-and-close-'));
  try {
    const dir = work.replace(/\\/g, '/');
    // 本文は改行もバッククォートも含むので、シェルへ埋め込まずファイルで渡す。
    writeFileSync(join(work, 'body.txt'), world.body ?? '', 'utf-8');

    const branches = (cases: Record<string | number, string>): string =>
      Object.entries(cases)
        .map(([key, value]) => `    ${key}) printf '%s' '${value}' ;;`)
        .join('\n');

    // PRの `state` は、マージが呼ばれたかで変わる。
    const stub = join(work, 'gh');
    writeFileSync(
      stub,
      `#!/usr/bin/env bash
if [ "$1" = pr ] && [ "$2" = merge ]; then
  touch '${dir}/merged'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    body) cat '${dir}/body.txt' ;;
    mergeable) printf '%s' '${world.mergeable ?? 'MERGEABLE'}' ;;
    state) if [ -e '${dir}/merged' ]; then printf '%s' MERGED; else printf '%s' OPEN; fi ;;
  esac
  exit 0
fi
if [ "$1" = issue ] && [ "$2" = view ]; then
  case "$3" in
${branches(world.issues ?? {})}
  esac
  exit 0
fi
exit 1
`,
      'utf-8',
    );
    chmodSync(stub, 0o755);

    // 引数は標準入力のJSON。`ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `#!/usr/bin/env bash
id=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).session_id))')
if [ "$1" = archive_session ]; then
  echo "$id" >> '${dir}/archived'
  exit 0
fi
echo '<other-session>'
case "$id" in
${Object.entries(world.sessions ?? {})
  .map(([id, status]) => `  ${id}) echo '{"ccr":{"session_status":"${status}"}}' ;;`)
  .join('\n')}
esac
`,
      'utf-8',
    );

    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [SCRIPT, '1000'], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH ?? ''}`, CCR_META: meta },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 1;
      out = failure.stdout ?? '';
    }
    const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');
    return {
      lines: lines(out),
      status,
      merged: existsSync(join(work, 'merged')),
      archived: existsSync(join(work, 'archived'))
        ? lines(readFileSync(join(work, 'archived'), 'utf-8'))
        : [],
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('merge-and-close.sh', () => {
  it('コンフリクトしているPRはマージせずに終わる', () => {
    const result = run({ mergeable: 'CONFLICTING' });

    expect(result.merged).toBe(false);
    expect(result.status).toBe(1);
  });

  it('マージして、Closes の issue が閉じたことと、PRを出したセッションを畳んだことを出す', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01AAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01AAA: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'ARCHIVED session_01AAA']);
    expect(result.archived).toEqual(['session_01AAA']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['MERGED 1000', 'OPEN 1033']);
    expect(result.status).toBe(2);
  });

  it('畳み済みのセッションは畳み直さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01AAA',
      sessions: { session_01AAA: 'SESSION_STATUS_ARCHIVED' },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000']);
  });
});

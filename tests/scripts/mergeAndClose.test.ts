import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/merge-and-close.sh` が出す行の検査。
 *
 * **後戻りできない操作をする唯一の司令塔スクリプト**なので、素通しの条件だけは機械で見る。
 * コンフリクトしたPRでマージへ進むと、失敗するだけでなく、司令塔は片付いたつもりで次へ行く。
 *
 * `gh`・`git`・`npm` を PATH の先頭に、`ccr-meta.sh` を `CCR_META` で差し替えて、実際にスクリプトを
 * 走らせる。本体（`git` が差す先）も作業用の一時ディレクトリに作るので、手元のリポジトリは動かない。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/merge-and-close.sh');

/**
 * 脚注の無い本文は `NOSESSION` を出すので、脚注の話でない試験には既定でこれを持たせる。
 * 指す先は畳み済みなので、`ARCHIVED` の行も増えない。
 */
const DEFAULT_BODY = '_[Claude Code](https://claude.ai/code/session_01ZZZZZZZZZZZZZZZZZZZZZZ)_';

interface World {
  readonly mergeable?: string;
  readonly body?: string;
  /** issue番号ごとの `state`。 */
  readonly issues?: Record<number, string>;
  /** セッションIDごとの `session_status`。 */
  readonly sessions?: Record<string, string>;
  /** `archive_session` が失敗するか。 */
  readonly archiveFails?: boolean;
  /** 本体に未コミットの変更（追跡済み）があるか。 */
  readonly mainDirty?: boolean;
  /** マージで `package-lock.json` が変わったか。 */
  readonly lockChanged?: boolean;
  /** 本体に依存が入っているか。既定は入っている。 */
  readonly mainInstalled?: boolean;
  /** 関門（`needs-user-review.sh`）が出す理由。既定は該当なしで、関門は開いている。 */
  readonly gate?: readonly string[];
  /** 関門の終了コード。既定は理由の有無から決まる（あれば 0、無ければ 1）。 */
  readonly gateStatus?: number;
  /** `--user-ok` を付けて叩くか。 */
  readonly userOk?: boolean;
}

interface Run {
  readonly lines: string[];
  readonly status: number;
  /** `gh pr merge` が呼ばれたか。 */
  readonly merged: boolean;
  /** `archive_session` を呼ばれたセッション。 */
  readonly archived: string[];
  /** 本体で `npm install` が走ったか。 */
  readonly installed: boolean;
  /** `git` に渡された引数。 */
  readonly git: string[];
  /** `gh pr edit` に渡されたラベルの操作。 */
  readonly labels: string[];
  /** PRへ書いたコメントの本文。 */
  readonly comments: string;
}

function run(world: World): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-merge-and-close-'));
  try {
    const dir = work.replace(/\\/g, '/');
    // 本文は改行もバッククォートも含むので、シェルへ埋め込まずファイルで渡す。
    writeFileSync(join(work, 'body.txt'), world.body ?? DEFAULT_BODY, 'utf-8');

    // 本体の身代わり。`.git` があることでスクリプトの `--git-common-dir` からの辿りが成り立つ。
    mkdirSync(join(work, 'main', '.git'), { recursive: true });
    if (world.mainInstalled ?? true) {
      mkdirSync(join(work, 'main', 'node_modules'), { recursive: true });
      writeFileSync(join(work, 'main', 'node_modules', '.package-lock.json'), '{}', 'utf-8');
    }

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
if [ "$1" = pr ] && [ "$2" = edit ]; then
  shift 3
  echo "$*" >> '${dir}/labels'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = comment ]; then
  cat "$5" >> '${dir}/comments'
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

    // `HEAD:package-lock.json` の中身は、`checkout` を境に変わる（マージで依存が動いた場合）。
    const git = join(work, 'git');
    writeFileSync(
      git,
      `#!/usr/bin/env bash
echo "$*" >> '${dir}/git-calls'
case "$*" in
  *'rev-parse --git-common-dir'*) printf '%s' '${dir}/main/.git' ;;
  *'status --porcelain'*) printf '%s' '${world.mainDirty === true ? ' M docs/x.md' : ''}' ;;
  *'HEAD:package-lock.json'*)
    if [ -e '${dir}/checked-out' ]; then printf '%s' '${world.lockChanged === true ? 'bbb222' : 'aaa111'}'
    else printf '%s' 'aaa111'; fi ;;
  *'rev-parse --short HEAD'*) printf '%s' 'deadbee' ;;
  *checkout*) touch '${dir}/checked-out' ;;
esac
exit 0
`,
      'utf-8',
    );
    chmodSync(git, 0o755);

    const npm = join(work, 'npm');
    writeFileSync(npm, `#!/usr/bin/env bash\necho "$*" >> '${dir}/npm-calls'\n`, 'utf-8');
    chmodSync(npm, 0o755);

    // 関門。理由が1件でもあれば 0（＝該当あり）を返す。`needs-user-review.sh` と同じ約束。
    const gate = join(work, 'needs-user-review.sh');
    writeFileSync(
      gate,
      `#!/usr/bin/env bash\n${(world.gate ?? []).map((line) => `echo '${line}'`).join('\n')}\nexit ${
        world.gateStatus ?? ((world.gate ?? []).length > 0 ? 0 : 1)
      }\n`,
      'utf-8',
    );

    // 引数は標準入力のJSON。`ccr-meta.sh` と同じ包み（`<other-session>`）を付けて返す。
    const meta = join(work, 'ccr-meta.sh');
    writeFileSync(
      meta,
      `#!/usr/bin/env bash
id=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).session_id))')
if [ "$1" = archive_session ]; then
  echo "$id" >> '${dir}/archived'
  exit ${world.archiveFails === true ? 1 : 0}
fi
echo '<other-session>'
case "$id" in
${Object.entries({ session_01ZZZZZZZZZZZZZZZZZZZZZZ: 'SESSION_STATUS_ARCHIVED', ...world.sessions })
  .map(([id, status]) => `  ${id}) echo '{"ccr":{"session_status":"${status}"}}' ;;`)
  .join('\n')}
esac
`,
      'utf-8',
    );

    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [SCRIPT, '1000', ...(world.userOk === true ? ['--user-ok'] : [])], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
          CCR_META: meta,
          NEEDS_USER_REVIEW: gate,
        },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 1;
      out = failure.stdout ?? '';
    }
    const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');
    const logged = (name: string): string[] =>
      existsSync(join(work, name)) ? lines(readFileSync(join(work, name), 'utf-8')) : [];
    return {
      lines: lines(out),
      status,
      merged: existsSync(join(work, 'merged')),
      archived: logged('archived'),
      installed: logged('npm-calls').length > 0,
      git: logged('git-calls'),
      labels: logged('labels'),
      comments: existsSync(join(work, 'comments')) ? readFileSync(join(work, 'comments'), 'utf-8') : '',
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

  // 司令塔の判断では越えられない関門。越えるにはユーザーの許可を引いて `--user-ok` で叩き直す。
  it('関門に掛かったPRはマージせず、判断待ちを付けて理由ごと HELD で返す', () => {
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'] });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    GRAMMAR src/domain/DeclaredNumber.ts']);
    expect(result.labels).toEqual(['--add-label 判断待ち']);
    expect(result.status).toBe(1);
  });

  // 関門は「調べられなかった」ときも該当ありとして閉じる。開いたままにすると、`gh` が転んだ日は
  // 全部が素通しになる。
  it('関門が調べられなかったときも止める', () => {
    const result = run({ gate: ['PR #1000 のファイル一覧を引けなかった'], gateStatus: 2 });

    expect(result.merged).toBe(false);
    expect(result.lines).toEqual(['HELD 1000', '    PR #1000 のファイル一覧を引けなかった']);
  });

  it('--user-ok なら、許可を受けたことをPRへ残してからマージする', () => {
    const result = run({ gate: ['GRAMMAR src/domain/DeclaredNumber.ts'], userOk: true });

    expect(result.merged).toBe(true);
    expect(result.comments).toContain('GRAMMAR src/domain/DeclaredNumber.ts');
    expect(result.labels).toEqual(['--remove-label 判断待ち']);
    expect(result.status).toBe(0);
  });

  it('関門に掛からないPRは、--user-ok を付けなくてもコメントを残さずマージする', () => {
    const result = run({});

    expect(result.merged).toBe(true);
    expect(result.comments).toBe('');
    expect(result.labels).toEqual([]);
  });

  it('マージして、Closes の issue が閉じたことと、PRを出したセッションを畳んだことを出す', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01AAAAAAAAAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01AAAAAAAAAAAAAAAAAAAAAA']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: `Closes #1033\n\n${DEFAULT_BODY}`, issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['MERGED 1000', 'OPEN 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(2);
  });

  // 本文を書き直した拍子に脚注が落ちる（PR #1083 で実際に落ちた）。黙って畳まずに済ませると、
  // 走ったままのセッションが誰にも数えられずに残る。
  it('本文に脚注が無ければ、畳む相手が分からなかったことを残りとして報せる', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'CLOSED' } });

    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'NOSESSION 1000', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(2);
  });

  // 本文が脚注の**書き方を説明している**ことがある（このPR自身がそうだった）。
  it('脚注の書き方を引用しているだけの文字列は、畳む相手にしない', () => {
    const result = run({
      body: `末尾に \`https://claude.ai/code/session_...\` が入る。\n\n${DEFAULT_BODY}`,
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
    expect(result.status).toBe(0);
  });

  // マージは済んでいるので、ここで落ちると `main` の追随ごと落ちる。
  it('畳めなかったときも止まらず、後片付けを済ませてから残りとして報せる', () => {
    const result = run({
      sessions: { session_01ZZZZZZZZZZZZZZZZZZZZZZ: 'SESSION_STATUS_RUNNING' },
      archiveFails: true,
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'UNARCHIVED session_01ZZZZZZZZZZZZZZZZZZZZZZ',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(2);
  });

  it('畳み済みのセッションは畳み直さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA',
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_ARCHIVED' },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
  });

  // 作業ツリーは本体の `node_modules` を共有するので、本体が古いままだと版が食い違う。
  // `main` を動かしているのはこのスクリプトなので、ここで一緒に進める。
  it('マージしたら、本体のチェックアウトをブランチを持たせずに新しい main へ進める', () => {
    const result = run({});

    expect(result.git.some((call) => call.includes('fetch --quiet origin main'))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout --quiet --detach origin/main'))).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(0);
  });

  it('依存が変わったときだけ、本体で npm install する', () => {
    expect(run({ lockChanged: true }).installed).toBe(true);
    expect(run({ lockChanged: true }).lines).toContain('INSTALLED');
    expect(run({ lockChanged: false }).installed).toBe(false);
  });

  it('本体に依存が入っていなければ、変わっていなくても入れる', () => {
    expect(run({ mainInstalled: false }).installed).toBe(true);
  });

  it('本体に未コミットの変更があれば触らず、残りとして報せる', () => {
    const result = run({ mainDirty: true });

    expect(result.lines.some((line) => line.startsWith('DIRTY '))).toBe(true);
    expect(result.git.some((call) => call.includes('checkout'))).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.status).toBe(2);
  });
});

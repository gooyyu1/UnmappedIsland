import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeMetaServer, metaReply, wrappedMetaReply, writeFakeCredentials } from '../support/fakeMetaServer';
import type { ScriptRun } from '../support/runScript';

/**
 * `scripts/daemon/dispatch-session.mjs` が、**「打てなかった」（1）で終わるときに立てたものを残さない**
 * ことの検査（`agent-ops/board-design.md` 1.4.3節）。
 *
 * 盤面は1を「打てなかった」と読んで台帳に控えず、次の周に同じ手を打ち直す。**立てた1本が残って
 * いれば二重に立つ**（issue #1984）。見るのは**CCRへ `archive_session` が届いたか**と終了コードの組。
 */

const SCRIPT = resolve(__dirname, '../../scripts/daemon/dispatch-session.mjs');
const SESSION = 'session_dispatched';
const TAG = 'chore-test';
const PROMPT = '送った指示\n`ident` を読む';

/** 身代わりの応答の選び方。省いたものは「確認が全部通る」側。 */
interface World {
  readonly sources?: readonly unknown[];
  readonly seed?: string;
  readonly archive?: 'ok' | 'fails';
  /** 読めない応答を返す道具。 */
  readonly broken?: string;
}

function answer({
  sources = [{ git_repository: { url: 'https://github.com/o/r', revision: 'main' } }],
  seed = PROMPT,
  archive = 'ok',
  broken,
}: World) {
  return (request: { body: string }): string => {
    const { name } = JSON.parse(request.body).params as { name: string };
    if (name === broken) return 'not json';
    switch (name) {
      case 'create_session':
        return metaReply(JSON.stringify({ ccr: { id: SESSION } }));
      case 'get_session':
        return wrappedMetaReply({
          ccr: {
            id: SESSION,
            session_status: 'SESSION_STATUS_RUNNING',
            tags: [TAG],
            session_context: { sources },
          },
        });
      case 'list_events': {
        const data =
          seed === ''
            ? []
            : [
                {
                  user: {
                    internal_anthropic_catchall: {
                      inbound_origin: 'mcp_create_session',
                      message: { content: seed },
                    },
                  },
                },
              ];
        return wrappedMetaReply({ ccr: { data, has_more: false } });
      }
      case 'archive_session':
        return archive === 'ok'
          ? metaReply('archived')
          : JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: '畳めない' } });
      default:
        return metaReply('ok');
    }
  };
}

describe('dispatch-session.mjs', () => {
  const server = new FakeMetaServer();
  let endpoint = '';
  let work = '';

  beforeEach(async () => {
    endpoint = await server.listen();
    server.received.length = 0;
    work = mkdtempSync(join(tmpdir(), 'unmapped-island-dispatch-session-'));
    writeFakeCredentials(work);
    writeFileSync(join(work, 'title.txt'), '係 試験\n', 'utf-8');
    writeFileSync(join(work, 'prompt.md'), `${PROMPT}\n`, 'utf-8');
  });

  afterEach(async () => {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  });

  /** 叩いた道具の名前を、届いた順に。 */
  const called = () => server.received.map((request) => JSON.parse(request.body).params.name as string);

  function run(world: World): Promise<ScriptRun> {
    server.reply = answer(world);
    const child = spawn(
      process.execPath,
      [
        SCRIPT,
        'chore',
        '--env',
        'env_TEST',
        '--tag',
        TAG,
        '--title',
        join(work, 'title.txt'),
        '--prompt',
        join(work, 'prompt.md'),
        '--source',
        'https://github.com/o/r',
      ],
      {
        env: {
          ...process.env,
          CCR_META_ENDPOINT: endpoint,
          HOME: work,
          USERPROFILE: work,
          // 種が載らない側を、待たずに見る。
          CCR_CHECK_WAIT_SECONDS: '0',
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    return new Promise((done) => child.on('close', (code) => done({ code: code ?? -1, stdout, stderr })));
  }

  it('届いたと確かめられたら、畳まずに0で終わる', async () => {
    const done = await run({});

    expect(done.code).toBe(0);
    expect(called()).not.toContain('archive_session');
  });

  // issue #1984 の1件目・2件目の形——届いていたが、待ちの間に記録へ出なかった。
  it('種の指示が記録に出なければ、立てた1本を畳んで1で終わる', async () => {
    const done = await run({ seed: '' });

    expect(done.code).toBe(1);
    expect(called()).toContain('archive_session');
    expect(done.stdout).toContain(`ARCHIVED ${SESSION}`);
  });

  it('届いた本文が違えば、立てた1本を畳んで1で終わる', async () => {
    const done = await run({ seed: '別の指示' });

    expect(done.code).toBe(1);
    expect(done.stdout).toContain(`ARCHIVED ${SESSION}`);
  });

  it('空の箱で起動していれば、立てた1本を畳んで1で終わる', async () => {
    const done = await run({ sources: [] });

    expect(done.code).toBe(1);
    expect(done.stdout).toContain(`ARCHIVED ${SESSION}`);
  });

  // issue #1984 の3件目の形——立てた後の通信が転んだ。外の `catch` へ落ちると畳まれない。
  it('立てた後の確認で通信が転んでも、立てた1本を畳んで1で終わる', async () => {
    const done = await run({ broken: 'list_events' });

    expect(done.code).toBe(1);
    expect(done.stdout).toContain(`ARCHIVED ${SESSION}`);
  });

  // **残っているものを「打てなかった」とは言わない。** 言えば盤面が打ち直して2本になる。
  it('畳めなければ、打てたものとして0で終わる', async () => {
    const done = await run({ seed: '', archive: 'fails' });

    expect(called()).toContain('archive_session');
    expect(done.code).toBe(0);
    expect(done.stderr).toContain('打てたものとして返す');
  });
});

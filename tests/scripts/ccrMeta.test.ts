import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_TOKEN, FakeMetaServer, writeFakeCredentials } from '../support/fakeMetaServer';

/**
 * `.claude/ccr-meta.mjs` が、標準入力で受けた引数をそのままMCPへ渡すことの検査。
 *
 * **見るのは、多バイト文字がチャンクの境目で割れないこと**（理由は `readStdinAsUtf8` の説明）。
 *
 * 通信先は `CCR_META_ENDPOINT` で身代わりのHTTPサーバへ向ける。トークンの置き場は `USERPROFILE` /
 * `HOME` を差し替えて用意する——本物の `~/.claude/.credentials.json` はCIには無い。
 */

const SCRIPT = resolve(__dirname, '../../.claude/ccr-meta.mjs');

describe('.claude/ccr-meta.mjs', () => {
  let server: FakeMetaServer;
  let endpoint: string;
  let home: string;

  beforeEach(async () => {
    server = new FakeMetaServer();
    endpoint = await server.listen();
    home = mkdtempSync(join(tmpdir(), 'unmapped-island-ccr-meta-'));
    writeFakeCredentials(home);
  });

  afterEach(async () => {
    await server.close();
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * **同期で起こさない**（理由は [`fakeMetaServer`](../support/fakeMetaServer.ts) の冒頭）。標準入力へ
   * 引数を流すのはここだけなので、`spawnScriptAsync` ではなく自分で起こす。
   */
  function run(tool: string, args: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const child = spawn('node', [SCRIPT, tool], {
      env: { ...process.env, CCR_META_ENDPOINT: endpoint, USERPROFILE: home, HOME: home },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.stdin.end(args, 'utf-8');

    return new Promise((done) => {
      child.on('close', (code) => done({ stdout, stderr, code: code ?? 1 }));
    });
  }

  it('64KiBの境目を跨ぐ日本語が、1文字も欠けずに届く', async () => {
    // 先頭からの byte 数が 64KiB を跨いだところに文字が来るだけの長さ。
    const prompt = `${'あ'.repeat(30000)}・A > B・\`ident\``;
    expect(Buffer.byteLength(prompt, 'utf8')).toBeGreaterThan(64 * 1024);

    const result = await run('create_session', JSON.stringify({ prompt }));

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
    expect(server.received).toHaveLength(1);
    const sent: unknown = JSON.parse(server.received[0].body);
    expect(sent).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_session', arguments: { prompt } },
    });
  });

  it('トークンは、呼ばれたときに置き場から読んで載せる', async () => {
    expect((await run('list_sessions', '{"limit": 1}')).code).toBe(0);

    expect(server.received[0].authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('JSONで返らなかったときは、HTTPの状態と本文を残して失敗する', async () => {
    server.status = 401;
    server.reply = 'Unauthorized';

    const result = await run('list_sessions', '{}');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('401');
    expect(result.stderr).toContain('Unauthorized');
  });
});

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `.claude/ccr-meta.mjs` が、標準入力で受けた引数をそのままMCPへ渡すことの検査。
 *
 * **見るのは、多バイト文字がチャンクの境目で割れないこと**（理由は `readStdinAsUtf8` の説明）。
 *
 * 通信先は `CCR_META_ENDPOINT` で身代わりのHTTPサーバへ向ける。トークンの置き場は `USERPROFILE` /
 * `HOME` を差し替えて用意する——本物の `~/.claude/.credentials.json` はCIには無い。
 */

// 実プロセス（node）を起こしてHTTPを往復させるので、既定の5秒では足りないことがある。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../.claude/ccr-meta.mjs');

const TOKEN = 'test-access-token';

interface Received {
  readonly body: string;
  readonly authorization: string | undefined;
}

/** 身代わりのMCPサーバ。受けた本文をそのまま覚え、`text` を1つ返す。 */
class FakeMetaServer {
  private readonly server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      this.received.push({
        body: Buffer.concat(chunks).toString('utf8'),
        authorization: request.headers.authorization,
      });
      response.writeHead(this.status, { 'content-type': 'application/json' });
      response.end(this.reply);
    });
  });

  readonly received: Received[] = [];

  status = 200;
  reply = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } });

  async listen(): Promise<string> {
    await new Promise<void>((done) => this.server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`;
  }

  async close(): Promise<void> {
    await new Promise<void>((done) => this.server.close(() => done()));
  }
}

describe('.claude/ccr-meta.mjs', () => {
  let server: FakeMetaServer;
  let endpoint: string;
  let home: string;

  beforeEach(async () => {
    server = new FakeMetaServer();
    endpoint = await server.listen();
    home = mkdtempSync(join(tmpdir(), 'unmapped-island-ccr-meta-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }),
      'utf-8',
    );
  });

  afterEach(async () => {
    await server.close();
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * **同期で起こさない。** 身代わりのサーバはこのプロセスに居るので、`execFileSync` などで待つと
   * イベントループごと止まり、子が投げた要求に誰も応えないまま両方が待ち続ける。
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

    expect(server.received[0].authorization).toBe(`Bearer ${TOKEN}`);
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

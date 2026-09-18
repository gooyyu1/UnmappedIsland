import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * メタMCP（`.claude/ccr-meta.mjs`）の通信先の身代わり。**叩く側が `bash` でも `node` でも同じものを
 * 使う**ので、差し替え口の形（`CCR_META_ENDPOINT` と資格情報の置き場）を覚えるのはここ1箇所でよい。
 *
 * **同期で子を待たない。** このサーバは試験と同じプロセスに居るので、`execFileSync` などで待つと
 * イベントループごと止まり、子が投げた要求に誰も応えないまま両方が待ち続ける
 * （[`runScript`](runScript.ts) の `spawnScriptAsync`）。
 */

/** 身代わりが受けた要求1件。 */
export interface MetaRequest {
  readonly body: string;
  readonly authorization: string | undefined;
}

/** MCPの応答1つ。中身は text コンテンツ1件で、`callMeta` はこれをそのまま返す。 */
export function metaReply(text: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
}

/**
 * 他のセッションの記録は `<other-session>` の包みに入って返る。**包みごと組む**ので、叩く側が
 * 包みをほどけることまで検査に入る。
 */
export function wrappedMetaReply(payload: unknown): string {
  return metaReply(`<other-session>\n${JSON.stringify(payload)}`);
}

export class FakeMetaServer {
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

  readonly received: MetaRequest[] = [];

  status = 200;
  reply = metaReply('ok');

  async listen(): Promise<string> {
    await new Promise<void>((done) => this.server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`;
  }

  async close(): Promise<void> {
    await new Promise<void>((done) => this.server.close(() => done()));
  }
}

/** 試験が使うアクセストークン。**本物ではない**ので、身代わり以外へ届いた時点で撥ねられる。 */
export const FAKE_TOKEN = 'test-access-token';

/**
 * `.claude/ccr-meta.mjs` がトークンを読む置き場を、渡された家の下に作る。**本物の
 * `~/.claude/.credentials.json` はCIには無い**ので、叩く側は `HOME`／`USERPROFILE` をここへ向ける。
 */
export function writeFakeCredentials(home: string, token: string = FAKE_TOKEN): void {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: token } }),
    'utf-8',
  );
}

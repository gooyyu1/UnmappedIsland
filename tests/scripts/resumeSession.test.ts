import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAKE_ALL_ON, BRAKE_ISSUE, brakeOff, writeBrakeGh } from '../support/brakeIssue';
import { FakeMetaServer, metaReply, writeFakeCredentials } from '../support/fakeMetaServer';
import { pathForBash, spawnScript, spawnScriptAsync } from '../support/runScript';
import { writeUsageCache, writeUsagePolled } from '../support/usageCache';

/**
 * `scripts/daemon/resume-session.sh`——止まったセッションへ送る本文を組み立てる段——の検査。
 *
 * ここが守るのは**送る本文が、ひな形の `## <理由>` 節に書いたとおりであること**。取り違えても
 * `send_message` は通ってしまい、**理由と噛み合わない指示が届いた1本**ができる。届いた本文を読むまで
 * 誰も気づけないのは投入と同じ。
 *
 * **取り出しは投入と同じ1つ**（`scripts/daemon/prompt-template.sh` の `template_body`）なので、綴りの
 * 決め方・前置きのラベル付きの囲み・閉じ忘れの扱いは、投入とここで揃う。写しに戻ったら、下の
 * 「前置きのラベル付きの囲み」と「閉じないまま尽きた囲み」が落ちる。
 */

const RESUME_SH = resolve(__dirname, '../../scripts/daemon/resume-session.sh');
const FENCE = '```';

interface Built {
  readonly code: number;
  /** 組み立てられた本文。止まった回は空。 */
  readonly text: string;
  readonly stderr: string;
}

/**
 * `DRY_RUN` で本文だけを組み立てさせる。**この分岐は手綱にもセッションの一覧にも訊く手前**なので、
 * 起こす相手が居なくても走る。
 */
function build(kind: string, number: string, template?: readonly string[]): Built {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-resume-session-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DRY_RUN: '1' };
    if (template !== undefined) {
      const path = join(work, 'resume-prompt.md');
      writeFileSync(path, `${template.join('\n')}\n`, 'utf-8');
      env.RESUME_PROMPT = pathForBash(path);
    }

    const run = spawnScript(RESUME_SH, ['cse_012ABC', kind, number], { stdio: 'pipe', env });
    return { code: run.status ?? -1, text: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('resume-session.sh の本文', () => {
  // 本物のひな形を通す。差し替えたひな形だけで確かめると、実際に毎回渡るほうが読めなくなっても緑。
  it('ひな形の節を読んで `<番号>` を埋める', () => {
    const built = build('mend', '1512');

    expect(built.code).toBe(0);
    expect(built.text).toContain('PR #1512');
    expect(built.text).not.toContain('<番号>');
    // 隣の節は混ざらない（`stall` の1行目）。
    expect(built.text).not.toContain('のPRが、まだ出ていません');
  });

  // 盤面が出す語に対応する節が無いまま送ると、理由と噛み合わない本文が届く。
  it('節が無ければ送る本文を組み立てない', () => {
    const built = build('mend', '1512', ['## stall — PRがまだ出ていない', FENCE, '本文', FENCE]);

    expect(built.code).not.toBe(0);
    expect(built.text).toBe('');
    expect(built.stderr).toContain('## mend');
  });

  // 閉じの行に当たるまでを本文にすると、**閉じ忘れたひな形の後ろの節が丸ごと本文へ入る。**
  // 空にはならないので、空で止める関門には掛からない。
  it('閉じないまま尽きた囲みは、本文にしない', () => {
    const built = build('mend', '1512', [
      '## mend — 直しを待っているPRがある',
      FENCE,
      'mend の本文',
      '',
      '## stall — PRがまだ出ていない',
      '',
      'ここは別の節',
    ]);

    expect(built.code).not.toBe(0);
    expect(built.text).toBe('');
    expect(built.stderr).toContain('閉じていない');
  });

  // 節の中でコマンドを見せるひな形が書ける。閉じの行が本文の始まりに見えると、**中身の違う本文が
  // 黙って届く。**
  it('前置きのラベル付きの囲みは、本文の始まりにしない', () => {
    const built = build('mend', '1512', [
      '## mend — 直しを待っているPRがある',
      '',
      `${FENCE}bash`,
      'npm test',
      FENCE,
      '',
      FENCE,
      'PR #<番号> を直してください。',
      FENCE,
    ]);

    expect(built.code).toBe(0);
    expect(built.text).toBe('PR #1512 を直してください。\n');
  });
});

/**
 * 起こす相手（`live-sessions.sh` が出すTSVの1行）。**畳まれておらず、手は空いている**——ここで
 * 止まると関門まで辿り着かないので、送るところまで通る形にしておく。
 */
const IDLE = [
  'cse_012ABC',
  'SESSION_STATUS_IDLE',
  'SESSION_STATUS_BUCKET_COMPLETED',
  'task-1512',
  'cloud',
  'served',
].join('\t');

interface Woken {
  readonly code: number;
  /** 身代わりのMCPサーバが受けた要求の数。**送ったかはこれでしか言えない。** */
  readonly calls: number;
}

interface Gates {
  /** 手綱の issue の本文。既定は全部チェック済み。 */
  readonly brake?: string;
  /** 控えてある `five_hour` の `utilization`。既定は余力たっぷり。 */
  readonly fiveHour?: number;
  /** 控えてある `seven_day` の `utilization`。既定は余力たっぷり。 */
  readonly sevenDay?: number;
}

let server: FakeMetaServer;
let endpoint: string;

beforeEach(async () => {
  server = new FakeMetaServer();
  server.reply = metaReply('ok');
  endpoint = await server.listen();
});

afterEach(async () => {
  await server.close();
});

/** 実際に起こさせる。**一覧は控えで差し替える**（`LIVE_SESSIONS_TSV`）ので、引くのは送る1回だけ。 */
async function wake(gates: Gates = {}): Promise<Woken> {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-resume-gate-'));
  try {
    writeBrakeGh(work, gates.brake ?? BRAKE_ALL_ON);
    writeFakeCredentials(work);
    writeUsageCache(work, { fiveHour: gates.fiveHour, sevenDay: gates.sevenDay });
    // **控えが古ければ口を叩きに行く**ので、叩いた印を置いて間隔の番で追い返させる（`headroom.sh`）。
    writeUsagePolled(work);
    const live = join(work, 'live.tsv');
    writeFileSync(live, `${IDLE}\n`, 'utf-8');

    const run = await spawnScriptAsync(RESUME_SH, ['cse_012ABC', 'mend', '1512'], {
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        BOARD_STATE: work,
        HOME: work,
        USERPROFILE: work,
        BRAKE_ISSUE,
        USAGE_MIN_SECONDS: '3600',
        CCR_META_ENDPOINT: endpoint,
        LIVE_SESSIONS_TSV: live,
      },
    });
    return { code: run.code, calls: server.received.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * 起こす周も、立てる周と同じ関門を通ること（`agent-ops/board-design.md` 2.5.2節）。
 *
 * **上限に当たっている間に起こしても、モデルが割り当たらず何も出てこない。** それだけなら空振りで
 * 済むが、**盤面は起こした印を打てた手にしか残さない**ので、起こせてしまうと次の窓で人へ返るところ
 * まで進む（2.15.3）——**止めれば印が残らず、枠が明けた周にそのまま起こし直される。**
 */
describe('resume-session.sh の関門', () => {
  it('手綱も余力も在れば送る', async () => {
    expect(await wake()).toEqual({ code: 0, calls: 1 });
  });

  // **人が止めている3と別の終了コード**（`headroom.sh`）。枠が明ければひとりでに戻るので、
  // 見回る係の打つ手が違う（2.21.2）。
  it('余力が足りなければ、送らずに4で止まる', async () => {
    expect(await wake({ sevenDay: 99 })).toEqual({ code: 4, calls: 0 });
  });

  it('5時間の余力が足りなくても、送らずに4で止まる', async () => {
    expect(await wake({ fiveHour: 95 })).toEqual({ code: 4, calls: 0 });
  });

  it('人が「直しの再開」を止めていれば、送らずに3で止まる', async () => {
    expect(await wake({ brake: brakeOff('直しの再開') })).toEqual({ code: 3, calls: 0 });
  });
});

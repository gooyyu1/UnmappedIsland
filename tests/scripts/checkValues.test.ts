import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TITLE, checkValues, surveyValues } from '../../scripts/agent/check-values.mjs';

/**
 * `scripts/agent/check-values.mjs` の検査（`.claude/board-design.md` 2.22）。
 *
 * **告げられない見張りは、値が生きているのと同じ顔をする。** 環境IDも資格情報も、死んだことに誰も
 * 気づかないのがこの係の出どころなので、**告げ損ねても盤面はただ静かに止まる**——緑であることでは
 * 効いていると言えない。ここで守るのは4つ。
 *
 * - 死んでいる値を死んでいると読むこと（**一覧に居ないID**・`gh auth status` の失敗・CCRへ届かない）
 * - **直る途中のものを告げないこと**（猶予。CCRのトークンは数時間で切れて自分で直る）
 * - **確かめられなかったことを死と数えないこと**（CCRが落ちた周の環境ID）
 * - **同じ死で2つ目を出さないこと**（issue は題で引いて書き換え、通知は1つの死につき1回）
 *
 * 外を触る手（CCR・`gh`）はすべて差し替える。**本物を打つと、走らせた者のリポジトリに issue が
 * 立ち、その口座に Routine が1本増える。**
 */

const CLOUD = 'env_cloud';
const BRIDGE = 'env_bridge';

const NOW = new Date('2026-09-11T12:00:00Z');
/** 台帳と本文に出る綴り（ミリ秒は落ちる）。 */
const NOW_STAMP = '2026-09-11T12:00:00Z';
/** 猶予（既定6時間）を越えている死の始まり。 */
const LONG_AGO = '2026-09-11T04:00:00Z';
/** 猶予に届いていない死の始まり。 */
const JUST_NOW = '2026-09-11T11:00:00Z';

interface World {
  /** `list_environments` が返す環境ID。 */
  readonly living?: readonly string[];
  /** CCRへ届かないか。 */
  readonly ccrFails?: boolean;
  /** `gh auth status` が通るか。既定は通る。 */
  readonly ghAuth?: boolean;
  /** `ccr-env.sh` が出す環境ID。 */
  readonly envs?: readonly { readonly name: string; readonly id: string }[];
  /** 台帳の中身。 */
  readonly ledger?: Record<string, { since: string; pushed?: string }>;
  /** 題で引ける、開いている issue の番号。 */
  readonly openIssue?: number;
  /** 口座に在る Routine。 */
  readonly triggers?: readonly { readonly id: string; readonly name: string }[];
  /** 押すところで CCR が転ぶか。 */
  readonly fireFails?: boolean;
  /** `gh issue list` が転ぶか（＝開いている issue を引けない周）。 */
  readonly listFails?: boolean;
}

interface Run {
  readonly told: boolean;
  /** `gh` に渡された引数。1件が1回。 */
  readonly gh: readonly (readonly string[])[];
  /** `--body-file` で渡された本文（渡っていなければ `undefined`）。 */
  readonly body: string | undefined;
  /** CCRへ投げた道具と引数。 */
  readonly meta: readonly { readonly tool: string; readonly args: Record<string, unknown> }[];
  /** 見回りの後の台帳。 */
  readonly ledger: Record<string, { since: string; pushed?: string } | undefined>;
  readonly said: readonly string[];
}

async function check(world: World = {}): Promise<Run> {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-check-values-'));
  try {
    if (world.ledger !== undefined) {
      writeFileSync(join(work, 'value-check.json'), JSON.stringify(world.ledger), 'utf-8');
    }

    const ghCalls: string[][] = [];
    let body: string | undefined;
    const gh = (args: readonly string[]): string | undefined => {
      ghCalls.push([...args]);
      const at = args.indexOf('--body-file');
      if (at >= 0) body = readFileSync(args[at + 1] ?? '', 'utf-8');
      if (args[0] === 'auth') return world.ghAuth === false ? undefined : '';
      if (args[0] === 'issue' && args[1] === 'list') {
        if (world.listFails === true) return undefined;
        return JSON.stringify(
          world.openIssue === undefined ? [] : [{ number: world.openIssue, title: TITLE }],
        );
      }
      return '';
    };

    const meta: { tool: string; args: Record<string, unknown> }[] = [];
    const call = async (tool: string, args: Record<string, unknown> = {}): Promise<string> => {
      meta.push({ tool, args });
      if (tool === 'list_environments') {
        if (world.ccrFails === true) throw new Error('失敗: HTTP 401 トークンが切れている');
        const living = world.living ?? [CLOUD, BRIDGE];
        return JSON.stringify({ environments: living.map((id) => ({ environment_id: id })) });
      }
      if (tool === 'list_triggers') return JSON.stringify({ data: world.triggers ?? [] });
      if (tool === 'create_trigger') return JSON.stringify({ trigger: { id: 'trig_made' } });
      if (tool === 'fire_trigger' && world.fireFails === true) throw new Error('失敗: HTTP 500');
      return '{}';
    };

    const said: string[] = [];
    const told = await checkValues({
      call,
      gh,
      envs: () => [
        ...(world.envs ?? [
          { name: 'CLOUD_ENV', id: CLOUD },
          { name: 'BRIDGE_ENV', id: BRIDGE },
        ]),
      ],
      stateDir: work,
      now: NOW,
      dryRun: false,
      say: (line) => said.push(line),
    });

    const path = join(work, 'value-check.json');
    return {
      told,
      gh: ghCalls,
      body,
      meta,
      ledger: existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {},
      said,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** その道具へ投げた引数。投げていなければ `undefined`。 */
const sent = (run: Run, tool: string) => run.meta.find((one) => one.tool === tool)?.args;

/** `gh` のその手。打っていなければ `undefined`。 */
const ran = (run: Run, ...head: string[]) =>
  run.gh.find((args) => head.every((word, at) => args[at] === word));

describe('check-values.mjs の見立て', () => {
  it('環境IDが一覧に居なければ、その値が死んでいると読む', async () => {
    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [{ environment_id: CLOUD }] }),
      gh: () => '',
      envs: () => [
        { name: 'CLOUD_ENV', id: CLOUD },
        { name: 'BRIDGE_ENV', id: BRIDGE },
      ],
    });

    expect(survey.find((value) => value.key === 'CLOUD_ENV')?.state).toBe('alive');
    expect(survey.find((value) => value.key === 'BRIDGE_ENV')?.state).toBe('dead');
  });

  // **`list_environments` が返ったこと自体が、CCRの資格情報の生死**（2.22）。別の口を作らない。
  it('CCRへ届かなければ資格情報が死んでいると読み、環境IDは確かめられなかったと読む', async () => {
    const survey = await surveyValues({
      call: async () => {
        throw new Error('失敗: HTTP 401');
      },
      gh: () => '',
      envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
    });

    expect(survey.find((value) => value.key === 'ccr')?.state).toBe('dead');
    expect(survey.find((value) => value.key === 'CLOUD_ENV')?.state).toBe('unknown');
  });

  // **開いていなければ空**（`ccr-env.sh`）。出てこないIDは、死ではなく「今は無い」。
  it('`ccr-env.sh` が出さなかった環境IDは、見立てに並ばない', async () => {
    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [] }),
      gh: () => '',
      envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
    });

    expect(survey.map((value) => value.key)).not.toContain('BRIDGE_ENV');
  });

  it('`gh auth status` が非0で終われば、`gh` の資格情報が死んでいると読む', async () => {
    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [CLOUD].map((id) => ({ environment_id: id })) }),
      gh: () => undefined,
      envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
    });

    expect(survey.find((value) => value.key === 'gh')?.state).toBe('dead');
  });
});

describe('check-values.mjs の告げ方', () => {
  it('全部生きていれば、何も告げない', async () => {
    const run = await check();

    expect(run.told).toBe(false);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
    expect(ran(run, 'issue', 'edit')).toBeUndefined();
    expect(run.ledger).toEqual({});
  });

  // **直る途中のものを毎回告げると、告げたものが読まれなくなる**（2.22.2）。
  it('死んで間もない値は、数え始めるだけで告げない', async () => {
    const run = await check({ living: [CLOUD] });

    expect(run.told).toBe(false);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
    expect(run.ledger.BRIDGE_ENV?.since).toBe(NOW_STAMP);
  });

  it('猶予を越えた死は、`判断待ち` を付けた issue で告げる', async () => {
    const run = await check({ living: [CLOUD], ledger: { BRIDGE_ENV: { since: LONG_AGO } } });

    expect(run.told).toBe(true);
    const created = ran(run, 'issue', 'create');
    expect(created).toContain(TITLE);
    expect(created).toContain('判断待ち');
    expect(created).toContain('origin:agent');
    // **読む人はリポジトリを開かない**ので、直し方まで本文に入っている（2.22.3）。
    expect(run.body).toContain(BRIDGE);
    expect(run.body).toContain(LONG_AGO);
    expect(run.body).toContain('CLI を開き直す');
  });

  // **鍵は題だけ。** 台帳が失われても2本目は立たない（2.22.3）。
  it('同じ死が続いても、開いている issue の本文を書き換えるだけ', async () => {
    const run = await check({
      living: [CLOUD],
      ledger: { BRIDGE_ENV: { since: LONG_AGO } },
      openIssue: 4242,
    });

    expect(ran(run, 'issue', 'edit')?.slice(0, 3)).toEqual(['issue', 'edit', '4242']);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
  });

  it('全部生き返ったら、開いている issue を閉じる', async () => {
    const run = await check({ ledger: { BRIDGE_ENV: { since: LONG_AGO } }, openIssue: 4242 });

    expect(ran(run, 'issue', 'close')?.slice(0, 3)).toEqual(['issue', 'close', '4242']);
    expect(run.ledger).toEqual({});
  });

  // **CCRへ届かない周は、死んでいる値が `unknown` へ落ちて告げる対象から外れる**（2.22.2）。
  // そこで閉じると、死んだままの周に「全部生き返った」と告げたうえ、次に確かめられた周には題で
  // 引く先が無くなって2本目が立つ。
  it('確かめられなかっただけの周は、開いている issue を閉じない', async () => {
    const run = await check({ ccrFails: true, ledger: { BRIDGE_ENV: { since: LONG_AGO } }, openIssue: 4242 });

    expect(ran(run, 'issue', 'close')).toBeUndefined();
  });

  // 猶予に届いていないだけの死も、生き返ったことではない。
  it('猶予に届いていないだけの周も、開いている issue を閉じない', async () => {
    const run = await check({
      living: [CLOUD],
      ledger: { BRIDGE_ENV: { since: JUST_NOW } },
      openIssue: 4242,
    });

    expect(ran(run, 'issue', 'close')).toBeUndefined();
  });

  // **「引けなかった」と「1本も無い」を混ぜると、一覧が転んだ周に同じ題の2本目が立つ。**
  it('開いている issue を引けなかった周は、何も書かない', async () => {
    const run = await check({
      living: [CLOUD],
      ledger: { BRIDGE_ENV: { since: LONG_AGO } },
      listFails: true,
    });

    expect(run.told).toBe(false);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
    expect(ran(run, 'issue', 'edit')).toBeUndefined();
    // 次の周で告げ直せるように、死んでいた長さは残す。
    expect(run.ledger.BRIDGE_ENV?.since).toBe(LONG_AGO);
  });

  // **トークンが切れただけの周に、環境IDまで死んだことにしない**（2.22.2）。
  it('CCRへ届かない周は、環境IDの死を数え始めず、数えていた長さも消さない', async () => {
    const run = await check({ ccrFails: true, ledger: { BRIDGE_ENV: { since: LONG_AGO } } });

    expect(run.ledger.BRIDGE_ENV?.since).toBe(LONG_AGO);
    expect(run.ledger.CLOUD_ENV).toBeUndefined();
  });

  it('生き返った値は、台帳から消えて数え直しになる', async () => {
    const run = await check({ ledger: { BRIDGE_ENV: { since: JUST_NOW } } });

    expect(run.ledger.BRIDGE_ENV).toBeUndefined();
  });
});

describe('check-values.mjs の、`gh` が死んでいる周', () => {
  const dead = { ghAuth: false, ledger: { gh: { since: LONG_AGO } } } as const;

  it('issue を書かず、Routine を立てて押す', async () => {
    const run = await check(dead);

    expect(run.told).toBe(true);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
    // 通知を持たない Routine を立てると、押しても誰にも届かない（2.22.3）。
    expect(sent(run, 'create_trigger')).toMatchObject({
      name: TITLE,
      environment_id: CLOUD,
      create_new_session_on_fire: true,
      notifications: { push: true },
    });
    // 時計で立つと、直った後も鳴り続ける。
    expect(sent(run, 'create_trigger')).not.toHaveProperty('cron_expression');
    expect(sent(run, 'create_trigger')).not.toHaveProperty('run_once_at');
    // 空で渡しても撥ねられる（2026-09-11 に実測）。
    expect(sent(run, 'create_trigger')).not.toHaveProperty('connectors');
    expect(sent(run, 'fire_trigger')).toMatchObject({ trigger_id: 'trig_made' });
    expect(String(sent(run, 'fire_trigger')?.text)).toContain('`gh` の資格情報');
  });

  // **押す本文は issue を指さない。** 指した先は立っていないし、次の見回りが閉じにも行けない。
  it('押す本文は、issue の本文とは別物', async () => {
    const run = await check(dead);

    const text = String(sent(run, 'fire_trigger')?.text);
    expect(text).toContain('この報せが唯一の告げ先です');
    expect(text).not.toContain('この issue');
  });

  it('題の同じ Routine が在れば、立て直さずにそれを押す', async () => {
    const run = await check({ ...dead, triggers: [{ id: 'trig_old', name: TITLE }] });

    expect(sent(run, 'create_trigger')).toBeUndefined();
    expect(sent(run, 'fire_trigger')).toMatchObject({ trigger_id: 'trig_old' });
  });

  // **押した回数がそのまま届く**ので、issue と違って1つの死につき1回に絞る（2.22.3）。
  it('同じ死では押し直さない', async () => {
    const run = await check({ ...dead, ledger: { gh: { since: LONG_AGO, pushed: JUST_NOW } } });

    expect(run.told).toBe(false);
    expect(sent(run, 'fire_trigger')).toBeUndefined();
  });

  it('押したことは台帳に残る', async () => {
    const run = await check(dead);

    expect(run.ledger.gh?.pushed).toBe(NOW_STAMP);
  });

  // **押すところで転んでも、死んでいた長さは残す。** 消すと、次の周も同じところで転んだときに
  // 猶予が永久に満ちない。
  it('押すところで CCR が転んでも、台帳は残る', async () => {
    const run = await check({ ...dead, fireFails: true });

    expect(run.told).toBe(false);
    expect(run.ledger.gh?.since).toBe(LONG_AGO);
    expect(run.ledger.gh?.pushed).toBeUndefined();
  });

  // **両方死んでいれば告げる手が無い**（2.22.3）。黙って成功したことにしない。
  it('クラウドの環境も死んでいれば、押せなかったと答える', async () => {
    const run = await check({ ...dead, living: [BRIDGE] });

    expect(run.told).toBe(false);
    expect(sent(run, 'fire_trigger')).toBeUndefined();
    expect(run.said.join('\n')).toContain('告げられなかった（クラウドの環境が死んでいる）');
  });
});

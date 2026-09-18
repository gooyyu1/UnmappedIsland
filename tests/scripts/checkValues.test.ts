import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIRST_ISSUE_PULL } from '../../scripts/daemon/board-read.mjs';
import { DISPATCH_TAGS, TITLE, checkValues, surveyValues } from '../../scripts/daemon/check-values.mjs';

/**
 * `scripts/daemon/check-values.mjs` の検査（`agent-ops/board-design.md` 2.22）。
 *
 * **告げられない見張りは、値が生きているのと同じ顔をする。** 環境IDも資格情報も、死んだことに誰も
 * 気づかないのがこの係の出どころなので、**告げ損ねても盤面はただ静かに止まる**——緑であることでは
 * 効いていると言えない。ここで守るのは4つ。
 *
 * - 死んでいる値を死んでいると読むこと（**一覧に居ないID**・`gh auth status` の失敗・CCRへ届かない）
 * - **直る途中のものを告げないこと**（猶予。CCRのトークンは数時間で切れて自分で直る）
 * - **確かめられなかったことを死と数えないこと**（CCRが落ちた周の環境ID）
 * - **同じ死で2つ目を出さないこと**（題で引いて、開いていれば書き換えるだけ）
 *
 * 外を触る手（CCR・`gh`）はすべて差し替える。**本物を打つと、走らせた者のリポジトリに issue が
 * 立つ。**
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
  readonly ledger?: Record<string, { since: string }>;
  /** 題で引ける、開いている issue の番号。 */
  readonly openIssue?: number;
  /**
   * 題で引ける issue より**新しい**、関わりのない開いた issue の数。1回で引きにいく数を越えると、
   * `gh issue list` は古い側から切る——切られた側に居る issue は見つからない。
   */
  readonly newerIssues?: number;
  /** `gh issue list` が転ぶか（＝開いている issue を引けない周）。 */
  readonly listFails?: boolean;
  /** 畳まれていないセッション。省くと1本も立てていない形。 */
  readonly sessions?: readonly {
    readonly env: string;
    readonly served: boolean;
    readonly tags: readonly string[];
  }[];
}

interface Run {
  readonly told: boolean;
  /** `gh` に渡された引数。1件が1回。 */
  readonly gh: readonly (readonly string[])[];
  /** `--body-file` で渡された本文（渡っていなければ `undefined`）。 */
  readonly body: string | undefined;
  /** 見回りの後の台帳。 */
  readonly ledger: Record<string, { since: string } | undefined>;
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
        // **並びは本物と同じ作成の新しい順**で、`--limit` も実際に守る。守らないと、切られる形が
        // 検査に出ないまま「題で引けた」だけを見ることになる。
        const newer = Array.from({ length: world.newerIssues ?? 0 }, (_, index) => ({
          number: 900_000 + index,
          title: `関わりのない issue ${index}`,
        }));
        const open =
          world.openIssue === undefined ? [] : [...newer, { number: world.openIssue, title: TITLE }];
        return JSON.stringify(open.slice(0, Number(args[args.indexOf('--limit') + 1])));
      }
      return '';
    };

    const call = async (tool: string): Promise<string> => {
      if (tool === 'list_environments') {
        if (world.ccrFails === true) throw new Error('失敗: HTTP 401 トークンが切れている');
        const living = world.living ?? [CLOUD, BRIDGE];
        return JSON.stringify({ environments: living.map((id) => ({ environment_id: id })) });
      }
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
      sessions: () => [...(world.sessions ?? [])],
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
      ledger: existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {},
      said,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * セッションを1本も立てていない形。**外を触る手はすべて差し替える**ので、省くと本物の
 * `list_sessions` が起きる。
 */
const NO_SESSIONS = () => [];

/** `gh` のその手。打っていなければ `undefined`。 */
const ran = (run: Run, ...head: string[]) =>
  run.gh.find((args) => head.every((word, at) => args[at] === word));

describe('check-values.mjs の見立て', () => {
  it('環境IDが一覧に居なければ、その値が死んでいると読む', async () => {
    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [{ environment_id: CLOUD }] }),
      gh: () => '',
      sessions: NO_SESSIONS,
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
      sessions: NO_SESSIONS,
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
      sessions: NO_SESSIONS,
      envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
    });

    expect(survey.map((value) => value.key)).not.toContain('BRIDGE_ENV');
  });

  // **直し方の表の鍵は `ccr-env.sh` が出す名前の写し**で、突き合わせるものが無いと、あちらで名前を
  // 変えた瞬間に直し方が黙って「分からない」へ落ちる（`判断待ち` の issue から直し方だけが消える）。
  it('`ccr-env.sh` が出しうる名前には、どれも直し方が在る', async () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../scripts/daemon/ccr-env.sh'), 'utf-8');
    const names = [...source.matchAll(/printf '([A-Z_]+)=%s/g)].map((hit) => hit[1]);
    expect(names.length).toBeGreaterThan(0);

    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [] }),
      gh: () => '',
      sessions: NO_SESSIONS,
      envs: () => names.map((name) => ({ name, id: 'env_whatever' })),
    });

    for (const name of names) {
      expect(survey.find((value) => value.key === name)?.remedy).not.toContain('直し方は分からない');
      expect(survey.find((value) => value.key === `${name}:workers`)?.remedy).not.toContain(
        '直し方は分からない',
      );
    }
  });

  /**
   * **環境IDが一覧に在ることは、そこへ立てたセッションが働くことではない**（2.22.4）。
   * 2026-09-14 から3日、環境は一覧に居るのに走る者が1本も付かず、見回りは最後まで
   * `告げることは無い` を出し続けた（issue #2206）。
   */
  describe('立てたセッションが働いているか', () => {
    /** 盤面が立てたセッション（タグの頭で見分ける）。 */
    const board = (env: string, served: boolean) => ({ env, served, tags: ['task-8'] });

    const survey = (
      sessions: readonly { env: string; served: boolean; tags: readonly string[] }[],
      envs = [{ name: 'CLOUD_ENV', id: CLOUD }],
    ) =>
      surveyValues({
        call: async () => JSON.stringify({ environments: envs.map(({ id }) => ({ environment_id: id })) }),
        gh: () => '',
        envs: () => envs,
        sessions: () => sessions,
      });

    it('働いた跡が1本も無ければ、死んでいると読む', async () => {
      const found = await survey([board('cloud', false), board('cloud', false)]);

      expect(found.find((value) => value.key === 'CLOUD_ENV')?.state).toBe('alive');
      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('dead');
    });

    it('1本でも働いていれば、生きていると読む', async () => {
      const found = await survey([board('cloud', false), board('cloud', true)]);

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('alive');
    });

    // **投入していない周が、働かない周に見えてはいけない。** 死と数えると、静かな夜が明けるたびに
    // 猶予が積まれて、いつか嘘が告げられる。
    it('その環境のセッションが1本も無ければ、確かめられなかったと読む', async () => {
      const found = await survey([board('bridge', false)]);

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('unknown');
    });

    // **環境ごとに数える。** 片方が働いていることで、もう片方の死が隠れない。
    it('環境ごとに別々に数える', async () => {
      const found = await survey(
        [board('cloud', true), board('bridge', false)],
        [
          { name: 'CLOUD_ENV', id: CLOUD },
          { name: 'BRIDGE_ENV', id: BRIDGE },
        ],
      );

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('alive');
      expect(found.find((value) => value.key === 'BRIDGE_ENV:workers')?.state).toBe('dead');
    });

    // **1つの不調を2行にしない。** 環境IDが一覧に居ない周は、そこへ立てたものが働くかは
    // その死の裏に隠れている——別に数えると、読む人には直す先が2つ在るように見える。
    it('環境IDが一覧に居ない周は、働くかを数えない', async () => {
      const found = await surveyValues({
        call: async () => JSON.stringify({ environments: [] }),
        gh: () => '',
        envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
        sessions: () => [board('cloud', false)],
      });

      expect(found.find((value) => value.key === 'CLOUD_ENV')?.state).toBe('dead');
      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('unknown');
    });

    // **引けなかったことは、死んだことではない**（2.22.1）。
    it('一覧を引けなければ、確かめられなかったと読む', async () => {
      const found = await surveyValues({
        call: async () => JSON.stringify({ environments: [{ environment_id: CLOUD }] }),
        gh: () => '',
        envs: () => [{ name: 'CLOUD_ENV', id: CLOUD }],
        sessions: () => {
          throw new Error('セッションの一覧を引けなかった');
        },
      });

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('unknown');
    });

    /**
     * **ユーザー自身の Claude Code を数えない。** あれは同じ環境に居るが、盤面のタグを持たず、
     * **走る者が付かないまま一覧に居続けるのが正常**（ブリッジでは CLI が開いているかぎり畳まれ
     * ない。2026-09-17 に実測: `tags: ["config:auto-create-pr:ready", "remote-control-cli"]` で
     * `last_served_model` が無い）。数えると、**盤面のセッションが1本も生きていない瞬間に、
     * 健全な環境が死んで見える。**
     */
    it('盤面が立てていないセッションは数えない', async () => {
      const found = await survey([
        { env: 'cloud', served: false, tags: ['config:auto-create-pr:ready', 'remote-control-cli'] },
      ]);

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('unknown');
    });

    it('盤面のセッションが1本でも働いていれば、隣に立つ CLI の1本は効かない', async () => {
      const found = await survey([
        { env: 'cloud', served: false, tags: ['remote-control-cli'] },
        board('cloud', true),
      ]);

      expect(found.find((value) => value.key === 'CLOUD_ENV:workers')?.state).toBe('alive');
    });

    /**
     * **タグの頭の出どころは投入の側。** 書き写してあるので、あちらに種類が増えると**黙って
     * 数え落とす**——その種類しか生きていない周は、働いていても `unknown` になる。
     */
    it('投入の側が付けるタグの頭を、1つ残らず数える', () => {
      const heads = ['dispatch-task.sh', 'dispatch-review.sh', 'dispatch-chore.sh'].map((name) => {
        const source = readFileSync(resolve(import.meta.dirname, `../../scripts/daemon/${name}`), 'utf-8');
        const hit = /^TAG="([a-z]+-)/m.exec(source);
        expect(hit, `${name} の TAG= が読めない`).not.toBeNull();
        return hit?.[1];
      });

      expect([...DISPATCH_TAGS].sort()).toEqual([...new Set(heads)].sort());
    });
  });

  it('`gh auth status` が非0で終われば、`gh` の資格情報が死んでいると読む', async () => {
    const survey = await surveyValues({
      call: async () => JSON.stringify({ environments: [CLOUD].map((id) => ({ environment_id: id })) }),
      gh: () => undefined,
      sessions: NO_SESSIONS,
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
    expect(created).toContain('goal:upkeep');
    // **読む人はリポジトリを開かない**ので、直し方まで本文に入っている（2.22.3）。
    expect(run.body).toContain(BRIDGE);
    expect(run.body).toContain(LONG_AGO);
    expect(run.body).toContain('CLI を開き直す');
  });

  /**
   * **立てたセッションが働かない区間で、人へ届くのはここ**（issue #2206）。ここが黙ると、盤面は
   * それを1件ずつの停滞として処理し、担当の task を片端から人へ返す——返ったぶんを戻せるのは
   * 人だけなので、**塞がりが明けても盤面は自力で戻れない。**
   */
  it('立てたセッションが働かないまま猶予を越えたら、環境の側として告げる', async () => {
    const run = await check({
      sessions: [
        { env: 'cloud', served: false, tags: ['task-8'] },
        { env: 'bridge', served: true, tags: ['chore-patrol'] },
      ],
      ledger: { 'CLOUD_ENV:workers': { since: LONG_AGO } },
    });

    expect(run.told).toBe(true);
    expect(run.body).toContain('CLOUD_ENV へ盤面が立てたセッション');
    expect(run.body).toContain('走る者が付かない');
    expect(run.body).toContain('claude.ai/code');
    // 働いている側は告げない。
    expect(run.body).not.toContain('BRIDGE_ENV へ盤面が立てたセッション');
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

  // **切られるのは古い側**なので、開いている issue が増えるほど、先に立てた告知のほうが先に消える
  // ——引けない窓と同じ形で2本目が立つ。
  it('開いている issue が1回で引きにいく数を越えていても、2本目を立てない', async () => {
    const run = await check({
      living: [CLOUD],
      ledger: { BRIDGE_ENV: { since: LONG_AGO } },
      openIssue: 4242,
      newerIssues: FIRST_ISSUE_PULL,
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

  // **`VALUE_GRACE_HOURS` は 2.22.2 が「人が詰める摘み」として案内している**ので、打ち間違いは
  // 踏みうる。`NaN` を通すと猶予の比較が全部 false になり、**毎周「告げることは無い」と言い続ける
  // 見張り**になる（効いているのと見分けが付かない）。
  it('猶予に数でない値が入っていても、既定へ落ちて告げる', async () => {
    const before = process.env.VALUE_GRACE_HOURS;
    process.env.VALUE_GRACE_HOURS = '6時間';
    try {
      const run = await check({ living: [CLOUD], ledger: { BRIDGE_ENV: { since: LONG_AGO } } });

      expect(run.told).toBe(true);
    } finally {
      if (before === undefined) delete process.env.VALUE_GRACE_HOURS;
      else process.env.VALUE_GRACE_HOURS = before;
    }
  });

  it('生き返った値は、台帳から消えて数え直しになる', async () => {
    const run = await check({ ledger: { BRIDGE_ENV: { since: JUST_NOW } } });

    expect(run.ledger.BRIDGE_ENV).toBeUndefined();
  });
});

/**
 * `gh` が死んでいる周（`agent-ops/board-design.md` 2.22.3）。**告げる手はそこで尽きる**ので、
 * ここで守るのは「**告げられなかったことを、告げたことにしない**」の1点だけ。
 */
describe('check-values.mjs の、`gh` が死んでいる周', () => {
  const dead = { ghAuth: false, ledger: { gh: { since: LONG_AGO } } } as const;

  // **issue を立てる手が `gh` そのもの。** 打てば転ぶし、転んだ結果を成功と読むと嘘が混ざる。
  it('告げられなかったと答え、issue も書かない', async () => {
    const run = await check(dead);

    expect(run.told).toBe(false);
    expect(ran(run, 'issue', 'create')).toBeUndefined();
    expect(ran(run, 'issue', 'edit')).toBeUndefined();
    expect(run.said.join('\n')).toContain('告げられない');
  });

  // **告げられない周も、死んでいた長さは書く。** 書かずに返すと、`gh` が死んでいる間は猶予が
  // いつまでも満ちず、生き返った周にも「今死んだ」から数え直しになる。
  it('告げられない周も、死んでいた長さは台帳に書く', async () => {
    const run = await check({ ...dead, living: [CLOUD] });

    expect(run.ledger.gh?.since).toBe(LONG_AGO);
    expect(run.ledger.BRIDGE_ENV?.since).toBe(NOW_STAMP);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { LEDGER, UNSET, hasRefAuditWork, refAuditBatch } from '../../scripts/daemon/refAudit.mjs';

/**
 * `scripts/daemon/refAudit.mjs`——**節番号の参照を、この周はどこまで読むか**を決める段——の検査。
 *
 * ここが守るのは**読む範囲が漏れも溢れもしないこと**。読むのは係（モデル）なので、範囲を間違えても
 * **緑のまま何も起きない**——広すぎれば予算を食い潰して掃く分が進まず、狭すぎれば書き足された参照が
 * 窓から落ちて二度と読まれない。どちらもセッションの報告からは区別が付かない。
 *
 * **実物のリポジトリでは通さない。** 節が動いた周・書き足された周・掃き終えた周を作り分ける必要が
 * あり、どれも今のリポジトリの中身に依存しない。仕掛けは使い捨ての git リポジトリ。
 */

/**
 * 仕掛けの中の節番号の参照1つ。**字面を直に書かない**——この検査は追跡されたソースなので、書くと
 * **仕掛けの例が実在の節を指す参照として読まれる**（`docs/DocumentStyle.md` 5節の検査が外して
 * いるのは `tests/docs/**` だけ）。番号と `節` を組み立てれば、原文には参照の形が現れない。
 */
function cite(...numbers: readonly string[]): string {
  return numbers.map((number) => `${number}節`).join('・');
}

const REPOS: string[] = [];

afterAll(() => {
  for (const repo of REPOS) rmSync(repo, { recursive: true, force: true });
});

/** 使い捨てのリポジトリ。**`git` を通すのは、道具が指紋と差分を git に訊くから。** */
function makeRepo(files: Readonly<Record<string, string>>): string {
  const repo = mkdtempSync(join(tmpdir(), 'unmapped-island-ref-audit-'));
  REPOS.push(repo);
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo, stdio: 'ignore' });
  commit(repo, files);
  return repo;
}

/** 書いて1つ積む。返すのはその指紋。 */
function commit(repo: string, files: Readonly<Record<string, string>>): string {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(repo, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf-8');
  }
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'x'], { cwd: repo, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
}

/** 台帳の中身。実物と同じ形で書く——**読む側は綴りで引く**ので、形がずれれば投げる。 */
function ledgerText(through: string, commitSha: string): string {
  return ['# 台帳', '', `- 到達点: \`${through}\``, `- 検めた時点: \`${commitSha}\``, ''].join('\n');
}

/** 読む側から見た、この周の範囲。 */
function batch(repo: string, options?: { budget?: number }) {
  const taken = refAuditBatch(repo, options);
  return {
    changed: taken.changed.map((entry) => entry.file),
    sweep: taken.sweep.map((entry) => entry.file),
    swept: taken.swept,
    lostWindow: taken.lostWindow,
    head: taken.head,
  };
}

describe('refAudit.mjs', () => {
  // ## 掃く分
  //
  // 既に在る参照は誰も読んでいないので、変わった分だけを追っても減らない。**並びは追跡している
  // ファイルの順**で、台帳の到達点の次から。
  it('まだ一度も読んでいなければ、先頭から掃く', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'a.md': `# a\n\n## 1. あ\n\n本文（${cite('2')}）。\n`,
      'b.md': `# b\n\n## 2. い\n\n本文（${cite('1')}）。\n`,
    });

    expect(batch(repo).sweep).toEqual(['a.md', 'b.md']);
  });

  it('到達点の次から掃く', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('a.md', UNSET),
      'a.md': `本文（${cite('1')}）。\n`,
      'b.md': `本文（${cite('1')}）。\n`,
    });

    expect(batch(repo).sweep).toEqual(['b.md']);
  });

  // **参照を1つも持たないファイルは出さない。** 読む先が無いので、渡すと係が空振りする。
  it('節番号の参照を持たないファイルは、掃く分に出さない', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'a.md': '参照は無い。\n',
      'b.md': `本文（${cite('1')}）。\n`,
    });

    expect(batch(repo).sweep).toEqual(['b.md']);
  });

  // **予算は掛けるが、1ファイルは必ず出す。** 予算より参照の多いファイルで止めると、そこから先へ
  // 二度と進まない。
  it('予算に届いたら、そこで掃くのをやめる', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'a.md': `本文（${cite('1')}）。\n`,
      'b.md': `本文（${cite('1')}）。\n`,
    });

    expect(batch(repo, { budget: 1 }).sweep).toEqual(['a.md']);
  });

  it('予算より参照の多いファイルでも、1つは出す', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'a.md': `本文（${cite('1', '2', '3')}）。\n`,
    });

    expect(batch(repo, { budget: 1 }).sweep).toEqual(['a.md']);
  });

  it('末尾まで届いたら、掃き終えたと言う', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'a.md': `本文（${cite('1')}）。\n`,
      'b.md': `本文（${cite('1')}）。\n`,
    });

    expect(batch(repo).swept).toBe(true);
    expect(batch(repo, { budget: 1 }).swept).toBe(false);
  });

  // ## 変わった分
  //
  // **ファイルが変わったかでは引かない。** 1行の直しでそのファイルの参照を全部積むと、1日ぶんで
  // 参照数千件になる（実測・2026-09-18 のこのリポジトリで、5本のPRぶんが2632件）。
  it('書き足された行に参照が在るファイルだけを、変わった分に出す', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('zzz', UNSET),
      'a.md': `本文（${cite('1')}）。\n`,
      'b.md': `本文（${cite('1')}）。\n`,
    });
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    commit(repo, {
      'a.md': `本文（${cite('1')}）。\n足した行（${cite('2')}）。\n`,
      'b.md': `本文（${cite('1')}）。\n足した行。\n`,
    });
    writeFileSync(join(repo, LEDGER), ledgerText('zzz', before), 'utf-8');

    expect(batch(repo).changed).toEqual(['a.md']);
  });

  // **番号の指す先が動いた節を、その番号で指している参照**を引く。繰り上げは番号を残したまま中身を
  // 入れ替えるので、**節が消えた場合より見つけにくい**（リンクは切れず、指し先の中身だけが別物になる）。
  it('節が繰り上がったら、その番号で指している側を変わった分に出す', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('zzz', UNSET),
      'spec.md': '# spec\n\n## 1. あ\n\n## 2. い\n\n## 3. う\n',
      'cites.md': `\`spec.md\` ${cite('3')}のとおり。\n`,
      'quiet.md': `\`spec.md\` ${cite('1')}のとおり。\n`,
    });
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    // 「い」を落として「う」が繰り上がる。**番号はどちらの時点でも実在する**ので、指し先の実在だけを
    // 見る検査はここを素通りする。
    commit(repo, { 'spec.md': '# spec\n\n## 1. あ\n\n## 2. う\n' });
    writeFileSync(join(repo, LEDGER), ledgerText('zzz', before), 'utf-8');

    // 出るのは指している側だけ。**動いていない番号しか指していない `quiet.md` は出さない**
    // ——出すと、活発な文書を指す全員が毎周積まれる。動かした本人（`spec.md`）も、自分では節番号を
    // 1つも引いていないので出ない。
    expect(batch(repo).changed).toEqual(['cites.md']);
  });

  it('本文だけが変わった文書は、指している側を引かない', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('zzz', UNSET),
      'spec.md': '# spec\n\n## 1. あ\n\nもとの本文。\n',
      'cites.md': `\`spec.md\` ${cite('1')}のとおり。\n`,
    });
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    commit(repo, { 'spec.md': '# spec\n\n## 1. あ\n\n書き直した本文。\n' });
    writeFileSync(join(repo, LEDGER), ledgerText('zzz', before), 'utf-8');

    expect(batch(repo).changed).toEqual([]);
  });

  // **前の周の指紋を引けない檻が在る**（浅いクローン）。空（＝1件も変わっていない）と混ぜない。
  it('前の周の指紋を引けなければ、変わった分は出さずにそう言う', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('zzz', 'f'.repeat(40)),
      'a.md': `本文（${cite('1')}）。\n`,
    });

    const taken = batch(repo);
    expect(taken.lostWindow).toBe(true);
    expect(taken.changed).toEqual([]);
  });

  // ## 係を立てるか（`board-move.mjs` の `CYCLES` の `due`）
  //
  // **掃き残しは、掃く分を選ぶのと同じ見方**（参照を持つファイルだけを数える）。**変わった分の
  // ほうは中身を開かず、射程のファイルが変わったかだけ**を見るので、変わった行に参照が1つも無い
  // 周も立つ。
  it('掃き残しが在れば、読むものが在ると言う', () => {
    const repo = makeRepo({ [LEDGER]: ledgerText(UNSET, UNSET), 'a.md': `本文（${cite('1')}）。\n` });

    expect(hasRefAuditWork(repo)).toBe(true);
  });

  // **並びの末尾には、参照を持たないファイルが在る**（このリポジトリでも、参照を持つ最後の後ろに
  // 何件か続く）。「到達点より後ろが在るか」だけで見ると、**係が掃き終えても真のまま戻らず**、
  // 毎周、範囲が空のセッションが立ち続ける。
  it('到達点より後ろが、参照を持たないファイルだけなら、掃き残しとは言わない', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText('a.md', UNSET),
      'a.md': `本文（${cite('1')}）。\n`,
      'b.md': '参照は無い。\n',
    });
    const at = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    writeFileSync(join(repo, LEDGER), ledgerText('a.md', at), 'utf-8');
    commit(repo, {});

    expect(refAuditBatch(repo).sweep).toEqual([]);
    expect(hasRefAuditWork(repo)).toBe(false);
  });

  // **台帳の書き換えは、次の周を起こさない。** 係が毎周書き換える先なので、数えると**この係が
  // 自分で自分を起こし続ける**——ここはそれを、係が1周を終えた形（台帳だけが動いた形）で留める。
  it('掃き終えていて、台帳しか動いていなければ、読むものは無いと言う', () => {
    const repo = makeRepo({ [LEDGER]: ledgerText('zzz', UNSET), 'a.md': `本文（${cite('1')}）。\n` });
    const at = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    writeFileSync(join(repo, LEDGER), ledgerText('zzz', at), 'utf-8');
    commit(repo, {});

    expect(hasRefAuditWork(repo)).toBe(false);
  });

  it('掃き終えた後に射程のファイルが変われば、読むものが在ると言う', () => {
    const repo = makeRepo({ [LEDGER]: ledgerText('zzz', UNSET), 'a.md': `本文（${cite('1')}）。\n` });
    const at = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    writeFileSync(join(repo, LEDGER), ledgerText('zzz', at), 'utf-8');
    commit(repo, { 'a.md': `本文（${cite('1')}）。\n足した行（${cite('2')}）。\n` });

    expect(hasRefAuditWork(repo)).toBe(true);
  });

  // ## 台帳
  //
  // **「まだ無い」と「台帳が壊れている」は別。** 後者を前者に畳むと、掃き終えた分をもう一度最初から
  // 読み直す。
  it('台帳の行を引けなければ投げる', () => {
    const repo = makeRepo({ [LEDGER]: '# 台帳\n\n何も書いていない。\n', 'a.md': `本文（${cite('1')}）。\n` });

    expect(() => refAuditBatch(repo)).toThrow(/到達点/);
  });

  // ## 射程
  //
  // **その回の観測の記録は読まない**——書いてあるのは当時の観測で、今と食い違っていても直す先では
  // ない（そう決めているのは `agent-ops/prompts/analysis-prompt.md` の、記録の書き方を渡している段）。
  it('その回の観測の記録は、掃く分に出さない', () => {
    const repo = makeRepo({
      [LEDGER]: ledgerText(UNSET, UNSET),
      'agent-ops/analysis/2026-09-06.md': `当時の本文（${cite('1')}）。\n`,
      'z.md': `本文（${cite('1')}）。\n`,
    });

    expect(batch(repo).sweep).toEqual(['z.md']);
  });

  // ## 係が打つ口
  //
  // **仕掛けのリポジトリでは、根の決め方を通らない。** 上のどれも根を渡して呼ぶので、`node` で
  // 直に打ったときだけ効く「自分の在り処から根を数える」段が誰にも通られない——**置き場を1つ
  // 動かしただけで、係が打つコマンドが実物の台帳を見失う**（実際にそうなった）。ここは実物の
  // リポジトリで、ひな形が係へ渡しているのと同じコマンドをそのまま打つ。
  it('ひな形が渡すコマンドが、実物のリポジトリで範囲を出す', () => {
    const root = resolve(__dirname, '../..');
    const prompt = readFileSync(join(root, 'agent-ops', 'prompts', 'refs-prompt.md'), 'utf-8');
    const command = /^\s{4}(node \S+)$/m.exec(prompt);
    if (command === null) throw new Error('ひな形が打つコマンドの行が見つからない');

    const [, script] = command[1].split(' ');
    const out = execFileSync('node', [script], { cwd: root, encoding: 'utf-8' });

    expect(out).toContain('## 掃く分');
  });

  // 上の検査は、**実物の置き場が変わった日**には「除けている」と「そもそも無い」を区別できない。
  it('その回の観測の記録が、実際に置いてある', () => {
    const analyses = execFileSync('git', ['ls-files', 'agent-ops/analysis'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf-8',
    });

    expect(analyses.split('\n').filter((rel) => rel.endsWith('.md')).length).toBeGreaterThan(0);
  });
});

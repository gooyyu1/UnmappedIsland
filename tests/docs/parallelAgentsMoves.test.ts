import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `docs/ParallelAgents.md` 8節の手の表が、盤面の打てる手と一致しているかの検査。
 *
 * **この表は人間の読み手へ盤面の全体像を示す場所**で、読んだ人はここに無い手を無いものとして読む。
 * 実装の側で手が増えても減っても表は黙って古くなり、**書いてあることと現物がずれたことは誰にも
 * 見えない**（issue #1867 では、レビューのセッションを畳む手の在り処が実装と食い違ったまま残った）。
 *
 * **手の名前は実装から引く。** ここへ書き写すと、写しだけが古くなる先が1つ増える。
 */

const ROOT = resolve(__dirname, '../..');
const DOC = join(ROOT, 'docs', 'ParallelAgents.md');
const ROUND = join(ROOT, 'scripts', 'agent', 'board-round.mjs');
const RESUME_PROMPT = join(ROOT, '.claude', 'resume-prompt.md');

/** 手の表の見出しの行。表そのものは節の中に1つしか無いので、これで在り処が決まる。 */
const TABLE_HEADER = '| 手 | いつ打つか | 何をするか |';

/**
 * 盤面が打てる手。`play()` が打ち分けている名前に、**打たずにログへ残すだけの `NOTE`** を足す
 * （あちらは `play()` を通らないので、同じ場所からは引けない）。
 */
function playableHands(): readonly string[] {
  const source = readFileSync(ROUND, 'utf-8');
  const played = [...source.matchAll(/^\s*case '([A-Z]+)':/gm)].map((found) => found[1]);
  if (played.length === 0) throw new Error(`打ち分けている手が ${ROUND} から引けない`);
  if (!/startsWith\('NOTE '\)/.test(source)) throw new Error(`NOTE を記録する行が ${ROUND} に無い`);
  return [...played, 'NOTE'];
}

/**
 * `RESUME` に渡せる理由。**本文のひな形が節を持つものだけが渡せる**
 * （[`resume-session.sh`](../../scripts/agent/resume-session.sh) が `## <理由>` から読む）。
 */
function resumeKinds(): readonly string[] {
  const headings = [...readFileSync(RESUME_PROMPT, 'utf-8').matchAll(/^## ([a-z-]+) /gm)];
  if (headings.length === 0) throw new Error(`起こす理由の節が ${RESUME_PROMPT} に無い`);
  return headings.map((found) => found[1]);
}

/** 表に並んでいるべき名前。`RESUME` だけは理由ごとに1行へ割れている。 */
function expectedHands(): readonly string[] {
  return playableHands().flatMap((hand) =>
    hand === 'RESUME' ? resumeKinds().map((kind) => `RESUME … ${kind}`) : [hand],
  );
}

/** 表が実際に並べている名前。 */
function documentedHands(): readonly string[] {
  const lines = readFileSync(DOC, 'utf-8').split(/\r?\n/);
  const start = lines.indexOf(TABLE_HEADER);
  if (start < 0) throw new Error(`手の表が ${DOC} に無い`);
  const hands: string[] = [];
  // 見出しと区切りの2行を飛ばし、表が途切れるまで読む。
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const found = /^\| `([^`]+)` \|/.exec(line);
    if (found === null) throw new Error(`手の名前を引けない行がある: ${line}`);
    hands.push(found[1]);
  }
  return hands;
}

describe('docs/ParallelAgents.md の手の表', () => {
  it('盤面が打てる手を、欠けも余りもなく並べている', () => {
    expect([...documentedHands()].sort()).toEqual([...expectedHands()].sort());
  });
});

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 周期の係の間隔と、スメルを拾う窓が、**値を持つ側の外へ書き写されていないか**の検査。
 *
 * 間隔は [`board-move.mjs`](../../scripts/agent/board-move.mjs) の `CYCLES`、窓は
 * [`board-read.mjs`](../../scripts/agent/board-read.mjs) の `MERGED_WINDOW_HOURS` が持つ。文書へ
 * 数字や頻度の語で書き写すと、**値を1つ動かすたびに写した全部の書き換えが要り、漏れがそのまま嘘に
 * なる**（#1943・#1883 が実際にその書き換えを1本ずつ払っている）。読み手へは在り処だけを指させる。
 *
 * **見るのは、値を持たない側で値を説明している場所。** 値を持つ側（`scripts/`）と、当時の観測を残す
 * 記録（`.claude/analysis/**`）は写しではないので入れない。盤面の検査（`tests/scripts/**`）は、
 * 値そのものは足場の日付で留めているので、文章で綴り直すのはやはり写しになる。
 */

const ROOT = resolve(__dirname, '../..');

const MOVE = join(ROOT, 'scripts', 'agent', 'board-move.mjs');
const READ = join(ROOT, 'scripts', 'agent', 'board-read.mjs');

/** 間隔と窓を説明する文書。ここが在り処を指すか、値を写すかの分かれ目になる。 */
const WATCHED = [
  join('.claude', 'board-design.md'),
  join('.claude', 'parallel-work.md'),
  join('.claude', 'triage-prompt.md'),
  join('.claude', 'dig-prompt.md'),
  join('.claude', 'analysis-prompt.md'),
  join('.claude', 'analysis-trend-prompt.md'),
  join('.claude', 'patrol-prompt.md'),
  join('.claude', 'policy-cycle-prompt.md'),
  join('docs', 'ParallelAgents.md'),
  join('tests', 'scripts', 'boardMove.test.ts'),
  join('tests', 'scripts', 'boardRound.test.ts'),
] as const;

/**
 * 間隔（時間）を、文書がそれを書き写すときに使う綴りへ。**知らない間隔は下で落とす**——表に無い値を
 * 黙って見逃すと、「通った」と「そもそも見ていない」が緑では区別できなくなる。
 *
 * 「毎時」「間隔は1時間」のような、デーモン自身の起き方を指す語は入れない（係の間隔ではない）。
 */
const INTERVAL_SPELLINGS: ReadonlyMap<number, readonly string[]> = new Map([
  [1, ['一時間に一回', '1時間に1回', '一時間ごと', '1時間ごと']],
  [12, ['一日二回', '1日2回', '半日ごと', '12時間ごと']],
  [24, ['一日一回', '1日1回', '毎日一回', '24時間ごと']],
  [168, ['週一回', '週1回', '一週間に一回', '168時間ごと']],
]);

/**
 * `CYCLES` が持っている間隔。**係の数と突き合わせる**——どれか1つが別の書き方になって引けなくなると、
 * その係の間隔だけが黙って検査から抜ける。
 */
function cycleHours(): readonly number[] {
  const source = readFileSync(MOVE, 'utf-8');
  const opened = source.indexOf('const CYCLES = [');
  if (opened < 0) throw new Error(`周期の係の一覧が ${MOVE} に無い`);
  const cycles = source.slice(opened, source.indexOf('\n];', opened));
  const names = [...cycles.matchAll(/^\s*name: /gm)];
  const hours = [...cycles.matchAll(/^\s*hours: (\d+),?$/gm)];
  if (names.length === 0) throw new Error(`周期の係が ${MOVE} から引けない`);
  if (hours.length !== names.length) {
    throw new Error(
      `${MOVE} の周期の係は ${names.length} 件だが、間隔を引けたのは ${hours.length} 件` +
        `——引けなかった係の間隔が検査から抜けるので、ここの読み方を直すこと`,
    );
  }
  return [...new Set(hours.map((match) => Number(match[1])))];
}

/** スメルを拾う窓（時間）。 */
function mergedWindowHours(): number {
  const found = /export const MERGED_WINDOW_HOURS = (\d+);/.exec(readFileSync(READ, 'utf-8'));
  if (found === null) throw new Error(`窓の長さが ${READ} から引けない`);
  return Number(found[1]);
}

/** 値を書き写した綴りのうち、その文書に在るもの。 */
function copiesIn(file: string, spellings: readonly string[]): readonly string[] {
  const text = readFileSync(join(ROOT, file), 'utf-8');
  return spellings.filter((spelling) => text.includes(spelling));
}

describe('周期の係の間隔は、持っている側の外へ書き写さない', () => {
  it.each(WATCHED)('%s が間隔を綴っていない', (file) => {
    for (const hours of cycleHours()) {
      const spellings = INTERVAL_SPELLINGS.get(hours);
      if (spellings === undefined) {
        throw new Error(
          `${hours}時間の間隔をどう綴るかが ${__filename} に無い。` +
            `綴りを足したうえで、${WATCHED.join('・')} に写しが無いことを確かめること`,
        );
      }
      expect(copiesIn(file, spellings), `${hours}時間を書き写している`).toEqual([]);
    }
  });

  it.each(WATCHED)('%s が窓の長さを綴っていない', (file) => {
    const hours = mergedWindowHours();
    expect(copiesIn(file, [`${hours}時間`, `${hours} 時間`]), '窓の長さを書き写している').toEqual([]);
  });
});

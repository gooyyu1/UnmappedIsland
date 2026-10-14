import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';

/**
 * 時間切れの上限を、試験のファイルの中から書き換えていないかの見張り。
 *
 * vitestの設定を走りながら書き換える呼び出しは、**効く回と効かない回がある。** `vi` はワーカーの
 * プロセスに1つしか無く、掴んでいるのは**それが読み込まれた回の状態**——vitestはファイルの束ごとに
 * 状態を差し替えるので、2束目以降に読まれたファイルが書き換えても、走らせる側は元の値のまま読む。
 * **効かなかったことは何も鳴らない**ので、20秒を渡したつもりのファイルが既定の線で走り、混んだ回に
 * だけ落ちる（issue #2376）。
 *
 * 必ず効くのは、検査へ渡すなら `vite.config.ts` の `testTimeout` と `it`・`describe` の追加の引数、
 * フックへ渡すなら `hookTimeout` と `beforeAll` などの第2引数。**フックは検査の上限に掛からない**ので、
 * 渡す先は掛けたいほうで選ぶ。
 */

/**
 * 設定をファイルの中から書き換える呼び出し。`vi` に限らず名前で拾う——別名で取り込んでも、`vi` と
 * 続きの間で改行しても、効かないことに変わりは無いので。**この綴りがこのファイル自身に現れない
 * 書き方**にしてあるので、自分を置き場の名前で除く行が要らない（置き場を移したときに効かなくなる行を
 * 持たずに済む）。
 */
const IN_FILE_CONFIG = /\bse(?:t)Config\s*\(/;

describe('試験ごとの時間切れの上限', () => {
  it('ファイルの中から書き換えているものが無い', () => {
    const offenders = sourcesIn('tests').filter((rel) =>
      IN_FILE_CONFIG.test(readFileSync(join(ROOT, rel), 'utf-8')),
    );

    expect(
      offenders.sort(),
      '効かない渡し方。検査なら `it`・`describe` の追加の引数、フックなら第2引数で渡す',
    ).toEqual([]);
  });
});

/** 履歴を辿る git の呼び出し（`git(['log', …])` の形）。今の木だけを見るもの（`ls-files` など）は当たらない。 */
const HISTORY_GIT = /\[\s*'(?:log|rev-list|cat-file|show|diff|blame|merge-base)'/;

/** 子プロセスを起こす呼び出し。 */
const SPAWN = /\b(?:execFileSync|spawnSync|execSync)\(/;

/**
 * 履歴の上限を取り込む行。**この綴りがこのファイル自身に現れない書き方**にしてある（上の
 * `IN_FILE_CONFIG` と同じ理由）。
 */
const CLONE_HISTORY_TIMEOUT_IMPORT = /from '[^']*\/timeoutForCloneHistor(?:y)'/;

/** コメントの行を落とした本文。説明の中で名を挙げただけのファイルを、打つ側に数えない。 */
function codeOf(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/**
 * `scripts/` のうち、実物のクローンの履歴を**自分で**読むもの（リポジトリ相対・`/` 区切り）。
 * **取り込みは辿らない**——辿ると、履歴を読む関数を1つ借りただけの盤面の道具まで入り、その名を
 * 文字列で持つだけの検査が名乗りを求められる。
 */
function historyScripts(): string[] {
  return readdirSync(join(ROOT, 'scripts'), { recursive: true, encoding: 'utf-8' })
    .filter((rel) => rel.endsWith('.mjs'))
    .map((rel) => posix.join('scripts', rel.split('\\').join('/')))
    .filter((rel) => HISTORY_GIT.test(codeOf(readFileSync(join(ROOT, rel), 'utf-8'))));
}

describe('実物の履歴を辿る検査の上限', () => {
  // 履歴を読むスクリプトを実物で打つ検査は、所要時間が手元のクローンの状態で決まる
  // （tests/support/timeoutForCloneHistory.ts）。CIは浅いクローンなので、名乗り忘れは手元で
  // 履歴を取った者にだけ、それも辿る区間が伸びた日にだけ落ちる（issue #2621）。
  it('履歴を読むスクリプトを打つ検査ファイルだけが名乗っている', () => {
    const scripts = historyScripts();
    const files = sourcesIn('tests').map((rel) => ({
      rel,
      text: readFileSync(join(ROOT, rel), 'utf-8'),
    }));
    const runners = files
      .filter(({ text }) => {
        const code = codeOf(text);
        return SPAWN.test(code) && scripts.some((script) => code.includes(script));
      })
      .map(({ rel }) => rel);
    const named = files.filter(({ text }) => CLONE_HISTORY_TIMEOUT_IMPORT.test(text)).map(({ rel }) => rel);

    // 逆向きも見る——履歴を辿らない検査が名乗ると、速さの予算がその検査から黙って外れる。
    expect(
      named.sort(),
      `履歴を読むスクリプト: ${scripts.sort().join(', ')}。打つ検査は TIMEOUT_FOR_CLONE_HISTORY を名乗る`,
    ).toEqual(runners.sort());
  });
});

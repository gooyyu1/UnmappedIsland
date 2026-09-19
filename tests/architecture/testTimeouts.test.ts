import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

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
 * 上限を動かす先は `vite.config.ts` の `testTimeout`（全部に効く）と、`it` の第3引数（その1件だけ）。
 * どちらも必ず効く。
 */

/**
 * 設定をファイルの中から書き換える呼び出し。**この綴りがこのファイル自身に現れない書き方**にして
 * あるので、自分を置き場の名前で除く行が要らない（置き場を移したときに効かなくなる行を持たずに済む）。
 */
const IN_FILE_CONFIG = /\bvi\.se(?:t)Config\(/;

describe('試験ごとの時間切れの上限', () => {
  it('ファイルの中から書き換えているものが無い', () => {
    const offenders = sourcesIn('tests').filter((rel) =>
      IN_FILE_CONFIG.test(readFileSync(join(ROOT, rel), 'utf-8')),
    );

    expect(
      offenders.sort(),
      '効かない渡し方。`vite.config.ts` の testTimeout か、`it` の第3引数で渡す',
    ).toEqual([]);
  });
});

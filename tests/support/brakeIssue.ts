import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUB_SHEBANG } from './stubShebang';
import { replaceAllOrFail } from './textEdit';

/**
 * 人の手綱の issue（`scripts/daemon/brake.sh`）の身代わり。**関門を通るスクリプトはどれもここを
 * 通る**ので、手綱の本文と `gh` の差し替え方を覚えるのは1箇所でよい——見出しの綴りが変わったときに
 * 直す先が試験ごとに散らない。
 */

/** 手綱の issue の番号。実物の番号は試験に書き写さない。 */
export const BRAKE_ISSUE = '9999';

/** 全部チェックが付いた手綱。`## 手綱` 節の外にも書いて、節の中だけを見ていることを確かめる。 */
export const BRAKE_ALL_ON = [
  '- [ ] ここは節の外なので見ない',
  '',
  '## 手綱',
  '',
  '- [x] 投入する（これを外すと下は全部止まる）',
  '  - [x] 新しいタスク',
  '  - [x] レビュー',
  '    - [x] task を持たないPRも読む',
  '  - [x] 直しの再開',
  '  - [x] その他のエージェント（棚卸し・傾向分析）',
  '',
  '## 読み方の決まり',
  '',
  '- チェックが付いているときだけ流す。',
].join('\n');

/** チェックの外れた手綱を作る。 */
export function brakeOff(heading: string): string {
  return replaceAllOrFail(BRAKE_ALL_ON, {
    from: `- [x] ${heading}`,
    to: `- [ ] ${heading}`,
    occurrences: 1,
  });
}

/**
 * 手綱の issue を返す `gh` を、渡された置き場へ作る（呼び手は PATH の先頭へ置く）。
 *
 * **`excuse` を渡すと引けない `gh` になる。** 理由は標準エラーへ出す——黙って転ぶ身代わりを相手に
 * すると、理由を捨てる実装がそのまま緑で通る。
 */
export function writeBrakeGh(dir: string, body: string = BRAKE_ALL_ON, excuse?: string): void {
  const gh = join(dir, 'gh');
  writeFileSync(
    gh,
    `${STUB_SHEBANG}
${excuse === undefined ? '' : `echo '${excuse}' >&2\nexit 1`}
cat <<'BODY'
${body}
BODY
`,
    'utf-8',
  );
  chmodSync(gh, 0o755);
}

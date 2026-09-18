import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `.claude/hooks/**` の全部に掛かる検査。**どのフックにも同じことが要る**ので、1本ずつの検査へ
 * 写さずここが持つ（写すと、フックを1本足した人が写し忘れたぶんだけ穴が空く）。
 */

const REPO = resolve(__dirname, '../..');
const SETTINGS = resolve(REPO, '.claude/settings.json');

interface Registration {
  readonly hooks?: readonly { readonly command?: string }[];
}

/** `settings.json` に登録された全イベントのフックのコマンド文字列。 */
function registered(): string[] {
  const parsed: unknown = JSON.parse(readFileSync(SETTINGS, 'utf-8'));
  const events = (parsed as { hooks?: Record<string, readonly Registration[]> }).hooks ?? {};
  return Object.values(events).flatMap((matchers) =>
    matchers.flatMap((matcher) => (matcher.hooks ?? []).flatMap((hook) => hook.command ?? [])),
  );
}

/** `.claude/hooks/` に置いてあるシェルスクリプトの名前。 */
function placed(): string[] {
  return readdirSync(resolve(REPO, '.claude/hooks')).filter((name) => name.endsWith('.sh'));
}

describe('.claude/hooks', () => {
  /**
   * `settings.json` はフックをパスで直に起動するので、POSIX側（クラウドのセッションはLinux）では
   * 実行ビットが要る。Windowsの作業ツリーでは欠けても動くため、gitのインデックスの側を見る。
   */
  it('実行ビットが立っている', () => {
    const listed = execFileSync('git', ['ls-files', '-s', '--', '.claude/hooks'], {
      cwd: REPO,
      encoding: 'utf-8',
    });
    const notExecutable = listed
      .split('\n')
      .filter((line) => line.endsWith('.sh'))
      .filter((line) => !line.startsWith('100755 '));

    expect(placed()).not.toHaveLength(0);
    expect(notExecutable, `実行ビットが無い:\n${notExecutable.join('\n')}`).toEqual([]);
  });

  /**
   * **呼び手の居ないフックを置かない。** 置き場に在るだけのスクリプトは、走らないまま「在るから
   * 効いている」と読まれる（`policies.md`「「間違っているが動く」の扱い」）。
   */
  it('置いてあるフックは、全部 settings.json から呼ばれている', () => {
    const commands = registered().join('\n');
    const orphans = placed().filter((name) => !commands.includes(name));

    expect(orphans, `settings.json から呼ばれていない:\n${orphans.join('\n')}`).toEqual([]);
  });

  /** 逆向き。登録だけが残ると、**フックが1本まるごと走らないのに何も鳴らない。** */
  it('settings.json が指すフックは、全部実在する', () => {
    const names = placed();
    const missing = registered().filter((command) => !names.some((name) => command.includes(name)));

    expect(missing, `置き場に無いフックを指している:\n${missing.join('\n')}`).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { escapeXml, toast, toastScript } from '../../scripts/daemon/toast.mjs';

/**
 * `scripts/daemon/toast.mjs` の検査（`agent-ops/board-design.md` 2.22.6節）。
 *
 * **出せなかったトーストは、出したトーストと同じ顔をする。** 呼び手が見るのは終了コードだけで、
 * 画面を見ている者は居ない——**PowerShell が 0 で終わっても、1件も出ていないことがある**
 * （XMLが転べば非0だが、AUMIDが登録されていなければ黙って何も起きない）。ここで守るのは3つ。
 *
 * - **中身が壊れないこと**（値の名前にも道具の言い分にも `<` と `&` は混ざる）
 * - **居座る形が保たれること**（`reminder` は押せるものが無いと普通のトーストへ落ちる）
 * - **本物を撃たないこと**（撃つと、走らせた人の画面に出る）
 */

/** 撃った引数を控える手。`status` は PowerShell の終わり方。 */
function spy(status: number | null = 0) {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    run: (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { status };
    },
  };
}

/** `-EncodedCommand` に渡った中身を戻す。 */
function decode(args: readonly string[]): string {
  const at = args.indexOf('-EncodedCommand');
  return Buffer.from(args[at + 1] ?? '', 'base64').toString('utf16le');
}

describe('toast.mjs の中身', () => {
  /**
   * **逃がさないと `LoadXml` がそこで転ぶ。** 転べば非0で終わるので呼び手は気づくが、**告げる相手の
   * 名前に `<` が入っていた周だけ黙る**ことになり、いちばん出したい周に出ない。
   */
  it('XMLの升へ入る文字を逃がす', () => {
    expect(escapeXml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('題と本文を、逃がした形で運ぶ', () => {
    const script = toastScript('題 & <印>', '本文 "引用"');

    expect(script).toContain('<text>題 &amp; &lt;印&gt;</text>');
    expect(script).toContain('>本文 &quot;引用&quot;</text>');
    // 生のままの `<印>` が残っていれば、そこでXMLが割れている。
    expect(script).not.toContain('<印>');
  });

  /**
   * **`reminder` は、押せるものが1つも無いと普通のトーストへ落ちる**（Windows の仕様で、転ばずに
   * 落ちるので見分けが付かない）。落ちると数秒で引っ込むので、**席を外している間に止まったことを
   * 告げる**という役がそのまま失われる。**対で置いてあることをここで留める。**
   */
  it('居座らせる指定と、押せる釦を対で持つ', () => {
    const script = toastScript('題', '本文');

    expect(script).toContain('scenario="reminder"');
    expect(script).toMatch(/<actions>.*<action[^>]*\/>.*<\/actions>/s);
  });

  /**
   * **本文は既定では2行で切られる。** 呼び手は直し方まで入れてくるので、**死んでいる値が2つ以上の
   * 周だけ、後ろが黙って消える**——切られたことは画面から分からないので、読む人はそこまでが全部だと
   * 読む。**題の側は広げない**（1行で足りるものしか入らない）。
   */
  it('本文の行数だけを広げて持つ', () => {
    const script = toastScript('題', '本文');

    expect(script).toContain('<text hint-maxLines="5">本文</text>');
    expect(script).toContain('<text>題</text>');
  });
});

describe('toast.mjs の撃ち方', () => {
  /**
   * **土台は必ず渡す。** 省くと走っている土台が入るので、**Linux のCIでは撃つところまで行かず**、
   * 撃ち方を見ているはずの検査が丸ごと空振りしたまま緑になる。
   */
  const WINDOWS = { platform: 'win32' } as const;

  /**
   * **Windows 以外では撃たない。** CIはLinuxで走るので、撃つと `powershell.exe` が見つからずに
   * 転ぶ——**見回りの側は転びを握り潰す**ので、転んだことは誰にも届かない。
   */
  it('Windows でなければ、撃たずに出せなかったと答える', () => {
    const { calls, run } = spy();

    expect(toast({ title: '題', body: '本文', run, platform: 'linux' })).toBe(false);
    expect(calls).toEqual([]);
  });

  /**
   * **UTF-16LE の base64 で渡す。** `.ps1` に置くと PowerShell 5.1 が BOM の無いUTF-8をANSIとして
   * 読むので、**日本語が黙って壊れる**（読めない文面のトーストが出る）。
   */
  it('日本語を、復号すれば元に戻る形で渡す', () => {
    const { calls, run } = spy();

    expect(toast({ title: '盤面が止まっています', body: '直し方: /login', run, ...WINDOWS })).toBe(true);
    const script = decode(calls[0]?.args ?? []);
    expect(script).toContain('盤面が止まっています');
    expect(script).toContain('直し方: /login');
  });

  /**
   * **誰も見ていない間に回る。** PowerShell が何かを訊く形になった周は、そこで止まったまま
   * 見回りが返らない——**次の周も来ない。**
   */
  it('訊かれても止まらない形で起こす', () => {
    const { calls, run } = spy();
    toast({ title: '題', body: '本文', run, ...WINDOWS });

    expect(calls[0]?.command).toBe('powershell.exe');
    expect(calls[0]?.args).toContain('-NonInteractive');
    expect(calls[0]?.args).toContain('-NoProfile');
  });

  // **転んだ周を出せた周と同じに見せない。** 見せると、呼び手は次に出すのを間隔のぶん先送りする。
  it('PowerShell が非0で終われば、出せなかったと答える', () => {
    const { run } = spy(1);

    expect(toast({ title: '題', body: '本文', run, ...WINDOWS })).toBe(false);
  });
});

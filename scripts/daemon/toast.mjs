// デーモンが走っているPCの画面へ、トーストを1件出す（`agent-ops/board-design.md` 2.22.6節）。
//
//   node scripts/daemon/toast.mjs '題' '本文'
//
// ## この口だけは、資格情報を通らない
//
// 告げる先が issue しか無いと、**書く手も読む手も資格情報を通る**——`gh` が死ねば書けず、GitHub の
// 通知は書くのも読むのも同じアカウントなので鳴らない（2.20）。**ここは CCR も `gh` も要らない。**
//
// ## PowerShell を1回起こして出す
//
// 出す手はWinRTのAPIしか無く、node から直に叩けない。渡し方を `-EncodedCommand`（UTF-16LE の
// base64）にしてあるのは、**間に置くものを増やさないため**——`.ps1` を置くと、PowerShell 5.1 が
// BOM の無いUTF-8をANSIとして読むので**日本語が黙って壊れ**、実行ポリシーにも掛かる。
//
// **名乗るのは「Windows PowerShell」。** 出す側はAUMID（アプリの名乗り）を要求し、登録されていない
// 名前では**何も起きずに成功する**。自前のAUMIDを登録するにはスタートメニューへショートカットを
// 置くことになるので、起こしている当の PowerShell のものを使う。**誰が出したかは題に書く。**
//
// ## 出せなかったことは、呼び手を止めない
//
// 呼び手にとってここは**もう1つの届け先**で、issue の側は別に動く。Windows でない環境（CIのLinux）
// では撃たずに `false` を返す。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 出すときに名乗るAUMID。**PowerShell 自身のもの**で、このGUIDは Windows が持つ既定の
 * `Microsoft.Windows.Shell` のもの（上の「名乗るのは」）。
 */
const APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

/**
 * XMLの升へ入れる綴り。**値の名前にも道具の言い分にも `<` と `&` は混ざる**——逃がさないと
 * `LoadXml` がそこで転び、**トーストは1件も出ないまま PowerShell だけが非0で終わる。**
 */
export const escapeXml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * 出させる PowerShell の中身。**検査が読むので export する**（`tests/scripts/toast.test.ts`）
 * ——本物を撃つと、走らせた人の画面にトーストが出る。
 *
 * `scenario="reminder"` を付けるのは、**読む人が席を外している間に消えないため**。既定のトーストは
 * 数秒で引っ込んで通知センターへ回るが、こちらは人が触るまで画面に残る。**告げたいのは、誰も見て
 * いない間に止まったこと**なので、出た瞬間に見ていることを当てにできない。
 *
 * **`reminder` は、押せるものが1つも無いと普通のトーストへ落ちる**（Windows の仕様で、転ばずに
 * 落ちるので見分けが付かない）。閉じる釦を1つ置くのはそのため——**釦が消えると、居座る主張だけが
 * 残る。**
 */
export function toastScript(title, body) {
  return `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml(@'
<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual><actions><action activationType="system" arguments="dismiss" content="閉じる"/></actions></toast>
'@)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show($toast)
`;
}

/**
 * 1件出す。**出せたら `true`。**
 *
 * 差し替え口は試験のため（省いたものは本物が入る）。`platform` を渡せるのは、**Windows のCIでも
 * 本物を撃たないため**——撃つと走らせた人の画面に出る。
 */
export function toast({ title, body, run = spawnSync, platform = process.platform } = {}) {
  if (platform !== 'win32') return false;
  const encoded = Buffer.from(toastScript(title, body), 'utf16le').toString('base64');
  // **`-NonInteractive` を外さない。** デーモンは誰も見ていない間に回るので、PowerShell が何かを
  // 訊く形になった周は、そこで止まったまま見回りが返らない。
  const done = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
  });
  return done.status === 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [title, body] = process.argv.slice(2);
  console.log(toast({ title, body }) ? '出した' : '出せなかった');
}

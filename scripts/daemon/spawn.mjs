// 外の道具を1つ起こす。**盤面まわりの node から出る経路はここだけ**なので、Windowsで踏む作法
// （パスの区切り・出力をどこへ流すか）を持つ場所も1つで済む。
//
// 起こすこと自体が高くつく（1回10〜30ms。#1545）ので、**ここを呼ぶ回数がそのまま常時の固定費**。

import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';

/**
 * 受け取ってよい標準出力の大きさ。**既定の1MBには頼らない**——応答は open なPR・issue・セッションの
 * 本数に比例して伸びる（PRの一覧は `body` と `files` を含むので、50本で0.35MBまで来ている）。
 * 超えると node は子を殺し、**途中まで詰まった出力と `status = null`** を返す。叩いた道具は何も
 * 言っていないので、そのままでは**ログに手掛かりが1行も出ないまま**「引けなかった」になる。
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * シェルへ渡すパス。**区切りは `/` へ直す**——受け取る側は `dirname "${BASH_SOURCE[0]}"` や
 * `${…%/*}` で自分の置き場を出すので、Windowsの `\` のまま渡すと**区切りが1つも無い名前**に見え、
 * 隣のファイルをカレントから探しに行く。
 */
export const posix = (path) => path.replace(/\\/g, '/');

/** 起こすことそのものに失敗したら、そう言う。**道具が言えない失敗はここしか言う者が居ない。** */
function announce(what, call) {
  if (call.error !== undefined) writeSync(2, `${what} を起こせなかった: ${call.error.message}\n`);
}

/** 理由の行き先を呼び手が決めなかったときの既定。**捨てはしない**（下の `sayWhyNot`）。 */
const defaultSayWhyNot = (line) => writeSync(2, `${line}\n`);

/**
 * `gh` を1回叩いて標準出力を返す。引けなければ `undefined`。
 *
 * **引けなかった理由は `sayWhyNot` へ渡す。** 理由を言えるのは道具だけで（`agent-ops/board-design.md`
 * 1.7「引けなかったときは、道具が言った理由をそのまま出す」）、**捨てると呼び手には「引けなかった」
 * しか残らない**——検索の文法の誤りも、資格情報の切れも、同じ顔になる。**引けないことが答えになる
 * 呼び方でも落とさない**：そういう呼び手ほど、理由を自分の答え（人へ見せる断り・値の見張りの「見えた
 * こと」）へ載せる先を持っている。
 *
 * 渡さなければ標準エラーへ流す——デーモンのログはそれを含む。
 */
export function gh(args, { sayWhyNot = defaultSayWhyNot } = {}) {
  const call = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    // **標準エラーは常に捕まえる。** 流しっぱなし（`inherit`）にすると、**理由は人の目に届くが
    // 呼び手には残らない**——呼び手が人へ見せる断りを組む側なので、そこで尽きる。
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (call.status === 0 && typeof call.stdout === 'string') return call.stdout;
  // **起こせなかったことも、同じ口から言う。** 呼び手から見れば引けなかったことは1つで、
  // 道具が理由を言えたかどうかは呼び手の都合ではない。
  const said =
    call.error !== undefined ? `起こせなかった: ${call.error.message}` : (call.stderr ?? '').trim();
  sayWhyNot(`gh ${args.join(' ')}: ${said === '' ? `終了コード ${call.status}` : said}`);
  return undefined;
}

/**
 * bash のスクリプトを1本叩く。`capture` を立てなければ**出力はそのまま流す**（デーモンのログは
 * 叩いたスクリプトの声を含む）。標準エラーは常に流す。
 */
export function runBash(path, args, { input, capture = false, env } = {}) {
  const call = spawnSync('bash', [posix(path), ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    // **足すぶんだけを受ける。** 呼び手が `process.env` を書き換えて渡す形にすると、同じプロセスで
    // 動く他の呼び手にもそれが見え、**渡した覚えの無いところへ効く**（試験が並ぶと順序で落ちる）。
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  announce(posix(path), call);
  return { status: call.status ?? 1, stdout: call.stdout ?? '' };
}

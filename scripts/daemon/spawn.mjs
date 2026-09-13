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

/**
 * `gh` を1回叩いて標準出力を返す。引けなければ `undefined`——**`gh` は自分で理由を言う**ので、
 * ここから言い足すことは無い。`allowFail` のときはその声も落とす（引けないことが答えになる呼び方）。
 */
export function gh(args, { allowFail = false } = {}) {
  const call = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', allowFail ? 'ignore' : 'inherit'],
  });
  if (!allowFail) announce(`gh ${args[0]}`, call);
  return call.status === 0 && typeof call.stdout === 'string' ? call.stdout : undefined;
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

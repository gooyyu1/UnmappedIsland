// 外の道具を1つ起こす。**盤面まわりの node から出る経路はここだけ**なので、Windowsで踏む作法
// （パスの区切り・出力をどこへ流すか）を持つ場所も1つで済む。
//
// 起こすこと自体が高くつく（1回10〜30ms。#1545）ので、**ここを呼ぶ回数がそのまま常時の固定費**。

import { spawnSync } from 'node:child_process';

/**
 * シェルへ渡すパス。**区切りは `/` へ直す**——受け取る側は `dirname "${BASH_SOURCE[0]}"` や
 * `${…%/*}` で自分の置き場を出すので、Windowsの `\` のまま渡すと**区切りが1つも無い名前**に見え、
 * 隣のファイルをカレントから探しに行く。
 */
export const posix = (path) => path.replace(/\\/g, '/');

/**
 * `gh` を1回叩いて標準出力を返す。引けなければ `undefined`——**`gh` は自分で理由を言う**ので、
 * ここから言い足すことは無い。`allowFail` のときはその声も落とす（引けないことが答えになる呼び方）。
 */
export function gh(args, { allowFail = false } = {}) {
  const call = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', allowFail ? 'ignore' : 'inherit'],
  });
  return call.status === 0 && typeof call.stdout === 'string' ? call.stdout : undefined;
}

/**
 * bash のスクリプトを1本叩く。`capture` を立てなければ**出力はそのまま流す**（デーモンのログは
 * 叩いたスクリプトの声を含む）。標準エラーは常に流す。
 */
export function runBash(path, args, { input, capture = false } = {}) {
  const call = spawnSync('bash', [posix(path), ...args], {
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  return { status: call.status ?? 1, stdout: call.stdout ?? '' };
}

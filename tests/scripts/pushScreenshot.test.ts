import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/push-screenshot.sh` の、**転んだときに何を言うか**を見る検査。
 *
 * 画面が変わるPRの証跡は全部この道具を通るので、落ちると1枚も貼られない。しかも**理由を捨てて
 * 落ちると、読んだ側は権限なのか競合なのか通信なのかへ辿り着けない**（issue #1864）。
 *
 * `git` は本物を使い、一時ディレクトリに本物のリポジトリと素のリポジトリ（push 先）を作って
 * 走らせる——身代わりにすると、積めたことも断られたことも作り物になり、この検査が守るものが無くなる。
 * **断る側の言い分は `pre-receive` に言わせる**——git の言葉は環境の言語で変わるので、照合できる
 * 文字列をこちらから置く。
 */

// 実プロセス（bash と git）を何本も起こすため、`npm test` 全体を並行実行したときのCPU競合だけで
// 既定の5秒を超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/push-screenshot.sh');

/** 押し返す側の言い分。**この文字列が出力に残ること**で、理由を捨てていないと言える。 */
const REFUSAL = 'pre-receive-said-no';

interface World {
  /** push 先が押し返すか。 */
  readonly refuses?: boolean;
  /** push 先そのものを置かないか（＝引きにも積みにも行けない）。 */
  readonly noRemote?: boolean;
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** 画像を置く枝の名前。出力のURLに入るので、既定に任せず名指しで決める。 */
const BRANCH = 'work';

function push(world: World = {}): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-push-screenshot-'));
  try {
    const repo = join(work, 'repo');
    const origin = join(work, 'origin.git');
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    };

    execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' });
    if (world.refuses === true) {
      const hook = join(origin, 'hooks', 'pre-receive');
      writeFileSync(hook, `${STUB_SHEBANG}\necho '${REFUSAL}' >&2\nexit 1\n`, 'utf-8');
      chmodSync(hook, 0o755);
    }
    if (world.noRemote === true) rmSync(origin, { recursive: true, force: true });

    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', repo], { stdio: 'ignore' });
    writeFileSync(join(repo, 'README.md'), 'x\n', 'utf-8');
    git('add', 'README.md');
    git('commit', '-m', 'x');
    git('branch', '-M', BRANCH);
    git('remote', 'add', 'origin', pathForBash(origin));
    // **名乗りはこのリポジトリへ置く。** 叩く道具は自分で `git commit-tree` を打つので、`-c` で1回
    // ずつ渡すこちらの名乗りは届かない——名乗りの無い環境（CIのランナー）でだけ 128 で転ぶ。
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');

    const image = join(work, 'shot.png');
    writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = spawnScript(SCRIPT, [pathForBash(image), 'shot'], { cwd: repo, stdio: 'pipe' });
    return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('push-screenshot.sh', () => {
  it('積めたら、貼れるURLを1行だけ返す', () => {
    const run = push();

    expect(run.code).toBe(0);
    expect(run.out.trim().split('\n')).toHaveLength(1);
    expect(run.out.trim()).toMatch(
      new RegExp(`^https://raw\\.githubusercontent\\.com/.+/screenshots/${BRANCH}/shot\\.png$`),
    );
  });

  // **枝がまだ無いのか、引きに行けなかったのかは、打った側しか知らない。** 黙って空の木から積むと、
  // 積み上がるはずの画像が1枚だけの木に化けた回と、1枚目の回が見分けられない。
  it('引けずに空の木から積むときは、git が言った理由を載せる', () => {
    expect(push().err).toMatch(/screenshots を引けなかったので、空の木から積む: \S/);
  });

  // **落ちた理由を決めつけない。** 押し返されたのを「枝が動いた」と名乗ると、引き直しても直らない
  // 理由が同じ顔で何度も出る。
  it('押し返されたら、押し返した側の言い分を載せる', () => {
    const run = push({ refuses: true });

    expect(run.code).toBe(1);
    expect(run.err).toContain(REFUSAL);
    expect(run.out).toBe('');
  });

  // 繰り返しを使い切った最後の1行も、理由を運ぶ——**読む者がそこしか見ないことがある。**
  it('繰り返しを使い切った行にも、理由が載る', () => {
    expect(push({ refuses: true }).err).toMatch(new RegExp(`回続けて push できなかった: .*${REFUSAL}`));
  });

  // push 先そのものへ届かない形。競合とは打つ手が違うので、**同じ文面で名乗らせない。**
  it('push 先へ届かなければ、届かなかったことが理由として残る', () => {
    const run = push({ noRemote: true });

    expect(run.code).toBe(1);
    expect(run.err).not.toContain(REFUSAL);
    expect(run.err).toMatch(/回続けて push できなかった: \S/);
  });
});

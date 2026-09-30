import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Reporter, TestModule, Vitest } from 'vitest/node';

/** 落ちた回の記録の置き場（作業ツリーの根から。`.gitignore` 済み）。 */
export const FAILED_RUN_DIR = '.test-failures';

/** 残す記録の上限。古いものから消す。 */
export const KEPT_RECORDS = 20;

/** 記録に書く失敗1件。 */
interface Failure {
  readonly where: string;
  readonly name: string;
  readonly durationMs?: number;
  readonly errors: readonly { readonly message: string; readonly stack?: string }[];
}

/**
 * 落ちた検査があった回だけ、その名前と文面を `.test-failures/<時刻>.md` へ残すレポータ。
 *
 * **丸ごと走らせた回にだけ落ち、走らせ直すと通る検査は、端末の出力が流れると何が落ちたかが残らない**
 * （issue #2359）。1回ごとに別のファイルへ書くので、通った走らせ直しに上書きされない。
 * 読む者と読む手順は `CLAUDE.md`「実装スタイル」。
 */
export class FailedRunRecorder implements Reporter {
  private root = process.cwd();

  constructor(private readonly now: () => Date = () => new Date()) {}

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly { readonly message: string; readonly stack?: string }[],
  ): void {
    const failures = [
      ...testModules.flatMap((module) => this.failuresIn(module)),
      ...(unhandledErrors.length > 0
        ? [{ where: '（どのファイルにも属さない）', name: '捕まらなかったエラー', errors: unhandledErrors }]
        : []),
    ];
    if (failures.length === 0) return;

    const dir = join(this.root, FAILED_RUN_DIR);
    mkdirSync(dir, { recursive: true });
    const stamp = this.now().toISOString().replace(/:/g, '-');
    const file = join(dir, `${stamp}.md`);
    writeFileSync(file, renderRecord(stamp, process.argv.slice(2), testModules.length, failures));
    pruneOldRecords(dir);
    console.log(`\n落ちた検査の記録: ${relative(this.root, file)}`);
  }

  private failuresIn(module: TestModule): Failure[] {
    const where = relative(this.root, module.moduleId);
    const moduleErrors = module.errors();
    return [
      ...(moduleErrors.length > 0 ? [{ where, name: '（ファイル全体）', errors: moduleErrors }] : []),
      ...[...module.children.allSuites()]
        .filter((suite) => suite.errors().length > 0)
        .map((suite) => ({ where, name: suite.fullName, errors: suite.errors() })),
      ...[...module.children.allTests('failed')].map((test) => ({
        where,
        name: test.fullName,
        durationMs: test.diagnostic()?.duration,
        errors: test.result().errors ?? [],
      })),
    ];
  }
}

function renderRecord(
  stamp: string,
  args: readonly string[],
  moduleCount: number,
  failures: readonly Failure[],
): string {
  const lines = [`# ${stamp}`, '', `- 引数: \`${args.join(' ')}\``, `- 走ったファイル: ${moduleCount}`, ''];
  for (const failure of failures) {
    const duration = failure.durationMs === undefined ? '' : `（${Math.round(failure.durationMs)}ms）`;
    lines.push(`## ${failure.where} > ${failure.name}${duration}`, '');
    for (const error of failure.errors)
      lines.push('```', error.message, ...ownFrames(error.stack), '```', '');
  }
  return lines.join('\n');
}

/**
 * スタックのうち、リポジトリのコードを指す行だけ。文面は `message` の側から取る（時間切れの
 * スタックは文面を持たない）。
 */
function ownFrames(stack: string | undefined): string[] {
  return (stack ?? '').split('\n').filter((line) => /^\s+at /.test(line) && !line.includes('node_modules'));
}

function pruneOldRecords(dir: string): void {
  const records = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  for (const name of records.slice(0, -KEPT_RECORDS)) rmSync(join(dir, name));
}

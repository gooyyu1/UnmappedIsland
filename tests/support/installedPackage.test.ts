import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedPackageDir } from './installedPackage';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 本体の下に、自前の `node_modules` を持たない作業ツリーを置いた形。 */
function sharedTree(): { main: string; tree: string } {
  const main = realpathSync.native(mkdtempSync(join(tmpdir(), 'installed-package-')));
  roots.push(main);
  const tree = join(main, '.claude', 'worktrees', 'probe');
  mkdirSync(tree, { recursive: true });
  return { main, tree };
}

describe('依存の置き場', () => {
  it('作業ツリーに無ければ、親を遡って本体の node_modules から引く', () => {
    const { main, tree } = sharedTree();
    mkdirSync(join(main, 'node_modules', '@scope', 'probe'), { recursive: true });

    expect(installedPackageDir('@scope/probe', tree)).toBe(join(main, 'node_modules', '@scope', 'probe'));
  });

  it('作業ツリーが自前で持っていれば、そちらを引く', () => {
    const { main, tree } = sharedTree();
    mkdirSync(join(main, 'node_modules', 'probe'), { recursive: true });
    mkdirSync(join(tree, 'node_modules', 'probe'), { recursive: true });

    expect(installedPackageDir('probe', tree)).toBe(join(tree, 'node_modules', 'probe'));
  });

  it('どこにも無ければ、欠けた依存の名前と揃え方を告げて落ちる', () => {
    const { tree } = sharedTree();
    const missing = `absent-${process.pid}-probe`;

    expect(() => installedPackageDir(missing, tree)).toThrow(
      new RegExp(`依存 ${missing} が.*'npm install' を打つ`),
    );
  });
});

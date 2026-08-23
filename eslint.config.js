import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'site/', '.claude/worktrees/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'enumは使わず文字列リテラルユニオンを使う。' },
      ],
      eqeqeq: 'error',
    },
  },
  {
    // 型を見る規則を1つだけ足す。**「型の上では絶対に成り立つ条件」を弾く**ためで、これが残ると
    // 挙動は変わらないまま、読み手だけが「ここは undefined になりうるのか」と考えることになる。
    // 型が嘘をついている箇所（破棄済みのPhaser表示物・正規表現の捕獲グループ・添字）は、嘘を受ける
    // 場所を1つ作って型を正直にする（ui/lifetime.ts・ObjectDefTable.tryGet）。
    //
    // 型を読むので、tsconfigに載っている.tsだけに掛ける（.mjsのスクリプトは対象外）。
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-unnecessary-condition': 'error' },
  },
  {
    // ビルド用・skill付属のNode.js CLIスクリプト。ブラウザ向けdomain/gameコードとは実行環境が異なる。
    files: ['.claude/skills/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);

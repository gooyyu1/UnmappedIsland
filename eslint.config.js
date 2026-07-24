import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/', 'Assets/', 'Tests/', 'Library/', 'obj/'] },
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
    // skill付属のNode.js CLIスクリプト。ブラウザ向けdomain/gameコードとは実行環境が異なる。
    files: ['.claude/skills/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);

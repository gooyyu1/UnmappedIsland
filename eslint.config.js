import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const NO_ENUM = { selector: 'TSEnumDeclaration', message: 'enumは使わず文字列リテラルユニオンを使う。' };

/** 暦の値（1日の時間・1時間の分・1tickの分・1日のtick・1日の分）の字面。 */
const CALENDAR_LITERAL = '[raw=/^(15|24|60|96|1440)$/]';
/** src/domain/worldTime.ts が持つ暦の定数。 */
const CALENDAR_CONSTANT = 'Identifier[name=/^(HOURS|MINUTES|TICKS)_PER_(DAY|HOUR|TICK)$/]';
const CALENDAR_MESSAGE =
  '暦の数を字で書かず src/domain/worldTime.ts の定数を使う。暦ではない同じ数なら、この行で理由を添えて外す。';

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
      'no-restricted-syntax': ['error', NO_ENUM],
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
    // 暦（src/domain/worldTime.ts）と同じ数を、式の中や手元の定数へ字で書かせない（今の暦で効いているかは
    // tests/architecture/calendarLiterals.test.ts が見る）。暦を変えたとき、
    // 定数を引いている側だけが追従して字の側が古い長さのまま残るため。暦ではない同じ数
    // （画素・実時間の秒・宣言値）は、その行で理由を添えて外す。
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    ignores: ['src/domain/worldTime.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        NO_ENUM,
        {
          // 暦の定数へ掛ける側の字（`24 * MINUTES_PER_TICK` の24tick）は、暦ではなく単位の数なので外す。
          selector: `:matches(BinaryExpression[operator=/^([*/%]|[<>]=?)$/], AssignmentExpression[operator=/^[*/%]=$/]) > Literal${CALENDAR_LITERAL}:not(BinaryExpression[operator='*']:has(> ${CALENDAR_CONSTANT}) Literal)`,
          message: CALENDAR_MESSAGE,
        },
        {
          // 暦の単位そのものを名乗る定数（HOURS_PER_DAY・TICK_MINUTES・ONE_TICK など）の作り直し。
          selector: `VariableDeclarator[id.name=/per_?(day|hour|tick)$|^(one_?)?(tick|hour|day)(_?(minutes|hours|ticks))?$/i] > Literal.init${CALENDAR_LITERAL}`,
          message: CALENDAR_MESSAGE,
        },
        {
          // 時間を進める口へ渡す分。字の15は「1tick」、60は「1時間」のつもりで書かれている。
          selector: `CallExpression[callee.property.name=/^(advanceWorldTime|rollTimeOfDay)$/] > Literal.arguments${CALENDAR_LITERAL}`,
          message: CALENDAR_MESSAGE,
        },
      ],
    },
  },
  {
    // Node.jsのCLIスクリプト。ブラウザ向けdomain/gameコードとは実行環境が異なる。
    files: ['.claude/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);

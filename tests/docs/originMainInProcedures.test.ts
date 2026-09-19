import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 手順書が git へ渡す版を `origin/main` と名指すときの検査。**縛りは2つ**——起点がローカルの
 * `main` でないこと（[issue #1900](https://github.com/gooyyu1/UnmappedIsland/issues/1900)）と、
 * 渡す手前でその参照を取り直していること
 * （[issue #2092](https://github.com/gooyyu1/UnmappedIsland/issues/2092)）。
 *
 * 作業ブランチは `git checkout -B <枝> origin/main` で切るので、**ローカルの `main` は一度も
 * 動かない**。クローンしたままのクラウドのセッションでは、`main` を起点にした範囲の merge-base が
 * クローン時点まで下がり、そこから先に `origin/main` へ入った他人の変更が丸ごと差分に出る。
 *
 * **混ざっても差分は出るので、受け取った側は自分の差分だと思って読む。** 気づけるかどうかを
 * 読み手任せにしないために、起点の綴りを手順の側で縛る。
 *
 * その `origin/main` は、**クラウドのクローンには参照そのものが無いことがある**（実測: PR #2033 の
 * レビューのセッションで `git fetch origin main` が `* [new branch]` を出した）。取り直す手が手順に
 * 無いと、**順に辿った者は1番で `unknown revision` に当たって止まる**。起点を名指した以上、その
 * 起点を手に入れる手も同じ手順に要る。
 */

const ROOT = resolve(__dirname, '../..');

/**
 * 見ない先。**誤った書き方そのものを引くことが仕事の場所**で、縛ると記録が書けなくなる。
 * `analysis/`・`decisions/` はその時点の記録、`DesignNotes.md` は経緯を主題とする文書、
 * このファイルは検査自身。
 */
const RECORDS = new Set([
  join(ROOT, 'agent-ops', 'analysis'),
  join(ROOT, 'agent-ops', 'decisions'),
  join(ROOT, 'docs', 'DesignNotes.md'),
  __filename,
]);

/**
 * 開かない拡張子。**外すのは中身が文字でないものだけ**——開く側を並べると、並べ忘れた拡張子に
 * 書いた手順が黙って見張りの外に落ちる（`.py` も `.js` も、並べる形だった間は外に落ちていた）。
 * 手順を書ける置き場は言語でも拡張子でも決まらないので、**絞りは「読めるか」だけで掛ける。**
 */
const BINARY_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.mp3',
  '.ogg',
  '.wav',
  '.mp4',
  '.pdf',
  '.zip',
  '.gz',
] as const;

/**
 * ローカルの `main` を起点に置いた書き方。`origin/main` と、`$main_tip` のような変数名は外す。
 *
 * 範囲の記法だけでは足りない——`git diff main HEAD` のように `..` を使わない形でも同じことが
 * 起きるので、git の読み出しを名指しした行も見る。そちらは `main.md` のような**パスの一部**を
 * 拾わないよう `.` の続くものを外す（範囲の側は1つ目が拾う）。
 */
const PATTERNS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: '範囲の起点', pattern: /(?<![\w/$-])main\.{2,3}/ },
  {
    what: 'git へ渡す版',
    pattern: /git\s+(?:diff|log|rev-list|merge-base)[^\n`]*?(?<![\w/$-])main(?![\w/.-])/,
  },
];

/**
 * `origin/main` を git へ渡している行。**拾う範囲を1つの ` ` の中へ閉じる**（`[^\n`]*`）——
 * 地の文で `git` と `origin/main` が別々の ` ` に在るだけの行は打つ手順ではないので、跨いで拾わない。
 * 先頭の否定は `result.git.some(...)` のようなプロパティを外すためで、打つ形は必ず `git ` で始まる。
 */
const HANDS_ORIGIN_MAIN = /(?<![\w.-])git\s[^\n`]*origin\/main/;

/**
 * `origin` から `main` を取り直している行。`git -C <本体> fetch --quiet origin main` のように
 * 語の間へ何が挟まっても同じなので、順だけを見る。
 */
const FETCHES_ORIGIN_MAIN = /(?<![\w.-])git\s[^\n]*\bfetch\b[^\n]*\borigin\s+main\b/;

/**
 * `body` の `at` 行目を打つまでに、`origin` から `main` を取り直しているか。
 *
 * **遡るのは空行まで**——ファイルのどこかに1つ在れば足りることにすると、**後から別の段へ足された
 * 手順が、離れた場所の取り直しに守られているふりをして通る。** 取り直しは、渡す手順と地続きで
 * 書いてあって初めて、順に辿った者の手に入る。
 */
function fetchedInParagraph(body: readonly string[], at: number): boolean {
  for (let index = at; index >= 0 && body[index].trim() !== ''; index -= 1) {
    if (FETCHES_ORIGIN_MAIN.test(body[index])) return true;
  }
  return false;
}

/**
 * 走査するファイル。**追跡しているもの全部**から、{@link RECORDS} と読めないものだけを外す。
 * 追跡で引くのは、生成物・各セッションのリポジトリ・`node_modules` が最初から入らないため
 * ——降りない場所を自分で並べると、置き場が増えるたびに並びのほうが古びる。
 */
function trackedFiles(): readonly string[] {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' });
  return listed
    .split('\0')
    .filter((rel) => rel !== '')
    .map((rel) => join(ROOT, ...rel.split('/')))
    .filter((path) => ![...RECORDS].some((record) => path === record || path.startsWith(record + sep)))
    .filter((path) => !BINARY_EXTS.some((ext) => path.toLowerCase().endsWith(ext)));
}

/** 追跡しているテキストファイルを全部、`[path, 各行]` へ開く。 */
function files(): readonly (readonly [string, readonly string[]])[] {
  return trackedFiles().map(
    (path) => [relative(ROOT, path), readFileSync(path, 'utf-8').split('\n')] as const,
  );
}

/** {@link files} を `[path, 行番号, 行]` へ均す。 */
function lines(): readonly (readonly [string, number, string])[] {
  return files().flatMap(([path, body]) =>
    body.map((line, index) => [path, index + 1, line] as const),
  );
}

describe('見ない先が、現物を指している', () => {
  // 綴りが現物とずれても、除外が当たらなくなるだけで走査は通る——**赤くなるのは、その文書が
  // たまたま起点の綴りを含むときだけ**。見ない先を動かしたときに、ここが落ちる。
  it.each([...RECORDS])('%s が在る', (path) => {
    expect(existsSync(path)).toBe(true);
  });
});

describe('手順が指す git の版', () => {
  it('手順書もスクリプトも、ローカルの `main` を起点にしない', () => {
    const found = lines().flatMap(([path, no, line]) =>
      PATTERNS.filter(({ pattern }) => pattern.test(line)).map(
        ({ what }) => `${path}:${no}（${what}）`,
      ),
    );

    expect(found, 'ローカルの `main` はクローンしたまま動かない。`origin/main` を起点にする').toEqual(
      [],
    );
  });

  it('`origin/main` を git へ渡す手順は、同じ段の中でその参照を取り直している', () => {
    const found = files().flatMap(([path, body]) =>
      body
        .map((line, index) => [index, line] as const)
        .filter(([index, line]) => HANDS_ORIGIN_MAIN.test(line) && !fetchedInParagraph(body, index))
        .map(([index]) => `${path}:${index + 1}`),
    );

    expect(
      found,
      '`origin/main` はクラウドのクローンに無いことがある。渡す手前で `git fetch origin main` を打つ',
    ).toEqual([]);
  });
});

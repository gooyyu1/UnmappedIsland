import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isVerbatimRecord, trackedDocs } from '../../scripts/docScope.mjs';

/**
 * 文書が名指しする `docs/` のフォルダが、現物と同じ綴りかの検査
 * （[`docs/README.md`](../../docs/README.md)）。
 *
 * **フォルダ名は、リンクの指し先と題名の2箇所に現れる。** 指し先が実在するかは
 * [`docReferences.test.ts`](docReferences.test.ts) が見るが、題名の綴りはどちらの側でもないので、
 * 指し先が合っていても `Engine/` と名乗ったまま緑になる（issue #2091）。
 *
 * **見るのはリンクの題名と囲みだけで、地の文は見ない**（{@link folderMentionsIn}）。地の文まで
 * 広げると `UI/UX` のような同じ字面と区別が付かないため、そこは緑でも綴りの保証は無い。
 *
 * 案内の大元である `docs/README.md` のツリー図は、フォルダを増減させたときにも置き去りになる。
 * こちらは**過不足なく**突き合わせる——載っていないフォルダは、読み手には無いのと同じ。
 */

const ROOT = resolve(__dirname, '../..');

const INDEX = 'docs/README.md';

/** ツリー図の枝。`├── concept/` の形で、フォルダ名だけを取る。 */
const BRANCH = /^[├└]── ([^/\s]+)\//gm;

/** フォルダを名乗る表記。`../` は起点を示すだけなので落とす。 */
const FOLDER_MENTION = /^(?:\.{1,2}\/)*([^/\s]+)\/$/;

/** `docs/` 直下のフォルダ。 */
function folders(): string[] {
  return readdirSync(join(ROOT, 'docs')).filter((entry) =>
    statSync(join(ROOT, 'docs', entry)).isDirectory(),
  );
}

/**
 * その本文がフォルダとして名乗っている綴りを、行番号付きで返す。**見るのはリンクの題名と囲みだけ。**
 * 地の文の `UI/UX` のように、フォルダを指していない字面が同じ形で現れるため。
 */
function folderMentionsIn(text: string): { name: string; line: number }[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const labels = [...line.matchAll(/\[([^\]\n]+)\]\(/g)].map(([, label]) => label);
    const spans = [...line.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span);
    return [...labels, ...spans]
      .map((text) => FOLDER_MENTION.exec(text.split('`').join('')))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ name: match[1], line: index + 1 }));
  });
}

/** 現物と同じ名前を、違う綴りで名乗っているもの。 */
function misspelledIn(rel: string, text: string): string[] {
  const actual = new Set(folders());
  const byLowerCase = new Map([...actual].map((name) => [name.toLowerCase(), name]));
  return folderMentionsIn(text)
    .filter(({ name }) => !actual.has(name) && byLowerCase.has(name.toLowerCase()))
    .map(({ name, line }) => `${rel}:${line} ${name}/`);
}

/** 綴りを課す文書。当時の現物をそのまま残す記録は、直す先が記録の書き換えしか無いので外す。 */
function documents(): string[] {
  return trackedDocs(ROOT).filter((rel) => !isVerbatimRecord(rel));
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel.split('/').join(sep)), 'utf-8');
}

/** ツリー図が枝として挙げているフォルダ名。 */
function treeFolders(text: string): string[] {
  return [...text.matchAll(BRANCH)].map(([, name]) => name).sort();
}

describe('文書が名乗る docs/ のフォルダ名は、現物と同じ綴り', () => {
  it(`${INDEX} のツリー図が、現物のフォルダと過不足なく一致する`, () => {
    expect(treeFolders(read(INDEX))).toEqual([...folders()].sort());
  });

  it.each(documents())('%s', (rel) => {
    expect(misspelledIn(rel, read(rel))).toEqual([]);
  });

  it('綴りを変えれば落ちる（リンクの題名でも囲みでも）', () => {
    const probe = '[Engine/](./engine/README.md) と `../World/` を参照してください。';
    expect(misspelledIn('probe.md', probe)).toEqual(['probe.md:1 Engine/', 'probe.md:1 World/']);
  });

  it('ツリー図の枝を拾えていて、綴りが1つ違っても増減しても落ちる', () => {
    const probe = 'docs/\n├── Engine/   # 綴り違い\n└── engine/   # 現物の綴り\n';
    expect(treeFolders(probe)).toEqual(['Engine', 'engine']);

    const actual = [...folders()].sort();
    expect([actual[0].toUpperCase(), ...actual.slice(1)].sort()).not.toEqual(actual);
    expect(actual.slice(1)).not.toEqual(actual);
  });

  it('フォルダを指していない字面（UI/UX）は名乗りとして読まない', () => {
    expect(folderMentionsIn('`UI/UX` と [UI/UX](./ui/README.md) は綴りではない')).toEqual([]);
  });
});

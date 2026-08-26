// TypeDocはnavigationLinksのURLを、ページの階層に関わらずそのままhrefへ書き出す
// （アセット等と違い、ページからの相対パスに直してくれない）。そのため相対リンクを書くと
// Reference/index.htmlでは正しくても、Reference/modules/*.html など深い階層のページからは
// 1階層ずれた先を指してしまう。
//
// そこでtypedoc.jsonでは行き先をサイトルート（site/）起点で `%SITE_ROOT%/…` と書いておき、
// 生成後にこのスクリプトが各ページの深さに合わせた相対パス（`..` や `../..`）へ置き換える。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = '%SITE_ROOT%';
// typedoc.jsonの"out"と、その出力先を含むサイトルート。
const REFERENCE_DIR = 'site/reference';
const SITE_ROOT = 'site';

const htmlFiles = readdirSync(REFERENCE_DIR, { recursive: true })
  .filter((entry) => entry.endsWith('.html'))
  .map((entry) => path.join(REFERENCE_DIR, entry));

let rewritten = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes(PLACEHOLDER)) continue;

  const toSiteRoot = path.relative(path.dirname(file), SITE_ROOT).split(path.sep).join('/');
  writeFileSync(file, html.replaceAll(PLACEHOLDER, toSiteRoot));
  rewritten += 1;
}

if (rewritten === 0) {
  console.error(
    `${PLACEHOLDER} を含むページが ${REFERENCE_DIR} にありません。` +
      'typedoc.jsonのnavigationLinksか、このスクリプトの出力先設定がずれています。',
  );
  process.exit(1);
}

console.log(`ナビゲーションリンクを ${rewritten} ページで解決しました。`);

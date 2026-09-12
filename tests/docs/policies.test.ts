import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 価値観の記録と、その素になる判断の履歴が、宣言した書式どおりかの検査
 * （`.claude/skills/policy-review/SKILL.md`）。
 *
 * **書式を宣言しただけでは守られない**（前の版は「1件3行以内」と書いたまま14行の項目を抱えていた）。
 * 質の判定——出どころがユーザー本人か・一般論から再現できないか——は棚卸しで人が見るので、ここが
 * 見るのは機械で決まる分だけ。
 */

const ROOT = resolve(__dirname, '../..');

const POLICIES = join(ROOT, 'agent-ops', 'policies.md');
const DECISIONS = join(ROOT, 'agent-ops', 'decisions');

/** `policies.md` の総量の上限（SKILL.md「棚卸しの手順」）。超えたら畳むか捨てる。 */
const MAX_LINES = 220;

/** 1項目に置くフィールドと、その順序。 */
const FIELDS = ['場面', '選ぶ方', '重視'] as const;

/**
 * 履歴が持つ節と、その順序。**混ぜて書くと、エージェントの読みがユーザーの判断そのものとして
 * 読まれる**（SKILL.md「履歴の書式」）。
 */
const SECTIONS = ['ユーザーの発言', 'エージェントの解釈'] as const;

/** 1項目の行数の上限。3行に収まらないものは、束ね方が粗いか、まだ一般則になっていない。 */
const MAX_ITEM_LINES = 3;

/**
 * 事例を本文へ書かせないための検査。具体の出典は履歴と `docs/engine/DesignNotes.md` が持つ。
 * 引きたくなったら、それは事例であって一般則ではない。
 */
const CITATIONS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: '日付', pattern: /\d{4}-\d{2}-\d{2}/ },
  { what: 'PR・issue の番号', pattern: /#\d+/ },
  { what: '出どころの引用', pattern: /出どころ/ },
  { what: '節番号', pattern: /\d+(\.\d+)*\s*節/ },
];

interface Item {
  /** 属する節の見出し。 */
  readonly section: string;
  /** 原文での開始行（1始まり）。 */
  readonly line: number;
  /** 項目を構成する行。 */
  readonly lines: readonly string[];
}

/** `- **場面**:` で始まり、続く字下げ行までを1項目として切り出す。 */
function itemsOf(markdown: string): Item[] {
  const items: Item[] = [];
  let section = '';
  let current: { section: string; line: number; lines: string[] } | undefined;

  markdown.split(/\r?\n/).forEach((raw, index) => {
    if (raw.startsWith('## ')) {
      current = undefined;
      section = raw.slice(3);
      return;
    }
    if (raw.startsWith(`- **${FIELDS[0]}**`)) {
      current = { section, line: index + 1, lines: [raw] };
      items.push(current);
      return;
    }
    if (current && raw.startsWith('  ')) current.lines.push(raw);
    else current = undefined;
  });

  return items;
}

function decisionFiles(): { readonly rel: string; readonly text: string }[] {
  const found: { rel: string; text: string }[] = [];
  for (const dir of [DECISIONS, join(DECISIONS, 'archive')]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      found.push({ rel: join(dir, name), text: readFileSync(join(dir, name), 'utf-8') });
    }
  }
  return found;
}

describe('価値観の記録', () => {
  const text = readFileSync(POLICIES, 'utf-8');
  const items = itemsOf(text);

  it('項目が在る', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('総量が上限を超えない', () => {
    expect(text.split(/\r?\n/).length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('1項目は3行以内', () => {
    const over = items
      .filter((item) => item.lines.length > MAX_ITEM_LINES)
      .map((item) => `${item.line}行目（${item.section}）: ${item.lines.length}行`);

    expect(over).toEqual([]);
  });

  it('場面・選ぶ方・重視が、この順にちょうど1つずつ', () => {
    const broken = items
      .filter((item) => {
        const found = item.lines.flatMap((line) =>
          FIELDS.filter((field) => line.includes(`**${field}**:`)),
        );
        return found.join('/') !== FIELDS.join('/');
      })
      .map((item) => `${item.line}行目（${item.section}）`);

    expect(broken).toEqual([]);
  });

  it('事例を本文へ書かない', () => {
    const cited = items.flatMap((item) =>
      CITATIONS.filter(({ pattern }) => pattern.test(item.lines.join('\n'))).map(
        ({ what }) => `${item.line}行目（${item.section}）: ${what}`,
      ),
    );

    expect(cited).toEqual([]);
  });
});

describe('判断の履歴', () => {
  const files = decisionFiles();

  it('履歴が在る', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('日付と文脈を持つ', () => {
    const broken = files
      .filter(({ text }) => !/^---\r?\ndate: \d{4}-\d{2}-\d{2}\r?\ncontext: \S/.test(text))
      .map(({ rel }) => rel);

    expect(broken).toEqual([]);
  });

  it('発言と解釈を、この順に節で分けている', () => {
    const broken = files
      .filter(({ text }) => {
        const found = text
          .split(/\r?\n/)
          .filter((line) => line.startsWith('## '))
          .map((line) => line.slice(3).trim());
        return found.join('/') !== SECTIONS.join('/');
      })
      .map(({ rel }) => rel);

    expect(broken).toEqual([]);
  });

  // 原文が残っていることが、抽出が正しかったかを後から確かめられる唯一の手立て。
  // **引用は発言の節の中に置く**——解釈の側へ回ると、どちらが誰のものかが見分けられなくなる。
  it('ユーザーの発言を、発言の節の中で引用している', () => {
    const broken = files
      .filter(({ text }) => !/^> \S/m.test(text.split(`## ${SECTIONS[1]}`)[0]))
      .map(({ rel }) => rel);

    expect(broken).toEqual([]);
  });

  it('ファイル名の日付が中身と一致する', () => {
    const broken = files
      .filter(({ rel, text }) => {
        const inName = /(\d{4}-\d{2}-\d{2})-/.exec(rel.split(/[\\/]/).at(-1) ?? '')?.[1];
        const inBody = /^date: (\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
        return inName !== inBody;
      })
      .map(({ rel }) => rel);

    expect(broken).toEqual([]);
  });
});

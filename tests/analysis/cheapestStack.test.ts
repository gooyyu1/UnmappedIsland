import { describe, expect, it } from 'vitest';
import { cheapestStackOf } from '../../src/analysis/dailyPhases';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 段へ届くまで積む山の、いちばん安い積み方（`src/analysis/dailyPhases.ts`の`cheapestStackOf`）。
 *
 * **押さえているのは解き方であって、同梱の世界ではない**——同梱の設えを通すと、点あたりの手間の
 * 順位が入れ替わるような変更と、解き方の誤りとが、どちらも同じ形（`stats/terrain.yaml`の差分）で
 * しか出てこない。ここは候補をその場で宣言して、線と点数と値段だけを動かす。
 */

/** 候補1つの宣言（押し上げる点数と、素材から手に入れるまでの総労働）。 */
interface Candidate {
  readonly name: string;
  readonly lift: number;
  readonly minutes: number;
}

/**
 * 候補を`furnishing`タグで名乗らせた世界と、そこに立つ`hermit`。`hermit`の`comfort`は`snug`で
 * `threshold`に届く。
 */
function worldOf(candidates: readonly Candidate[], threshold: number): ReturnType<typeof buildCodex> {
  return buildCodex(`
object_defs:
  hermit:
    props:
      comfort:
        value: 0
        base: {subject: ancestor}
        stages:
          - {name: bare}
          - {name: snug, min: ${threshold}}
${candidates
  .map(
    (candidate) => `  ${candidate.name}:
    tags: [furnishing]
    passives:
      - modify:
          ancestor:
            comfort: ${candidate.lift}`,
  )
  .join('\n')}
`);
}

function buildCodex(yaml: string) {
  return new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
}

const STACK = { tag: 'furnishing', propertyName: 'comfort', stageName: 'snug' };

/** その候補たちで`threshold`へ届く、いちばん安い積み方（型の名前を数えた表）。 */
function stackOf(candidates: readonly Candidate[], threshold: number): Record<string, number> {
  const minutesOf = new Map(candidates.map((candidate) => [candidate.name, candidate.minutes]));
  const placed = cheapestStackOf(
    worldOf(candidates, threshold),
    'hermit',
    (name) => minutesOf.get(name)!,
    STACK,
  );

  const counts: Record<string, number> = {};
  for (const name of placed) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

describe('段へ届かせる、いちばん安い積み方', () => {
  it('点あたりの手間がいちばん安い型を並べるだけでは最小にならない', () => {
    // 刻みが線に噛み合わない型は、届く手前で行き過ぎるぶんを総労働へ乗せる。点あたりで選ぶと
    // 3点×2個（60分・行き過ぎ1点）を採るが、5点1個（55分）のほうが安い。
    const stack = stackOf(
      [
        { name: 'cheap_per_point', lift: 3, minutes: 30 },
        { name: 'fits_the_line', lift: 5, minutes: 55 },
      ],
      5,
    );

    expect(stack).toEqual({ fits_the_line: 1 });
  });

  it('端数は、混ぜて埋めたほうが安いなら混ぜる', () => {
    // 10点へ、4点(40分)だけなら3個で120分。2個(80分)に1点(15分)を2つ足せば110分で届く。
    const stack = stackOf(
      [
        { name: 'bulk', lift: 4, minutes: 40 },
        { name: 'filler', lift: 1, minutes: 15 },
      ],
      10,
    );

    expect(stack).toEqual({ bulk: 2, filler: 2 });
  });

  it('同じ型を何個並べてもよい', () => {
    const stack = stackOf([{ name: 'only_one_kind', lift: 7, minutes: 10 }], 50);

    // 7点ずつでは50点ちょうどに乗らないので、越えるまで積む。
    expect(stack).toEqual({ only_one_kind: 8 });
  });

  it('線を越えた先までは積まない', () => {
    // 「その点数以上」で止まる。行き過ぎるぶんは手間になるだけなので、越えた先を埋めない。
    const stack = stackOf([{ name: 'oversized', lift: 40, minutes: 10 }], 10);

    expect(stack).toEqual({ oversized: 1 });
  });
});

describe('積む型が1つも出ない形は、どれを直せばよいかを名指しする', () => {
  const CANDIDATE: Candidate = { name: 'log_stool', lift: 8, minutes: 100 };

  /** タグ・プロパティ・段の名乗りだけを差し替えて解かせ、投げた文言を返す。 */
  function thrownBy(stack: typeof STACK, yaml: string): string {
    try {
      cheapestStackOf(buildCodex(yaml), 'hermit', () => CANDIDATE.minutes, stack);
    } catch (error) {
      return (error as Error).message;
    }
    return '';
  }

  const WORLD = `
object_defs:
  hermit:
    props:
      comfort:
        value: 0
        base: {subject: ancestor}
        stages:
          - {name: bare}
          - {name: snug, min: 50}
  log_stool:
    tags: [furnishing]
    passives:
      - modify:
          ancestor:
            comfort: 8
`;

  it('タグの名が世界に無ければ、タグが無いと言う（綴りの誤り）', () => {
    const message = thrownBy({ ...STACK, tag: 'furnishings' }, WORLD);

    expect(message).toContain('タグが、世界にありません');
  });

  it('タグは在るが誰も名乗っていなければ、名乗る型が無いと言う（タグの付け忘れ）', () => {
    // タグそのものは受け入れ条件が名乗っているので世界に在るが、型は1つも付けていない。
    const message = thrownBy(
      STACK,
      `
object_defs:
  hermit:
    props:
      comfort:
        value: 0
        base: {subject: ancestor}
        stages:
          - {name: bare}
          - {name: snug, min: 50}
    slots:
      fixtures: {cell: {accept: {tag: furnishing}}}
  log_stool:
    props:
      weight: {value: 1}
`,
    );

    expect(message).toContain('タグを名乗る型が、世界に1つもありません');
  });

  it('名乗ってはいるが誰も押し上げないなら、押し上げが無いと言う（modifyの書き忘れ）', () => {
    const message = thrownBy(
      STACK,
      `
object_defs:
  hermit:
    props:
      comfort:
        value: 0
        base: {subject: ancestor}
        stages:
          - {name: bare}
          - {name: snug, min: 50}
  log_stool:
    tags: [furnishing]
    props:
      weight: {value: 1}
`,
    );

    expect(message).toContain('常に押し上げる型が1つもありません');
  });

  it('プロパティと人物は、別々に名指しする', () => {
    expect(thrownBy({ ...STACK, propertyName: 'comfy' }, WORLD)).toContain('プロパティが、世界にありません');
    expect(thrownBy({ ...STACK, stageName: 'cozy' }, WORLD)).toContain('段の下限が、その人物にありません');
  });
});

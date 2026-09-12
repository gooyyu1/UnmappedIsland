import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { MINUTES_PER_TICK, TICKS_PER_DAY } from '../../src/domain/worldTime';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 文書が「何日ぶん」「何日で戻る」と書いた目盛りが、宣言のとおりかの検査。
 *
 * 収支表から書き写した数値は出どころの印が見る（`tests/docs/docStatsCitations.test.ts`）が、
 * **割り算の結果は表のどのセルでもない**——甕1つが何日ぶんかは容量と換算率と減りの3つが揃って
 * 初めて出るので、どれが動いても表は緑のまま文書だけが嘘になる。ここが見るのはその割り算で、
 * 数え直すのではなく**実際に飲ませ、実際に傷を負わせて**測る。
 *
 * 見ているのは次の3つ。
 *
 * - 器1つが何日ぶんか（`LiquidContainerSystem.md` 5節・`Voyage.md` 3.9.6節・`GameEndings.md` 9.2節）
 * - 牙の傷1つが奪う量と、戻るのにかかる日数（`VitalsSystem.md` 3節・3.3節）
 * - 3.3節と`DigestionSystem.md` 9節・未決事項節が最小の献立について言っていること
 */

const ROOT = join(__dirname, '..', '..');

function docText(...segments: string[]): string {
  return readFileSync(join(ROOT, 'docs', ...segments), 'utf-8');
}

/** 文書の、その正規表現が捕らえた数。捕まらなければ落とす（書き換えで数が消えたことも壊れた状態）。 */
function numberIn(text: string, pattern: RegExp, label: string): number {
  const matched = pattern.exec(text);
  expect(matched, `${label} が文書から読めない（${String(pattern)}）`).not.toBeNull();
  return Number.parseFloat(matched![1].replace(/,/g, ''));
}

const LIQUID_DOC = docText('engine', 'LiquidContainerSystem.md');
const VITALS_DOC = docText('engine', 'VitalsSystem.md');
const VOYAGE_DOC = docText('world', 'Voyage.md');
const ENDINGS_DOC = docText('concept', 'GameEndings.md');

describe('文書が書いた「何日ぶん」', () => {
  const codex = bundledCodex();
  const fillId = codex.propertyNames.getId('fill');
  const hydrationId = codex.propertyNames.getId('hydration');
  const bloodId = codex.propertyNames.getId('blood');
  const weightId = codex.propertyNames.getId('weight');

  function spawn(objectName: string): WorldObject {
    return new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  /** 満たした器から飲み切るまでの、飲んだ回数と体が受け取ったtick数。 */
  function drainOf(containerName: string): { drinks: number; hydrationTicks: number } {
    const filled = spawn(`${containerName}__content_water_liquid`);
    const capacity = filled.getProperty(fillId).def.range?.max;
    expect(capacity, `${containerName} が容量を持たない`).toBeDefined();
    filled.getProperty(fillId).setNumberWithoutEvents(capacity!);

    const agent = spawn(SAMPLE_CHARACTER);
    let drinks = 0;
    let hydrationTicks = 0;
    // hydrationは3日ぶんしか入らないので、甕1つぶんを一度には受け取れない。**受け取った量を
    // 数えるのが目的**なので、1杯ごとに空にして満水の段（not_thirsty）に当たらないようにする。
    while ((filled.tryGetProperty(fillId)?.number ?? 0) > 0) {
      agent.getProperty(hydrationId).setNumberWithoutEvents(0);
      const executed = filled.tryGetAction('drink', agent)?.tryExecute() === true;
      expect(executed, `${containerName} から飲めない`).toBe(true);
      drinks += 1;
      hydrationTicks += agent.getProperty(hydrationId).number;
    }
    return { drinks, hydrationTicks };
  }

  it('器1つが何日ぶんかが、容量と飲用の換算率と素の減りから出る', () => {
    const jar = drainOf('jar');
    const bowl = drainOf('coconut_bowl');

    expect(numberIn(LIQUID_DOC, /甕（4,000mL）は \*\*(\d+) 杯/, '甕の杯数'), '甕1つで飲める回数').toBe(
      jar.drinks,
    );
    expect(
      numberIn(LIQUID_DOC, /甕（4,000mL）は \*\*\d+ 杯＝([\d.]+) 日ぶん\*\*/, '甕の日数'),
      '甕1つが賄う日数',
    ).toBeCloseTo(jar.hydrationTicks / TICKS_PER_DAY, 1);
    expect(
      numberIn(LIQUID_DOC, /ヤシの器（250mL）は \*\*(\d+) 杯/, 'ヤシの器の杯数'),
      'ヤシの器1つで飲める回数',
    ).toBe(bowl.drinks);
    expect(
      numberIn(LIQUID_DOC, /ヤシの器（250mL）は \*\*\d+ 杯＝([\d.]+) 時間ぶん\*\*/, 'ヤシの器の時間'),
      'ヤシの器1つが賄う時間',
    ).toBeCloseTo((bowl.hydrationTicks * MINUTES_PER_TICK) / 60, 1);

    // 積む数の元になる目盛りは、同じ1つでなければならない（3か所に同じ数が書いてある）。
    for (const [doc, text] of [
      ['Voyage.md', VOYAGE_DOC],
      ['GameEndings.md', ENDINGS_DOC],
    ] as const) {
      expect(
        numberIn(text, /甕 1 つは ([\d.]+) 日ぶん/, `${doc} の甕の日数`),
        `${doc} が書いた甕の日数`,
      ).toBeCloseTo(jar.hydrationTicks / TICKS_PER_DAY, 1);
    }
  });

  it('満たした甕の重さとかさが、Voyage.mdの積荷の勘定と合う', () => {
    const filled = spawn('jar__content_water_liquid');
    filled.getProperty(fillId).setNumberWithoutEvents(filled.getProperty(fillId).def.range!.max);

    const grams = filled.getProperty(weightId).getEffectiveValue();
    expect(numberIn(VOYAGE_DOC, /満たした甕は ([\d.]+)kg/, '満水の甕の重さ')).toBeCloseTo(grams / 1000, 1);
    expect(numberIn(VOYAGE_DOC, /満たした甕は [\d.]+kg（器 ([\d.]+)kg/, '甕の自重')).toBeCloseTo(
      spawn('jar').getProperty(weightId).getEffectiveValue() / 1000,
      1,
    );

    // 積める数の上限を決めるもう一方。甕が場所を取るのは中身ではなく外寸（volume）で、
    // 筏が受けられるのは枠のcapacity（LiquidContainerSystem.md 5節・ContainerSystem.md 1節）。
    const volumeId = codex.propertyNames.getId('volume');
    expect(numberIn(VOYAGE_DOC, /甕 1 つが (\d+) L/, '甕のかさ')).toBe(
      spawn('jar').getProperty(volumeId).getEffectiveValue() / 1000,
    );
    const raftCargo = codex.objects
      .get(codex.objectNames.getId('raft'))
      .enumerateSlotDefs()
      .map((slot) => slot.capacity)
      .filter((capacity): capacity is number => capacity !== undefined);
    expect(raftCargo, '筏がかさの上限を持つ枠を1つも宣言していない').not.toEqual([]);
    expect(numberIn(VOYAGE_DOC, /筏の (\d+) L/, '筏のかさ') * 1000, '筏が受けられるかさ').toBe(
      Math.max(...raftCargo),
    );
  });

  it('牙の傷が奪う量と、戻るのにかかる日数が、宣言から出る', () => {
    // 素のキャラクタは水分が安全域の下（216 < hydratedの230）なので、血の戻りは効かない
    // （VitalsSystem.md 3.1節）。奪われた量だけを数えるのに、そのまま使える。
    const wounded = spawn(SAMPLE_CHARACTER);
    const before = wounded.getProperty(bloodId).number;
    const wound = spawn('gore_wound');
    expect(wound.moveToSlotOrRejection(wounded.getSlot(codex.slotNames.getId('injuries')))).toBeUndefined();
    // 固まるまで（bleedingが尽きるまで）進める。余分に回しても、止まった後は減らない。
    for (let i = 0; i < 8; i += 1) wounded.tick();
    const lost = before - wounded.getProperty(bloodId).number;

    // 戻る側。水分を満たすとゲートが開き、毎tick増える（同 3節）。
    const healthy = spawn(SAMPLE_CHARACTER);
    healthy.getProperty(hydrationId).setNumberWithoutEvents(healthy.getProperty(hydrationId).def.range!.max);
    healthy.getProperty(bloodId).setNumberWithoutEvents(before / 2);
    const beforeRegen = healthy.getProperty(bloodId).number;
    healthy.tick();
    const regainedPerDay = (healthy.getProperty(bloodId).number - beforeRegen) * TICKS_PER_DAY;
    expect(regainedPerDay, '血が戻らない（ゲートの条件が変わった）').toBeGreaterThan(0);

    expect(numberIn(VITALS_DOC, /失う最大は (\d+)mL/, '1つの傷で失う最大'), '牙の傷が奪う量').toBe(lost);
    expect(numberIn(VITALS_DOC, /牙の傷1つが\s*奪う(\d+)mL/, '3節が書いた牙の傷の量')).toBe(lost);
    for (const [label, pattern] of [
      ['3節', /牙の傷1つが\s*奪う\d+mLに([\d.]+)日/],
      ['3.3節', /戻るのに\s*\*\*([\d.]+) 日\*\*かかります/],
    ] as const) {
      expect(numberIn(VITALS_DOC, pattern, `${label}の戻りの日数`), `${label}が書いた日数`).toBeCloseTo(
        lost / regainedPerDay,
        1,
      );
    }
  });
});

describe('最小の献立について文書が言っていること', () => {
  interface MenuRow {
    readonly place: string;
    readonly route: string;
    readonly repetitions: number;
  }
  interface ChainRow {
    readonly place: string;
    readonly route: string;
    readonly deltas: readonly { readonly name: string; readonly amount: number }[];
  }

  const balance = parse(readFileSync(join(ROOT, 'stats', 'balance.yaml'), 'utf-8')) as {
    daily_minimum: readonly { place: string; unmet: readonly string[] }[];
    daily_minimum_menu: readonly MenuRow[];
    chain_routes: readonly ChainRow[];
  };

  const WHOLE_ISLAND = '島全体';

  it('渡り歩ける島には、賄えない値が無い（VitalsSystem.md 3.3節）', () => {
    const row = balance.daily_minimum.find((entry) => entry.place === WHOLE_ISLAND);
    expect(row, `daily_minimum に ${WHOLE_ISLAND} の行が無い`).toBeDefined();
    expect(row!.unmet, '最小の献立が賄えない値').toEqual([]);
  });

  it('最小の献立が運ぶ脂が、1日ぶんの輸送の半分に届かない（DigestionSystem.md 未決事項節）', () => {
    const codex = bundledCodex();
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const lipid = character.tryGetPropertyDef(codex.propertyNames.getId('lipid'));
    expect(lipid, 'lipid を持たないキャラクタ').toBeDefined();
    const body = new WorldObject(1, character, new WorldSession(codex));
    const lipidId = codex.propertyNames.getId('lipid');
    const beforeStock = body.getProperty(lipidId).number;
    expect(beforeStock, '在庫が空では輸送の速さを測れない').toBeGreaterThan(0);
    body.tick();
    const perDay = (beforeStock - body.getProperty(lipidId).number) * TICKS_PER_DAY;
    expect(perDay, '脂が体脂肪へ流れていない').toBeGreaterThan(0);

    let supplied = 0;
    for (const entry of balance.daily_minimum_menu) {
      if (entry.place !== WHOLE_ISLAND) continue;
      const chain = balance.chain_routes.find(
        (route) => route.place === WHOLE_ISLAND && route.route === entry.route,
      );
      const amount = chain?.deltas.find((delta) => delta.name === 'lipid')?.amount ?? 0;
      supplied += amount * entry.repetitions;
    }

    expect(supplied, `最小の献立が運ぶ脂（1日ぶんの輸送は ${perDay}）`).toBeLessThan(perDay / 2);
  });
});

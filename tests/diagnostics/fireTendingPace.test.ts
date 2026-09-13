import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tickDeltasOf } from '../../src/analysis/tickDeltas';
import { MINUTES_PER_TICK, TICKS_PER_DAY } from '../../src/domain/worldTime';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 火の番が1日に何回来るかの検査（docs/engine/FireSystem.md 2.4節）。
 *
 * **くべる操作へ時間を課すかは、回数で決まる**——1日に何度も来る操作なら、課した時間はそのまま
 * 毎日の定額になる。その回数は**手で数えずに定義から解ける**: 満タンの薪（`fuel`のrange.max）を、
 * その火力の段が食う速さで割れば保つtick数が出て、1日のtick数をそれで割れば回数になる。
 *
 * 回数を文で書いているのは `docs/engine/FireSystem.md` 2.4節の1箇所だけなので、その字面を実測と
 * 突き合わせる。
 */
describe('火の番の間隔（同梱の定義）', () => {
  const codex = bundledCodex();
  const paces = tendingPacesOf(codex);

  /** 最も間遠でない炉と火力の段。**時間を課すかを決めるのはここ**で、他はこれより楽になる。 */
  const busiest = paces.reduce((worst, pace) => (pace.addsPerDay > worst.addsPerDay ? pace : worst));

  it('薪を食う炉が1つも見つからない、ということが起きない', () => {
    // 段や値の綴りが変わって空振りすると、下の突き合わせが「何とも食い違わない」ので緑のまま通る。
    expect(paces.length, '薪を食う炉と火力の段の組み合わせ').toBeGreaterThan(0);
  });

  it('FireSystem.mdが書いている間隔と回数が、実測と一致する', () => {
    const doc = readFileSync('docs/engine/FireSystem.md', 'utf8');
    const written =
      /満タンの薪が保つのは、最も忙しい炉で ([\d.]+) 時間。くべ直すのは 1 日に ([\d.]+) 回/.exec(doc);
    expect(written, 'FireSystem.md 2.4節に間隔と回数の記述が見つからない').not.toBeNull();

    const [, hours, addsPerDay] = written!;
    expect(Number(hours), `${busiest.hearthName}の${busiest.stageName}で満タンの薪が保つ時間`).toBe(
      (busiest.ticksOnAFullLoad * MINUTES_PER_TICK) / MINUTES_PER_HOUR,
    );
    expect(Number(addsPerDay), '1日にくべ直す回数').toBe(busiest.addsPerDay);
  });

  it('最も忙しいのは、火力の上限が低く火床も小さい炉', () => {
    // 薪を多く積める炉ほど間遠になる。**逆転したら2.4節の理由づけが嘘になる**ので、最も忙しい炉が
    // 薪の上限の最も小さい側に居ることを見張る。
    const smallestLoad = Math.min(...paces.map((pace) => pace.fuelCapacity));

    expect(busiest.fuelCapacity, `${busiest.hearthName}の薪の上限`).toBe(smallestLoad);
  });
});

/** 1つの炉が、1つの火力の段で焚き続けたときの火の番の間隔。 */
interface TendingPace {
  readonly hearthName: string;
  readonly stageName: string;

  /** その炉が一度に積める薪（`fuel`のrange.max）。 */
  readonly fuelCapacity: number;

  /** 満タンの薪がその段で保つtick数。 */
  readonly ticksOnAFullLoad: number;

  /** その段で焚き続けたときに、1日にくべ直す回数。 */
  readonly addsPerDay: number;
}

/**
 * 炉ごと・火力の段ごとの火の番の間隔。**その炉の火力が届かない段は数えない**——焚き火は炎までしか
 * 上がらないので、炎より上の段で焚き続けることはできない。
 */
function tendingPacesOf(codex: WorldCodex): readonly TendingPace[] {
  const fuelId = codex.propertyNames.getId(FUEL);
  const heatId = codex.propertyNames.getId(HEAT);

  return codex.objectDefNamesWithTag(codex.tagNames.getId(HEARTH)).flatMap((hearthName) => {
    const hearth = codex.objects.get(codex.objectNames.getId(hearthName));
    const fuelCapacity = hearth.tryGetPropertyDef(fuelId)?.range?.max;
    const heat = hearth.tryGetPropertyDef(heatId);
    const hottest = heat?.range?.max;
    if (fuelCapacity === undefined || heat === undefined || hottest === undefined) return [];

    return burnRatesOf(hearth, fuelId, heatId).flatMap(({ stageName, perTick }) => {
      // その段の下端が火力の上限を超えていれば、その炉はその段で焚き続けられない。
      const lowerBound = heat.lowerBoundOfStage(stageName);
      if (lowerBound === undefined || lowerBound > hottest) return [];

      const ticksOnAFullLoad = fuelCapacity / perTick;
      return [
        {
          hearthName,
          stageName,
          fuelCapacity,
          ticksOnAFullLoad,
          addsPerDay: TICKS_PER_DAY / ticksOnAFullLoad,
        },
      ];
    });
  });
}

/** その炉が火力の段ごとに薪を食う速さ（tick毎、正の量）。段に紐づかない食い方は無い。 */
function burnRatesOf(
  hearth: ObjectDef,
  fuelId: PropertyGlobalId,
  heatId: PropertyGlobalId,
): readonly { readonly stageName: string; readonly perTick: number }[] {
  return tickDeltasOf(hearth).flatMap((delta) => {
    if (delta.target !== 'self' || delta.propertyGlobalId !== fuelId || delta.amount >= 0) return [];
    const stage = delta.gate.stage;
    if (stage?.propertyGlobalId !== heatId)
      throw new Error(`${hearth.name} の薪の減りが、火力の段に紐づいていません。`);
    return [{ stageName: stage.name, perTick: -delta.amount }];
  });
}

const HEARTH = 'hearth';
const FUEL = 'fuel';
const HEAT = 'heat';
const MINUTES_PER_HOUR = 60;

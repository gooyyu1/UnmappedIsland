import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { worldAmbientBrightnessOf } from '../../src/analysis/activityHours';
import { tickDeltasOf } from '../../src/analysis/tickDeltas';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, worldCodexPath, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 塩田が干し上がる時間帯の検査（issue #1207）。
 *
 * 塩田の周期（`drying_remaining`）は「境目を超える明るさが何tick当たったか」でしか進まないので、
 * **1日ぶんかどうかは手で数えずに定義から解ける**——境目は塩田自身の宣言が、時刻ごとの明るさは
 * `core.yaml` の `hour`・`weather` の段が持っている。ここが数えるのは、砂浜の晴れの1日で境目を
 * 超えている時間帯と、そのtick数。
 *
 * 時間帯を文で書いているのは `salt.yaml` の `drying_remaining` のコメント1箇所だけなので、
 * その字面を実測と突き合わせる（`docs/world/SurvivalItems.md` 9節はそこへの参照だけを持つ）。
 */
describe('塩田が干し上がる時間帯（同梱の定義）', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  /** 塩田を据える土地。**島で最も明るい地面**なので、日差しの届く時間が最も長い。 */
  const LOCATION = 'sandy_beach';

  /** この島の標準的な天気（`core.yaml` の `weather`）。 */
  const WEATHER = 'clear';

  const band = dryingBandOf(codex, LOCATION, WEATHER);

  it('干し上がるまでのtick数が、日差しの届く時間の実測と一致する', () => {
    const drying = dryingRemainingRangeOf(codex);
    expect(band.ticks, `${LOCATION}・${WEATHER}で境目(+${band.threshold})を超えるtick数`).toBe(drying.max);
  });

  it('salt.yamlが書いている時間帯が、実測と一致する', () => {
    const source = readFileSync(worldCodexPath('salt.yaml'), 'utf8');
    const written = /(\d+)時から(\d+)時までの(\d+)時間/.exec(source);
    expect(written, 'salt.yamlに「N時からM時までのH時間」の記述が見つからない').not.toBeNull();

    const [, fromHour, toHour, hours] = written!;
    expect(Number(fromHour), '干し始める時刻').toBe(band.fromHour);
    expect(Number(toHour), '干し終わる時刻').toBe(band.toHour);
    expect(Number(hours), '日差しの届く時間数').toBe(band.toHour - band.fromHour);
  });

  it('時間帯を書き写しているのはsalt.yamlだけ', () => {
    const doc = readFileSync('docs/world/SurvivalItems.md', 'utf8');
    expect(/\d+時から\d+時まで/.test(doc), 'SurvivalItems.mdが時間帯を書き写している').toBe(false);
  });
});

/** 塩田が干される時間帯と、そのtick数。 */
interface DryingBand {
  /** 明るさの境目（`drying_remaining` を減らす宣言が祖先へ課している下限）。 */
  readonly threshold: number;

  /** 境目を超えている最初の時刻と、超えなくなる時刻。 */
  readonly fromHour: number;
  readonly toHour: number;

  /** その間のtick数。 */
  readonly ticks: number;
}

/**
 * その土地・その天気の1日で、塩田の `drying_remaining` が進む時間帯。**境目もtickの長さも定義から
 * 読む**ので、この関数は数値を1つも持たない。
 *
 * 境目を超える時刻が連続していることは呼び出し側の関心ではなく定義の性質（太陽高度は正午を頂点に
 * 単調）なので、飛びがあればここで例外にする——飛んだ時間帯は「N時からM時まで」では書けない。
 */
function dryingBandOf(codex: WorldCodex, locationName: string, weatherName: string): DryingBand {
  const { ambientBrightnessId, minutesPerTickId } = codex.vocabulary.world;
  const threshold = dryingThresholdOf(codex);

  const location = codex.objects.get(codex.objectNames.getId(locationName));
  const locationAmbient = location.tryGetPropertyDef(ambientBrightnessId);
  if (locationAmbient === undefined)
    throw new Error(`${locationName} が ambient_brightness を宣言していません。`);

  const worldAmbientAt = worldAmbientBrightnessOf(codex);
  const brightnessAt = (hour: number): number => {
    const raw = worldAmbientAt(hour, weatherName) + locationAmbient.initialValueWithoutRoll;
    return locationAmbient.range === undefined ? raw : locationAmbient.range.clamp(raw);
  };

  const litHours: number[] = [];
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) if (brightnessAt(hour) >= threshold) litHours.push(hour);
  if (litHours.length === 0)
    throw new Error(`${locationName}・${weatherName}では境目を超える時刻がありません。`);
  if (litHours[litHours.length - 1] - litHours[0] + 1 !== litHours.length)
    throw new Error(`境目を超える時刻が連続していません（${litHours.join('・')}時）。`);

  const world = codex.objects.get(codex.objectNames.getId('world'));
  const minutesPerTick = world.tryGetPropertyDef(minutesPerTickId)?.initialValueWithoutRoll;
  if (minutesPerTick === undefined) throw new Error('world が minutes_per_tick を宣言していません。');

  return {
    threshold,
    fromHour: litHours[0],
    toHour: litHours[litHours.length - 1] + 1,
    ticks: (litHours.length * MINUTES_PER_HOUR) / minutesPerTick,
  };
}

/** 塩田の `drying_remaining` を減らす宣言が、祖先の `ambient_brightness` へ課している下限。 */
function dryingThresholdOf(codex: WorldCodex): number {
  const { ambientBrightnessId } = codex.vocabulary.world;
  const dryingId = codex.propertyNames.getId(DRYING_REMAINING);
  const saltPan = codex.objects.get(codex.objectNames.getId(SALT_PAN));

  const thresholds = tickDeltasOf(saltPan)
    .filter((delta) => delta.target === 'self' && delta.propertyGlobalId === dryingId && delta.amount < 0)
    .flatMap((delta) => delta.gate.ancestorConditions)
    .filter((condition) => condition.propertyGlobalId === ambientBrightnessId && condition.op === 'gte')
    .flatMap((condition) => condition.values);

  if (thresholds.length !== 1)
    throw new Error(`${SALT_PAN} の乾く境目が1つに定まりません（${thresholds.join('・')}）。`);
  return thresholds[0];
}

/** 塩田の `drying_remaining` の値域。上限が「干し上がるまでに要るtick数」。 */
function dryingRemainingRangeOf(codex: WorldCodex): { readonly max: number } {
  const saltPan = codex.objects.get(codex.objectNames.getId(SALT_PAN));
  const range = saltPan.tryGetPropertyDef(codex.propertyNames.getId(DRYING_REMAINING))?.range;
  if (range === undefined) throw new Error(`${SALT_PAN} の ${DRYING_REMAINING} が値域を持ちません。`);
  return range;
}

const SALT_PAN = 'salt_pan';
const DRYING_REMAINING = 'drying_remaining';
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

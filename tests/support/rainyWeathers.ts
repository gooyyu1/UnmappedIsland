import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { PassivePropertyReading, PassiveReader } from '../../src/domain/PassiveReader';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/**
 * 雨の降る天気の名前。**弱い雨から強い雨の順**に並ぶ。
 *
 * 雨かどうかは、天気の段が大気の水分を毎tick減らすか（`add` で `atmospheric_moisture` を負へ動かす、
 * ClimateSystem.md 3節）で決める——降った水は空から抜けるので、雨の段だけがこの宣言を持つ。強さは
 * 減らす量の大きさで、多く降らせる雨ほど多く使う。
 *
 * **雨の天気を見る検査・診断は、名前を書き写さずにここから引く**
 * （`tests/architecture/rainyWeatherLiterals.test.ts`）。写しは、雨の段が増えても古いまま緑で通る。
 */
export function rainyWeathersOf(codex: WorldCodex): readonly string[] {
  const words = codex.vocabulary.world;
  const world = codex.objects.get(codex.objectNames.getId(words.worldObject));
  const collector = new MoistureDrawCollector(
    codex.propertyNames.getId('atmospheric_moisture'),
    words.weatherId,
  );
  world.passives.readBy(collector);
  return [...collector.drawByWeather]
    .filter(([, draw]) => draw > 0)
    .sort(([, weaker], [, stronger]) => weaker - stronger)
    .map(([name]) => name);
}

/** 天気の段ごとに、大気の水分を毎tick減らす量（正が減らす向き）を集める。 */
class MoistureDrawCollector implements PassiveReader {
  readonly drawByWeather = new Map<string, number>();

  constructor(
    private readonly moistureId: PropertyGlobalId,
    private readonly weatherId: PropertyGlobalId,
  ) {}

  modify(): void {}

  accumulate(reading: PassivePropertyReading): void {
    if (reading.target !== 'self' || reading.propertyGlobalId !== this.moistureId) return;
    if (reading.amount.kind !== 'fixed') return;

    const stage = reading.gate.stage;
    if (stage === undefined || stage.propertyGlobalId !== this.weatherId) return;

    this.drawByWeather.set(stage.name, (this.drawByWeather.get(stage.name) ?? 0) - reading.amount.value);
  }

  transfer(): void {}
}

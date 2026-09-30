import { HOURS_PER_DAY, MINUTES_PER_HOUR, MINUTES_PER_TICK } from '../../src/domain/worldTime';
/**
 * 時間を進める試験に要る最小のworld（GameElementDefinition.md 15節）。
 *
 * ゲーム内時間を進めるにはWorldを持つセッションが要り、Worldは時計を持つworldインスタンスを要る
 * ——**同梱のcore.yamlを読む理由はそれだけ**だったので、時計の宣言だけをここへ置く。読み込むと
 * YAMLの中身が試験の前提に入ってしまい、世界の宣言を直しただけで層の試験が赤くなる
 * （tests/architecture/testKinds.test.ts）。
 *
 * 置いてある物を回るtickは世界の木を辿るので、`locations`スロットも一緒に持つ。
 *
 * **暦は `src/domain/worldTime.ts` から差し込む。** 試験の側はこの時計を同じ定数で数えるので、字で
 * 書き写すと暦を変えたときに時計と数え方がずれる。
 */
export const WORLD_TIME_YAML = `
object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick: {value: ${MINUTES_PER_TICK}}
      minute: {value: 0, range: {min: 0, max: ${MINUTES_PER_HOUR}}, on_max: {add: {self: {minute: -${MINUTES_PER_HOUR}, hour: 1}}}}
      hour: {value: 0, range: {min: 0, max: ${HOURS_PER_DAY}}, on_max: {add: {self: {hour: -${HOURS_PER_DAY}, day: 1}}}}
      day: {value: 1}
      # 画面が識別子のまま読む（雨の演出が引くため、ScreenLayout.md 7.5.3節）。
      weather: {value: clear, stages: [{name: clear}, {name: storm}]}
    slots:
      locations: {cell: {accept: {tag: location}}}
`;

import type { ActiveEffect } from '../../domain/ActiveEffect';
import type { PropertyDef, PropertyStage } from '../../domain/PropertyDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyTagRef, stageRef, text } from './Description';
import { describeEffect } from './describeEffect';

/** 初期値の書き表し。一覧の表など、1行で済ませたい場所向けに断片で返す。 */
export function initialValueTokens(def: PropertyDef, names: DefNames): readonly DescriptionToken[] {
  const reading = def.initialValueReading;
  return reading.kind === 'roll'
    ? [text(`${reading.min}〜${reading.max}（生成時に1回抽選）`)]
    : [names.propertyValue(def.globalId, reading.value)];
}

/** プロパティの定義（6節）を書き出す。 */
export function describeProperty(def: PropertyDef, names: DefNames, out: DescriptionWriter): void {
  out.write(text('初期値: '), ...initialValueTokens(def, names));
  if (def.range !== undefined) out.write(text(`range: ${def.range.min} 〜 ${def.range.max}`));
  if (def.inherit) out.write(text('inherit: 同名プロパティを持つ最初の祖先の実効値を足す'));
  if (def.gauge !== undefined)
    out.write(text(`gauge: min=${def.gauge.atMin} / max=${def.gauge.atMax}（カードにバーで出す）`));
  if (def.tags.length > 0)
    out.write(
      text('tags: '),
      ...def.tags.map((tagGlobalId) => propertyTagRef(names.propertyTagName(tagGlobalId))),
    );

  if (def.stages.length > 0) {
    out.write(text('stages:'));
    out.indented(() => {
      for (const stage of def.stages) out.write(...stageTokens(stage, def.globalId, names));
    });
  }

  for (const [label, effect] of def.rangeEvents()) describeRangeEvent(label, effect, names, out);
}

/** 段1つ（6.4節）を書き表す。propertyGlobalIdは、eqの値をシンボル名へ戻すために要る。 */
function stageTokens(
  stage: PropertyStage,
  propertyGlobalId: number,
  names: DefNames,
): readonly DescriptionToken[] {
  const tokens: DescriptionToken[] = [stageRef(stage.name)];
  if (stage.eq !== undefined) {
    // シンボル型の段は、段の名前がそのまま比較する値（6.4節）。同じ名前を二度書かない。
    const value = names.propertyValue(propertyGlobalId, stage.eq);
    if (value.kind !== 'symbol' || value.name !== stage.name) tokens.push(text(': '), value, text('のとき'));
  } else if (stage.min !== undefined) tokens.push(text(`: ${stage.min}以上`));
  else tokens.push(text(': どの段にも該当しないとき'));

  if (stage.alert !== 'safe') tokens.push(text(`（alert: ${stage.alert}）`));
  if (stage.art !== undefined) tokens.push(text(`（art: ${stage.art}）`));
  return tokens;
}

/** range系イベント（6.3節）1つを、その名前を見出しにして書き出す。 */
export function describeRangeEvent(
  label: string,
  effect: ActiveEffect,
  names: DefNames,
  out: DescriptionWriter,
): void {
  out.write(text(`${label}:`));
  out.indented(() => describeEffect(effect, names, out));
}

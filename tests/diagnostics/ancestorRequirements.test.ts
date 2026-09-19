import { describe, expect, it } from 'vitest';
import type { PlaceBalance } from '../../src/analysis/balanceTables';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import { islandLocationsOf } from '../../src/analysis/islandLocations';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 祖先（`{subject: ancestor, ...}`、GameElementDefinition.md 8.6節）を見る要件が、**土地ごとの表では
 * その土地について判定される**ことの検査（issue #2119）。
 *
 * 判定しないと、支点を宣言していない土地の献立にハンモックの経路が並ぶ——押せない操作が「1日を賄う
 * 手立て」として数えられ、その土地の数字が実際より軽く出る。
 *
 * **島全体の行は判定しない。** 祖先に就く土地が1つに定まらないので、支点の在る土地で押せる経路は
 * 島全体では押せる（`WHOLE_ISLAND`を外している理由）。
 */

const codex = bundledCodex();
const anchorId = codex.propertyNames.getId('hanging_anchor');
const tables = buildBalanceTables(codex, SAMPLE_CHARACTER);
const lands = tables.places.filter((place) => place.name !== WHOLE_ISLAND);

/** その土地の表に出てくる工程（`型.工程`）。献立も連鎖表も同じ経路を指すので、両方から集める。 */
function stepsOn(place: PlaceBalance): Set<string> {
  const found = new Set<string>();
  const add = (steps: readonly { readonly objectName: string; readonly stepName: string }[]): void => {
    for (const step of steps) found.add(`${step.objectName}.${step.stepName}`);
  };
  for (const property of place.properties) for (const { route } of property.routes) add(route.steps);
  for (const entry of place.menu.entries) add(entry.route.steps);
  return found;
}

/** ハンモックを吊れる土地か（`hanging_anchor`の宣言を持つ）。 */
function hasAnchor(def: ObjectDef): boolean {
  return def.tryGetPropertyDef(anchorId) !== undefined;
}

describe('祖先を見る要件は、土地ごとに判定される', () => {
  const island = islandLocationsOf(codex).island;
  const hammockSteps = ['hammock.nap', 'hammock.sleep'];

  it('支点を宣言していない土地の表に、ハンモックの経路が出ない', () => {
    const leaked: string[] = [];
    for (const place of lands) {
      const def = island.find((location) => location.name === place.name);
      if (def === undefined || hasAnchor(def)) continue;
      const steps = stepsOn(place);
      for (const step of hammockSteps) if (steps.has(step)) leaked.push(`${place.name}: ${step}`);
    }

    expect(leaked).toEqual([]);
  });

  it('支点を宣言している土地の表には、ハンモックの経路が出る', () => {
    // 上の検査だけだと、祖先の葉を一律に偽としても（＝どの土地からも落としても）緑になる。
    const anchored = island.filter(hasAnchor);
    expect(anchored.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const def of anchored) {
      const place = lands.find((land) => land.name === def.name);
      if (place === undefined) continue;
      const steps = stepsOn(place);
      if (!hammockSteps.some((step) => steps.has(step))) missing.push(def.name);
    }

    expect(missing).toEqual([]);
  });
});

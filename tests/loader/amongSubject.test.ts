import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * `among`（GameElementDefinition.md 10.3節）の`subject`は**候補を探しに行く側**で、選ぶ前に解かれる。
 * そこに`picked`は居ないので、書けばロード時に弾かれる（ReferenceScope.unresolvableReason）。
 *
 * 選んだ後に居る`picked`は、`among`を書いた候補の重みと効果でだけ指せる。
 */
describe("amongのsubjectと'picked'", () => {
  const load = (yaml: string): void => {
    new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  };

  const withTurn = (pickBody: string): string => `
object_defs:
  monkey:
    slots:
      spoils: {cell: {accept: {tag: item}}}
    interactions:
      turn:
        trigger: tick
        pick:
${pickBody}
`;

  it("subjectに'picked'を書くとロード時に弾かれる（候補を探す前にpickedは居ない）", () => {
    expect(() =>
      load(
        withTurn(`          - weight: 1
            among: {subject: picked, slot: spoils}
            destroy: picked
`),
      ),
    ).toThrow(/subject 'picked' は使えません（ここには候補の中から選ばれた相手が居ません）/);
  });

  it('候補の重みと効果では指せる（選んだ後の相手）', () => {
    expect(() =>
      load(
        withTurn(`          - weight: 1
            among: {slot: spoils, weight: {subject: picked, prop: volume}}
            destroy: picked
`),
      ),
    ).not.toThrow();
  });

  it("入れ子のamongでは、内側のsubjectに外側の'picked'を書ける（そこには既に居る）", () => {
    expect(() =>
      load(
        withTurn(`          - weight: 1
            among: {slot: spoils}
            pick:
              - weight: 1
                among: {subject: picked, slot: spoils}
                destroy: picked
`),
      ),
    ).not.toThrow();
  });
});

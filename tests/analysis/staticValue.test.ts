import { describe, expect, it } from 'vitest';
import type { StaticValueLayer, StaticValueResolver } from '../../src/analysis/staticValue';
import { layeredResolver, staticValueOf } from '../../src/analysis/staticValue';
import type { ReferenceRoot } from '../../src/domain/ReferenceRoot';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 定義だけから読む初期値が、**生成時のロール（GameElementDefinition.md 6.2節）のどちらの端かを
 * 訊かれて答える**ことの検査（issue #1179）。
 *
 * 片方の端だけを返す口に振れ幅を足し戻す形では、`base`（同6.5節）の土台がロールを持つときに
 * 土台のぶんが下端のまま残る——足し戻せるのは自分の振れ幅だけだから。
 */
describe('定義だけから読む初期値', () => {
  const yaml = `
object_defs:
  wound:
    props:
      depth:
        value: {min: 1, max: 3}
      severity:
        value: {min: 10, max: 20}
        base: {subject: self, prop: depth}
      bandaged:
        value: 5
`;

  function load(): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  }

  function valueOf(codex: WorldCodex, propertyName: string, end: 'lowest' | 'highest'): number | undefined {
    const def = codex.objects.get(codex.objectNames.getId('wound'));
    return staticValueOf(def, codex.propertyNames.getId(propertyName), end);
  }

  it('ロールを持つ値は、訊かれた端を返す', () => {
    const codex = load();

    expect(valueOf(codex, 'depth', 'lowest')).toBe(1);
    expect(valueOf(codex, 'depth', 'highest')).toBe(3);
  });

  it('ロールを持たない値は、どちらの端でも同じ', () => {
    const codex = load();

    expect(valueOf(codex, 'bandaged', 'lowest')).toBe(5);
    expect(valueOf(codex, 'bandaged', 'highest')).toBe(5);
  });

  it('baseを持つ値は、土台のロールも同じ端で読む', () => {
    const codex = load();

    expect(valueOf(codex, 'severity', 'lowest')).toBe(11);
    // 自分の振れ幅（20-10）を下端へ足し戻すだけでは21になり、土台のぶんが下端のまま残る。
    expect(valueOf(codex, 'severity', 'highest')).toBe(23);
  });
});

/**
 * **祖先（置かれている土地）が入れる土台のロールも、訊かれた端で読む**ことの検査（issue #1192）。
 *
 * `self`の枝は端を辿るのに、`ancestor`・`instrument`の枝へ委ねた時点で端が消えると、上端の問い合わせが
 * 下端の答えを混ぜて返す——足し戻しでは直せない、#1179と同じ形の取りこぼし。
 */
describe('外の文脈が入れる土台の初期値', () => {
  const yaml = `
object_defs:
  meadow:
    props:
      wind: {value: {min: 10, max: 30}}

  kite:
    tags: [item]
    props:
      lift:
        value: {min: 1, max: 3}
        base: {subject: ancestor, prop: wind}
`;

  const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  function defOf(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

  /** 祖先の宣言値を答える手立て（balanceTablesのancestorValueResolverと同じ形）。 */
  const ancestor: StaticValueResolver = (root, propertyGlobalId, end) =>
    root === 'ancestor' ? staticValueOf(defOf('meadow'), propertyGlobalId, end) : undefined;

  it('祖先の土台のロールも、訊かれた端で読む', () => {
    const lift = codex.propertyNames.getId('lift');

    expect(staticValueOf(defOf('kite'), lift, 'lowest', ancestor)).toBe(11);
    expect(staticValueOf(defOf('kite'), lift, 'highest', ancestor)).toBe(33);
  });
});

/**
 * **層をまたぐ土台**（`base`）が解けることの検査（layeredResolver）。
 *
 * 武器の当たり所の重みは、その武器を振る人の狙いを土台にする（docs/world/Skills.md 5節）ので、
 * 「使う物」の層は「行っている人」の層の答えを要る。層どうしを直に繋ぐと、繋いだ先より外側は
 * 入れ子の参照から見えず、その重みだけが解けないまま残る。
 */
describe('層を畳んだ文脈', () => {
  const yaml = `
object_defs:
  hunter:
    tags: [character]
    props:
      aim: {value: 7}

  club:
    tags: [item]
    props:
      hit: {value: 60, base: {subject: agent, prop: aim}}

  meadow:
    props:
      warmth: {value: 2, base: {subject: ancestor}}
`;

  const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  function defOf(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

  /** 起点1つを、その型の宣言から答える層（balanceTablesの3層と同じ形）。 */
  function layerOf(root: ReferenceRoot, def: ObjectDef): StaticValueLayer {
    return (context) => (asked, propertyGlobalId, end) =>
      asked === root ? staticValueOf(def, propertyGlobalId, end, context) : undefined;
  }

  it('使う物の土台が、行っている人の層へ届く', () => {
    const context = layeredResolver([
      layerOf('agent', defOf('hunter')),
      layerOf('instrument', defOf('club')),
    ]);

    expect(context('instrument', codex.propertyNames.getId('hit'), 'lowest')).toBe(67);
  });

  it('自分を土台にする土台は、解けないものとして返る（辿り直さない）', () => {
    const context = layeredResolver([layerOf('ancestor', defOf('meadow'))]);

    expect(context('ancestor', codex.propertyNames.getId('warmth'), 'lowest')).toBeUndefined();
  });
});

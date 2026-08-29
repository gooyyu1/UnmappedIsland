import { describe, expect, it } from 'vitest';
import type { StaticValueResolver } from '../../src/analysis/staticValue';
import { staticValueOf } from '../../src/analysis/staticValue';
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

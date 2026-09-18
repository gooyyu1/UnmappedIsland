import { describe, expect, it } from 'vitest';
import { passiveWritesToProperty, writesToProperty } from '../../src/codex-viewer/describe/effectQueries';
import type {
  AddReading,
  ConditionalReading,
  EffectDeclaration,
  EffectReader,
  PickReading,
  SetValueReading,
  TransferReading,
} from '../../src/domain/EffectReader';
import type { ObjectRefReading } from '../../src/domain/ObjectRef';
import type { PropertyDef, RangeEventLabel } from '../../src/domain/PropertyDef';
import type { ReferenceRoot } from '../../src/domain/ReferenceRoot';
import type { PropertyGlobalId, SlotGlobalId } from '../../src/domain/GlobalId';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * スタックの並び順（`stack_order`）が決まるのは**新しい札が入る瞬間だけ**で、入った後に値が動いても
 * 並べ直さない（`SlotSystem.md` 6節）。それで済むのは「同種は同じ速度で変化する」から——**時間経過が
 * 動かす値なら、束ねた札の相対順は変わらない。**
 *
 * 破るのは、時間経過以外の書き手。操作の効果（`set`/`add`/`transfer`）も、操作の間だけ効く持続効果も、
 * **束の1枚にだけ当たる**ので、当たった札はそこから順序の外れた位置に居座る。`range` の端のイベントは
 * 端へ倒すだけなら順序を保つ（端に着いた札は元から並びの端に居る）が、**端から内側へ戻す**ものは
 * 1枚だけを列の途中へ跳ばすので同じように破る。ここが赤くなったら、並べ直さない割り切り（同 7節）が
 * その宣言では成り立っていない。
 */
describe('スタックの並び順が見る値', () => {
  /**
   * 端のイベントが、並び順の値を**端以外へ**動かすか。既定のクランプ（端の値への `set`）は
   * 順序を崩さないので、そこだけを除く。
   */
  class MovesAwayFromEnd implements EffectReader {
    found = false;

    private readonly propertyGlobalId: PropertyGlobalId;
    private readonly ownedByDeclarer: boolean;
    private readonly endValues: ReadonlySet<number>;

    constructor(
      propertyGlobalId: PropertyGlobalId,
      ownedByDeclarer: boolean,
      endValues: ReadonlySet<number>,
    ) {
      this.propertyGlobalId = propertyGlobalId;
      this.ownedByDeclarer = ownedByDeclarer;
      this.endValues = endValues;
    }

    set(target: ReferenceRoot, propertyGlobalId: PropertyGlobalId, value: SetValueReading): void {
      if (!this.writesToOrderingValue(target, propertyGlobalId)) return;
      if (typeof value === 'number' && this.endValues.has(value)) return;
      this.found = true;
    }

    add(reading: AddReading): void {
      if (this.writesToOrderingValue(reading.target, reading.propertyGlobalId)) this.found = true;
    }

    transfer(reading: TransferReading): void {
      if (
        this.writesToOrderingValue(reading.from, reading.fromPropertyGlobalId) ||
        this.writesToOrderingValue(reading.to, reading.toPropertyGlobalId) ||
        reading.linked.some((linked) => this.writesToOrderingValue(linked.target, linked.propertyGlobalId))
      )
        this.found = true;
    }

    spawn(): void {}
    destroy(): void {}
    become(): void {}
    move(_subject: ObjectRefReading, _destination: ObjectRefReading, _slot: SlotGlobalId | undefined): void {}
    signal(): void {}

    pick(reading: PickReading): void {
      reading.readEveryCandidate(this);
    }

    conditional(reading: ConditionalReading): void {
      reading.readEveryBranch(this);
    }

    /** 効果の`self`は宣言元自身を指すので、宣言元が並ぶ型でなければ別の物の値を書いている。 */
    private writesToOrderingValue(target: ReferenceRoot, propertyGlobalId: PropertyGlobalId): boolean {
      return propertyGlobalId === this.propertyGlobalId && (this.ownedByDeclarer || target !== 'self');
    }
  }

  /**
   * 見逃してよい端の値。**並び順の値そのものが自分の端で走らせるイベント**のときだけ、その端の値へ
   * 倒すぶんを除く。別のプロパティの端で並び順の値を書くものは、書く先がたまたま宣言元の端と同じでも
   * 1枚だけを動かすので除かない（この世界の軸はどれも0〜100なので、同値は普通に起きる）。
   */
  function clampValuesOf(
    propertyDef: PropertyDef,
    label: RangeEventLabel,
    propertyGlobalId: PropertyGlobalId,
  ): ReadonlySet<number> {
    const range = propertyDef.globalId === propertyGlobalId ? propertyDef.range : undefined;
    return new Set(range === undefined ? [] : [range.endValue(label)]);
  }

  function rangeEventMovesAwayFromEnd(
    declaration: EffectDeclaration,
    propertyDef: PropertyDef,
    label: RangeEventLabel,
    propertyGlobalId: PropertyGlobalId,
    ownedByDeclarer: boolean,
  ): boolean {
    const reader = new MovesAwayFromEnd(
      propertyGlobalId,
      ownedByDeclarer,
      clampValuesOf(propertyDef, label, propertyGlobalId),
    );
    declaration.readBy(reader);
    return reader.found;
  }

  /** 並び順が見る値を、時間経過（型が持つ持続効果）以外が動かす宣言を`並ぶ型: 書き手`の形で集める。 */
  function movedOutsideTimePassage(codex: WorldCodex): string[] {
    const found: string[] = [];
    for (const ordered of codex.objects) {
      const propertyGlobalId = ordered.stackOrder?.reading.propertyGlobalId;
      if (propertyGlobalId === undefined) continue;

      for (const writer of codex.objects) {
        // 効果の`self`は宣言元自身を指すので、並ぶ型の値へ届くのは宣言元がその型のときだけ
        // （同じ名前のプロパティを持つ別の型の`self`は、別の物の値を書いている。effectQueries参照）。
        const ownedByDeclarer = writer === ordered;

        for (const trigger of writer.triggers) {
          const interaction = trigger.interaction;
          const writes =
            writesToProperty(interaction, propertyGlobalId, ownedByDeclarer) ||
            interaction.passiveDeclarations.some((passive) =>
              passiveWritesToProperty(passive, propertyGlobalId, ownedByDeclarer),
            );
          if (writes) found.push(`${ordered.name}: ${writer.name}.${interaction.name}`);
        }

        for (const propertyDef of writer.enumeratePropertyDefs())
          for (const [label, declaration] of propertyDef.rangeEvents())
            if (
              rangeEventMovesAwayFromEnd(declaration, propertyDef, label, propertyGlobalId, ownedByDeclarer)
            )
              found.push(`${ordered.name}: ${writer.name}.${propertyDef.name}.${label}`);
      }
    }
    return found;
  }

  /** 端まで持つ並び順の宣言1つに、書き手を足して試す。 */
  function probe(writer: string): string[] {
    const yaml = `
object_defs:
  log:
    props:
      freshness:
        value: 100
        range: {min: 0, max: 100}
${writer}
    stack_order: {property: freshness, ascending: false}
    passives:
      - add: {self: {freshness: -1}}
`;
    const codex = new WorldCodexYamlLoader().load('probe.yaml', yaml).buildAndReset();
    expect(codex.objects.get(codex.objectNames.getId('log')).stackOrder, '並び順が読めている').toBeDefined();
    return movedOutsideTimePassage(codex);
  }

  it('時間経過だけが動かす値は挙げない（端の既定のクランプも数えない）', () => {
    expect(probe('')).toEqual([]);
  });

  it('操作が書き換える値は挙げる', () => {
    expect(
      probe(`    interactions:
      wet:
        trigger: menu
        set: {self: {freshness: 100}}`),
    ).toEqual(['log: log.wet']);
  });

  it('端から内側へ戻す宣言は挙げる（クランプを除いたせいで取りこぼさない）', () => {
    expect(probe('        on_min: {set: {self: {freshness: 100}}}')).toEqual(['log: log.freshness.on_min']);
  });

  it('別のプロパティの端が並び順の値を書くものは、書く先が端と同値でも挙げる', () => {
    expect(
      probe(`      wetness:
        value: 0
        range: {min: 0, max: 100}
        on_max: {set: {self: {freshness: 100}}}`),
    ).toEqual(['log: log.wetness.on_max']);
  });

  it('同梱の宣言に、時間経過以外が動かす並び順は無い', () => {
    expect(movedOutsideTimePassage(bundledCodex())).toEqual([]);
  });
});

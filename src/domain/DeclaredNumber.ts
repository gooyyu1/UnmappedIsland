import type { DeclaredNumberReading } from './EffectReader';
import type { PropertyPath, ReferenceValueResolver } from './ReferenceRoot';

/**
 * 宣言に書かれた1つの数値（GameElementDefinition.md 10.2節）。リテラル定数か、既存propsへのパス参照の
 * どちらかで、参照は使うときの文脈で解く。**何を起点に書けるかは、その宣言が置かれた場所が決める**
 * （ReferenceScope。一覧は同14.1節の表）。
 *
 * pickのweightだけでなく、行動・組み合わせ・レシピの所要時間、スロットの`put_in`の所要時間も
 * これで表す——**「その場で決まる数値」という点で同じもの**で、何を表す数値かは持ち主の側が決める。
 *
 * **2つの値を合わせる場所ではない。** 合成は参照先のプロパティが`base`（6.5節）・`modify`（8.3節）で
 * 済ませてから、ここはその1つを読む。
 */
export class DeclaredNumber {
  /** リテラル定数か、プロパティ参照1つか（10.2節の二択）。 */
  private readonly declared: number | PropertyPath;

  private constructor(declared: number | PropertyPath) {
    this.declared = declared;
  }

  static ofLiteral(literal: number): DeclaredNumber {
    return new DeclaredNumber(literal);
  }

  static ofPath(path: PropertyPath): DeclaredNumber {
    return new DeclaredNumber(path);
  }

  /**
   * resolveが答える値。参照が解決できなければ0（宣言はされているので、値が無いこととは区別しない）。
   *
   * **誰が答えるかは問わない**（ReferenceValueResolver）——世界が在る場面の実効値でも、定義から
   * 導いた近似でも、この宣言の読み方は変わらない。
   */
  resolveOrZero(resolve: ReferenceValueResolver): number {
    return resolveDeclaredNumber(this.reading, resolve) ?? 0;
  }

  /** この値の宣言そのもの（DeclaredNumberReading参照）。数値へ解くのは、文脈を知っている読み手の側。 */
  get reading(): DeclaredNumberReading {
    return typeof this.declared === 'number'
      ? { kind: 'literal', value: this.declared }
      : {
          kind: 'property',
          subject: this.declared.root,
          propertyGlobalId: this.declared.propertyGlobalId,
        };
  }
}

/**
 * 読み上げられた宣言（DeclaredNumberReading）1つを数値へ解く。参照が解けなければundefined。
 *
 * **宣言そのものを持たない読み手のための口。** 読み上げだけを受け取る側（解析・ビューア）も、
 * 宣言を持つ側（DeclaredNumber.resolveOrZero）と同じ読み方をここで引く。
 */
export function resolveDeclaredNumber(
  reading: DeclaredNumberReading,
  resolve: ReferenceValueResolver,
): number | undefined {
  return reading.kind === 'literal' ? reading.value : resolve(reading.subject, reading.propertyGlobalId);
}

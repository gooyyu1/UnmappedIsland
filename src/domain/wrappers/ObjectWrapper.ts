import type { WorldCodex } from '../WorldCodex';
import type { WorldRuleVocabulary } from '../WorldVocabulary';
import type { WorldObject } from '../WorldObject';

/**
 * 1つの`WorldObject`を、世界の語彙で名前を与えて読み書きするための型付きの窓
 * （`World`・`Location`・`PlayerCharacter`・`Path`）。
 *
 * **継承（`class World extends WorldObject`）ではなくラップにしている。** WorldCodexがtraitによる
 * 合成モデルを採用しており、クラス階層と噛み合わないため。多態のための族ではないので、
 * 「どれか1つの包み」として受け取る場所は無い——総称して扱いたいなら`WorldObject`をそのまま使う。
 *
 * **宣言していない名前は、空・0として読める。** 「その名前を持つか」は語彙ではなくインスタンスが
 * 答えるので、探索の宣言を持たない土地に対しても包みを作れる。undefinedと0を区別したい問いだけが
 * `tryNumberOf`を使う。
 *
 * ここへ置いてよいのは、**包みであることに由来する下働き**だけ。オブジェクトに関わるというだけの
 * 操作を集めると、`WorldObject`を分けた意味が失われる。
 */
export abstract class ObjectWrapper {
  readonly instance: WorldObject;

  protected readonly codex: WorldCodex;
  protected readonly words: WorldRuleVocabulary;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    this.words = codex.vocabulary.world;
  }

  /** 名指しのプロパティの実効値。宣言していなければ0。 */
  protected effectiveNumberOf(propertyGlobalId: number): number {
    return this.instance.tryGetProperty(propertyGlobalId)?.getEffectiveValue() ?? 0;
  }

  /** 名指しのプロパティの実効値。**宣言していなければundefined**——0と区別したい問いだけが使う。 */
  protected tryEffectiveNumberOf(propertyGlobalId: number): number | undefined {
    return this.instance.tryGetProperty(propertyGlobalId)?.getEffectiveValue();
  }

  /** 名指しの枠の中身。宣言していなければ空。 */
  protected contentsOf(slotGlobalId: number): readonly WorldObject[] {
    return this.instance.tryGetSlot(slotGlobalId)?.contents ?? [];
  }

  /** 名指しの枠の中身を、積み重なっているまとまりごとに分けたもの。宣言していなければ空。 */
  protected stacksOf(slotGlobalId: number): readonly (readonly WorldObject[])[] {
    return this.instance.tryGetSlot(slotGlobalId)?.stacks ?? [];
  }
}

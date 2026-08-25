import { ObjectWrapper } from './ObjectWrapper';
import type { WorldObject } from '../WorldObject';

/** 周回の終わり方（docs/concept/GameEndings.md）。 */
export type EndingKind = 'death' | 'escape';

/**
 * この周回の決着（GameEndings.md）。**旗は持たない**——死んだことも島を出たことも、世界の中での
 * キャラクタの居場所がそのまま答える。
 *
 * 死と脱出は同時に起こらない。死ねば世界の中に居らず、本土の中にも居ないため。
 */
export class Ending extends ObjectWrapper {
  /** どう終わったか。まだ終わっていなければundefined。 */
  get kind(): EndingKind | undefined {
    // 命を絶つ値は尽きた瞬間に自分を消す（`on_min`の`destroy`）ので、**世界の中に居ないことが
    // そのまま死んでいること**になる（VitalsSystem.md 6節）。
    if (this.instance.parent === undefined) return 'death';
    // 本土（mainlandタグを持つ場所）の中に居ることが到達を表す（3節）——筏ごと本土へ移った
    // （voyage.yaml）結果として、自分もその中に居る。
    return this.mainland === undefined ? undefined : 'escape';
  }

  /**
   * 命を奪った宣言が名乗った名前（死んでいなければundefined）。渇き・飢え・失血のどれで死んだかは、
   * 命を絶った`destroy`が置いた名前がそのまま答える（WorldObject.destroyedReason）——**残った値から
   * 推測しない**（VitalsSystem.md 6節）。表示文言はその名前から引く（Localization.stage）ので、
   * 死因を名乗るのはワールドの側だけになる。
   *
   * 名前を持たない消滅（行き場を失ってこぼれ落ちた等）はundefinedで、画面は死に方を言わない。
   */
  get causeOfDeath(): string | undefined {
    return this.kind === 'death' ? this.instance.destroyedReason : undefined;
  }

  /**
   * 持ち帰ったアーティファクト（`artifact`タグ、6節）のobject_defの識別子。島を出ていなければ空。
   *
   * **本土に着いた物すべてが対象**で、筏の積荷か手持ちかは問わない——渡り切った側に在ることだけが
   * 持ち帰った条件なので、置き場所ごとの数え方を持たない。
   */
  get broughtArtifacts(): readonly string[] {
    const mainland = this.mainland;
    if (mainland === undefined) return [];

    const names: string[] = [];
    for (const object of mainland.descendants()) {
      if (object.def.hasTag(this.words.artifactTagId)) names.push(object.def.name);
    }
    return names;
  }

  /** 自分が今その中に居る本土（居なければundefined）。 */
  private get mainland(): WorldObject | undefined {
    return this.instance.findAncestorWithTag(this.words.mainlandTagId);
  }
}

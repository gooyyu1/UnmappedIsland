import type { NameRegistry } from '../NameRegistry';
import type { WorldCodex } from '../WorldCodex';
import { pickWeighted } from '../Rng';
import type { Rng } from '../Rng';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';
import type { Location } from './Location';

/** 動物の1手を宣言しているアクションの名前（animals.yamlのbeast trait）。 */
const TURN_ACTION = 'turn';

/**
 * 抽選にかける候補1つ。**重みと、選ばれたときにYAMLへ渡すインスタンスID**だけを持つ——
 * 何を候補にするか（足元の物か、道か）で拾い方は違うが、選び方は1つでよい。
 */
interface TurnTarget {
  readonly instanceId: number;
  readonly weight: number;
}

/**
 * 動物（animals.yamlのbeast trait実装オブジェクト）に対する、ゲームロジック向けの型付きビュー。
 * Locationと同じ理由で継承ではなくラップにしている。
 *
 * 担うのは**1手を与えること**（HuntingSystem.md 5節）だけで、その1手が何になるかは決めない。
 * 何が起こりうるかはYAML側の`turn`アクションの`pick`が持ち、ここは**候補の数と対象**を書き込んで
 * 抽選に材料を渡す。動物を増やしても候補を足しても、この側は1行も変わらない。
 */
export class Animal {
  readonly instance: WorldObject;

  private readonly nearbyCharactersId: number;
  private readonly lootablesId: number;
  private readonly lootTargetId: number;
  private readonly spoilsTargetId: number;
  private readonly smashablesId: number;
  private readonly smashTargetId: number;
  private readonly escapeRoutesId: number;
  private readonly fleeToId: number;
  private readonly volumeId: number;

  private readonly quarryTagId: number;
  private readonly fragileTagId: number;
  private readonly spoilsSlotId: number;

  private constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    const props = codex.propertyNames;
    this.nearbyCharactersId = Animal.idOrMissing(props, 'nearby_characters');
    this.lootablesId = Animal.idOrMissing(props, 'lootables');
    this.lootTargetId = Animal.idOrMissing(props, 'loot_target');
    this.spoilsTargetId = Animal.idOrMissing(props, 'spoils_target');
    this.smashablesId = Animal.idOrMissing(props, 'smashables');
    this.smashTargetId = Animal.idOrMissing(props, 'smash_target');
    this.escapeRoutesId = Animal.idOrMissing(props, 'escape_routes');
    this.fleeToId = Animal.idOrMissing(props, 'flee_to');
    this.volumeId = Animal.idOrMissing(props, 'volume');
    this.quarryTagId = codex.tagNames.tryGetId('quarry') ?? -1;
    this.fragileTagId = codex.tagNames.tryGetId('fragile') ?? -1;
    this.spoilsSlotId = codex.slotNames.tryGetId('spoils') ?? -1;
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする（理由はLocation.idOrMissing参照）。 */
  private static idOrMissing(names: NameRegistry, name: string): number {
    return names.tryGetId(name) ?? -1;
  }

  /**
   * 手番の回る動物ならビューを、そうでなければundefined。**基準は`turn`を宣言していること**で、
   * 死体や普通のアイテムはここで外れる。1手の材料になるプロパティは、`turn`と同じtraitが揃えて
   * 宣言する（animals.yamlのbeast）。
   */
  static tryWrap(object: WorldObject, codex: WorldCodex): Animal | undefined {
    if (!object.def.actions.some((action) => action.name === TURN_ACTION)) return undefined;
    return new Animal(object, codex);
  }

  /**
   * この動物に1手を与える（HuntingSystem.md 5.2節）。
   *
   * **重みと対象は必ず同時に書く**（aim参照）ので、YAML側は「数が0の候補の対象は絶対に読まれない」
   * という不変条件のうえで書ける。値は毎ターン上書きされるため、0へ戻す後始末は要らない。
   */
  takeTurn(location: Location, session: WorldSession): void {
    const characters = location.characters;
    this.instance.getProperty(this.nearbyCharactersId).setNumber(characters.length);

    // くわえている物（spoilsの先頭）。数は書かない——食べる候補のゲートはスロットの中身を
    // 直接見る（animals.yamlのbeast）ので、対象だけを毎ターン書き直す。
    const held = this.instance.tryGetSlot(this.spoilsSlotId)?.contents.at(0);
    this.instance.getProperty(this.spoilsTargetId).setNumber(held?.instanceId ?? 0);

    this.aim(this.lootablesId, this.lootTargetId, this.lootTargets(location), session.rng);
    this.aim(this.smashablesId, this.smashTargetId, this.smashTargets(location), session.rng);
    this.aim(this.escapeRoutesId, this.fleeToId, this.escapeTargets(location), session.rng);

    // 襲う相手はプロパティではなくactorとして渡す（spawnのinto: actorが受け取る、5.1節）。
    this.instance.tryExecuteAction(TURN_ACTION, characters.at(0));
  }

  /**
   * 候補の数と、その中から抽選した1つのインスタンスIDを**同時に**書き込む（5.2節）。候補が無ければ
   * 数だけを0にする——2箇所が暗黙に一致すべき規約を、ここ1箇所に閉じるための形。
   */
  private aim(countId: number, targetId: number, targets: readonly TurnTarget[], rng: Rng): void {
    this.instance.getProperty(countId).setNumber(targets.length);

    const chosen = pickWeighted(targets, (target) => target.weight, rng);
    if (chosen !== undefined) this.instance.getProperty(targetId).setNumber(chosen.instanceId);
  }

  /**
   * 持ち去れる物。**獲物（quarry）は除く**——動物と死体は持ち去るものではなく、自分自身も
   * ここで外れる。
   */
  private lootTargets(location: Location): readonly TurnTarget[] {
    return this.bumpableTargets(location, (object) => !object.def.tags.includes(this.quarryTagId));
  }

  /**
   * ぶつかって壊せる物。**壊れうると著者が明示した物だけ**を候補にする（5.4節）——`durability`を
   * 持つ物すべてにすると、置いておいた道具まで一撃で消える。
   */
  private smashTargets(location: Location): readonly TurnTarget[] {
    return this.bumpableTargets(location, (object) => object.def.tags.includes(this.fragileTagId));
  }

  /**
   * 足元の物から候補を作る。**かさ（volume）が重み**で、大きい物ほどぶつかりやすい／目に付きやすい
   * ——地面に大きな物を広げていると危ない、という読める判断になる（5.4節）。かさを宣言していない
   * 物も候補から漏れないよう、最小の1として数える。
   */
  private bumpableTargets(
    location: Location,
    matches: (object: WorldObject) => boolean,
  ): readonly TurnTarget[] {
    return location.items.filter(matches).map((object) => ({
      instanceId: object.instanceId,
      weight: Math.max(1, object.tryGetProperty(this.volumeId)?.getEffectiveValue() ?? 0),
    }));
  }

  /**
   * 逃げ込める先。発見済みの道1本につき1つで、どれも同じ確からしさ——気まぐれに選ぶので、
   * 近い遠いを見ない。1本も無ければ空になり、逃走の候補が抽選から外れる（追い詰められた獣は
   * 逃げずに襲う、5.3節）。
   */
  private escapeTargets(location: Location): readonly TurnTarget[] {
    return location.paths.map((path) => ({ instanceId: path.destinationInstanceId, weight: 1 }));
  }
}
